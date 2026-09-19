/**
 * E13 — `rules/commercial.json`, checked against the frozen schema, the
 * APPETITE_GUIDELINES.pdf table (every citation quoted verbatim from the right
 * row and column), the W-1 weights, and every boundary row of
 * docs/contracts/INTERPRETATIONS.md §3 (exactly one scoring rule fires per
 * factor, with the tier the oracle fixes).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { rulebookSchema } from './schemas.js';
import { APPETITE_FACTORS, BLANK_TARGET_FACTORS, FACTOR_WEIGHTS, WEIGHT_SUM_TOLERANCE } from './constants.js';
import { evaluateConditions } from './util/conditions.js';
import type { Rule, Rulebook, Tier } from './types.js';

const raw: unknown = JSON.parse(readFileSync(new URL('../rules/commercial.json', import.meta.url), 'utf8'));
const specRaw = JSON.parse(readFileSync(new URL('../vectors/commercial.json', import.meta.url), 'utf8')) as {
  components: { key: string }[];
};
const rulebook = rulebookSchema.parse(raw) as unknown as Rulebook;

/**
 * APPETITE_GUIDELINES.pdf page 2, "2025 Sample: Commercial Property Underwriting
 * Guidelines", transcribed cell by cell (line wraps and the hyphenated break in
 * "non-\ncombustible" joined). Empty string = blank cell.
 */
const PDF_TABLE: Record<string, { acceptable: string; target: string; not_acceptable: string; factor: string }> = {
  'Submission type': { factor: 'submission_type', acceptable: 'New business', target: '', not_acceptable: 'Renewal business' },
  'Line of business': { factor: 'line_of_business', acceptable: 'Property', target: '', not_acceptable: 'All other lines' },
  'Primary risk state': {
    factor: 'primary_risk_state',
    acceptable: 'OH, PA, MD, CO, CA, FL, NC, SC, GA, VA, UT',
    target: 'OH, PA, MD, CO, CA, FL',
    not_acceptable: 'All other states',
  },
  'TIV (Total Insured Value)': { factor: 'tiv', acceptable: 'Up to $150M', target: '$50M-$100M', not_acceptable: 'Over $150M' },
  'Total premium': { factor: 'total_premium', acceptable: '$50K-$175K', target: '$75K-$100K', not_acceptable: 'Under $50K or over $175K' },
  'Building age': { factor: 'building_age', acceptable: 'Newer than 1990', target: 'Newer than 2010', not_acceptable: 'Older than 1990' },
  'Construction type': {
    factor: 'construction_type',
    acceptable: '>50% JM, non-combustible/steel, or masonry non-combustible',
    target: '',
    not_acceptable: '>50% other types',
  },
  'Loss value': { factor: 'loss_value', acceptable: 'Under $100,000', target: '', not_acceptable: 'Over $100,000' },
};

/** LIVE_DATA_FACTS: the eight Building.construction_type values, in the data's casing. */
const DATA_CONSTRUCTION = {
  acceptable: ['Joisted Masonry', 'Non-Combustible', 'Steel Frame', 'Masonry Non-Combustible', 'Fire Resistive', 'Modified Fire Resistive'],
  other: ['Frame', 'Wood Frame'],
};

type Values = Record<string, number | null>;

function fired(values: Values, factor: string): Rule[] {
  const resolve = (field: string): unknown => values[field] ?? null;
  return rulebook.rules.filter((r) => r.factor === factor && evaluateConditions(r.when, resolve));
}

/** Exactly one scoring (non-refer) rule fires; return its tier. */
function scoringTier(values: Values, factor: string): Tier | null {
  const scoring = fired(values, factor).filter((r) => r.tier !== 'refer');
  expect(scoring.length, `${factor} ${JSON.stringify(values)} fired ${scoring.map((r) => r.id).join(',')}`).toBeLessThanOrEqual(1);
  return scoring[0]?.tier ?? null;
}

