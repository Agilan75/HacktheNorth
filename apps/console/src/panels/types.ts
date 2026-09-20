/**
 * FROZEN (W0-4) — the prop contract for every panel of PRD §10 (a)–(l) and for
 * the shared console views.
 *
 * Why these types are declared here and not imported from `@retrofit/contracts`:
 * W0-3 was still writing `packages/contracts/src/dto.ts` when this file was
 * frozen. Every shape below is a *structural subset* of the DTO the API returns,
 * derived from PRD §10, so the real DTO stays assignable to it. C01 types the
 * API client against `@retrofit/contracts` and passes those objects straight
 * into these props. See docs/contracts/requests/W0-4.md.
 *
 * House rule the panels inherit (PRD §10, §13): every number rendered must come
 * from one of these props. No panel recomputes a score, a premium or a tier, and
 * colour never carries meaning alone — a pill always carries its label text.
 */

import type { AccountVerificationDto, SubmissionFactsDto } from '@retrofit/contracts';

export type Verdict = 'FIT' | 'REFER' | 'DOES_NOT_FIT';
export type TierLabel = 'target' | 'acceptable' | 'not_acceptable' | 'refer';
export type Severity = 'HIGH' | 'MEDIUM' | 'LOW';
export type SourceKind = 'self_reported' | 'enrichment' | 'sweep' | 'answer';

/** A quotable citation into one of the Federato PDFs or a rulebook row. */
export interface CitationView {
  readonly document: string;
  readonly page?: number | null;
  readonly row?: string | null;
  readonly quote: string;
}

/** PRD §10 (b) — one of the eight appetite factors. */
export interface FactorRowView {
  readonly factorId: string;
  readonly label: string;
  readonly tier: TierLabel | null;
  readonly tierValue: number | null;
  readonly weight: number;
  readonly points: number;
  readonly known: boolean;
  readonly knockout: boolean;
  readonly ruleId: string | null;
  readonly citation: CitationView | null;
}

/** PRD §10 (a). */
export interface ExplanationView {
  readonly verdict: Verdict;
  readonly headline: string;
  readonly paragraphs: readonly string[];
  readonly recommendation: string;
  readonly decidingFactorId: string | null;
  readonly decidingRuleId: string | null;
  readonly confidence: number;
}

/** PRD §10 (c) — one query the Federato agent issued. */
export interface QueryTraceEntryView {
  readonly step: number;
  readonly phase: string;
  readonly resource: string;
  readonly purpose: string;
  readonly payload: unknown;
  readonly resultCount: number;
  readonly durationMs: number;
  readonly adapted: boolean;
  readonly note: string | null;
  /**
   * R3-2 (PRD §7.5 step 6): the reasoning half of the trace. Optional so a view
   * built before these fields existed still typechecks; absent renders nothing.
   */
  /** The path walked from `resource`, e.g. ['exposure_units', 'location']. */
  readonly path?: readonly string[];
  /** Why the planner chose this root resource and path. */
  readonly why?: string | null;
  /** The other roots it considered, and why each lost. */
  readonly alternativesRejected?: readonly QueryTraceAlternativeView[];
  /** The rules whose inputs this query fetches. */
  readonly requiredBy?: readonly QueryTraceNeedView[];
  /** The adaptation kind that produced this retry; null (never 'none') when there was none. */
  readonly adaptation?: string | null;
  /** The query's error message, kept apart from `note`. */
  readonly error?: string | null;
}

export interface QueryTraceAlternativeView {
  readonly rootResource: string;
  readonly path: readonly string[];
  readonly why: string;
}

export interface QueryTraceNeedView {
  readonly ruleId: string;
  readonly factor: string | null;
  readonly canonicalPath: string;
  readonly why: string;
}

/** PRD §10 (i) — discovered schema and the keys the field map could not place. */
export interface SchemaView {
  readonly resources: readonly {
    readonly name: string;
    readonly fieldCount: number;
    readonly mappedCount: number;
  }[];
  readonly mapped: readonly {
    readonly sourcePath: string;
    readonly canonicalPath: string;
    readonly method: string;
    readonly score: number;
  }[];
  readonly unmapped: readonly {
    readonly sourcePath: string;
    readonly sampleValue: string | null;
    readonly reason: string;
  }[];
}

