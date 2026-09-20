/**
 * Stage 6 tests (unit E05). Every number asserted here is fixed by
 * `docs/contracts/INTERPRETATIONS.md`: §3 boundaries, T-BLANK, T-SPAN, §6
 * scaling and the §8 worked cases.
 */
import { describe, expect, it } from 'vitest';
import type {
  BookStats,
  CanonicalSubmission,
  LineOfBusiness,
  SubmissionType,
  FeatureVector,
  Rulebook,
  VectorComponentSpec,
  VectorSpec,
} from '../types.js';
import { APPETITE_FACTORS, FACTOR_WEIGHTS, SCORE_TOLERANCE } from '../constants.js';
import { computeBookStats, scaleVector, tiersFor, vectorize } from './vectorize.js';

/* -------------------------------------------------------------------------- */
/* The commercial spec, mirroring packages/engine/vectors/commercial.json.     */
/* Built inline so the pure engine package does no file I/O in a test.         */
/* -------------------------------------------------------------------------- */

function component(
  index: number,
  key: string,
  source: string,
  type: VectorComponentSpec['type'],
  scaling: VectorComponentSpec['scaling'],
  factor: string | null,
  immovable: boolean,
  required: boolean,
): VectorComponentSpec {
  return {
    index,
    key,
    label: key,
    source,
    type,
    scaling,
    direction: 'higher_better',
    appetiteFactor: factor !== null && index <= 8,
    factor,
    extensionOnly: index > 8,
    immovable,
    required,
  };
}

const SPEC: VectorSpec = {
  lineOfBusiness: 'commercial_property',
  version: '1.0.0',
  components: [
    component(0, 'isNewBusiness', 'submissionType', 'binary', { rule: 'none' }, 'submission_type', true, true),
    component(1, 'isPropertyLine', 'lineOfBusiness', 'binary', { rule: 'none' }, 'line_of_business', true, true),
    component(2, 'stateTier', 'rollup.primaryState', 'tier', { rule: 'divide', divisor: 2 }, 'primary_risk_state', true, true),
    component(3, 'totalTiv', 'rollup.totalTiv', 'currency', { rule: 'log_minmax' }, 'tiv', false, true),
    component(4, 'quotedPremium', 'pricing.quotedPremium', 'currency', { rule: 'log_minmax' }, 'total_premium', false, true),
    component(5, 'pctTivPre1990', 'rollup.pctTivPre1990', 'ratio', { rule: 'none' }, 'building_age', true, true),
    component(6, 'pctTivPost2010', 'rollup.pctTivPost2010', 'ratio', { rule: 'none' }, 'building_age', true, true),
    component(7, 'pctTivAcceptableConstruction', 'rollup.pctTivAcceptableConstruction', 'ratio', { rule: 'none' }, 'construction_type', false, true),
    component(8, 'fiveYearLoss', 'rollup.fiveYearLoss', 'currency', { rule: 'log1p_minmax' }, 'loss_value', true, true),
    component(9, 'pctTivSprinklered', 'rollup.pctTivSprinklered', 'ratio', { rule: 'none' }, 'sprinkler_protection', false, false),
    component(10, 'tivWeightedProtectionClass', 'rollup.tivWeightedProtectionClass', 'ordinal', { rule: 'divide', divisor: 10 }, 'protection_class', true, false),
  ],
};

const RULEBOOK: Rulebook = {
  id: 'commercial',
  lineOfBusiness: 'commercial_property',
  version: '1.0.0',
  source: 'APPETITE_GUIDELINES.pdf',
  weights: FACTOR_WEIGHTS,
  rules: [],
};

/** B1 of INTERPRETATIONS §8: every component known, nothing missing. */
const B1: readonly (number | null)[] = [1, 1, 2, 150_000_000, 175_000, 0, 0, 0.5, 100_000, null, null];

function withComponent(
  x: readonly (number | null)[],
  index: number,
  value: number | null,
): (number | null)[] {
  const next = [...x];
  next[index] = value;
  return next;
}

function tierAt(index: number, value: number | null, base: readonly (number | null)[] = B1): number | null {
  return tiersFor(withComponent(base, index, value), SPEC, RULEBOOK)[index] ?? null;
}

/**
 * T-SPAN: the score sums over the eight FACTORS, never the eleven components.
 * `building_age` writes the same tier into components 5 and 6 and counts once.
 */
