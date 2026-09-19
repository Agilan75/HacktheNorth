import { availableParallelism } from 'node:os';

import { beforeAll, describe, expect, it } from 'vitest';

import { parseArgs } from './cli.js';
import { planChunks, requestStop, runPool } from './pool.js';
import type { ChunkResult, RunConfig, RunSummary } from './types.js';
import { caseAt, runChunk } from './worker.js';

/**
 * V08: the pool, the worker, the CLI flags, and the 100K layers A + B run that
 * `npm test` carries (PRD §12, §15 "npm test passes, including 100K property
 * and differential cases").
 */

const SEED = 20260919;

function config(over: Partial<RunConfig>): RunConfig {
  return { total: 0, seed: SEED, workers: 1, chunkSize: 1000, maxDisagreements: 0, outDir: 'unused', ...over };
}

describe('planChunks', () => {
  it('covers [0, total) exactly once, in order, carrying the run seed', () => {
    const chunks = planChunks(config({ total: 25, chunkSize: 10 }));
    expect(chunks).toEqual([
      { chunkId: 0, seed: SEED, startIndex: 0, count: 10 },
      { chunkId: 1, seed: SEED, startIndex: 10, count: 10 },
      { chunkId: 2, seed: SEED, startIndex: 20, count: 5 },
    ]);
  });

  it('plans 1,000 chunks of 10,000 for the 10M run and nothing for an empty run', () => {
    const big = planChunks(config({ total: 10_000_000, chunkSize: 10_000 }));
    expect(big).toHaveLength(1000);
    expect(big.reduce((s, c) => s + c.count, 0)).toBe(10_000_000);
    expect(big[999]).toEqual({ chunkId: 999, seed: SEED, startIndex: 9_990_000, count: 10_000 });
    expect(planChunks(config({ total: 0 }))).toEqual([]);
    expect(planChunks(config({ total: 3, chunkSize: 0 }))).toHaveLength(3);
  });
});

describe('caseAt', () => {
  it('keeps B1..B12 as vector cases and makes one case in ten a full submission', () => {
    expect(caseAt(SEED, 9).fromSubmission).toBe(false);
    expect(caseAt(SEED, 11).input.totalTiv).toBe(50_000_000); // B12
    expect(caseAt(SEED, 19).fromSubmission).toBe(true);
    expect(caseAt(SEED, 20).fromSubmission).toBe(false);
    const sub = caseAt(SEED, 29);
    expect(sub.seed).toBe(SEED);
    expect(sub.index).toBe(29);
    expect(caseAt(SEED, 29)).toEqual(sub);
  });
});

describe('runChunk (in-process)', () => {
  it('completes every requested case and is deterministic', () => {
    const a = runChunk({ chunkId: 7, seed: SEED, startIndex: 0, count: 60 });
    const b = runChunk({ chunkId: 7, seed: SEED, startIndex: 0, count: 60 });
    expect(a.chunkId).toBe(7);
    expect(a.completed).toBe(60);
    expect(a.errors).toEqual([]);
    expect(b.violations.map((v) => `${v.invariant}:${v.caseId}`)).toEqual(
      a.violations.map((v) => `${v.invariant}:${v.caseId}`),
    );
    expect(b.disagreements.map((d) => d.caseId)).toEqual(a.disagreements.map((d) => d.caseId));
  });

  it('agrees on the twelve INTERPRETATIONS §8 worked cases (B1..B12)', () => {
    const r = runChunk({ chunkId: 0, seed: SEED, startIndex: 0, count: 12 });
    expect(r.completed).toBe(12);
    expect(r.disagreements).toEqual([]);
    expect(r.errors).toEqual([]);
  });

  it('treats a non-finite or negative count as zero cases', () => {
    expect(runChunk({ chunkId: 0, seed: SEED, startIndex: 0, count: Number.NaN }).completed).toBe(0);
    expect(runChunk({ chunkId: 0, seed: SEED, startIndex: 0, count: -5 }).completed).toBe(0);
  });
});

