/**
 * The planner end to end: schema -> graph -> collect -> locate -> plan ->
 * execute with adaptation -> bundles + trace. Body owned by Run 1 unit F11.
 * Decisions: docs/decisions/F11.md.
 */
import type {
  LineOfBusiness,
  RatingTable,
  RawBundle,
  RawRecord,
  Rulebook,
  SchemaDocument,
  VectorSpec,
} from '@retrofit/engine';
import type {
  AdaptationKind,
  FederatoAdapter,
  FederatoErrorShape,
  FederatoRecord,
  FederatoResource,
  FollowUpPlan,
  LocateResult,
  PlannerCounts,
  PlannerOptions,
  PlannerResult,
  QueryPass,
  QueryPayload,
  QueryTraceEntry,
  TracePathChoice,
  TraceRuleNeed,
} from '../types';
import { parseFederatoError } from '../live-adapter';
import { OVER_DECLINED_NOTE, nextAdaptation } from './adapt';
import { collectNeededFields } from './collect';
import { buildResourceGraph, pathsFrom } from './graph';
import { locateFields } from './locate';
import type { PlanInput } from './plan';
import { planDeep, planFollowUps, planNoPolicy, planTriage, triageRows } from './plan';
import { externalIdOf, toBundles } from './to-bundle';
import type { TraceRecorder } from './trace';
import { createTraceRecorder } from './trace';

export interface RunPlannerInput {
  readonly adapter: FederatoAdapter;
  readonly spec: VectorSpec;
  readonly rulebook: Rulebook;
  readonly extensions?: Rulebook | undefined;
  readonly ratingTable?: RatingTable | undefined;
  readonly options?: PlannerOptions | undefined;
}

/* -------------------------------------------------------------------------- */
/* Private                                                                    */
/* -------------------------------------------------------------------------- */

/** Trace id prefix for one planner run; follow-up entries continue the sequence. */
const TRACE_PREFIX = 'q';

/** Deep enough to reach `exposure_units.location.buildings` and one hop past it. */
const ARRAY_PATH_HOPS = 4;

interface QueryStep {
  readonly pass: QueryPass;
  readonly goal: string;
  readonly requiredBy: readonly TraceRuleNeed[];
  readonly pathChosen: TracePathChoice;
  readonly payload: QueryPayload;
}

interface StepOutcome {
  readonly rows: readonly FederatoRecord[];
  readonly total: number | null;
  /** Trace id of the query whose rows were kept (the last attempt). */
  readonly finalId: string;
  readonly ids: readonly string[];
  readonly error: FederatoErrorShape | null;
  readonly adaptations: readonly AdaptationKind[];
}

function traceId(seq: number): string {
  return `${TRACE_PREFIX}-${String(seq).padStart(3, '0')}`;
}

function lineOf(input: RunPlannerInput): LineOfBusiness {
  return input.options?.lineOfBusiness ?? input.spec.lineOfBusiness;
}

function planInputOf(input: RunPlannerInput, locate: LocateResult): PlanInput {
  return {
    locate,
    lineOfBusiness: lineOf(input),
    ...(input.options?.pageLimit === undefined ? {} : { pageLimit: input.options.pageLimit }),
  };
}

function isRecord(v: unknown): v is Readonly<Record<string, unknown>> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Any thrown value -> the `[CODE] message` shape the trace stores. */
function toErrorShape(err: unknown): FederatoErrorShape {
  if (isRecord(err) && typeof err['raw'] === 'string' && 'code' in err) {
    const code = err['code'];
    const status = err['httpStatus'];
    return {
      code: typeof code === 'string' ? code : null,
      message: typeof err['message'] === 'string' ? err['message'] : String(err['raw']),
      httpStatus: typeof status === 'number' ? status : null,
      raw: err['raw'],
    };
  }
  const text = err instanceof Error ? err.message : String(err);
  return parseFederatoError(text);
}

/**
 * Every dot-path under `resource` that is a list: reference arrays reached
 * through the graph and scalar array fields. Feeds the `$elemMatch` swap.
 */
