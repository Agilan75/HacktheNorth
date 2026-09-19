/**
 * Stage 11 tests (unit E09). The swings asserted here are the W-1 factor
 * weights of `docs/contracts/INTERPRETATIONS.md` §2 times 100: tiv and
 * total_premium 15, construction_type 10. Nothing here is approximate.
 */
import { describe, expect, it } from 'vitest';
import type {
  Citation,
  EvaluateResult,
  FactorOutcome,
  FeatureVector,
  Question,
  Rule,
  Rulebook,
  VectorComponentSpec,
  VectorSpec,
} from '../types.js';
import { FACTOR_WEIGHTS } from '../constants.js';
import { voi } from './voi.js';

/* -------------------------------------------------------------------------- */
/* Fixtures — a subset of vectors/commercial.json, built inline so the pure    */
/* engine package does no file I/O in a test.                                  */
/* -------------------------------------------------------------------------- */

function component(
  index: number,
  key: string,
  source: string,
  label: string,
  factor: string | null,
  appetiteFactor: boolean,
  required: boolean,
): VectorComponentSpec {
  return {
    index,
    key,
    label,
    source,
    type: 'ratio',
    scaling: { rule: 'none' },
    direction: 'higher_better',
    appetiteFactor,
    factor,
    extensionOnly: !appetiteFactor,
    immovable: false,
    required,
  };
}

const SPEC: VectorSpec = {
  lineOfBusiness: 'commercial_property',
  version: '1.0.0',
  components: [
    component(0, 'totalTiv', 'rollup.totalTiv', 'Total insured value', 'tiv', true, true),
    component(
      1,
      'quotedPremium',
      'pricing.quotedPremium',
      'Quoted total premium',
      'total_premium',
      true,
      true,
    ),
    component(
      2,
      'pctTivAcceptableConstruction',
      'rollup.pctTivAcceptableConstruction',
      'Share of TIV in acceptable construction classes',
      'construction_type',
      true,
      true,
    ),
    component(
      3,
      'pctTivSprinklered',
      'rollup.pctTivSprinklered',
      'Share of TIV sprinklered',
      'sprinkler_protection',
      false,
      false,
    ),
    component(
      4,
      'tivWeightedProtectionClass',
      'rollup.tivWeightedProtectionClass',
      'TIV-weighted public protection class',
      'protection_class',
      false,
      false,
    ),
  ],
};

const CITATION: Citation = {
  doc: 'APPETITE_GUIDELINES.pdf',
  section: 'p2',
  quote: 'TIV (Total Insured Value)',
};

function rule(id: string, factor: string, field: string, extension = false): Rule {
  return {
    id,
    lineOfBusiness: 'commercial_property',
    factor,
    tier: 'acceptable',
    when: [{ field, op: 'lte', value: 1 }],
    citation: CITATION,
    ...(extension ? { extension: true } : {}),
  };
}

const RULEBOOK: Rulebook = {
  id: 'commercial',
  lineOfBusiness: 'commercial_property',
  version: '1.0.0',
  source: 'APPETITE_GUIDELINES.pdf',
  weights: { ...FACTOR_WEIGHTS },
  rules: [
    rule('R-TIV-1', 'tiv', 'totalTiv'),
    rule('R-TIV-2', 'tiv', 'rollup.totalTiv'),
    rule('R-PREM-1', 'total_premium', 'quotedPremium'),
    rule('R-CONS-1', 'construction_type', 'pctTivAcceptableConstruction'),
    rule('R-SPR-1', 'sprinkler_protection', 'pctTivSprinklered', true),
    {
      ...rule('R-PPC-1', 'protection_class', 'tivWeightedProtectionClass', true),
      when: [{ field: 'tivWeightedProtectionClass', op: 'missing' }],
    },
  ],
};

function factorOutcome(factor: string, known: boolean): FactorOutcome {
  const weight = (FACTOR_WEIGHTS as Readonly<Record<string, number>>)[factor] ?? 0;
  return {
    factor: factor as FactorOutcome['factor'],
    componentKeys: [],
    tier: known ? 'acceptable' : null,
    tierValue: known ? 0.6 : null,
    weight,
    points: known ? 100 * weight * 0.6 : 0,
    known,
    knockout: false,
    refer: false,
    ruleId: null,
    citation: null,
  };
}

