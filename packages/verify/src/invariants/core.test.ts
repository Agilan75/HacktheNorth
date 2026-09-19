import { afterEach, describe, expect, it } from 'vitest';
import { naiveEvaluate } from '../naive/index.js';
import type { EngineResultView, GeneratedCase, NaiveInput } from '../types.js';
import {
  completenessAndConfidenceInRange,
  coreSuite,
  determinism,
  knockoutImpliesDoesNotFit,
  scoreInRange,
  setInvariantProbe,
} from './core.js';
import type { ProbedResult } from './core.js';

/** INTERPRETATIONS §8 B1. */
const B1: NaiveInput = {
  submissionType: 'new_business',
  lineOfBusiness: 'commercial_property',
  primaryState: 'OH',
  totalTiv: 150_000_000,
  quotedPremium: 175_000,
  pctTivPre1990: 0,
  pctTivPost2010: 0,
  pctTivAcceptableConstruction: 0.5,
  fiveYearLoss: 100_000,
  anyBuildingPre1990: false,
  hasOpenHighContradiction: false,
};

function mkCase(input: NaiveInput, caseId = 'c1'): GeneratedCase {
  return { caseId, seed: 7, index: 0, input, boundaries: {}, fromSubmission: false };
}

/** The naive oracle, adapted to the view — a stand-in engine for the probe. */
function view(input: NaiveInput): EngineResultView {
  const r = naiveEvaluate(input);
  const tiers: Record<string, number | null> = {};
  for (const f of r.factors) tiers[f.factorId] = f.tierValue;
  return {
    appetiteScore: r.appetiteScore,
    completeness: r.completeness,
    verdict: r.verdict,
    knockoutFactorIds: r.knockoutFactorIds,
    decidingFactorId: r.decidingFactorId,
    tierValuesByFactor: tiers,
  };
}

afterEach(() => setInvariantProbe(null));

describe('coreSuite', () => {
  it('lists the four core invariants', () => {
    const suite = coreSuite();
    expect(suite.name).toBe('core');
    expect(suite.invariants.map((i) => i.name)).toEqual([
      'determinism',
      'knockoutImpliesDoesNotFit',
      'scoreInRange',
      'completenessAndConfidenceInRange',
    ]);
  });

  it('passes every worked case B1, B2, B6, B11, B12 with the oracle as probe', () => {
    setInvariantProbe(view);
    const cases: NaiveInput[] = [
      B1,
      { ...B1, totalTiv: 150_000_000.01 },
      { ...B1, pctTivPre1990: 0.5, anyBuildingPre1990: true },
      { ...B1, totalTiv: 50_000_000, quotedPremium: null },
      { ...B1, submissionType: 'renewal', totalTiv: 50_000_000, quotedPremium: 75_000 },
    ];
    for (const input of cases) {
      const tc = mkCase(input);
      const r = view(input);
      for (const inv of coreSuite().invariants) expect(inv.check(tc, r)).toEqual([]);
    }
  });

  it('never throws on an all-missing input or an absurd result', () => {
    const empty: NaiveInput = {
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
    const tc = mkCase(empty);
    const r = view(empty);
    expect(r.appetiteScore).toBe(0);
    expect(r.completeness).toBe(0);
    for (const inv of coreSuite().invariants) expect(inv.check(tc, r)).toEqual([]);

    const junk = {
      appetiteScore: Number.NaN,
      completeness: Number.POSITIVE_INFINITY,
      verdict: 'MAYBE',
      knockoutFactorIds: null,
      decidingFactorId: null,
      tierValuesByFactor: null,
    } as unknown as EngineResultView;
    for (const inv of coreSuite().invariants) expect(() => inv.check(mkCase(empty, 'junk'), junk)).not.toThrow();
  });
});

describe('determinism', () => {
  it('flags a repeated input that came back different, even without a probe', () => {
    const input = { ...B1, fiveYearLoss: 12_345 };
    const r = view(input);
    expect(determinism(mkCase(input, 'a'), r)).toEqual([]);
    expect(determinism(mkCase(input, 'b'), r)).toEqual([]);
    const v = determinism(mkCase(input, 'c'), { ...r, appetiteScore: r.appetiteScore - 1 });
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ invariant: 'determinism', caseId: 'c', seed: 7 });
  });

  it('flags a non-deterministic engine through the probe', () => {
    let calls = 0;
    setInvariantProbe((input) => {
      calls += 1;
      const r = view(input);
      return { ...r, appetiteScore: r.appetiteScore + calls * 1e-3 };
    });
    const v = determinism(mkCase(B1), view(B1));
    expect(v.length).toBeGreaterThan(0);
    const expected = JSON.parse(String(v[0]?.expected)) as { appetiteScore: number; verdict: string };
    expect(expected.appetiteScore).toBeCloseTo(84, 9);
    expect(expected.verdict).toBe('FIT');
  });

  it('reports a probe that throws instead of throwing', () => {
    setInvariantProbe(() => {
      throw new Error('boom');
    });
    const v = determinism(mkCase({ ...B1, totalTiv: 1 }), view({ ...B1, totalTiv: 1 }));
    expect(v).toHaveLength(1);
    expect(v[0]?.message).toContain('boom');
  });
});

