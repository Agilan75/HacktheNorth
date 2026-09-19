/**
 * Zod schemas for every request body, query string and response in `dto.ts`.
 * FROZEN after Run 0 (W0-3). This is the ONLY place wire schemas live.
 *
 * Request schemas validate strictly — a bad body is a 422 with the flattened
 * issues. Response schemas exist so the integration tests can assert that every
 * response really parses (PRD §12, integration test I3); they treat the deep
 * engine objects as opaque, because `@retrofit/engine` owns their shape and
 * re-describing 990 lines of it here would be two sources of truth.
 */

import { z } from 'zod';
import type {
  AggregateDto,
  ActionDto,
  EnrichResponseDto,
  ErrorDto,
  GlossaryResponseDto,
  HealthDto,
  IngestResponseDto,
  NextQuestionResponseDto,
  QueueResponseDto,
  ReplyResponseDto,
  RulesResponseDto,
  RunResponseDto,
  ShareDto,
  SubmissionDetailDto,
  SweepDto,
  VerifyFixResponseDto,
} from './dto';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Opaque pass-through for an object `@retrofit/engine` owns. */
const opaque = <T>(...requiredKeys: readonly string[]): z.ZodType<T> =>
  z.custom<T>(
    (value) => isRecord(value) && requiredKeys.every((key) => key in value),
    { message: `expected an object with: ${requiredKeys.join(', ')}` },
  );

/* -------------------------------------------------------------------------- */
/* Primitives                                                                 */
/* -------------------------------------------------------------------------- */

export const verdictSchema = z.enum(['FIT', 'REFER', 'DOES_NOT_FIT']);
export const severitySchema = z.enum(['HIGH', 'MEDIUM', 'LOW']);
export const adapterKindSchema = z.enum(['live', 'mock']);
export const lineOfBusinessSchema = z.enum(['commercial_property', 'tenant']);
export const recommendationSchema = z.enum(['accept', 'review', 'decline', 'investigate']);
export const requestTriggerSchema = z.enum([
  'missing_data',
  'high_contradiction',
  'one_flip_from_fit',
]);
export const actionTypeSchema = z.enum(['route', 'request', 'reply', 'rescore', 'log']);
export const actionStatusSchema = z.enum([
  'draft',
  'approved',
  'sent',
  'replied',
  'applied',
  'failed',
]);
export const sweepStageSchema = z.enum([
  'received',
  'quality_gate',
  'observing',
  'relating',
  'scoring',
  'questions',
  'done',
  'failed',
]);

/** ISO-8601 date or timestamp, as everything in this system stores it. */
export const isoDateSchema = z.string().min(10).max(40);
export const idSchema = z.string().min(1).max(128);

export const pageSchema = z.object({
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});

export const errorSchema: z.ZodType<ErrorDto> = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    issues: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional(),
  }),
});

export const scoreSnapshotSchema = z.object({
  appetiteScore: z.number(),
  verdict: verdictSchema,
  completeness: z.number(),
  confidence: z.number(),
  predictedPremium: z.number().nullable(),
  qualityIndex: z.number(),
  rank: z.number().int().nullable(),
});

export const underwriterSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  email: z.string(),
  team: z.string(),
  region: z.string(),
  authorityLimit: z.number(),
});

export const citationSchema = z.looseObject({
  doc: z.string(),
  section: z.string(),
  quote: z.string(),
});

export const routingDecisionSchema = z.object({
  submissionId: idSchema,
  primaryState: z.string().nullable(),
  requestedLimit: z.number().nullable(),
  assigned: underwriterSchema.nullable(),
  needsSeniorReferral: z.boolean(),
  reason: z.string(),
  candidates: z.array(
    z.object({
      underwriter: underwriterSchema,
      regionMatches: z.boolean(),
      authorityCovers: z.boolean(),
      reason: z.string(),
    }),
  ),
});

export const explanationFactorNoteSchema = z.object({
  factor: z.string(),
  label: z.string(),
  inAppetite: z.boolean(),
  tier: z.string().nullable(),
  valueText: z.string(),
});

export const explanationSchema = z.object({
  submissionId: idSchema,
  text: z.string(),
  sentences: z.array(z.string()),
  recommendation: recommendationSchema,
  mixed: z.boolean(),
  inAppetite: z.array(explanationFactorNoteSchema),
  outOfAppetite: z.array(explanationFactorNoteSchema),
  numbers: z.record(z.string(), z.number()),
  citations: z.array(citationSchema),
  template: z.string(),
  narrated: z.boolean(),
});