describe('rules/commercial.json — schema and weights', () => {
  it('parses through the frozen rulebookSchema', () => {
    expect(() => rulebookSchema.parse(raw)).not.toThrow();
    expect(rulebook.id).toBe('commercial');
    expect(rulebook.lineOfBusiness).toBe('commercial_property');
    expect(rulebook.rules).toHaveLength(24);
  });

  it('carries the W-1 weights exactly and they sum to 1', () => {
    expect(rulebook.weights).toEqual(FACTOR_WEIGHTS);
    const total = Object.values(rulebook.weights).reduce((a, b) => a + b, 0);
    expect(Math.abs(total - 1)).toBeLessThanOrEqual(WEIGHT_SUM_TOLERANCE);
    expect(rulebook.weights['line_of_business']).toBe(0.15);
    expect(rulebook.weights['building_age']).toBe(0.1);
    for (const rule of rulebook.rules) expect(rule.weight).toBe(rulebook.weights[rule.factor]);
  });

  it('covers all eight appetite factors and no others', () => {
    expect(new Set(rulebook.rules.map((r) => r.factor))).toEqual(new Set(APPETITE_FACTORS));
  });

  it('has no Target rule on the four blank-Target factors (T-BLANK)', () => {
    for (const factor of BLANK_TARGET_FACTORS) {
      expect(rulebook.rules.filter((r) => r.factor === factor && r.tier === 'target')).toHaveLength(0);
    }
  });

  it('addresses only vector component keys or rollup paths', () => {
    const keys = new Set(specRaw.components.map((c) => c.key));
    for (const rule of rulebook.rules) {
      for (const c of rule.when) expect(keys.has(c.field) || c.field.startsWith('rollup.'), `${rule.id} ${c.field}`).toBe(true);
    }
  });
});

describe('rules/commercial.json — citations quoted verbatim from APPETITE_GUIDELINES.pdf', () => {
  it('cites the right row and the right column cell for every rule', () => {
    for (const rule of rulebook.rules) {
      expect(rule.citation.doc).toBe('APPETITE_GUIDELINES.pdf');
      const m = /^p2 "(.+)"$/.exec(rule.citation.section);
      expect(m, rule.id).not.toBeNull();
      const row = PDF_TABLE[(m as RegExpExecArray)[1] as string];
      expect(row, `${rule.id} row`).toBeDefined();
      if (row === undefined) continue;
      expect(row.factor).toBe(rule.factor);
      if (rule.tier === 'refer') {
        expect(rule.citation.quote).toBe(row.not_acceptable);
      } else {
        expect(rule.citation.quote, rule.id).toBe(row[rule.tier]);
        expect(rule.citation.quote).not.toBe('');
      }
    }
  });

  it('attaches the four PRD 6.6 interpretations', () => {
    expect((rulebook.interpretations ?? []).map((i) => i.id)).toEqual(['I-1', 'I-2', 'I-3', 'I-4']);
    const i3 = rulebook.interpretations?.find((i) => i.id === 'I-3');
    expect(i3?.affects).toContain('pctTivAcceptableConstruction');
  });
});

describe('rules/commercial.json — matches the DATA casing, not the PDF prose', () => {
  it('never matches on PDF prose strings', () => {
    const prose = ['New business', 'Renewal business', 'Property', 'JM'];
    for (const rule of rulebook.rules) {
      for (const c of rule.when) {
        const vals = Array.isArray(c.value) ? c.value : [c.value];
        for (const v of vals) expect(prose).not.toContain(v);
      }
    }
  });

  it('names business_type "new"/"renewal" and all eight construction_type values', () => {
    const byId = new Map(rulebook.rules.map((r) => [r.id, r]));
    expect(byId.get('AG-ST-A')?.interpretation).toContain('"new"');
    expect(byId.get('AG-ST-NA')?.interpretation).toContain('"renewal"');
    for (const v of DATA_CONSTRUCTION.acceptable) expect(byId.get('AG-CON-A')?.interpretation).toContain(`"${v}"`);
    for (const v of DATA_CONSTRUCTION.other) expect(byId.get('AG-CON-NA')?.interpretation).toContain(`"${v}"`);
  });
});

