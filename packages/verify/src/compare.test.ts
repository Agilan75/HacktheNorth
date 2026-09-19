import { describe, expect, it } from 'vitest';

import {
  REFERENCE_INPUTS,
  compareResults,
  engineViewForInput,
  numbersAgree,
} from './compare.js';
import { naiveEvaluate } from './naive/index.js';
import type { EngineResultView, GeneratedCase, NaiveInput, NaiveResult } from './types.js';

function caseOf(input: NaiveInput, index = 0): GeneratedCase {
  return { caseId: `t-${index}`, seed: 7, index, input, boundaries: {}, fromSubmission: false };
}

const [B1, B2, B3, B4, B5, B6, B7, B8, B9, B10, B11, B12] = REFERENCE_INPUTS as readonly NaiveInput[] as [
  NaiveInput, NaiveInput, NaiveInput, NaiveInput, NaiveInput, NaiveInput,
  NaiveInput, NaiveInput, NaiveInput, NaiveInput, NaiveInput, NaiveInput,
];

describe('numbersAgree (INTERPRETATIONS §7)', () => {
  it('agrees within the tolerance and not beyond it', () => {
    expect(numbersAgree(84, 84 + 1e-7, 1e-6)).toBe(true);
    expect(numbersAgree(84, 84 + 1e-6, 1e-6)).toBe(true);
    expect(numbersAgree(84, 84 + 2e-6, 1e-6)).toBe(false);
    expect(numbersAgree(0.6, 0.6000001, 1e-9)).toBe(false);
  });

  it('treats null and non-finite as missing (G-1)', () => {
    expect(numbersAgree(null, null, 1e-6)).toBe(true);
    expect(numbersAgree(null, 0, 1e-6)).toBe(false);
    expect(numbersAgree(0, null, 1e-6)).toBe(false);
    expect(numbersAgree(Number.NaN, null, 1e-6)).toBe(true);
    expect(numbersAgree(Number.POSITIVE_INFINITY, 1, 1e-6)).toBe(false);
  });

  it('never widens on a bad tolerance', () => {
    expect(numbersAgree(1, 1, Number.NaN)).toBe(true);
    expect(numbersAgree(1, 1.5, -1)).toBe(false);
  });
});

describe('engineViewForInput — INTERPRETATIONS §8 worked cases', () => {
  const expected: [string, NaiveInput, number, string, readonly string[]][] = [
    ['B1', B1, 84, 'FIT', []],
    ['B2', B2, 75, 'DOES_NOT_FIT', ['tiv']],
    ['B3', B3, 75, 'DOES_NOT_FIT', ['total_premium']],
    ['B4', B4, 74, 'DOES_NOT_FIT', ['loss_value']],
    ['B5', B5, 74, 'DOES_NOT_FIT', ['construction_type']],
    ['B6', B6, 84, 'REFER', []],
    ['B7', B7, 78, 'DOES_NOT_FIT', ['building_age']],
    ['B8', B8, 88, 'FIT', []],
    ['B9', B9, 96, 'FIT', []],
    ['B10', B10, 90, 'FIT', []],
    ['B11', B11, 81, 'REFER', []],
    ['B12', B12, 86, 'DOES_NOT_FIT', ['submission_type']],
  ];

  it.each(expected)('%s scores %d and is %s', (_label, input, score, verdict, knockouts) => {
    const view = engineViewForInput(input);
    expect(view.appetiteScore).toBeCloseTo(score, 6);
    expect(view.verdict).toBe(verdict);
    expect([...view.knockoutFactorIds].sort()).toEqual([...knockouts].sort());
  });

  it('B1 carries the tier vector 1,1,1,0.6,0.6,0.6,1,1', () => {
    const view = engineViewForInput(B1);
    expect(view.tierValuesByFactor).toEqual({
      submission_type: 1,
      line_of_business: 1,
      primary_risk_state: 1,
      tiv: 0.6,
      total_premium: 0.6,
      building_age: 0.6,
      construction_type: 1,
      loss_value: 1,
    });
    expect(view.completeness).toBe(100);
    // V-8(b): lowest tier 0.6, ties by highest weight (0.15), then factor order → tiv.
    expect(view.decidingFactorId).toBe('tiv');
  });

  it('B11 completeness is 8/9 of the nine required components (V-6)', () => {
    const view = engineViewForInput(B11);
    expect(view.completeness).toBeCloseTo((100 * 8) / 9, 9);
    expect(view.tierValuesByFactor['total_premium']).toBeNull();
  });

  it('an open HIGH contradiction turns B1 into REFER (V-3)', () => {
    expect(engineViewForInput({ ...B1, hasOpenHighContradiction: true }).verdict).toBe('REFER');
  });

  it('a missing line of business is missing, not "other line" (G-2)', () => {
    const view = engineViewForInput({ ...B1, lineOfBusiness: null });
    expect(view.tierValuesByFactor['line_of_business']).toBeNull();
    expect(view.knockoutFactorIds).not.toContain('line_of_business');
    expect(view.appetiteScore).toBeCloseTo(69, 6);
  });
});

