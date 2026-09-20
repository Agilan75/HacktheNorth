/**
 * E14 — the tenant rulebook, the extension rulebook and the tenant questions.
 * Parses every file through the frozen zod schemas, then fires the rules
 * against hand-built component values at every boundary the files encode.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { questionFileSchema, rulebookSchema, vectorSpecSchema } from './schemas.js';
import { TENANT_TERMS_MONTHS, WEIGHT_SUM_TOLERANCE } from './constants.js';
import { evaluateConditions } from './util/conditions.js';
import type { Rule, Rulebook } from './types.js';

function load(rel: string): unknown {
  return JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')) as unknown;
}

const tenant = rulebookSchema.parse(load('../rules/tenant.json')) as Rulebook;
const extensions = rulebookSchema.parse(load('../rules/extensions.json')) as Rulebook;
const questions = questionFileSchema.parse(load('../questions/tenant.json'));
const tenantSpec = vectorSpecSchema.parse(load('../vectors/tenant.json'));
const commercialSpec = vectorSpecSchema.parse(load('../vectors/commercial.json'));

/** Ids of the rules that fire for a set of component values. */
function fired(book: Rulebook, values: Readonly<Record<string, number>>): string[] {
  const resolve = (field: string): unknown => values[field];
  return book.rules.filter((r: Rule) => evaluateConditions(r.when, resolve)).map((r) => r.id);
}

function tierOf(book: Rulebook, id: string): string | undefined {
  return book.rules.find((r) => r.id === id)?.tier;
}

describe('rules/tenant.json', () => {
  it('has 12-18 rules, every one with a rating factor and a citation', () => {
    expect(tenant.lineOfBusiness).toBe('tenant');
    expect(tenant.rules.length).toBeGreaterThanOrEqual(12);
    expect(tenant.rules.length).toBeLessThanOrEqual(18);
    expect(tenant.rules.length).toBe(17);
    for (const rule of tenant.rules) {
      expect(rule.ratingFactor, rule.id).toBeTruthy();
      expect(rule.citation.quote.length, rule.id).toBeGreaterThan(0);
      expect(rule.extension, rule.id).toBeUndefined();
    }
  });

  it('weights every tenant appetite factor, summing to exactly 1', () => {
    const factors = new Set(tenantSpec.components.filter((c) => c.appetiteFactor).map((c) => c.factor));
    expect(new Set(Object.keys(tenant.weights))).toEqual(factors);
    const total = Object.values(tenant.weights).reduce((a, b) => a + b, 0);
    expect(Math.abs(total - 1)).toBeLessThanOrEqual(WEIGHT_SUM_TOLERANCE);
    expect(tenant.weights['hazard_heater_near_combustible']).toBe(0.15);
    expect(tenant.weights['hazard_blocked_exit']).toBe(0.15);
    expect(tenant.weights['term']).toBe(0.025);
  });

  it('reads only tenant vector component keys, and every rule factor is weighted', () => {
    const keys = new Set(tenantSpec.components.map((c) => c.key));
    for (const rule of tenant.rules) {
      expect(tenant.weights[rule.factor], rule.id).toBeGreaterThan(0);
      for (const c of rule.when) expect(keys.has(c.field), `${rule.id}:${c.field}`).toBe(true);
    }
  });

  it('knocks out exactly the heater-near-combustible and blocked-exit hazards', () => {
    const knockouts = tenant.rules.filter((r) => r.tier === 'not_acceptable').map((r) => r.id);
    expect(knockouts.sort()).toEqual(['T-HZ-BLOCKED-EXIT', 'T-HZ-HEATER-COMBUSTIBLE']);
    expect(fired(tenant, { hazardHeaterNearCombustible: 1, hazardPortableHeater: 1 }).sort()).toEqual([
      'T-HZ-HEATER',
      'T-HZ-HEATER-COMBUSTIBLE',
    ]);
    expect(fired(tenant, { hazardBlockedExit: 0, hazardCandle: 0 })).toEqual([]);
  });

  it('fires exactly one smoke-detection rule for any known count', () => {
    expect(fired(tenant, { smokeDetectorCount: 0 })).toEqual(['T-SMOKE-NONE']);
    expect(tierOf(tenant, 'T-SMOKE-NONE')).toBe('refer');
    expect(fired(tenant, { smokeDetectorCount: 1 })).toEqual(['T-SMOKE-PRESENT']);
    expect(fired(tenant, { smokeDetectorCount: 4 })).toEqual(['T-SMOKE-PRESENT']);
    expect(fired(tenant, {})).toEqual([]);
  });

  it('closes the building-age boundaries at 1950 and 1990 with no gap or overlap', () => {
    expect(fired(tenant, { buildingYearBuilt: 1949 })).toEqual(['T-AGE-PRE-1950']);
    expect(fired(tenant, { buildingYearBuilt: 1950 })).toEqual(['T-AGE-1950-1989']);
    expect(fired(tenant, { buildingYearBuilt: 1989 })).toEqual(['T-AGE-1950-1989']);
    expect(fired(tenant, { buildingYearBuilt: 1990 })).toEqual(['T-AGE-1990-PLUS']);
    expect(fired(tenant, { buildingYearBuilt: 2024 })).toEqual(['T-AGE-1990-PLUS']);
  });

  it('refers a contents limit strictly over $100,000', () => {
    expect(fired(tenant, { contentsLimit: 100000 })).toEqual(['T-CONTENTS-STANDARD']);
    expect(fired(tenant, { contentsLimit: 100000.01 })).toEqual(['T-CONTENTS-HIGH']);
    expect(tierOf(tenant, 'T-CONTENTS-HIGH')).toBe('refer');
  });

  it('names only interpretations it defines', () => {
    const ids = new Set((tenant.interpretations ?? []).map((i) => i.id));
    for (const rule of tenant.rules) {
      if (rule.interpretation !== undefined) expect(ids.has(rule.interpretation), rule.id).toBe(true);
    }
  });
});

