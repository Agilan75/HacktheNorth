import type {
  ActionDto,
  ActionsPlanResponseDto,
  ActionsResponseDto,
  AggregateDto,
  ApproveActionResponseDto,
  ErrorDto,
  GlossaryResponseDto,
  HealthDto,
  QueryTraceEntryDto,
  QueueResponseDto,
  QueueRowDto,
  ReplyRequestDto,
  ReplyResponseDto,
  RouteId,
  RulesResponseDto,
  ScoreSnapshotDto,
  SubmissionDetailDto,
  SweepDto,
  VerificationDto,
} from '@retrofit/contracts';
import { MAX_PAGE_LIMIT, ROUTES, routePath, titleCase, withQuery } from '@retrofit/contracts';

import type {
  AccountKind,
  ActionLogEntryView,
  BuildingRowView,
  CitationView,
  ContradictionView,
  EnrichmentCardView,
  ExplanationView,
  ExtractedFieldView,
  FactorRowView,
  FlipView,
  PeerBenchmarkView,
  PricingView,
  QueryTraceEntryView,
  QueueRowView,
  ReplyResultView,
  RequestDraftView,
  RoutingView,
  SchemaView,
  SourceKind,
  SubmissionDetailView,
  SweepView,
  TierLabel,
  Verdict,
  VectorComponentView,
  VectorView,
} from '../panels/types.js';

/** Base URL for the API. Vite env, never a secret (PRD §5 constraints). */
export interface ApiClientOptions {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
}

export interface HealthResponse {
  readonly ok: boolean;
  readonly adapter: 'live' | 'snapshot';
  readonly version: string;
}

export interface AggregateResponse {
  readonly countsByVerdict: Readonly<Record<string, number>>;
  readonly scoreHistogram: readonly { readonly bucket: string; readonly count: number }[];
  readonly topKnockoutFactors: readonly {
    readonly factorId: string;
    /** The guideline's own label, from `AggregateDto` (C14). */
    readonly label?: string;
    readonly count: number;
  }[];
  readonly oneFlipAway: readonly QueueRowView[];
  readonly bookAdequacy: number | null;
  readonly verification: Readonly<Record<string, number | string | null>>;
  /** `AggregateDto.counts` without `byVerdict` (that is `countsByVerdict`). C14. */
  readonly counts?: {
    readonly total: number;
    readonly scored: number;
    readonly knockedOut: number;
    readonly byLine: Readonly<Record<string, number>>;
  };
  /** `AggregateDto.bookAdequacy` in full: median, underpriced count and n. C14. */
  readonly bookAdequacyDetail?: {
    readonly median: number | null;
    readonly underpricedCount: number;
    readonly n: number;
  };
  /** The engine's single flip move per one-flip submission id, kept when a queue row replaces it. C14. */
  readonly oneFlipMoves?: Readonly<
    Record<string, { readonly moveLabel: string; readonly scoreAfter: number; readonly premiumAfter: number | null }>
  >;
}

export interface RulesResponse {
  readonly rulebooks: readonly unknown[];
}

export interface GlossaryResponse {
  readonly entries: readonly { readonly term: string; readonly definition: string; readonly source: string }[];
}

export interface ApiClient {
  health(): Promise<HealthResponse>;
  getQueue(): Promise<readonly QueueRowView[]>;
  getSubmission(id: string): Promise<SubmissionDetailView>;
  runSubmission(id: string): Promise<SubmissionDetailView>;
  enrich(id: string): Promise<SubmissionDetailView>;
  planActions(): Promise<readonly ActionLogEntryView[]>;
  getActions(): Promise<readonly ActionLogEntryView[]>;
  approveAction(actionId: string): Promise<ActionLogEntryView>;
  postReply(id: string, input: { readonly text?: string; readonly file?: File }): Promise<ReplyResultView>;
  getAggregate(): Promise<AggregateResponse>;
  getRules(): Promise<RulesResponse>;
  getGlossary(): Promise<GlossaryResponse>;
  /** GET /verification, returned as the API sent it: the page formats, never recomputes. */
  getVerification(): Promise<VerificationDto>;
}

