/**
 * A16 — ingest (idempotent by externalId) and rescore (BookStats, peers, rank)
 * over the mini snapshot, in-memory SQLite, mock adapter. No network.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineResult, FeatureVector, VectorSpec } from '@retrofit/engine';
import { computeBookStats, math, peers, SCORE_TOLERANCE } from '@retrofit/engine';
import { createMockAdapter } from '@retrofit/federato';
import type { FederatoSnapshot } from '@retrofit/federato';
import { createDb } from '../db/client';
import type { DbHandle } from '../db/client';
import { migrate } from '../db/migrate';
import { createRepos } from '../db/repos';
import { createFakeLlm } from '../llm/fake-provider';
import { ingestFederato } from './ingest';
import { rescoreBook, rescoreOne, snapshotOf } from './rescore';
import { fixedClock } from './types';
import type { Deps } from './types';

/**
 * The engine's `read*` loaders belong to E13; read the committed data files
 * directly so this test does not depend on that unit's progress.
 */
vi.mock('@retrofit/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@retrofit/engine')>();
  const { readFileSync: read } = await import('node:fs');
  const { fileURLToPath: toPath } = await import('node:url');
  const json = (rel: string): unknown =>
    JSON.parse(read(toPath(new URL(`../../../../packages/engine/${rel}`, import.meta.url)), 'utf8'));
  const lineFile = (line: string) => (line === 'tenant' ? 'tenant' : 'commercial');
  return {
    ...actual,
    readVectorSpec: (line: string) => Promise.resolve(json(`vectors/${lineFile(line)}.json`)),
    readRulebook: (name: string) => Promise.resolve(json(`rules/${name}.json`)),
    readRatingTable: (line: string) => Promise.resolve(json(`rating/${lineFile(line)}.json`)),
    readQuestions: (line: string) =>
      Promise.resolve((json(`questions/${lineFile(line)}.json`) as { questions: unknown[] }).questions),
  };
});

const SPEC = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../../packages/engine/vectors/commercial.json', import.meta.url)), 'utf8'),
) as VectorSpec;

/**
 * The mini snapshot sits outside this package's rootDir, so it is loaded by a
 * runtime specifier tsc does not follow (vitest resolves it normally).
 */
const MINI_PATH = '../../../../packages/federato/fixtures/mini-snapshot';
const { MINI_SNAPSHOT } = (await import(/* @vite-ignore */ MINI_PATH)) as {
  MINI_SNAPSHOT: FederatoSnapshot;
};

const PROPERTY_IDS = ['SUB-1001', 'SUB-1002', 'SUB-1004', 'SUB-1005'];

let handle: DbHandle;
let deps: Deps;

function depsAt(iso: string): Deps {
  return {
    db: handle.db,
    adapter: createMockAdapter({ snapshot: MINI_SNAPSHOT }),
    llm: createFakeLlm(),
    clock: fixedClock(iso),
  };
}

beforeEach(() => {
  handle = createDb({ url: ':memory:' });
  migrate(handle);
  deps = depsAt('2026-09-19T12:00:00.000Z');
});

afterEach(() => handle.close());

const rows = () => createRepos(deps.db).submissions.all();
const row = (externalId: string) => {
  const r = createRepos(deps.db).submissions.byExternalId(externalId);
  if (r === null) throw new Error(`missing ${externalId}`);
  return r;
};
const resultOf = (externalId: string): EngineResult => {
  const r = row(externalId).result;
  if (r === null || r === undefined) throw new Error(`unscored ${externalId}`);
  return r;
};

