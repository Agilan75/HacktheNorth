import { describe, expect, it } from 'vitest';
import { FALLBACK_BANDS, appetiteBands, bandAt } from './appetite-bands.js';

const COMMERCIAL = {
  id: 'commercial',
  isExtension: false,
  rules: [
    { id: 'AG-TIV-T', factor: 'tiv', tier: 'target', when: [
      { field: 'totalTiv', op: 'gte', value: 50_000_000 },
      { field: 'totalTiv', op: 'lte', value: 100_000_000 },
    ] },
    { id: 'AG-TIV-A-LOW', factor: 'tiv', tier: 'acceptable', when: [{ field: 'totalTiv', op: 'lt', value: 50_000_000 }] },
    { id: 'AG-TIV-A-HIGH', factor: 'tiv', tier: 'acceptable', when: [
      { field: 'totalTiv', op: 'gt', value: 100_000_000 },
      { field: 'totalTiv', op: 'lte', value: 150_000_000 },
    ] },
    { id: 'AG-TIV-NA', factor: 'tiv', tier: 'not_acceptable', when: [{ field: 'totalTiv', op: 'gt', value: 150_000_000 }] },
    { id: 'AG-PREM-T', factor: 'total_premium', tier: 'target', when: [
      { field: 'quotedPremium', op: 'gte', value: 75_000 },
      { field: 'quotedPremium', op: 'lte', value: 100_000 },
    ] },
    { id: 'AG-PREM-A-LOW', factor: 'total_premium', tier: 'acceptable', when: [
      { field: 'quotedPremium', op: 'gte', value: 50_000 },
      { field: 'quotedPremium', op: 'lt', value: 75_000 },
    ] },
    { id: 'AG-PREM-A-HIGH', factor: 'total_premium', tier: 'acceptable', when: [
      { field: 'quotedPremium', op: 'gt', value: 100_000 },
      { field: 'quotedPremium', op: 'lte', value: 175_000 },
    ] },
    { id: 'AG-PREM-NA-LOW', factor: 'total_premium', tier: 'not_acceptable', when: [{ field: 'quotedPremium', op: 'lt', value: 50_000 }] },
    { id: 'AG-PREM-NA-HIGH', factor: 'total_premium', tier: 'not_acceptable', when: [{ field: 'quotedPremium', op: 'gt', value: 175_000 }] },
    // Another factor must not leak into either axis.
    { id: 'AG-ST-T', factor: 'primary_risk_state', tier: 'target', when: [{ field: 'primaryState', op: 'in', value: ['OH'] }] },
  ],
};

describe('appetiteBands', () => {
  it('cuts each axis at the rulebook edges and names the owning rule', () => {
    const bands = appetiteBands([COMMERCIAL]);
    expect(bands.fallback).toBe(false);
    expect(bands.tiv.map((b) => [b.from, b.to, b.ruleId, b.tierValue])).toEqual([
      [-Infinity, 50_000_000, 'AG-TIV-A-LOW', 0.6],
      [50_000_000, 100_000_000, 'AG-TIV-T', 1],
      [100_000_000, 150_000_000, 'AG-TIV-A-HIGH', 0.6],
      [150_000_000, Infinity, 'AG-TIV-NA', 0],
    ]);
    expect(bands.premium.map((b) => b.ruleId)).toEqual([
      'AG-PREM-NA-LOW',
      'AG-PREM-A-LOW',
      'AG-PREM-T',
      'AG-PREM-A-HIGH',
      'AG-PREM-NA-HIGH',
    ]);
  });

  it('matches the engine tiers at and around every edge', () => {
    const { tiv, premium } = appetiteBands([COMMERCIAL]);
    // TIV: below 50M is acceptable, 50M-100M target, over 150M knocked out.
    expect(bandAt(tiv, 49_999_999)?.tier).toBe('acceptable');
    expect(bandAt(tiv, 50_000_000)?.tier).toBe('target');
    expect(bandAt(tiv, 100_000_000)?.tier).toBe('acceptable');
    expect(bandAt(tiv, 150_000_001)?.tier).toBe('not_acceptable');
    // Premium is knocked out on both sides.
    expect(bandAt(premium, 49_999)?.tier).toBe('not_acceptable');
    expect(bandAt(premium, 80_000)?.tier).toBe('target');
    expect(bandAt(premium, 175_001)?.tier).toBe('not_acceptable');
    expect(bandAt(premium, null)).toBeNull();
  });

  it('ignores extension rulebooks and falls back when the payload carries no bands', () => {
    const extension = { id: 'extensions', isExtension: true, rules: COMMERCIAL.rules };
    expect(appetiteBands([extension])).toBe(FALLBACK_BANDS);
    expect(appetiteBands([]).fallback).toBe(true);
    expect(appetiteBands(null).tiv).toHaveLength(4);
  });
});
