/** GET /submissions and GET /submissions/:id. Body owned by Run 1 unit A12. */
import type { Hono } from 'hono';
import type {
  AccountKindDto,
  ActionDto,
  ActionStatusDto,
  BuildingRowDto,
  EnrichmentCardDto,
  ErrorDto,
  ExplanationDto,
  QueueQueryDto,
  QueueResponseDto,
  QueueRowDto,
  PeerResultDto,
  RoutingDecisionDto,
  SubmissionDetailDto,
  SubmissionFactsDto,
  SweepDto,
  UnderwriterDto,
} from '@retrofit/contracts';
import { DEFAULT_PAGE_LIMIT, ROUTES, queueQuerySchema } from '@retrofit/contracts';
import type {
  BuildingFacts,
  CanonicalSubmission,
  EngineResult,
  LineOfBusiness,
  LocationFacts,
  VectorSpec,
  Verdict,
} from '@retrofit/engine';
import { bestValue, readVectorSpec, rollup } from '@retrofit/engine';
import { explain, narrateGuard } from '@retrofit/federato';
import type { Explanation } from '@retrofit/federato';
import type { ApiEnv } from '../app';
import { createRepos } from '../db/repos';
import type { ActionRow, EnrichmentRow, SubmissionRow, SweepRow } from '../db/schema';
import { narrateCall } from '../llm/index';
import { getSweep } from '../services/sweep';
import { accountVerification, currentPerAccount } from '../services/verification';
import type { PerAccountFile } from '../services/verification';
import type { Deps } from '../services/types';

/* -------------------------------------------------------------------------- */
/* Small private helpers                                                      */
/* -------------------------------------------------------------------------- */

const errorBody = (code: string, message: string): ErrorDto => ({ error: { code, message } });

const isNotImplemented = (error: unknown): boolean =>
  error instanceof Error && error.message.startsWith('NOT_IMPLEMENTED:');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

/** An action still waiting on someone: the underwriter (draft/approved) or the broker (sent). */
const PENDING_STATUSES: ReadonlySet<ActionStatusDto> = new Set<ActionStatusDto>([
  'draft',
  'approved',
  'sent',
]);

/* -------------------------------------------------------------------------- */
/* Line of business                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Federato's own `line_of_business` string (`property`, `health`, `cgl`, ...)
 * for this submission, read from the untouched raw bundle. `Submission` wins,
 * because triage is Submission-rooted (F07 decision 3).
 */
function federatoLine(row: SubmissionRow): string | null {
  const records = row.raw?.records;
  if (records === undefined) return null;
  const order = ['Submission', ...Object.keys(records).filter((k) => k !== 'Submission')];
  for (const resource of order) {
    for (const record of records[resource] ?? []) {
      const line = str(record.data['line_of_business']);
      if (line !== null) return line;
    }
  }
  return null;
}

/** True for the rows collapsed under "Out of appetite: line of business" (PRD §11). */
function isOutOfAppetiteLine(result: EngineResult): boolean {
  return result.evaluate.knockoutFactors.includes('line_of_business');
}

/**
 * What to show as the line: Retrofit's line, or Federato's own line for a
 * triage knockout (`cyber`, `health`, ...) -- never `commercial_property` for
 * an account that is not property. The triage facts win, then the raw record.
 */
function displayLine(row: SubmissionRow, result: EngineResult): string {
  if (isOutOfAppetiteLine(result)) return row.facts?.lineOfBusiness ?? federatoLine(row) ?? row.lineOfBusiness;
  return row.lineOfBusiness;
}

/**
 * Which view the account needs (FILL-backend D4). A Federato property account
 * whose stored bundle has no Policy record is a no-policy account: no premium,
 * business type or buildings were ever returned for it.
 */
function accountKindOf(row: SubmissionRow, result: EngineResult): AccountKindDto {
  if (isOutOfAppetiteLine(result)) return 'triage_knockout';
  // No Policy and nothing supplied since (a broker reply or the backfill adds buildings).
  if (
    row.source === 'federato' &&
    (row.raw?.records['Policy']?.length ?? 0) === 0 &&
    result.canonical.buildings.length === 0
  ) {
    return 'no_policy';
  }
  return 'scored';
}

/** Some values were hand-authored by the backfill (apps/api/src/scripts/backfill.ts), not read from Federato. */
function isSynthetic(result: EngineResult): boolean {
  return JSON.stringify(result.canonical).includes('"sourceDetail":"synthetic:');
}

