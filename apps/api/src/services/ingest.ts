/** Ingest service: planner -> normalize -> engine -> store. Unit A16. */
import type {
  IngestRequestDto,
  IngestResponseDto,
  QueryTraceEntryDto,
  SubmissionFactsDto,
} from '@retrofit/contracts';
import type {
  CanonicalSubmission,
  LineOfBusiness,
  RatingTable,
  RawBundle,
  Rulebook,
  SchemaDocument,
  VectorSpec,
} from '@retrofit/engine';
import {
  discover,
  normalize,
  readRatingTable,
  readRulebook,
  readVectorSpec,
} from '@retrofit/engine';
import type {
  PlannerResult,
  QueryTraceEntry,
  RunPlannerInput,
  SubmissionFacts,
  TriageKnockout,
} from '@retrofit/federato';
import { runFollowUps, runPlanner } from '@retrofit/federato';
import { createRepos } from '../db/repos';
import type { Repos } from '../db/repos';
import { rescoreBook } from './rescore';
import type { Deps } from './types';

/** Federato carries commercial property only; tenant accounts come from sweeps. */
const FEDERATO_LINE: LineOfBusiness = 'commercial_property';

interface PlannerConfig {
  readonly spec: VectorSpec;
  readonly rulebook: Rulebook;
  readonly extensions: Rulebook;
  readonly ratingTable: RatingTable;
}

async function plannerConfig(): Promise<PlannerConfig> {
  const [spec, rulebook, extensions, ratingTable] = await Promise.all([
    readVectorSpec(FEDERATO_LINE),
    readRulebook('commercial'),
    readRulebook('extensions'),
    readRatingTable(FEDERATO_LINE),
  ]);
  return { spec, rulebook, extensions, ratingTable };
}

function firstString(slot: CanonicalSubmission['insured']['name']): string | null {
  for (const field of slot ?? []) {
    if (typeof field.value === 'string' && field.value.trim() !== '') return field.value;
  }
  return null;
}

function traceFor(bundle: RawBundle, trace: readonly QueryTraceEntry[]): readonly QueryTraceEntryDto[] {
  const ids = new Set(bundle.queryTraceIds ?? []);
  return trace.filter((e) => ids.has(e.id)) as readonly QueryTraceEntryDto[];
}

/**
 * The triage query and any retry that replaced it (a `minimal_select` fallback
 * is an `adapt_retry` pointing back at the triage entry), in trace order.
 */
function triageTraceIds(trace: readonly QueryTraceEntry[]): readonly string[] {
  const ids = new Set<string>();
  for (const e of trace) {
    if (e.pass === 'triage' || (e.adaptedFrom !== null && ids.has(e.adaptedFrom))) ids.add(e.id);
  }
  return trace.filter((e) => ids.has(e.id)).map((e) => e.id);
}

/**
 * The planner's triage facts as they are stored and served (FILL-backend D1/D2):
 * `traceId` is the triage query whose rows were kept (the last of the chain).
 */
export function factsDto(facts: SubmissionFacts, trace: readonly QueryTraceEntry[]): SubmissionFactsDto {
  const ids = triageTraceIds(trace);
  return {
    source: 'federato_triage',
    traceId: ids[ids.length - 1] ?? null,
    federatoId: facts.submissionId,
    submissionNumber: facts.submissionNumber,
    insuredName: facts.insuredName,
    brokerName: facts.brokerName,
    underwriterName: facts.underwriterName,
    lineOfBusiness: facts.lineOfBusiness,
    status: facts.status,
    requestedLimit: facts.requestedLimit,
    receivedDate: facts.receivedDate,
    targetEffectiveDate: facts.targetEffectiveDate,
    declineReason: facts.declineReason,
    competitor: facts.competitor,
  };
}

/**
 * A triage knockout as a bundle: the one Submission row triage already read
 * (same shape `toBundles` gives a survivor with no policy), traced to the
 * triage queries only. Deliberately the four knockout fields and no more: the
 * display facts are stored beside the result, never fed to the engine, so the
 * knockout scores exactly as before (FILL-backend D2).
 */
function knockoutBundle(
  knockout: TriageKnockout,
  schema: SchemaDocument,
  trace: readonly QueryTraceEntry[],
  fetchedAt: string,
): RawBundle {
  return {
    externalId: knockout.externalId,
    records: {
      Submission: [
        {
          resource: 'Submission',
          id: knockout.submissionId,
          data: {
            id: knockout.submissionId,
            submission_number: knockout.externalId,
            status: knockout.status === '' ? null : knockout.status,
            line_of_business: knockout.lineOfBusiness,
          },
        },
      ],
    },
    schema,
    fetchedAt,
    queryTraceIds: triageTraceIds(trace),
  };
}