/* -------------------------------------------------------------------------- */
/* Transport                                                                  */
/* -------------------------------------------------------------------------- */

/** Thrown for every non-2xx answer. Carries the API's `ErrorDto` code. */
class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

function isErrorDto(value: unknown): value is ErrorDto {
  if (typeof value !== 'object' || value === null) return false;
  const error = (value as { error?: unknown }).error;
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { message?: unknown }).message === 'string'
  );
}

type Transport = <T>(route: RouteId, params?: Readonly<Record<string, string>>, init?: {
  readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
  readonly body?: unknown;
}) => Promise<T>;

function makeTransport(options: ApiClientOptions): Transport {
  const base = options.baseUrl.replace(/\/+$/, '');
  const doFetch: typeof fetch = options.fetchImpl ?? ((...args) => globalThis.fetch(...args));

  return async <T>(
    route: RouteId,
    params: Readonly<Record<string, string>> = {},
    init: {
      readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
      readonly body?: unknown;
    } = {},
  ): Promise<T> => {
    const def = ROUTES[route];
    const url = `${base}${withQuery(routePath(route, params), init.query)}`;
    const headers: Record<string, string> = { accept: 'application/json' };
    const requestInit: RequestInit = { method: def.method, headers };
    if (def.method === 'POST') {
      headers['content-type'] = 'application/json';
      requestInit.body = JSON.stringify(init.body ?? {});
    }

    let response: Response;
    try {
      response = await doFetch(url, requestInit);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new ApiError(0, 'NETWORK', `${def.method} ${def.path}: API unreachable (${reason})`);
    }

    const text = await response.text();
    let json: unknown = null;
    if (text.length > 0) {
      try {
        json = JSON.parse(text);
      } catch {
        throw new ApiError(
          response.status,
          'BAD_JSON',
          `${def.method} ${def.path}: response was not JSON (HTTP ${response.status})`,
        );
      }
    }

    if (!response.ok) {
      if (isErrorDto(json)) {
        throw new ApiError(response.status, json.error.code, json.error.message);
      }
      throw new ApiError(response.status, `HTTP_${response.status}`, `${def.method} ${def.path}: HTTP ${response.status}`);
    }
    return json as T;
  };
}

/* -------------------------------------------------------------------------- */
/* DTO -> view mapping. Pure reshaping: no score, premium or tier is computed.  */
/* -------------------------------------------------------------------------- */

type Result = SubmissionDetailDto['result'];
type EngineCitation = NonNullable<Result['verdict']['decidingRule']>['citation'];
type EngineContradiction = SubmissionDetailDto['contradictions'][number];
type EngineInterpretation = SubmissionDetailDto['interpretations'][number];
type ExtractedValue = ReplyResponseDto['extracted'][number];

/** INTERPRETATIONS V-7 source-confidence table, used only when a field carries none. */
const SOURCE_CONFIDENCE: Readonly<Record<string, number>> = {
  self_reported: 0.7,
  enrichment: 0.9,
  answer: 0.8,
};

const RECOMMENDATION_TEXT: Readonly<Record<string, string>> = {
  accept: 'Accept: quote within appetite.',
  review: 'Review: an underwriter should look before quoting.',
  decline: 'Decline: outside appetite.',
  investigate: 'Investigate: request the missing or conflicting information first.',
};

const TIER_LABELS: ReadonlySet<string> = new Set(['target', 'acceptable', 'not_acceptable', 'refer']);

function tierLabel(tier: string | null): TierLabel | null {
  return tier !== null && TIER_LABELS.has(tier) ? (tier as TierLabel) : null;
}

function valueText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function citationView(citation: EngineCitation | null | undefined): CitationView | null {
  if (!citation) return null;
  const pageMatch = /\bp\.?\s*(\d+)\b/i.exec(citation.section);
  return {
    document: citation.doc,
    page: pageMatch?.[1] !== undefined ? Number(pageMatch[1]) : null,
    row: citation.section,
    quote: citation.quote,
  };
}

function lastSegment(path: string): string {
  const parts = path.split('.');
  return parts[parts.length - 1] ?? path;
}

function pendingActionText(pending: QueueRowDto['pendingAction']): string | null {
  return pending === null ? null : `${titleCase(pending.type)} (${pending.status})`;
}

