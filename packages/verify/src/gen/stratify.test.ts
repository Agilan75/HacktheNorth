/**
 * V03 tests — the layer-C stratifier. Every stratum must really contain the
 * boundary it names (INTERPRETATIONS §3, §4, §8), not just a case.
 */
import { describe, expect, it } from 'vitest';
import type { GeneratedCase, NaiveInput } from '../types.js';
import { classifyStratum, stratifiedSample, strata } from './stratify.js';

const plain: NaiveInput = {
  submissionType: 'new_business',
  lineOfBusiness: 'commercial_property',
  primaryState: 'OH',
  totalTiv: 80_000_000,
  quotedPremium: 90_000,
  pctTivPre1990: 0,
  pctTivPost2010: 0.2,
  pctTivAcceptableConstruction: 1,
  fiveYearLoss: 20_000,
  anyBuildingPre1990: false,
  hasOpenHighContradiction: false,
};
const mk = (p: Partial<NaiveInput>, boundaries: Record<string, 'at' | 'random'> = {}): GeneratedCase => ({
  caseId: 't',
  seed: 0,
  index: 0,
  input: { ...plain, ...p },
  boundaries,
  fromSubmission: true,
});

describe('strata', () => {
  it('has unique keys, positive targets, and fits inside the nominal 2,000', () => {
    const s = strata();
    expect(new Set(s.map((x) => x.key)).size).toBe(s.length);
    for (const x of s) {
      expect(x.targetCount).toBeGreaterThan(0);
      expect(x.description.length).toBeGreaterThan(10);
    }
    expect(s.reduce((a, x) => a + x.targetCount, 0)).toBe(1720);
  });
});

describe('classifyStratum', () => {
  it('an ordinary in-appetite case is null', () => {
    expect(classifyStratum(mk({}))).toBeNull();
  });

  it('names the §8 boundary values exactly', () => {
    expect(classifyStratum(mk({ totalTiv: 150_000_000 }))).toBe('tiv_at_150m');
    expect(classifyStratum(mk({ totalTiv: 150_000_000.01 }))).toBe('tiv_just_over_150m');
    expect(classifyStratum(mk({ quotedPremium: 49_999.99 }))).toBe('premium_just_under_50k');
    expect(classifyStratum(mk({ quotedPremium: 175_000 }))).toBe('premium_at_175k');
    expect(classifyStratum(mk({ fiveYearLoss: 100_000 }))).toBe('loss_at_100k');
    expect(classifyStratum(mk({ fiveYearLoss: 100_000.01 }))).toBe('loss_just_over_100k');
    expect(classifyStratum(mk({ pctTivAcceptableConstruction: 0.4999 }))).toBe('construction_just_under_half');
    expect(classifyStratum(mk({ pctTivPre1990: 0.5, anyBuildingPre1990: true }))).toBe('age_pre1990_exact_half');
    expect(classifyStratum(mk({ pctTivPre1990: 0.500001, anyBuildingPre1990: true }))).toBe(
      'age_pre1990_just_over_half',
    );
    expect(classifyStratum(mk({ pctTivPre1990: 0, anyBuildingPre1990: true }))).toBe(
      'age_refer_unknown_tiv_pre1990',
    );
    expect(classifyStratum(mk({ pctTivPre1990: 0.2, anyBuildingPre1990: true }))).toBe(
      'age_refer_minority_pre1990',
    );
    expect(classifyStratum(mk({ primaryState: 'NC' }))).toBe('state_acceptable_tier');
    expect(classifyStratum(mk({ submissionType: 'renewal' }))).toBe('submission_not_new');
    expect(classifyStratum(mk({ quotedPremium: null }))).toBe('missing_component');
  });

  it('ambiguities outrank thresholds', () => {
    expect(classifyStratum(mk({ totalTiv: 150_000_000 }, { 'I-1:state_tie': 'at' }))).toBe('state_tie_break');
    expect(
      classifyStratum(mk({ pctTivAcceptableConstruction: 0.5 }, { 'I-3:fire_resistive_decides': 'at' })),
    ).toBe('construction_fire_resistive_decides');
    expect(classifyStratum(mk({ hasOpenHighContradiction: true, totalTiv: 50_000_000 }))).toBe(
      'contradiction_open',
    );
  });
});

describe('stratifiedSample', () => {
  const sample = stratifiedSample(11, 2000);

  it('returns exactly the requested count, each stratum at its target', () => {
    expect(sample.length).toBe(2000);
    const byStratum = new Map<string, number>();
    for (const s of sample) byStratum.set(s.stratum, (byStratum.get(s.stratum) ?? 0) + 1);
    for (const s of strata()) expect(byStratum.get(s.key)).toBe(s.targetCount);
    expect(byStratum.get('ordinary')).toBe(280);
  });

  it('every stratified case really sits in its stratum; ordinary cases classify null', () => {
    for (const s of sample) {
      expect(classifyStratum(s.case)).toBe(s.stratum === 'ordinary' ? null : s.stratum);
      expect(s.case.fromSubmission).toBe(true);
    }
    const tiv150 = sample.filter((s) => s.stratum === 'tiv_at_150m');
    expect(tiv150.every((s) => s.case.input.totalTiv === 150_000_000)).toBe(true);
    const half = sample.filter((s) => s.stratum === 'age_pre1990_exact_half');
    expect(half.every((s) => s.case.input.pctTivPre1990 === 0.5)).toBe(true);
    const ties = sample.filter((s) => s.stratum === 'state_tie_break');
    expect(ties.every((s) => s.case.boundaries['I-1:state_tie'] === 'at')).toBe(true);
  });

  it('case ids are unique and the sample is deterministic', () => {
    expect(new Set(sample.map((s) => s.case.caseId)).size).toBe(2000);
    const again = stratifiedSample(11, 2000);
    expect(again).toEqual(sample);
  });

  it('scales down, keeping every stratum represented', () => {
    const small = stratifiedSample(3, 50);
    expect(small.length).toBe(50);
    const keys = new Set(small.map((s) => s.stratum));
    for (const s of strata()) expect(keys.has(s.key)).toBe(true);
    expect(stratifiedSample(3, 0)).toEqual([]);
    expect(stratifiedSample(3, -5)).toEqual([]);
  });
});
