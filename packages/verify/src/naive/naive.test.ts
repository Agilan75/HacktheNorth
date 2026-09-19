/**
 * V01 tests — asserted straight against docs/contracts/INTERPRETATIONS.md.
 * Imports no engine package, now or ever.
 */
import { describe, expect, it } from 'vitest';
import type { NaiveInput } from '../types.js';
import { naiveEvaluate } from './index.js';

/** INTERPRETATIONS §8 base case B1. */
const B1: NaiveInput = {
  submissionType: 'new_business',
  lineOfBusiness: 'commercial_property',
  primaryState: 'OH',
  totalTiv: 150000000,
  quotedPremium: 175000,
  pctTivPre1990: 0,
  pctTivPost2010: 0,
  pctTivAcceptableConstruction: 0.5,
  fiveYearLoss: 100000,
  anyBuildingPre1990: false,
  hasOpenHighContradiction: false,
};

function withB1(patch: Partial<NaiveInput>): NaiveInput {
  return { ...B1, ...patch };
}

const ALL_MISSING: NaiveInput = {
  submissionType: null,
  lineOfBusiness: null,
  primaryState: null,
  totalTiv: null,
  quotedPremium: null,
  pctTivPre1990: null,
  pctTivPost2010: null,
  pctTivAcceptableConstruction: null,
  fiveYearLoss: null,
  anyBuildingPre1990: null,
  hasOpenHighContradiction: false,
};

function tiers(input: NaiveInput): (number | null)[] {
  return naiveEvaluate(input).factors.map((f) => f.tierValue);
}