function queueRowView(row: QueueRowDto): QueueRowView {
  return {
    submissionId: row.id,
    rank: row.rank,
    qualityIndex: row.qualityIndex,
    verdict: row.verdict,
    insuredName: row.insuredName ?? row.externalId,
    lineOfBusiness: row.lineOfBusiness,
    primaryState: row.primaryState,
    appetiteScore: row.appetiteScore,
    quotedPremium: row.quotedPremium,
    predictedPremium: row.predictedPremium,
    adequacy: row.adequacy,
    completeness: row.completeness,
    contradictionCount: row.contradictionCount,
    oneFlipFromFit: row.oneFlipFromFit,
    assignedUnderwriter: row.assignedUnderwriter?.name ?? null,
    pendingAction: pendingActionText(row.pendingAction),
    explanationLine: row.explanation ?? '',
    outOfAppetiteLine: row.outOfAppetiteLine,
  };
}

function explanationView(dto: SubmissionDetailDto): ExplanationView {
  const result = dto.result;
  const verdict = result.verdict;
  const deciding = verdict.decidingRule;
  const base = {
    verdict: verdict.verdict,
    decidingFactorId: deciding?.factor ?? null,
    decidingRuleId: deciding?.ruleId ?? null,
    confidence: result.evaluate.confidence,
  };
  const explanation = dto.explanation;
  if (explanation !== null) {
    const sentences = explanation.sentences.length > 0 ? explanation.sentences : [explanation.text];
    return {
      ...base,
      headline: sentences[0] ?? '',
      paragraphs: sentences.slice(1),
      recommendation: RECOMMENDATION_TEXT[explanation.recommendation] ?? titleCase(explanation.recommendation),
    };
  }
  const reasons = verdict.reasons;
  const paragraphs = reasons.length > 1 ? reasons.slice(1) : result.explanation ? [result.explanation] : [];
  return {
    ...base,
    headline: reasons[0] ?? result.explanation ?? '',
    paragraphs,
    recommendation: '',
  };
}

function factorRows(result: Result): FactorRowView[] {
  return result.evaluate.factors.map((f) => ({
    factorId: f.factor,
    label: titleCase(f.factor),
    tier: tierLabel(f.tier),
    tierValue: f.tierValue,
    weight: f.weight,
    points: f.points,
    known: f.known,
    knockout: f.knockout,
    ruleId: f.ruleId,
    citation: citationView(f.citation),
  }));
}

function queryTraceView(entries: readonly QueryTraceEntryDto[]): QueryTraceEntryView[] {
  return entries.map((e) => {
    // R3-2: `adaptation` is the literal 'none' on every un-adapted entry; it maps to
    // null. The adaptation and the error each get their own field, so `note` holds
    // only the planner's free-text notes.
    const adaptation = e.adaptation === 'none' || e.adaptation === '' ? null : e.adaptation;
    const noteParts = e.notes.filter((s) => s.length > 0);
    const view: QueryTraceEntryView = {
      step: e.seq,
      phase: e.pass,
      resource: e.pathChosen.rootResource,
      purpose: e.goal,
      payload: e.payload,
      resultCount: e.rowCount,
      durationMs: e.durationMs,
      adapted: e.adaptedFrom !== null,
      note: noteParts.length > 0 ? noteParts.join(' · ') : null,
      // R3-2 (PRD §7.5 step 6): the reasoning half of the trace, rendered by QueryTrace.tsx.
      path: e.pathChosen.path,
      why: e.pathChosen.why,
      alternativesRejected: e.pathChosen.alternativesRejected,
      requiredBy: e.requiredBy,
      adaptation,
      error: e.error?.message ?? null,
    };
    return view;
  });
}