/** The stored triage facts, or an explicit "never read" record: every value absent, none guessed. */
function factsOf(row: SubmissionRow): SubmissionFactsDto {
  if (row.facts != null) return row.facts;
  return {
    source: 'not_fetched',
    traceId: null,
    federatoId: null,
    submissionNumber: row.externalId,
    insuredName: null,
    brokerName: null,
    underwriterName: null,
    lineOfBusiness: null,
    status: null,
    requestedLimit: null,
    receivedDate: null,
    targetEffectiveDate: null,
    declineReason: null,
    competitor: null,
  };
}

function lineMatches(filter: string, row: SubmissionRow, result: EngineResult): boolean {
  const want = filter.trim().toLowerCase();
  if (displayLine(row, result).toLowerCase() === want) return true;
  // An in-line row also answers to Federato's own spelling (`property`).
  if (isOutOfAppetiteLine(result)) return false;
  return (federatoLine(row) ?? '').toLowerCase() === want;
}

/* -------------------------------------------------------------------------- */
/* Actions -> routing, pending, ActionDto                                     */
/* -------------------------------------------------------------------------- */

/** The newest routing decision among a submission's actions (newest first). */
function latestRouting(actions: readonly ActionRow[]): RoutingDecisionDto | null {
  const routed = actions.find((a) => a.type === 'route' && a.payload.routing != null);
  const any = routed ?? actions.find((a) => a.payload.routing != null);
  return any?.payload.routing ?? null;
}

function pendingOf(actions: readonly ActionRow[]): QueueRowDto['pendingAction'] {
  const pending = actions.find((a) => PENDING_STATUSES.has(a.status));
  return pending === undefined ? null : { id: pending.id, type: pending.type, status: pending.status };
}

function toActionDto(action: ActionRow, submission: SubmissionRow): ActionDto {
  const p = action.payload;
  return {
    id: action.id,
    submissionId: action.submissionId,
    externalId: submission.externalId,
    insuredName: submission.insuredName,
    type: action.type,
    status: action.status,
    actor: action.actor,
    triggers: p.triggers ?? [],
    fields: p.fields ?? [],
    draft: p.draft ?? null,
    recipient: p.recipient ?? null,
    routing: p.routing ?? null,
    sourceText: action.sourceText,
    extracted: p.extracted ?? [],
    before: action.before,
    after: action.after,
    rankBefore: p.rankBefore ?? action.before?.rank ?? null,
    rankAfter: p.rankAfter ?? action.after?.rank ?? null,
    note: p.note ?? null,
    createdAt: action.createdAt,
  };
}

/* -------------------------------------------------------------------------- */
/* Queue                                                                      */
/* -------------------------------------------------------------------------- */

/** The "1 flip from FIT" badge: not FIT yet, and one single move makes it FIT. */
function oneFlipFromFit(result: EngineResult): boolean {
  const flip = result.flip.flip;
  return (
    result.verdict.verdict !== 'FIT' &&
    flip !== null &&
    flip.moves.length === 1 &&
    flip.verdictAfter === 'FIT'
  );
}

function toQueueRow(
  row: SubmissionRow,
  result: EngineResult,
  rank: number,
  actions: readonly ActionRow[],
): QueueRowDto {
  const routing = latestRouting(actions);
  const assigned: UnderwriterDto | null = routing?.assigned ?? null;
  return {
    id: row.id,
    externalId: row.externalId,
    rank,
    qualityIndex: result.qualityIndex,
    qualityComponents: result.qualityComponents,
    verdict: result.verdict.verdict,
    insuredName: row.insuredName,
    lineOfBusiness: displayLine(row, result),
    outOfAppetiteLine: isOutOfAppetiteLine(result),
    accountKind: accountKindOf(row, result),
    synthetic: isSynthetic(result),
    appetiteScore: result.evaluate.appetiteScore,
    primaryState: result.rollup.primaryState,
    totalTiv: result.rollup.totalTiv,
    quotedPremium: result.price.quotedPremium,
    predictedPremium: result.price.predictedPremium,
    adequacy: result.price.adequacy,
    completeness: result.evaluate.completeness,
    confidence: result.evaluate.confidence,
    contradictionCount: result.contradictions.length,
    openHighContradictionCount: result.contradictions.filter(
      (x) => x.status === 'open' && x.severity === 'HIGH',
    ).length,
    distanceToAppetite: result.verdict.distanceToAppetite,
    oneFlipFromFit: oneFlipFromFit(result),
    assignedUnderwriter: assigned,
    federatoUnderwriter: row.facts?.underwriterName ?? null,
    pendingAction: pendingOf(actions),
    explanation: result.explanation,
    updatedAt: row.updatedAt,
  };
}

