import { afterEach, describe, expect, it } from 'vitest';
import { naiveEvaluate } from '../naive/index.js';
import type { EngineResultView, GeneratedCase, NaiveInput } from '../types.js';
import { setInvariantProbe } from './core.js';
import type { ProbedResult } from './core.js';
import {
  monotonicSuite,
  premiumMonotonicInEveryFactor,
  scoreMonotonicInEveryFactor,
} from './monotonic.js';

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

function mkCase(input: NaiveInput): GeneratedCase {
  return { caseId: 'm1', seed: 11, index: 0, input, boundaries: {}, fromSubmission: false };
}

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

/**
 * A toy price with the right monotone shape: dearer with TIV, loss and old
 * stock, cheaper with new stock and acceptable construction.
 */
function price(input: NaiveInput): number | null {
  if (input.totalTiv === null || input.totalTiv <= 0) return null;
  const pre = input.pctTivPre1990 ?? 0;
  const post = input.pctTivPost2010 ?? 0;
  const ac = input.pctTivAcceptableConstruction ?? 0.5;
  const loss = input.fiveYearLoss ?? 0;
  return (input.totalTiv / 100) * 0.4 * (1 + 0.3 * pre - 0.1 * post) * (1.2 - 0.3 * ac) * (1 + loss / 1e6);
}

afterEach(() => setInvariantProbe(null));

const SAMPLES: NaiveInput[] = [
  B1,
  { ...B1, totalTiv: 150_000_000.01 },
  { ...B1, totalTiv: 20_000_000, quotedPremium: 49_999.99 },
  { ...B1, pctTivPre1990: 0.500001, anyBuildingPre1990: true },
  { ...B1, pctTivPre1990: 0.3, pctTivPost2010: 0.5, anyBuildingPre1990: true },
  { ...B1, primaryState: 'NC', submissionType: 'renewal', lineOfBusiness: 'auto' },
  { ...B1, quotedPremium: null, fiveYearLoss: null, pctTivPre1990: null, pctTivPost2010: null },
  { ...B1, totalTiv: 1e18, quotedPremium: -5, fiveYearLoss: 1e12, hasOpenHighContradiction: true },
];

describe('monotonicSuite', () => {
  it('lists both invariants', () => {
    expect(monotonicSuite().name).toBe('monotonic');
    expect(monotonicSuite().invariants.map((i) => i.name)).toEqual([
      'scoreMonotonicInEveryFactor',
      'premiumMonotonicInEveryFactor',
    ]);
  });
});

describe('scoreMonotonicInEveryFactor', () => {
  it('passes a correct engine on every sample', () => {
    setInvariantProbe(view);
    for (const input of SAMPLES) expect(scoreMonotonicInEveryFactor(mkCase(input), view(input))).toEqual([]);
  });

  it('without a probe still checks score = 100 × Σ w·t: B1 is 84, 84.5 is flagged', () => {
    const r = view(B1);
    expect(scoreMonotonicInEveryFactor(mkCase(B1), r)).toEqual([]);
    const v = scoreMonotonicInEveryFactor(mkCase(B1), { ...r, appetiteScore: 84.5 });
    expect(v).toHaveLength(1);
    expect(v[0]?.expected).toBeCloseTo(84, 9);
  });

  it('B8 (all post-2010) scores 88 and B9 96 through the dot product', () => {
    const b8 = view({ ...B1, pctTivPost2010: 1 });
    const b9 = view({ ...B1, totalTiv: 50_000_000, quotedPremium: 75_000 });
    expect(b8.appetiteScore).toBeCloseTo(88, 6);
    expect(b9.appetiteScore).toBeCloseTo(96, 6);
    expect(scoreMonotonicInEveryFactor(mkCase(B1), b8)).toEqual([]);
    expect(scoreMonotonicInEveryFactor(mkCase(B1), b9)).toEqual([]);
  });

  it('catches an engine whose TIV target band is inverted', () => {
    // Bug: TIV inside the $50M-$100M target band scores 0.6 instead of 1.
    setInvariantProbe((input) => {
      const r = view(input);
      const tiv = input.totalTiv;
      if (tiv !== null && tiv >= 50e6 && tiv <= 100e6) {
        return {
          ...r,
          appetiteScore: r.appetiteScore - 100 * 0.15 * 0.4,
          tierValuesByFactor: { ...r.tierValuesByFactor, tiv: 0.6 },
        };
      }
      return r;
    });
    const input = { ...B1, totalTiv: 120_000_000 };
    const v = scoreMonotonicInEveryFactor(mkCase(input), view(input));
    expect(v.length).toBe(0); // 0.6 → 0.6: no drop, the bug is invisible here
    const low = { ...B1, totalTiv: 30_000_000, quotedPremium: 90_000 };
    const brokenBase: ProbedResult = view(low);
    // Moving 30M → 75M must not lower the score; a dropping engine is caught.
    setInvariantProbe((i) => {
      const r = view(i);
      return i.totalTiv === 75_000_000 ? { ...r, appetiteScore: brokenBase.appetiteScore - 6 } : r;
    });
    const caught = scoreMonotonicInEveryFactor(mkCase(low), brokenBase);
    expect(caught.some((x) => x.message.includes('improving tiv lowered the appetite score'))).toBe(true);
  });

  it('reports an engine that throws on an improved input', () => {
    setInvariantProbe((input) => {
      if (input.fiveYearLoss === 0) throw new Error('divide by zero loss');
      return view(input);
    });
    const v = scoreMonotonicInEveryFactor(mkCase(B1), view(B1));
    expect(v.some((x) => x.message.includes('divide by zero loss'))).toBe(true);
  });
});

describe('premiumMonotonicInEveryFactor', () => {
  it('reports nothing without a probe or without a price', () => {
    expect(premiumMonotonicInEveryFactor(mkCase(B1), view(B1))).toEqual([]);
    setInvariantProbe((i) => ({ ...view(i), predictedPremium: null }));
    expect(premiumMonotonicInEveryFactor(mkCase(B1), view(B1))).toEqual([]);
  });

  it('passes a correctly monotone price on every sample', () => {
    setInvariantProbe((i) => ({ ...view(i), predictedPremium: price(i) }));
    for (const input of SAMPLES) {
      const base: ProbedResult = { ...view(input), predictedPremium: price(input) };
      expect(premiumMonotonicInEveryFactor(mkCase(input), base)).toEqual([]);
    }
  });

  it('catches a rating table where older buildings are cheaper', () => {
    setInvariantProbe((i) => {
      const p = price(i);
      return { ...view(i), predictedPremium: p === null ? null : p * (1 - 0.5 * (i.pctTivPre1990 ?? 0)) };
    });
    const input = { ...B1, pctTivPre1990: 0.2, pctTivPost2010: 0.3 };
    const v = premiumMonotonicInEveryFactor(mkCase(input), view(input));
    expect(v.some((x) => x.message.includes('worsening building_age made the premium cheaper'))).toBe(true);
  });

  it('catches a premium that falls as TIV rises', () => {
    setInvariantProbe((i) => ({ ...view(i), predictedPremium: i.totalTiv === null ? null : 1e12 / i.totalTiv }));
    const v = premiumMonotonicInEveryFactor(mkCase(B1), view(B1));
    expect(v.filter((x) => x.message.includes('tiv'))).toHaveLength(2);
  });
});
