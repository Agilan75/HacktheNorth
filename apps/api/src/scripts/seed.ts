/**
 * `npm run seed`: ingest and enrich everything (PRD §8). Unit A20.
 *
 * 1. Ingest the whole Federato book through the planner (idempotent by
 *    externalId; `--force` re-runs every account).
 * 2. Run the enrichment plugins (flood zone, fire-station distance) for every
 *    normalized submission with at least one location, and persist one
 *    `enrichments` row per (submission, source), exactly as `POST /enrich/:id`
 *    does. An account whose sources all succeeded before is not re-fetched
 *    unless `--force`.
 * 3. Re-score the whole book once, so enrichment values (read back from the
 *    `enrichments` table by the rescore service) move scores, peers and rank.
 * 4. Store the seeded bedroom sweep (A10's observations) under a fixed id and
 *    drive it through relate -> score, so the demo works with no camera and no
 *    Gemini key.
 *
 * Decisions: docs/decisions/A20.md.
 */
import { pathToFileURL } from 'node:url';
import type { EnrichmentCardDto, IngestResponseDto, SweepFrameDto, SweepStageDto } from '@retrofit/contracts';
import type { ExternalValue, Observation, Sourced } from '@retrofit/engine';
import { coverage as sweepCoverage } from '@retrofit/engine';
import { createAdapter } from '@retrofit/federato';
import { federatoEnv, getEnv } from '../env';
import { createDb } from '../db/client';
import { migrate } from '../db/migrate';
import { createRepos } from '../db/repos';
import type { Repos } from '../db/repos';
import type { SubmissionRow, SweepRow } from '../db/schema';
import { FIRE_STATION_SOURCE } from '../enrich/fire-station';
import { FLOOD_SOURCE } from '../enrich/flood';
import { runEnrichment } from '../enrich/runner';
import type { EnrichContext, EnrichLocation, EnrichOutcome, EnrichPlugin } from '../enrich/types';
import { createAppLlm } from '../llm/index';
import { planActions } from '../services/actions';
import { ingestFederato } from '../services/ingest';
import { rescoreBook } from '../services/rescore';
import { FRAME_FOV_DEG, advanceSweep } from '../services/sweep';
import { systemClock } from '../services/types';
import type { Deps } from '../services/types';
import { seededObservations } from './seed-data';

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/** The seeded sweep's fixed id, so re-seeding updates it rather than adding one. */
export const SEEDED_SWEEP_ID = 'sweep_seed_bedroom';
const SEEDED_ROOM_LABEL = 'Bedroom';
const SEEDED_TERM_MONTHS = 12;
/** A10: 15 frames at 24-degree steps. */
const SEEDED_FRAME_COUNT = 15;
const SEEDED_FRAME_STEP_DEG = 24;

/**
 * Submissions enriched at once. Public Overpass allows about two slots per
 * client and the fire-station plugin already walks locations sequentially.
 */
const DEFAULT_ENRICH_CONCURRENCY = 2;

/** Stages the seed stops at; anything else means "advance again". */
const SETTLED: ReadonlySet<SweepStageDto> = new Set<SweepStageDto>(['questions', 'done', 'failed']);

/* -------------------------------------------------------------------------- */
/* Public types                                                               */
/* -------------------------------------------------------------------------- */

export interface SeedOptions {
  /** Re-ingest every account and re-fetch every enrichment. */
  readonly force?: boolean;
  /** Skip the enrichment plugins entirely (offline seed). */
  readonly skipEnrichment?: boolean;
  /** Skip the seeded sweep. */
  readonly skipSweep?: boolean;
  /** Injected plugins; defaults to the runner's shipping pair. */
  readonly plugins?: readonly EnrichPlugin[];
  readonly concurrency?: number;
  readonly log?: (line: string) => void;
  /** Skip routing and request drafting (`--no-actions`). */
  readonly skipActions?: boolean;
}

export interface SeedEnrichmentSummary {
  readonly attempted: number;
  readonly skipped: number;
  /** Per source: how many submissions got an available card. */
  readonly availableBySource: Readonly<Record<string, number>>;
  readonly unavailableBySource: Readonly<Record<string, number>>;
  readonly valuesWritten: number;
}

export interface SeedSummary {
  readonly ingest: IngestResponseDto;
  readonly submissions: number;
  readonly scored: number;
  readonly withQueryTrace: number;
  readonly enrichment: SeedEnrichmentSummary;
  readonly rescored: number;
  readonly sweep: { readonly id: string; readonly stage: SweepStageDto; readonly error: string | null } | null;
}

/* -------------------------------------------------------------------------- */
/* Private: enrichment glue (mirrors routes/run.ts, which keeps its own private) */
/* -------------------------------------------------------------------------- */

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

/** Same payload shape `routes/run.ts` stores and `services/rescore.ts` reads back. */
interface StoredEnrichmentPayload {
  readonly card: EnrichmentCardDto;
  readonly values: readonly ExternalValue[];
  readonly raw: Readonly<Record<string, unknown>>;
  readonly unavailableReason: string | null;
  readonly durationMs: number;
}

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