/** PRD §10 (d) — pricing. */
export interface PricingFactorView {
  readonly label: string;
  readonly multiplier: number;
  readonly basis: string | null;
}

export interface PricingView {
  readonly quotedPremium: number | null;
  readonly predictedPremium: number | null;
  readonly adequacy: number | null;
  readonly expectedLoss: number | null;
  readonly ratePer100Tiv: number | null;
  readonly currency: 'USD';
  readonly factors: readonly PricingFactorView[];
  readonly notes: readonly string[];
  /**
   * R5-7 (PRD §6.7, §10 d): per-building rating — TIV/100 × base rate × each
   * multiplier = building premium. `factors` above then applies to their sum.
   * Optional so older views typecheck; absent renders no building table.
   */
  readonly buildings?: readonly PricingBuildingView[];
}

export interface PricingBuildingFactorView {
  readonly label: string;
  readonly multiplier: number;
  readonly input: string | null;
}

export interface PricingBuildingView {
  readonly buildingExternalId: string;
  readonly tiv: number;
  /** Premium per $100 of TIV before any multiplier. */
  readonly baseRate: number;
  readonly factors: readonly PricingBuildingFactorView[];
  readonly premium: number;
}

/** PRD §10 (d) — the five nearest accounts. */
export interface PeerRowView {
  readonly submissionId: string;
  readonly insuredName: string;
  readonly distance: number;
  readonly ratePer100Tiv: number | null;
  readonly annualLoss: number | null;
  readonly verdict: Verdict | null;
}

export interface PeerBenchmarkView {
  readonly peers: readonly PeerRowView[];
  readonly medianRatePer100Tiv: number | null;
  readonly meanAnnualLoss: number | null;
  readonly comparedComponentCount: number;
}

/** PRD §10 (e) — buildings and the rollup. */
export interface BuildingRowView {
  readonly id: string;
  readonly address: string | null;
  readonly state: string | null;
  readonly yearBuilt: number | null;
  readonly constructionType: string | null;
  readonly tiv: number | null;
  readonly sprinklered: boolean | null;
  readonly protectionClass: number | null;
  readonly flags: readonly string[];
}

export interface RollupView {
  readonly totalTiv: number | null;
  readonly buildingCount: number;
  readonly pctTivPre1990: number | null;
  readonly pctTivPost2010: number | null;
  readonly pctTivAcceptableConstruction: number | null;
  readonly primaryState: string | null;
  readonly fiveYearLoss: number | null;
}

/** PRD §10 (f). */
export interface ContradictionView {
  readonly id: string;
  readonly field: string;
  readonly severity: Severity;
  readonly status: string;
  readonly summary: string;
  readonly sides: readonly {
    readonly value: string;
    readonly source: SourceKind;
    readonly confidence: number;
  }[];
}

export interface InterpretationView {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly citation: CitationView | null;
}

/** PRD §10 (g) — the minimal flip. */
export interface FlipMoveView {
  readonly componentKey: string;
  readonly label: string;
  readonly from: number | null;
  readonly to: number;
  readonly humanText: string;
}

export interface FlipView {
  readonly available: boolean;
  readonly reason: string | null;
  readonly moves: readonly FlipMoveView[];
  readonly scoreBefore: number;
  readonly scoreAfter: number | null;
  readonly premiumBefore: number | null;
  readonly premiumAfter: number | null;
  readonly verdictAfter: Verdict | null;
  readonly distanceToAppetite: number | null;
}

/** PRD §10 (h) — the feature vector itself. */
export interface VectorComponentView {
  readonly index: number;
  readonly key: string;
  readonly label: string;
  readonly raw: number | null;
  readonly tier: number | null;
  readonly mask: 0 | 1;
  readonly scaled: number | null;
  readonly immovable: boolean;
  readonly appetiteFactor: boolean;
}

export interface VectorView {
  readonly lineOfBusiness: string;
  readonly specVersion: string;
  readonly components: readonly VectorComponentView[];
  readonly completeness: number;
}

/** PRD §10 (j) — one enrichment plugin's card. */
export interface EnrichmentCardView {
  readonly source: string;
  readonly title: string;
  readonly available: boolean;
  readonly unavailableReason: string | null;
  readonly fetchedAt: string | null;
  readonly rows: readonly { readonly label: string; readonly value: string }[];
}

