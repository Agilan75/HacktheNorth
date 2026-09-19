/**
 * I1 — engine pipeline integration over the REAL committed Federato snapshot.
 *
 *   snapshot.json -> MockFederatoAdapter -> runPlanner (triage + deep + no-policy)
 *     -> discover -> normalize -> runEngine (vector pass, BookStats, full pass
 *     with peers) -> rank across the whole 38-account property book.
 *
 * Then the naive oracle (packages/verify/src/naive) is fed facts rolled up HERE,
 * straight from the committed hydrated JSON (policy-property-hydrated.json),
 * without touching the engine's rollup — so a discover/normalize/rollup defect
 * on real data shows up as an engine-vs-oracle disagreement, not a tautology.
 *
 * Expected numbers come from PRD 7.2 / 6.4 / 15 and LIVE_DATA_FACTS.md. When the
 * engine does not produce them, the assertion stays as the documents state it.
 * No network: the fetch guard in vitest.setup.ts would throw.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type {
  BookStats,
  CanonicalSubmission,
  EngineConfig,
  EngineResult,
  FeatureVector,
  PeerVectorEntry,
  RankedEntry,
  VectorSpec,
} from '@retrofit/engine';
import {
  LOSS_WINDOW_YEARS,
  computeBookStats,
  discover,
  math,
  normalize,
  rank,
  readRatingTable,
  readRulebook,
  readVectorSpec,
  reduceForCoarseMatch,
  runEngine,
} from '@retrofit/engine';
import type { PlannerResult } from '@retrofit/federato';
import { EXPECTED_COUNTS, createMockAdapter, loadSnapshot, runPlanner } from '@retrofit/federato';
import { naiveEvaluate } from '../../packages/verify/src/naive/index';
import type { NaiveInput, NaiveResult } from '../../packages/verify/src/types';
import { realCases } from '../../packages/engine/src/fixtures/real';

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const ROOT = new URL('../../', import.meta.url);
const HYDRATED = new URL('packages/federato/snapshot/policy-property-hydrated.json', ROOT);
const AS_OF = '2026-09-19';
const NOW_ISO = '2026-09-19T00:00:00.000Z';
const SCORE_TOLERANCE = 1e-6;

/* -------------------------------------------------------------------------- */
/* Raw hydrated rows (independent of the engine)                              */
/* -------------------------------------------------------------------------- */

interface RawBuilding {
  readonly id: number;
  readonly tiv: number | null;
  readonly year_built: number | null;
  readonly construction_type: string | null;
}
interface RawClaim {
  readonly date_of_loss: string | null;
  readonly paid_indemnity: number | null;
  readonly paid_expense: number | null;
  readonly reserve_indemnity: number | null;
  readonly reserve_expense: number | null;
}
interface RawPolicy {
  readonly id: number;
  readonly premium: number | null;
  readonly business_type: string | null;
  readonly line_of_business: string | null;
  readonly dates: { readonly submission_received: string | null };
  readonly submission: { readonly submission_number: string; readonly received_date: string | null };
  readonly claims: readonly RawClaim[];
  readonly exposure_units: readonly {
    readonly kind: string;
    readonly location: {
      readonly state: string | null;
      readonly protection_class: number | null;
      readonly buildings: readonly RawBuilding[];
    } | null;
  }[];
}

function hydratedPolicies(): RawPolicy[] {
  const doc = JSON.parse(readFileSync(HYDRATED, 'utf8')) as { results: RawPolicy[] };
  return doc.results;
}

/** Snake-cased construction classes counted as acceptable (INTERPRETATIONS 3.5 + I-3, LIVE_DATA_FACTS). */
const ACCEPTABLE_CONSTRUCTION = new Set([
  'joisted_masonry',
  'non_combustible',
  'steel',
  'steel_frame',
  'masonry_non_combustible',
  'fire_resistive',
  'modified_fire_resistive',
]);

