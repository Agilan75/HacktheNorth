import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';

import type { ChunkRequest, ChunkResult, Disagreement, InvariantViolation, RunConfig, RunSummary } from './types.js';
import type { FromWorker, ToWorker } from './worker.js';

/**
 * Worker pool (V08): chunked, seeded, reports partial counts so an interrupted
 * run still says how many cases really completed. Workers are spawned with
 * `execArgv: ['--import', 'tsx']`.
 *
 * Every case is a pure function of `(config.seed, index)`, so the counts a run
 * reports do not depend on the worker count or on chunk boundaries.
 */

/** How many violations / disagreements the summary keeps verbatim. */
export const KEEP_FIRST = 100;

const WORKER_URL = new URL('./worker.ts', import.meta.url);
/** Must equal `WORKER_MARKER` in worker.ts; restated so this module does not load the engine. */
const WORKER_MARKER = 'retrofit-verify-worker';

function wholeAtLeast(n: number, min: number): number {
  return Number.isFinite(n) ? Math.max(min, Math.floor(n)) : min;
}

export function planChunks(config: RunConfig): readonly ChunkRequest[] {
  const total = wholeAtLeast(config.total, 0);
  const chunkSize = wholeAtLeast(config.chunkSize, 1);
  const chunks: ChunkRequest[] = [];
  for (let start = 0, id = 0; start < total; start += chunkSize, id++) {
    chunks.push({ chunkId: id, seed: config.seed, startIndex: start, count: Math.min(chunkSize, total - start) });
  }
  return chunks;
}

/* ---------------------------------------------------------- stop requests */

const activeStops = new Set<Int32Array>();

/**
 * Asks every running pool to stop: workers finish the case they are on and
 * return their partial chunk, which is still counted. The CLI wires SIGINT to it.
 */
export function requestStop(): void {
  for (const flag of activeStops) Atomics.store(flag, 0, 1);
}

/* ---------------------------------------------------------- keep-first buffer */

interface Keyed<T> {
  readonly chunkId: number;
  readonly order: number;
  readonly item: T;
}

/** Keeps the first `limit` items in (chunkId, position) order, whatever order chunks finish in. */
function keepFirst<T>(buffer: Keyed<T>[], chunkId: number, items: readonly T[], limit: number): void {
  const take = Math.min(items.length, limit);
  for (let i = 0; i < take; i++) buffer.push({ chunkId, order: i, item: items[i] as T });
  buffer.sort((a, b) => a.chunkId - b.chunkId || a.order - b.order);
  if (buffer.length > limit) buffer.length = limit;
}

/* ------------------------------------------------------------------ the pool */

export function runPool(config: RunConfig, onChunk?: (result: ChunkResult) => void): Promise<RunSummary> {
  const startedAt = new Date();
  const t0 = performance.now();
  const chunks = planChunks(config);
  const workerCount = Math.min(
    wholeAtLeast(config.workers, 1),
    Math.max(1, availableParallelism() * 2),
    Math.max(1, chunks.length),
  );
  const maxDisagreements = wholeAtLeast(config.maxDisagreements, 0);

  const stopBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const stopFlag = new Int32Array(stopBuffer);
  activeStops.add(stopFlag);

  let completed = 0;
  let violationCount = 0;
  let disagreementCount = 0;
  let errorCount = 0;
  const firstViolations: Keyed<InvariantViolation>[] = [];
  const firstDisagreements: Keyed<Disagreement>[] = [];

  let next = 0;
  let live = 0;

  const stopped = (): boolean => Atomics.load(stopFlag, 0) !== 0;

  const record = (result: ChunkResult): void => {
    completed += result.completed;
    violationCount += result.violations.length;
    disagreementCount += result.disagreements.length;
    errorCount += result.errors.length;
    keepFirst(firstViolations, result.chunkId, result.violations, KEEP_FIRST);
    keepFirst(firstDisagreements, result.chunkId, result.disagreements, KEEP_FIRST);
    if (maxDisagreements > 0 && disagreementCount >= maxDisagreements) Atomics.store(stopFlag, 0, 1);
    if (onChunk) {
      try {
        onChunk(result);
      } catch {
        // A progress callback must never take the run down.
      }
    }
  };

  /** A chunk whose worker died: count only the cases it reported, and one error. */
  const lost = (chunk: ChunkRequest, done: number, message: string): void => {
    record({
      chunkId: chunk.chunkId,
      completed: 0,
      violations: [],
      disagreements: [],
      errors: [{ caseId: `chunk:${chunk.chunkId}`, message: `worker failed after ${done} of ${chunk.count} cases (not counted): ${message}` }],
      durationMs: 0,
    });
  };

  return new Promise<RunSummary>((resolve) => {
    const finish = (): void => {
      activeStops.delete(stopFlag);
      const elapsedMs = performance.now() - t0;
      resolve({
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        config,
        completed,
        invariantViolations: violationCount,
        disagreements: disagreementCount,
        errors: errorCount,
        casesPerSecond: elapsedMs > 0 ? (completed * 1000) / elapsedMs : 0,
        firstViolations: firstViolations.map((k) => k.item),
        firstDisagreements: firstDisagreements.map((k) => k.item),
      });
    };

    if (chunks.length === 0) {
      finish();
      return;
    }

    const spawn = (): void => {
      live++;
      let current: ChunkRequest | null = null;
      let progressed = 0;
      let settled = false;

      const worker = new Worker(WORKER_URL, {
        execArgv: ['--import', 'tsx'],
        workerData: { marker: WORKER_MARKER, stop: stopBuffer },
      });

      const dispatch = (): void => {
        if (stopped() || next >= chunks.length) {
          current = null;
          worker.postMessage({ type: 'exit' } satisfies ToWorker);
          return;
        }
        current = chunks[next++] ?? null;
        progressed = 0;
        if (current !== null) worker.postMessage({ type: 'chunk', request: current } satisfies ToWorker);
      };

      const done = (failure: string | null): void => {
        if (settled) return;
        settled = true;
        if (failure !== null && current !== null) lost(current, progressed, failure);
        current = null;
        live--;
        // A crashed worker is replaced while there is still work to hand out.
        if (failure !== null && !stopped() && next < chunks.length) {
          spawn();
          return;
        }
        if (live === 0) finish();
      };

      worker.on('message', (message: FromWorker) => {
        switch (message.type) {
          case 'ready':
            dispatch();
            break;
          case 'progress':
            if (current !== null && message.chunkId === current.chunkId) progressed = message.completed;
            break;
          case 'result':
            current = null;
            record(message.result);
            dispatch();
            break;
          case 'fatal':
            if (current !== null) lost(current, progressed, message.message);
            current = null;
            dispatch();
            break;
        }
      });
      worker.on('error', (err: unknown) => {
        done(err instanceof Error ? err.message : String(err));
        void worker.terminate();
      });
      worker.on('exit', (code: number) => {
        done(current !== null || code !== 0 ? `worker exited with code ${code}` : null);
      });
    };

    for (let i = 0; i < workerCount; i++) spawn();
  });
}