function appetiteScore(t: readonly (number | null)[]): number {
  const seen = new Map<string, number>();
  for (const spec of SPEC.components) {
    if (!spec.appetiteFactor || spec.factor === null) continue;
    const value = t[spec.index];
    if (value === null || value === undefined) continue;
    seen.set(spec.factor, value);
  }
  let total = 0;
  for (const factor of APPETITE_FACTORS) {
    const value = seen.get(factor);
    if (value === undefined) continue;
    total += FACTOR_WEIGHTS[factor] * value;
  }
  return 100 * total;
}

/* -------------------------------------------------------------------------- */

describe('tiersFor — INTERPRETATIONS §3 boundaries', () => {
  it('3.1 TIV: target band and the inclusive $150M ceiling', () => {
    expect(tierAt(3, 49_999_999.99)).toBe(0.6);
    expect(tierAt(3, 50_000_000)).toBe(1);
    expect(tierAt(3, 75_000_000)).toBe(1);
    expect(tierAt(3, 100_000_000)).toBe(1);
    expect(tierAt(3, 100_000_000.01)).toBe(0.6);
    expect(tierAt(3, 150_000_000)).toBe(0.6);
    expect(tierAt(3, 150_000_000.01)).toBe(0);
    expect(tierAt(3, 0)).toBe(0.6);
    expect(tierAt(3, null)).toBeNull();
  });

  it('3.2 total premium: all four band edges belong to the friendlier tier', () => {
    expect(tierAt(4, 49_999.99)).toBe(0);
    expect(tierAt(4, 50_000)).toBe(0.6);
    expect(tierAt(4, 74_999.99)).toBe(0.6);
    expect(tierAt(4, 75_000)).toBe(1);
    expect(tierAt(4, 100_000)).toBe(1);
    expect(tierAt(4, 100_000.01)).toBe(0.6);
    expect(tierAt(4, 175_000)).toBe(0.6);
    expect(tierAt(4, 175_000.01)).toBe(0);
    expect(tierAt(4, null)).toBeNull();
  });

  it('3.3 loss value: exactly $100,000 is not "over", and T-BLANK makes it 1', () => {
    expect(tierAt(8, 0)).toBe(1);
    expect(tierAt(8, 99_999.99)).toBe(1);
    expect(tierAt(8, 100_000)).toBe(1);
    expect(tierAt(8, 100_000.01)).toBe(0);
    expect(tierAt(8, null)).toBeNull();
  });

  it('3.5 construction: an exact 50/50 split is Acceptable, and T-BLANK makes it 1', () => {
    expect(tierAt(7, 1)).toBe(1);
    expect(tierAt(7, 0.5)).toBe(1);
    expect(tierAt(7, 0.4999)).toBe(0);
    expect(tierAt(7, 0)).toBe(0);
    expect(tierAt(7, null)).toBeNull();
  });

  it('3.6 primary risk state: target subset first, other codes Not Acceptable', () => {
    expect(tierAt(2, 2)).toBe(1);
    expect(tierAt(2, 1)).toBe(0.6);
    expect(tierAt(2, 0)).toBe(0);
    expect(tierAt(2, null)).toBeNull();
  });

  it('3.7/3.8 submission type and line of business are T-BLANK factors', () => {
    expect(tierAt(0, 1)).toBe(1);
    expect(tierAt(0, 0)).toBe(0);
    expect(tierAt(0, null)).toBeNull();
    expect(tierAt(1, 1)).toBe(1);
    expect(tierAt(1, 0)).toBe(0);
  });

  it('components 9 and 10 are not appetite factors and carry no tier', () => {
    const t = tiersFor(withComponent(withComponent(B1, 9, 1), 10, 3), SPEC, RULEBOOK);
    expect(t[9]).toBeNull();
    expect(t[10]).toBeNull();
  });
});

