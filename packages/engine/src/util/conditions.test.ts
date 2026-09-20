import { describe, expect, it } from 'vitest';

import {
  ACCEPTABLE_STATES,
  TARGET_STATES,
  TIV_ACCEPTABLE_MAX,
  TIV_TARGET_MAX,
  TIV_TARGET_MIN,
} from '../constants.js';
import type { Condition, FeatureVector, VectorSpec } from '../types.js';
import { evaluateCondition, evaluateConditions, isUndetermined, vectorResolver } from './conditions.js';

const ctx = (values: Record<string, unknown>) => (field: string) => values[field];

describe('evaluateCondition — ordering operators at the INTERPRETATIONS boundaries', () => {
  const gteTargetMin: Condition = { field: 'totalTiv', op: 'gte', value: TIV_TARGET_MIN };
  const lteTargetMax: Condition = { field: 'totalTiv', op: 'lte', value: TIV_TARGET_MAX };
  const gtAcceptableMax: Condition = { field: 'totalTiv', op: 'gt', value: TIV_ACCEPTABLE_MAX };

  it('treats $50,000,000 as inside the TIV Target band (3.1, inclusive)', () => {
    expect(evaluateCondition(gteTargetMin, ctx({ totalTiv: 50_000_000 }))).toBe(true);
    expect(evaluateCondition(lteTargetMax, ctx({ totalTiv: 50_000_000 }))).toBe(true);
  });

  it('treats $100,000,000 as inside and $100,000,000.01 as outside', () => {
    expect(evaluateCondition(lteTargetMax, ctx({ totalTiv: 100_000_000 }))).toBe(true);
    expect(evaluateCondition(lteTargetMax, ctx({ totalTiv: 100_000_000.01 }))).toBe(false);
  });

  it('treats exactly $150,000,000 as NOT over the Acceptable maximum', () => {
    expect(evaluateCondition(gtAcceptableMax, ctx({ totalTiv: TIV_ACCEPTABLE_MAX }))).toBe(false);
    expect(evaluateCondition(gtAcceptableMax, ctx({ totalTiv: 150_000_000.01 }))).toBe(true);
  });

  it('treats yearBuilt 1990 as not pre-1990 and 1989 as pre-1990 (G-5, YEAR_PRE_CUTOFF)', () => {
    const pre1990: Condition = { field: 'yearBuilt', op: 'lt', value: 1990 };
    expect(evaluateCondition(pre1990, ctx({ yearBuilt: 1990 }))).toBe(false);
    expect(evaluateCondition(pre1990, ctx({ yearBuilt: 1989 }))).toBe(true);
  });

  it('is false when the compared value is not a finite number', () => {
    const c: Condition = { field: 'totalTiv', op: 'gte', value: 'a lot' };
    expect(evaluateCondition(c, ctx({ totalTiv: 60_000_000 }))).toBe(false);
  });
});

describe('evaluateCondition — missing operands (G-1, G-2)', () => {
  const ops = ['lt', 'lte', 'gt', 'gte', 'eq', 'neq', 'in', 'notin', 'exists'] as const;

  for (const missingValue of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY]) {
    it(`treats ${String(missingValue)} as missing for every op but 'missing'`, () => {
      const resolve = ctx({ totalTiv: missingValue });
      for (const op of ops) {
        const c: Condition = { field: 'totalTiv', op, value: 1 };
        expect(evaluateCondition(c, resolve)).toBe(false);
      }
      expect(evaluateCondition({ field: 'totalTiv', op: 'missing' }, resolve)).toBe(true);
    });
  }

  it('0 is a known value, not missing', () => {
    const resolve = ctx({ fiveYearLoss: 0 });
    expect(evaluateCondition({ field: 'fiveYearLoss', op: 'missing' }, resolve)).toBe(false);
    expect(evaluateCondition({ field: 'fiveYearLoss', op: 'exists' }, resolve)).toBe(true);
    expect(evaluateCondition({ field: 'fiveYearLoss', op: 'lt', value: 100_000 }, resolve)).toBe(
      true,
    );
  });
});

describe('evaluateCondition — membership and equality (G-7, G-8)', () => {
  it('matches state codes case-insensitively after trimming', () => {
    const inTarget: Condition = { field: 'primaryState', op: 'in', value: [...TARGET_STATES] };
    expect(evaluateCondition(inTarget, ctx({ primaryState: 'OH' }))).toBe(true);
    expect(evaluateCondition(inTarget, ctx({ primaryState: ' oh ' }))).toBe(true);
    expect(evaluateCondition(inTarget, ctx({ primaryState: 'NC' }))).toBe(false);
  });

  it('NC is acceptable but not target; TX is in neither list', () => {
    const inAcceptable: Condition = {
      field: 'primaryState',
      op: 'in',
      value: [...ACCEPTABLE_STATES],
    };
    const notInAcceptable: Condition = {
      field: 'primaryState',
      op: 'notin',
      value: [...ACCEPTABLE_STATES],
    };
    expect(evaluateCondition(inAcceptable, ctx({ primaryState: 'NC' }))).toBe(true);
    expect(evaluateCondition(notInAcceptable, ctx({ primaryState: 'TX' }))).toBe(true);
    expect(evaluateCondition(notInAcceptable, ctx({ primaryState: 'NC' }))).toBe(false);
  });

  it('compares construction classes after snake_case folding', () => {
    const c: Condition = { field: 'constructionType', op: 'eq', value: 'masonry_non_combustible' };
    expect(evaluateCondition(c, ctx({ constructionType: 'Masonry_Non_Combustible' }))).toBe(true);
    expect(evaluateCondition(c, ctx({ constructionType: 'frame' }))).toBe(false);
  });

  it('compares booleans and numbers strictly', () => {
    expect(evaluateCondition({ field: 'a', op: 'eq', value: true }, ctx({ a: true }))).toBe(true);
    expect(evaluateCondition({ field: 'a', op: 'eq', value: true }, ctx({ a: 1 }))).toBe(false);
    expect(evaluateCondition({ field: 'a', op: 'neq', value: 1 }, ctx({ a: 2 }))).toBe(true);
  });

  it('is false when an in/notin condition carries no list', () => {
    expect(evaluateCondition({ field: 'a', op: 'in', value: 'OH' }, ctx({ a: 'OH' }))).toBe(false);
    expect(evaluateCondition({ field: 'a', op: 'notin' }, ctx({ a: 'OH' }))).toBe(false);
  });
});