/** PRD §10 (k) — routing, drafts, the reply box and the log. */
export interface RoutingView {
  readonly region: string | null;
  readonly underwriter: string | null;
  readonly authorityLimit: number | null;
  readonly withinAuthority: boolean | null;
  readonly rationale: string;
}

export interface RequestDraftView {
  readonly actionId: string;
  readonly status: string;
  readonly subject: string;
  readonly body: string;
  readonly requestedFields: readonly {
    readonly path: string;
    readonly label: string;
    /** Expected score swing in points; null when the engine ranked no VOI for it (R5-8). */
    readonly voi: number | null;
  }[];
}

export interface ExtractedFieldView {
  readonly path: string;
  readonly label: string;
  readonly value: string;
  readonly confidence: number;
  readonly accepted: boolean;
  readonly quote: string;
  readonly rejectedReason: string | null;
}

export interface ActionLogEntryView {
  readonly actionId: string;
  readonly submissionId: string;
  readonly insuredName: string;
  readonly type: string;
  readonly status: string;
  readonly createdAt: string;
  readonly beforeScore: number | null;
  readonly afterScore: number | null;
  readonly beforeRank: number | null;
  readonly afterRank: number | null;
  readonly beforeVerdict: Verdict | null;
  readonly afterVerdict: Verdict | null;
  /** Who or what acted: `code`, `gemini:<call>` or `underwriter`. */
  readonly actor?: string;
  /** The action's own words — for a decision, the underwriter's reason. */
  readonly note?: string | null;
  /** Set only on a `decision` action: what the underwriter chose. */
  readonly decision?: 'accept' | 'decline' | null;
}

export interface ReplyResultView {
  readonly fields: readonly ExtractedFieldView[];
  readonly before: ActionLogEntryView | null;
  readonly after: ActionLogEntryView | null;
}

/** PRD §10 (l) — the attached photo or sweep. */
export interface SweepView {
  readonly sweepId: string;
  readonly roomLabel: string | null;
  readonly stage: string;
  readonly coverage: number;
  readonly frameCount: number;
  readonly observations: readonly {
    readonly id: string;
    readonly label: string;
    readonly bearing: number | null;
    readonly confidence: number;
    readonly note: string | null;
  }[];
}

/** One row of the ranked queue (PRD §10 `/queue`). */
export interface QueueRowView {
  readonly submissionId: string;
  readonly rank: number;
  readonly qualityIndex: number;
  readonly verdict: Verdict;
  readonly insuredName: string;
  readonly lineOfBusiness: string;
  readonly primaryState: string | null;
  readonly appetiteScore: number;
  readonly quotedPremium: number | null;
  readonly predictedPremium: number | null;
  readonly adequacy: number | null;
  readonly completeness: number;
  readonly contradictionCount: number;
  readonly oneFlipFromFit: boolean;
  readonly assignedUnderwriter: string | null;
  /** Where the underwriter name came from: Retrofit routing, or Federato's own record. */
  readonly underwriterSource: 'routed' | 'federato' | null;
  /** Some values were hand-authored (synthetic backfill), not read from Federato. */
  readonly synthetic: boolean;
  readonly totalTiv: number | null;
  readonly pendingAction: string | null;
  readonly explanationLine: string;
  readonly outOfAppetiteLine: boolean;
  /**
   * R5-12: set when this row was not found in the live queue and had to be
   * synthesised from a narrower DTO (the aggregate's one-flip-away list,
   * which does not carry a rank, quality index or verdict). `rank`,
   * `qualityIndex` and `verdict` are then placeholders required by the type,
   * never the account's real value — a consumer must check this flag before
   * rendering them, rather than trust the numbers at face value.
   */
  readonly incomplete?: boolean;
}

/**
 * Which view an account page needs (FILL-backend D4, FILL-console): a fully
 * scored property account, a non-property line knocked out at triage, or a
 * property submission Federato holds no policy for.
 */
export type AccountKind = 'scored' | 'triage_knockout' | 'no_policy';

/** What Federato's own Submission record says (the DTO's `facts`, unchanged). */
export type SubmissionFactsView = SubmissionFactsDto;

/** The independent checks on one real property account (the DTO's `verification`, unchanged). */
export type AccountVerificationView = AccountVerificationDto;

