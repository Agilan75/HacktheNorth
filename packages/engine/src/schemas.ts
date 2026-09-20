/**
 * Retrofit engine — zod schemas for the four data files the engine reads.
 *
 * These are the only validation the engine performs. Every loader in `data.ts`
 * parses through one of these, so a malformed rulebook fails loudly at boot
 * rather than silently scoring wrong.
 *
 * FROZEN after Run 0. E13/E14/E15 author JSON that satisfies these; they do not
 * change the schemas.
 */

import { z } from 'zod';
import { WEIGHT_SUM_TOLERANCE } from './constants.js';

/* -------------------------------------------------------------------------- */
/* Shared                                                                     */
/* -------------------------------------------------------------------------- */

export const lineOfBusinessSchema = z.enum(['commercial_property', 'tenant']);

export const tierSchema = z.enum(['target', 'acceptable', 'not_acceptable', 'refer']);

export const citationSchema = z.object({
  doc: z.string().min(1),
  section: z.string().min(1),
  quote: z.string().min(1),
});

export const conditionOpSchema = z.enum([
  'lt',
  'lte',
  'gt',
  'gte',
  'eq',
  'neq',
  'in',
  'notin',
  'exists',
  'missing',
]);

export const conditionValueSchema = z.union([
  z.number(),
  z.string(),
  z.boolean(),
  z.array(z.union([z.number(), z.string(), z.boolean()])),
]);

export const conditionSchema = z
  .object({
    field: z.string().min(1),
    op: conditionOpSchema,
    value: conditionValueSchema.optional(),
  })
  .refine(
    (c) => (c.op === 'exists' || c.op === 'missing' ? true : c.value !== undefined),
    { message: 'value is required for every op except exists and missing' },
  )
  .refine(
    (c) => (c.op === 'in' || c.op === 'notin' ? Array.isArray(c.value) : true),
    { message: 'in/notin require an array value' },
  );

export const appliedInterpretationSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  decision: z.string().min(1),
  citation: citationSchema.optional(),
  affects: z.array(z.string()),
});

/* -------------------------------------------------------------------------- */
/* Rulebook                                                                   */
/* -------------------------------------------------------------------------- */

export const ruleSchema = z.object({
  id: z.string().min(1),
  lineOfBusiness: lineOfBusinessSchema,
  factor: z.string().min(1),
  tier: tierSchema,
  when: z.array(conditionSchema).min(1),
  weight: z.number().min(0).max(1).optional(),
  citation: citationSchema,
  fixHint: z.string().optional(),
  ratingFactor: z.string().optional(),
  extension: z.boolean().optional(),
  interpretation: z.string().optional(),
});

export const rulebookSchema = z
  .object({
    id: z.string().min(1),
    lineOfBusiness: lineOfBusinessSchema,
    version: z.string().min(1),
    source: z.string().min(1),
    weights: z.record(z.string(), z.number().min(0).max(1)),
    rules: z.array(ruleSchema).min(1),
    interpretations: z.array(appliedInterpretationSchema).optional(),
  })
  .refine((rb) => new Set(rb.rules.map((r) => r.id)).size === rb.rules.length, {
    message: 'rule ids must be unique',
  })
  .refine((rb) => rb.rules.every((r) => r.lineOfBusiness === rb.lineOfBusiness), {
    message: 'every rule must share the rulebook line of business',
  })
  .refine(
    (rb) => {
      const total = Object.values(rb.weights).reduce((a, b) => a + b, 0);
      // An extension rulebook carries no weights at all.
      return total === 0 || Math.abs(total - 1) <= WEIGHT_SUM_TOLERANCE;
    },
    { message: 'factor weights must sum to exactly 1 (or be empty for extensions)' },
  );

/* -------------------------------------------------------------------------- */
/* Vector spec                                                                */
/* -------------------------------------------------------------------------- */

export const scalingRuleSchema = z.enum(['none', 'log_minmax', 'log1p_minmax', 'divide', 'minmax']);

export const directionSchema = z.enum(['higher_better', 'lower_better', 'band', 'neutral']);

export const componentTypeSchema = z.enum([
  'binary',
  'tier',
  'currency',
  'ratio',
  'count',
  'ordinal',
  'year',
]);

export const vectorComponentSpecSchema = z
  .object({
    index: z.number().int().min(0),
    key: z.string().min(1),
    label: z.string().min(1),
    source: z.string().min(1),
    type: componentTypeSchema,
    scaling: z.object({
      rule: scalingRuleSchema,
      divisor: z.number().optional(),
    }),
    direction: directionSchema,
    appetiteFactor: z.boolean(),
    factor: z.string().min(1).nullable(),
    extensionOnly: z.boolean(),
    immovable: z.boolean(),
    required: z.boolean(),
    min: z.number().optional(),
    max: z.number().optional(),
  })
  .refine((c) => (c.scaling.rule === 'divide' ? typeof c.scaling.divisor === 'number' : true), {
    message: 'divide scaling requires a divisor',
  })
  .refine((c) => (c.appetiteFactor ? c.factor !== null : true), {
    message: 'an appetite component must name its factor',
  })
  .refine((c) => !(c.appetiteFactor && c.extensionOnly), {
    message: 'a component cannot be both an appetite factor and extension-only',
  });