describe('INTERPRETATIONS §8 worked boundary cases', () => {
  it('B1 — all boundaries at their friendly edge scores 84', () => {
    const r = naiveEvaluate(B1);
    expect(r.factors.map((f) => f.factorId)).toEqual([
      'submission_type',
      'line_of_business',
      'primary_risk_state',
      'tiv',
      'total_premium',
      'building_age',
      'construction_type',
      'loss_value',
    ]);
    expect(tiers(B1)).toEqual([1, 1, 1, 0.6, 0.6, 0.6, 1, 1]);
    expect(r.appetiteScore).toBeCloseTo(84, 9);
    expect(r.completeness).toBe(100);
    expect(r.knockoutFactorIds).toEqual([]);
    expect(r.verdict).toBe('FIT');
    expect(r.referReasons).toEqual([]);
    expect(r.decidingFactorId).toBe('tiv'); // lowest tier 0.6, highest weight 0.15
  });

  it('B2 — TIV 150000000.01 knocks out', () => {
    const r = naiveEvaluate(withB1({ totalTiv: 150000000.01 }));
    expect(r.factors[3]?.tierValue).toBe(0);
    expect(r.knockoutFactorIds).toEqual(['tiv']);
    expect(r.verdict).toBe('DOES_NOT_FIT');
    expect(r.decidingFactorId).toBe('tiv');
  });

  it('B3 — premium 49999.99 knocks out', () => {
    const r = naiveEvaluate(withB1({ quotedPremium: 49999.99 }));
    expect(r.factors[4]?.tierValue).toBe(0);
    expect(r.knockoutFactorIds).toEqual(['total_premium']);
    expect(r.verdict).toBe('DOES_NOT_FIT');
  });

  it('B4 — loss 100000.01 knocks out', () => {
    const r = naiveEvaluate(withB1({ fiveYearLoss: 100000.01 }));
    expect(r.factors[7]?.tierValue).toBe(0);
    expect(r.knockoutFactorIds).toEqual(['loss_value']);
    expect(r.verdict).toBe('DOES_NOT_FIT');
  });

  it('B5 — construction 0.4999 knocks out', () => {
    const r = naiveEvaluate(withB1({ pctTivAcceptableConstruction: 0.4999 }));
    expect(r.factors[6]?.tierValue).toBe(0);
    expect(r.knockoutFactorIds).toEqual(['construction_type']);
    expect(r.verdict).toBe('DOES_NOT_FIT');
  });

  it('B6 — pre-1990 share exactly 0.5 refers without a knockout, score unchanged', () => {
    const r = naiveEvaluate(withB1({ pctTivPre1990: 0.5, anyBuildingPre1990: true }));
    expect(r.factors[5]?.tierValue).toBe(0.6);
    expect(r.knockoutFactorIds).toEqual([]);
    expect(r.verdict).toBe('REFER');
    expect(r.referReasons).toEqual(['pre_1990_building']);
    expect(r.appetiteScore).toBeCloseTo(84, 9);
  });

  it('B7 — pre-1990 share 0.500001 knocks out and raises no refer', () => {
    const r = naiveEvaluate(withB1({ pctTivPre1990: 0.500001, anyBuildingPre1990: true }));
    expect(r.factors[5]?.tierValue).toBe(0);
    expect(r.knockoutFactorIds).toEqual(['building_age']);
    expect(r.verdict).toBe('DOES_NOT_FIT');
    expect(r.referReasons).toEqual([]);
  });

  it('B8 — every building 2010 gives building_age Target, score 88', () => {
    const r = naiveEvaluate(withB1({ pctTivPost2010: 1, pctTivPre1990: 0 }));
    expect(r.factors[5]?.tierValue).toBe(1);
    expect(r.appetiteScore).toBeCloseTo(88, 9);
    expect(r.verdict).toBe('FIT');
  });

  it('B9 — TIV 50M and premium 75K score 96', () => {
    const r = naiveEvaluate(withB1({ totalTiv: 50000000, quotedPremium: 75000 }));
    expect(tiers(withB1({ totalTiv: 50000000, quotedPremium: 75000 }))).toEqual([
      1, 1, 1, 1, 1, 0.6, 1, 1,
    ]);
    expect(r.appetiteScore).toBeCloseTo(96, 9);
    expect(r.decidingFactorId).toBe('building_age');
  });

  it('B10 — state NC drops to Acceptable, score 90', () => {
    const r = naiveEvaluate(
      withB1({ totalTiv: 50000000, quotedPremium: 75000, primaryState: 'NC' }),
    );
    expect(r.factors[2]?.tierValue).toBe(0.6);
    expect(r.appetiteScore).toBeCloseTo(90, 9);
    // tie at 0.6: primary_risk_state (w 0.15) beats building_age (w 0.10)
    expect(r.decidingFactorId).toBe('primary_risk_state');
  });

  it('B11 — missing premium: 81 points, 8/9 complete, REFER missing_data', () => {
    const r = naiveEvaluate(
      withB1({ totalTiv: 50000000, quotedPremium: null }),
    );
    expect(r.factors[4]?.tier).toBeNull();
    expect(r.factors[4]?.tierValue).toBeNull();
    expect(r.factors[4]?.points).toBe(0);
    expect(r.factors[4]?.knockout).toBe(false);
    expect(r.appetiteScore).toBeCloseTo(81, 9);
    expect(r.completeness).toBeCloseTo((8 / 9) * 100, 9);
    expect(r.knockoutFactorIds).toEqual([]);
    expect(r.verdict).toBe('REFER');
    expect(r.referReasons).toEqual(['missing_data']);
    expect(r.decidingFactorId).toBe('building_age');
  });

  it('B12 — renewal knocks out but still scores 86', () => {
    const r = naiveEvaluate(
      withB1({ totalTiv: 50000000, quotedPremium: 75000, submissionType: 'renewal' }),
    );
    expect(r.factors[0]?.tierValue).toBe(0);
    expect(r.appetiteScore).toBeCloseTo(86, 9);
    expect(r.knockoutFactorIds).toEqual(['submission_type']);
    expect(r.verdict).toBe('DOES_NOT_FIT');
    expect(r.decidingFactorId).toBe('submission_type');
  });
});

