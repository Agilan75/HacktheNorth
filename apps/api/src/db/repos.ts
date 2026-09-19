/** Typed repositories over the four tables. Body owned by Run 1 unit A01. */
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { actions, enrichments, submissions, sweeps } from './schema';
import type {
  ActionRow,
  EnrichmentRow,
  NewActionRow,
  NewEnrichmentRow,
  NewSubmissionRow,
  NewSweepRow,
  SubmissionRow,
  SweepRow,
} from './schema';
import type { Db } from '../services/types';

export interface SubmissionRepo {
  /** Idempotent by `externalId` (PRD §8). */
  upsertByExternalId(row: NewSubmissionRow): SubmissionRow;
  byId(id: string): SubmissionRow | null;
  byExternalId(externalId: string): SubmissionRow | null;
  byShareSlug(slug: string): SubmissionRow | null;
  list(filter: {
    readonly lineOfBusiness?: string;
    readonly limit?: number;
    readonly offset?: number;
  }): { readonly rows: readonly SubmissionRow[]; readonly total: number };
  all(): readonly SubmissionRow[];
  setRanks(ranks: readonly { readonly id: string; readonly rank: number }[]): void;
  update(id: string, patch: Partial<NewSubmissionRow>): SubmissionRow;
}

export interface SweepRepo {
  insert(row: NewSweepRow): SweepRow;
  byId(id: string): SweepRow | null;
  update(id: string, patch: Partial<NewSweepRow>): SweepRow;
  bySubmissionId(submissionId: string): readonly SweepRow[];
}

export interface EnrichmentRepo {
  upsert(row: NewEnrichmentRow): EnrichmentRow;
  bySubmissionId(submissionId: string): readonly EnrichmentRow[];
}

export interface ActionRepo {
  insert(row: NewActionRow): ActionRow;
  byId(id: string): ActionRow | null;
  update(id: string, patch: Partial<NewActionRow>): ActionRow;
  list(filter: {
    readonly status?: string;
    readonly type?: string;
    readonly submissionId?: string;
    readonly limit?: number;
    readonly offset?: number;
  }): { readonly rows: readonly ActionRow[]; readonly total: number };
}

export interface Repos {
  readonly submissions: SubmissionRepo;
  readonly sweeps: SweepRepo;
  readonly enrichments: EnrichmentRepo;
  readonly actions: ActionRepo;
}

/** Drops `undefined` values and the listed keys, so a patch never nulls a column by omission. */
function defined<T extends object>(patch: T, omit: readonly string[] = []): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || omit.includes(key)) continue;
    out[key] = value;
  }
  return out as Partial<T>;
}

function page(limit: number | undefined, offset: number | undefined): { limit: number; offset: number } {
  const off = offset !== undefined && Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0;
  // Drizzle drops a negative LIMIT but keeps OFFSET, which SQLite rejects; use a huge limit instead.
  const lim =
    limit !== undefined && Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : Number.MAX_SAFE_INTEGER;
  return { limit: lim, offset: off };
}

function notFound(table: string, id: string): Error {
  return new Error(`${table}: no row with id ${id}`);
}

/** Queue order: ranked rows by rank ascending, unranked last, ties by externalId. */
const queueOrder = (): SQL[] => [
  sql`${submissions.rank} IS NULL`,
  asc(submissions.rank),
  asc(submissions.externalId),
];

