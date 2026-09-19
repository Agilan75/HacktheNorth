/** Typed repositories over the four tables. Body owned by Run 1 unit A01. */
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

export function createRepos(_db: Db): Repos {
  throw new Error('NOT_IMPLEMENTED:A01');
}