function evaluated(overrides: Partial<EvaluateResult> = {}): EvaluateResult {
  return {
    appetiteScore: 0,
    factors: [
      factorOutcome('tiv', false),
      factorOutcome('total_premium', false),
      factorOutcome('construction_type', false),
    ],
    firedRules: [],
    knockout: false,
    knockoutFactors: [],
    referFactors: [],
    missingFields: [],
    completeness: 0,
    confidence: 1,
    interpretationsApplied: [],
    ...overrides,
  };
}

function question(id: string, field: string): Question {
  return {
    id,
    field,
    prompt: `What is ${field}?`,
    inputType: 'number',
    accessibilityLabel: `Enter ${field}`,
  };
}

const QUESTIONS: readonly Question[] = [
  question('q-construction', 'pctTivAcceptableConstruction'),
  question('q-sprinkler', 'pctTivSprinklered'),
  question('q-premium', 'quotedPremium'),
  question('q-tiv', 'rollup.totalTiv'),
  question('q-ppc', 'tivWeightedProtectionClass'),
  question('q-unknown', 'rollup.somethingElse'),
];

function vector(m: readonly (0 | 1)[]): FeatureVector {
  return {
    lineOfBusiness: 'commercial_property',
    specVersion: '1.0.0',
    x: m.map((bit) => (bit === 1 ? 0.5 : null)),
    t: m.map((bit) => (bit === 1 ? 0.6 : null)),
    m,
  };
}

/* -------------------------------------------------------------------------- */