function submissionRepo(db: Db): SubmissionRepo {
  const byId = (id: string): SubmissionRow | null =>
    db.select().from(submissions).where(eq(submissions.id, id)).get() ?? null;

  return {
    upsertByExternalId(row) {
      // Re-ingest never replaces the primary key or creation time, and never
      // clears a minted share slug or an existing rank by passing null.
      const set = defined(row, ['id', 'createdAt', 'externalId']);
      if (set.shareSlug === null) delete set.shareSlug;
      if (set.rank === null) delete set.rank;
      return db
        .insert(submissions)
        .values(row)
        .onConflictDoUpdate({ target: submissions.externalId, set })
        .returning()
        .get();
    },
    byId,
    byExternalId: (externalId) =>
      db.select().from(submissions).where(eq(submissions.externalId, externalId)).get() ?? null,
    byShareSlug: (slug) =>
      db.select().from(submissions).where(eq(submissions.shareSlug, slug)).get() ?? null,
    list(filter) {
      const where =
        filter.lineOfBusiness !== undefined
          ? eq(submissions.lineOfBusiness, filter.lineOfBusiness as SubmissionRow['lineOfBusiness'])
          : undefined;
      const { limit, offset } = page(filter.limit, filter.offset);
      const rows = db
        .select()
        .from(submissions)
        .where(where)
        .orderBy(...queueOrder())
        .limit(limit)
        .offset(offset)
        .all();
      const total = db.select({ n: count() }).from(submissions).where(where).get()?.n ?? 0;
      return { rows, total };
    },
    all: () => db.select().from(submissions).orderBy(...queueOrder()).all(),
    setRanks(ranks) {
      if (ranks.length === 0) return;
      db.transaction((tx) => {
        for (const { id, rank } of ranks) {
          tx.update(submissions).set({ rank }).where(eq(submissions.id, id)).run();
        }
      });
    },
    update(id, patch) {
      const set = defined(patch, ['id']);
      if (Object.keys(set).length === 0) {
        const existing = byId(id);
        if (!existing) throw notFound('submissions', id);
        return existing;
      }
      const updated = db.update(submissions).set(set).where(eq(submissions.id, id)).returning().get();
      if (!updated) throw notFound('submissions', id);
      return updated;
    },
  };
}

function sweepRepo(db: Db): SweepRepo {
  const byId = (id: string): SweepRow | null =>
    db.select().from(sweeps).where(eq(sweeps.id, id)).get() ?? null;
  return {
    insert: (row) => db.insert(sweeps).values(row).returning().get(),
    byId,
    update(id, patch) {
      const set = defined(patch, ['id']);
      if (Object.keys(set).length === 0) {
        const existing = byId(id);
        if (!existing) throw notFound('sweeps', id);
        return existing;
      }
      const updated = db.update(sweeps).set(set).where(eq(sweeps.id, id)).returning().get();
      if (!updated) throw notFound('sweeps', id);
      return updated;
    },
    bySubmissionId: (submissionId) =>
      db
        .select()
        .from(sweeps)
        .where(eq(sweeps.submissionId, submissionId))
        .orderBy(asc(sweeps.createdAt), asc(sweeps.id))
        .all(),
  };
}

function enrichmentRepo(db: Db): EnrichmentRepo {
  return {
    upsert(row) {
      // One row per (submission, source): a re-run replaces the payload but keeps the id.
      const set = defined(row, ['id', 'submissionId', 'source']);
      return db
        .insert(enrichments)
        .values(row)
        .onConflictDoUpdate({ target: [enrichments.submissionId, enrichments.source], set })
        .returning()
        .get();
    },
    bySubmissionId: (submissionId) =>
      db
        .select()
        .from(enrichments)
        .where(eq(enrichments.submissionId, submissionId))
        .orderBy(asc(enrichments.source))
        .all(),
  };
}

function actionRepo(db: Db): ActionRepo {
  const byId = (id: string): ActionRow | null =>
    db.select().from(actions).where(eq(actions.id, id)).get() ?? null;
  return {
    insert: (row) => db.insert(actions).values(row).returning().get(),
    byId,
    update(id, patch) {
      const set = defined(patch, ['id']);
      if (Object.keys(set).length === 0) {
        const existing = byId(id);
        if (!existing) throw notFound('actions', id);
        return existing;
      }
      const updated = db.update(actions).set(set).where(eq(actions.id, id)).returning().get();
      if (!updated) throw notFound('actions', id);
      return updated;
    },
    list(filter) {
      const conditions: SQL[] = [];
      if (filter.status !== undefined) {
        conditions.push(eq(actions.status, filter.status as ActionRow['status']));
      }
      if (filter.type !== undefined) conditions.push(eq(actions.type, filter.type as ActionRow['type']));
      if (filter.submissionId !== undefined) conditions.push(eq(actions.submissionId, filter.submissionId));
      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const { limit, offset } = page(filter.limit, filter.offset);
      // Newest first: the outbox and the action log both read top-down.
      const rows = db
        .select()
        .from(actions)
        .where(where)
        .orderBy(desc(actions.createdAt), desc(actions.id))
        .limit(limit)
        .offset(offset)
        .all();
      const total = db.select({ n: count() }).from(actions).where(where).get()?.n ?? 0;
      return { rows, total };
    },
  };
}

export function createRepos(db: Db): Repos {
  return {
    submissions: submissionRepo(db),
    sweeps: sweepRepo(db),
    enrichments: enrichmentRepo(db),
    actions: actionRepo(db),
  };
}
