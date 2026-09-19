/**
 * Stage 12 tests (unit E10). Numbers fixed by INTERPRETATIONS P-1..P-4 and §6
 * scaling; the coarse match by PRD 6.5 and docs/decisions/E10.md.
 */
import { describe, expect, it } from 'vitest';
import type {
  BookStats,
  CanonicalSubmission,
  FeatureVector,
  PeerVectorEntry,
  VectorComponentSpec,
  VectorSpec,
} from '../types.js';
import { K_PEERS, SCORE_TOLERANCE } from '../constants.js';
import { peers, reduceForCoarseMatch } from './peers.js';

function c(index: number, key: string, scaling: VectorComponentSpec['scaling']): VectorComponentSpec {
  return {
    index,
    key,
    label: key,
    source: key,
    type: 'ratio',
    scaling,
    direction: 'higher_better',
    appetiteFactor: false,
    factor: null,
    extensionOnly: false,
    immovable: false,
    required: true,
  };
}

/** Mirrors packages/engine/vectors/commercial.json (keys, order, scaling). */
const SPEC: VectorSpec = {
  lineOfBusiness: 'commercial_property',
  version: '1.0.0',
  components: [
    c(0, 'isNewBusiness', { rule: 'none' }),
    c(1, 'isPropertyLine', { rule: 'none' }),
    c(2, 'stateTier', { rule: 'divide', divisor: 2 }),
    c(3, 'totalTiv', { rule: 'log_minmax' }),
    c(4, 'quotedPremium', { rule: 'log_minmax' }),
    c(5, 'pctTivPre1990', { rule: 'none' }),
    c(6, 'pctTivPost2010', { rule: 'none' }),
    c(7, 'pctTivAcceptableConstruction', { rule: 'none' }),
    c(8, 'fiveYearLoss', { rule: 'log1p_minmax' }),
    c(9, 'pctTivSprinklered', { rule: 'none' }),
    c(10, 'tivWeightedProtectionClass', { rule: 'divide', divisor: 10 }),
  ],
};

/** TIV scaled over ln(1e6)..ln(1e8), so 1e6 -> 0, 1e7 -> 0.5, 1e8 -> 1. */
const STATS: BookStats = {
  lineOfBusiness: 'commercial_property',
  specVersion: '1.0.0',
  n: 10,
  components: [
    { index: 3, key: 'totalTiv', min: Math.log(1e6), max: Math.log(1e8), mean: 0, median: 0, count: 10 },
  ],
  medianRatePer100: null,
  meanAnnualLoss: null,
  meanClaimFrequency: null,
  meanClaimSeverity: null,
};

function vec(values: Partial<Record<number, number>>): FeatureVector {
  const x: (number | null)[] = [];
  const m: (0 | 1)[] = [];
  for (let i = 0; i < 11; i += 1) {
    const v = values[i];
    x.push(v === undefined ? null : v);
    m.push(v === undefined ? 0 : 1);
  }
  return { lineOfBusiness: 'commercial_property', specVersion: '1.0.0', x, t: x.map(() => null), m };
}

function entry(
  id: string,
  values: Partial<Record<number, number>>,
  extra: Partial<PeerVectorEntry> = {},
): PeerVectorEntry {
  return {
    id,
    vector: vec(values),
    totalTiv: null,
    quotedPremium: null,
    ratePer100: null,
    annualLoss: null,
    coarse: false,
    ...extra,
  };
}

const FULL = { 0: 1, 1: 1, 2: 2, 3: 1e7, 4: 5e4, 5: 0.5, 6: 0.2, 7: 0.5, 9: 0.5, 10: 3 };

