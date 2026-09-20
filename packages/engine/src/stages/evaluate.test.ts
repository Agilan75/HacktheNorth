/**
 * E06 — `evaluate`, checked against the worked boundary cases of
 * `docs/contracts/INTERPRETATIONS.md` §8 (B1, B6, B9, B11, B12) and against
 * V-6 (completeness over the NINE required components) and V-7 (confidence over
 * the deciding rule's fields only).
 */
import { describe, expect, it } from 'vitest';

import { evaluate } from './evaluate.js';
import { FACTOR_WEIGHTS, RATIO_TOLERANCE, SCORE_TOLERANCE } from '../constants.js';
import type {
  CanonicalSubmission,
  Condition,
  FeatureVector,
  Rulebook,
  Rule,
  Sourced,
  Tier,
  VectorSpec,
} from '../types.js';

/* -------------------------------------------------------------------------- */
/* Fixtures — the eleven commercial components, as vectors/commercial.json      */
/* -------------------------------------------------------------------------- */

interface TestComponent {
  index: number;
  key: string;
  label: string;
  source: string;
  type: 'binary' | 'tier' | 'currency' | 'ratio' | 'count' | 'ordinal' | 'year';
  scaling: { rule: 'none' | 'log_minmax' | 'log1p_minmax' | 'divide' | 'minmax'; divisor?: number };
  required: boolean;
  factor: string;
}

const COMPONENTS: TestComponent[] = [
  { index: 0, key: 'isNewBusiness', label: 'New business', source: 'submissionType', type: 'binary', scaling: { rule: 'none' }, required: true, factor: 'submission_type' },
  { index: 1, key: 'isPropertyLine', label: 'Property line of business', source: 'lineOfBusiness', type: 'binary', scaling: { rule: 'none' }, required: true, factor: 'line_of_business' },
  { index: 2, key: 'stateTier', label: 'Primary risk state tier', source: 'rollup.primaryState', type: 'tier', scaling: { rule: 'divide', divisor: 2 }, required: true, factor: 'primary_risk_state' },
  { index: 3, key: 'totalTiv', label: 'Total insured value', source: 'rollup.totalTiv', type: 'currency', scaling: { rule: 'log_minmax' }, required: true, factor: 'tiv' },
  { index: 4, key: 'quotedPremium', label: 'Quoted total premium', source: 'pricing.quotedPremium', type: 'currency', scaling: { rule: 'log_minmax' }, required: true, factor: 'total_premium' },
  { index: 5, key: 'pctTivPre1990', label: 'Share of TIV built before 1990', source: 'rollup.pctTivPre1990', type: 'ratio', scaling: { rule: 'none' }, required: true, factor: 'building_age' },
  { index: 6, key: 'pctTivPost2010', label: 'Share of TIV built in 2010 or later', source: 'rollup.pctTivPost2010', type: 'ratio', scaling: { rule: 'none' }, required: true, factor: 'building_age' },
  { index: 7, key: 'pctTivAcceptableConstruction', label: 'Share of TIV in acceptable construction classes', source: 'rollup.pctTivAcceptableConstruction', type: 'ratio', scaling: { rule: 'none' }, required: true, factor: 'construction_type' },
  { index: 8, key: 'fiveYearLoss', label: 'Five-year loss value', source: 'rollup.fiveYearLoss', type: 'currency', scaling: { rule: 'log1p_minmax' }, required: true, factor: 'loss_value' },
  { index: 9, key: 'pctTivSprinklered', label: 'Share of TIV sprinklered', source: 'rollup.pctTivSprinklered', type: 'ratio', scaling: { rule: 'none' }, required: false, factor: 'sprinkler_protection' },
  { index: 10, key: 'tivWeightedProtectionClass', label: 'TIV-weighted public protection class', source: 'rollup.tivWeightedProtectionClass', type: 'ordinal', scaling: { rule: 'divide', divisor: 10 }, required: false, factor: 'protection_class' },
];