/**
 * discover -> normalize -> store. The engine runs over the whole book afterwards.
 * `federatoLine` is set for a triage knockout: the canonical line becomes
 * Federato's own line, which stage 6 tiers 0 on line_of_business (G-11,
 * INTERPRETATIONS 3.8), so the row scores as a line-of-business knockout. The
 * row itself stays on FEDERATO_LINE: it is scored with the commercial spec.
 */
function store(
  repos: Repos,
  bundle: RawBundle,
  schema: SchemaDocument,
  spec: VectorSpec,
  trace: readonly QueryTraceEntry[],
  nowIso: string,
  facts: SubmissionFactsDto | null,
  federatoLine?: string,
): void {
  const existing = repos.submissions.byExternalId(bundle.externalId);
  const id = existing?.id ?? bundle.externalId;
  const fieldMap = discover(bundle, schema, spec);
  const canonical: CanonicalSubmission = {
    ...normalize(bundle, fieldMap, FEDERATO_LINE),
    ...(federatoLine === undefined ? {} : { lineOfBusiness: federatoLine as LineOfBusiness }),
    id,
  };
  repos.submissions.upsertByExternalId({
    id,
    source: existing?.source ?? 'federato',
    lineOfBusiness: FEDERATO_LINE,
    externalId: bundle.externalId,
    // The broker record's own name wins; a knockout has none, so Federato's
    // Submission -> insured name (read at triage) names it instead.
    insuredName: firstString(canonical.insured.name) ?? facts?.insuredName ?? null,
    raw: bundle,
    canonical,
    queryTrace: traceFor(bundle, trace),
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
    ...(facts === null ? {} : { facts }),
  });
}

/**
 * An account left alone by idempotent ingest still gets the facts triage just
 * read: they are display-only, so writing them changes no score, and a
 * database seeded before facts existed fills in on its next ingest. The name
 * is filled only where the row has none. `updatedAt` is untouched: nothing
 * about the scored account changed.
 */
function backfillFacts(repos: Repos, externalId: string, facts: SubmissionFactsDto | null): void {
  if (facts === null) return;
  const row = repos.submissions.byExternalId(externalId);
  if (row === null) return;
  repos.submissions.update(row.id, {
    facts,
    ...(row.insuredName == null && facts.insuredName !== null ? { insuredName: facts.insuredName } : {}),
  });
}

function emptyResponse(adapter: IngestResponseDto['adapter'], warnings: readonly string[]): IngestResponseDto {
  return {
    adapter,
    ingested: 0,
    updated: 0,
    skipped: 0,
    knockedOutAtTriage: 0,
    noPolicy: 0,
    queryCount: 0,
    durationMs: 0,
    warnings,
    externalIds: [],
  };
}

