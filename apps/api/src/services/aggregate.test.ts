import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aggregateResponseSchema } from '@retrofit/contracts';
import type { EngineResult, LineOfBusiness, Verdict } from '@retrofit/engine';
import type { FederatoAdapter } from '@retrofit/federato';
import { createDb } from '../db/client';
import type { DbHandle } from '../db/client';
import { migrate } from '../db/migrate';
import { createRepos } from '../db/repos';
import { createFakeLlm } from '../llm/fake-provider';
import { aggregate } from './aggregate';
import { fixedClock } from './types';
import type { Deps } from './types';

/* summary.json lives outside this unit; the file read is stubbed per test. */
const readFileMock = vi.hoisted(() => vi.fn());
vi.mock('node:fs/promises', async (orig) => ({
  ...(await orig<typeof import('node:fs/promises')>()),
  readFile: readFileMock,
}));

const adapter: FederatoAdapter = {
  kind: 'mock',
  getSchema: () => Promise.reject(new Error('unused')),
  query: () => Promise.reject(new Error('unused')),
  getGuidelines: () => Promise.reject(new Error('unused')),
  getGlossary: () => Promise.reject(new Error('unused')),
};

interface Spec {
  readonly id: string;
  readonly line?: LineOfBusiness;
  readonly verdict: Verdict;
  readonly score: number;
  readonly knockouts?: readonly string[];
  readonly adequacy?: number | null;
  readonly flip?: { readonly label: string; readonly scoreAfter: number; readonly premiumAfter: number | null; readonly moves?: number };
  readonly rank?: number | null;
  readonly unscored?: boolean;
}

/** Only the fields the aggregate reads; the rest of an EngineResult is irrelevant here. */
function fakeResult(s: Spec): EngineResult {
  const moves = s.flip
    ? Array.from({ length: s.flip.moves ?? 1 }, (_, i) => ({ componentKey: `k${i}`, label: i === 0 ? s.flip!.label : `second ${i}` }))
    : [];
  return {
    id: s.id,
    lineOfBusiness: s.line ?? 'commercial_property',
    evaluate: {
      appetiteScore: s.score,
      knockout: (s.knockouts ?? []).length > 0,
      knockoutFactors: s.knockouts ?? [],
    },
    verdict: {
      verdict: s.verdict,
      distanceToAppetite: s.verdict === 'FIT' ? 0 : s.flip ? moves.length : null,
    },
    flip: {
      flip: s.flip
        ? { moves, scoreBefore: s.score, scoreAfter: s.flip.scoreAfter, premiumBefore: null, premiumAfter: s.flip.premiumAfter, verdictAfter: 'FIT', distanceScaled: 0.1 }
        : null,
      reason: s.flip ? null : 'none',
      blockedByImmovable: [],
    },
    price: { adequacy: s.adequacy ?? null },
  } as unknown as EngineResult;
}

let handle: DbHandle;
let deps: Deps;

function seed(specs: readonly Spec[]): void {
  const repos = createRepos(deps.db);
  for (const s of specs) {
    repos.submissions.upsertByExternalId({
      id: s.id,
      source: 'federato',
      lineOfBusiness: s.line ?? 'commercial_property',
      externalId: `EXT-${s.id}`,
      insuredName: s.id === 'a' ? 'Acme Mills' : null,
      raw: null,
      canonical: null,
      result: s.unscored ? null : fakeResult(s),
      rank: s.rank ?? null,
      createdAt: '2026-09-19T12:00:00.000Z',
      updatedAt: '2026-09-19T12:00:00.000Z',
    });
  }
}

const enoent = Object.assign(new Error('no such file'), { code: 'ENOENT' });

beforeEach(() => {
  readFileMock.mockReset();
  readFileMock.mockRejectedValue(enoent);
  handle = createDb({ url: ':memory:' });
  migrate(handle);
  deps = { db: handle.db, adapter, llm: createFakeLlm(), clock: fixedClock('2026-09-19T12:00:00.000Z') };
});

afterEach(() => handle.close());