describe('compareResults', () => {
  it('engine and naive agree on every INTERPRETATIONS §8 case', () => {
    REFERENCE_INPUTS.forEach((input, i) => {
      const outcome = compareResults(caseOf(input, i), engineViewForInput(input), naiveEvaluate(input));
      expect(outcome.disagreement).toBeNull();
      expect(outcome.agreed).toBe(true);
    });
  });

  it('reports every differing field with both sides and the tolerance', () => {
    const testCase = caseOf(B1, 99);
    const naive: NaiveResult = naiveEvaluate(B1);
    const engine: EngineResultView = {
      ...engineViewForInput(B1),
      appetiteScore: 84 + 2e-6,
      verdict: 'REFER',
      knockoutFactorIds: ['tiv'],
      decidingFactorId: 'building_age',
      tierValuesByFactor: { ...engineViewForInput(B1).tierValuesByFactor, tiv: 0 },
    };
    const outcome = compareResults(testCase, engine, naive);
    expect(outcome.agreed).toBe(false);
    expect(outcome.disagreement?.caseId).toBe('t-99');
    expect(outcome.disagreement?.seed).toBe(7);
    expect(outcome.disagreement?.input).toBe(B1);
    const byField = new Map(outcome.disagreement?.fields.map((f) => [f.field, f]));
    expect([...byField.keys()].sort()).toEqual(
      ['appetiteScore', 'decidingFactorId', 'knockoutFactorIds', 'tierValue.tiv', 'verdict'].sort(),
    );
    expect(byField.get('appetiteScore')).toEqual({ field: 'appetiteScore', engine: 84 + 2e-6, naive: naive.appetiteScore, tolerance: 1e-6 });
    expect(byField.get('verdict')).toEqual({ field: 'verdict', engine: 'REFER', naive: 'FIT', tolerance: null });
    expect(byField.get('tierValue.tiv')?.naive).toBe(0.6);
  });

  it('accepts sub-tolerance score noise and knockout sets in any order', () => {
    const input = { ...B2, quotedPremium: 49_999.99 };
    const naive = naiveEvaluate(input);
    const engine = engineViewForInput(input);
    expect(engine.knockoutFactorIds.length).toBe(2);
    const shuffled: EngineResultView = {
      ...engine,
      appetiteScore: engine.appetiteScore + 5e-7,
      knockoutFactorIds: [...engine.knockoutFactorIds].reverse(),
    };
    expect(compareResults(caseOf(input), shuffled, naive).agreed).toBe(true);
  });

  it('a missing tier on one side only is a disagreement', () => {
    const naive = naiveEvaluate(B1);
    const engine = engineViewForInput(B1);
    const outcome = compareResults(caseOf(B1), { ...engine, tierValuesByFactor: { ...engine.tierValuesByFactor, loss_value: null } }, naive);
    expect(outcome.disagreement?.fields).toEqual([
      { field: 'tierValue.loss_value', engine: null, naive: 1, tolerance: 1e-6 },
    ]);
  });
});
