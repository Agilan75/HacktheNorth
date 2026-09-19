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
/** Every stored id: the property survivors plus SUB-1003, knocked out at triage (cyber). */
const ALL_IDS = [...PROPERTY_IDS, 'SUB-1003'].sort();

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
    expect(res.ingested).toBe(5);
    expect(res.updated).toBe(0);
    expect(res.skipped).toBe(0);
    expect(res.knockedOutAtTriage).toBe(1); // SUB-1003, cyber
    expect(res.noPolicy).toBe(1); // SUB-1004
    expect([...res.externalIds].sort()).toEqual(ALL_IDS);
    expect(res.queryCount).toBeGreaterThanOrEqual(3);

    const stored = rows();
    expect(stored.map((r) => r.externalId).sort()).toEqual(ALL_IDS);
    expect(stored.every((r) => r.result !== null && r.canonical !== null && r.source === 'federato')).toBe(true);
    // Ranks are a 1..n permutation, and the result id is the row id.
    expect(stored.map((r) => r.rank).sort()).toEqual([1, 2, 3, 4, 5]);
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

  it('stores every triage knockout as an out-of-appetite row with its triage trace (PRD 15, 11; INTERPRETATIONS 3.8)', async () => {
    const res = await ingestFederato(deps, {});
    expect(res.knockedOutAtTriage).toBe(1);
    expect(rows().map((r) => r.externalId).sort()).toEqual([...PROPERTY_IDS, 'SUB-1003'].sort());

    const ko = row('SUB-1003');
    expect(ko.source).toBe('federato');
    expect(ko.canonical).not.toBeNull();
    // Federato's own line stays on the raw record for the queue's display line.
    expect(ko.raw?.records['Submission']?.[0]?.data['line_of_business']).toBe('cyber');
    // The trace is the triage query that knocked it out, and nothing else.
    expect(ko.queryTrace.length).toBeGreaterThan(0);
    expect(ko.queryTrace.every((e) => e.pass === 'triage')).toBe(true);

    const r = resultOf('SUB-1003');
    expect(r.evaluate.knockout).toBe(true);
    expect(r.evaluate.knockoutFactors).toContain('line_of_business');
    expect(r.verdict.verdict).toBe('DOES_NOT_FIT');
    expect(typeof r.explanation).toBe('string');
    // Knocked out on line of business, it ranks last.
    expect(ko.rank).toBe(5);
  });

  it('stores the Federato facts for every submission, knockouts included (FILL-backend D1)', async () => {
    await ingestFederato(deps, {});
    const subs = MINI_SNAPSHOT.records['Submission'];
    const name = (resource: 'Insured' | 'Broker' | 'Underwriter', id: unknown): unknown =>
      MINI_SNAPSHOT.records[resource].find((r) => r['id'] === id)?.['name'] ?? null;
    for (const externalId of ALL_IDS) {
      const facts = row(externalId).facts;
      expect(facts, externalId).not.toBeNull();
      const src = subs.find((s) => s['submission_number'] === externalId)!;
      expect(facts).toMatchObject({
        source: 'federato_triage',
        federatoId: src['id'],
        submissionNumber: externalId,
        insuredName: name('Insured', src['insured']),
        brokerName: name('Broker', src['broker']),
        underwriterName: name('Underwriter', src['underwriter']),
        lineOfBusiness: src['line_of_business'],
        status: src['status'],
        requestedLimit: src['requested_limit'],
        receivedDate: src['received_date'],
        targetEffectiveDate: src['target_effective_date'],
        declineReason: src['decline_reason'],
        competitor: src['competitor'],
      });
      // The facts point at the triage query that read them.
      expect(row(externalId).queryTrace.map((e) => e.id)).toContain(facts!.traceId);
    }
    // The cyber knockout is named by Federato's insured record...
    const ko = row('SUB-1003');
    expect(ko.facts!.lineOfBusiness).toBe('cyber');
    expect(ko.insuredName).toBe(ko.facts!.insuredName);
    expect(ko.insuredName).not.toBeNull();
    // ...but the engine still sees only the four knockout fields: nothing display-only is scored.
    expect(Object.keys(ko.raw!.records['Submission']![0]!.data).sort()).toEqual(
      ['id', 'line_of_business', 'status', 'submission_number'],
    );
  });

  it('backfills facts onto rows an idempotent re-ingest leaves alone, without re-scoring them', async () => {
    await ingestFederato(deps, {});
    const repos = createRepos(deps.db);
    for (const id of ALL_IDS) repos.submissions.update(row(id).id, { facts: null });
    const before = new Map(ALL_IDS.map((id) => [id, row(id).updatedAt]));
    const again = await ingestFederato(depsAt('2026-09-20T12:00:00.000Z'), {});
    expect(again.skipped).toBe(5);
    for (const id of ALL_IDS) {
      expect(row(id).facts?.submissionNumber).toBe(id);
      expect(row(id).updatedAt).toBe(before.get(id));
    }
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
    // SUB-1004 (no policy) is placed among the policy book on the reduced
    // vector -- requested limit, insured revenue, HQ state (PRD 6.4) -- and
    // every match is labelled coarse and is a policy account (R2-9).
    const noPolicy = resultOf('SUB-1004').peers!;
    expect(noPolicy.coarse).toBe(true);
    expect(noPolicy.peers.length).toBeGreaterThan(0);
    expect(noPolicy.peers.every((m) => m.coarse && m.quotedPremium !== null)).toBe(true);
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
    expect(again).toMatchObject({ ingested: 0, updated: 0, skipped: 5 });
    expect(rows()).toHaveLength(5);
    expect(row('SUB-1001').updatedAt).toBe(firstUpdated);
    expect(resultOf('SUB-1001')).toEqual(firstResult);

    const forced = await ingestFederato(later, { force: true });
    expect(forced).toMatchObject({ ingested: 0, updated: 5, skipped: 0 });
    expect(rows()).toHaveLength(5);
    expect(row('SUB-1001').updatedAt).toBe('2026-09-20T08:00:00.000Z');
    // Same data, same numbers: the re-run reproduces the score exactly.
    expect(resultOf('SUB-1001').evaluate.appetiteScore).toBe(firstResult.evaluate.appetiteScore);
  });

  it('ingests only the requested external ids and explains the ones it could not', async () => {
    const res = await ingestFederato(deps, { externalIds: ['SUB-1002', 'SUB-1003', 'SUB-9999'] });
    // SUB-1003 is a triage knockout: stored as out of appetite, and said so.
    expect(res.ingested).toBe(2);
    expect(res.externalIds).toEqual(['SUB-1002', 'SUB-1003']);
    expect(rows().map((r) => r.externalId).sort()).toEqual(['SUB-1002', 'SUB-1003']);
    expect(row('SUB-1002').rank).toBe(1);
    expect(resultOf('SUB-1003').verdict.verdict).toBe('DOES_NOT_FIT');
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
    expect(await rescoreBook(deps)).toBe(5);
    expect(rows().map((r) => r.rank).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