describe('tiersFor — T-SPAN, building age across components 5 and 6', () => {
  it('both components carry the same building_age tier', () => {
    const t = tiersFor(B1, SPEC, RULEBOOK);
    expect(t[5]).toBe(0.6);
    expect(t[6]).toBe(0.6);
  });

  it('3.4: > 50% pre-1990 is Not Acceptable, exactly 50% is not', () => {
    const half = tiersFor(withComponent(B1, 5, 0.5), SPEC, RULEBOOK);
    expect(half[5]).toBe(0.6);
    expect(half[6]).toBe(0.6);

    const over = tiersFor(withComponent(B1, 5, 0.500001), SPEC, RULEBOOK);
    expect(over[5]).toBe(0);
    expect(over[6]).toBe(0);
  });

  it('3.4: > 50% post-2010 with pre-1990 <= 50% is Target; exactly 50% is Acceptable', () => {
    const target = tiersFor(withComponent(B1, 6, 0.500001), SPEC, RULEBOOK);
    expect(target[5]).toBe(1);
    expect(target[6]).toBe(1);

    const acceptable = tiersFor(withComponent(B1, 6, 0.5), SPEC, RULEBOOK);
    expect(acceptable[5]).toBe(0.6);
    expect(acceptable[6]).toBe(0.6);
  });

  it('Not Acceptable is checked before Target', () => {
    const t = tiersFor(withComponent(withComponent(B1, 5, 0.6), 6, 0.4), SPEC, RULEBOOK);
    expect(t[5]).toBe(0);
  });

  it('no building with a known year leaves both components missing', () => {
    const t = tiersFor(withComponent(withComponent(B1, 5, null), 6, null), SPEC, RULEBOOK);
    expect(t[5]).toBeNull();
    expect(t[6]).toBeNull();
  });
});

describe('the §8 worked cases score over eight factors, not eleven components', () => {
  it('B1 scores exactly 84', () => {
    const t = tiersFor(B1, SPEC, RULEBOOK);
    expect(t.slice(0, 9)).toEqual([1, 1, 1, 0.6, 0.6, 0.6, 0.6, 1, 1]);
    expect(appetiteScore(t)).toBeCloseTo(84, 9);
  });

  it('B8 — every building post-2010 — scores exactly 88', () => {
    const t = tiersFor(withComponent(B1, 6, 1), SPEC, RULEBOOK);
    expect(t[5]).toBe(1);
    expect(t[6]).toBe(1);
    expect(appetiteScore(t)).toBeCloseTo(88, 9);
  });

  it('B9 — TIV $50M and premium $75K — scores exactly 96', () => {
    const x = withComponent(withComponent(B1, 3, 50_000_000), 4, 75_000);
    expect(appetiteScore(tiersFor(x, SPEC, RULEBOOK))).toBeCloseTo(96, 9);
  });

  it('B10 — B9 in an acceptable-only state — scores exactly 90', () => {
    const x = withComponent(withComponent(withComponent(B1, 3, 50_000_000), 4, 75_000), 2, 1);
    expect(appetiteScore(tiersFor(x, SPEC, RULEBOOK))).toBeCloseTo(90, 9);
  });

  it('B11 — B9 with no quoted premium — scores exactly 81 and drops no other factor', () => {
    const x = withComponent(withComponent(withComponent(B1, 3, 50_000_000), 4, 75_000), 4, null);
    const t = tiersFor(x, SPEC, RULEBOOK);
    expect(t[4]).toBeNull();
    expect(appetiteScore(t)).toBeCloseTo(81, 9);
  });

  it('B12 — a renewal still scores 86; the knockout is a separate output', () => {
    const x = withComponent(
      withComponent(withComponent(B1, 3, 50_000_000), 4, 75_000),
      0,
      0,
    );
    const t = tiersFor(x, SPEC, RULEBOOK);
    expect(t[0]).toBe(0);
    expect(appetiteScore(t)).toBeCloseTo(86, 9);
  });

  it('a perfect account scores exactly 100.000000', () => {
    const x: (number | null)[] = [1, 1, 2, 50_000_000, 75_000, 0, 1, 1, 0, null, null];
    expect(Math.abs(appetiteScore(tiersFor(x, SPEC, RULEBOOK)) - 100)).toBeLessThanOrEqual(
      SCORE_TOLERANCE,
    );
  });
});

