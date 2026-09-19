/**
 * The four tables from PRD §8, as Drizzle definitions. FROZEN after Run 0.
 *
 * There is no drizzle-kit and no migration folder: `db/migrate.ts` (A01) issues
 * hand-written `CREATE TABLE IF NOT EXISTS` statements that match exactly what
 * is declared here. If they ever drift, the migration is wrong, not this file.
 *
 * JSON columns are `text({ mode: 'json' })` with a `$type<>()` annotation, so
 * the stored blob keeps the type the engine produced. Engine results are stored
 * **unchanged** (PRD §8) — nothing re-derives a number on the way out.
 */

import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type {
  CanonicalSubmission,
  CoverageResult,
  EngineResult,
  LineOfBusiness,
  Observation,
  RawBundle,
} from '@retrofit/engine';
import type {
  ActionStatusDto,
  ActionTypeDto,
  ExtractedValueDto,
  SubmissionFactsDto,
  QueryTraceEntryDto,
  RequestedFieldDto,
  RequestTriggerDto,
  RoutingDecisionDto,
  ScoreSnapshotDto,
  SweepFrameDto,
  SweepStageDto,
} from '@retrofit/contracts';

/** Where a submission came from. `federato` for everything the planner ingests. */
export type SubmissionSource = 'federato' | 'sweep' | 'manual' | 'seed';

/** The stored draft and its metadata; `null` until Gemini drafts the wording. */
export interface ActionPayload {
  readonly triggers?: readonly RequestTriggerDto[];
  readonly fields?: readonly RequestedFieldDto[];
  readonly draft?: string | null;
  readonly subject?: string | null;
  readonly recipient?: {
    readonly name: string | null;
    readonly email: string | null;
    readonly brokerName: string | null;
  } | null;
  readonly routing?: RoutingDecisionDto | null;
  readonly extracted?: readonly ExtractedValueDto[];
  readonly note?: string | null;
  readonly rankBefore?: number | null;
  readonly rankAfter?: number | null;
}

export const submissions = sqliteTable(
  'submissions',
  {
    id: text('id').primaryKey(),
    source: text('source').$type<SubmissionSource>().notNull(),
    lineOfBusiness: text('line_of_business').$type<LineOfBusiness>().notNull(),
    /** Federato's `submission_number`. The idempotency key for ingest. */
    externalId: text('external_id').notNull(),
    insuredName: text('insured_name'),
    /** Everything the planner returned for this submission, untouched. */
    raw: text('raw', { mode: 'json' }).$type<RawBundle | null>(),
    canonical: text('canonical', { mode: 'json' }).$type<CanonicalSubmission | null>(),
    /** The stored `EngineResult`. Both apps render from this and nothing else. */
    result: text('result', { mode: 'json' }).$type<EngineResult | null>(),
    queryTrace: text('query_trace', { mode: 'json' })
      .$type<readonly QueryTraceEntryDto[]>()
      .notNull()
      .default([]),
    /** Public link for `GET /s/:shareSlug`. Null until one is minted. */
    shareSlug: text('share_slug'),
    /** 1-based queue position from the last rank pass; null before one runs. */
    rank: integer('rank'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    /**
     * What Federato's own Submission record says (insured, broker, dates, ...),
     * read by the planner's triage query. Display only, never scored. Null on a
     * sweep row, or on a row stored before this column existed (FILL-backend D2).
     * Added last so an existing database gains it with one ALTER TABLE.
     */
    facts: text('facts', { mode: 'json' }).$type<SubmissionFactsDto | null>(),
  },
  (table) => [
    uniqueIndex('submissions_external_id_idx').on(table.externalId),
    uniqueIndex('submissions_share_slug_idx').on(table.shareSlug),
    index('submissions_rank_idx').on(table.rank),
    index('submissions_line_idx').on(table.lineOfBusiness),
  ],
);

export const sweeps = sqliteTable(
  'sweeps',
  {
    id: text('id').primaryKey(),
    /** Nullable: a renter sweep belongs to no Federato submission. */
    submissionId: text('submission_id'),
    roomLabel: text('room_label').notNull(),
    /** 4, 8 or 12 months. */
    term: integer('term').notNull(),
    frames: text('frames', { mode: 'json' })
      .$type<readonly SweepFrameDto[]>()
      .notNull()
      .default([]),
    /** Per-frame 0..1 quality from the code-side gate, index-aligned to `frames`. */
    frameQuality: text('frame_quality', { mode: 'json' })
      .$type<readonly (number | null)[]>()
      .notNull()
      .default([]),
    observations: text('observations', { mode: 'json' })
      .$type<readonly Observation[]>()
      .notNull()
      .default([]),
    coverage: text('coverage', { mode: 'json' }).$type<CoverageResult | null>(),
    result: text('result', { mode: 'json' }).$type<EngineResult | null>(),
    /** What `/analyzing` polls (PRD §8, §11). */
    stage: text('stage').$type<SweepStageDto>().notNull(),
    error: text('error'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('sweeps_submission_idx').on(table.submissionId),
    index('sweeps_stage_idx').on(table.stage),
  ],
);

export const enrichments = sqliteTable(
  'enrichments',
  {
    id: text('id').primaryKey(),
    submissionId: text('submission_id').notNull(),
    /** `openfema_flood`, `overpass_fire_station`, `nominatim_geocode`. */
    source: text('source').notNull(),
    /** The plugin's raw response plus the card it produced. */
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    /** False when the plugin timed out or failed; the console shows a card saying so. */
    available: integer('available', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('enrichments_submission_idx').on(table.submissionId),
    uniqueIndex('enrichments_submission_source_idx').on(table.submissionId, table.source),
  ],
);

export const actions = sqliteTable(
  'actions',
  {
    id: text('id').primaryKey(),
    submissionId: text('submission_id').notNull(),
    type: text('type').$type<ActionTypeDto>().notNull(),
    status: text('status').$type<ActionStatusDto>().notNull(),
    /** `code`, `gemini:<call>` or `underwriter`. Every action says who acted. */
    actor: text('actor').notNull().default('code'),
    payload: text('payload', { mode: 'json' }).$type<ActionPayload>().notNull(),
    before: text('before', { mode: 'json' }).$type<ScoreSnapshotDto | null>(),
    after: text('after', { mode: 'json' }).$type<ScoreSnapshotDto | null>(),
    /** The broker's reply verbatim, for the "quote must appear in the source" check. */
    sourceText: text('source_text'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('actions_submission_idx').on(table.submissionId),
    index('actions_status_idx').on(table.status),
    index('actions_type_idx').on(table.type),
  ],
);

export type SubmissionRow = typeof submissions.$inferSelect;
export type NewSubmissionRow = typeof submissions.$inferInsert;
export type SweepRow = typeof sweeps.$inferSelect;
export type NewSweepRow = typeof sweeps.$inferInsert;
export type EnrichmentRow = typeof enrichments.$inferSelect;
export type NewEnrichmentRow = typeof enrichments.$inferInsert;
export type ActionRow = typeof actions.$inferSelect;
export type NewActionRow = typeof actions.$inferInsert;

/** The whole schema, for `drizzle(client, { schema })`. */
export const schema = { submissions, sweeps, enrichments, actions };
export type Schema = typeof schema;