function arrayPathsFor(
  schema: SchemaDocument,
  graph: ReturnType<typeof buildResourceGraph>,
  resource: FederatoResource,
): readonly string[] {
  const fieldsOf = new Map<string, readonly { path: string; isArray?: boolean }[]>();
  for (const r of schema.resources ?? []) fieldsOf.set(r.name, r.fields ?? []);

  const out = new Set<string>();
  const addArraysOf = (at: string, prefix: string): void => {
    for (const f of fieldsOf.get(at) ?? []) {
      if (f.isArray === true && typeof f.path === 'string' && f.path !== '') {
        out.add(prefix === '' ? f.path : `${prefix}.${f.path}`);
      }
    }
  };
  addArraysOf(resource, '');
  for (const p of pathsFrom(graph, resource, ARRAY_PATH_HOPS)) addArraysOf(p.to, p.dotPath);
  return [...out].sort((a, b) => a.localeCompare(b));
}

function safeExternalId(row: FederatoRecord): string | null {
  try {
    return externalIdOf(row);
  } catch {
    return null;
  }
}

function uniqueExternalIds(rows: readonly FederatoRecord[]): readonly string[] {
  const out = new Set<string>();
  for (const row of rows) {
    const id = safeExternalId(row);
    if (id !== null) out.add(id);
  }
  return [...out];
}

/**
 * Runs one planned query and, while it comes back empty, the adaptations F10
 * offers (`$elemMatch` swap, then one dropped condition). Every attempt is its
 * own trace entry; a retry points back at the query it replaced.
 */
async function execute(
  adapter: FederatoAdapter,
  recorder: TraceRecorder,
  step: QueryStep,
  arrayPaths: readonly string[],
): Promise<StepOutcome> {
  const ids: string[] = [];
  const attempted: AdaptationKind[] = [];
  let payload = step.payload;
  let pass = step.pass;
  let adaptedFrom: string | null = null;
  let adaptation: AdaptationKind = 'none';
  let why: string | null = null;

  for (;;) {
    const id = recorder.begin({
      pass,
      goal: step.goal,
      requiredBy: step.requiredBy,
      pathChosen: step.pathChosen,
      payload,
      adaptedFrom,
      adaptation,
    });
    ids.push(id);
    if (why !== null) recorder.note(id, why);

    let rows: readonly FederatoRecord[];
    let total: number;
    try {
      const result = await adapter.query(payload);
      rows = Array.isArray(result.results) ? result.results : [];
      total = typeof result.total === 'number' ? result.total : rows.length;
    } catch (err) {
      const error = toErrorShape(err);
      recorder.finish(id, { rowCount: 0, totalAvailable: null, error });
      return { rows: [], total: null, finalId: id, ids, error, adaptations: attempted };
    }

    const notes: string[] = [];
    if (total > rows.length) {
      notes.push(
        `Federato reports ${total} matching records but returned ${rows.length}; the page limit cut the rest.`,
      );
    }
    recorder.finish(id, { rowCount: rows.length, totalAvailable: total, notes });
    if (rows.length > 0) {
      return { rows, total, finalId: id, ids, error: null, adaptations: attempted };
    }

    const next = nextAdaptation(payload, attempted, arrayPaths);
    if (next === null) {
      recorder.note(id, 'No rows, and no adaptation left to try; the empty result stands.');
      return { rows: [], total, finalId: id, ids, error: null, adaptations: attempted };
    }
    attempted.push(next.kind);
    payload = next.payload;
    pass = 'adapt_retry';
    adaptedFrom = id;
    adaptation = next.kind;
    why = next.why;
  }
}

function describeError(label: string, e: FederatoErrorShape): string {
  return `${label} failed${e.code === null ? '' : ` [${e.code}]`}: ${e.message}`;
}

function sumDurations(trace: readonly QueryTraceEntry[]): number {
  return trace.reduce((s, e) => s + e.durationMs, 0);
}

function byRecordId(a: RawRecord, b: RawRecord): number {
  if (typeof a.id === 'number' && typeof b.id === 'number') return a.id - b.id;
  return String(a.id).localeCompare(String(b.id));
}

/* -------------------------------------------------------------------------- */
/* Public                                                                     */
/* -------------------------------------------------------------------------- */