describe('rules/extensions.json', () => {
  it('carries no weights and marks every rule as an extension that never knocks out', () => {
    expect(extensions.lineOfBusiness).toBe('commercial_property');
    expect(extensions.weights).toEqual({});
    for (const rule of extensions.rules) {
      expect(rule.extension, rule.id).toBe(true);
      expect(rule.tier, rule.id).not.toBe('not_acceptable');
      expect(rule.weight, rule.id).toBeUndefined();
      expect(rule.ratingFactor, rule.id).toBeTruthy();
      expect(rule.citation.quote.startsWith("Retrofit's own rule"), rule.id).toBe(true);
    }
  });

  it('reads only commercial vector component keys, never an appetite factor', () => {
    const keys = new Set(commercialSpec.components.map((c) => c.key));
    const appetiteFactors = new Set(
      commercialSpec.components.filter((c) => c.appetiteFactor).map((c) => c.factor),
    );
    for (const rule of extensions.rules) {
      expect(appetiteFactors.has(rule.factor), rule.id).toBe(false);
      for (const c of rule.when) expect(keys.has(c.field), `${rule.id}:${c.field}`).toBe(true);
    }
  });

  it('sprinkler rules partition at 50% sprinklered and $100M TIV', () => {
    expect(fired(extensions, { pctTivSprinklered: 0.5, totalTiv: 200e6 })).toEqual(['X-SPRINKLER-MAJORITY']);
    expect(fired(extensions, { pctTivSprinklered: 0.4999, totalTiv: 100e6 })).toEqual(['X-SPRINKLER-MINORITY']);
    expect(fired(extensions, { pctTivSprinklered: 0, totalTiv: 100000000.01 })).toEqual([
      'X-SPRINKLER-LARGE-UNPROTECTED',
    ]);
    expect(tierOf(extensions, 'X-SPRINKLER-LARGE-UNPROTECTED')).toBe('refer');
  });

  it('protection-class rules partition at 4 and 9', () => {
    expect(fired(extensions, { tivWeightedProtectionClass: 1 })).toEqual(['X-PPC-GOOD']);
    expect(fired(extensions, { tivWeightedProtectionClass: 4 })).toEqual(['X-PPC-GOOD']);
    expect(fired(extensions, { tivWeightedProtectionClass: 4.01 })).toEqual(['X-PPC-AVERAGE']);
    expect(fired(extensions, { tivWeightedProtectionClass: 8.99 })).toEqual(['X-PPC-AVERAGE']);
    expect(fired(extensions, { tivWeightedProtectionClass: 9 })).toEqual(['X-PPC-UNPROTECTED']);
    expect(fired(extensions, { tivWeightedProtectionClass: 10 })).toEqual(['X-PPC-UNPROTECTED']);
  });
});