describe('ingestFederato', () => {
  it('stores every triage survivor, scores the book and ranks it', async () => {
    const res = await ingestFederato(deps, {});
    expect(res.adapter).toBe('mock');
    expect(res.ingested).toBe(4);
    expect(res.updated).toBe(0);
    expect(res.skipped).toBe(0);
    expect(res.knockedOutAtTriage).toBe(1); // SUB-1003, cyber
    expect(res.noPolicy).toBe(1); // SUB-1004
    expect([...res.externalIds].sort()).toEqual(PROPERTY_IDS);
    expect(res.queryCount).toBeGreaterThanOrEqual(3);

    const stored = rows();
    expect(stored.map((r) => r.externalId).sort()).toEqual(PROPERTY_IDS);
    expect(stored.every((r) => r.result !== null && r.canonical !== null && r.source === 'federato')).toBe(true);
    // Ranks are a 1..n permutation, and the result id is the row id.
    expect(stored.map((r) => r.rank).sort()).toEqual([1, 2, 3, 4]);
    for (const r of stored) expect(r.result!.id).toBe(r.id);
    // Every row keeps the trace entries that produced it.
    expect(stored.every((r) => r.queryTrace.length > 0)).toBe(true);

    // SUB-1005 is knocked out on several factors: it ranks below every non-knockout.
    const ko = resultOf('SUB-1005');
    expect(ko.evaluate.knockout).toBe(true);
    expect(ko.verdict.verdict).toBe('DOES_NOT_FIT');
    expect(row('SUB-1005').rank).toBe(4);
    // SUB-1004 has no policy: REFER with missing data, never a knockout by imputation.
    expect(resultOf('SUB-1004').verdict.verdict).toBe('REFER');
    // SUB-1001 is the FIT-shaped account and leads the queue.
    expect(row('SUB-1001').rank).toBe(1);
    // Deterministic explanation is stored with the result.
    expect(typeof resultOf('SUB-1001').explanation).toBe('string');
  });

  it('computes peers against book-wide statistics over every account but itself', async () => {
    await ingestFederato(deps, {});
    const results = PROPERTY_IDS.map(resultOf);
    const vectors: FeatureVector[] = results.map((r) => r.vector);
    const stats = computeBookStats(vectors, SPEC);

    const self = resultOf('SUB-1001');
    expect(self.peers).not.toBeNull();
    const p = self.peers!;
    expect(p.k).toBe(5);
    // P-2: fewer than k candidates -> what exists. SUB-1004 (no policy) carries
    // no peer component at all (only isPropertyLine), so P-1 drops the pair.
    expect(p.peers.map((m) => m.id).sort()).toEqual(['SUB-1002', 'SUB-1005']);
    expect(p.peers.every((m) => !m.coarse)).toBe(true);
    // SUB-1004 itself is matched on the reduced vector and labelled coarse.
    const noPolicy = resultOf('SUB-1004').peers!;
    expect(noPolicy.coarse).toBe(true);
    expect(noPolicy.peers).toHaveLength(0);
    // P-3: median rate, mean loss over the matched peers.
    const rates = p.peers.map((m) => m.ratePer100);
    expect(p.medianRatePer100).toBe(math.median(rates));

    // Rate on each full peer is premium per $100 of TIV.
    const full = p.peers.find((m) => m.id === 'SUB-1002')!;
    expect(full.ratePer100!).toBeCloseTo(full.quotedPremium! / (full.totalTiv! / 100), 9);

    // Distances match stage 12 recomputed with stats over all four vectors.
    const others = ['SUB-1002', 'SUB-1005'].map((id) => {
      const m = p.peers.find((x) => x.id === id)!;
      const r = resultOf(id);
      return {
        id,
        vector: r.vector,
        totalTiv: m.totalTiv,
        quotedPremium: m.quotedPremium,
        ratePer100: m.ratePer100,
        annualLoss: m.annualLoss,
        coarse: m.coarse,
      };
    });
    const expected = peers(self.vector, SPEC, others, stats);
    expect(expected.peers).toHaveLength(2);
    for (const m of expected.peers) {
      const got = p.peers.find((x) => x.id === m.id)!;
      expect(Math.abs(got.distance - m.distance)).toBeLessThan(SCORE_TOLERANCE);
    }
  });

  it('is idempotent by externalId, and force re-runs existing accounts', async () => {
    await ingestFederato(deps, {});
    const firstUpdated = row('SUB-1001').updatedAt;
    const firstResult = resultOf('SUB-1001');

    const later = depsAt('2026-09-20T08:00:00.000Z');
    const again = await ingestFederato(later, {});
    expect(again).toMatchObject({ ingested: 0, updated: 0, skipped: 4 });
    expect(rows()).toHaveLength(4);
    expect(row('SUB-1001').updatedAt).toBe(firstUpdated);
    expect(resultOf('SUB-1001')).toEqual(firstResult);

    const forced = await ingestFederato(later, { force: true });
    expect(forced).toMatchObject({ ingested: 0, updated: 4, skipped: 0 });
    expect(rows()).toHaveLength(4);
    expect(row('SUB-1001').updatedAt).toBe('2026-09-20T08:00:00.000Z');
    // Same data, same numbers: the re-run reproduces the score exactly.
    expect(resultOf('SUB-1001').evaluate.appetiteScore).toBe(firstResult.evaluate.appetiteScore);
  });

  it('ingests only the requested external ids and explains the ones it could not', async () => {
    const res = await ingestFederato(deps, { externalIds: ['SUB-1002', 'SUB-1003', 'SUB-9999'] });
    expect(res.ingested).toBe(1);
    expect(res.externalIds).toEqual(['SUB-1002']);
    expect(rows().map((r) => r.externalId)).toEqual(['SUB-1002']);
    expect(row('SUB-1002').rank).toBe(1);
    expect(res.warnings.some((w) => w.startsWith('SUB-1003 was knocked out at triage'))).toBe(true);
    expect(res.warnings.some((w) => w.startsWith('SUB-9999 was not returned'))).toBe(true);
  });

  it('returns an empty result for tenant, which Federato does not carry', async () => {
    const res = await ingestFederato(deps, { lineOfBusiness: 'tenant' });
    expect(res).toMatchObject({ ingested: 0, updated: 0, skipped: 0, externalIds: [] });
    expect(res.warnings).toHaveLength(1);
    expect(rows()).toHaveLength(0);
  });
});