/* -------------------------------------------------------------------------- */
/* Detail: buildings                                                          */
/* -------------------------------------------------------------------------- */

const value = <T>(field: Parameters<typeof bestValue<T>>[0]): T | null => bestValue(field)?.value ?? null;

/**
 * R4-9 / R5-3: the rollup keys `pctTivByConstruction` by the engine's canonical
 * class (normalize + a private alias table, e.g. steel_frame -> steel), which
 * the engine barrel does not export. Rather than restate that table here, the
 * key is read back from the engine's own rollup over this one building, so the
 * classification stays in the engine. A building with no known TIV is not in
 * the rollup at all and yields null (as before: no share, not acceptable).
 */
function constructionClassKey(building: BuildingFacts, result: EngineResult): string | null {
  const probe = rollup({ ...result.canonical, locations: [], buildings: [building], history: [] }, result.asOf);
  return probe.pctTivByConstruction[0]?.constructionType ?? null;
}

function toBuildingRow(
  building: BuildingFacts,
  locations: ReadonlyMap<string, LocationFacts>,
  result: EngineResult,
): BuildingRowDto {
  const location =
    building.locationExternalId === undefined ? undefined : locations.get(building.locationExternalId);
  const yearBuilt = value(building.yearBuilt);
  const constructionType = value(building.constructionType);
  const key = constructionClassKey(building, result);
  const share =
    key === null ? undefined : result.rollup.pctTivByConstruction.find((c) => c.constructionType === key);
  return {
    externalId: building.externalId,
    name: building.label ?? null,
    tiv: value(building.tiv),
    yearBuilt,
    constructionType,
    sprinklered: value(building.sprinklered),
    stories: value(building.stories),
    protectionClass: value(building.protectionClass) ?? value(location?.protectionClass),
    state: value(location?.state),
    city: value(location?.city),
    // Same boundaries as the rollup (INTERPRETATIONS 3.4): < 1990 and >= 2010.
    pre1990: yearBuilt !== null && yearBuilt < 1990,
    post2010: yearBuilt !== null && yearBuilt >= 2010,
    acceptableConstruction: share?.acceptable ?? false,
    assumedAcceptableConstruction: share?.assumedAcceptable ?? false,
  };
}

function buildingRows(canonical: CanonicalSubmission, result: EngineResult): BuildingRowDto[] {
  const locations = new Map(canonical.locations.map((l) => [l.externalId, l] as const));
  return canonical.buildings.map((b) => toBuildingRow(b, locations, result));
}

/* -------------------------------------------------------------------------- */
/* Detail: enrichment cards                                                   */
/* -------------------------------------------------------------------------- */

const isCard = (v: unknown): v is EnrichmentCardDto =>
  isRecord(v) && typeof v['source'] === 'string' && typeof v['title'] === 'string' && Array.isArray(v['fields']);

/**
 * The stored payload is "the plugin's raw response plus the card it produced"
 * (schema.ts). The card is read from `payload.card`; a row without one still
 * yields a card, so a failed plugin is never silently dropped (PRD §8).
 */
function toEnrichmentCard(row: EnrichmentRow): EnrichmentCardDto {
  const payload = row.payload;
  const stored = isCard(payload['card']) ? payload['card'] : isCard(payload) ? payload : null;
  if (stored !== null) return { ...stored, available: stored.available ?? row.available };
  return {
    source: row.source,
    title: str(payload['title']) ?? row.source,
    available: row.available,
    unavailableReason: row.available
      ? null
      : (str(payload['unavailableReason']) ?? str(payload['error']) ?? 'unavailable'),
    fetchedAt: row.createdAt,
    fields: [],
    attribution: str(payload['attribution']) ?? '',
  };
}

/* -------------------------------------------------------------------------- */
/* Detail: attached sweep                                                     */
/* -------------------------------------------------------------------------- */

/** Observations under 0.6 wait for the user (SweepDto.needsConfirmation). */
const CONFIRM_BELOW = 0.6;