describe('scaleVector — INTERPRETATIONS §6', () => {
  const stats = computeBookStats(
    [
      vectorOf([1, 1, 2, 10_000_000, 50_000, 0, 0, 1, 0, null, null]),
      vectorOf([1, 1, 2, 100_000_000, 200_000, 0.5, 0.5, 0.5, 1_000_000, null, null]),
    ],
    SPEC,
  );

  it('`none` uses the value as-is and `divide` clamps to 0..1', () => {
    const scaled = scaleVector(B1, SPEC, stats);
    expect(scaled[5]).toBe(0);
    expect(scaled[7]).toBe(0.5);
    expect(scaled[2]).toBe(1); // stateTier 2 / 2
    expect(scaleVector(withComponent(B1, 2, 1), SPEC, stats)[2]).toBe(0.5);
  });

  it('`log_minmax` floors at 1 and min-maxes in log space', () => {
    const lo = Math.log(10_000_000);
    const hi = Math.log(100_000_000);
    const scaled = scaleVector(withComponent(B1, 3, 50_000_000), SPEC, stats);
    expect(scaled[3]).toBeCloseTo((Math.log(50_000_000) - lo) / (hi - lo), 12);
    // Below the book minimum, and x <= 1, both clamp to 0.
    expect(scaleVector(withComponent(B1, 3, 1), SPEC, stats)[3]).toBe(0);
    expect(scaleVector(withComponent(B1, 3, 0), SPEC, stats)[3]).toBe(0);
    // Above the book maximum clamps to 1.
    expect(scaleVector(withComponent(B1, 3, 900_000_000), SPEC, stats)[3]).toBe(1);
  });

  it('`log1p_minmax` is ln(1 + x) against the stored log-space bounds', () => {
    const hi = Math.log1p(1_000_000);
    const scaled = scaleVector(withComponent(B1, 8, 100_000), SPEC, stats);
    expect(scaled[8]).toBeCloseTo(Math.log1p(100_000) / hi, 12);
    expect(scaleVector(withComponent(B1, 8, 0), SPEC, stats)[8]).toBe(0);
  });

  it('a degenerate range scales every input to 0', () => {
    const flat = computeBookStats(
      [
        vectorOf([1, 1, 2, 50_000_000, 75_000, 0, 0, 1, 0, null, null]),
        vectorOf([1, 1, 2, 50_000_000, 75_000, 0, 0, 1, 0, null, null]),
      ],
      SPEC,
    );
    expect(scaleVector(B1, SPEC, flat)[3]).toBe(0);
  });

  it('a missing component stays missing, and no book scales min-max rules to 0', () => {
    expect(scaleVector(withComponent(B1, 3, null), SPEC, stats)[3]).toBeNull();
    expect(scaleVector(B1, SPEC, null)[3]).toBe(0);
    expect(scaleVector(B1, SPEC, null)[7]).toBe(0.5);
  });
});

describe('computeBookStats', () => {
  const vectors = [
    vectorOf([1, 1, 2, 10_000_000, 50_000, 0, 0, 1, 0, null, null]),
    vectorOf([1, 1, 1, 100_000_000, 200_000, 0.5, 0.5, 0.5, 1_000_000, null, null]),
    vectorOf([1, 1, 2, null, 100_000, 0, 1, 1, 500_000, null, null]),
  ];
  const stats = computeBookStats(vectors, SPEC);

  it('stores min and max AFTER the log transform, and mean/median in raw space', () => {
    const tiv = stats.components[3];
    expect(tiv?.count).toBe(2);
    expect(tiv?.min).toBeCloseTo(Math.log(10_000_000), 12);
    expect(tiv?.max).toBeCloseTo(Math.log(100_000_000), 12);
    expect(tiv?.mean).toBeCloseTo(55_000_000, 6);
    expect(tiv?.median).toBeCloseTo(55_000_000, 6);
  });

  it('skips components whose mask is 0', () => {
    const premium = stats.components[4];
    expect(premium?.count).toBe(3);
    expect(premium?.median).toBeCloseTo(100_000, 6);
    expect(stats.components[9]?.count).toBe(0);
    expect(stats.components[9]?.min).toBe(0);
  });

  it('carries the spec identity and the book-wide fallbacks', () => {
    expect(stats.n).toBe(3);
    expect(stats.lineOfBusiness).toBe('commercial_property');
    expect(stats.specVersion).toBe('1.0.0');
    // rate per $100 of TIV: 50000/(1e7/100) = 0.5 and 200000/(1e8/100) = 0.2
    expect(stats.medianRatePer100).toBeCloseTo(0.35, 12);
    // mean of 0/5, 1_000_000/5, 500_000/5
    expect(stats.meanAnnualLoss).toBeCloseTo(100_000, 6);
    expect(stats.meanClaimFrequency).toBeNull();
  });

  it('an empty book gives every component a zero range and no fallbacks', () => {
    const empty = computeBookStats([], SPEC);
    expect(empty.n).toBe(0);
    expect(empty.components).toHaveLength(11);
    expect(empty.components[3]).toMatchObject({ min: 0, max: 0, count: 0 });
    expect(empty.medianRatePer100).toBeNull();
    expect(empty.meanAnnualLoss).toBeNull();
  });
});