describe('peers — distance (P-1)', () => {
  it('ignores components 0 and 1', () => {
    const r = peers(vec(FULL), SPEC, [entry('a', { ...FULL, 0: 0, 1: 0 })], STATS);
    expect(r.peers).toHaveLength(1);
    expect(r.peers[0]!.distance).toBe(0);
    expect(r.componentsUsed).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(r.coarse).toBe(false);
  });

  it('is sqrt(sum of squared scaled differences / nCompared) over both-present components', () => {
    const self = vec({ 5: 0.5, 7: 0.5, 9: 0.1 });
    const cand = entry('a', { 5: 0.2, 7: 0.9 }); // 9 missing on the candidate
    const r = peers(self, SPEC, [cand], STATS);
    expect(r.peers[0]!.comparedComponents).toBe(2);
    expect(Math.abs(r.peers[0]!.distance - Math.sqrt((0.09 + 0.16) / 2))).toBeLessThan(SCORE_TOLERANCE);
  });

  it('scales before comparing (divide and log_minmax)', () => {
    const self = vec({ 2: 2, 3: 1e7, 5: 0.1 });
    // stateTier 0 vs 2 -> 0 vs 1; TIV 1e8 vs 1e7 -> 1 vs 0.5; pct equal.
    const r = peers(self, SPEC, [entry('a', { 2: 0, 3: 1e8, 5: 0.1 })], STATS);
    expect(r.peers[0]!.distance).toBeCloseTo(Math.sqrt((1 + 0.25 + 0) / 3), 9);
  });

  it('drops a pair with nothing compared', () => {
    const r = peers(vec({ 5: 0.5 }), SPEC, [entry('a', { 6: 0.5 })], STATS);
    expect(r.peers).toHaveLength(0);
    expect(r.medianRatePer100).toBeNull();
    expect(r.meanAnnualLoss).toBeNull();
  });
});

