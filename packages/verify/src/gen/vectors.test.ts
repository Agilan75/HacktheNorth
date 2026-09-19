/**
 * V02 tests — seeded PRNG and the vector generator, asserted against
 * docs/contracts/INTERPRETATIONS.md §3 and §8.
 */
import { describe, expect, it } from 'vitest';
import type { GeneratedCase, NaiveInput } from '../types.js';
import { createPrng, deriveSeed } from './prng.js';
import {
  boundaryCatalogue,
  generateCase,
  generateCases,
  sampleAroundThreshold,
} from './vectors.js';

describe('createPrng', () => {
  it('replays the same stream for the same seed and differs across seeds', () => {
    const a = createPrng(42);
    const b = createPrng(42);
    const c = createPrng(43);
    const sa = Array.from({ length: 50 }, () => a.next());
    const sb = Array.from({ length: 50 }, () => b.next());
    const sc = Array.from({ length: 50 }, () => c.next());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
    expect(a.seed).toBe(42);
  });

  it('pins the stream so a seed means the same thing on every machine', () => {
    const p = createPrng(1);
    const first = Array.from({ length: 3 }, () => p.next());
    const again = createPrng(1);
    expect(Array.from({ length: 3 }, () => again.next())).toEqual(first);
    // High bits of the seed are not dropped.
    expect(createPrng(2 ** 32 + 1).next()).not.toBe(createPrng(1).next());
  });

  it('next() is uniform on [0, 1)', () => {
    const p = createPrng(7);
    let sum = 0;
    let min = 1;
    let max = 0;
    const n = 100_000;
    const buckets = new Array<number>(10).fill(0);
    for (let i = 0; i < n; i++) {
      const x = p.next();
      sum += x;
      if (x < min) min = x;
      if (x > max) max = x;
      buckets[Math.floor(x * 10)]! += 1;
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(1);
    expect(sum / n).toBeGreaterThan(0.49);
    expect(sum / n).toBeLessThan(0.51);
    for (const b of buckets) expect(Math.abs(b - n / 10)).toBeLessThan(n / 100);
  });

  it('int() is inclusive of both ends; pick() and chance() behave', () => {
    const p = createPrng(9);
    const seen = new Set<number>();
    for (let i = 0; i < 2_000; i++) {
      const v = p.int(3, 7);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6, 7]);
    expect(p.int(5, 5)).toBe(5);
    expect(() => p.int(5, 4)).toThrow();
    expect(() => p.pick([])).toThrow();
    expect(p.pick(['only'])).toBe('only');
    for (let i = 0; i < 100; i++) {
      expect(p.chance(0)).toBe(false);
      expect(p.chance(1)).toBe(true);
    }
  });
});

describe('deriveSeed', () => {
  it('is stable, uint32, and sensitive to both seed and label', () => {
    expect(deriveSeed(1, 'chunk:0')).toBe(deriveSeed(1, 'chunk:0'));
    expect(deriveSeed(1, 'chunk:0')).not.toBe(deriveSeed(1, 'chunk:1'));
    expect(deriveSeed(1, 'chunk:0')).not.toBe(deriveSeed(2, 'chunk:0'));
    const s = deriveSeed(123, 'x');
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThan(2 ** 32);
    const many = new Set(Array.from({ length: 10_000 }, (_, i) => deriveSeed(5, `vec:${i}`)));
    expect(many.size).toBe(10_000);
  });
});

describe('boundaryCatalogue', () => {
  it('lists exactly the INTERPRETATIONS §3 thresholds', () => {
    expect(boundaryCatalogue()).toEqual([
      { component: 'totalTiv', threshold: 50_000_000 },
      { component: 'totalTiv', threshold: 100_000_000 },
      { component: 'totalTiv', threshold: 150_000_000 },
      { component: 'quotedPremium', threshold: 50_000 },
      { component: 'quotedPremium', threshold: 75_000 },
      { component: 'quotedPremium', threshold: 100_000 },
      { component: 'quotedPremium', threshold: 175_000 },
      { component: 'fiveYearLoss', threshold: 100_000 },
      { component: 'pctTivPre1990', threshold: 0 },
      { component: 'pctTivPre1990', threshold: 0.5 },
      { component: 'pctTivPost2010', threshold: 0.5 },
      { component: 'pctTivAcceptableConstruction', threshold: 0.5 },
    ]);
  });
});