describe('rescore', () => {
  it('snapshotOf copies the headline numbers verbatim', async () => {
    await ingestFederato(deps, {});
    const r = resultOf('SUB-1002');
    expect(snapshotOf(r, 7)).toEqual({
      appetiteScore: r.evaluate.appetiteScore,
      verdict: r.verdict.verdict,
      completeness: r.evaluate.completeness,
      confidence: r.evaluate.confidence,
      predictedPremium: r.price.predictedPremium,
      qualityIndex: r.qualityIndex,
      rank: 7,
    });
  });

  it('rescoreOne is deterministic on unchanged data and reports rank movement', async () => {
    await ingestFederato(deps, {});
    const id = row('SUB-1002').id;
    const before = snapshotOf(resultOf('SUB-1002'), row('SUB-1002').rank);

    const same = await rescoreOne(deps, { submissionId: id });
    expect(same.before).toEqual(before);
    expect(same.after).toEqual(before);
    expect(same.rankChanged).toBe(false);

    // Knock the stored rank out of place; the re-score restores it and says so.
    createRepos(deps.db).submissions.setRanks([{ id, rank: 99 }]);
    const moved = await rescoreOne(deps, { submissionId: id });
    expect(moved.before!.rank).toBe(99);
    expect(moved.after.rank).toBe(before.rank);
    expect(moved.rankChanged).toBe(true);
  });

  it('rescoreOne merges extra values and the new score moves the result', async () => {
    await ingestFederato(deps, {});
    const id = row('SUB-1005').id;
    const res = await rescoreOne(deps, {
      submissionId: id,
      extra: [
        {
          canonicalPath: 'pricing.quotedPremium',
          value: 90_000,
          provenance: { source: 'answer', confidence: 0.8 },
        },
      ],
    });
    const premiums = res.result.canonical.pricing.quotedPremium?.map((f) => f.value) ?? [];
    expect(premiums).toContain(90_000);
    expect(row('SUB-1005').result).toEqual(res.result);
  });

  it('rescoreOne throws for an unknown submission', async () => {
    await expect(rescoreOne(deps, { submissionId: 'nope' })).rejects.toThrow(/no submission/);
  });

  it('rescoreBook scores every account with a canonical record and returns the count', async () => {
    await ingestFederato(deps, {});
    expect(await rescoreBook(deps)).toBe(4);
    expect(rows().map((r) => r.rank).sort()).toEqual([1, 2, 3, 4]);
  });
});