describe('knockoutImpliesDoesNotFit', () => {
  it('B2: a TIV knockout is DOES_NOT_FIT and passes', () => {
    const input = { ...B1, totalTiv: 150_000_000.01 };
    const r = view(input);
    expect(r.knockoutFactorIds).toEqual(['tiv']);
    expect(knockoutImpliesDoesNotFit(mkCase(input), r)).toEqual([]);
  });

  it('flags a knockout that was scored REFER', () => {
    const r = view({ ...B1, totalTiv: 150_000_000.01 });
    const v = knockoutImpliesDoesNotFit(mkCase(B1), { ...r, verdict: 'REFER' });
    expect(v.map((x) => x.message)).toContain('a knockout fired but the verdict is not DOES_NOT_FIT');
  });

  it('flags DOES_NOT_FIT with no knockout, and a zero tier missing from the knockout set', () => {
    const r = view(B1);
    expect(knockoutImpliesDoesNotFit(mkCase(B1), { ...r, verdict: 'DOES_NOT_FIT' })).toHaveLength(1);
    const hidden = { ...r, tierValuesByFactor: { ...r.tierValuesByFactor, loss_value: 0 } };
    expect(knockoutImpliesDoesNotFit(mkCase(B1), hidden)[0]?.expected).toEqual(['loss_value']);
  });
});

describe('scoreInRange', () => {
  it('B1 scores exactly 84 and passes', () => {
    const r = view(B1);
    expect(r.appetiteScore).toBeCloseTo(84, 6);
    expect(scoreInRange(mkCase(B1), r)).toEqual([]);
  });

  it('flags a score above 100, below 0, NaN, and a 0.5 tier value', () => {
    const r = view(B1);
    expect(scoreInRange(mkCase(B1), { ...r, appetiteScore: 100.001 })).toHaveLength(1);
    expect(scoreInRange(mkCase(B1), { ...r, appetiteScore: -0.01 })).toHaveLength(1);
    expect(scoreInRange(mkCase(B1), { ...r, appetiteScore: Number.NaN })).toHaveLength(1);
    const bad = { ...r, tierValuesByFactor: { ...r.tierValuesByFactor, tiv: 0.5 } };
    expect(scoreInRange(mkCase(B1), bad)[0]?.message).toContain('tiv');
  });

  it('accepts exactly 0 and exactly 100', () => {
    const r = view(B1);
    expect(scoreInRange(mkCase(B1), { ...r, appetiteScore: 0 })).toEqual([]);
    expect(scoreInRange(mkCase(B1), { ...r, appetiteScore: 100 })).toEqual([]);
  });
});

describe('completenessAndConfidenceInRange', () => {
  it('B11: completeness 8/9 = 88.888…%, REFER, passes', () => {
    const input = { ...B1, totalTiv: 50_000_000, quotedPremium: null };
    const r = view(input);
    expect(r.completeness).toBeCloseTo((100 * 8) / 9, 9);
    expect(r.verdict).toBe('REFER');
    expect(completenessAndConfidenceInRange(mkCase(input), r)).toEqual([]);
  });

  it('flags completeness off the k/9 grid, above 100, and FIT when incomplete', () => {
    const r = view(B1);
    expect(completenessAndConfidenceInRange(mkCase(B1), { ...r, completeness: 87.5 })[0]?.message).toContain('k/9');
    expect(completenessAndConfidenceInRange(mkCase(B1), { ...r, completeness: 111.11111111111111 }).length).toBeGreaterThan(0);
    const fitIncomplete = completenessAndConfidenceInRange(mkCase(B1), { ...r, completeness: (100 * 8) / 9 });
    expect(fitIncomplete.map((x) => x.message)).toContain('FIT with completeness below 100% (V-2)');
  });

  it('checks confidence only when reported: 1.2 and -0.1 fail, 0.63 passes', () => {
    const r = view(B1);
    const withConf = (c: number): ProbedResult => ({ ...r, confidence: c });
    expect(completenessAndConfidenceInRange(mkCase(B1), withConf(0.63))).toEqual([]);
    expect(completenessAndConfidenceInRange(mkCase(B1), withConf(1.2))).toHaveLength(1);
    expect(completenessAndConfidenceInRange(mkCase(B1), withConf(-0.1))).toHaveLength(1);
  });
});