function schemaView(fieldMap: SubmissionDetailDto['fieldMap']): SchemaView | null {
  if (fieldMap === null) return null;
  const resources = new Map<string, { fieldCount: number; mappedCount: number }>();
  const bump = (rawPath: string, mapped: boolean): void => {
    const name = rawPath.split('.')[0] ?? rawPath;
    const entry = resources.get(name) ?? { fieldCount: 0, mappedCount: 0 };
    entry.fieldCount += 1;
    if (mapped) entry.mappedCount += 1;
    resources.set(name, entry);
  };
  for (const e of fieldMap.entries) bump(e.rawPath, true);
  for (const u of fieldMap.unmapped) bump(u.rawPath, false);
  return {
    resources: [...resources.entries()].map(([name, c]) => ({ name, ...c })),
    mapped: fieldMap.entries.map((e) => ({
      sourcePath: e.rawPath,
      canonicalPath: e.canonicalPath,
      method: e.method,
      score: e.confidence,
    })),
    unmapped: fieldMap.unmapped.map((u) => ({
      sourcePath: u.rawPath,
      sampleValue: u.sampleValues.length > 0 ? valueText(u.sampleValues[0]) : null,
      reason: u.reason,
    })),
  };
}

function pricingView(price: SubmissionDetailDto['price']): PricingView {
  const notes: string[] = [];
  notes.push(price.basis === 'fitted' ? 'Rates fitted to the book.' : 'Rates from the rating table.');
  if (price.fitError) {
    notes.push(`Fit error: MAPE ${price.fitError.mape}, R² ${price.fitError.r2}, n = ${price.fitError.n}.`);
  }
  if (price.estimate) notes.push('Estimate: no loss data behind this number.');
  if (price.termMonths !== null) notes.push(`Term: ${price.termMonths} months.`);
  if (price.expectedLossDetail) {
    const d = price.expectedLossDetail;
    notes.push(`Loss credibility ${d.credibility} (n = ${d.n}, k = ${d.k}).`);
  }
  const view: PricingView = {
    quotedPremium: price.quotedPremium,
    predictedPremium: price.predictedPremium,
    adequacy: price.adequacy,
    expectedLoss: price.expectedAnnualLoss,
    ratePer100Tiv: price.ratePer100,
    currency: 'USD' as const,
    factors: price.factors.map((f) => ({ label: f.name, multiplier: f.factor, basis: f.input || null })),
    // R5-7 (PRD §6.7, §10 d): the per-building rating steps (TIV/100 × base rate ×
    // four multipliers = premium) that the account-level factors multiply. Kept
    // per building, never merged into `factors`. Rendered by Pricing.tsx.
    buildings: price.perBuilding.map((b) => ({
      buildingExternalId: b.buildingExternalId,
      tiv: b.tiv,
      baseRate: b.baseRate,
      factors: b.factors.map((f) => ({ label: f.name, multiplier: f.factor, input: f.input || null })),
      premium: b.premium,
    })),
    notes,
  };
  return view;
}

function peerView(peers: SubmissionDetailDto['peers']): PeerBenchmarkView {
  if (peers === null) {
    return { peers: [], medianRatePer100Tiv: null, meanAnnualLoss: null, comparedComponentCount: 0 };
  }
  return {
    peers: peers.peers.map((p) => ({
      submissionId: p.id,
      insuredName: p.label ?? p.id,
      distance: p.distance,
      ratePer100Tiv: p.ratePer100,
      annualLoss: p.annualLoss,
      // FILL-backend D8: the peer's own stored verdict; null = that peer has no stored result.
      // `?? null` also covers an older API that sent no verdict at all.
      verdict: p.verdict ?? null,
    })),
    medianRatePer100Tiv: peers.medianRatePer100,
    meanAnnualLoss: peers.meanAnnualLoss,
    comparedComponentCount: peers.componentsUsed.length,
  };
}

function buildingRows(dto: SubmissionDetailDto): BuildingRowView[] {
  return dto.buildings.map((b) => {
    const flags: string[] = [];
    if (b.pre1990) flags.push('pre-1990');
    if (b.post2010) flags.push('2010 or later');
    if (!b.acceptableConstruction) flags.push('unacceptable construction');
    if (b.assumedAcceptableConstruction) flags.push('construction assumed acceptable');
    const address = [b.name, b.city].filter((s): s is string => typeof s === 'string' && s.length > 0);
    return {
      id: b.externalId,
      address: address.length > 0 ? address.join(', ') : null,
      state: b.state,
      yearBuilt: b.yearBuilt,
      constructionType: b.constructionType,
      tiv: b.tiv,
      sprinklered: b.sprinklered,
      protectionClass: b.protectionClass,
      flags,
    };
  });
}

