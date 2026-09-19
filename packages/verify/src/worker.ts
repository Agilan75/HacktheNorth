import { isMainThread, parentPort, workerData } from 'node:worker_threads';

import { compareResults, engineViewForInput } from './compare.js';
import { generateCase } from './gen/vectors.js';
import { generateSubmission, rollupGenerated } from './gen/submissions.js';
import { coreSuite, setInvariantProbe } from './invariants/core.js';
import { flipSuite } from './invariants/flip.js';
import { monotonicSuite } from './invariants/monotonic.js';
import { vectorSuite } from './invariants/vector.js';
import { naiveEvaluate } from './naive/index.js';
import type {
  ChunkRequest,
  ChunkResult,
  Disagreement,
  GeneratedCase,
  InvariantSuite,
  InvariantViolation,
} from './types.js';

/**
 * One verification worker (V08). Entry point for `node --import tsx worker.ts`,
 * driven by the pool over `worker_threads` messages. Runs layer A invariants
 * and the layer B comparator over one chunk and reports partial counts.
 *
 * Case layout (docs/decisions/V08.md): index `i` of seed `s` is a full
 * multi-building submission (V03, rolled up) when `i >= 12` and `i % 10 === 9`,
 * otherwise a vector case (V02). Either way the case is a pure function of
 * `(s, i)`, so any reported case replays without the chunk it ran in.
 */

/** Indices 0..11 are INTERPRETATIONS §8 B1..B12 (V02-3); never replaced. */
const WORKED_CASES = 12;
/** One case in ten is a full submission: "a smaller share" (PRD §12). */
const SUBMISSION_EVERY = 10;
const SUBMISSION_OFFSET = 9;
/** How often (in cases) a worker thread reports progress to the pool. */
const PROGRESS_EVERY = 1000;

/** Marker the pool puts in `workerData`, so only pool-spawned threads auto-start. */
export const WORKER_MARKER = 'retrofit-verify-worker';

/** Messages from the pool to a worker. */
export type ToWorker = { readonly type: 'chunk'; readonly request: ChunkRequest } | { readonly type: 'exit' };

/** Messages from a worker to the pool. */
export type FromWorker =
  | { readonly type: 'ready' }
  | { readonly type: 'progress'; readonly chunkId: number; readonly completed: number }
  | { readonly type: 'result'; readonly result: ChunkResult }
  | { readonly type: 'fatal'; readonly chunkId: number | null; readonly message: string };

/** The case at `(seed, index)`, whichever generator owns that index. */
export function caseAt(seed: number, index: number): GeneratedCase {
  if (index >= WORKED_CASES && index % SUBMISSION_EVERY === SUBMISSION_OFFSET) {
    const rolled = rollupGenerated(generateSubmission(seed, index));
    // The submission generator ids its cases `V03:seed:index`; keep that id but
    // pin seed/index to the run's, so replay goes through `caseAt` too.
    return { ...rolled, seed, index, fromSubmission: true };
  }
  return generateCase(seed, index);
}

/* ------------------------------------------------------------- per thread */

let initialised = false;
let suites: readonly InvariantSuite[] = [];
/** Set by the pool through a SharedArrayBuffer: non-zero means stop now. */
let stopFlag: Int32Array | null = null;
let progress: ((chunkId: number, completed: number) => void) | null = null;

function init(): void {
  if (initialised) return;
  // V04 D1: determinism and monotonicity re-run the engine through this probe.
  setInvariantProbe(engineViewForInput);
  suites = [coreSuite(), monotonicSuite(), flipSuite(), vectorSuite()];
  initialised = true;
}