const SPEC = {
  lineOfBusiness: 'commercial_property',
  version: '1.0.0',
  components: COMPONENTS,
} as unknown as VectorSpec;

const AG = (row: string): { doc: string; section: string; quote: string } => ({
  doc: 'APPETITE_GUIDELINES.pdf',
  section: `p2 "${row}"`,
  quote: row,
});

function rule(
  id: string,
  factor: string,
  tier: Tier,
  when: Condition[],
  row: string,
): Rule {
  return {
    id,
    lineOfBusiness: 'commercial_property',
    factor,
    tier,
    when,
    weight: FACTOR_WEIGHTS[factor as keyof typeof FACTOR_WEIGHTS],
    citation: AG(row),
  };
}

/** The INTERPRETATIONS §3 boundaries, transcribed as AND-only conditions. */
const RULES: Rule[] = [
  rule('AG-ST-A', 'submission_type', 'acceptable', [{ field: 'isNewBusiness', op: 'eq', value: 1 }], 'Submission type'),
  rule('AG-ST-NA', 'submission_type', 'not_acceptable', [{ field: 'isNewBusiness', op: 'eq', value: 0 }], 'Submission type'),
  rule('AG-LOB-A', 'line_of_business', 'acceptable', [{ field: 'isPropertyLine', op: 'eq', value: 1 }], 'Line of business'),
  rule('AG-LOB-NA', 'line_of_business', 'not_acceptable', [{ field: 'isPropertyLine', op: 'eq', value: 0 }], 'Line of business'),
  rule('AG-STATE-T', 'primary_risk_state', 'target', [{ field: 'stateTier', op: 'eq', value: 2 }], 'Primary risk state'),
  rule('AG-STATE-A', 'primary_risk_state', 'acceptable', [{ field: 'stateTier', op: 'eq', value: 1 }], 'Primary risk state'),
  rule('AG-STATE-NA', 'primary_risk_state', 'not_acceptable', [{ field: 'stateTier', op: 'eq', value: 0 }], 'Primary risk state'),
  rule('AG-TIV-T', 'tiv', 'target', [
    { field: 'totalTiv', op: 'gte', value: 50_000_000 },
    { field: 'totalTiv', op: 'lte', value: 100_000_000 },
  ], 'TIV (Total Insured Value)'),
  rule('AG-TIV-A', 'tiv', 'acceptable', [{ field: 'totalTiv', op: 'lte', value: 150_000_000 }], 'TIV (Total Insured Value)'),
  rule('AG-TIV-NA', 'tiv', 'not_acceptable', [{ field: 'totalTiv', op: 'gt', value: 150_000_000 }], 'TIV (Total Insured Value)'),
  rule('AG-PREM-T', 'total_premium', 'target', [
    { field: 'quotedPremium', op: 'gte', value: 75_000 },
    { field: 'quotedPremium', op: 'lte', value: 100_000 },
  ], 'Total premium'),
  rule('AG-PREM-A', 'total_premium', 'acceptable', [
    { field: 'quotedPremium', op: 'gte', value: 50_000 },
    { field: 'quotedPremium', op: 'lte', value: 175_000 },
  ], 'Total premium'),
  rule('AG-PREM-NA-LOW', 'total_premium', 'not_acceptable', [{ field: 'quotedPremium', op: 'lt', value: 50_000 }], 'Total premium'),
  rule('AG-PREM-NA-HIGH', 'total_premium', 'not_acceptable', [{ field: 'quotedPremium', op: 'gt', value: 175_000 }], 'Total premium'),
  rule('AG-AGE-NA', 'building_age', 'not_acceptable', [{ field: 'pctTivPre1990', op: 'gt', value: 0.5 }], 'Building age'),
  rule('AG-AGE-T', 'building_age', 'target', [
    { field: 'pctTivPre1990', op: 'lte', value: 0.5 },
    { field: 'pctTivPost2010', op: 'gt', value: 0.5 },
  ], 'Building age'),
  rule('AG-AGE-A', 'building_age', 'acceptable', [{ field: 'pctTivPre1990', op: 'lte', value: 0.5 }], 'Building age'),
  // R-AGE-REFER: anyBuildingPre1990 AND pctTivPre1990 <= 0.5.
  rule('AG-AGE-REFER', 'building_age', 'refer', [
    { field: 'pctTivPre1990', op: 'lte', value: 0.5 },
    { field: 'rollup.oldestYearBuilt', op: 'lt', value: 1990 },
  ], 'Building age'),
  rule('AG-CON-A', 'construction_type', 'acceptable', [{ field: 'pctTivAcceptableConstruction', op: 'gte', value: 0.5 }], 'Construction type'),
  rule('AG-CON-NA', 'construction_type', 'not_acceptable', [{ field: 'pctTivAcceptableConstruction', op: 'lt', value: 0.5 }], 'Construction type'),
  rule('AG-LOSS-A', 'loss_value', 'acceptable', [{ field: 'fiveYearLoss', op: 'lte', value: 100_000 }], 'Loss value'),
  rule('AG-LOSS-NA', 'loss_value', 'not_acceptable', [{ field: 'fiveYearLoss', op: 'gt', value: 100_000 }], 'Loss value'),
];