export const queryTraceEntrySchema = z.object({
  id: idSchema,
  seq: z.number().int().nonnegative(),
  pass: z.string(),
  goal: z.string(),
  requiredBy: z.array(
    z.object({
      ruleId: z.string(),
      factor: z.string().nullable(),
      canonicalPath: z.string(),
      why: z.string(),
    }),
  ),
  pathChosen: z.object({
    rootResource: z.string(),
    path: z.array(z.string()),
    why: z.string(),
    alternativesRejected: z.array(
      z.object({
        rootResource: z.string(),
        path: z.array(z.string()),
        why: z.string(),
      }),
    ),
  }),
  payload: z.unknown(),
  rowCount: z.number().int().nonnegative(),
  totalAvailable: z.number().int().nullable(),
  durationMs: z.number().nonnegative(),
  adapterKind: adapterKindSchema,
  startedAt: isoDateSchema,
  outcome: z.string(),
  error: z
    .object({
      code: z.string().nullable(),
      message: z.string(),
      httpStatus: z.number().int().nullable(),
    })
    .nullable(),
  adaptedFrom: z.string().nullable(),
  adaptation: z.string(),
  notes: z.array(z.string()),
});

export const requestedFieldSchema = z.object({
  canonicalPath: z.string(),
  componentKey: z.string().nullable(),
  label: z.string(),
  why: z.string(),
  factor: z.string().nullable(),
  ruleId: z.string().nullable(),
  currentValue: z.string().nullable(),
  severity: severitySchema,
});

export const extractedValueSchema = z.object({
  canonicalPath: z.string(),
  value: z.unknown(),
  confidence: z.number().min(0).max(1),
  quote: z.string(),
  accepted: z.boolean(),
  quoteFound: z.boolean(),
  typeOk: z.boolean(),
  rangeOk: z.boolean(),
  rejection: z.string().nullable(),
  needsConfirmation: z.boolean(),
});

export const enrichmentCardSchema = z.object({
  source: z.string(),
  title: z.string(),
  available: z.boolean(),
  unavailableReason: z.string().nullable(),
  fetchedAt: isoDateSchema.nullable(),
  fields: z.array(
    z.object({
      canonicalPath: z.string(),
      label: z.string(),
      valueText: z.string(),
      value: z.unknown(),
    }),
  ),
  attribution: z.string(),
});

/* -------------------------------------------------------------------------- */
/* Opaque engine payloads                                                     */
/* -------------------------------------------------------------------------- */

export const engineResultSchema = opaque<SubmissionDetailDto['result']>(
  'id',
  'vector',
  'evaluate',
  'verdict',
  'price',
);
export const rollupSchema = opaque<SubmissionDetailDto['rollup']>('totalTiv', 'buildingCount');
export const featureVectorSchema = opaque<SubmissionDetailDto['vector']>('x', 't', 'm');
export const priceBreakdownSchema = opaque<SubmissionDetailDto['price']>(
  'predictedPremium',
  'basis',
);
export const flipResultSchema = opaque<SubmissionDetailDto['flip']>('flip', 'reason');
export const voiResultSchema = opaque<SubmissionDetailDto['voi']>('nextQuestion', 'ranked');
export const peerResultSchema = opaque<NonNullable<SubmissionDetailDto['peers']>>('k', 'peers');
export const contradictionSchema = opaque<SubmissionDetailDto['contradictions'][number]>(
  'canonicalPath',
  'severity',
);
export const interpretationSchema = opaque<SubmissionDetailDto['interpretations'][number]>(
  'id',
  'decision',
);
export const questionSchema = opaque<NonNullable<NextQuestionResponseDto['question']>>(
  'id',
  'prompt',
  'inputType',
);
export const observationSchema = opaque<SweepDto['observations'][number]>('id', 'label');
export const coverageResultSchema = opaque<NonNullable<SweepDto['coverage']>>(
  'coveragePct',
  'panels',
);
export const fieldMapSchema = opaque<NonNullable<SubmissionDetailDto['fieldMap']>>(
  'entries',
  'unmapped',
);
export const ruleSchema = opaque<RulesResponseDto['rulebooks'][number]['rules'][number]>(
  'id',
  'factor',
  'tier',
);
export const qualityComponentsSchema = opaque<QueueResponseDto['rows'][number]['qualityComponents']>(
  'appetite',
  'completeness',
);

/* -------------------------------------------------------------------------- */
/* Requests                                                                   */
/* -------------------------------------------------------------------------- */

