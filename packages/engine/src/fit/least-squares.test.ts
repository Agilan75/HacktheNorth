import { describe, expect, it } from 'vitest';
import { fitError, fitMonotonic, isotonic } from './least-squares';
import type { FitRow } from './least-squares';
import { commercialPriors, priorFactors } from './priors';
import { commercialRatingTableSchema } from '../schemas';
import { isMonotonic } from '../util/math';

const OPTIONS = { monotonicOrder: commercialPriors(), maxIterations: 2000, tolerance: 1e-12 };

/** Deterministic LCG so the synthetic book is reproducible without Math.random. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const TRUE = {
  base: 0.37,
  construction: {
    'Wood Frame': 1.5,
    Frame: 1.4,
    'Joisted Masonry': 1.2,
    'Non-Combustible': 1.0,
    'Steel Frame': 0.97,
    'Masonry Non-Combustible': 0.93,
    'Modified Fire Resistive': 0.82,
    'Fire Resistive': 0.75,
  } as Record<string, number>,
  age: (y: number) => (y <= 1949 ? 1.25 : y <= 1969 ? 1.18 : y <= 1989 ? 1.08 : y <= 2009 ? 1.0 : 0.88),
  pc: (p: number) => (p <= 3 ? 0.92 : p <= 6 ? 1.0 : p <= 8 ? 1.2 : p <= 9 ? 1.4 : 1.7),
  spr: (s: boolean) => (s ? 0.8 : 1.0),
  loss: (l: number) => (l <= 0 ? 0.95 : l <= 25_000 ? 1.0 : l <= 100_000 ? 1.12 : l <= 250_000 ? 1.3 : 1.5),
};

function syntheticBook(count: number, seed: number): FitRow[] {
  const rnd = lcg(seed);
  const classes = Object.keys(TRUE.construction);
  const rows: FitRow[] = [];
  for (let i = 0; i < count; i += 1) {
    const cls = classes[Math.floor(rnd() * classes.length)] as string;
    const yearBuilt = 1948 + Math.floor(rnd() * 77);
    const protectionClass = 1 + Math.floor(rnd() * 10);
    const sprinklered = rnd() < 0.5;
    const fiveYearLoss = [0, 10_000, 60_000, 180_000, 400_000][Math.floor(rnd() * 5)] as number;
    const tiv = 1_000_000 + Math.floor(rnd() * 9_000_000);
    const premium =
      (tiv / 100) *
      TRUE.base *
      (TRUE.construction[cls] as number) *
      TRUE.age(yearBuilt) *
      TRUE.pc(protectionClass) *
      TRUE.spr(sprinklered) *
      TRUE.loss(fiveYearLoss);
    rows.push({ tiv, constructionClass: cls, yearBuilt, protectionClass, sprinklered, fiveYearLoss, technicalPremium: premium });
  }
  return rows;
}

describe('fitError', () => {
  it('computes MAPE as a fraction and R squared', () => {
    const e = fitError([100, 200, 300], [110, 180, 300]);
    expect(e.n).toBe(3);
    expect(e.mape).toBeCloseTo(0.2 / 3, 12);
    // ssRes = 100 + 400 = 500, ssTot = 20000
    expect(e.r2).toBeCloseTo(0.975, 12);
  });

  it('is perfect on an exact fit and empty on no data', () => {
    expect(fitError([5, 7], [5, 7])).toEqual({ mape: 0, r2: 1, n: 2 });
    expect(fitError([], [])).toEqual({ mape: 0, r2: 0, n: 0 });
  });

  it('drops non-finite pairs and skips zero actuals in MAPE', () => {
    const e = fitError([0, 100, Number.NaN], [10, 90, 5]);
    expect(e.n).toBe(2);
    expect(e.mape).toBeCloseTo(0.1, 12);
  });
});

describe('isotonic', () => {
  it('pools adjacent violators into weighted means (non-decreasing)', () => {
    expect(isotonic([1, 3, 2, 4], [1, 1, 1, 1])).toEqual([1, 2.5, 2.5, 4]);
    const w = isotonic([1, 3, 2], [1, 1, 3]);
    expect(w[0]).toBe(1);
    expect(w[1]).toBeCloseTo(2.25, 12);
    expect(w[2]).toBeCloseTo(2.25, 12);
  });

  it('leaves an already monotonic series alone', () => {
    expect(isotonic([1, 2, 3], [1, 1, 1])).toEqual([1, 2, 3]);
  });
});

describe('fitMonotonic', () => {
  it('returns the priors, unscaled, when there are no rows', () => {
    const { table, error } = fitMonotonic([], OPTIONS);
    const priors = priorFactors();
    expect(error).toEqual({ mape: 0, r2: 0, n: 0 });
    expect(table.baseRate).toBe(0.4);
    expect(table.construction).toEqual(priors['construction']);
    expect(table.sprinkler).toEqual({ sprinklered: 0.85, unsprinklered: 1 });
    expect(table.age.map((b) => [b.key, b.upTo, b.factor])).toEqual([
      ['built_pre_1950', 1949, 1.3],
      ['built_1950_1969', 1969, 1.2],
      ['built_1970_1989', 1989, 1.1],
      ['built_1990_2009', 2009, 1.0],
      ['built_2010_plus', null, 0.9],
    ]);
    expect(table.protectionClass.map((b) => b.upTo)).toEqual([3, 6, 8, 9, null]);
    expect(table.lossHistory.map((b) => b.upTo)).toEqual([0, 25_000, 100_000, 250_000, null]);
    expect(table.credibilityK).toBe(5);
    expect(() => commercialRatingTableSchema.parse(table)).not.toThrow();
  });

  it('recovers a monotonic multiplicative book almost exactly', () => {
    const rows = syntheticBook(600, 42);
    const { table, error } = fitMonotonic(rows, OPTIONS);
    expect(error.n).toBe(600);
    expect(error.mape).toBeLessThan(0.01);
    expect(error.r2).toBeGreaterThan(0.999);
    // Relative factors survive the fit: Wood Frame / Fire Resistive = 2.0 in truth.
    const c = table.construction;
    expect((c['Wood Frame'] as number) / (c['Fire Resistive'] as number)).toBeCloseTo(2.0, 1);
    expect(table.sprinkler.sprinklered / table.sprinkler.unsprinklered).toBeCloseTo(0.8, 2);
    expect(() => commercialRatingTableSchema.parse(table)).not.toThrow();
  });

  it('never makes a worse class cheaper, even when the data say so', () => {
    // Frame looks cheaper than Fire Resistive in this (inverted) data.
    const rows: FitRow[] = [];
    for (let i = 0; i < 20; i += 1) {
      const base = { tiv: 1_000_000, yearBuilt: 2000, protectionClass: 5, sprinklered: false, fiveYearLoss: 10_000 };
      rows.push({ ...base, constructionClass: 'Frame', technicalPremium: 3_000 });
      rows.push({ ...base, constructionClass: 'Fire Resistive', technicalPremium: 5_000 });
      // Sprinklered costs MORE here, which the fit must refuse.
      rows.push({ ...base, constructionClass: 'Non-Combustible', sprinklered: true, technicalPremium: 6_000 });
      // A newer building costs MORE here too.
      rows.push({ ...base, constructionClass: 'Non-Combustible', yearBuilt: 2015, technicalPremium: 6_000 });
      rows.push({ ...base, constructionClass: 'Non-Combustible', technicalPremium: 4_000 });
    }
    const { table } = fitMonotonic(rows, OPTIONS);
    const order = commercialPriors();
    const cons = (order['construction'] ?? []).map((k) => table.construction[k] as number);
    expect(isMonotonic(cons, 'non_increasing', 0)).toBe(true);
    expect(table.construction['Frame']).toBeGreaterThanOrEqual(table.construction['Fire Resistive'] as number);
    expect(table.sprinkler.sprinklered).toBeLessThanOrEqual(table.sprinkler.unsprinklered);
    // Age bands are stored ascending by year, oldest first: factors non-increasing.
    expect(isMonotonic(table.age.map((b) => b.factor), 'non_increasing', 0)).toBe(true);
    // Protection and loss bands ascending by upTo: factors non-decreasing.
    expect(isMonotonic(table.protectionClass.map((b) => b.factor), 'non_decreasing', 0)).toBe(true);
    expect(isMonotonic(table.lossHistory.map((b) => b.factor), 'non_decreasing', 0)).toBe(true);
  });

  it('treats an unknown class and unknown inputs as neutral', () => {
    const rows: FitRow[] = [
      { tiv: 2_000_000, constructionClass: 'Adobe', yearBuilt: 2000, protectionClass: null, sprinklered: null, fiveYearLoss: Number.NaN, technicalPremium: 8_000 },
      { tiv: 2_000_000, constructionClass: 'Adobe', yearBuilt: 2000, protectionClass: null, sprinklered: null, fiveYearLoss: Number.NaN, technicalPremium: 8_000 },
    ];
    const { table, error } = fitMonotonic(rows, OPTIONS);
    // Only base x age(1990-2009) is identified; construction keeps its priors.
    expect(table.construction).toEqual(priorFactors()['construction']);
    const age1990 = table.age.find((b) => b.key === 'built_1990_2009')?.factor as number;
    expect((20_000 * table.baseRate * age1990)).toBeCloseTo(8_000, -1);
    expect(error.mape).toBeLessThan(1e-3);
  });

  it('is deterministic', () => {
    const rows = syntheticBook(100, 7);
    expect(fitMonotonic(rows, OPTIONS)).toEqual(fitMonotonic(rows, OPTIONS));
  });
});