describe('rules/commercial.json — INTERPRETATIONS §3 boundaries', () => {
  const cases: [string, string, Values, Tier][] = [
    // 3.7 submission type, 3.8 line of business
    ['submission_type', 'new', { isNewBusiness: 1 }, 'acceptable'],
    ['submission_type', 'renewal', { isNewBusiness: 0 }, 'not_acceptable'],
    ['line_of_business', 'property', { isPropertyLine: 1 }, 'acceptable'],
    ['line_of_business', 'other', { isPropertyLine: 0 }, 'not_acceptable'],
    // 3.6
    ['primary_risk_state', 'target', { stateTier: 2 }, 'target'],
    ['primary_risk_state', 'acceptable', { stateTier: 1 }, 'acceptable'],
    ['primary_risk_state', 'other', { stateTier: 0 }, 'not_acceptable'],
    // 3.1
    ['tiv', '0', { totalTiv: 0 }, 'acceptable'],
    ['tiv', '49,999,999.99', { totalTiv: 49_999_999.99 }, 'acceptable'],
    ['tiv', '50M', { totalTiv: 50_000_000 }, 'target'],
    ['tiv', '75M', { totalTiv: 75_000_000 }, 'target'],
    ['tiv', '100M', { totalTiv: 100_000_000 }, 'target'],
    ['tiv', '100,000,000.01', { totalTiv: 100_000_000.01 }, 'acceptable'],
    ['tiv', '150M', { totalTiv: 150_000_000 }, 'acceptable'],
    ['tiv', '150,000,000.01', { totalTiv: 150_000_000.01 }, 'not_acceptable'],
    // 3.2
    ['total_premium', '49,999.99', { quotedPremium: 49_999.99 }, 'not_acceptable'],
    ['total_premium', '50K', { quotedPremium: 50_000 }, 'acceptable'],
    ['total_premium', '74,999.99', { quotedPremium: 74_999.99 }, 'acceptable'],
    ['total_premium', '75K', { quotedPremium: 75_000 }, 'target'],
    ['total_premium', '100K', { quotedPremium: 100_000 }, 'target'],
    ['total_premium', '100,000.01', { quotedPremium: 100_000.01 }, 'acceptable'],
    ['total_premium', '175K', { quotedPremium: 175_000 }, 'acceptable'],
    ['total_premium', '175,000.01', { quotedPremium: 175_000.01 }, 'not_acceptable'],
    // 3.3
    ['loss_value', '0', { fiveYearLoss: 0 }, 'acceptable'],
    ['loss_value', '100K', { fiveYearLoss: 100_000 }, 'acceptable'],
    ['loss_value', '100,000.01', { fiveYearLoss: 100_000.01 }, 'not_acceptable'],
    // 3.5
    ['construction_type', '0.4999', { pctTivAcceptableConstruction: 0.4999 }, 'not_acceptable'],
    ['construction_type', '0.5', { pctTivAcceptableConstruction: 0.5 }, 'acceptable'],
    ['construction_type', '1', { pctTivAcceptableConstruction: 1 }, 'acceptable'],
    // 3.4
    ['building_age', 'pre 0.500001', { pctTivPre1990: 0.500001, pctTivPost2010: 0 }, 'not_acceptable'],
    ['building_age', 'pre 0.5', { pctTivPre1990: 0.5, pctTivPost2010: 0 }, 'acceptable'],
    ['building_age', 'pre 0.5, post 0.5', { pctTivPre1990: 0.5, pctTivPost2010: 0.5 }, 'acceptable'],
    ['building_age', 'post 0.5', { pctTivPre1990: 0, pctTivPost2010: 0.5 }, 'acceptable'],
    ['building_age', 'post 0.500001', { pctTivPre1990: 0, pctTivPost2010: 0.500001 }, 'target'],
    ['building_age', 'all 2010 (B8)', { pctTivPre1990: 0, pctTivPost2010: 1 }, 'target'],
    ['building_age', 'B1', { pctTivPre1990: 0, pctTivPost2010: 0 }, 'acceptable'],
  ];

  it.each(cases)('%s at %s', (factor, _label, values, expected) => {
    expect(scoringTier(values, factor)).toBe(expected);
  });

  it('fires nothing on a missing component (G-2: missing is never 0)', () => {
    for (const factor of APPETITE_FACTORS) expect(fired({}, factor)).toHaveLength(0);
  });

  it('is exhaustive and disjoint on a dense sweep of every numeric factor (G-9)', () => {
    const sweeps: [string, string, number[]][] = [
      ['tiv', 'totalTiv', [0, 1, 25e6, 49_999_999, 5e7, 5e7 + 1, 99_999_999, 1e8, 1e8 + 1, 1.25e8, 1.5e8, 1.5e8 + 1, 1e9]],
      ['total_premium', 'quotedPremium', [0, 45_900, 49_999, 5e4, 60_000, 74_999, 75e3, 90e3, 1e5, 100_001, 150e3, 175e3, 175_001, 703_500]],
      ['loss_value', 'fiveYearLoss', [0, 1, 99_999, 1e5, 100_001, 5e6]],
      ['construction_type', 'pctTivAcceptableConstruction', [0, 0.25, 0.4999, 0.5, 0.5001, 1]],
    ];
    for (const [factor, key, xs] of sweeps) {
      for (const x of xs) expect(scoringTier({ [key]: x }, factor), `${factor}=${x}`).not.toBeNull();
    }
    for (const pre of [0, 0.25, 0.5, 0.500001, 1]) {
      for (const post of [0, 0.5, 0.500001, 1]) {
        if (pre + post > 1) continue;
        expect(scoringTier({ pctTivPre1990: pre, pctTivPost2010: post }, 'building_age')).not.toBeNull();
      }
    }
  });
});