describe('vectorize — a pure function of the merged submission', () => {
  it('reads x from the canonical submission and derives t and m', () => {
    const vector = vectorize(submissionB1(), SPEC, RULEBOOK);
    expect(vector.x).toEqual([1, 1, 2, 150_000_000, 175_000, 0, 0, 0.5, 100_000, null, null]);
    expect(vector.t.slice(0, 9)).toEqual([1, 1, 1, 0.6, 0.6, 0.6, 0.6, 1, 1]);
    expect(vector.m).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0]);
    expect(appetiteScore(vector.t)).toBeCloseTo(84, 9);
    expect(vector.specVersion).toBe('1.0.0');
  });

  it('is deterministic: the same submission gives the same vector', () => {
    expect(vectorize(submissionB1(), SPEC, RULEBOOK)).toEqual(
      vectorize(submissionB1(), SPEC, RULEBOOK),
    );
  });

  it('G-1/G-2: a missing value sets m = 0, x = null and t = null without imputing 0', () => {
    const base = submissionB1();
    const submission: CanonicalSubmission = {
      ...base,
      pricing: {},
      rollup: { ...base.rollup!, primaryState: null, totalTiv: null },
    };
    const vector = vectorize(submission, SPEC, RULEBOOK);
    expect(vector.x[2]).toBeNull();
    expect(vector.x[3]).toBeNull();
    expect(vector.x[4]).toBeNull();
    expect(vector.m.slice(2, 5)).toEqual([0, 0, 0]);
    expect(vector.t.slice(2, 5)).toEqual([null, null, null]);
  });

  it('G-7: the primary state maps to stateTier 2 / 1 / 0', () => {
    const base = submissionB1();
    const at = (state: string | null): number | null =>
      vectorize(
        { ...base, rollup: { ...base.rollup!, primaryState: state } },
        SPEC,
        RULEBOOK,
      ).x[2] ?? null;
    expect(at(' oh ')).toBe(2);
    expect(at('FL')).toBe(2);
    expect(at('NC')).toBe(1);
    expect(at('UT')).toBe(1);
    expect(at('NY')).toBe(0);
    expect(at(null)).toBeNull();
  });

  it('a renewal sets isNewBusiness to 0 and a non-property line sets isPropertyLine to 0', () => {
    const base = submissionB1();
    const renewal = vectorize(
      {
        ...base,
        submissionType: [{ value: 'renewal', provenance: { source: 'self_reported' } }],
      },
      SPEC,
      RULEBOOK,
    );
    expect(renewal.x[0]).toBe(0);
    expect(renewal.t[0]).toBe(0);

    const tenant = vectorize({ ...base, lineOfBusiness: 'tenant' }, SPEC, RULEBOOK);
    expect(tenant.x[1]).toBe(0);
    expect(tenant.t[1]).toBe(0);
  });

  it('takes the highest-confidence value when a slot holds competing values', () => {
    const base = submissionB1();
    const vector = vectorize(
      {
        ...base,
        pricing: {
          quotedPremium: [
            { value: 49_000, provenance: { source: 'self_reported' } },
            { value: 75_000, provenance: { source: 'enrichment' } },
          ],
        },
      },
      SPEC,
      RULEBOOK,
    );
    expect(vector.x[4]).toBe(75_000);
    expect(vector.t[4]).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* CP1 FX1 — G-11 categorical canonicalization and PRD 12 scaled range         */
/* -------------------------------------------------------------------------- */

/** V-6 completeness: 100 x known required components / required components. */
function completenessOf(m: readonly (0 | 1)[]): number {
  let required = 0;
  let known = 0;
  for (const c of SPEC.components) {
    if (!c.required) continue;
    required += 1;
    if (m[c.index] === 1) known += 1;
  }
  return required === 0 ? 100 : (100 * known) / required;
}

function withSubmissionType(value: string): CanonicalSubmission {
  return {
    ...submissionB1(),
    submissionType: [
      { value: value as SubmissionType, provenance: { source: 'self_reported' } },
    ],
  };
}

describe('G-11 — categorical fields are trimmed and case-folded; blank is missing', () => {
  it('"NEW_BUSINESS", " new ", "new" and "new_business" are all new business, tier 1', () => {
    for (const raw of ['NEW_BUSINESS', ' new ', 'new', 'new_business', ' New ']) {
      const vector = vectorize(withSubmissionType(raw), SPEC, RULEBOOK);
      expect(vector.x[0], raw).toBe(1);
      expect(vector.m[0], raw).toBe(1);
      expect(vector.t[0], raw).toBe(1);
    }
  });

  it('"RENEWAL" is a known renewal: tier 0 and a knockout', () => {
    for (const raw of ['RENEWAL', ' renewal ', 'Renewal']) {
      const vector = vectorize(withSubmissionType(raw), SPEC, RULEBOOK);
      expect(vector.x[0], raw).toBe(0);
      expect(vector.m[0], raw).toBe(1);
      // G-3: a known component at tier 0 sets the knockout mask.
      expect(vector.t[0], raw).toBe(0);
    }
  });

  it('a blank submission type is MISSING: m 0, x/t null, no knockout, completeness 8/9', () => {
    const full = completenessOf(vectorize(submissionB1(), SPEC, RULEBOOK).m);
    expect(full).toBe(100);
    for (const raw of ['', '   ', '\t\n']) {
      const vector = vectorize(withSubmissionType(raw), SPEC, RULEBOOK);
      expect(vector.x[0], JSON.stringify(raw)).toBeNull();
      expect(vector.m[0], JSON.stringify(raw)).toBe(0);
      expect(vector.t[0], JSON.stringify(raw)).toBeNull();
      expect(vector.t.some((t) => t === 0), JSON.stringify(raw)).toBe(false);
      expect(completenessOf(vector.m)).toBeCloseTo((100 * 8) / 9, 12);
    }
  });

  it('line of business is case-folded; a blank line is MISSING', () => {
    const at = (lob: string) =>
      vectorize({ ...submissionB1(), lineOfBusiness: lob as LineOfBusiness }, SPEC, RULEBOOK);
    for (const raw of ['COMMERCIAL_PROPERTY', ' commercial_property ', 'Commercial_Property']) {
      const v = at(raw);
      expect(v.x[1], raw).toBe(1);
      expect(v.t[1], raw).toBe(1);
    }
    expect(at('TENANT').x[1]).toBe(0);
    expect(at('TENANT').t[1]).toBe(0);
    for (const raw of ['', '   ']) {
      const v = at(raw);
      expect(v.x[1], JSON.stringify(raw)).toBeNull();
      expect(v.m[1], JSON.stringify(raw)).toBe(0);
      expect(v.t[1], JSON.stringify(raw)).toBeNull();
      expect(v.t.some((t) => t === 0)).toBe(false);
      expect(completenessOf(v.m)).toBeCloseTo((100 * 8) / 9, 12);
    }
  });

  it('a blank primary state is MISSING; a non-blank unknown code is out-of-list (tier 0)', () => {
    const base = submissionB1();
    const at = (state: string) =>
      vectorize({ ...base, rollup: { ...base.rollup!, primaryState: state } }, SPEC, RULEBOOK);
    for (const raw of ['', '   ']) {
      const v = at(raw);
      expect(v.x[2], JSON.stringify(raw)).toBeNull();
      expect(v.m[2], JSON.stringify(raw)).toBe(0);
      expect(v.t[2], JSON.stringify(raw)).toBeNull();
      expect(v.t.some((t) => t === 0)).toBe(false);
      expect(completenessOf(v.m)).toBeCloseTo((100 * 8) / 9, 12);
    }
    expect(at(' fl ').t[2]).toBe(1);
    expect(at('ZZ').t[2]).toBe(0);
  });

  it('blank submission type, line and state together drop completeness to 6/9', () => {
    const base = submissionB1();
    const v = vectorize(
      {
        ...base,
        lineOfBusiness: '  ' as LineOfBusiness,
        submissionType: [{ value: '' as SubmissionType, provenance: { source: 'self_reported' } }],
        rollup: { ...base.rollup!, primaryState: ' ' },
      },
      SPEC,
      RULEBOOK,
    );
    expect(v.m.slice(0, 3)).toEqual([0, 0, 0]);
    expect(v.t.some((t) => t === 0)).toBe(false);
    expect(completenessOf(v.m)).toBeCloseTo((100 * 6) / 9, 12);
  });
});

describe('PRD 12 — every scaled component is finite and in [0, 1]', () => {
  const MAX = Number.MAX_VALUE;
  const absurd: readonly (number | null)[] = [1, 1, 2, MAX, -MAX, -MAX, -0.5, 1.5, MAX, -3, 42];

  const inUnit = (scaled: readonly (number | null)[]) => {
    for (const [i, s] of scaled.entries()) {
      expect(s, `component ${i}`).not.toBeNull();
      expect(Number.isFinite(s as number), `component ${i} = ${String(s)}`).toBe(true);
      expect(s as number, `component ${i}`).toBeGreaterThanOrEqual(0);
      expect(s as number, `component ${i}`).toBeLessThanOrEqual(1);
    }
  };

  it('±Number.MAX_VALUE and negative shares scale into [0, 1] against a normal book', () => {
    const stats = computeBookStats(
      [
        vectorOf([1, 1, 2, 10_000_000, 50_000, 0, 0, 1, 0, 0, 1]),
        vectorOf([1, 1, 2, 100_000_000, 200_000, 0.5, 0.5, 0.5, 1_000_000, 1, 10]),
      ],
      SPEC,
    );
    inUnit(scaleVector(absurd, SPEC, stats));
  });

  it('stays in [0, 1] against a book that itself contains ±Number.MAX_VALUE', () => {
    const stats = computeBookStats(
      [
        vectorOf(absurd),
        vectorOf([1, 1, 2, -MAX, MAX, MAX, MAX, -MAX, -MAX, MAX, -MAX]),
        vectorOf([1, 1, 2, 10_000_000, 50_000, 0, 0, 1, 0, 0, 1]),
      ],
      SPEC,
    );
    inUnit(scaleVector(absurd, SPEC, stats));
    inUnit(scaleVector([1, 1, 2, 10_000_000, 50_000, 0, 0, 1, 0, 0, 1], SPEC, stats));
  });

  it('a book whose raw min/max span overflows to Infinity never yields NaN', () => {
    const stats: BookStats = {
      ...computeBookStats([vectorOf(B1)], SPEC),
      components: SPEC.components.map((c) => ({
        index: c.index,
        key: c.key,
        min: -MAX,
        max: MAX,
        mean: 0,
        median: 0,
        count: 2,
      })),
    };
    inUnit(scaleVector(absurd, SPEC, stats));
    const mid = scaleVector(withComponent(B1, 3, 0), SPEC, stats);
    expect(mid[3]).toBeCloseTo(0.5, 12);
  });

  it('null / NaN / ±Infinity stay MISSING (null), and absurd finite values stay KNOWN', () => {
    const x = [1, 1, 2, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, null, -MAX, MAX, null, null];
    const scaled = scaleVector(x, SPEC, computeBookStats([vectorOf(B1)], SPEC));
    expect(scaled.slice(3, 7)).toEqual([null, null, null, null]);
    expect(scaled[7]).toBe(0);
    expect(scaled[8]).not.toBeNull();
  });

  it('case 40: an absurd submission vectorizes with every component known and scales into [0, 1]', () => {
    const base = submissionB1();
    const v = vectorize(
      {
        ...base,
        rollup: { ...base.rollup!, pctTivPre1990: -MAX, fiveYearLoss: MAX, pctTivPost2010: -0.5 },
      },
      SPEC,
      RULEBOOK,
    );
    expect(v.m.slice(0, 9)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(v.t[8]).toBe(0);
    const stats = computeBookStats([v, vectorOf(B1)], SPEC);
    const scaled = scaleVector(v.x, SPEC, stats);
    for (const s of scaled.slice(0, 9)) {
      expect(Number.isFinite(s as number)).toBe(true);
      expect(s as number).toBeGreaterThanOrEqual(0);
      expect(s as number).toBeLessThanOrEqual(1);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Local builders                                                             */
/* -------------------------------------------------------------------------- */

function vectorOf(x: readonly (number | null)[]): FeatureVector {
  return {
    lineOfBusiness: 'commercial_property',
    specVersion: '1.0.0',
    x: [...x],
    t: tiersFor(x, SPEC, RULEBOOK),
    m: x.map((value) => (value === null ? 0 : 1)),
  };
}

/** The §8 B1 account as a canonical submission. */
function submissionB1(): CanonicalSubmission {
  return {
    id: 'B1',
    lineOfBusiness: 'commercial_property',
    submissionType: [{ value: 'new_business', provenance: { source: 'self_reported' } }],
    insured: {},
    locations: [],
    buildings: [],
    hazards: { present: {} },
    exposure: {},
    coverage: { lines: [] },
    history: [],
    pricing: {
      quotedPremium: [{ value: 175_000, provenance: { source: 'self_reported' } }],
    },
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
    worstFloodZoneTier: null,
      primaryState: 'OH',
      stateShares: [],
      fiveYearLoss: 100_000,
      fiveYearClaimCount: 1,
      claimCount: 1,
      pre1990BuildingIds: [],
      oldestYearBuilt: 1995,
      newestYearBuilt: 1995,
      lossWindow: { from: '2020-05-17', to: '2025-05-17' },
    },
  };
}

/* -------------------------------------------------------------------------- */
/* R2 fixer 6 — tenant source paths (R-I4-1, R-I4-3)                           */
/* -------------------------------------------------------------------------- */

describe('vectorize — tenant source paths as vectors/tenant.json writes them', () => {
  const tenantComponent = (index: number, key: string, source: string): VectorComponentSpec => ({
    index,
    key,
    label: key,
    source,
    type: 'binary',
    scaling: { rule: 'none' },
    direction: 'lower_better',
    appetiteFactor: false,
    factor: null,
    extensionOnly: false,
    immovable: false,
    required: true,
  });
  const TENANT_SPEC: VectorSpec = {
    lineOfBusiness: 'tenant',
    version: '1.0.0',
    components: [
      tenantComponent(0, 'hazardPortableHeater', 'hazards.portableHeater'),
      tenantComponent(1, 'hazardHeaterNearCombustible', 'hazards.heaterNearCombustible'),
      tenantComponent(2, 'hazardCandle', 'hazards.candle'),
      tenantComponent(3, 'smokeDetectorCount', 'hazards.smokeDetectorCount'),
      tenantComponent(4, 'buildingYearBuilt', 'buildings[0].yearBuilt'),
    ],
  };
  const sweep = { source: 'sweep' as const, confidence: 0.88 };
  const tenant = (withYear: boolean): CanonicalSubmission => ({
    id: 'T1',
    lineOfBusiness: 'tenant' as LineOfBusiness,
    insured: {},
    locations: [],
    buildings: withYear
      ? [{ externalId: 'B1', yearBuilt: [{ value: 1962, provenance: { source: 'answer' } }] }]
      : [],
    hazards: {
      present: {
        portableHeater: [{ value: true, provenance: sweep }],
        heaterNearCombustible: [{ value: false, provenance: sweep }],
      },
      smokeDetectorCount: [{ value: 2, provenance: sweep }],
    },
    exposure: {},
    coverage: { lines: [] },
    history: [],
    pricing: {},
  });

  it('R-I4-1: a hazard merged under hazards.present.<key> is a known component', () => {
    const v = vectorize(tenant(false), TENANT_SPEC, RULEBOOK);
    expect(v.x[0]).toBe(1);
    expect(v.m[0]).toBe(1);
    expect(v.x[1]).toBe(0);
    expect(v.m[1]).toBe(1);
    // Not observed stays missing; a direct hazards.* leaf still reads directly.
    expect(v.m[2]).toBe(0);
    expect(v.x[3]).toBe(2);
  });

  it('R-I4-3: buildings[0].yearBuilt reads the first building', () => {
    const v = vectorize(tenant(true), TENANT_SPEC, RULEBOOK);
    expect(v.x[4]).toBe(1962);
    expect(v.m[4]).toBe(1);
    expect(vectorize(tenant(false), TENANT_SPEC, RULEBOOK).m[4]).toBe(0);
  });
});
