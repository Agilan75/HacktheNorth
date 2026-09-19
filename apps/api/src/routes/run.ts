/** POST /submissions/:id/run and POST /enrich/:id. Body owned by Run 1 unit A13. */
import type { Hono } from 'hono';
import type { Context } from 'hono';
import type {
  EnrichmentCardDto,
  EnrichResponseDto,
  ErrorDto,
  RunResponseDto,
} from '@retrofit/contracts';
import { ROUTES } from '@retrofit/contracts';
import type { ExternalValue, Sourced } from '@retrofit/engine';
import type { ApiEnv } from '../app';
import { createRepos } from '../db/repos';
import type { Repos } from '../db/repos';
import type { EnrichmentRow, SubmissionRow } from '../db/schema';
import { runEnrichment } from '../enrich/runner';
import type { EnrichContext, EnrichLocation, EnrichOutcome } from '../enrich/types';
import { rescoreOne } from '../services/rescore';
import type { Deps } from '../services/types';

/* -------------------------------------------------------------------------- */
/* Private glue (no business logic: the runner and rescore own that)          */
/* -------------------------------------------------------------------------- */

const errorBody = (code: string, message: string): ErrorDto => ({ error: { code, message } });

/** First value in a canonical slot, in insertion order (broker first). */
function first<T>(slot: Sourced<T> | undefined): T | null {
  if (slot === undefined) return null;
  for (const field of slot) {
    if (field.value !== null && field.value !== undefined) return field.value;
  }
  return null;
}

function locationsOf(row: SubmissionRow): readonly EnrichLocation[] {
  const canonical = row.canonical;
  if (canonical === null || canonical === undefined) return [];
  return canonical.locations.map((loc) => ({
    externalId: loc.externalId,
    address: null,
    city: first(loc.city),
    state: first(loc.state),
    zip: first(loc.postalCode),
    latitude: first(loc.latitude),
    longitude: first(loc.longitude),
  }));
}

/** What an `enrichments.payload` holds, so a later run can recover the values. */
interface StoredEnrichmentPayload {
  readonly card: EnrichmentCardDto;
  readonly values: readonly ExternalValue[];
  readonly raw: Readonly<Record<string, unknown>>;
  readonly unavailableReason: string | null;
  readonly durationMs: number;
}

/** One row per (submission, source); the id is deterministic, the repo keeps it on re-run. */
function persistOutcomes(
  repos: Repos,
  submissionId: string,
  outcomes: readonly EnrichOutcome[],
  nowIso: string,
): void {
  for (const outcome of outcomes) {
    const payload: StoredEnrichmentPayload = {
      card: outcome.card,
      values: outcome.values,
      raw: outcome.raw,
      unavailableReason: outcome.unavailableReason,
      durationMs: outcome.durationMs,
    };
    repos.enrichments.upsert({
      id: `${submissionId}:${outcome.source}`,
      submissionId,
      source: outcome.source,
      payload: payload as unknown as Record<string, unknown>,
      available: outcome.available,
      createdAt: nowIso,
    });
  }
}

/** Only available outcomes contribute values; an "unavailable" card moves nothing. */
const valuesOf = (outcomes: readonly EnrichOutcome[]): readonly ExternalValue[] =>
  outcomes.filter((o) => o.available).flatMap((o) => o.values);

function storedValues(rows: readonly EnrichmentRow[]): readonly ExternalValue[] {
  const out: ExternalValue[] = [];
  for (const row of rows) {
    if (!row.available) continue;
    const values = (row.payload as Partial<StoredEnrichmentPayload>).values;
    if (Array.isArray(values)) out.push(...values);
  }
  return out;
}

type Lookup =
  | { readonly ok: true; readonly row: SubmissionRow }
  | { readonly ok: false; readonly status: 404 | 409; readonly body: ErrorDto };

function lookup(repos: Repos, id: string | undefined): Lookup {
  const row = id === undefined || id === '' ? null : repos.submissions.byId(id);
  if (row === null) {
    return { ok: false, status: 404, body: errorBody('NOT_FOUND', `no submission "${id ?? ''}"`) };
  }
  if (row.canonical === null || row.canonical === undefined) {
    return {
      ok: false,
      status: 409,
      body: errorBody('NOT_NORMALIZED', `submission "${row.id}" has no canonical record to score`),
    };
  }
  return { ok: true, row };
}

async function enrich(deps: Deps, repos: Repos, row: SubmissionRow, signal: AbortSignal | undefined) {
  const nowIso = deps.clock.nowIso();
  const context: EnrichContext = {
    submissionId: row.id,
    locations: locationsOf(row),
    nowIso,
    ...(signal !== undefined ? { signal } : {}),
  };
  const outcomes = await runEnrichment(context);
  persistOutcomes(repos, row.id, outcomes, nowIso);
  return outcomes;
}

const signalOf = (c: Context<ApiEnv>): AbortSignal | undefined => c.req.raw.signal ?? undefined;

/* -------------------------------------------------------------------------- */
/* Registrar                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Registers this module's handlers on the frozen app. Throwing here in Run 0 is
 * expected: `app.ts` catches it and serves the 501 fallbacks instead.
 */
export function registerRunRoutes(app: Hono<ApiEnv>, deps: Deps): void {
  const repos = createRepos(deps.db);

  /**
   * Re-run enrichment and the engine (PRD §8). If the enrichment runner itself
   * fails, the engine still re-runs on the values stored by the last enrichment
   * (docs/decisions/A13.md).
   */
  app.post(ROUTES.runSubmission.path, async (c) => {
    const found = lookup(repos, c.req.param('id'));
    if (!found.ok) return c.json(found.body, found.status);
    const { row } = found;

    let extra: readonly ExternalValue[];
    try {
      extra = valuesOf(await enrich(deps, repos, row, signalOf(c)));
    } catch {
      extra = storedValues(repos.enrichments.bySubmissionId(row.id));
    }

    const rescored = await rescoreOne(deps, { submissionId: row.id, extra });
    const body: RunResponseDto = {
      id: row.id,
      before: rescored.before,
      after: rescored.after,
      rankChanged: rescored.rankChanged,
      result: rescored.result,
    };
    return c.json(body, 200);
  });

  /** Run the enrichment plugins, then re-run the engine (PRD §8). */
  app.post(ROUTES.enrichSubmission.path, async (c) => {
    const found = lookup(repos, c.req.param('id'));
    if (!found.ok) return c.json(found.body, found.status);
    const { row } = found;

    const outcomes = await enrich(deps, repos, row, signalOf(c));
    const rescored = await rescoreOne(deps, { submissionId: row.id, extra: valuesOf(outcomes) });
    const body: EnrichResponseDto = {
      id: row.id,
      cards: outcomes.map((o) => o.card),
      before: rescored.before,
      after: rescored.after,
      result: rescored.result,
    };
    return c.json(body, 200);
  });
}