describe('aggregate', () => {
  it('is all zeros and null verification on an empty book with no verify run', async () => {
    const out = aggregateResponseSchema.parse(await aggregate(deps));
    expect(out.counts).toEqual({ total: 0, byVerdict: { FIT: 0, REFER: 0, DOES_NOT_FIT: 0 }, byLine: {}, scored: 0, knockedOut: 0 });
    expect(out.scoreHistogram).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(out.topKnockoutFactors).toEqual([]);
    expect(out.oneFlipAway).toEqual([]);
    expect(out.bookAdequacy).toEqual({ median: null, underpricedCount: 0, n: 0 });
    expect(out.verification).toBeNull();
  });

  it('counts, buckets, ranks knockouts, lists one-flip accounts and computes book adequacy', async () => {
    seed([
      { id: 'a', verdict: 'REFER', score: 68.5, adequacy: 0.85, rank: 3, flip: { label: 'Sprinkler Building B', scoreAfter: 74.5, premiumAfter: 91_000 } },
      { id: 'b', verdict: 'REFER', score: 72, adequacy: 1.05, rank: 1, flip: { label: 'Year built for Building C', scoreAfter: 80, premiumAfter: null } },
      { id: 'c', verdict: 'REFER', score: 60, adequacy: 0.9, rank: 2, flip: { label: 'two moves', scoreAfter: 81, premiumAfter: null, moves: 2 } },
      { id: 'd', verdict: 'FIT', score: 100, adequacy: 1.2, rank: 0 },
      { id: 'e', verdict: 'DOES_NOT_FIT', score: 9.99, knockouts: ['tiv', 'primary_risk_state'], adequacy: 0.5 },
      { id: 'f', verdict: 'DOES_NOT_FIT', score: 40, knockouts: ['primary_risk_state'] },
      { id: 'g', verdict: 'DOES_NOT_FIT', score: 0, knockouts: ['line_of_business'], line: 'tenant', adequacy: 0.1 },
      { id: 'h', verdict: 'REFER', score: 55, unscored: true },
    ]);

    const out = aggregateResponseSchema.parse(await aggregate(deps));

    expect(out.counts).toEqual({
      total: 8,
      byVerdict: { FIT: 1, REFER: 3, DOES_NOT_FIT: 3 },
      byLine: { commercial_property: 7, tenant: 1 },
      scored: 7,
      knockedOut: 3,
    });
    // 0, 9.99 -> [0]; 40 -> [4]; 60 -> [6]; 68.5 -> [6]; 72 -> [7]; 100 -> [9]
    expect(out.scoreHistogram).toEqual([2, 0, 0, 0, 1, 0, 2, 1, 0, 1]);
    expect(out.scoreHistogram.reduce((x, y) => x + y, 0)).toBe(out.counts.scored);

    // Count desc, ties in AG p2 row order (line_of_business before tiv).
    expect(out.topKnockoutFactors).toEqual([
      { factor: 'primary_risk_state', label: 'Primary risk state', count: 2 },
      { factor: 'line_of_business', label: 'Line of business', count: 1 },
      { factor: 'tiv', label: 'TIV (Total Insured Value)', count: 1 },
    ]);

    // Exactly one move to FIT, ordered by queue rank; the two-move flip is excluded.
    expect(out.oneFlipAway).toEqual([
      { id: 'b', externalId: 'EXT-b', insuredName: null, appetiteScore: 72, moveLabel: 'Year built for Building C', scoreAfter: 80, premiumAfter: null },
      { id: 'a', externalId: 'EXT-a', insuredName: 'Acme Mills', appetiteScore: 68.5, moveLabel: 'Sprinkler Building B', scoreAfter: 74.5, premiumAfter: 91_000 },
    ]);

    // Commercial only: 0.5, 0.85, 0.9, 1.05, 1.2 -> median 0.9; under 0.9 (strict) = 2.
    expect(out.bookAdequacy).toEqual({ median: 0.9, underpricedCount: 2, n: 5 });
  });

  it('passes the summary.json verification fields through and drops the extra detail', async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({
        propertyCasesRun: 10_000_000,
        differentialCasesRun: 10_000_000,
        disagreements: 0,
        llmCasesRun: 2000,
        llmAgreementRate: 0.968,
        llmAgreementCi95: [0.9594, 0.9748],
        extractionFieldAccuracy: null,
        generatedAt: '2026-09-18T22:14:03.000Z',
        seed: 42,
        layerC: { total: 2000 },
      }),
    );
    const out = aggregateResponseSchema.parse(await aggregate(deps));
    expect(out.verification).toEqual({
      propertyCasesRun: 10_000_000,
      differentialCasesRun: 10_000_000,
      disagreements: 0,
      llmCasesRun: 2000,
      llmAgreementRate: 0.968,
      llmAgreementCi95: [0.9594, 0.9748],
      extractionFieldAccuracy: null,
      generatedAt: '2026-09-18T22:14:03.000Z',
    });
    expect(String(readFileMock.mock.calls[0]?.[0])).toMatch(/packages[\\/]verify[\\/]out[\\/]summary\.json$/);
  });

  it('throws on a summary.json that is corrupt or missing DTO fields', async () => {
    readFileMock.mockResolvedValue('{not json');
    await expect(aggregate(deps)).rejects.toThrow(/not valid JSON/);
    readFileMock.mockResolvedValue(JSON.stringify({ propertyCasesRun: 5 }));
    await expect(aggregate(deps)).rejects.toThrow(/missing verification fields/);
  });
});