/** Idempotent by `externalId`; `force` re-runs an account that already exists. */
export async function ingestFederato(
  deps: Deps,
  request: IngestRequestDto,
): Promise<IngestResponseDto> {
  const startedMs = deps.clock.nowMs();
  if (request.lineOfBusiness === 'tenant') {
    return emptyResponse(deps.adapter.kind, [
      'Federato carries no tenant accounts; tenant submissions come from a camera sweep.',
    ]);
  }

  const repos = createRepos(deps.db);
  const config = await plannerConfig();
  const nowIso = deps.clock.nowIso();
  const plannerInput: RunPlannerInput = {
    adapter: deps.adapter,
    spec: config.spec,
    rulebook: config.rulebook,
    extensions: config.extensions,
    ratingTable: config.ratingTable,
    options: {
      now: nowIso,
      clock: () => deps.clock.nowMs(),
      lineOfBusiness: FEDERATO_LINE,
    },
  };

  let planned: PlannerResult = await runPlanner(plannerInput);
  const warnings: string[] = [];

  const wanted =
    request.externalIds === undefined
      ? null
      : new Set(request.externalIds.map((s) => s.trim()).filter((s) => s !== ''));
  const bundles = planned.bundles.filter((b) => wanted === null || wanted.has(b.externalId));
  // PRD 15 / 11 / INTERPRETATIONS 3.8: triage knockouts are stored and scored
  // too (as line-of-business knockouts), never queried in depth.
  const bundleIds = new Set(bundles.map((b) => b.externalId));
  const knockouts = planned.plan.knockedOut.filter(
    (k) => (wanted === null || wanted.has(k.externalId)) && !bundleIds.has(k.externalId),
  );
  if (wanted !== null) {
    const knocked = new Map(planned.plan.knockedOut.map((k) => [k.externalId, k.reason]));
    for (const id of [...wanted].sort()) {
      if (bundleIds.has(id)) continue;
      const reason = knocked.get(id);
      warnings.push(
        reason === undefined
          ? `${id} was not returned by the planner; nothing stored.`
          : `${id} was knocked out at triage (${reason}); stored as out of appetite.`,
      );
    }
  }

  // Every triaged submission's facts, knocked out or not (FILL-backend D1).
  const factsById = new Map<string, SubmissionFactsDto>();
  for (const t of [...planned.plan.knockedOut, ...planned.plan.survivors]) {
    factsById.set(t.externalId, factsDto(t.facts, planned.trace));
  }
  const factsFor = (externalId: string): SubmissionFactsDto | null => factsById.get(externalId) ?? null;

  // Idempotency: an external id already holding a canonical record is left
  // alone unless `force` is set.
  let ingested = 0;
  let updated = 0;
  let skipped = 0;
  const touched: string[] = [];
  for (const bundle of bundles) {
    const existing = repos.submissions.byExternalId(bundle.externalId);
    if (existing !== null && existing.canonical !== null && existing.canonical !== undefined && request.force !== true) {
      backfillFacts(repos, bundle.externalId, factsFor(bundle.externalId));
      skipped += 1;
      continue;
    }
    store(repos, bundle, planned.schema, config.spec, planned.trace, nowIso, factsFor(bundle.externalId));
    if (existing === null) ingested += 1;
    else updated += 1;
    touched.push(bundle.externalId);
  }
  const touchedKnockouts = new Set<string>();
  for (const knockout of knockouts) {
    const existing = repos.submissions.byExternalId(knockout.externalId);
    if (existing !== null && existing.canonical !== null && existing.canonical !== undefined && request.force !== true) {
      backfillFacts(repos, knockout.externalId, factsFor(knockout.externalId));
      skipped += 1;
      continue;
    }
    const bundle = knockoutBundle(knockout, planned.schema, planned.trace, nowIso);
    store(
      repos,
      bundle,
      planned.schema,
      config.spec,
      planned.trace,
      nowIso,
      factsFor(knockout.externalId),
      knockout.lineOfBusiness,
    );
    if (existing === null) ingested += 1;
    else updated += 1;
    touchedKnockouts.add(knockout.externalId);
  }

  const unscored = repos.submissions.all().some((r) => r.canonical != null && r.result == null);
  if (touched.length > 0 || touchedKnockouts.size > 0 || unscored) {
    await rescoreBook(deps);

    // PRD 7.5 step 5: accounts that scored well (not knocked out) get one more
    // query for coverage detail and the broker; then they are re-normalized.
    const highScorers = touched.filter((externalId) => {
      const row = repos.submissions.byExternalId(externalId);
      return row?.result != null && !row.result.evaluate.knockout;
    });
    if (highScorers.length > 0) {
      const followed = await runFollowUps(plannerInput, planned, highScorers);
      if (followed !== planned && followed.counts.followUps > planned.counts.followUps) {
        planned = followed;
        const byId = new Map(followed.bundles.map((b) => [b.externalId, b]));
        const followedIds = new Set(followed.plan.followUps.flatMap((p) => p.forExternalIds));
        for (const externalId of highScorers) {
          const bundle = byId.get(externalId);
          if (bundle === undefined || !followedIds.has(externalId)) continue;
          store(repos, bundle, followed.schema, config.spec, followed.trace, nowIso, factsFor(externalId));
        }
        await rescoreBook(deps);
      } else {
        planned = followed;
      }
    }
  }

  warnings.unshift(...planned.warnings);
  return {
    adapter: planned.adapterKind,
    ingested,
    updated,
    skipped,
    knockedOutAtTriage: planned.counts.knockedOut,
    noPolicy: planned.counts.noPolicy,
    queryCount: planned.counts.queries,
    durationMs: Math.max(0, deps.clock.nowMs() - startedMs),
    warnings,
    externalIds: [...bundles.map((b) => b.externalId), ...knockouts.map((k) => k.externalId)],
  };
}