const snake = (s: string): string => s.trim().toLowerCase().replace(/[\s\-_]+/g, '_');

function minusFiveYears(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const year = y - LOSS_WINDOW_YEARS;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const day = m === 2 && d === 29 && !leap ? 28 : d;
  return `${String(year).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** I-4, computed by hand: window [received - 5y, received], both ends inclusive. */
function fiveYearLoss(claims: readonly RawClaim[], received: string): number {
  const from = minusFiveYears(received);
  let total = 0;
  for (const c of claims) {
    if (c.date_of_loss === null) continue;
    if (c.date_of_loss < from || c.date_of_loss > received) continue;
    total +=
      (c.paid_indemnity ?? 0) + (c.paid_expense ?? 0) + (c.reserve_indemnity ?? 0) + (c.reserve_expense ?? 0);
  }
  return Math.max(0, total);
}

/** Component 10 by hand: TIV-weighted public protection class of each building's own location. */
function tivWeightedPc(p: RawPolicy): number | null {
  let num = 0;
  let den = 0;
  for (const eu of p.exposure_units) {
    const pc = eu.location?.protection_class;
    if (eu.location === null || typeof pc !== 'number') continue;
    for (const b of eu.location.buildings) {
      if (typeof b.tiv !== 'number') continue;
      num += b.tiv * pc;
      den += b.tiv;
    }
  }
  return den > 0 ? num / den : null;
}

interface IndependentRollup {
  readonly externalId: string;
  readonly naive: NaiveInput;
  readonly lossBySubmissionDate: number;
  readonly lossByPolicyDate: number;
}

/** Rolls one hydrated policy up to the naive oracle's input, from the raw JSON only. */
function independentRollup(p: RawPolicy): IndependentRollup {
  const buildings: { state: string | null; b: RawBuilding }[] = [];
  for (const eu of p.exposure_units) {
    if (eu.location === null) continue;
    for (const b of eu.location.buildings) buildings.push({ state: eu.location.state, b });
  }
  const knownTiv = buildings.filter((x) => typeof x.b.tiv === 'number' && Number.isFinite(x.b.tiv));
  const totalTiv = knownTiv.reduce((s, x) => s + (x.b.tiv as number), 0);

  const byState = new Map<string, number>();
  for (const x of knownTiv) {
    if (x.state === null || x.state.trim() === '') continue;
    const st = x.state.trim().toUpperCase();
    byState.set(st, (byState.get(st) ?? 0) + (x.b.tiv as number));
  }
  const primaryState =
    [...byState.entries()].sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0] < b[0] ? -1 : 1))[0]?.[0] ?? null;

  const aged = knownTiv.filter((x) => typeof x.b.year_built === 'number');
  const agedTiv = aged.reduce((s, x) => s + (x.b.tiv as number), 0);
  const pre = aged.filter((x) => Math.floor(x.b.year_built as number) < 1990).reduce((s, x) => s + (x.b.tiv as number), 0);
  const post = aged.filter((x) => Math.floor(x.b.year_built as number) >= 2010).reduce((s, x) => s + (x.b.tiv as number), 0);
  const acceptable = knownTiv
    .filter((x) => x.b.construction_type !== null && ACCEPTABLE_CONSTRUCTION.has(snake(x.b.construction_type)))
    .reduce((s, x) => s + (x.b.tiv as number), 0);

  const subDate = p.submission.received_date as string;
  const polDate = p.dates.submission_received as string;
  const lossBySubmissionDate = fiveYearLoss(p.claims, subDate);
  const lossByPolicyDate = fiveYearLoss(p.claims, polDate);

  return {
    externalId: p.submission.submission_number,
    lossBySubmissionDate,
    lossByPolicyDate,
    naive: {
      submissionType: p.business_type,
      // The Federato line code "property" is the canonical commercial_property line.
      lineOfBusiness: p.line_of_business === 'property' ? 'commercial_property' : p.line_of_business,
      primaryState,
      totalTiv: knownTiv.length === 0 ? null : totalTiv,
      quotedPremium: p.premium,
      pctTivPre1990: agedTiv > 0 ? pre / agedTiv : null,
      pctTivPost2010: agedTiv > 0 ? post / agedTiv : null,
      pctTivAcceptableConstruction: totalTiv > 0 ? acceptable / totalTiv : null,
      // Zero claims in the window is a KNOWN 0 (I-4, W0-2.8): the deep query expanded claims.
      fiveYearLoss: lossBySubmissionDate,
      anyBuildingPre1990: buildings.some(
        (x) => typeof x.b.year_built === 'number' && Math.floor(x.b.year_built) < 1990,
      ),
      // Two raw received dates that disagree are a contradiction, but it is HIGH
      // only when material: when the loss-value tier differs between the two
      // windows (DECISIONS R2-4). Computed here from this file's own rollup,
      // never from the engine's output, so the oracle's input stays independent.
      hasOpenHighContradiction:
        subDate !== polDate &&
        (lossBySubmissionDate <= 100_000) !== (lossByPolicyDate <= 100_000),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The book, run the way apps/api/src/services/rescore.ts runs it             */
/* -------------------------------------------------------------------------- */

interface Book {
  readonly planned: PlannerResult;
  readonly spec: VectorSpec;
  readonly config: EngineConfig;
  readonly canonicals: readonly CanonicalSubmission[];
  readonly vectors: readonly FeatureVector[];
  readonly bookStats: BookStats;
  readonly results: ReadonlyMap<string, EngineResult>;
  readonly ranked: readonly RankedEntry[];
}

function indexOfKey(spec: VectorSpec, key: string): number {
  const c = spec.components.find((x) => x.key === key);
  if (c === undefined) throw new Error(`no component ${key}`);
  return c.index;
}

function knownNumber(v: FeatureVector, i: number): number | null {
  const x = v.x[i];
  return v.m[i] === 1 && typeof x === 'number' && Number.isFinite(x) ? x : null;
}

function peerEntry(id: string, vector: FeatureVector, spec: VectorSpec): PeerVectorEntry {
  const tiv = knownNumber(vector, indexOfKey(spec, 'totalTiv'));
  const premium = knownNumber(vector, indexOfKey(spec, 'quotedPremium'));
  const loss = knownNumber(vector, indexOfKey(spec, 'fiveYearLoss'));
  const coarse = premium === null;
  return {
    id,
    vector: coarse ? reduceForCoarseMatch(vector, spec) : vector,
    totalTiv: tiv,
    quotedPremium: premium,
    ratePer100: tiv === null || premium === null ? null : math.safeDiv(premium, tiv / 100),
    annualLoss: loss === null ? null : loss / LOSS_WINDOW_YEARS,
    coarse,
  };
}

let book: Book;

beforeAll(async () => {
  const snapshot = loadSnapshot();
  const adapter = createMockAdapter({ snapshot });
  const [spec, rulebook, extensions, ratingTable] = await Promise.all([
    readVectorSpec('commercial_property'),
    readRulebook('commercial'),
    readRulebook('extensions'),
    readRatingTable('commercial_property'),
  ]);
  const planned = await runPlanner({
    adapter,
    spec,
    rulebook,
    extensions,
    ratingTable,
    options: { now: NOW_ISO, clock: () => 0, lineOfBusiness: 'commercial_property', skipFollowUps: true },
  });

  const canonicals = planned.bundles.map((bundle) => {
    const fieldMap = discover(bundle, planned.schema, spec);
    return { ...normalize(bundle, fieldMap, 'commercial_property'), id: bundle.externalId };
  });

  const config: EngineConfig = { spec, rulebook, extensions, ratingTable, bookStats: null, questions: [] };
  const vectors = canonicals.map((c) => runEngine({ submission: c, asOf: AS_OF }, config).vector);
  const bookStats = computeBookStats(vectors, spec);
  const entries = canonicals.map((c, i) => peerEntry(c.id, vectors[i] as FeatureVector, spec));

  const results = new Map<string, EngineResult>();
  canonicals.forEach((c, i) => {
    const peerVectors = entries.filter((_, j) => j !== i);
    results.set(c.id, runEngine({ submission: c, asOf: AS_OF, peerVectors }, { ...config, bookStats }));
  });

  book = { planned, spec, config, canonicals, vectors, bookStats, results, ranked: rank([...results.values()]) };
}, 60_000);

const policyIds = (): string[] =>
  hydratedPolicies()
    .map((p) => p.submission.submission_number)
    .sort();
const policyResults = (): EngineResult[] => policyIds().map((id) => book.results.get(id) as EngineResult);
const noPolicyResults = (): EngineResult[] => {
  const withPolicy = new Set(policyIds());
  return [...book.results.values()].filter((r) => !withPolicy.has(r.id));
};

/* -------------------------------------------------------------------------- */
/* 1. The book the planner builds (PRD 7.2, 7.5; LIVE_DATA_FACTS)             */
/* -------------------------------------------------------------------------- */

describe('snapshot -> planner: the 38-account property book', () => {
  it('the committed snapshot holds exactly the measured record counts', () => {
    const snapshot = loadSnapshot();
    expect(snapshot.counts).toEqual(EXPECTED_COUNTS);
  });

  it('triage sees 158 submissions and knocks 120 out on line of business (PRD 7.5 step 4)', () => {
    expect(book.planned.counts.submissionsSeen).toBe(158);
    expect(book.planned.counts.knockedOut).toBe(120);
    expect(book.planned.counts.survivors).toBe(38);
  });

  it('38 property submissions become 38 bundles: 27 hydrated by the deep pass, 11 with no policy', () => {
    expect(book.planned.bundles).toHaveLength(38);
    expect(new Set(book.planned.bundles.map((b) => b.externalId)).size).toBe(38);
    expect(book.planned.counts.deepHydrated).toBe(27);
    expect(book.planned.counts.noPolicy).toBe(11);
    expect(policyResults()).toHaveLength(27);
    expect(noPolicyResults()).toHaveLength(11);
  });

  it('the 11 no-policy submissions are 4 lost, 3 cleared, 3 quoted, 1 declined (PRD 7.2)', () => {
    const snapshot = loadSnapshot();
    const byStatus: Record<string, number> = {};
    const ids = new Set(noPolicyResults().map((r) => r.id));
    for (const s of snapshot.records.Submission) {
      if (!ids.has(String(s['submission_number']))) continue;
      const st = String(s['status']);
      byStatus[st] = (byStatus[st] ?? 0) + 1;
    }
    expect(byStatus).toEqual({ lost: 4, cleared: 3, quoted: 3, declined: 1 });
  });

  it('the planner path and the committed hydrated file give the same vector for every account', () => {
    const cases = realCases();
    expect(cases).toHaveLength(38);
    for (const c of cases) {
      const i = book.canonicals.findIndex((x) => x.id === c.externalId);
      expect(i, c.externalId).toBeGreaterThanOrEqual(0);
      const fromFile = runEngine({ submission: c.submission, asOf: AS_OF }, book.config).vector;
      expect(fromFile.x, c.externalId).toEqual((book.vectors[i] as FeatureVector).x);
      expect(fromFile.m, c.externalId).toEqual((book.vectors[i] as FeatureVector).m);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* 2. Vectors, completeness and verdicts (PRD 6.4, 6.5, 7.2, 15)              */
/* -------------------------------------------------------------------------- */

describe('runEngine over the real book', () => {
  it('all 27 accounts with a policy carry a FULL vector: every required component known, completeness 100', () => {
    const partial = policyResults()
      .filter((r) => r.evaluate.completeness !== 100)
      .map((r) => `${r.id} completeness=${r.evaluate.completeness.toFixed(1)} missing=${r.verdict.missingComponentKeys.join(',')}`);
    expect(partial).toEqual([]);
  });

  it('the 11 without a policy resolve to REFER for missing data, never a knockout', () => {
    for (const r of noPolicyResults()) {
      expect(r.verdict.verdict, r.id).toBe('REFER');
      expect(r.evaluate.knockout, r.id).toBe(false);
      expect(r.evaluate.completeness, r.id).toBeLessThan(100);
      // PRD 7.2: they lack premium, business type and buildings.
      expect(r.verdict.missingComponentKeys, r.id).toEqual(
        expect.arrayContaining(['quotedPremium', 'isNewBusiness', 'totalTiv']),
      );
    }
  });

  it('every result is finite and deterministic (same input, same output)', () => {
    for (const r of book.results.values()) {
      expect(Number.isFinite(r.evaluate.appetiteScore), r.id).toBe(true);
      expect(r.evaluate.appetiteScore).toBeGreaterThanOrEqual(0);
      expect(r.evaluate.appetiteScore).toBeLessThanOrEqual(100);
      expect(Number.isFinite(r.qualityIndex), r.id).toBe(true);
      expect(r.verdict.decidingRule?.citation.quote, r.id).toBeTruthy();
    }
    for (const c of book.canonicals) {
      const again = runEngine({ submission: c, asOf: AS_OF }, { ...book.config, bookStats: book.bookStats });
      const first = runEngine({ submission: c, asOf: AS_OF }, { ...book.config, bookStats: book.bookStats });
      expect(JSON.stringify(again), c.id).toBe(JSON.stringify(first));
    }
  });
});

/* -------------------------------------------------------------------------- */
/* 3. The book behaves as measured (LIVE_DATA_FACTS, PRD 7.2)                 */
/* -------------------------------------------------------------------------- */

describe('the real book, as LIVE_DATA_FACTS measured it', () => {
  const premiumOf = (r: EngineResult): number | null =>
    knownNumber(r.vector, indexOfKey(book.spec, 'quotedPremium'));

  it('premiums: min 45,900, max 703,500, subtotal 6,690,900', () => {
    const p = policyResults().map((r) => premiumOf(r) as number);
    expect(p.every((x) => Number.isFinite(x))).toBe(true);
    expect(Math.min(...p)).toBe(45_900);
    expect(Math.max(...p)).toBe(703_500);
    expect(p.reduce((s, x) => s + x, 0)).toBe(6_690_900);
  });

  it('17 of 27 are over the $175K ceiling, 2 under $50K, 8 in band, 3 in the $75K-$100K target band', () => {
    const p = policyResults().map((r) => premiumOf(r) as number);
    expect(p.filter((x) => x > 175_000)).toHaveLength(17);
    expect(p.filter((x) => x < 50_000)).toHaveLength(2);
    expect(p.filter((x) => x >= 50_000 && x <= 175_000)).toHaveLength(8);
    expect(p.filter((x) => x >= 75_000 && x <= 100_000)).toHaveLength(3);
  });

  it('the engine knocks out on premium exactly the 19 accounts outside $50K-$175K', () => {
    const ko = policyResults().filter((r) => r.evaluate.knockoutFactors.includes('total_premium'));
    expect(ko).toHaveLength(19);
  });

  it('20 new business / 7 renewal, and every renewal is knocked out on submission type', () => {
    const idx = indexOfKey(book.spec, 'isNewBusiness');
    const rs = policyResults();
    expect(rs.filter((r) => knownNumber(r.vector, idx) === 1)).toHaveLength(20);
    const renewals = rs.filter((r) => knownNumber(r.vector, idx) === 0);
    expect(renewals).toHaveLength(7);
    for (const r of renewals) expect(r.evaluate.knockoutFactors, r.id).toContain('submission_type');
  });

  it('only 4 accounts pass new business + premium + TIV together (PRD 7.2)', () => {
    const passing = policyResults().filter(
      (r) =>
        !r.evaluate.knockoutFactors.includes('submission_type') &&
        !r.evaluate.knockoutFactors.includes('total_premium') &&
        !r.evaluate.knockoutFactors.includes('tiv'),
    );
    expect(passing.map((r) => r.id).sort()).toHaveLength(4);
  });

  it('most of the 27 include a pre-1990 building (PRD 7.2; 71 of 129 buildings are pre-1990)', () => {
    const withPre = policyResults().filter((r) => r.rollup.pre1990BuildingIds.length > 0);
    expect(withPre.length).toBeGreaterThan(27 / 2);
  });
});

/* -------------------------------------------------------------------------- */
/* 4. Layer B on real accounts: engine vs the naive oracle                    */
/* -------------------------------------------------------------------------- */

describe('engine vs naive oracle on the 27 real accounts (facts rolled up independently)', () => {
  const pairs = (): { id: string; input: NaiveInput; naive: NaiveResult; engine: EngineResult }[] =>
    hydratedPolicies()
      .map(independentRollup)
      .sort((a, b) => a.externalId.localeCompare(b.externalId))
      .map((x) => ({
        id: x.externalId,
        input: x.naive,
        naive: naiveEvaluate(x.naive),
        engine: book.results.get(x.externalId) as EngineResult,
      }));

  it('the rolled-up inputs match the engine vector component by component', () => {
    const s = book.spec;
    const diffs: string[] = [];
    const pcById = new Map(hydratedPolicies().map((p) => [p.submission.submission_number, tivWeightedPc(p)]));
    for (const { id, input, engine } of pairs()) {
      const check = (key: string, want: number | null): void => {
        const got = knownNumber(engine.vector, indexOfKey(s, key));
        const same = want === null ? got === null : got !== null && Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want));
        if (!same) diffs.push(`${id} ${key}: engine=${String(got)} independent=${String(want)}`);
      };
      check('totalTiv', input.totalTiv);
      check('quotedPremium', input.quotedPremium);
      check('pctTivPre1990', input.pctTivPre1990);
      check('pctTivPost2010', input.pctTivPost2010);
      check('pctTivAcceptableConstruction', input.pctTivAcceptableConstruction);
      check('fiveYearLoss', input.fiveYearLoss);
      if (engine.rollup.primaryState !== input.primaryState) {
        diffs.push(`${id} primaryState: engine=${String(engine.rollup.primaryState)} independent=${String(input.primaryState)}`);
      }
      check('tivWeightedProtectionClass', pcById.get(id) ?? null);
    }
    expect(diffs).toEqual([]);
  });

  it('agree on appetiteScore, verdict, knockouts and decidingFactorId for every account', () => {
    const disagreements: string[] = [];
    for (const { id, naive, engine } of pairs()) {
      if (Math.abs(engine.evaluate.appetiteScore - naive.appetiteScore) > SCORE_TOLERANCE) {
        disagreements.push(`${id} appetiteScore engine=${engine.evaluate.appetiteScore} naive=${naive.appetiteScore}`);
      }
      if (engine.verdict.verdict !== naive.verdict) {
        disagreements.push(`${id} verdict engine=${engine.verdict.verdict} naive=${naive.verdict}`);
      }
      const ek = [...engine.evaluate.knockoutFactors].sort().join(',');
      const nk = [...naive.knockoutFactorIds].sort().join(',');
      if (ek !== nk) disagreements.push(`${id} knockouts engine=[${ek}] naive=[${nk}]`);
      const ed = engine.verdict.decidingRule === null ? null : String(engine.verdict.decidingRule.factor);
      if (ed !== naive.decidingFactorId) {
        disagreements.push(`${id} decidingFactorId engine=${String(ed)} naive=${String(naive.decidingFactorId)}`);
      }
    }
    expect(disagreements).toEqual([]);
  });

  it('measured: no claim on any of the 27 policies falls inside its five-year window, under either received date', () => {
    const rolled = hydratedPolicies().map(independentRollup);
    const claimCount = hydratedPolicies().reduce((s, p) => s + p.claims.length, 0);
    expect(claimCount).toBe(33);
    expect(rolled.every((r) => r.lossBySubmissionDate === 0 && r.lossByPolicyDate === 0)).toBe(true);
    // So the receivedDate conflict can never change the loss factor on this data:
    // every one of the 27 is immaterial, and none is a HIGH contradiction (R2-4).
    expect(rolled.every((r) => !r.naive.hasOpenHighContradiction)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* 5. Peers and rank across the whole book (PRD 6.4, 6.8; P-1..P-6)           */
/* -------------------------------------------------------------------------- */

describe('peers and rank across the book', () => {
  it('every policy account gets k=5 peers from the rest of the book, never itself, distances in [0, 1]', () => {
    for (const r of policyResults()) {
      const p = r.peers;
      expect(p, r.id).not.toBeNull();
      if (p === null) continue;
      expect(p.peers, r.id).toHaveLength(5);
      for (const m of p.peers) {
        expect(m.id).not.toBe(r.id);
        expect(Number.isFinite(m.distance)).toBe(true);
        expect(m.distance).toBeGreaterThanOrEqual(0);
        expect(m.distance).toBeLessThanOrEqual(1);
      }
      const d = p.peers.map((m) => m.distance);
      expect(d).toEqual([...d].sort((a, b) => a - b));
      expect(p.medianRatePer100 === null || Number.isFinite(p.medianRatePer100)).toBe(true);
    }
  });

  it('the 11 without a policy are still placed among peers, labelled as a coarse match (PRD 6.4)', () => {
    const unplaced = noPolicyResults()
      .filter((r) => r.peers === null || r.peers.peers.length === 0 || !r.peers.coarse)
      .map((r) => r.id);
    expect(unplaced).toEqual([]);
  });

  it('rank orders all 38 accounts 1..38 with every knockout below every non-knockout (P-6)', () => {
    const ranked = book.ranked;
    expect(ranked).toHaveLength(38);
    expect(ranked.map((e) => e.rank)).toEqual(Array.from({ length: 38 }, (_, i) => i + 1));
    const lastClean = Math.max(...ranked.filter((e) => !e.knockout).map((e) => e.rank));
    const firstKo = Math.min(...ranked.filter((e) => e.knockout).map((e) => e.rank));
    expect(lastClean).toBeLessThan(firstKo);
    expect(ranked.filter((e) => e.knockout)).toHaveLength(26);
    for (const e of ranked) {
      expect(Number.isFinite(e.qualityIndex), e.id).toBe(true);
      expect(e.qualityIndex).toBeGreaterThanOrEqual(0);
      expect(e.qualityIndex).toBeLessThanOrEqual(100);
    }
  });

  it('the one account with no knockout ranks first and is FIT: its receivedDate conflict is shown but immaterial', () => {
    const top = book.ranked[0] as RankedEntry;
    expect(top.id).toBe('SUB-2026-00081');
    const r = book.results.get(top.id) as EngineResult;
    expect(r.evaluate.knockout).toBe(false);
    expect(r.evaluate.completeness).toBe(100);
    expect(r.rollup.pre1990BuildingIds).toEqual([]);
    // The two received dates disagree (2025-12-29 vs 2025-12-13) and the conflict
    // is still reported -- as LOW, because the five-year loss is $0 under both
    // dates, the same loss-value tier either way (R2-4). So nothing blocks FIT.
    const dateConflict = r.contradictions.find((c) => c.canonicalPath === 'receivedDate');
    expect(dateConflict?.severity).toBe('LOW');
    expect(dateConflict?.note).toContain('immaterial');
    expect(r.verdict.openHighContradictionIds).toEqual([]);
    expect(r.verdict.verdict).toBe('FIT');
  });
});