describe('§3 bold boundary rows, both sides', () => {
  const tivTier = (v: number) => naiveEvaluate(withB1({ totalTiv: v })).factors[3]?.tierValue;
  const premTier = (v: number) =>
    naiveEvaluate(withB1({ quotedPremium: v })).factors[4]?.tierValue;
  const lossTier = (v: number) => naiveEvaluate(withB1({ fiveYearLoss: v })).factors[7]?.tierValue;

  it('3.1 TIV $50M / $100M / $150M', () => {
    expect(tivTier(49999999.99)).toBe(0.6);
    expect(tivTier(50000000)).toBe(1);
    expect(tivTier(50000000.01)).toBe(1);
    expect(tivTier(99999999.99)).toBe(1);
    expect(tivTier(100000000)).toBe(1);
    expect(tivTier(100000000.01)).toBe(0.6);
    expect(tivTier(149999999.99)).toBe(0.6);
    expect(tivTier(150000000)).toBe(0.6);
    expect(tivTier(150000000.01)).toBe(0);
    expect(tivTier(0)).toBe(0.6); // known, not missing
  });

  it('3.2 premium $50K / $75K / $100K / $175K', () => {
    expect(premTier(49999.99)).toBe(0);
    expect(premTier(50000)).toBe(0.6);
    expect(premTier(50000.01)).toBe(0.6);
    expect(premTier(74999.99)).toBe(0.6);
    expect(premTier(75000)).toBe(1);
    expect(premTier(75000.01)).toBe(1);
    expect(premTier(99999.99)).toBe(1);
    expect(premTier(100000)).toBe(1);
    expect(premTier(100000.01)).toBe(0.6);
    expect(premTier(175000)).toBe(0.6);
    expect(premTier(175000.01)).toBe(0);
  });

  it('3.3 loss exactly $100,000 is Acceptable → T-BLANK', () => {
    expect(lossTier(99999.99)).toBe(1);
    expect(lossTier(100000)).toBe(1);
    expect(lossTier(100000.01)).toBe(0);
    expect(lossTier(0)).toBe(1); // zero claims is known
  });

  it('3.4 building age shares at exactly 0.5', () => {
    const age = (pre: number, post: number) =>
      naiveEvaluate(withB1({ pctTivPre1990: pre, pctTivPost2010: post })).factors[5]?.tierValue;
    expect(age(0.5, 0)).toBe(0.6);
    expect(age(0.500001, 0)).toBe(0);
    expect(age(0, 0.5)).toBe(0.6);
    expect(age(0, 0.500001)).toBe(1);
    expect(age(0.5, 0.5)).toBe(0.6);
    // Not Acceptable is checked before Target
    expect(age(0.6, 0.9)).toBe(0);
  });

  it('3.5 construction exactly 0.5 is Acceptable → T-BLANK', () => {
    const c = (v: number) =>
      naiveEvaluate(withB1({ pctTivAcceptableConstruction: v })).factors[6]?.tierValue;
    expect(c(0.499999)).toBe(0);
    expect(c(0.5)).toBe(1);
    expect(c(0.500001)).toBe(1);
    expect(c(0)).toBe(0);
    expect(c(1)).toBe(1);
  });

  it('3.6 state lists: Target subset first, then Acceptable, then out-of-list', () => {
    const s = (v: string) => naiveEvaluate(withB1({ primaryState: v })).factors[2]?.tierValue;
    for (const st of ['OH', 'PA', 'MD', 'CO', 'CA', 'FL']) expect(s(st)).toBe(1);
    for (const st of ['NC', 'SC', 'GA', 'VA', 'UT']) expect(s(st)).toBe(0.6);
    for (const st of ['NY', 'TX', 'ZZ']) expect(s(st)).toBe(0);
  });

  it('3.7/3.8 submission type and line of business', () => {
    expect(naiveEvaluate(withB1({ submissionType: 'renewal' })).factors[0]?.tierValue).toBe(0);
    expect(naiveEvaluate(withB1({ submissionType: 'other' })).factors[0]?.tierValue).toBe(0);
    expect(naiveEvaluate(withB1({ lineOfBusiness: 'general_liability' })).factors[1]?.tierValue)
      .toBe(0);
  });
});