function sideSource(source: string): SourceKind {
  return source === 'enrichment' || source === 'sweep' || source === 'answer' ? source : 'self_reported';
}

function contradictionView(c: EngineContradiction): ContradictionView {
  return {
    id: c.id,
    field: c.canonicalPath,
    severity: c.severity,
    status: c.status,
    summary: c.note ?? `${c.values.length} competing values for ${c.canonicalPath}`,
    sides: c.values.map((v) => ({
      value: valueText(v.value),
      source: sideSource(v.provenance.source),
      confidence: v.provenance.confidence ?? SOURCE_CONFIDENCE[v.provenance.source] ?? 0,
    })),
  };
}

function interpretationView(i: EngineInterpretation) {
  return { id: i.id, title: i.title, text: i.decision, citation: citationView(i.citation) };
}

function flipView(result: Result): FlipView {
  const f = result.flip.flip;
  const distance = result.verdict.distanceToAppetite;
  if (f === null) {
    return {
      available: false,
      reason: result.flip.reason,
      moves: [],
      scoreBefore: result.evaluate.appetiteScore,
      scoreAfter: null,
      premiumBefore: result.price.predictedPremium,
      premiumAfter: null,
      verdictAfter: null,
      distanceToAppetite: distance,
    };
  }
  return {
    available: true,
    reason: result.flip.reason,
    moves: f.moves.map((m) => ({
      componentKey: m.componentKey,
      label: m.label,
      from: m.from,
      to: m.to,
      humanText: m.fixHint ?? m.label,
    })),
    scoreBefore: f.scoreBefore,
    scoreAfter: f.scoreAfter,
    premiumBefore: f.premiumBefore,
    premiumAfter: f.premiumAfter,
    verdictAfter: f.verdictAfter,
    distanceToAppetite: distance,
  };
}

/**
 * Labels come only from the spec the API sends (`dto.vectorSpec`, request C01).
 * A spec for another line is ignored; without one, flip moves or a generic
 * `Component i` label the row.
 */
function vectorView(result: Result, vectorSpec: SubmissionDetailDto['vectorSpec']): VectorView {
  const v = result.vector;
  const spec = vectorSpec !== undefined && vectorSpec.lineOfBusiness === v.lineOfBusiness ? vectorSpec.components : [];
  const flipKeys = new Map<number, { key: string; label: string }>();
  for (const m of result.flip.flip?.moves ?? []) {
    flipKeys.set(m.componentIndex, { key: m.componentKey, label: m.label });
  }
  const components: VectorComponentView[] = v.m.map((mask, index) => {
    const row = spec[index];
    const fromFlip = flipKeys.get(index);
    return {
      index,
      key: row?.key ?? fromFlip?.key ?? `c${index}`,
      label: row?.label ?? fromFlip?.label ?? `Component ${index}`,
      raw: v.x[index] ?? null,
      tier: v.t[index] ?? null,
      mask,
      scaled: null,
      immovable: row?.immovable ?? false,
      appetiteFactor: row?.appetiteFactor ?? false,
    };
  });
  return {
    lineOfBusiness: v.lineOfBusiness,
    specVersion: v.specVersion,
    components,
    completeness: result.evaluate.completeness,
  };
}

function enrichmentView(cards: SubmissionDetailDto['enrichment']): EnrichmentCardView[] {
  return cards.map((c) => ({
    source: c.source,
    title: c.title,
    available: c.available,
    unavailableReason: c.unavailableReason,
    fetchedAt: c.fetchedAt,
    rows: c.fields.map((f) => ({ label: f.label, value: f.valueText })),
  }));
}

function routingView(routing: SubmissionDetailDto['routing']): RoutingView {
  if (routing === null) {
    return {
      region: null,
      underwriter: null,
      authorityLimit: null,
      withinAuthority: null,
      rationale: 'Not routed yet. Run the action plan to assign an underwriter.',
    };
  }
  const assigned = routing.assigned;
  return {
    region: assigned?.region ?? null,
    underwriter: assigned?.name ?? null,
    authorityLimit: assigned?.authorityLimit ?? null,
    withinAuthority: assigned === null ? null : !routing.needsSeniorReferral,
    rationale: routing.reason,
  };
}