export async function runPlanner(input: RunPlannerInput): Promise<PlannerResult> {
  const { adapter } = input;
  const options = input.options ?? {};
  const nowIso = options.now ?? new Date().toISOString();
  const warnings: string[] = [];

  // Step 1: read the schema into a resource graph. No schema, no plan: this throws.
  const schema = await adapter.getSchema();
  const graph = buildResourceGraph(schema);

  // Step 2: the fields the rules and rating table need.
  const needed = collectNeededFields({
    spec: input.spec,
    rulebook: input.rulebook,
    extensions: input.extensions,
    ratingTable: input.ratingTable,
  });

  // Step 3: where they live. The assist is optional; if it fails the planner
  // stays deterministic and the fields stay visibly unmapped.
  let locate: LocateResult;
  try {
    locate = await locateFields({ needed, schema, graph, schemaAssist: options.schemaAssist });
  } catch (err) {
    if (options.schemaAssist === undefined) throw err;
    warnings.push(
      `Schema assist failed (${err instanceof Error ? err.message : String(err)}); located fields deterministically only.`,
    );
    locate = await locateFields({ needed, schema, graph });
  }
  if (locate.unmapped.length > 0) {
    const names = locate.unmapped.map((u) => u.canonicalPath);
    warnings.push(
      `${names.length} needed field${names.length === 1 ? '' : 's'} stayed unmapped: ${names.slice(0, 8).join(', ')}${names.length > 8 ? ` and ${names.length - 8} more` : ''}.`,
    );
  }

  const planInput = planInputOf(input, locate);
  const recorder = createTraceRecorder({
    adapterKind: adapter.kind,
    clock: options.clock,
    now: nowIso,
    idPrefix: TRACE_PREFIX,
  });
  const arrays = (r: FederatoResource): readonly string[] => arrayPathsFor(schema, graph, r);

  // Step 4a: triage.
  const triagePlan = planTriage(planInput);
  const triage = await execute(adapter, recorder, { pass: 'triage', ...triagePlan }, arrays(triagePlan.payload.resource));
  if (triage.error !== null) warnings.push(describeError('Triage query', triage.error));
  if (triage.total !== null && triage.total > triage.rows.length) {
    warnings.push(
      `Triage saw ${triage.rows.length} of ${triage.total} submissions; raise pageLimit to see the rest.`,
    );
  }
  const { knockedOut, survivors } = triageRows(triage.rows, planInput);

  // Step 4b: deep pass, one hydrated Policy query.
  const deepPlan = planDeep(survivors, planInput);
  let policies: readonly FederatoRecord[] = [];
  if (deepPlan !== null) {
    const deep = await execute(adapter, recorder, { pass: 'deep', ...deepPlan }, arrays('Policy'));
    recorder.note(deep.ids[0]!, OVER_DECLINED_NOTE);
    if (deep.error !== null) warnings.push(describeError('Deep Policy query', deep.error));
    if (deep.total !== null && deep.total > deep.rows.length) {
      warnings.push(
        `Deep pass hydrated ${deep.rows.length} of ${deep.total} policies; raise pageLimit to see the rest.`,
      );
    }
    if (deep.adaptations.includes('drop_narrowest_filter')) {
      warnings.push('Deep pass only returned rows after dropping a condition; see the trace.');
    }
    policies = deep.rows;
  }
  const hydratedIds = uniqueExternalIds(policies);

  // Step 4c: survivors with no policy, through Submission -> insured -> hq.
  const noPolicyPlan = planNoPolicy(survivors, hydratedIds, planInput);
  let noPolicyRows: readonly FederatoRecord[] = [];
  if (noPolicyPlan !== null) {
    const np = await execute(
      adapter,
      recorder,
      { pass: 'no_policy_followup', ...noPolicyPlan },
      arrays('Submission'),
    );
    if (np.error !== null) warnings.push(describeError('No-policy follow-up query', np.error));
    // Only the submissions asked for: a widened retry must not leak others in.
    const wanted = new Set(noPolicyPlan.expectedExternalIds);
    noPolicyRows = np.rows.filter((r) => {
      const id = safeExternalId(r);
      return id !== null && wanted.has(id);
    });
  }

  const trace = recorder.entries();
  const bundles = toBundles({
    policies,
    noPolicySubmissions: noPolicyRows,
    followUps: [],
    survivors,
    schema,
    fetchedAt: nowIso,
    queryTraceIds: trace.map((e) => e.id),
  });

  const survivorIds = new Set(survivors.map((s) => s.externalId));
  const counts: PlannerCounts = {
    submissionsSeen: knockedOut.length + survivors.length,
    knockedOut: knockedOut.length,
    survivors: survivors.length,
    deepHydrated: hydratedIds.filter((id) => survivorIds.has(id)).length,
    noPolicy: noPolicyPlan === null ? 0 : noPolicyPlan.expectedExternalIds.length,
    followUps: 0,
    queries: trace.length,
    totalDurationMs: sumDurations(trace),
  };

  return {
    adapterKind: adapter.kind,
    schema,
    bundles,
    trace,
    plan: {
      triage: triagePlan,
      deep: deepPlan,
      noPolicy: noPolicyPlan,
      followUps: [],
      knockedOut,
      survivors,
    },
    locate,
    needed,
    counts,
    warnings,
  };
}