describe('questions/tenant.json', () => {
  const bySource = new Map(tenantSpec.components.map((c) => [c.source, c]));

  /**
   * `contentsLimit` is derived, never asked: the sweep sums what it priced and
   * the server rounds it (apps/api/src/services/sweep.ts). It is the one
   * component with no question, so the invariant is "a question per component
   * except the derived ones", not one per component.
   */
  const DERIVED_COMPONENTS: ReadonlySet<string> = new Set(['contentsLimit']);

  it('asks one plain-language question per tenant component, bar the derived ones', () => {
    expect(questions.lineOfBusiness).toBe('tenant');
    const askable = tenantSpec.components.filter((c) => !DERIVED_COMPONENTS.has(c.key));
    expect(questions.questions).toHaveLength(askable.length);
    const covered = new Set<string>();
    for (const q of questions.questions) {
      const component = bySource.get(q.field);
      expect(component, q.id).toBeDefined();
      expect(DERIVED_COMPONENTS.has(component!.key), q.id).toBe(false);
      covered.add(q.field);
      expect(q.prompt.endsWith('?'), q.id).toBe(true);
      expect(q.accessibilityLabel.length, q.id).toBeGreaterThan(q.prompt.length / 2);
    }
    expect(covered.size).toBe(askable.length);
  });

  it('marks every question observable or not, and no hazard question is asked', () => {
    // `observable` is not part of the engine's frozen `Question` type, so the
    // parsed questions drop it; the file itself is what carries the flag, and
    // the API reads it from there (readObservableQuestionIds).
    const raw = load('../questions/tenant.json') as {
      questions: { id: string; field: string; observable?: unknown }[];
    };
    for (const q of raw.questions) {
      expect(typeof q.observable, q.id).toBe('boolean');
      // Anything a camera sweep can settle is flagged, so the VOI loop skips it.
      if (q.field.startsWith('hazards.')) expect(q.observable, q.id).toBe(true);
    }
    const askable = raw.questions.filter((q) => q.observable !== true).map((q) => q.field);
    expect(askable).toEqual(['buildings[0].yearBuilt', 'exposure.termMonths']);
  });

  it('answers binary hazards with yes/no and the term with exactly 4, 8 or 12 months', () => {
    for (const q of questions.questions) {
      const component = bySource.get(q.field);
      if (component?.type === 'binary') {
        expect(q.inputType, q.id).toBe('boolean');
        expect(q.options?.map((o) => o.value), q.id).toEqual([true, false]);
      }
    }
    const term = questions.questions.find((q) => q.field === 'exposure.termMonths');
    expect(term?.options?.map((o) => o.value)).toEqual([...TENANT_TERMS_MONTHS]);
  });

  it('puts the contents refer line at $100,000, with nothing asking about it', () => {
    // No contents question exists to offer options on: the figure is summed
    // from what the sweep priced. The rule boundary is still worth pinning.
    expect(questions.questions.some((q) => q.field === 'exposure.contentsLimit')).toBe(false);
    expect(fired(tenant, { contentsLimit: 100000 })).toEqual(['T-CONTENTS-STANDARD']);
    expect(fired(tenant, { contentsLimit: 150000 })).toEqual(['T-CONTENTS-HIGH']);
  });
});