function draftViews(dto: SubmissionDetailDto): RequestDraftView[] {
  const swing = new Map<string, number>();
  for (const c of dto.result.voi.ranked) swing.set(c.question.field, c.expectedScoreSwing);
  const name = dto.insuredName ?? dto.externalId;
  return dto.actions
    .filter((a) => a.type === 'request')
    .map((a) => ({
      actionId: a.id,
      status: a.status,
      subject: `Information request: ${name}`,
      body: a.draft ?? '',
      requestedFields: a.fields.map((f) => ({
        path: f.canonicalPath,
        label: f.label,
        // R5-8: no ranked VOI entry means the DTO has no number; never invent a 0.
        voi: swing.get(f.canonicalPath) ?? (f.componentKey !== null ? swing.get(f.componentKey) : undefined) ?? null,
      })),
    }));
}

function actionLogEntry(
  a: ActionDto,
  before: ScoreSnapshotDto | null = a.before,
  after: ScoreSnapshotDto | null = a.after,
  rankBefore: number | null = a.rankBefore,
  rankAfter: number | null = a.rankAfter,
): ActionLogEntryView {
  return {
    actionId: a.id,
    submissionId: a.submissionId,
    insuredName: a.insuredName ?? a.externalId ?? a.submissionId,
    type: a.type,
    status: a.status,
    createdAt: a.createdAt,
    beforeScore: before?.appetiteScore ?? null,
    afterScore: after?.appetiteScore ?? null,
    beforeRank: rankBefore ?? before?.rank ?? null,
    afterRank: rankAfter ?? after?.rank ?? null,
    beforeVerdict: before?.verdict ?? null,
    afterVerdict: after?.verdict ?? null,
  };
}

function sweepView(sweep: SweepDto | null): SweepView | null {
  if (sweep === null) return null;
  return {
    sweepId: sweep.id,
    roomLabel: sweep.roomLabel,
    stage: sweep.stage,
    /** 0..100, the engine's `coveragePct`, unconverted (docs/decisions/C01.md). */
    coverage: sweep.coverage?.coveragePct ?? 0,
    frameCount: sweep.frames.length,
    observations: sweep.observations.map((o) => ({
      id: o.id,
      label: titleCase(o.label),
      bearing: o.bearingDeg,
      confidence: o.confidence,
      note: o.notes ?? null,
    })),
  };
}

const ACCOUNT_KINDS: ReadonlySet<string> = new Set(['scored', 'triage_knockout', 'no_policy']);

/**
 * The API's own classification. An API deployed before FILL-backend sends no
 * `accountKind`; the page then keeps the full twelve-panel view rather than
 * guessing a kind the API never stated (FILL-console D2).
 */
function accountKindOf(dto: SubmissionDetailDto): AccountKind {
  const kind = (dto as Partial<SubmissionDetailDto>).accountKind;
  return typeof kind === 'string' && ACCOUNT_KINDS.has(kind) ? kind : 'scored';
}

function submissionView(dto: SubmissionDetailDto): SubmissionDetailView {
  const result = dto.result;
  const partial = dto as Partial<SubmissionDetailDto>;
  return {
    submissionId: dto.id,
    insuredName: dto.insuredName ?? partial.facts?.insuredName ?? dto.externalId,
    lineOfBusiness: dto.lineOfBusiness,
    displayLineOfBusiness: partial.displayLineOfBusiness ?? dto.lineOfBusiness,
    accountKind: accountKindOf(dto),
    facts: partial.facts ?? null,
    verification: partial.verification ?? null,
    verdict: result.verdict.verdict,
    appetiteScore: result.evaluate.appetiteScore,
    completeness: result.evaluate.completeness,
    confidence: result.evaluate.confidence,
    explanation: explanationView(dto),
    factors: factorRows(result),
    queryTrace: queryTraceView(dto.queryTrace),
    schema: schemaView(dto.fieldMap),
    pricing: pricingView(dto.price),
    peers: peerView(dto.peers),
    buildings: buildingRows(dto),
    rollup: {
      totalTiv: dto.rollup.totalTiv,
      buildingCount: dto.rollup.buildingCount,
      pctTivPre1990: dto.rollup.pctTivPre1990,
      pctTivPost2010: dto.rollup.pctTivPost2010,
      pctTivAcceptableConstruction: dto.rollup.pctTivAcceptableConstruction,
      primaryState: dto.rollup.primaryState,
      fiveYearLoss: dto.rollup.fiveYearLoss,
    },
    contradictions: dto.contradictions.map(contradictionView),
    interpretations: dto.interpretations.map(interpretationView),
    flip: flipView(result),
    vector: vectorView(result, dto.vectorSpec),
    enrichment: enrichmentView(dto.enrichment),
    routing: routingView(dto.routing),
    drafts: draftViews(dto),
    actionLog: dto.actions.map((a) => actionLogEntry(a)),
    sweep: sweepView(dto.attachedSweep),
  };
}