/** Step 5's "high-scoring accounts get one further query" pass. */
export async function runFollowUps(
  input: RunPlannerInput,
  result: PlannerResult,
  highScorerExternalIds: readonly string[],
): Promise<PlannerResult> {
  const options = input.options ?? {};
  if (options.skipFollowUps === true) return result;

  // Only accounts with a hydrated policy can be followed up: coverages,
  // endorsements and the producer all hang off Policy.
  const withPolicy = new Set(
    result.bundles
      .filter((b) => (b.records['Policy']?.length ?? 0) > 0)
      .map((b) => b.externalId),
  );
  const requested = [...new Set(highScorerExternalIds.map((s) => s.trim()).filter((s) => s !== ''))];
  const eligible = requested.filter((id) => withPolicy.has(id));
  const warnings = [...result.warnings];
  const skipped = requested.filter((id) => !withPolicy.has(id));
  if (skipped.length > 0) {
    warnings.push(
      `High-scorer follow-up skipped ${skipped.join(', ')}: no hydrated policy to reach coverages or broker from.`,
    );
  }

  const plans: readonly FollowUpPlan[] = planFollowUps(eligible, planInputOf(input, result.locate));
  if (plans.length === 0) return warnings.length === result.warnings.length ? result : { ...result, warnings };

  const offset = result.trace.length;
  const recorder = createTraceRecorder({
    adapterKind: input.adapter.kind,
    clock: options.clock,
    now: options.now ?? new Date().toISOString(),
    idPrefix: `${TRACE_PREFIX}-followup`,
  });
  const arrays = arrayPathsFor(result.schema, buildResourceGraph(result.schema), 'Policy');

  const rowsByExternalId = new Map<string, FederatoRecord[]>();
  for (const plan of plans) {
    const outcome = await execute(
      input.adapter,
      recorder,
      { pass: 'high_scorer_followup', ...plan },
      arrays,
    );
    if (outcome.error !== null) warnings.push(describeError('High-scorer follow-up query', outcome.error));
    const wanted = new Set(plan.forExternalIds);
    for (const row of outcome.rows) {
      const id = safeExternalId(row);
      if (id === null || !wanted.has(id)) continue;
      const bucket = rowsByExternalId.get(id);
      if (bucket === undefined) rowsByExternalId.set(id, [row]);
      else bucket.push(row);
    }
  }

  // Continue the run's trace sequence: renumber ids and seq, remap adaptedFrom.
  const fresh = recorder.entries();
  const idMap = new Map(fresh.map((e) => [e.id, traceId(offset + e.seq)]));
  const added: QueryTraceEntry[] = fresh.map((e) => ({
    ...e,
    id: idMap.get(e.id)!,
    seq: offset + e.seq,
    adaptedFrom: e.adaptedFrom === null ? null : (idMap.get(e.adaptedFrom) ?? e.adaptedFrom),
  }));
  const trace = [...result.trace, ...added];
  const newIds = added.map((e) => e.id);

  const bundles: RawBundle[] = result.bundles.map((b) => {
    const extra = rowsByExternalId.get(b.externalId);
    const traceIds = [...(b.queryTraceIds ?? []), ...newIds];
    if (extra === undefined) return { ...b, queryTraceIds: traceIds };
    const additions = extra
      .map((row): RawRecord => {
        const id = row['id'];
        return {
          resource: 'Policy',
          id: typeof id === 'number' || (typeof id === 'string' && id !== '') ? id : b.externalId,
          data: row,
        };
      })
      .sort(byRecordId);
    return {
      ...b,
      records: { ...b.records, Policy: [...(b.records['Policy'] ?? []), ...additions] },
      queryTraceIds: traceIds,
    };
  });

  const followedUp = plans.reduce((s, p) => s + p.forExternalIds.length, 0);
  return {
    ...result,
    bundles,
    trace,
    plan: { ...result.plan, followUps: [...result.plan.followUps, ...plans] },
    counts: {
      ...result.counts,
      followUps: result.counts.followUps + followedUp,
      queries: trace.length,
      totalDurationMs: sumDurations(trace),
    },
    warnings,
  };
}
