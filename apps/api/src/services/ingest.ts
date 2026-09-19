/** Ingest service: planner -> normalize -> engine -> store. Unit A16. */
import type { IngestRequestDto, IngestResponseDto, QueryTraceEntryDto } from '@retrofit/contracts';
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
import type { PlannerResult, QueryTraceEntry, RunPlannerInput } from '@retrofit/federato';
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

/** discover -> normalize -> store. The engine runs over the whole book afterwards. */
function store(
  repos: Repos,
  bundle: RawBundle,
  schema: SchemaDocument,
  spec: VectorSpec,
  trace: readonly QueryTraceEntry[],
  nowIso: string,
): void {
  const existing = repos.submissions.byExternalId(bundle.externalId);
  const id = existing?.id ?? bundle.externalId;
  const fieldMap = discover(bundle, schema, spec);
  const canonical: CanonicalSubmission = {
    ...normalize(bundle, fieldMap, FEDERATO_LINE),
    id,
  };
  repos.submissions.upsertByExternalId({
    id,
    source: existing?.source ?? 'federato',
    lineOfBusiness: FEDERATO_LINE,
    externalId: bundle.externalId,
    insuredName: firstString(canonical.insured.name),
    raw: bundle,
    canonical,
    queryTrace: traceFor(bundle, trace),
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
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
  if (wanted !== null) {
    const found = new Set(bundles.map((b) => b.externalId));
    const knocked = new Map(planned.plan.knockedOut.map((k) => [k.externalId, k.reason]));
    for (const id of [...wanted].sort()) {
      if (found.has(id)) continue;
      const reason = knocked.get(id);
      warnings.push(
        reason === undefined
          ? `${id} was not returned by the planner; nothing stored.`
          : `${id} was knocked out at triage (${reason}); nothing stored.`,
      );
    }
  }

  // Idempotency: an external id already holding a canonical record is left
  // alone unless `force` is set.
  let ingested = 0;
  let updated = 0;
  let skipped = 0;
  const touched: string[] = [];
  for (const bundle of bundles) {
    const existing = repos.submissions.byExternalId(bundle.externalId);
    if (existing !== null && existing.canonical !== null && existing.canonical !== undefined && request.force !== true) {
      skipped += 1;
      continue;
    }
    store(repos, bundle, planned.schema, config.spec, planned.trace, nowIso);
    if (existing === null) ingested += 1;
    else updated += 1;
    touched.push(bundle.externalId);
  }

  const unscored = repos.submissions.all().some((r) => r.canonical != null && r.result == null);
  if (touched.length > 0 || unscored) {
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
          store(repos, bundle, followed.schema, config.spec, followed.trace, nowIso);
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
    externalIds: bundles.map((b) => b.externalId),
  };
}
