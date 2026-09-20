/**
 * E08 — `flipBounds` and `flip`, checked against INTERPRETATIONS F-1..F-6 and
 * V-9, on the real `vectors/commercial.json` spec and the §3 boundaries.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { flip, flipBounds } from './flip.js';
import { price } from './price.js';
import { FACTOR_WEIGHTS } from '../constants.js';
import type {
  BookStats,
  CanonicalSubmission,
  Condition,
  FeatureVector,
  RatingTable,
  Rule,
  Rulebook,
  Sourced,
  Tier,
  VectorSpec,
} from '../types.js';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const SPEC = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../vectors/commercial.json', import.meta.url)), 'utf8'),
) as VectorSpec;

function rule(id: string, factor: string, tier: Tier, when: Condition[], fixHint?: string): Rule {
  return {
    id,
    lineOfBusiness: 'commercial_property',
    factor,
    tier,
    when,
    weight: FACTOR_WEIGHTS[factor as keyof typeof FACTOR_WEIGHTS],
    citation: { doc: 'APPETITE_GUIDELINES.pdf', section: 'p2', quote: factor },
    ...(fixHint === undefined ? {} : { fixHint }),
  } as Rule;
}

/** INTERPRETATIONS §3, as AND-only conditions (same transcription as evaluate.test). */
const RULES: Rule[] = [
  rule('AG-ST-A', 'submission_type', 'acceptable', [{ field: 'isNewBusiness', op: 'eq', value: 1 }]),
  rule('AG-ST-NA', 'submission_type', 'not_acceptable', [{ field: 'isNewBusiness', op: 'eq', value: 0 }]),
  rule('AG-LOB-A', 'line_of_business', 'acceptable', [{ field: 'isPropertyLine', op: 'eq', value: 1 }]),
  rule('AG-LOB-NA', 'line_of_business', 'not_acceptable', [{ field: 'isPropertyLine', op: 'eq', value: 0 }]),
  rule('AG-STATE-T', 'primary_risk_state', 'target', [{ field: 'stateTier', op: 'eq', value: 2 }]),
  rule('AG-STATE-A', 'primary_risk_state', 'acceptable', [{ field: 'stateTier', op: 'eq', value: 1 }]),
  rule('AG-STATE-NA', 'primary_risk_state', 'not_acceptable', [{ field: 'stateTier', op: 'eq', value: 0 }]),
  rule('AG-TIV-T', 'tiv', 'target', [
    { field: 'totalTiv', op: 'gte', value: 50_000_000 },
    { field: 'totalTiv', op: 'lte', value: 100_000_000 },
  ]),
  rule('AG-TIV-A', 'tiv', 'acceptable', [{ field: 'totalTiv', op: 'lte', value: 150_000_000 }]),
  rule('AG-TIV-NA', 'tiv', 'not_acceptable', [{ field: 'totalTiv', op: 'gt', value: 150_000_000 }]),
  rule('AG-PREM-T', 'total_premium', 'target', [
    { field: 'quotedPremium', op: 'gte', value: 75_000 },
    { field: 'quotedPremium', op: 'lte', value: 100_000 },
  ]),
  rule(
    'AG-PREM-A',
    'total_premium',
    'acceptable',
    [
      { field: 'quotedPremium', op: 'gte', value: 50_000 },
      { field: 'quotedPremium', op: 'lte', value: 175_000 },
    ],
    'Re-rate the account to a premium of at least $50,000.',
  ),
  rule('AG-PREM-NA-LOW', 'total_premium', 'not_acceptable', [{ field: 'quotedPremium', op: 'lt', value: 50_000 }]),
  rule('AG-PREM-NA-HIGH', 'total_premium', 'not_acceptable', [{ field: 'quotedPremium', op: 'gt', value: 175_000 }]),
  rule('AG-AGE-NA', 'building_age', 'not_acceptable', [{ field: 'pctTivPre1990', op: 'gt', value: 0.5 }]),
  rule('AG-AGE-T', 'building_age', 'target', [
    { field: 'pctTivPre1990', op: 'lte', value: 0.5 },
    { field: 'pctTivPost2010', op: 'gt', value: 0.5 },
  ]),
  rule('AG-AGE-A', 'building_age', 'acceptable', [{ field: 'pctTivPre1990', op: 'lte', value: 0.5 }]),
  rule('AG-AGE-REFER', 'building_age', 'refer', [
    { field: 'pctTivPre1990', op: 'lte', value: 0.5 },
    { field: 'rollup.oldestYearBuilt', op: 'lt', value: 1990 },
  ]),
  rule('AG-CON-A', 'construction_type', 'acceptable', [{ field: 'pctTivAcceptableConstruction', op: 'gte', value: 0.5 }]),
  rule('AG-CON-NA', 'construction_type', 'not_acceptable', [{ field: 'pctTivAcceptableConstruction', op: 'lt', value: 0.5 }]),
  rule('AG-LOSS-A', 'loss_value', 'acceptable', [{ field: 'fiveYearLoss', op: 'lte', value: 100_000 }]),
  rule('AG-LOSS-NA', 'loss_value', 'not_acceptable', [{ field: 'fiveYearLoss', op: 'gt', value: 100_000 }]),
];