describe('rules/commercial.json — R-AGE-REFER', () => {
  const refer = (values: Values): boolean => fired(values, 'building_age').some((r) => r.tier === 'refer');

  it('B6: pctTivPre1990 = 0.5 with a 1989 building refers and keeps Acceptable', () => {
    const v = { pctTivPre1990: 0.5, pctTivPost2010: 0, 'rollup.oldestYearBuilt': 1989 };
    expect(refer(v)).toBe(true);
    expect(scoringTier(v, 'building_age')).toBe('acceptable');
  });

  it('refers on a pre-1990 building whose TIV is unknown (share 0)', () => {
    expect(refer({ pctTivPre1990: 0, pctTivPost2010: 0.6, 'rollup.oldestYearBuilt': 1948 })).toBe(true);
  });

  it('does not refer above 0.5 (the knockout already decides)', () => {
    expect(refer({ pctTivPre1990: 0.500001, pctTivPost2010: 0, 'rollup.oldestYearBuilt': 1948 })).toBe(false);
  });

  it('does not refer when the oldest building is 1990 (1990 is "newer than 1990")', () => {
    expect(refer({ pctTivPre1990: 0, pctTivPost2010: 0, 'rollup.oldestYearBuilt': 1990 })).toBe(false);
  });
});

describe('rules/commercial.json — INTERPRETATIONS §8 B1 score from the rules alone', () => {
  it('B1 scores 84 and B9 scores 96 using rule tiers with T-BLANK', () => {
    const tierValue = (factor: string, tier: Tier | null): number => {
      if (tier === 'not_acceptable' || tier === null) return 0;
      if (tier === 'target') return 1;
      return (BLANK_TARGET_FACTORS as readonly string[]).includes(factor) ? 1 : 0.6;
    };
    const score = (v: Values): number =>
      100 * APPETITE_FACTORS.reduce((s, f) => s + (rulebook.weights[f] ?? 0) * tierValue(f, scoringTier(v, f)), 0);
    const b1: Values = {
      isNewBusiness: 1, isPropertyLine: 1, stateTier: 2, totalTiv: 150_000_000, quotedPremium: 175_000,
      pctTivPre1990: 0, pctTivPost2010: 0, pctTivAcceptableConstruction: 0.5, fiveYearLoss: 100_000,
    };
    expect(Math.abs(score(b1) - 84)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(score({ ...b1, totalTiv: 50_000_000, quotedPremium: 75_000 }) - 96)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(score({ ...b1, totalTiv: 50_000_000, quotedPremium: 75_000, stateTier: 1 }) - 90)).toBeLessThanOrEqual(1e-6);
  });
});