function extractedFieldView(e: ExtractedValue): ExtractedFieldView {
  return {
    path: e.canonicalPath,
    label: titleCase(lastSegment(e.canonicalPath)),
    value: valueText(e.value),
    confidence: e.confidence,
    accepted: e.accepted,
    quote: e.quote,
    rejectedReason: e.rejection,
  };
}

function replyView(dto: ReplyResponseDto): ReplyResultView {
  return {
    fields: dto.extracted.map(extractedFieldView),
    before: actionLogEntry(dto.action, dto.before, null, dto.rankBefore, null),
    after: actionLogEntry(dto.action, null, dto.after, null, dto.rankAfter),
  };
}

function histogramBucket(index: number, total: number): string {
  const lo = index * 10;
  const hi = index === total - 1 ? 100 : lo + 9;
  return `${lo}–${hi}`;
}

function verificationRecord(v: AggregateDto['verification']): Record<string, number | string | null> {
  if (v === null) return {};
  return {
    propertyCasesRun: v.propertyCasesRun,
    differentialCasesRun: v.differentialCasesRun,
    disagreements: v.disagreements,
    llmCasesRun: v.llmCasesRun,
    llmAgreementRate: v.llmAgreementRate,
    llmAgreementCi95: v.llmAgreementCi95 === null ? null : `${v.llmAgreementCi95[0]}–${v.llmAgreementCi95[1]}`,
    extractionFieldAccuracy: v.extractionFieldAccuracy,
    generatedAt: v.generatedAt,
  };
}

function aggregateView(dto: AggregateDto, queue: readonly QueueRowView[]): AggregateResponse {
  const byId = new Map(queue.map((r) => [r.submissionId, r]));
  const oneFlipAway = dto.oneFlipAway.map((o): QueueRowView => {
    const row = byId.get(o.id);
    if (row) return row;
    return {
      submissionId: o.id,
      rank: 0,
      qualityIndex: 0,
      verdict: 'REFER' as Verdict,
      insuredName: o.insuredName ?? o.externalId,
      lineOfBusiness: 'commercial_property',
      primaryState: null,
      appetiteScore: o.appetiteScore,
      quotedPremium: null,
      predictedPremium: o.premiumAfter,
      adequacy: null,
      completeness: 0,
      contradictionCount: 0,
      oneFlipFromFit: true,
      assignedUnderwriter: null,
      pendingAction: null,
      explanationLine: o.moveLabel,
      outOfAppetiteLine: false,
    };
  });
  return {
    countsByVerdict: { ...dto.counts.byVerdict },
    scoreHistogram: dto.scoreHistogram.map((count, i) => ({
      bucket: histogramBucket(i, dto.scoreHistogram.length),
      count,
    })),
    topKnockoutFactors: dto.topKnockoutFactors.map((f) => ({ factorId: f.factor, label: f.label, count: f.count })),
    oneFlipAway,
    bookAdequacy: dto.bookAdequacy.median,
    verification: verificationRecord(dto.verification),
    counts: {
      total: dto.counts.total,
      scored: dto.counts.scored,
      knockedOut: dto.counts.knockedOut,
      byLine: { ...dto.counts.byLine },
    },
    bookAdequacyDetail: {
      median: dto.bookAdequacy.median,
      underpricedCount: dto.bookAdequacy.underpricedCount,
      n: dto.bookAdequacy.n,
    },
    oneFlipMoves: Object.fromEntries(
      dto.oneFlipAway.map((o) => [o.id, { moveLabel: o.moveLabel, scoreAfter: o.scoreAfter, premiumAfter: o.premiumAfter }]),
    ),
  };
}