/** Already enriched: every source it has a row for came back available. */
function alreadyEnriched(repos: Repos, row: SubmissionRow, sources: readonly string[]): boolean {
  const stored = repos.enrichments.bySubmissionId(row.id);
  if (stored.length === 0) return false;
  const available = new Set(stored.filter((r) => r.available).map((r) => r.source));
  return sources.every((s) => available.has(s));
}

/** A fixed-width worker pool over `items`; order of results follows `items`. */
async function pool<T, R>(items: readonly T[], width: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(width, items.length)) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await work(items[i]!);
    }
  });
  await Promise.all(lanes);
  return out;
}

async function enrichBook(deps: Deps, options: SeedOptions, log: (line: string) => void): Promise<SeedEnrichmentSummary> {
  const repos = createRepos(deps.db);
  const plugins = options.plugins;
  const sources = (plugins ?? defaultSourcesProbe()).map((p) => p.source);

  const candidates = repos.submissions
    .all()
    .filter((r) => r.canonical !== null && r.canonical !== undefined && r.canonical.locations.length > 0);
  const todo = candidates.filter((r) => options.force === true || !alreadyEnriched(repos, r, sources));
  const skipped = candidates.length - todo.length;

  const available: Record<string, number> = {};
  const unavailable: Record<string, number> = {};
  let valuesWritten = 0;
  let done = 0;

  await pool(todo, options.concurrency ?? DEFAULT_ENRICH_CONCURRENCY, async (row) => {
    const nowIso = deps.clock.nowIso();
    const context: EnrichContext = { submissionId: row.id, locations: locationsOf(row), nowIso };
    const outcomes = await runEnrichment(context, plugins);
    persistOutcomes(repos, row.id, outcomes, nowIso);
    for (const o of outcomes) {
      const bucket = o.available ? available : unavailable;
      bucket[o.source] = (bucket[o.source] ?? 0) + 1;
      if (o.available) valuesWritten += o.values.length;
    }
    done += 1;
    const cards = outcomes
      .map((o) => `${o.source}=${o.available ? `${o.values.length} value(s)` : `unavailable (${o.unavailableReason ?? '?'})`}`)
      .join(', ');
    log(`  enrich ${done}/${todo.length} ${row.externalId ?? row.id}: ${cards}`);
  });

  return {
    attempted: todo.length,
    skipped,
    availableBySource: available,
    unavailableBySource: unavailable,
    valuesWritten,
  };
}

/** The shipping sources, without running anything (fresh instances are cheap). */
function defaultSourcesProbe(): readonly { readonly source: string }[] {
  return [{ source: FLOOD_SOURCE }, { source: FIRE_STATION_SOURCE }];
}

/* -------------------------------------------------------------------------- */
/* Private: the seeded sweep                                                  */
/* -------------------------------------------------------------------------- */

function seededFrames(capturedAt: string): SweepFrameDto[] {
  return Array.from({ length: SEEDED_FRAME_COUNT }, (_, index) => ({
    index,
    bearingDeg: index * SEEDED_FRAME_STEP_DEG,
    pitchDeg: null,
    capturedAt,
    quality: null,
    dropped: false,
    dropReason: null,
    imageRef: null,
  }));
}

/**
 * Writes the sweep at `observing` (observations already in hand, so the quality
 * gate and `observe` are skipped), then advances until it settles. If `relate`
 * fails (no Gemini key, overload), the engine's own pair rules still stand:
 * the row is put back at `relating` and scored without the model's additions.
 */
async function seedSweep(deps: Deps, force: boolean, log: (line: string) => void): Promise<SweepRow> {
  const repos = createRepos(deps.db);
  const existing = repos.sweeps.byId(SEEDED_SWEEP_ID);
  if (existing !== null && !force && existing.result !== null && existing.stage !== 'failed') {
    log(`  seeded sweep ${SEEDED_SWEEP_ID} already at "${existing.stage}", left alone`);
    return existing;
  }

  const now = deps.clock.nowIso();
  const frames = seededFrames(now);
  const observations: readonly Observation[] = seededObservations();
  const base = {
    submissionId: null,
    roomLabel: SEEDED_ROOM_LABEL,
    term: SEEDED_TERM_MONTHS,
    frames,
    frameQuality: frames.map(() => null),
    observations: [...observations],
    coverage: sweepCoverage(
      frames.map((f) => f.bearingDeg),
      FRAME_FOV_DEG,
    ),
    result: null,
    stage: 'observing' as const,
    error: null,
    updatedAt: now,
  };
  if (existing === null) repos.sweeps.insert({ id: SEEDED_SWEEP_ID, ...base, createdAt: now });
  else repos.sweeps.update(SEEDED_SWEEP_ID, base);

  let relateFellBack = false;
  for (let step = 0; step < 8; step += 1) {
    const dto = await advanceSweep(deps, SEEDED_SWEEP_ID);
    if (dto.stage === 'failed' && !relateFellBack && (dto.error ?? '').startsWith('observing')) {
      relateFellBack = true;
      log(`  relate unavailable (${dto.error ?? ''}); scoring on the engine's pair rules only`);
      repos.sweeps.update(SEEDED_SWEEP_ID, {
        observations: [...observations],
        stage: 'relating',
        error: null,
        updatedAt: deps.clock.nowIso(),
      });
      continue;
    }
    if (SETTLED.has(dto.stage)) break;
  }
  const row = repos.sweeps.byId(SEEDED_SWEEP_ID);
  if (row === null) throw new Error(`seed: sweep ${SEEDED_SWEEP_ID} vanished`);
  return row;
}