const RULEBOOK: Rulebook = {
  id: 'commercial',
  lineOfBusiness: 'commercial_property',
  version: '1.0.0',
  source: 'APPETITE_GUIDELINES.pdf',
  weights: FACTOR_WEIGHTS,
  rules: RULES,
  interpretations: [],
} as unknown as Rulebook;

/** No rating table: flip must still answer, with `premium*` null. */
const TABLE = {} as unknown as RatingTable;

/** INTERPRETATIONS §3 tier oracle (E05's job; kept independent here). */
function tierFor(index: number, x: readonly (number | null)[]): number | null {
  const v = x[index];
  if (v === null || v === undefined) return null;
  switch (index) {
    case 0:
    case 1:
      return v === 1 ? 1 : 0;
    case 2:
      return v === 2 ? 1 : v === 1 ? 0.6 : 0;
    case 3:
      return v >= 50_000_000 && v <= 100_000_000 ? 1 : v > 150_000_000 ? 0 : 0.6;
    case 4:
      return v < 50_000 || v > 175_000 ? 0 : v >= 75_000 && v <= 100_000 ? 1 : 0.6;
    case 5:
    case 6: {
      const pre = x[5];
      const post = x[6];
      if (pre === null || pre === undefined || post === null || post === undefined) return null;
      if (pre > 0.5) return 0;
      return post > 0.5 ? 1 : 0.6;
    }
    case 7:
      return v >= 0.5 ? 1 : 0;
    case 8:
      return v <= 100_000 ? 1 : 0;
    default:
      return null;
  }
}

function vectorOf(x: readonly (number | null)[]): FeatureVector {
  const m = x.map((v) => (v === null || v === undefined ? 0 : 1)) as (0 | 1)[];
  const t = x.map((_, i) => (m[i] === 1 ? tierFor(i, x) : null));
  return { lineOfBusiness: 'commercial_property', specVersion: '1.0.0', x: [...x], t, m };
}

/** INTERPRETATIONS §8 B1: FIT, every boundary inclusive. */
const B1: (number | null)[] = [1, 1, 2, 150_000_000, 175_000, 0, 0, 0.5, 100_000, null, null];

function withX(overrides: Record<number, number | null>): (number | null)[] {
  const x = B1.slice();
  for (const [i, v] of Object.entries(overrides)) x[Number(i)] = v;
  return x;
}

function sourced<T>(value: T): Sourced<T> {
  return [{ value, provenance: { source: 'self_reported' } }] as unknown as Sourced<T>;
}

const SUBMISSION = {
  id: 'S1',
  lineOfBusiness: 'commercial_property',
  submissionType: sourced('new_business'),
  insured: { name: sourced('Acme Holdings') },
  locations: [{ externalId: 'L1', state: sourced('OH') }],
  buildings: [
    { externalId: 'B1', locationExternalId: 'L1', tiv: sourced(150_000_000), yearBuilt: sourced(2005) },
  ],
  hazards: { present: {} },
  exposure: {},
  coverage: { lines: [] },
  history: [],
  pricing: {},
  rollup: {
    totalTiv: 150_000_000,
    buildingCount: 1,
    tivKnownBuildingCount: 1,
    pctTivPre1990: 0,
    pctTivPost2010: 0,
    pctTivByConstruction: [],
    pctTivAcceptableConstruction: 0.5,
    pctTivSprinklered: null,
    tivWeightedProtectionClass: null,
    primaryState: 'OH',
    stateShares: [],
    fiveYearLoss: 100_000,
    fiveYearClaimCount: 0,
    claimCount: 0,
    pre1990BuildingIds: [],
    oldestYearBuilt: 2005,
    newestYearBuilt: 2005,
    lossWindow: null,
  },
} as unknown as CanonicalSubmission;

const run = (x: (number | null)[], stats: BookStats | null = null) =>
  flip(vectorOf(x), SPEC, RULEBOOK, TABLE, SUBMISSION, stats);

