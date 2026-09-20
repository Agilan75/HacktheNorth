/**
 * V03 tests — the multi-building generator and its independent rollup,
 * asserted against docs/contracts/INTERPRETATIONS.md 3.1–3.5, I-1, I-3 and
 * R-AGE-REFER. Imports no engine package.
 */
import { describe, expect, it } from 'vitest';
import type { GeneratedBuilding, GeneratedSubmission } from '../types.js';
import { generateSubmission, rollupGenerated } from './submissions.js';

function bld(id: string, p: Partial<GeneratedBuilding>): GeneratedBuilding {
  return {
    id,
    state: 'OH',
    yearBuilt: 2000,
    constructionType: 'Joisted Masonry',
    tiv: 1_000_000,
    sprinklered: true,
    protectionClass: 3,
    ...p,
  };
}

function sub(buildings: GeneratedBuilding[], p: Partial<GeneratedSubmission> = {}): GeneratedSubmission {
  return {
    caseId: 'V03:9:42',
    seed: 9,
    submissionType: 'new_business',
    lineOfBusiness: 'commercial_property',
    quotedPremium: 175_000,
    fiveYearLoss: 100_000,
    buildings,
    ...p,
  };
}

describe('generateSubmission', () => {
  it('is deterministic in (seed, index) and varies with the index', () => {
    expect(generateSubmission(7, 3)).toEqual(generateSubmission(7, 3));
    expect(generateSubmission(7, 3)).not.toEqual(generateSubmission(7, 4));
    expect(generateSubmission(7, 3)).not.toEqual(generateSubmission(8, 3));
    expect(generateSubmission(7, 3).caseId).toBe('V03:7:3');
  });

  it('spans 1..129 buildings, several states, and hits the §8 edge values', () => {
    let maxBuildings = 0;
    let minBuildings = Infinity;
    let multiState = 0;
    const premiums = new Set<number | null>();
    const tivs = new Set<number | null>();
    const losses = new Set<number | null>();
    for (let i = 0; i < 3000; i += 1) {
      const s = generateSubmission(1, i);
      maxBuildings = Math.max(maxBuildings, s.buildings.length);
      minBuildings = Math.min(minBuildings, s.buildings.length);
      const c = rollupGenerated(s);
      if (c.boundaries['I-1:multi_state'] !== undefined) multiState += 1;
      premiums.add(c.input.quotedPremium);
      tivs.add(c.input.totalTiv);
      losses.add(c.input.fiveYearLoss);
      for (const b of s.buildings) {
        if (b.yearBuilt !== null) {
          expect(b.yearBuilt).toBeGreaterThanOrEqual(1948);
          expect(b.yearBuilt).toBeLessThanOrEqual(2024);
        }
      }
    }
    expect(minBuildings).toBe(1);
    expect(maxBuildings).toBeLessThanOrEqual(129);
    expect(maxBuildings).toBeGreaterThan(100);
    expect(multiState).toBeGreaterThan(300);
    for (const v of [49_999.99, 50_000, 75_000, 100_000, 175_000, 175_000.01, null]) {
      expect(premiums.has(v)).toBe(true);
    }
    for (const v of [50_000_000, 100_000_000, 150_000_000]) expect(tivs.has(v)).toBe(true);
    for (const v of [0, 100_000, 100_000.01, null]) expect(losses.has(v)).toBe(true);
  });

  it('round-trips: rollup of a regenerated submission is identical', () => {
    const c = rollupGenerated(generateSubmission(5, 17));
    expect(c.seed).toBe(5);
    expect(c.index).toBe(17);
    expect(c.fromSubmission).toBe(true);
    expect(rollupGenerated(generateSubmission(c.seed, c.index))).toEqual(c);
  });
});