describe('peers — k, ties, aggregates (P-2..P-4)', () => {
  it('returns the k nearest, ties broken by ascending id', () => {
    const self = vec({ 5: 0 });
    const cands = [
      entry('g', { 5: 0.6 }),
      entry('b', { 5: 0.1 }),
      entry('a', { 5: 0.1 }),
      entry('f', { 5: 0.5 }),
      entry('e', { 5: 0.4 }),
      entry('d', { 5: 0.3 }),
      entry('c', { 5: 0.2 }),
    ];
    const r = peers(self, SPEC, cands, STATS);
    expect(r.k).toBe(K_PEERS);
    expect(r.peers.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('returns what exists when fewer than k candidates', () => {
    const r = peers(vec({ 5: 0 }), SPEC, [entry('a', { 5: 0.1 }), entry('b', { 5: 0.2 })], STATS);
    expect(r.peers).toHaveLength(2);
  });

  it('peer rate is the median, peer loss is the mean', () => {
    const self = vec({ 5: 0 });
    const cands = [
      entry('a', { 5: 0.1 }, { ratePer100: 0.3, annualLoss: 10_000 }),
      entry('b', { 5: 0.2 }, { ratePer100: 0.5, annualLoss: 20_000 }),
      entry('c', { 5: 0.3 }, { ratePer100: 0.4, annualLoss: 60_000 }),
      entry('d', { 5: 0.4 }, { ratePer100: 0.9, annualLoss: null }),
    ];
    const r = peers(self, SPEC, cands, STATS);
    expect(r.medianRatePer100).toBeCloseTo(0.45, 12); // (0.4 + 0.5) / 2
    expect(r.meanAnnualLoss).toBeCloseTo(30_000, 9); // null dropped
  });

  it('honours an explicit k', () => {
    const r = peers(vec({ 5: 0 }), SPEC, [entry('a', { 5: 0.1 }), entry('b', { 5: 0.2 })], STATS, 1);
    expect(r.k).toBe(1);
    expect(r.peers.map((p) => p.id)).toEqual(['a']);
  });
});

describe('peers — coarse match (PRD 6.5)', () => {
  it('an account with only the reduced set is matched coarsely over it', () => {
    const self = vec({ 0: 0, 1: 1, 2: 2, 3: 1e7 });
    const r = peers(self, SPEC, [entry('a', { ...FULL, 3: 1e8 })], STATS);
    expect(r.coarse).toBe(true);
    expect(r.componentsUsed).toEqual([2, 3]);
    expect(r.peers[0]!.coarse).toBe(true);
    expect(r.peers[0]!.comparedComponents).toBe(2);
    expect(r.peers[0]!.distance).toBeCloseTo(Math.sqrt((0 + 0.25) / 2), 12);
  });

  it('a coarse candidate is labelled coarse for a full account', () => {
    const r = peers(vec(FULL), SPEC, [entry('a', { 2: 2, 3: 1e7 }, { coarse: true })], STATS);
    expect(r.coarse).toBe(false);
    expect(r.peers[0]!.coarse).toBe(true);
    expect(r.peers[0]!.distance).toBe(0);
  });

  it('reduceForCoarseMatch keeps only stateTier and totalTiv', () => {
    const reduced = reduceForCoarseMatch(vec(FULL), SPEC);
    expect(reduced.m).toEqual([0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0]);
    expect(reduced.x[2]).toBe(2);
    expect(reduced.x[3]).toBe(1e7);
    expect(reduced.x[5]).toBeNull();
  });
});

describe('peers — robust distance (CP1 FX2, PRD 6.4 / PRD 12)', () => {
  const BIG = Number.MAX_VALUE;

  function distance(a: FeatureVector, b: FeatureVector) {
    const r = peers(a, SPEC, [{ ...entry('b', {}), vector: b }], STATS);
    return r.peers[0] ?? null;
  }

  it('±Number.MAX_VALUE components give a finite, non-negative, symmetric distance', () => {
    const a = vec({ 5: BIG, 6: -BIG, 7: 0.5 });
    const b = vec({ 5: -BIG, 6: BIG, 7: 0.25 });
    const ab = distance(a, b);
    const ba = distance(b, a);
    expect(ab).not.toBeNull();
    expect(ba).not.toBeNull();
    expect(Number.isFinite(ab!.distance)).toBe(true);
    expect(ab!.distance).toBeGreaterThan(0);
    expect(ba!.distance).toBe(ab!.distance);
    expect(ab!.comparedComponents).toBe(3);
    expect(ba!.comparedComponents).toBe(3);
  });

  it('a component whose value is non-finite on either side is skipped, and the rescale counts only the rest', () => {
    const a = vec({ 5: 0.5, 7: 0.5 });
    const b = vec({ 5: 0.2, 7: 0.9 });
    // Hostile input: a mask that claims known but a value that is not finite.
    const aBad: FeatureVector = { ...a, x: a.x.map((v, i) => (i === 9 ? Number.NaN : v)), m: a.m.map((v, i) => (i === 9 ? 1 : v)) };
    const bBad: FeatureVector = { ...b, x: b.x.map((v, i) => (i === 9 ? Number.POSITIVE_INFINITY : v)), m: b.m.map((v, i) => (i === 9 ? 1 : v)) };
    const ab = distance(aBad, bBad);
    const ba = distance(bBad, aBad);
    expect(ab!.comparedComponents).toBe(2);
    expect(ab!.distance).toBeCloseTo(Math.sqrt((0.09 + 0.16) / 2), 12);
    expect(ba!.distance).toBe(ab!.distance);
  });

  it('no comparable component gives no match in either direction', () => {
    const a = vec({ 5: 0.5, 6: Number.NaN });
    const b = vec({ 7: 0.5 });
    expect(distance(a, b)).toBeNull();
    expect(distance(b, a)).toBeNull();
  });

  it('identical vectors give exactly 0, including at ±Number.MAX_VALUE', () => {
    const a = vec({ 2: 2, 3: 1e7, 5: BIG, 6: -BIG, 7: 0.5 });
    expect(distance(a, vec({ 2: 2, 3: 1e7, 5: BIG, 6: -BIG, 7: 0.5 }))!.distance).toBe(0);
    expect(distance(vec(FULL), vec(FULL))!.distance).toBe(0);
  });

  it('distance is zero only for identical vectors, even when the magnitudes differ wildly', () => {
    const a = vec({ 5: BIG, 6: 5e-324 });
    const b = vec({ 5: BIG, 6: 0 });
    const ab = distance(a, b);
    expect(ab!.distance).toBeGreaterThan(0);
    expect(distance(b, a)!.distance).toBe(ab!.distance);
  });
});

/* -------------------------------------------------------------------------- */
/* Coarse inputs for accounts with no policy (PRD 6.4, findings R1-3 / I3-4)   */
/* -------------------------------------------------------------------------- */

const PROV = { source: 'self_reported' } as const;

function noPolicySubmission(opts: {
  limit?: number;
  hq?: string;
  revenue?: number;
}): CanonicalSubmission {
  return {
    id: 'self',
    lineOfBusiness: 'commercial_property',
    insured: {
      ...(opts.hq === undefined ? {} : { headquartersState: [{ value: opts.hq, provenance: PROV }] }),
      ...(opts.revenue === undefined ? {} : { revenue: [{ value: opts.revenue, provenance: PROV }] }),
    },
    locations: [],
    buildings: [],
    hazards: { present: {} },
    exposure: opts.limit === undefined ? {} : { requestedLimit: [{ value: opts.limit, provenance: PROV }] },
    coverage: { lines: [] },
    history: [],
    pricing: {},
  };
}

/** The real shape of the 11: only isPropertyLine is known. */
const NO_POLICY = vec({ 1: 1 });

describe('peers — coarse inputs for an account with no policy (PRD 6.4)', () => {
  const book = [
    entry('p-near', { ...FULL, 2: 2, 3: 1e7 }, { quotedPremium: 5e4, ratePer100: 0.5, annualLoss: 100 }),
    entry('p-far', { ...FULL, 2: 0, 3: 1e8 }, { quotedPremium: 5e4, ratePer100: 0.9, annualLoss: 300 }),
    entry('np-other', {}, { coarse: true }),
  ];

  it('without coarse inputs a no-policy vector finds no peer (nothing comparable)', () => {
    const r = peers(NO_POLICY, SPEC, book, STATS);
    expect(r.peers).toEqual([]);
  });

  it('places the account among the policy book on requested limit vs TIV and HQ state tier, labelled coarse', () => {
    const self = noPolicySubmission({ limit: 1e7, hq: 'ca' });
    const r = peers(NO_POLICY, SPEC, book, STATS, K_PEERS, self);
    expect(r.coarse).toBe(true);
    expect(r.componentsUsed).toEqual([2, 3]);
    expect(r.peers.map((p) => p.id)).toEqual(['p-near', 'p-far']);
    expect(r.peers.every((p) => p.coarse)).toBe(true);
    expect(r.peers[0]!.distance).toBe(0);
    // stateTier 2/2=1 vs 0; tiv 0.5 vs 1  ->  sqrt((1 + 0.25) / 2)
    expect(r.peers[1]!.distance).toBeCloseTo(Math.sqrt(1.25 / 2), 12);
    expect(r.medianRatePer100).toBeCloseTo(0.7, 12);
  });

  it('never matches another no-policy account (it carries no rate or loss to benchmark)', () => {
    const self = noPolicySubmission({ limit: 1e7, hq: 'CA', revenue: 5e7 });
    const others = [...book.slice(0, 2), { ...book[2]!, revenue: 5e7 }];
    const r = peers(NO_POLICY, SPEC, others, STATS, K_PEERS, self);
    expect(r.peers.map((p) => p.id)).not.toContain('np-other');
  });

  it('compares insured revenue where both sides have it', () => {
    const self = noPolicySubmission({ hq: 'CA', revenue: 1e8 });
    const a = { ...entry('a', { ...FULL, 2: 2 }, { quotedPremium: 1 }), revenue: 1e6 };
    const b = { ...entry('b', { ...FULL, 2: 2 }, { quotedPremium: 1 }), revenue: 1e8 };
    const r = peers(NO_POLICY, SPEC, [a, b], STATS, K_PEERS, self);
    expect(r.peers.map((p) => p.id)).toEqual(['b', 'a']);
    expect(r.peers[0]!.comparedComponents).toBe(2);
    expect(r.peers[0]!.distance).toBe(0);
    expect(r.peers[1]!.distance).toBeCloseTo(Math.sqrt(1 / 2), 12);
  });

  it('coarse inputs never touch a full account', () => {
    const self = noPolicySubmission({ limit: 1e6, hq: 'TX' });
    const plain = peers(vec(FULL), SPEC, book, STATS);
    const withSelf = peers(vec(FULL), SPEC, book, STATS, K_PEERS, self);
    expect(withSelf).toEqual(plain);
  });

  it('coarse inputs never enter the vector itself', () => {
    const v = vec({ 1: 1 });
    const snapshot = JSON.stringify(v);
    peers(v, SPEC, book, STATS, K_PEERS, noPolicySubmission({ limit: 1e7, hq: 'CA' }));
    expect(JSON.stringify(v)).toBe(snapshot);
  });

  it('with no coarse input at all the account stays unplaced', () => {
    const r = peers(NO_POLICY, SPEC, book, STATS, K_PEERS, noPolicySubmission({}));
    expect(r.peers).toEqual([]);
    expect(r.coarse).toBe(true);
  });
});
