/**
 * Writes the per-case record of the layer A+B run, so the console can draw all
 * of it: `out/field/{cases,scores,strata}.bin` (one byte per case each) and
 * `out/field/summary.json`.
 *
 * The A+B run keeps only counts. Every case is `caseAt(seed, index)`, so this
 * regenerates the same cases from `out/run.json`'s seed and total and records
 * what the ENGINE decided on each. It does not re-run the invariants or the
 * naive implementation -- their result (0 / 0) is already in `run.json`.
 *
 *   cases.bin   bits 0-1 verdict (FIELD_VERDICTS), bits 2-5 deciding factor
 *               (0 none, else 1 + index in FIELD_FACTORS), bit 6 from a full
 *               submission, bit 7 some component placed exactly on a threshold
 *   scores.bin  appetite score rounded to 0..100
 *   strata.bin  0 ordinary, else 1 + index in summary.strata
 *
 * Run: node --import tsx packages/verify/src/scripts/record-field.ts [--total N] [--workers N]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';

import { engineViewForInput } from '../compare.js';
import { classifyStratum, strata } from '../gen/stratify.js';
import { caseAt } from '../worker.js';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../../out');
const MARKER = 'retrofit-record-field';
const SLICE = 50_000;

export const FIELD_VERDICTS = ['FIT', 'REFER', 'DOES_NOT_FIT'] as const;
export const FIELD_FACTORS = [
  'submission_type',
  'line_of_business',
  'primary_risk_state',
  'tiv',
  'total_premium',
  'building_age',
  'construction_type',
  'loss_value',
] as const;

interface Job {
  readonly marker: string;
  readonly seed: number;
  readonly total: number;
  readonly cases: SharedArrayBuffer;
  readonly scores: SharedArrayBuffer;
  readonly strata: SharedArrayBuffer;
  /** Next unclaimed slice start, advanced atomically by whichever worker is free. */
  readonly cursor: SharedArrayBuffer;
}

function isJob(data: unknown): data is Job {
  return typeof data === 'object' && data !== null && (data as { marker?: unknown }).marker === MARKER;
}

function work(job: Job): void {
  const cases = new Uint8Array(job.cases);
  const scores = new Uint8Array(job.scores);
  const strataOut = new Uint8Array(job.strata);
  const cursor = new Int32Array(job.cursor);
  const strataKeys = strata().map((s) => s.key);

  for (;;) {
    const start = Atomics.add(cursor, 0, SLICE);
    if (start >= job.total) break;
    const end = Math.min(job.total, start + SLICE);
    for (let i = start; i < end; i++) {
      const testCase = caseAt(job.seed, i);
      const view = engineViewForInput(testCase.input);
      const verdict = FIELD_VERDICTS.indexOf(view.verdict);
      const factor =
        view.decidingFactorId === null
          ? 0
          : 1 + (FIELD_FACTORS as readonly string[]).indexOf(view.decidingFactorId);
      if (verdict < 0 || factor < 0) throw new Error(`case ${i}: unknown verdict or factor`);
      const onThreshold = Object.values(testCase.boundaries).includes('at');
      cases[i] = verdict | (factor << 2) | (testCase.fromSubmission ? 64 : 0) | (onThreshold ? 128 : 0);
      scores[i] = Math.max(0, Math.min(100, Math.round(view.appetiteScore)));
      const key = classifyStratum(testCase);
      strataOut[i] = key === null ? 0 : 1 + strataKeys.indexOf(key);
    }
    parentPort?.postMessage(end - start);
  }
}

function arg(name: string): number | null {
  const at = process.argv.indexOf(`--${name}`);
  if (at < 0) return null;
  const n = Number(process.argv[at + 1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function main(): Promise<void> {
  const run = JSON.parse(readFileSync(join(OUT, 'run.json'), 'utf8')) as {
    readonly completed: number;
    readonly config: { readonly seed: number };
  };
  const seed = run.config.seed;
  const total = arg('total') ?? run.completed;
  const workers = arg('workers') ?? Math.max(1, availableParallelism() - 2);

  const job: Job = {
    marker: MARKER,
    seed,
    total,
    cases: new SharedArrayBuffer(total),
    scores: new SharedArrayBuffer(total),
    strata: new SharedArrayBuffer(total),
    cursor: new SharedArrayBuffer(4),
  };

  const started = performance.now();
  let done = 0;
  let lastLogged = 0;
  await Promise.all(
    Array.from({ length: workers }, () => {
      return new Promise<void>((ok, fail) => {
        const w = new Worker(new URL(import.meta.url), { execArgv: ['--import', 'tsx'], workerData: job });
        w.on('message', (n: number) => {
          done += n;
          if (done - lastLogged >= 500_000 || done === total) {
            lastLogged = done;
            const rate = done / ((performance.now() - started) / 1000);
            console.log(`${done.toLocaleString()} / ${total.toLocaleString()}  (${Math.round(rate).toLocaleString()}/s)`);
          }
        });
        w.on('error', fail);
        w.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`worker exited ${code}`))));
      });
    }),
  );

  const cases = new Uint8Array(job.cases);
  const scores = new Uint8Array(job.scores);
  const strataBytes = new Uint8Array(job.strata);
  const strataDefs = strata();

  const byVerdict = FIELD_VERDICTS.map(() => 0);
  const byFactor = [null, ...FIELD_FACTORS].map(() => FIELD_VERDICTS.map(() => 0));
  const scoreHistogram = FIELD_VERDICTS.map(() => new Array<number>(101).fill(0));
  const byStratum = [null, ...strataDefs].map(() => FIELD_VERDICTS.map(() => 0));
  let fromSubmission = 0;
  let onThreshold = 0;
  for (let i = 0; i < total; i++) {
    const b = cases[i]!;
    const v = b & 3;
    byVerdict[v]!++;
    byFactor[(b >> 2) & 15]![v]!++;
    scoreHistogram[v]![scores[i]!]!++;
    byStratum[strataBytes[i]!]![v]!++;
    if (b & 64) fromSubmission++;
    if (b & 128) onThreshold++;
  }

  const dir = join(OUT, 'field');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'cases.bin'), cases);
  writeFileSync(join(dir, 'scores.bin'), scores);
  writeFileSync(join(dir, 'strata.bin'), strataBytes);
  writeFileSync(
    join(dir, 'summary.json'),
    `${JSON.stringify(
      {
        seed,
        total,
        generatedAt: new Date().toISOString(),
        verdicts: FIELD_VERDICTS,
        factors: FIELD_FACTORS,
        strata: strataDefs.map((s) => ({ key: s.key, description: s.description })),
        byVerdict,
        byFactor,
        byStratum,
        scoreHistogram,
        fromSubmission,
        onThreshold,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`wrote ${dir} in ${Math.round((performance.now() - started) / 1000)}s`);
}

if (isMainThread) await main();
else if (isJob(workerData)) work(workerData);