describe('rollupGenerated', () => {
  it('B6-shaped account: exact halves, I-1 tie-break, I-3 decides', () => {
    const c = rollupGenerated(
      sub([
        bld('a', { state: 'OH', yearBuilt: 1989, tiv: 75_000_000, constructionType: 'Fire Resistive' }),
        bld('b', { state: 'CA', yearBuilt: 2010, tiv: 75_000_000, constructionType: 'Frame' }),
      ]),
    );
    expect(c.caseId).toBe('V03:9:42');
    expect(c.index).toBe(42);
    expect(c.input).toEqual({
      submissionType: 'new_business',
      lineOfBusiness: 'commercial_property',
      primaryState: 'CA',
      totalTiv: 150_000_000,
      quotedPremium: 175_000,
      pctTivPre1990: 0.5,
      pctTivPost2010: 0.5,
      pctTivAcceptableConstruction: 0.5,
      fiveYearLoss: 100_000,
      anyBuildingPre1990: true,
      hasOpenHighContradiction: false,
    });
    expect(c.boundaries).toMatchObject({
      totalTiv: 'at',
      quotedPremium: 'at',
      fiveYearLoss: 'at',
      pctTivPre1990: 'at',
      pctTivPost2010: 'at',
      pctTivAcceptableConstruction: 'at',
      'I-1:state_tie': 'at',
      'I-3:fire_resistive_decides': 'at',
    });
  });

  it('primary state is the largest TIV share, after trim + upper-case; unknown TIV never decides', () => {
    const c = rollupGenerated(
      sub([
        bld('a', { state: ' fl ', tiv: 30_000_000 }),
        bld('b', { state: 'TX', tiv: 20_000_000 }),
        bld('c', { state: 'TX', tiv: 15_000_000 }),
        bld('d', { state: 'GA', tiv: null }),
        bld('e', { state: null, tiv: 90_000_000 }),
      ]),
    );
    expect(c.input.primaryState).toBe('TX');
    expect(c.input.totalTiv).toBe(155_000_000);
    expect(c.boundaries['I-1:multi_state']).toBe('random');
    expect(c.boundaries['I-1:state_tie']).toBeUndefined();
    expect(c.boundaries.totalTiv).toBe('random');
  });

  it('R-AGE-REFER: a pre-1990 building with unknown TIV leaves the share at 0 but sets the flag', () => {
    const c = rollupGenerated(
      sub([
        bld('a', { yearBuilt: 1951, tiv: null }),
        bld('b', { yearBuilt: 2015, tiv: 40_000_000 }),
        bld('c', { yearBuilt: 1995, tiv: 60_000_000 }),
      ]),
    );
    expect(c.input.pctTivPre1990).toBe(0);
    expect(c.input.pctTivPost2010).toBe(0.4);
    expect(c.input.anyBuildingPre1990).toBe(true);
    expect(c.boundaries['R-AGE-REFER:pre1990_unknown_tiv']).toBe('at');
  });

  it('cutoff years belong to the newer side; 1990 is not pre-1990, 2010 is post-2010', () => {
    const c = rollupGenerated(
      sub([bld('a', { yearBuilt: 1990, tiv: 1 }), bld('b', { yearBuilt: 2010, tiv: 3 })]),
    );
    expect(c.input.pctTivPre1990).toBe(0);
    expect(c.input.pctTivPost2010).toBe(0.75);
    expect(c.input.anyBuildingPre1990).toBe(false);
  });

  it('construction: Steel Frame is steel, unknown class is "other", unknown TIV is excluded', () => {
    const c = rollupGenerated(
      sub([
        bld('a', { constructionType: 'Steel Frame', tiv: 10 }),
        bld('b', { constructionType: 'Masonry Non-Combustible', tiv: 10 }),
        bld('c', { constructionType: null, tiv: 30 }),
        bld('d', { constructionType: 'Heavy Timber', tiv: 50 }),
        bld('e', { constructionType: 'Joisted Masonry', tiv: null }),
      ]),
    );
    expect(c.input.pctTivAcceptableConstruction).toBe(0.2);
    expect(c.boundaries['I-3:fire_resistive_decides']).toBeUndefined();
  });

  it('just under / just over positions (B2, B3, B4)', () => {
    const c = rollupGenerated(
      sub([bld('a', { tiv: 150_000_000.01 })], { quotedPremium: 49_999.99, fiveYearLoss: 100_000.01 }),
    );
    expect(c.input.totalTiv).toBe(150_000_000.01);
    expect(c.boundaries.totalTiv).toBe('over');
    expect(c.boundaries.quotedPremium).toBe('under');
    expect(c.boundaries.fiveYearLoss).toBe('over');
  });

  it('missing stays missing (G-1/G-2): no known year, no known TIV, null money', () => {
    const c = rollupGenerated(
      sub([bld('a', { yearBuilt: null, tiv: null, state: 'OH' })], {
        quotedPremium: null,
        fiveYearLoss: null,
        submissionType: null,
      }),
    );
    expect(c.input.totalTiv).toBeNull();
    expect(c.input.primaryState).toBeNull();
    expect(c.input.pctTivPre1990).toBeNull();
    expect(c.input.pctTivPost2010).toBeNull();
    expect(c.input.pctTivAcceptableConstruction).toBeNull();
    expect(c.input.anyBuildingPre1990).toBeNull();
    expect(c.input.quotedPremium).toBeNull();
    expect(c.input.fiveYearLoss).toBeNull();
    expect(c.input.submissionType).toBeNull();
    expect(Object.keys(c.boundaries)).toEqual([]);
  });

  it('a zero loss is known, and building age shares are jointly known', () => {
    const c = rollupGenerated(sub([bld('a', { yearBuilt: 1970, tiv: 5 })], { fiveYearLoss: 0 }));
    expect(c.input.fiveYearLoss).toBe(0);
    expect(c.input.pctTivPre1990).toBe(1);
    expect(c.input.pctTivPost2010).toBe(0);
  });
});