async function fileToBase64(file: File): Promise<string> {
  const buffer =
    typeof file.arrayBuffer === 'function'
      ? await file.arrayBuffer()
      : await new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.onerror = () => reject(reader.error ?? new Error('could not read file'));
          reader.readAsArrayBuffer(file);
        });
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/* -------------------------------------------------------------------------- */
/* The client                                                                 */
/* -------------------------------------------------------------------------- */

export function createApiClient(options: ApiClientOptions): ApiClient {
  const call = makeTransport(options);

  const getQueue = async (): Promise<readonly QueueRowView[]> => {
    const rows: QueueRowDto[] = [];
    let offset = 0;
    for (;;) {
      const page = await call<QueueResponseDto>('listSubmissions', {}, {
        query: { limit: MAX_PAGE_LIMIT, offset },
      });
      rows.push(...page.rows);
      offset += page.rows.length;
      if (page.rows.length === 0 || offset >= page.page.total) break;
    }
    return rows.map(queueRowView);
  };

  const getSubmission = async (id: string): Promise<SubmissionDetailView> =>
    submissionView(await call<SubmissionDetailDto>('getSubmission', { id }));

  const getActions = async (): Promise<readonly ActionLogEntryView[]> => {
    const actions: ActionDto[] = [];
    let offset = 0;
    for (;;) {
      const page = await call<ActionsResponseDto>('listActions', {}, {
        query: { limit: MAX_PAGE_LIMIT, offset },
      });
      actions.push(...page.actions);
      offset += page.actions.length;
      if (page.actions.length === 0 || offset >= page.page.total) break;
    }
    return actions.map((a) => actionLogEntry(a));
  };

  return {
    async health() {
      const dto = await call<HealthDto>('health');
      return { ok: dto.ok, adapter: dto.adapter === 'live' ? 'live' : 'snapshot', version: dto.version };
    },
    getQueue,
    getSubmission,
    async runSubmission(id) {
      await call('runSubmission', { id });
      return getSubmission(id);
    },
    async enrich(id) {
      await call('enrichSubmission', { id });
      return getSubmission(id);
    },
    async planActions() {
      const dto = await call<ActionsPlanResponseDto>('planActions', {}, { body: {} });
      return dto.actions.map((a) => actionLogEntry(a));
    },
    getActions,
    async approveAction(actionId) {
      const dto = await call<ApproveActionResponseDto>('approveAction', { id: actionId });
      return actionLogEntry(dto.action);
    },
    async postReply(id, input) {
      let body: ReplyRequestDto;
      if (input.file) {
        body = { pdfBase64: await fileToBase64(input.file), filename: input.file.name };
      } else if (typeof input.text === 'string' && input.text.trim().length > 0) {
        body = { text: input.text };
      } else {
        throw new Error('postReply: provide either reply text or a file');
      }
      return replyView(await call<ReplyResponseDto>('replyToSubmission', { id }, { body }));
    },
    async getAggregate() {
      // The queue only enriches the one-flip list; its failure must not hide the aggregate.
      const [dto, queue] = await Promise.all([
        call<AggregateDto>('aggregate'),
        getQueue().catch((): readonly QueueRowView[] => []),
      ]);
      return aggregateView(dto, queue);
    },
    async getRules() {
      const dto = await call<RulesResponseDto>('rules');
      return { rulebooks: dto.rulebooks };
    },
    async getVerification() {
      return call<VerificationDto>('verification');
    },
    async getGlossary() {
      const dto = await call<GlossaryResponseDto>('glossary');
      return {
        entries: dto.entries.map((e) => ({
          term: e.term,
          definition: e.definition,
          source: `${dto.doc}, p. ${e.page}`,
        })),
      };
    },
  };
}