export const ingestRequestSchema = z.object({
  lineOfBusiness: lineOfBusinessSchema.optional(),
  externalIds: z.array(z.string().min(1)).max(500).optional(),
  force: z.boolean().optional(),
});

export const queueQuerySchema = z.object({
  line: z.string().optional(),
  verdict: verdictSchema.optional(),
  state: z.string().length(2).optional(),
  underwriterId: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

export const actionsQuerySchema = z.object({
  status: actionStatusSchema.optional(),
  type: actionTypeSchema.optional(),
  submissionId: idSchema.optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

export const actionsPlanRequestSchema = z.object({
  externalIds: z.array(z.string().min(1)).max(500).optional(),
  draftsOff: z.boolean().optional(),
});

/** Exactly one of `text` or `pdfBase64`. */
export const replyRequestSchema = z
  .object({
    text: z.string().min(1).max(200_000).optional(),
    pdfBase64: z.string().min(1).optional(),
    filename: z.string().max(255).optional(),
    actionId: idSchema.optional(),
  })
  .refine(
    (body) => (body.text === undefined) !== (body.pdfBase64 === undefined),
    { message: 'provide exactly one of `text` or `pdfBase64`' },
  );

export const sweepFrameInputSchema = z.object({
  bearingDeg: z.number().min(0).max(360),
  pitchDeg: z.number().min(-90).max(90).optional(),
  capturedAt: isoDateSchema,
  imageBase64: z.string().min(1),
});

export const sweepCreateRequestSchema = z.object({
  roomLabel: z.string().min(1).max(120),
  termMonths: z.union([z.literal(4), z.literal(8), z.literal(12)]),
  submissionId: idSchema.optional(),
  /** Cap 15 frames (PRD §11). */
  frames: z.array(sweepFrameInputSchema).min(1).max(15),
});

export const sweepAnswersRequestSchema = z.object({
  answers: z.array(
    z.object({
      questionId: idSchema,
      field: z.string().min(1),
      value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
      skipped: z.boolean().optional(),
    }),
  ),
  confirmations: z
    .array(z.object({ observationId: idSchema, confirmed: z.boolean() }))
    .optional(),
});

export const verifyFixRequestSchema = z.object({
  hazardKey: z.string().min(1),
  imageBase64: z.string().min(1),
  capturedAt: isoDateSchema,
});

/* -------------------------------------------------------------------------- */
/* Responses                                                                  */
/* -------------------------------------------------------------------------- */

export const healthResponseSchema: z.ZodType<HealthDto> = z.object({
  ok: z.literal(true),
  version: z.string(),
  adapter: adapterKindSchema,
  llmConfigured: z.boolean(),
  submissionCount: z.number().int().nonnegative(),
  startedAt: isoDateSchema,
});

export const queueRowSchema = z.object({
  id: idSchema,
  externalId: z.string(),
  rank: z.number().int(),
  qualityIndex: z.number(),
  qualityComponents: qualityComponentsSchema,
  verdict: verdictSchema,
  insuredName: z.string().nullable(),
  lineOfBusiness: z.string(),
  outOfAppetiteLine: z.boolean(),
  appetiteScore: z.number(),
  primaryState: z.string().nullable(),
  totalTiv: z.number().nullable(),
  quotedPremium: z.number().nullable(),
  predictedPremium: z.number().nullable(),
  adequacy: z.number().nullable(),
  completeness: z.number(),
  confidence: z.number(),
  contradictionCount: z.number().int().nonnegative(),
  openHighContradictionCount: z.number().int().nonnegative(),
  distanceToAppetite: z
    .union([z.literal(0), z.literal(1), z.literal(2)])
    .nullable(),
  oneFlipFromFit: z.boolean(),
  assignedUnderwriter: underwriterSchema.nullable(),
  pendingAction: z
    .object({ id: idSchema, type: actionTypeSchema, status: actionStatusSchema })
    .nullable(),
  explanation: z.string().nullable(),
  updatedAt: isoDateSchema,
});

export const queueResponseSchema: z.ZodType<QueueResponseDto> = z.object({
  rows: z.array(queueRowSchema),
  page: pageSchema,
  adapter: adapterKindSchema,
  filters: queueQuerySchema,
});

export const buildingRowSchema = z.object({
  externalId: z.string(),
  name: z.string().nullable(),
  tiv: z.number().nullable(),
  yearBuilt: z.number().int().nullable(),
  constructionType: z.string().nullable(),
  sprinklered: z.boolean().nullable(),
  stories: z.number().nullable(),
  protectionClass: z.number().nullable(),
  state: z.string().nullable(),
  city: z.string().nullable(),
  pre1990: z.boolean(),
  post2010: z.boolean(),
  acceptableConstruction: z.boolean(),
  assumedAcceptableConstruction: z.boolean(),
});

export const actionSchema: z.ZodType<ActionDto> = z.object({
  id: idSchema,
  submissionId: idSchema,
  externalId: z.string().nullable(),
  insuredName: z.string().nullable(),
  type: actionTypeSchema,
  status: actionStatusSchema,
  actor: z.string(),
  triggers: z.array(requestTriggerSchema),
  fields: z.array(requestedFieldSchema),
  draft: z.string().nullable(),
  recipient: z
    .object({
      name: z.string().nullable(),
      email: z.string().nullable(),
      brokerName: z.string().nullable(),
    })
    .nullable(),
  routing: routingDecisionSchema.nullable(),
  sourceText: z.string().nullable(),
  extracted: z.array(extractedValueSchema),
  before: scoreSnapshotSchema.nullable(),
  after: scoreSnapshotSchema.nullable(),
  rankBefore: z.number().int().nullable(),
  rankAfter: z.number().int().nullable(),
  note: z.string().nullable(),
  createdAt: isoDateSchema,
});

export const sweepFrameSchema = z.object({
  index: z.number().int().nonnegative(),
  bearingDeg: z.number(),
  pitchDeg: z.number().nullable(),
  capturedAt: isoDateSchema,
  quality: z.number().nullable(),
  dropped: z.boolean(),
  dropReason: z.string().nullable(),
  imageRef: z.string().nullable(),
});

export const sweepSchema: z.ZodType<SweepDto> = z.object({
  id: idSchema,
  submissionId: idSchema.nullable(),
  roomLabel: z.string(),
  termMonths: z.number().int(),
  stage: sweepStageSchema,
  frames: z.array(sweepFrameSchema),
  coverage: coverageResultSchema.nullable(),
  observations: z.array(observationSchema),
  needsConfirmation: z.array(observationSchema),
  result: engineResultSchema.nullable(),
  askedQuestionIds: z.array(idSchema),
  skippedCount: z.number().int().nonnegative(),
  error: z.string().nullable(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const submissionDetailSchema: z.ZodType<SubmissionDetailDto> = z.object({
  id: idSchema,
  externalId: z.string(),
  source: z.string(),
  lineOfBusiness: lineOfBusinessSchema,
  insuredName: z.string().nullable(),
  rank: z.number().int().nullable(),
  result: engineResultSchema,
  rollup: rollupSchema,
  vector: featureVectorSchema,
  price: priceBreakdownSchema,
  flip: flipResultSchema,
  voi: voiResultSchema,
  peers: peerResultSchema.nullable(),
  contradictions: z.array(contradictionSchema),
  interpretations: z.array(interpretationSchema),
  buildings: z.array(buildingRowSchema),
  explanation: explanationSchema.nullable(),
  queryTrace: z.array(queryTraceEntrySchema),
  fieldMap: fieldMapSchema.nullable(),
  enrichment: z.array(enrichmentCardSchema),
  routing: routingDecisionSchema.nullable(),
  actions: z.array(actionSchema),
  attachedSweep: sweepSchema.nullable(),
  shareSlug: z.string().nullable(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const ingestResponseSchema: z.ZodType<IngestResponseDto> = z.object({
  adapter: adapterKindSchema,
  ingested: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  knockedOutAtTriage: z.number().int().nonnegative(),
  noPolicy: z.number().int().nonnegative(),
  queryCount: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
  warnings: z.array(z.string()),
  externalIds: z.array(z.string()),
});

export const runResponseSchema: z.ZodType<RunResponseDto> = z.object({
  id: idSchema,
  before: scoreSnapshotSchema.nullable(),
  after: scoreSnapshotSchema,
  rankChanged: z.boolean(),
  result: engineResultSchema,
});

export const enrichResponseSchema: z.ZodType<EnrichResponseDto> = z.object({
  id: idSchema,
  cards: z.array(enrichmentCardSchema),
  before: scoreSnapshotSchema.nullable(),
  after: scoreSnapshotSchema,
  result: engineResultSchema,
});

export const actionsPlanResponseSchema = z.object({
  routed: z.number().int().nonnegative(),
  needsSeniorReferral: z.number().int().nonnegative(),
  drafted: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  actions: z.array(actionSchema),
});

export const actionsResponseSchema = z.object({
  actions: z.array(actionSchema),
  page: pageSchema,
  sendingIsSimulated: z.literal(true),
});

export const approveActionResponseSchema = z.object({ action: actionSchema });

export const replyResponseSchema: z.ZodType<ReplyResponseDto> = z.object({
  id: idSchema,
  action: actionSchema,
  extracted: z.array(extractedValueSchema),
  accepted: z.array(extractedValueSchema),
  rejected: z.array(extractedValueSchema),
  needsConfirmation: z.array(extractedValueSchema),
  newContradictions: z.array(contradictionSchema),
  before: scoreSnapshotSchema,
  after: scoreSnapshotSchema,
  rankBefore: z.number().int().nullable(),
  rankAfter: z.number().int().nullable(),
  result: engineResultSchema,
});

export const nextQuestionResponseSchema: z.ZodType<NextQuestionResponseDto> = z.object({
  question: questionSchema.nullable(),
  askedCount: z.number().int().nonnegative(),
  skipped: z.array(z.object({ field: z.string(), reason: z.string() })),
  done: z.boolean(),
});

export const verifyFixResponseSchema: z.ZodType<VerifyFixResponseDto> = z.object({
  sweepId: idSchema,
  hazardKey: z.string(),
  stillPresent: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  before: scoreSnapshotSchema,
  after: scoreSnapshotSchema,
  result: engineResultSchema,
});

export const aggregateResponseSchema: z.ZodType<AggregateDto> = z.object({
  counts: z.object({
    total: z.number().int().nonnegative(),
    byVerdict: z.object({
      FIT: z.number().int().nonnegative(),
      REFER: z.number().int().nonnegative(),
      DOES_NOT_FIT: z.number().int().nonnegative(),
    }),
    byLine: z.record(z.string(), z.number().int().nonnegative()),
    scored: z.number().int().nonnegative(),
    knockedOut: z.number().int().nonnegative(),
  }),
  scoreHistogram: z.array(z.number().int().nonnegative()).length(10),
  topKnockoutFactors: z.array(
    z.object({ factor: z.string(), label: z.string(), count: z.number().int() }),
  ),
  oneFlipAway: z.array(
    z.object({
      id: idSchema,
      externalId: z.string(),
      insuredName: z.string().nullable(),
      appetiteScore: z.number(),
      moveLabel: z.string(),
      scoreAfter: z.number(),
      premiumAfter: z.number().nullable(),
    }),
  ),
  bookAdequacy: z.object({
    median: z.number().nullable(),
    underpricedCount: z.number().int().nonnegative(),
    n: z.number().int().nonnegative(),
  }),
  verification: z
    .object({
      propertyCasesRun: z.number().int().nonnegative(),
      differentialCasesRun: z.number().int().nonnegative(),
      disagreements: z.number().int().nonnegative(),
      llmCasesRun: z.number().int().nonnegative(),
      llmAgreementRate: z.number().nullable(),
      llmAgreementCi95: z.tuple([z.number(), z.number()]).nullable(),
      extractionFieldAccuracy: z.number().nullable(),
      generatedAt: isoDateSchema,
    })
    .nullable(),
});

export const rulesResponseSchema: z.ZodType<RulesResponseDto> = z.object({
  rulebooks: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      version: z.string(),
      isExtension: z.boolean(),
      rules: z.array(ruleSchema),
    }),
  ),
  interpretations: z.array(interpretationSchema),
  weights: z.record(z.string(), z.number()),
});

export const glossaryResponseSchema: z.ZodType<GlossaryResponseDto> = z.object({
  entries: z.array(
    z.object({
      term: z.string(),
      definition: z.string(),
      page: z.number().int(),
      aliases: z.array(z.string()),
    }),
  ),
  doc: z.string(),
});

export const shareResponseSchema: z.ZodType<ShareDto> = z.object({
  slug: z.string(),
  lineOfBusiness: lineOfBusinessSchema,
  verdict: verdictSchema,
  appetiteScore: z.number(),
  explanation: z.string().nullable(),
  price: priceBreakdownSchema,
  flip: flipResultSchema,
  decidingRule: z
    .object({ ruleId: z.string(), factor: z.string(), citation: citationSchema })
    .nullable(),
  createdAt: isoDateSchema,
});

/** Flattens a zod error into the `issues` array `ErrorDto` carries. */
export function toIssues(
  error: z.ZodError,
): readonly { readonly path: string; readonly message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.map((p) => String(p)).join('.'),
    message: issue.message,
  }));
}