describe('runPool (worker_threads, --import tsx)', () => {
  it('reports the same counts as the in-process run, whatever the worker count', async () => {
    const total = 1500;
    const local = runChunk({ chunkId: 0, seed: SEED, startIndex: 0, count: total });
    const one = await runPool(config({ total, workers: 1, chunkSize: 500 }));
    const three = await runPool(config({ total, workers: 3, chunkSize: 200 }));
    for (const run of [one, three]) {
      expect(run.completed).toBe(total);
      expect(run.invariantViolations).toBe(local.violations.length);
      expect(run.disagreements).toBe(local.disagreements.length);
      expect(run.errors).toBe(local.errors.length);
      expect(run.firstDisagreements.map((d) => d.caseId)).toEqual(
        local.disagreements.slice(0, 100).map((d) => d.caseId),
      );
      expect(run.casesPerSecond).toBeGreaterThan(0);
      expect(Date.parse(run.finishedAt)).toBeGreaterThanOrEqual(Date.parse(run.startedAt));
    }
  }, 120_000);

  it('stops on request and reports only the cases that really completed', async () => {
    const seen: ChunkResult[] = [];
    const run = await runPool(config({ total: 20_000, workers: 1, chunkSize: 100 }), (r) => {
      seen.push(r);
      if (seen.length === 2) requestStop();
    });
    expect(run.completed).toBeLessThan(20_000);
    expect(run.completed).toBeGreaterThanOrEqual(200);
    expect(run.completed).toBe(seen.reduce((s, r) => s + r.completed, 0));
    expect(run.config.total).toBe(20_000);
  }, 120_000);

  it('stops after maxDisagreements disagreements', async () => {
    // The engine and the naive oracle now agree on every case, so a real run has
    // no disagreement to stop on. Inject one every 1000 cases (test-only; see
    // injectedFaultEvery in worker.ts) to exercise the stop mechanism itself.
    process.env['RETROFIT_VERIFY_FAULT_EVERY'] = '1000';
    try {
      const run = await runPool(config({ total: 50_000, workers: 1, chunkSize: 100, maxDisagreements: 1 }));
      expect(run.disagreements).toBeGreaterThanOrEqual(1);
      expect(run.completed).toBeLessThan(50_000);
      expect(run.completed % 100).toBe(0);
    } finally {
      delete process.env['RETROFIT_VERIFY_FAULT_EVERY'];
    }
  }, 120_000);

  it('resolves an empty run without spawning a worker', async () => {
    const run = await runPool(config({ total: 0, workers: 4 }));
    expect(run.completed).toBe(0);
    expect(run.casesPerSecond).toBe(0);
  });
});

describe('verify CLI flags', () => {
  it('parses flags with defaults matching the 10M CP2 run', () => {
    const d = parseArgs([]);
    if ('error' in d) throw new Error(d.error);
    expect(d.config.total).toBe(10_000_000);
    expect(d.config.chunkSize).toBe(10_000);
    expect(d.config.maxDisagreements).toBe(0);
    expect(d.config.workers).toBeLessThanOrEqual(6);
    expect(d.config.outDir.endsWith('/packages/verify/out')).toBe(true);

    const p = parseArgs(['--total', '100_000', '--seed=7', '--workers', '3', '--chunk', '500', '--max-disagreements', '9']);
    if ('error' in p) throw new Error(p.error);
    expect(p.config).toMatchObject({ total: 100_000, seed: 7, workers: 3, chunkSize: 500, maxDisagreements: 9 });
  });

  it('rejects bad flags', () => {
    expect(parseArgs(['--workers', '0'])).toHaveProperty('error');
    expect(parseArgs(['--total', '1.5'])).toHaveProperty('error');
    expect(parseArgs(['--total'])).toHaveProperty('error');
    expect(parseArgs(['--bogus', '1'])).toHaveProperty('error');
  });
});

describe('layers A + B at 100K (PRD §12, §15)', () => {
  const TOTAL = 100_000;
  let run: RunSummary;

  beforeAll(async () => {
    const workers = Math.max(1, Math.min(4, availableParallelism() - 1));
    run = await runPool(config({ total: TOTAL, workers, chunkSize: 5000 }));
  }, 600_000);

  it('completes all 100,000 cases with no case throwing', () => {
    expect(run.completed).toBe(TOTAL);
    expect(run.errors).toBe(0);
  });

  it('finds zero invariant violations and zero engine-vs-naive disagreements', () => {
    const detail = [
      ...run.firstViolations.slice(0, 5).map((v) => `${v.invariant} ${v.caseId}: ${v.message}`),
      ...run.firstDisagreements.slice(0, 5).map((d) => `${d.caseId}: ${d.fields.map((f) => f.field).join(',')}`),
    ].join('\n');
    expect({ violations: run.invariantViolations, disagreements: run.disagreements, detail }).toEqual({
      violations: 0,
      disagreements: 0,
      detail: '',
    });
  });
});