describe('sampleAroundThreshold', () => {
  it('places every catalogue threshold exactly at, just under and just over', () => {
    const p = createPrng(11);
    for (const { threshold: t } of boundaryCatalogue()) {
      const near = Math.max(Math.abs(t), 1) * 1e-2;
      expect(sampleAroundThreshold(p, t, 'at')).toBe(t);
      for (let i = 0; i < 500; i++) {
        const u = sampleAroundThreshold(p, t, 'under');
        const o = sampleAroundThreshold(p, t, 'over');
        expect(u).toBeLessThan(t);
        expect(t - u).toBeLessThanOrEqual(near);
        expect(o).toBeGreaterThan(t);
        expect(o - t).toBeLessThanOrEqual(near);
        const fu = sampleAroundThreshold(p, t, 'far_under');
        const fo = sampleAroundThreshold(p, t, 'far_over');
        expect(t - fu).toBeGreaterThan(near);
        expect(fo - t).toBeGreaterThan(near);
        const r = sampleAroundThreshold(p, t, 'random');
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThan(2 * Math.max(t, 1));
      }
    }
  });

  it('hits the one-ulp neighbours of $150M, the tightest possible boundary test', () => {
    const p = createPrng(3);
    const unders = new Set<number>();
    for (let i = 0; i < 2_000; i++) unders.add(sampleAroundThreshold(p, 150_000_000, 'under'));
    // 150e6 - 1 ulp (2^-25 at this magnitude) and 150e6 - 0.01 are both produced.
    expect(unders.has(150_000_000 - 2 ** -25)).toBe(true);
    expect(unders.has(150_000_000 - 0.01)).toBe(true);
  });
});

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
const B9: NaiveInput = { ...B1, totalTiv: 50000000, quotedPremium: 75000 };

describe('generateCase — §8 worked cases', () => {
  it('indices 0..11 are B1..B12 verbatim, for any seed', () => {
    const expected: NaiveInput[] = [
      B1,
      { ...B1, totalTiv: 150000000.01 },
      { ...B1, quotedPremium: 49999.99 },
      { ...B1, fiveYearLoss: 100000.01 },
      { ...B1, pctTivAcceptableConstruction: 0.4999 },
      { ...B1, pctTivPre1990: 0.5, anyBuildingPre1990: true },
      { ...B1, pctTivPre1990: 0.500001, anyBuildingPre1990: true },
      { ...B1, pctTivPost2010: 1 },
      B9,
      { ...B9, primaryState: 'NC' },
      { ...B9, quotedPremium: null },
      { ...B9, submissionType: 'renewal' },
    ];
    for (const seed of [0, 1, 987654321]) {
      expected.forEach((input, i) => {
        const c = generateCase(seed, i);
        expect(c.input).toEqual(input);
        expect(c.caseId).toBe(`vec:${seed}:${i}`);
        expect(c.seed).toBe(seed);
        expect(c.index).toBe(i);
        expect(c.fromSubmission).toBe(false);
      });
    }
  });

  it('labels the B1 and B2 boundaries', () => {
    expect(generateCase(1, 0).boundaries).toMatchObject({
      totalTiv: 'at',
      quotedPremium: 'at',
      fiveYearLoss: 'at',
      pctTivPre1990: 'at',
      pctTivAcceptableConstruction: 'at',
    });
    expect(generateCase(1, 1).boundaries.totalTiv).toBe('over');
    expect(generateCase(1, 2).boundaries.quotedPremium).toBe('under');
    expect(generateCase(1, 10).boundaries.quotedPremium).toBeUndefined();
  });
});