export const vectorSpecSchema = z
  .object({
    lineOfBusiness: lineOfBusinessSchema,
    version: z.string().min(1),
    components: z.array(vectorComponentSpecSchema).min(1),
  })
  .refine((s) => s.components.every((c, i) => c.index === i), {
    message: 'component.index must equal its array position',
  })
  .refine((s) => new Set(s.components.map((c) => c.key)).size === s.components.length, {
    message: 'component keys must be unique',
  });

/* -------------------------------------------------------------------------- */
/* Rating tables                                                              */
/* -------------------------------------------------------------------------- */

export const ratingBandSchema = z.object({
  key: z.string().min(1),
  upTo: z.number().nullable(),
  factor: z.number().positive(),
});

/** Bands are ordered by `upTo` ascending, with at most one open-ended band last. */
const orderedBands = z.array(ratingBandSchema).min(1).refine(
  (bands) => {
    for (let i = 1; i < bands.length; i += 1) {
      const prev = bands[i - 1];
      const cur = bands[i];
      if (prev === undefined || cur === undefined) return false;
      if (prev.upTo === null) return false;
      if (cur.upTo !== null && cur.upTo <= prev.upTo) return false;
    }
    return true;
  },
  { message: 'bands must be ordered by upTo ascending with the open band last' },
);

export const fitErrorSchema = z.object({
  mape: z.number().min(0),
  r2: z.number(),
  n: z.number().int().min(0),
});

export const commercialRatingTableSchema = z.object({
  lineOfBusiness: z.literal('commercial_property'),
  version: z.string().min(1),
  baseRate: z.number().positive(),
  construction: z.record(z.string(), z.number().positive()),
  age: orderedBands,
  protectionClass: orderedBands,
  sprinkler: z.object({
    sprinklered: z.number().positive(),
    unsprinklered: z.number().positive(),
  }),
  lossHistory: orderedBands,
  credibilityK: z.number().positive(),
  fitError: fitErrorSchema.optional(),
  fittedAt: z.string().optional(),
});

export const tenantRatingTableSchema = z.object({
  lineOfBusiness: z.literal('tenant'),
  version: z.string().min(1),
  baseMonthlyRate: z.number().positive(),
  contents: orderedBands,
  buildingAge: orderedBands,
  hazards: z.record(z.string(), z.number().positive()),
  term: z.record(z.string(), z.number().positive()),
  smokeDetector: z.object({
    present: z.number().positive(),
    absent: z.number().positive(),
  }),
});

export const ratingTableSchema = z.discriminatedUnion('lineOfBusiness', [
  commercialRatingTableSchema,
  tenantRatingTableSchema,
]);

/* -------------------------------------------------------------------------- */
/* Tenant question file                                                       */
/* -------------------------------------------------------------------------- */

export const questionInputTypeSchema = z.enum([
  'boolean',
  'number',
  'single_select',
  'multi_select',
  'text',
]);

export const questionOptionSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean()]),
  label: z.string().min(1),
});

export const questionSchema = z
  .object({
    id: z.string().min(1),
    field: z.string().min(1),
    prompt: z.string().min(1),
    inputType: questionInputTypeSchema,
    options: z.array(questionOptionSchema).optional(),
    accessibilityLabel: z.string().min(1),
    unit: z.string().optional(),
  })
  .refine(
    (q) =>
      q.inputType === 'single_select' || q.inputType === 'multi_select'
        ? Array.isArray(q.options) && q.options.length > 0
        : true,
    { message: 'select questions need options' },
  );

export const questionFileSchema = z
  .object({
    lineOfBusiness: lineOfBusinessSchema,
    version: z.string().min(1),
    questions: z.array(questionSchema).min(1),
  })
  .refine((f) => new Set(f.questions.map((q) => q.id)).size === f.questions.length, {
    message: 'question ids must be unique',
  });

/* -------------------------------------------------------------------------- */
/* Inferred types (structural mirrors of ./types.ts)                          */
/* -------------------------------------------------------------------------- */

export type RulebookInput = z.infer<typeof rulebookSchema>;
export type VectorSpecInput = z.infer<typeof vectorSpecSchema>;
export type RatingTableInput = z.infer<typeof ratingTableSchema>;
export type QuestionFileInput = z.infer<typeof questionFileSchema>;