/** The whole `/submissions/:id` payload, as the panels consume it. */
export interface SubmissionDetailView {
  readonly submissionId: string;
  readonly insuredName: string;
  /** The line the account is SCORED on (the vector spec key). Never displayed: see `displayLineOfBusiness`. */
  readonly lineOfBusiness: string;
  /** The line to show: Federato's own (`cyber`, ...) on a triage knockout, otherwise `lineOfBusiness`. */
  readonly displayLineOfBusiness: string;
  readonly accountKind: AccountKind;
  /** Some values were hand-authored (synthetic backfill), not read from Federato. */
  readonly synthetic: boolean;
  /** Null only when the API predates the facts (an older deploy); `facts.source` says whether they were read. */
  readonly facts: SubmissionFactsView | null;
  /** Non-null on the 38 real property accounts the verification covered. */
  readonly verification: AccountVerificationView | null;
  readonly verdict: Verdict;
  readonly appetiteScore: number;
  readonly completeness: number;
  readonly confidence: number;
  readonly explanation: ExplanationView;
  readonly factors: readonly FactorRowView[];
  readonly queryTrace: readonly QueryTraceEntryView[];
  readonly schema: SchemaView | null;
  readonly pricing: PricingView;
  readonly peers: PeerBenchmarkView;
  readonly buildings: readonly BuildingRowView[];
  readonly rollup: RollupView;
  readonly contradictions: readonly ContradictionView[];
  readonly interpretations: readonly InterpretationView[];
  readonly flip: FlipView;
  readonly vector: VectorView;
  readonly enrichment: readonly EnrichmentCardView[];
  readonly routing: RoutingView;
  readonly drafts: readonly RequestDraftView[];
  readonly actionLog: readonly ActionLogEntryView[];
  readonly sweep: SweepView | null;
}

/* ---------- per-panel props (PRD §10 a–l) ---------- */

/** (a) */
export interface ExplanationPanelProps {
  readonly explanation: ExplanationView;
  readonly verdict: Verdict;
  readonly appetiteScore: number;
}

/** (b) */
export interface ScoreBreakdownPanelProps {
  readonly factors: readonly FactorRowView[];
  readonly appetiteScore: number;
  readonly completeness: number;
}

/** (c) */
export interface QueryTracePanelProps {
  readonly entries: readonly QueryTraceEntryView[];
}

/** (i) */
export interface SchemaPanelProps {
  readonly schema: SchemaView | null;
}

/** (d) */
export interface PricingPanelProps {
  readonly pricing: PricingView;
}

/** (d) */
export interface PeerBenchmarkPanelProps {
  readonly benchmark: PeerBenchmarkView;
}

/** (e) */
export interface BuildingsPanelProps {
  readonly buildings: readonly BuildingRowView[];
  readonly rollup: RollupView;
}

/** (f) */
export interface ContradictionsPanelProps {
  readonly contradictions: readonly ContradictionView[];
  readonly interpretations: readonly InterpretationView[];
}

/** (g) */
export interface FlipPanelProps {
  readonly flip: FlipView;
}

/** (h) */
export interface VectorPanelProps {
  readonly vector: VectorView;
}

/** (j) */
export interface EnrichmentPanelProps {
  readonly cards: readonly EnrichmentCardView[];
}

/** (k) */
export interface ActionsPanelProps {
  readonly submissionId: string;
  readonly routing: RoutingView;
  readonly drafts: readonly RequestDraftView[];
  readonly log: readonly ActionLogEntryView[];
  readonly onApprove: (actionId: string) => void | Promise<void>;
  /**
   * The engine's verdict for this account, so the decision block can name it.
   * Passed in rather than derived from the log, because the block must say what
   * the engine concluded even before any decision exists.
   */
  readonly engineVerdict?: Verdict;
  /**
   * Record an accept or decline beside the engine's verdict. Optional so a
   * caller that only reads an account still typechecks; the panel shows the
   * recorded decision either way and only offers the buttons when it is given.
   */
  readonly onDecide?: (decision: 'accept' | 'decline', reason: string) => void | Promise<void>;
}

/** (k) — the paste-or-upload box. */
export interface ReplyBoxProps {
  readonly submissionId: string;
  readonly result: ReplyResultView | null;
  readonly pending: boolean;
  readonly onSubmitText: (text: string) => void | Promise<void>;
  readonly onSubmitFile: (file: File) => void | Promise<void>;
}

/** (l) */
export interface AttachedSweepPanelProps {
  readonly sweep: SweepView | null;
}