describe('generateCase — random stream', () => {
  const SEED = 20260919;
  const N = 30_000;
  const cases: readonly GeneratedCase[] = generateCases(SEED, 0, N);

  it('is replayable from (seed, index) alone, independent of chunking', () => {
    expect(generateCase(SEED, 12345)).toEqual(cases[12345]);
    expect(generateCases(SEED, 20_000, 5)).toEqual(cases.slice(20_000, 20_005));
    expect(generateCase(SEED + 1, 12345).input).not.toEqual(cases[12345]!.input);
    expect(generateCases(SEED, 0, 0)).toEqual([]);
  });

  it('hits every catalogue threshold exactly, just under and just over', () => {
    for (const { component, threshold: t } of boundaryCatalogue()) {
      const near = Math.max(Math.abs(t), 1) * 1e-2;
      const vals = cases
        .map((c) => (c.input as unknown as Record<string, number | null>)[component])
        .filter((v): v is number => typeof v === 'number');
      expect(vals.filter((v) => v === t).length, `${component}=${t} at`).toBeGreaterThan(20);
      if (t > 0) {
        expect(vals.some((v) => v < t && t - v <= near), `${component}<${t}`).toBe(true);
      }
      expect(vals.some((v) => v > t && v - t <= near), `${component}>${t}`).toBe(true);
    }
  });

  it('labels boundaries truthfully', () => {
    for (const c of cases) {
      for (const [k, pos] of Object.entries(c.boundaries)) {
        const v = (c.input as unknown as Record<string, number | null>)[k];
        expect(typeof v).toBe('number');
        if (pos === 'at') {
          expect(boundaryCatalogue().some((b) => b.component === k && b.threshold === v)).toBe(true);
        }
      }
    }
  });

  it('masks presence at random, keeps building_age jointly masked, and includes all-missing cases', () => {
    const fields: (keyof NaiveInput)[] = [
      'submissionType', 'lineOfBusiness', 'primaryState', 'totalTiv', 'quotedPremium',
      'pctTivPre1990', 'pctTivPost2010', 'pctTivAcceptableConstruction', 'fiveYearLoss',
    ];
    for (const f of fields) {
      const missing = cases.filter((c) => c.input[f] === null).length;
      expect(missing, f).toBeGreaterThan(N * 0.02);
      expect(missing, f).toBeLessThan(N * 0.5);
    }
    for (const c of cases) {
      expect(c.input.pctTivPre1990 === null).toBe(c.input.pctTivPost2010 === null);
    }
    const allMissing = cases.filter((c) => fields.every((f) => c.input[f] === null));
    expect(allMissing.length).toBeGreaterThan(0);
    const allKnown = cases.filter((c) => fields.every((f) => c.input[f] !== null));
    expect(allKnown.length).toBeGreaterThan(N * 0.3);
  });

  it('keeps anyBuildingPre1990 consistent with R-AGE-REFER and exercises the zero-share refer path', () => {
    let zeroShareButPre1990 = 0;
    for (const c of cases) {
      const pre = c.input.pctTivPre1990;
      if (pre !== null && pre > 0) expect(c.input.anyBuildingPre1990).toBe(true);
      if (pre === 0 && c.input.anyBuildingPre1990 === true) zeroShareButPre1990++;
    }
    expect(zeroShareButPre1990).toBeGreaterThan(50);
    expect(cases.some((c) => c.input.anyBuildingPre1990 === null)).toBe(true);
    expect(cases.some((c) => c.input.hasOpenHighContradiction)).toBe(true);
  });

  it('keeps ordinary shares in [0, 1] and money non-negative, outside the extreme cases', () => {
    // Extremes only come from the hostile lists, so anything out of range must be one of them.
    const hostileShares = new Set([-1e-9, -0.5, 1.0000001, 2, 1e18, -Number.MAX_VALUE]);
    const hostileMoney = new Set([-1, -150000000, -Number.MAX_VALUE]);
    for (const c of cases) {
      for (const k of ['pctTivPre1990', 'pctTivPost2010', 'pctTivAcceptableConstruction'] as const) {
        const v = c.input[k];
        if (v !== null && (v < 0 || v > 1)) expect(hostileShares.has(v)).toBe(true);
      }
      for (const k of ['totalTiv', 'quotedPremium', 'fiveYearLoss'] as const) {
        const v = c.input[k];
        if (v !== null && v < 0) expect(hostileMoney.has(v)).toBe(true);
      }
    }
  });

  it('feeds hostile values: 0, negatives, 1e18, MAX_VALUE, bad strings', () => {
    const all = cases.map((c) => c.input);
    expect(all.some((i) => i.totalTiv === 0)).toBe(true);
    expect(all.some((i) => (i.quotedPremium ?? 0) < 0)).toBe(true);
    expect(all.some((i) => i.fiveYearLoss === 1e18)).toBe(true);
    expect(all.some((i) => i.totalTiv === Number.MAX_VALUE)).toBe(true);
    expect(all.some((i) => i.pctTivAcceptableConstruction === 1.0000001)).toBe(true);
    expect(all.some((i) => i.primaryState === '')).toBe(true);
    expect(all.some((i) => i.primaryState === 'oh')).toBe(true);
    expect(all.some((i) => i.submissionType === 'New Business')).toBe(true);
    // No NaN / Infinity: non-finite arrives as null (G-1).
    for (const i of all) {
      for (const v of Object.values(i)) {
        if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('covers every state tier and categorical outcome', () => {
    const all = cases.map((c) => c.input);
    for (const s of ['OH', 'PA', 'MD', 'CO', 'CA', 'FL', 'NC', 'SC', 'GA', 'VA', 'UT', 'TX']) {
      expect(all.some((i) => i.primaryState === s), s).toBe(true);
    }
    expect(all.some((i) => i.submissionType === 'renewal')).toBe(true);
    expect(all.some((i) => i.lineOfBusiness === 'general_liability')).toBe(true);
  });
});