describe('evaluateConditions', () => {
  it('ANDs every condition', () => {
    const band: Condition[] = [
      { field: 'quotedPremium', op: 'gte', value: 75_000 },
      { field: 'quotedPremium', op: 'lte', value: 100_000 },
    ];
    expect(evaluateConditions(band, ctx({ quotedPremium: 75_000 }))).toBe(true);
    expect(evaluateConditions(band, ctx({ quotedPremium: 100_000 }))).toBe(true);
    expect(evaluateConditions(band, ctx({ quotedPremium: 74_999.99 }))).toBe(false);
  });

  it('an empty list is false, never vacuously true', () => {
    expect(evaluateConditions([], ctx({}))).toBe(false);
  });
});

describe('isUndetermined', () => {
  it('is true when any operand is missing', () => {
    const conditions: Condition[] = [
      { field: 'totalTiv', op: 'gte', value: 50_000_000 },
      { field: 'quotedPremium', op: 'gte', value: 50_000 },
    ];
    expect(isUndetermined(conditions, ctx({ totalTiv: 6e7, quotedPremium: 8e4 }))).toBe(false);
    expect(isUndetermined(conditions, ctx({ totalTiv: 6e7 }))).toBe(true);
    expect(isUndetermined(conditions, ctx({ totalTiv: 6e7, quotedPremium: Number.NaN }))).toBe(true);
  });

  it('presence operators are always determined', () => {
    expect(isUndetermined([{ field: 'x', op: 'missing' }], ctx({}))).toBe(false);
    expect(isUndetermined([{ field: 'x', op: 'exists' }], ctx({}))).toBe(false);
  });
});

describe('vectorResolver', () => {
  const spec: VectorSpec = {
    lineOfBusiness: 'commercial_property',
    version: 'test-1',
    components: [
      {
        index: 0,
        key: 'isNewBusiness',
        label: 'New business',
        source: 'submissionType',
        type: 'binary',
        scaling: { rule: 'none' },
        direction: 'higher_better',
        appetiteFactor: true,
        factor: 'submission_type',
        extensionOnly: false,
        immovable: true,
        required: true,
      },
      {
        index: 1,
        key: 'totalTiv',
        label: 'Total insured value',
        source: 'rollup.totalTiv',
        type: 'currency',
        scaling: { rule: 'log_minmax' },
        direction: 'band',
        appetiteFactor: true,
        factor: 'tiv',
        extensionOnly: false,
        immovable: false,
        required: true,
      },
      {
        index: 2,
        key: 'quotedPremium',
        label: 'Quoted premium',
        source: 'pricing.quotedPremium',
        type: 'currency',
        scaling: { rule: 'log_minmax' },
        direction: 'band',
        appetiteFactor: true,
        factor: 'total_premium',
        extensionOnly: false,
        immovable: false,
        required: true,
      },
    ],
  };

  const vector: FeatureVector = {
    lineOfBusiness: 'commercial_property',
    specVersion: 'test-1',
    x: [1, 60_000_000, null],
    t: [1, 1, null],
    m: [1, 1, 0],
  };

  it('reads x by component key', () => {
    const resolve = vectorResolver(vector, spec);
    expect(resolve('totalTiv')).toBe(60_000_000);
    expect(resolve('isNewBusiness')).toBe(1);
  });

  it('reads tier values with the .t suffix and the mask with .m', () => {
    const resolve = vectorResolver(vector, spec);
    expect(resolve('totalTiv.t')).toBe(1);
    expect(resolve('totalTiv.m')).toBe(true);
    expect(resolve('quotedPremium.m')).toBe(false);
  });

  it('a masked-out component is missing, not 0 (G-2)', () => {
    const resolve = vectorResolver(vector, spec);
    expect(resolve('quotedPremium')).toBeUndefined();
    expect(evaluateCondition({ field: 'quotedPremium', op: 'missing' }, resolve)).toBe(true);
    expect(
      evaluateCondition({ field: 'quotedPremium', op: 'lt', value: 50_000 }, resolve),
    ).toBe(false);
  });

  it('an unknown key is missing', () => {
    const resolve = vectorResolver(vector, spec);
    expect(resolve('nope')).toBeUndefined();
  });
});
