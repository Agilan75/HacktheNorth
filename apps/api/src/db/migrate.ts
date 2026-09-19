/**
 * Hand-written `CREATE TABLE IF NOT EXISTS` statements matching `schema.ts`
 * exactly. There is no drizzle-kit. Body owned by Run 1 unit A01.
 *
 * Column order, nullability, defaults and index names mirror `schema.ts`.
 * `migrate.test.ts` checks every column and index against Drizzle's own table
 * config, so drift fails a test instead of a query.
 */
import { sql } from 'drizzle-orm';
import type { DbHandle } from './client';

const STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS submissions (
  id text PRIMARY KEY NOT NULL,
  source text NOT NULL,
  line_of_business text NOT NULL,
  external_id text NOT NULL,
  insured_name text,
  raw text,
  canonical text,
  result text,
  query_trace text DEFAULT '[]' NOT NULL,
  share_slug text,
  rank integer,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  facts text
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS submissions_external_id_idx ON submissions (external_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS submissions_share_slug_idx ON submissions (share_slug)`,
  `CREATE INDEX IF NOT EXISTS submissions_rank_idx ON submissions (rank)`,
  `CREATE INDEX IF NOT EXISTS submissions_line_idx ON submissions (line_of_business)`,

  `CREATE TABLE IF NOT EXISTS sweeps (
  id text PRIMARY KEY NOT NULL,
  submission_id text,
  room_label text NOT NULL,
  term integer NOT NULL,
  frames text DEFAULT '[]' NOT NULL,
  frame_quality text DEFAULT '[]' NOT NULL,
  observations text DEFAULT '[]' NOT NULL,
  coverage text,
  result text,
  stage text NOT NULL,
  error text,
  created_at text NOT NULL,
  updated_at text NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS sweeps_submission_idx ON sweeps (submission_id)`,
  `CREATE INDEX IF NOT EXISTS sweeps_stage_idx ON sweeps (stage)`,

  `CREATE TABLE IF NOT EXISTS enrichments (
  id text PRIMARY KEY NOT NULL,
  submission_id text NOT NULL,
  source text NOT NULL,
  payload text NOT NULL,
  available integer DEFAULT 1 NOT NULL,
  created_at text NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS enrichments_submission_idx ON enrichments (submission_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS enrichments_submission_source_idx ON enrichments (submission_id, source)`,

  `CREATE TABLE IF NOT EXISTS actions (
  id text PRIMARY KEY NOT NULL,
  submission_id text NOT NULL,
  type text NOT NULL,
  status text NOT NULL,
  actor text DEFAULT 'code' NOT NULL,
  payload text NOT NULL,
  before text,
  after text,
  source_text text,
  created_at text NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS actions_submission_idx ON actions (submission_id)`,
  `CREATE INDEX IF NOT EXISTS actions_status_idx ON actions (status)`,
  `CREATE INDEX IF NOT EXISTS actions_type_idx ON actions (type)`,
];

/**
 * Columns added after a database may already exist (a deployed volume keeps
 * its file across releases). `CREATE TABLE IF NOT EXISTS` never alters an
 * existing table, so each is added with `ALTER TABLE ... ADD COLUMN` when
 * `PRAGMA table_info` says it is missing. Always nullable, always appended
 * last, so a fresh and an upgraded database end with the same column order.
 */
const ADDED_COLUMNS: readonly { readonly table: string; readonly column: string; readonly ddl: string }[] = [
  { table: 'submissions', column: 'facts', ddl: 'facts text' },
];

/** Idempotent: every statement is `IF NOT EXISTS`, all run in one transaction. */
export function migrate(handle: DbHandle): void {
  handle.db.transaction((tx) => {
    for (const statement of STATEMENTS) tx.run(sql.raw(statement));
    for (const added of ADDED_COLUMNS) {
      const columns = tx.all<{ name: string }>(sql.raw(`PRAGMA table_info(${added.table})`));
      if (columns.some((c) => c.name === added.column)) continue;
      tx.run(sql.raw(`ALTER TABLE ${added.table} ADD COLUMN ${added.ddl}`));
    }
  });
}

/** The statements, exported so a test can assert they match `schema.ts`. */
export function migrationStatements(): readonly string[] {
  return STATEMENTS;
}