describe('voi', () => {
  it('ranks by expected score swing = 100 x factor weight (W-1)', () => {
    const result = voi(vector([0, 0, 0, 0, 0]), SPEC, RULEBOOK, evaluated(), QUESTIONS);

    expect(result.ranked.map((c) => c.question.id)).toEqual([
      'q-tiv',
      'q-premium',
      'q-construction',
      'q-sprinkler',
    ]);
    expect(result.ranked.map((c) => c.expectedScoreSwing)).toEqual([15, 15, 10, 0]);
    expect(result.ranked.map((c) => c.weight)).toEqual([0.15, 0.15, 0.1, 0]);
    expect(result.nextQuestion?.id).toBe('q-tiv');
    expect(result.askedCount).toBe(0);
  });

  it('reports the rules a missing field leaves undetermined, ignoring exists/missing ops', () => {
    const result = voi(vector([0, 0, 0, 0, 0]), SPEC, RULEBOOK, evaluated(), QUESTIONS);
    const byId = new Map(result.ranked.map((c) => [c.question.id, c]));

    // Both R-TIV-1 (by key) and R-TIV-2 (by canonical path) address component 0.
    expect(byId.get('q-tiv')?.undeterminedRuleIds).toEqual(['R-TIV-1', 'R-TIV-2']);
    expect(byId.get('q-premium')?.undeterminedRuleIds).toEqual(['R-PREM-1']);
    expect(byId.get('q-sprinkler')?.undeterminedRuleIds).toEqual(['R-SPR-1']);
    // q-ppc's only rule tests `missing`, which absence already decides, so the
    // question has no score swing and no undetermined rule: it is skipped.
    expect(byId.has('q-ppc')).toBe(false);
    expect(result.skipped).toContainEqual({
      field: 'tivWeightedProtectionClass',
      reason: 'Cannot change the appetite score or resolve a rule.',
    });
  });

  it('drops a rule that has already fired', () => {
    const fired = evaluated({
      firedRules: [
        {
          ruleId: 'R-TIV-1',
          factor: 'tiv',
          tier: 'acceptable',
          tierValue: 0.6,
          weight: 0.15,
          points: 9,
          citation: CITATION,
          conditions: [],
          extension: false,
        },
      ],
    });
    const result = voi(vector([0, 0, 0, 0, 0]), SPEC, RULEBOOK, fired, QUESTIONS);
    const tiv = result.ranked.find((c) => c.question.id === 'q-tiv');
    expect(tiv?.undeterminedRuleIds).toEqual(['R-TIV-2']);
  });

  it('skips known, already-asked and unscored fields with a one-line reason each', () => {
    const result = voi(
      vector([1, 0, 0, 0, 0]),
      SPEC,
      RULEBOOK,
      evaluated(),
      QUESTIONS,
      ['q-premium', 'q-premium'],
    );

    expect(result.askedCount).toBe(1);
    expect(result.ranked.map((c) => c.question.id)).toEqual(['q-construction', 'q-sprinkler']);
    expect(result.nextQuestion?.id).toBe('q-construction');
    expect(result.skipped).toEqual([
      { field: 'quotedPremium', reason: 'Already asked earlier in this sweep.' },
      { field: 'rollup.totalTiv', reason: 'Already known — no answer needed.' },
      {
        field: 'tivWeightedProtectionClass',
        reason: 'Cannot change the appetite score or resolve a rule.',
      },
      { field: 'rollup.somethingElse', reason: 'Not a scored field for this line of business.' },
    ]);
    for (const s of result.skipped) expect(s.reason.split('\n')).toHaveLength(1);
  });

  it('gives a factor already decided by a sibling component no swing (T-SPAN)', () => {
    const result = voi(
      vector([0, 0, 0, 0, 0]),
      SPEC,
      RULEBOOK,
      evaluated({
        factors: [
          factorOutcome('tiv', true),
          factorOutcome('total_premium', false),
          factorOutcome('construction_type', false),
        ],
      }),
      QUESTIONS,
    );
    const tiv = result.ranked.find((c) => c.question.id === 'q-tiv');
    expect(tiv?.expectedScoreSwing).toBe(0);
    // Still worth asking: two rules remain undetermined, so it ranks last-ish
    // but is not skipped.
    expect(result.ranked.map((c) => c.question.id)).toEqual([
      'q-premium',
      'q-construction',
      'q-tiv',
      'q-sprinkler',
    ]);
    expect(result.nextQuestion?.id).toBe('q-premium');
  });

  it('explains a missing field no question covers', () => {
    const result = voi(
      vector([0, 1, 1, 1, 1]),
      SPEC,
      RULEBOOK,
      evaluated({
        missingFields: [
          {
            componentKey: 'pctTivPre1990',
            canonicalPath: 'rollup.pctTivPre1990',
            factor: 'building_age',
            required: true,
            reason: 'no building year',
          },
        ],
      }),
      [question('q-premium', 'quotedPremium')],
    );
    expect(result.skipped).toEqual([
      { field: 'quotedPremium', reason: 'Already known — no answer needed.' },
      {
        field: 'pctTivPre1990',
        reason: 'No question covers this field — ask the broker directly.',
      },
    ]);
    expect(result.nextQuestion).toBeNull();
    expect(result.ranked).toEqual([]);
  });

  it('is deterministic and returns no question when nothing is missing', () => {
    const full = vector([1, 1, 1, 1, 1]);
    const a = voi(full, SPEC, RULEBOOK, evaluated(), QUESTIONS);
    const b = voi(full, SPEC, RULEBOOK, evaluated(), QUESTIONS);
    expect(a.nextQuestion).toBeNull();
    expect(a.ranked).toEqual([]);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it('writes a one-line reason naming the factor, the weight and the points', () => {
    const result = voi(vector([0, 0, 0, 0, 0]), SPEC, RULEBOOK, evaluated(), QUESTIONS);
    expect(result.ranked[0]?.reason).toBe(
      'Total insured value is unknown: it decides the tiv factor (weight 0.15), ' +
        'worth up to 15.0 appetite points and leaves 2 rules undetermined.',
    );
    expect(result.ranked[2]?.reason).toBe(
      'Share of TIV in acceptable construction classes is unknown: it decides the ' +
        'construction_type factor (weight 0.1), worth up to 10.0 appetite points ' +
        'and leaves 1 rule undetermined.',
    );
  });
});