const IMMOVABLE_KEYS = [
  'isNewBusiness',
  'isPropertyLine',
  'stateTier',
  'pctTivPre1990',
  'pctTivPost2010',
  'fiveYearLoss',
  'tivWeightedProtectionClass',
];

/* -------------------------------------------------------------------------- */
/* flipBounds                                                                 */
/* -------------------------------------------------------------------------- */

describe('flipBounds', () => {
  it('marks exactly the F-2 components immovable on the real spec', () => {
    const bounds = flipBounds(vectorOf(B1), SPEC, RULEBOOK);
    expect(bounds).toHaveLength(12);
    // 11 is the flood zone: the building cannot leave the flood plain, so it is
    // immovable and no flip may ever propose changing it.
    expect(bounds.filter((b) => b.immovable).map((b) => b.componentIndex)).toEqual([0, 1, 2, 5, 6, 8, 10, 11]);
    expect(bounds.find((b) => b.componentKey === 'pctTivSprinklered')?.immovable).toBe(false);
  });

  it('holds B1 inside every interval, boundaries inclusive', () => {
    const bounds = flipBounds(vectorOf(B1), SPEC, RULEBOOK);
    expect(bounds.every((b) => b.satisfied)).toBe(true);
    const premium = bounds[4];
    expect(premium).toMatchObject({ componentKey: 'quotedPremium', min: 50_000, max: 175_000 });
    expect(bounds[3]).toMatchObject({ componentKey: 'totalTiv', min: null, max: 150_000_000 });
    expect(bounds[7]).toMatchObject({ min: 0.5, max: null });
    expect(bounds[8]).toMatchObject({ min: null, max: 100_000 });
  });

  it('a component outside its only (Target) interval still passes when its factor passes', () => {
    // pctTivPost2010 = 0 is named only by AG-AGE-T; building_age is Acceptable via AG-AGE-A.
    const post2010 = flipBounds(vectorOf(B1), SPEC, RULEBOOK)[6];
    expect(post2010).toMatchObject({ componentKey: 'pctTivPost2010', min: 0.5, satisfied: true });
  });

  it('picks the NEAREST acceptable interval, not the Target one (premium 40k → [50k, 175k])', () => {
    const premium = flipBounds(vectorOf(withX({ 4: 40_000 })), SPEC, RULEBOOK)[4];
    expect(premium).toMatchObject({ min: 50_000, max: 175_000, satisfied: false });
  });

  it('reports a component inside a Target interval as satisfied by that interval', () => {
    const premium = flipBounds(vectorOf(withX({ 4: 80_000 })), SPEC, RULEBOOK)[4];
    expect(premium?.satisfied).toBe(true);
  });

  it('treats a missing component as unsatisfied, and one with no rule as unbounded and satisfied', () => {
    const bounds = flipBounds(vectorOf(withX({ 7: null })), SPEC, RULEBOOK);
    expect(bounds[7]).toMatchObject({ satisfied: false, min: 0.5 });
    expect(bounds[9]).toMatchObject({ min: null, max: null, satisfied: true });
  });

  it('keeps an exclusive boundary exclusive (gt 0.5 does not hold at 0.5)', () => {
    const book = {
      ...RULEBOOK,
      rules: [rule('X-SPR-A', 'sprinkler_protection', 'acceptable', [{ field: 'pctTivSprinklered', op: 'gt', value: 0.5 }])],
    } as Rulebook;
    const at = flipBounds(vectorOf(withX({ 9: 0.5 })), SPEC, book)[9];
    expect(at).toMatchObject({ min: 0.5, max: null, satisfied: false });
    const past = flipBounds(vectorOf(withX({ 9: 0.51 })), SPEC, book)[9];
    expect(past?.satisfied).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* flip                                                                       */
/* -------------------------------------------------------------------------- */

describe('flip', () => {
  it('V-9: a FIT account is zero moves, not "no flip"', () => {
    const result = run(B1);
    expect(result.reason).toBeNull();
    expect(result.blockedByImmovable).toEqual([]);
    expect(result.flip).not.toBeNull();
    expect(result.flip?.moves).toEqual([]);
    expect(result.flip?.distanceScaled).toBe(0);
    expect(result.flip?.verdictAfter).toBe('FIT');
    expect(result.flip?.scoreAfter).toBe(result.flip?.scoreBefore);
  });

  it('F-5: premium 40,000 lands at exactly 50,000 (inclusive boundary), one move', () => {
    const result = run(withX({ 4: 40_000 }));
    expect(result.reason).toBeNull();
    const moves = result.flip?.moves ?? [];
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({
      componentIndex: 4,
      componentKey: 'quotedPremium',
      from: 40_000,
      to: 50_000,
      fixHint: 'Re-rate the account to a premium of at least $50,000.',
    });
    expect(moves[0]?.label).toBe('Raise Quoted total premium from 40000 to 50000');
    expect(result.flip?.verdictAfter).toBe('FIT');
    expect(result.flip?.scoreAfter).toBeGreaterThan(result.flip?.scoreBefore ?? Infinity);
  });

  it('F-5: TIV 200M lowers to exactly 150,000,000', () => {
    const moves = run(withX({ 3: 200_000_000 })).flip?.moves ?? [];
    expect(moves.map((m) => [m.componentKey, m.to])).toEqual([['totalTiv', 150_000_000]]);
  });

  it('F-1: two failing movables → a two-move flip ordered by component index', () => {
    const result = run(withX({ 4: 40_000, 7: 0.3 }));
    expect(result.reason).toBeNull();
    expect(result.flip?.moves.map((m) => [m.componentIndex, m.to])).toEqual([
      [4, 50_000],
      [7, 0.5],
    ]);
  });

  it('F-1: three failing movables → no flip, with a reason', () => {
    const result = run(withX({ 3: 200_000_000, 4: 40_000, 7: 0.3 }));
    expect(result.flip).toBeNull();
    expect(result.reason).toMatch(/at most two/);
    expect(result.blockedByImmovable).toEqual([]);
  });

  it('F-3: every failing component immovable → null flip naming them', () => {
    const result = run(withX({ 2: 0, 5: 0.8, 8: 200_000 }));
    expect(result.flip).toBeNull();
    expect(result.blockedByImmovable).toEqual(['stateTier', 'pctTivPre1990', 'fiveYearLoss']);
    expect(result.reason).toContain('immovable');
    expect(result.reason).toContain('pctTivPre1990');
  });

  it('F-2: an immovable knockout blocks the flip even when a movable one could be fixed', () => {
    const result = run(withX({ 4: 40_000, 8: 200_000 }));
    expect(result.flip).toBeNull();
    expect(result.blockedByImmovable).toEqual(['fiveYearLoss']);
    expect(result.reason).toContain('fiveYearLoss');
  });

  it('F-2: no returned move ever touches an immovable component', () => {
    const cases = [withX({ 4: 40_000 }), withX({ 4: 40_000, 7: 0.3 }), withX({ 3: 200_000_000 }), withX({ 7: null })];
    for (const x of cases) {
      for (const move of run(x).flip?.moves ?? []) {
        expect(IMMOVABLE_KEYS).not.toContain(move.componentKey);
      }
    }
  });

  it('supplies a missing movable required component (REFER → FIT) at scaled length 1', () => {
    const result = run(withX({ 7: null }));
    const move = result.flip?.moves[0];
    expect(result.flip?.moves).toHaveLength(1);
    expect(move).toMatchObject({ componentKey: 'pctTivAcceptableConstruction', from: null, to: 0.5, deltaScaled: 1 });
    expect(move?.label).toBe('Supply Share of TIV in acceptable construction classes: 0.5');
  });

  it('F-4: move length is measured in scaled space against BookStats', () => {
    const min = Math.log(10_000);
    const max = Math.log(1_000_000);
    const stats = {
      lineOfBusiness: 'commercial_property',
      specVersion: '1.0.0',
      n: 10,
      components: [{ index: 4, key: 'quotedPremium', min, max, mean: 0, median: 0, count: 10 }],
      medianRatePer100: null,
      meanAnnualLoss: null,
      meanClaimFrequency: null,
      meanClaimSeverity: null,
    } as BookStats;
    const result = run(withX({ 4: 40_000, 7: 0.3 }), stats);
    const expectedPremium = (Math.log(50_000) - Math.log(40_000)) / (max - min);
    const [premium, construction] = result.flip?.moves ?? [];
    expect(premium?.deltaScaled).toBeCloseTo(expectedPremium, 12);
    expect(construction?.deltaScaled).toBeCloseTo(0.2, 12);
    expect(result.flip?.distanceScaled).toBeCloseTo(Math.hypot(expectedPremium, 0.2), 12);
  });

  it('is deterministic: the same input gives the same flip', () => {
    const x = withX({ 4: 40_000, 7: 0.3 });
    expect(run(x)).toEqual(run(x));
  });
});

/* -------------------------------------------------------------------------- */
/* R2 fixer 6 — extensions in the FIT test (R1-2), price after the move (R1-3) */
/* -------------------------------------------------------------------------- */

const EXTENSIONS: Rulebook = {
  id: 'extensions',
  lineOfBusiness: 'commercial_property',
  version: '1.0.0',
  source: 'Retrofit extension rules',
  weights: FACTOR_WEIGHTS,
  rules: [
    {
      ...rule('X-PPC-UNPROTECTED', 'protection_class', 'refer', [
        { field: 'tivWeightedProtectionClass', op: 'gte', value: 9 },
      ]),
      extension: true,
    } as Rule,
  ],
  interpretations: [],
} as unknown as Rulebook;

describe('flip — extension rules count in the FIT test (R1-2, F-6, V-9)', () => {
  it('an account referred only by an extension rule is not "0 moves from FIT"', () => {
    const result = flip(vectorOf(withX({ 10: 9 })), SPEC, RULEBOOK, TABLE, SUBMISSION, null, EXTENSIONS);
    expect(result.flip).toBeNull();
    expect(result.reason).not.toBeNull();
  });

  it('never proposes a premium move whose verdictAfter FIT an extension refer contradicts', () => {
    const result = flip(
      vectorOf(withX({ 4: 200_000, 10: 9 })),
      SPEC,
      RULEBOOK,
      TABLE,
      SUBMISSION,
      null,
      EXTENSIONS,
    );
    expect(result.flip).toBeNull();
  });

  it('without an extension refer the premium flip still reaches FIT', () => {
    const result = flip(vectorOf(withX({ 4: 200_000, 10: 5 })), SPEC, RULEBOOK, TABLE, SUBMISSION, null, EXTENSIONS);
    expect(result.flip?.moves.map((m) => [m.componentKey, m.to])).toEqual([['quotedPremium', 175_000]]);
  });
});

describe('flip — premiumAfter prices the moved account (R1-3, PRD 6.3 stage 10)', () => {
  const RATING = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../rating/commercial.json', import.meta.url)), 'utf8'),
  ) as RatingTable;

  const building = (id: string, tiv: number, construction: string, sprinklered = true) => ({
    externalId: id,
    locationExternalId: 'L1',
    tiv: sourced(tiv),
    yearBuilt: sourced(2005),
    constructionType: sourced(construction),
    sprinklered: sourced(sprinklered),
    protectionClass: sourced(3),
  });

  const withBuildings = (
    buildings: ReturnType<typeof building>[],
    rollup: Record<string, unknown>,
  ): CanonicalSubmission =>
    ({
      ...SUBMISSION,
      buildings,
      rollup: { ...(SUBMISSION.rollup as object), ...rollup },
    }) as unknown as CanonicalSubmission;

  const priceOf = (s: CanonicalSubmission, x: (number | null)[]) =>
    price(vectorOf(x), SPEC, RATING, s, null, null).predictedPremium as number;

  it('a totalTiv move scales the price with the TIV', () => {
    const x = withX({ 3: 200_000_000 });
    const s = withBuildings(
      [building('B1', 120_000_000, 'Joisted Masonry'), building('B2', 80_000_000, 'Steel Frame')],
      { totalTiv: 200_000_000 },
    );
    const result = flip(vectorOf(x), SPEC, RULEBOOK, RATING, s, null);
    expect(result.flip?.moves.map((m) => [m.componentKey, m.to])).toEqual([['totalTiv', 150_000_000]]);
    const before = result.flip?.premiumBefore as number;
    const after = result.flip?.premiumAfter as number;
    expect(before).toBeGreaterThan(0);
    expect(after).toBeCloseTo(before * 0.75, 6);
  });

  it('a construction move re-rates the shifted TIV at an acceptable class', () => {
    const x = withX({ 7: 0.3 });
    const s = withBuildings(
      [building('B1', 105_000_000, 'Wood Frame'), building('B2', 45_000_000, 'Joisted Masonry')],
      { pctTivAcceptableConstruction: 0.3 },
    );
    const result = flip(vectorOf(x), SPEC, RULEBOOK, RATING, s, null);
    expect(result.flip?.moves.map((m) => [m.componentKey, m.to])).toEqual([
      ['pctTivAcceptableConstruction', 0.5],
    ]);
    const expected = priceOf(
      withBuildings(
        [
          building('B1', 75_000_000, 'Wood Frame'),
          building('B2', 45_000_000, 'Joisted Masonry'),
          building('B1b', 30_000_000, 'Joisted Masonry'),
        ],
        {},
      ),
      x,
    );
    expect(result.flip?.premiumAfter).not.toBe(result.flip?.premiumBefore);
    expect(result.flip?.premiumAfter as number).toBeCloseTo(expected, 6);
  });
});