function sweepFromRow(row: SweepRow): SweepDto {
  return {
    id: row.id,
    submissionId: row.submissionId,
    roomLabel: row.roomLabel,
    termMonths: row.term,
    stage: row.stage,
    frames: row.frames,
    coverage: row.coverage,
    observations: row.observations,
    needsConfirmation: row.observations.filter((o) => o.confidence < CONFIRM_BELOW),
    result: row.result,
    askedQuestionIds: [],
    skippedCount: 0,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The newest sweep attached to the submission, through the sweep service when it exists. */
async function attachedSweep(deps: Deps, sweeps: readonly SweepRow[]): Promise<SweepDto | null> {
  const latest = sweeps[sweeps.length - 1];
  if (latest === undefined) return null;
  try {
    return (await getSweep(deps, latest.id)) ?? sweepFromRow(latest);
  } catch (error) {
    if (!isNotImplemented(error)) throw error;
    return sweepFromRow(latest);
  }
}

/* -------------------------------------------------------------------------- */
/* Detail: explanation                                                        */
/* -------------------------------------------------------------------------- */

const splitSentences = (text: string): string[] =>
  text.split(/(?<=[.!?])\s+(?=[A-Z"'(])/).filter((s) => s.trim().length > 0);

function flipSummary(result: EngineResult): string | null {
  const flip = result.flip.flip;
  if (flip === null || flip.moves.length === 0) return null;
  return `${flip.moves.map((m) => m.label).join(' and ')} would make it ${flip.verdictAfter}`;
}

/**
 * The deterministic template (PRD §7.7), polished by `narrate` when a
 * provider is configured. The polish is checked twice — inside the call and
 * by `narrateGuard` — and any failure keeps the template. Numbers and the
 * recommendation never change.
 */
async function explanationFor(
  deps: Deps,
  row: SubmissionRow,
  result: EngineResult,
): Promise<ExplanationDto | null> {
  let base: Explanation;
  try {
    base = explain({ result, insuredName: row.insuredName, rank: row.rank });
  } catch (error) {
    if (!isNotImplemented(error)) throw error;
    return null;
  }
  const { text } = await narrateCall(deps.llm, {
    template: base.template,
    verdict: result.verdict.verdict,
    recommendation: base.recommendation,
    numbers: base.numbers,
    firedRules: result.evaluate.firedRules.map((r) => ({
      ruleId: r.ruleId,
      factor: r.factor,
      tier: r.tier,
      quote: r.citation.quote,
    })),
    flipSummary: flipSummary(result),
    insuredName: row.insuredName,
  });
  if (text === base.template) return base;
  const guard = narrateGuard(base, text);
  if (!guard.ok || guard.text === base.template) return base;
  return { ...base, text: guard.text, sentences: splitSentences(guard.text), narrated: true };
}

/* -------------------------------------------------------------------------- */
/* Detail: peers and verification                                             */
/* -------------------------------------------------------------------------- */

/**
 * `result.peers` with each peer's verdict, read from that peer's stored result
 * -- the result the same book re-score wrote. A peer with no stored result
 * (deleted, unscored) gets null, shown as absent.
 */
function peersWithVerdicts(result: EngineResult, verdictOf: (id: string) => Verdict | null): PeerResultDto | null {
  const peers = result.peers;
  if (peers === null) return null;
  return { ...peers, peers: peers.peers.map((p) => ({ ...p, verdict: verdictOf(p.id) })) };
}

/** The per-account verification file; a file that cannot be read leaves the block absent rather than failing the page. */
function perAccountOrNull(): PerAccountFile | null {
  try {
    return currentPerAccount();
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Registrar                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Registers this module's handlers on the frozen app. Throwing here in Run 0 is
 * expected: `app.ts` catches it and serves the 501 fallbacks instead.
 */
export function registerSubmissionRoutes(app: Hono<ApiEnv>, deps: Deps): void {
  const repos = createRepos(deps.db);

  /**
   * Narration is one Gemini call per submission version, never per page view:
   * cached by id + `updatedAt`, so a re-score (which bumps `updatedAt`) re-narrates.
   */
  const explanations = new Map<string, Promise<ExplanationDto | null>>();
  const cachedExplanation = (row: SubmissionRow, result: EngineResult): Promise<ExplanationDto | null> => {
    const key = `${row.id}@${row.updatedAt}`;
    let hit = explanations.get(key);
    if (hit === undefined) {
      hit = explanationFor(deps, row, result);
      explanations.set(key, hit);
      hit.catch(() => explanations.delete(key));
    }
    return hit;
  };

  /**
   * The active vector spec per line, read once (request C01). A spec that
   * cannot be read leaves `vectorSpec` off the detail rather than failing it:
   * the field is optional and only labels the vector.
   */
  const specs = new Map<LineOfBusiness, Promise<VectorSpec | null>>();
  const activeSpec = (line: LineOfBusiness): Promise<VectorSpec | null> => {
    let hit = specs.get(line);
    if (hit === undefined) {
      hit = readVectorSpec(line).catch(() => {
        specs.delete(line);
        return null;
      });
      specs.set(line, hit);
    }
    return hit;
  };

  app.get(ROUTES.listSubmissions.path, (c) => {
    const parsed = queueQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      const body: ErrorDto = {
        error: {
          code: 'INVALID_REQUEST',
          message: 'invalid queue query',
          issues: parsed.error.issues.map((i) => ({
            path: i.path.map((p) => String(p)).join('.'),
            message: i.message,
          })),
        },
      };
      return c.json(body, 422);
    }
    const filters: QueueQueryDto = parsed.data;

    // Newest first, grouped per submission.
    const actionsBySubmission = new Map<string, ActionRow[]>();
    for (const action of repos.actions.list({}).rows) {
      const list = actionsBySubmission.get(action.submissionId) ?? [];
      list.push(action);
      actionsBySubmission.set(action.submissionId, list);
    }

    // Queue order (rank ascending, unranked last). Only scored rows have a place in it.
    const scored = repos.submissions
      .all()
      .filter((row): row is SubmissionRow & { result: EngineResult } => row.result != null);

    const rows: QueueRowDto[] = [];
    scored.forEach((row, position) => {
      const result = row.result;
      const actions = actionsBySubmission.get(row.id) ?? [];
      const queueRow = toQueueRow(row, result, row.rank ?? position + 1, actions);
      if (filters.line !== undefined && !lineMatches(filters.line, row, result)) return;
      if (filters.verdict !== undefined && queueRow.verdict !== filters.verdict) return;
      if (
        filters.state !== undefined &&
        (queueRow.primaryState ?? '').toUpperCase() !== filters.state.toUpperCase()
      ) {
        return;
      }
      if (
        filters.underwriterId !== undefined &&
        queueRow.assignedUnderwriter?.id !== filters.underwriterId
      ) {
        return;
      }
      rows.push(queueRow);
    });

    const limit = filters.limit ?? DEFAULT_PAGE_LIMIT;
    const offset = filters.offset ?? 0;
    const body: QueueResponseDto = {
      rows: rows.slice(offset, offset + limit),
      page: { total: rows.length, limit, offset },
      adapter: deps.adapter.kind,
      filters,
    };
    return c.json(body, 200);
  });

  app.get(ROUTES.getSubmission.path, async (c) => {
    const id = c.req.param('id') ?? '';
    // The console links by id; the external submission number is accepted too.
    const row = repos.submissions.byId(id) ?? repos.submissions.byExternalId(id);
    if (row === null) return c.json(errorBody('NOT_FOUND', `no submission "${id}"`), 404);
    const result = row.result;
    if (result === null || result === undefined) {
      return c.json(errorBody('NOT_SCORED', `submission "${id}" has no result yet`), 409);
    }

    const canonical = result.canonical ?? row.canonical;
    const actions = repos.actions.list({ submissionId: row.id }).rows;
    const vectorSpec = await activeSpec(result.vector.lineOfBusiness);
    const verdictOf = (peerId: string): Verdict | null =>
      (repos.submissions.byId(peerId) ?? repos.submissions.byExternalId(peerId))?.result?.verdict.verdict ?? null;
    const body: SubmissionDetailDto = {
      id: row.id,
      externalId: row.externalId,
      source: row.source,
      lineOfBusiness: row.lineOfBusiness,
      displayLineOfBusiness: displayLine(row, result),
      accountKind: accountKindOf(row, result),
      synthetic: isSynthetic(result),
      facts: factsOf(row),
      verification: accountVerification(perAccountOrNull(), row.externalId, result),
      insuredName: row.insuredName,
      rank: row.rank,
      result,
      rollup: result.rollup,
      vector: result.vector,
      price: result.price,
      flip: result.flip,
      voi: result.voi,
      peers: peersWithVerdicts(result, verdictOf),
      contradictions: result.contradictions,
      interpretations: result.interpretations,
      buildings: canonical == null ? [] : buildingRows(canonical, result),
      explanation: await cachedExplanation(row, result),
      queryTrace: row.queryTrace,
      fieldMap: result.canonical?.fieldMap ?? row.canonical?.fieldMap ?? null,
      enrichment: repos.enrichments.bySubmissionId(row.id).map(toEnrichmentCard),
      routing: latestRouting(actions),
      actions: actions.map((a) => toActionDto(a, row)),
      attachedSweep: await attachedSweep(deps, repos.sweeps.bySubmissionId(row.id)),
      shareSlug: row.shareSlug,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      ...(vectorSpec !== null ? { vectorSpec } : {}),
    };
    return c.json(body, 200);
  });
}