/* -------------------------------------------------------------------------- */
/* Public                                                                     */
/* -------------------------------------------------------------------------- */

/** The whole seed over injected `Deps`; `main` only builds the real ones. */
export async function runSeed(deps: Deps, options: SeedOptions = {}): Promise<SeedSummary> {
  const log = options.log ?? ((line: string) => console.log(line));
  const force = options.force === true;

  log(`Ingesting the Federato book (adapter: ${deps.adapter.kind}${force ? ', force' : ''})...`);
  const ingest = await ingestFederato(deps, { force });
  log(
    `  ${ingest.ingested} new, ${ingest.updated} updated, ${ingest.skipped} unchanged; ` +
      `${ingest.knockedOutAtTriage} knocked out at triage, ${ingest.noPolicy} without a policy; ` +
      `${ingest.queryCount} queries in ${ingest.durationMs} ms`,
  );
  for (const w of ingest.warnings) log(`  warning: ${w}`);

  let enrichment: SeedEnrichmentSummary = {
    attempted: 0,
    skipped: 0,
    availableBySource: {},
    unavailableBySource: {},
    valuesWritten: 0,
  };
  if (options.skipEnrichment === true) {
    log('Enrichment skipped.');
  } else {
    log('Enriching (flood zone, fire-station distance)...');
    enrichment = await enrichBook(deps, options, log);
    log(
      `  ${enrichment.attempted} enriched, ${enrichment.skipped} already enriched; ` +
        `${enrichment.valuesWritten} value(s) written`,
    );
  }

  log('Re-scoring the book...');
  const rescored = await rescoreBook(deps);
  log(`  ${rescored} scored`);

  let sweep: SeedSummary['sweep'] = null;
  if (options.skipSweep !== true) {
    log('Seeding the bedroom sweep...');
    const row = await seedSweep(deps, force, log);
    sweep = { id: row.id, stage: row.stage, error: row.error ?? null };
    log(`  ${row.id}: stage "${row.stage}"${row.error ? ` (${row.error})` : ''}`);
  }

  // Route every live account and draft its broker request now, so the outbox is
  // ready before anyone opens the console: drafting against live Gemini takes
  // tens of seconds, far too long to wait for mid-demo. Re-running is
  // idempotent (unchanged drafts are kept). DECISIONS S1-1.
  if (options.skipActions !== true) {
    log('Planning actions (routing + broker request drafts)...');
    const plan = await planActions(deps, {});
    log(`  ${plan.routed} routed, ${plan.needsSeniorReferral} need senior referral, ${plan.drafted} request drafts ready`);
  }

  const rows = createRepos(deps.db).submissions.all();
  const summary: SeedSummary = {
    ingest,
    submissions: rows.length,
    scored: rows.filter((r) => r.result !== null && r.result !== undefined).length,
    withQueryTrace: rows.filter((r) => Array.isArray(r.queryTrace) && r.queryTrace.length > 0).length,
    enrichment,
    rescored,
    sweep,
  };
  log(
    `Seed complete: ${summary.submissions} submissions stored, ${summary.scored} scored, ` +
      `${summary.withQueryTrace} with a query trace.`,
  );
  return summary;
}

/** `npm run seed [--force] [--no-enrich] [--no-sweep] [--no-actions] [--if-empty]`. */
export async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const env = getEnv();
  const handle = createDb({ url: env.DATABASE_URL });
  try {
    migrate(handle);
    // --if-empty: seed only a fresh database. A hosted container runs this on
    // every boot (DEPLOY.md), so the first boot loads the book and every
    // restart after that goes straight to serving. DECISIONS D-2.
    if (args.has('--if-empty') && createRepos(handle.db).submissions.all().length > 0) {
      console.log('Seed skipped: the database already holds submissions (--if-empty).');
      return;
    }
    const deps: Deps = {
      db: handle.db,
      adapter: createAdapter({ env: federatoEnv(env) }),
      llm: createAppLlm({ geminiApiKey: env.GEMINI_API_KEY, anthropicApiKey: env.ANTHROPIC_API_KEY, anthropicWorkspaceId: env.ANTHROPIC_WORKSPACE_ID }),
      clock: systemClock(),
    };
    await runSeed(deps, {
      force: args.has('--force'),
      skipEnrichment: args.has('--no-enrich'),
      skipSweep: args.has('--no-sweep'),
      skipActions: args.has('--no-actions'),
    });
  } finally {
    handle.close();
  }
}

/** Run only when executed directly (`npm run seed`), never on import from a test. */
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