describe('missing data, hostile values and determinism', () => {
  it('all missing: score 0, completeness 0, REFER, no deciding factor', () => {
    const r = naiveEvaluate(ALL_MISSING);
    expect(r.appetiteScore).toBe(0);
    expect(r.completeness).toBe(0);
    expect(r.verdict).toBe('REFER');
    expect(r.referReasons).toEqual(['missing_data']);
    expect(r.knockoutFactorIds).toEqual([]);
    expect(r.decidingFactorId).toBeNull();
    expect(r.factors).toHaveLength(8);
    expect(r.factors.every((f) => f.tier === null && f.tierValue === null && f.points === 0)).toBe(
      true,
    );
  });

  it('building age is jointly known or jointly missing and counts 2 components', () => {
    const r = naiveEvaluate(withB1({ pctTivPost2010: null }));
    expect(r.factors[5]?.tierValue).toBeNull();
    expect(r.completeness).toBeCloseTo((7 / 9) * 100, 9); // both components drop
    expect(r.verdict).toBe('REFER');
  });

  it('a missing factor never knocks out', () => {
    const r = naiveEvaluate({ ...ALL_MISSING, submissionType: 'renewal' });
    expect(r.knockoutFactorIds).toEqual(['submission_type']);
    expect(r.verdict).toBe('DOES_NOT_FIT');
    expect(r.completeness).toBeCloseTo((1 / 9) * 100, 9);
  });

  it('non-finite numbers are missing, never zero', () => {
    const r = naiveEvaluate(withB1({ totalTiv: Number.NaN, quotedPremium: Number.POSITIVE_INFINITY }));
    expect(r.factors[3]?.tierValue).toBeNull();
    expect(r.factors[4]?.tierValue).toBeNull();
    expect(r.knockoutFactorIds).toEqual([]);
  });

  it('hostile values never throw', () => {
    const hostile: NaiveInput[] = [
      withB1({ totalTiv: -1 }),
      withB1({ totalTiv: Number.MAX_VALUE }),
      withB1({ quotedPremium: 1e18 }),
      withB1({ quotedPremium: -0 }),
      withB1({ primaryState: '' }),
      withB1({ primaryState: '  oh ' }),
      withB1({ pctTivAcceptableConstruction: 1.0000001 }),
      withB1({ pctTivPre1990: -0.0000001, pctTivPost2010: 1.0000001 }),
      withB1({ fiveYearLoss: -50000 }),
      withB1({ submissionType: '' }),
      ALL_MISSING,
    ];
    for (const input of hostile) {
      expect(() => naiveEvaluate(input)).not.toThrow();
    }
    expect(naiveEvaluate(withB1({ totalTiv: -1 })).factors[3]?.tierValue).toBe(0.6);
    expect(naiveEvaluate(withB1({ quotedPremium: 1e18 })).factors[4]?.tierValue).toBe(0);
    expect(naiveEvaluate(withB1({ primaryState: '  oh ' })).factors[2]?.tierValue).toBe(1);
    expect(naiveEvaluate(withB1({ primaryState: '' })).factors[2]?.tierValue).toBe(0);
    expect(naiveEvaluate(withB1({ fiveYearLoss: -50000 })).factors[7]?.tierValue).toBe(1);
    expect(
      naiveEvaluate(withB1({ pctTivAcceptableConstruction: 1.0000001 })).factors[6]?.tierValue,
    ).toBe(1);
  });

  it('open HIGH contradiction refers only after completeness', () => {
    const complete = naiveEvaluate(withB1({ hasOpenHighContradiction: true }));
    expect(complete.verdict).toBe('REFER');
    expect(complete.referReasons).toEqual(['open_high_contradiction']);
    const incomplete = naiveEvaluate(
      withB1({ hasOpenHighContradiction: true, fiveYearLoss: null }),
    );
    expect(incomplete.referReasons).toEqual(['missing_data']);
  });

  it('the age refer needs an actual pre-1990 building, not just a zero share', () => {
    expect(naiveEvaluate(withB1({ pctTivPre1990: 0, anyBuildingPre1990: false })).verdict).toBe(
      'FIT',
    );
    const r = naiveEvaluate(withB1({ pctTivPre1990: 0, anyBuildingPre1990: true }));
    expect(r.verdict).toBe('REFER');
    expect(r.referReasons).toEqual(['pre_1990_building']);
    expect(r.decidingFactorId).toBe('tiv'); // the refer reason never moves it
  });

  it('points are weight × tierValue × 100', () => {
    const r = naiveEvaluate(B1);
    expect(r.factors[3]?.points).toBeCloseTo(9, 9); // tiv 0.15 × 0.6 × 100
    expect(r.factors[5]?.points).toBeCloseTo(6, 9); // building_age 0.10 × 0.6 × 100
    expect(r.factors.reduce((a, f) => a + f.weight, 0)).toBeCloseTo(1, 9);
  });

  it('knockout ids come back in weight-table order', () => {
    const r = naiveEvaluate(
      withB1({ fiveYearLoss: 200000, submissionType: 'renewal', totalTiv: 2e8 }),
    );
    expect(r.knockoutFactorIds).toEqual(['submission_type', 'tiv', 'loss_value']);
    expect(r.decidingFactorId).toBe('submission_type');
  });

  it('is deterministic', () => {
    const a = naiveEvaluate(withB1({ totalTiv: 50000000, quotedPremium: null }));
    const b = naiveEvaluate(withB1({ totalTiv: 50000000, quotedPremium: null }));
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});