const RULEBOOK: Rulebook = {
  id: 'commercial',
  lineOfBusiness: 'commercial_property',
  version: '1.0.0',
  source: 'APPETITE_GUIDELINES.pdf',
  weights: FACTOR_WEIGHTS,
  rules: RULES,
  interpretations: [
    {
      id: 'I-3',
      title: 'Fire Resistive counts as acceptable construction',
      decision: 'Treated as acceptable and flagged.',
      affects: ['pctTivAcceptableConstruction'],
    },
    {
      id: 'I-9',
      title: 'Never touched by these fixtures',
      decision: 'Should not appear.',
      affects: ['someOtherComponent'],
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* Vector + submission builders                                                */
/* -------------------------------------------------------------------------- */

/** INTERPRETATIONS §3, as an independent oracle for `t` (this is E05's job). */
function tierFor(index: number, x: readonly (number | null)[]): number | null {
  const v = x[index];
  if (v === null || v === undefined) return null;
  switch (index) {
    case 0:
    case 1:
      return v === 1 ? 1 : 0; // T-BLANK: acceptable scores 1
    case 2:
      return v === 2 ? 1 : v === 1 ? 0.6 : 0;
    case 3:
      return v >= 50_000_000 && v <= 100_000_000 ? 1 : v > 150_000_000 ? 0 : 0.6;
    case 4:
      return v < 50_000 || v > 175_000 ? 0 : v >= 75_000 && v <= 100_000 ? 1 : 0.6;
    case 5:
    case 6: {
      const pre = x[5];
      const post = x[6];
      if (pre === null || pre === undefined || post === null || post === undefined) return null;
      if (pre > 0.5) return 0;
      if (post > 0.5) return 1;
      return 0.6;
    }
    case 7:
      return v >= 0.5 ? 1 : 0; // T-BLANK
    case 8:
      return v <= 100_000 ? 1 : 0; // T-BLANK
    default:
      return null;
  }
}

function vectorOf(x: readonly (number | null)[]): FeatureVector {
  const m = x.map((v) => (v === null || v === undefined ? 0 : 1)) as (0 | 1)[];
  const t = x.map((_, i) => (m[i] === 1 ? tierFor(i, x) : null));
  return { lineOfBusiness: 'commercial_property', specVersion: '1.0.0', x, t, m };
}

const B1_X: (number | null)[] = [1, 1, 2, 150_000_000, 175_000, 0, 0, 0.5, 100_000, null, null];

function sourced<T>(value: T, source: 'self_reported' | 'enrichment' | 'answer' = 'self_reported'): Sourced<T> {
  return [{ value, provenance: { source } }];
}

interface SubmissionOptions {
  readonly renewal?: boolean;
  readonly quotedPremium?: number | null;
  readonly oldestYearBuilt?: number | null;
  readonly pctTivPre1990?: number;
  readonly byConstruction?: readonly {
    constructionType: string;
    share: number;
    acceptable: boolean;
    assumedAcceptable: boolean;
  }[];
  readonly pctTivAcceptableConstruction?: number;
}

function submissionOf(options: SubmissionOptions = {}): CanonicalSubmission {
  const premium = options.quotedPremium === undefined ? 175_000 : options.quotedPremium;
  return {
    id: 'S1',
    lineOfBusiness: 'commercial_property',
    submissionType: sourced(options.renewal === true ? 'renewal' : 'new_business'),
    insured: { name: sourced('Acme Holdings') },
    locations: [{ externalId: 'L1', state: sourced('OH', 'enrichment') }],
    buildings: [
      {
        externalId: 'B1',
        locationExternalId: 'L1',
        tiv: sourced(100_000_000),
        yearBuilt: sourced(1989, 'enrichment'),
      },
      {
        externalId: 'B2',
        locationExternalId: 'L1',
        tiv: sourced(50_000_000),
        yearBuilt: sourced(2005, 'enrichment'),
      },
    ],
    hazards: { present: {} },
    exposure: {},
    coverage: { lines: [] },
    history: [],
    pricing: premium === null ? {} : { quotedPremium: sourced(premium) },
    rollup: {
      totalTiv: 150_000_000,
      buildingCount: 2,
      tivKnownBuildingCount: 2,
      pctTivPre1990: options.pctTivPre1990 ?? 0,
      pctTivPost2010: 0,
      pctTivByConstruction: (options.byConstruction ?? []).map((c) => ({ ...c, tiv: c.share * 150_000_000 })),
      pctTivAcceptableConstruction: options.pctTivAcceptableConstruction ?? 0.5,
      pctTivSprinklered: null,
      tivWeightedProtectionClass: null,
      primaryState: 'OH',
      stateShares: [],
      fiveYearLoss: 100_000,
      fiveYearClaimCount: 0,
      claimCount: 0,
      pre1990BuildingIds: [],
      oldestYearBuilt: options.oldestYearBuilt === undefined ? 2005 : options.oldestYearBuilt,
      newestYearBuilt: 2005,
      lossWindow: null,
    },
  } as unknown as CanonicalSubmission;
}

const near = (actual: number, expected: number, tol = SCORE_TOLERANCE): void => {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
};

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe('evaluate — INTERPRETATIONS §8 worked boundary cases', () => {
  it('B1 scores exactly 84 with every boundary value inclusive', () => {
    const result = evaluate(vectorOf(B1_X), SPEC, RULEBOOK, submissionOf());

    near(result.appetiteScore, 84);
    expect(result.knockout).toBe(false);
    expect(result.knockoutFactors).toEqual([]);
    expect(result.referFactors).toEqual([]);
    near(result.completeness, 100, RATIO_TOLERANCE);

    const tiers = result.factors.map((f) => f.tierValue);
    expect(tiers).toEqual([1, 1, 1, 0.6, 0.6, 0.6, 1, 1]);
    expect(result.factors.map((f) => f.factor)).toEqual([
      'submission_type',
      'line_of_business',
      'primary_risk_state',
      'tiv',
      'total_premium',
      'building_age',
      'construction_type',
      'loss_value',
    ]);
  });

  it('T-BLANK: construction and loss score 1 on their Acceptable condition', () => {
    const result = evaluate(vectorOf(B1_X), SPEC, RULEBOOK, submissionOf());
    const construction = result.factors.find((f) => f.factor === 'construction_type');
    const loss = result.factors.find((f) => f.factor === 'loss_value');
    expect(construction?.tierValue).toBe(1);
    expect(construction?.ruleId).toBe('AG-CON-A');
    expect(loss?.tierValue).toBe(1);
    near(construction?.points ?? 0, 10);
  });

  it('T-SPAN: building_age spans components 5 and 6 but is counted once', () => {
    const result = evaluate(vectorOf(B1_X), SPEC, RULEBOOK, submissionOf());
    const age = result.factors.find((f) => f.factor === 'building_age');
    expect(age?.componentKeys).toEqual(['pctTivPre1990', 'pctTivPost2010']);
    near(age?.points ?? 0, 6); // 100 * 0.10 * 0.6, not 12
  });

  it('B6: pctTivPre1990 == 0.5 with a 1989 building refers without a knockout', () => {
    const x = [...B1_X];
    x[5] = 0.5;
    const result = evaluate(
      vectorOf(x),
      SPEC,
      RULEBOOK,
      submissionOf({ oldestYearBuilt: 1989, pctTivPre1990: 0.5 }),
    );

    near(result.appetiteScore, 84); // a refer flag never lowers the score
    expect(result.knockout).toBe(false);
    expect(result.referFactors).toEqual(['building_age']);
    expect(result.factors.find((f) => f.factor === 'building_age')?.tierValue).toBe(0.6);
    expect(result.firedRules.some((r) => r.ruleId === 'AG-AGE-REFER' && r.tier === 'refer')).toBe(true);
  });

  it('B7: pctTivPre1990 == 0.500001 knocks out and raises no refer flag', () => {
    const x = [...B1_X];
    x[5] = 0.500001;
    const result = evaluate(
      vectorOf(x),
      SPEC,
      RULEBOOK,
      submissionOf({ oldestYearBuilt: 1989, pctTivPre1990: 0.500001 }),
    );

    expect(result.knockout).toBe(true);
    expect(result.knockoutFactors).toEqual(['building_age']);
    expect(result.referFactors).toEqual([]);
    near(result.appetiteScore, 78); // 84 - 6
  });

  it('B9: TIV 50M and premium 75K score exactly 96', () => {
    const x = [...B1_X];
    x[3] = 50_000_000;
    x[4] = 75_000;
    const result = evaluate(vectorOf(x), SPEC, RULEBOOK, submissionOf({ quotedPremium: 75_000 }));

    near(result.appetiteScore, 96);
    expect(result.factors.find((f) => f.factor === 'tiv')?.ruleId).toBe('AG-TIV-T');
    expect(result.factors.find((f) => f.factor === 'total_premium')?.ruleId).toBe('AG-PREM-T');
  });

  it('B11: a missing quoted premium scores 81 and completeness 8/9', () => {
    const x = [...B1_X];
    x[3] = 50_000_000;
    x[4] = null;
    const result = evaluate(vectorOf(x), SPEC, RULEBOOK, submissionOf({ quotedPremium: null }));

    near(result.appetiteScore, 81);
    near(result.completeness, (100 * 8) / 9, RATIO_TOLERANCE);
    expect(result.knockout).toBe(false);
    const premium = result.factors.find((f) => f.factor === 'total_premium');
    expect(premium?.known).toBe(false);
    expect(premium?.tierValue).toBe(null);
    expect(premium?.points).toBe(0);
    expect(result.missingFields.map((f) => f.componentKey)).toContain('quotedPremium');
  });

  it('B12: a renewal knocks out but still scores 86', () => {
    const x = [...B1_X];
    x[0] = 0;
    x[3] = 50_000_000;
    x[4] = 75_000;
    const result = evaluate(
      vectorOf(x),
      SPEC,
      RULEBOOK,
      submissionOf({ renewal: true, quotedPremium: 75_000 }),
    );

    near(result.appetiteScore, 86);
    expect(result.knockout).toBe(true);
    expect(result.knockoutFactors).toEqual(['submission_type']);
    expect(result.factors.find((f) => f.factor === 'submission_type')?.ruleId).toBe('AG-ST-NA');
  });
});

describe('evaluate — V-6 completeness', () => {
  it('counts the nine required components, not the eight factors', () => {
    const x = B1_X.map(() => null) as (number | null)[];
    const result = evaluate(vectorOf(x), SPEC, RULEBOOK, submissionOf());
    near(result.completeness, 0, RATIO_TOLERANCE);
    near(result.appetiteScore, 0);
    expect(result.knockout).toBe(false); // G-2: missing never knocks out
    expect(result.missingFields.filter((f) => f.required)).toHaveLength(9);
  });

  it('drops exactly 1/9 per missing required component', () => {
    const x = [...B1_X];
    x[5] = null;
    x[6] = null;
    const result = evaluate(vectorOf(x), SPEC, RULEBOOK, submissionOf());
    near(result.completeness, (100 * 7) / 9, RATIO_TOLERANCE);
  });
});

describe('evaluate — V-7 confidence over the deciding rule only', () => {
  it('B1 takes the confidence of the TIV rule fields alone (self-reported, 0.7)', () => {
    const result = evaluate(vectorOf(B1_X), SPEC, RULEBOOK, submissionOf());
    // Deciding factor (V-8) is `tiv`: lowest tierValue 0.6, ties by highest
    // weight 0.15, then factor order puts tiv before total_premium.
    near(result.confidence, 0.7, RATIO_TOLERANCE);
  });

  it('a renewal decides on submission_type, a self-reported field', () => {
    const x = [...B1_X];
    x[0] = 0;
    const result = evaluate(vectorOf(x), SPEC, RULEBOOK, submissionOf({ renewal: true }));
    near(result.confidence, 0.7, RATIO_TOLERANCE);
  });

  it('building_age multiplies one field per distinct source kind (0.9 x 0.7)', () => {
    const x = [...B1_X];
    x[3] = 50_000_000;
    x[4] = 75_000;
    const result = evaluate(vectorOf(x), SPEC, RULEBOOK, submissionOf({ quotedPremium: 75_000 }));
    // building_age is the only 0.6 factor here: yearBuilt is enrichment (0.9),
    // tiv is self_reported (0.7), and the two buildings do not multiply twice.
    near(result.confidence, 0.63, RATIO_TOLERANCE);
  });

  it('is 1 when every appetite factor is missing', () => {
    const x = B1_X.map(() => null) as (number | null)[];
    const result = evaluate(vectorOf(x), SPEC, RULEBOOK, submissionOf());
    near(result.confidence, 1, RATIO_TOLERANCE);
  });
});

describe('evaluate — fired rules and interpretations', () => {
  it('reports every fired rule with its citation', () => {
    const result = evaluate(vectorOf(B1_X), SPEC, RULEBOOK, submissionOf());
    const ids = result.firedRules.map((r) => r.ruleId);
    expect(ids).toContain('AG-TIV-A');
    expect(ids).not.toContain('AG-TIV-NA');
    for (const fired of result.firedRules) {
      expect(fired.citation.doc).toBe('APPETITE_GUIDELINES.pdf');
      expect(fired.citation.quote.length).toBeGreaterThan(0);
    }
  });

  it('gives an extension rule zero points and never lets it knock out', () => {
    const extensions: Rulebook = {
      id: 'extensions',
      lineOfBusiness: 'commercial_property',
      version: '1.0.0',
      source: 'Retrofit',
      weights: {},
      rules: [
        {
          id: 'RF-SPRINK-REFER',
          lineOfBusiness: 'commercial_property',
          factor: 'sprinkler_protection',
          tier: 'refer',
          when: [{ field: 'totalTiv', op: 'gt', value: 1 }],
          citation: { doc: 'Retrofit', section: 'extensions', quote: 'Sprinkler protection' },
          extension: true,
        },
      ],
    };

    const result = evaluate(vectorOf(B1_X), SPEC, RULEBOOK, submissionOf(), extensions);
    const fired = result.firedRules.find((r) => r.ruleId === 'RF-SPRINK-REFER');
    expect(fired?.extension).toBe(true);
    expect(fired?.points).toBe(0);
    near(result.appetiteScore, 84);
    expect(result.knockout).toBe(false);
    expect(result.referFactors).toEqual([]); // not one of the eight appetite factors
  });

  it('surfaces only the interpretations a fired rule touched', () => {
    const result = evaluate(vectorOf(B1_X), SPEC, RULEBOOK, submissionOf({ byConstruction: FR_DECIDES }));
    expect(result.interpretationsApplied.map((i) => i.id)).toEqual(['I-3']);
  });

  it('is deterministic: the same input gives the same output', () => {
    const a = evaluate(vectorOf(B1_X), SPEC, RULEBOOK, submissionOf());
    const b = evaluate(vectorOf(B1_X), SPEC, RULEBOOK, submissionOf());
    expect(a).toEqual(b);
  });
});

/* -------------------------------------------------------------------------- */
/* R2 fixer 5 — I-3 is surfaced only when the construction tier depends on it  */
/* -------------------------------------------------------------------------- */

const FR_DECIDES = [
  { constructionType: 'fire_resistive', share: 0.5, acceptable: true, assumedAcceptable: true },
  { constructionType: 'frame', share: 0.5, acceptable: false, assumedAcceptable: false },
];

function withConstruction(share: number): (number | null)[] {
  const x = [...B1_X];
  x[7] = share;
  return x;
}

describe('evaluate — I-3 dependency (INTERPRETATIONS I-3)', () => {
  const ids = (share: number, byConstruction: SubmissionOptions['byConstruction']): string[] =>
    evaluate(
      vectorOf(withConstruction(share)),
      SPEC,
      RULEBOOK,
      submissionOf({ byConstruction, pctTivAcceptableConstruction: share }),
    ).interpretationsApplied.map((i) => i.id);

  it('attaches I-3 when removing FR/MFR TIV would flip the construction tier', () => {
    expect(ids(0.5, FR_DECIDES)).toContain('I-3');
    expect(
      ids(0.7, [
        { constructionType: 'modified_fire_resistive', share: 0.4, acceptable: true, assumedAcceptable: true },
        { constructionType: 'joisted_masonry', share: 0.3, acceptable: true, assumedAcceptable: false },
        { constructionType: 'frame', share: 0.3, acceptable: false, assumedAcceptable: false },
      ]),
    ).toContain('I-3');
  });

  it('does not attach I-3 when the account has no FR/MFR building', () => {
    expect(
      ids(1, [{ constructionType: 'joisted_masonry', share: 1, acceptable: true, assumedAcceptable: false }]),
    ).not.toContain('I-3');
    expect(
      ids(0, [{ constructionType: 'frame', share: 1, acceptable: false, assumedAcceptable: false }]),
    ).not.toContain('I-3');
  });

  it('does not attach I-3 when FR/MFR is present but the tier holds without it', () => {
    // Acceptable either way: 0.9 with FR, 0.8 without.
    expect(
      ids(0.9, [
        { constructionType: 'joisted_masonry', share: 0.8, acceptable: true, assumedAcceptable: false },
        { constructionType: 'fire_resistive', share: 0.1, acceptable: true, assumedAcceptable: true },
        { constructionType: 'frame', share: 0.1, acceptable: false, assumedAcceptable: false },
      ]),
    ).not.toContain('I-3');
    // Not Acceptable either way: 0.3 with FR, 0 without.
    expect(
      ids(0.3, [
        { constructionType: 'fire_resistive', share: 0.3, acceptable: true, assumedAcceptable: true },
        { constructionType: 'frame', share: 0.7, acceptable: false, assumedAcceptable: false },
      ]),
    ).not.toContain('I-3');
  });
});