function stopRequested(): boolean {
  return stopFlag !== null && Atomics.load(stopFlag, 0) !== 0;
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function nowMs(): number {
  return performance.now();
}

/**
 * Runs every invariant and the differential comparator over one chunk.
 * `completed` is the number of cases actually finished: a stop request (the
 * pool's shared flag) ends the chunk early with the partial count.
 */
/**
 * TEST-ONLY fault injection, so the pool's maxDisagreements stop can be tested
 * without depending on a real engine/naive bug existing. Honoured only when BOTH
 * VITEST and RETROFIT_VERIFY_FAULT_EVERY are set, so the verify CLI -- which runs
 * outside vitest -- can never inject. Injected cases carry an `INJECTED:` id and
 * are never mistaken for a real disagreement in a report. (DECISIONS CP1-11)
 */
function injectedFaultEvery(): number {
  if (!process.env['VITEST']) return 0;
  const n = Number(process.env['RETROFIT_VERIFY_FAULT_EVERY']);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

export function runChunk(request: ChunkRequest): ChunkResult {
  init();
  const started = nowMs();
  const violations: InvariantViolation[] = [];
  const disagreements: Disagreement[] = [];
  const errors: { caseId: string; message: string }[] = [];
  const count = Number.isFinite(request.count) ? Math.max(0, Math.floor(request.count)) : 0;

  let completed = 0;
  for (let k = 0; k < count; k++) {
    if (stopRequested()) break;
    const index = request.startIndex + k;
    let caseId = `${request.seed}:${index}`;
    try {
      const testCase = caseAt(request.seed, index);
      caseId = testCase.caseId;

      // Layer A: the engine must not crash on any input (PRD §12).
      let result: ReturnType<typeof engineViewForInput> | null = null;
      try {
        result = engineViewForInput(testCase.input);
      } catch (err) {
        violations.push({
          invariant: 'noCrash',
          caseId,
          seed: testCase.seed,
          message: `engine threw: ${messageOf(err)}`,
          observed: messageOf(err),
          expected: 'a result',
        });
      }

      if (result !== null) {
        for (const suite of suites) {
          for (const inv of suite.invariants) {
            try {
              const found = inv.check(testCase, result);
              for (const v of found) violations.push(v);
            } catch (err) {
              errors.push({ caseId, message: `${suite.name}.${inv.name} threw: ${messageOf(err)}` });
            }
          }
        }

        // Layer B: the naive second implementation.
        try {
          const outcome = compareResults(testCase, result, naiveEvaluate(testCase.input));
          if (outcome.disagreement !== null) disagreements.push(outcome.disagreement);
          const every = injectedFaultEvery();
          if (every > 0 && index % every === 0) {
            disagreements.push({ caseId: `INJECTED:${caseId}`, seed: testCase.seed, input: testCase.input, fields: [] });
          }
        } catch (err) {
          errors.push({ caseId, message: `naive/compare threw: ${messageOf(err)}` });
        }
      }
    } catch (err) {
      errors.push({ caseId, message: `generator threw: ${messageOf(err)}` });
    }
    completed++;
    if (progress !== null && completed % PROGRESS_EVERY === 0) progress(request.chunkId, completed);
  }

  return {
    chunkId: request.chunkId,
    completed,
    violations,
    disagreements,
    errors,
    durationMs: nowMs() - started,
  };
}

interface WorkerInit {
  readonly marker: string;
  readonly stop?: SharedArrayBuffer;
}

function isWorkerInit(data: unknown): data is WorkerInit {
  return typeof data === 'object' && data !== null && (data as { marker?: unknown }).marker === WORKER_MARKER;
}

/** Wires this thread to the pool: one chunk per message, one result per chunk. */
export function startWorker(): void {
  const port = parentPort;
  if (isMainThread || port === null) {
    throw new Error('startWorker: must run inside a worker_threads Worker spawned by the pool');
  }
  const data: unknown = workerData;
  if (isWorkerInit(data) && data.stop !== undefined) stopFlag = new Int32Array(data.stop);
  progress = (chunkId, completed) => port.postMessage({ type: 'progress', chunkId, completed } satisfies FromWorker);

  port.on('message', (message: ToWorker) => {
    if (message.type === 'exit') {
      port.close();
      return;
    }
    if (message.type !== 'chunk') return;
    try {
      const result = runChunk(message.request);
      port.postMessage({ type: 'result', result } satisfies FromWorker);
    } catch (err) {
      port.postMessage({
        type: 'fatal',
        chunkId: message.request.chunkId,
        message: messageOf(err),
      } satisfies FromWorker);
    }
  });
  port.postMessage({ type: 'ready' } satisfies FromWorker);
}

if (!isMainThread && isWorkerInit(workerData)) startWorker();
