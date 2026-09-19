/**
 * `@retrofit/federato` — the contract types. FROZEN after Run 0 (W0-3).
 *
 * Nothing in this file has a body. Run 1 units F01–F13 fill the modules that
 * import it; they never edit it. If a Run 1 unit needs a shape that is not here,
 * it writes `docs/contracts/requests/<unit>.md` and works around it locally.
 *
 * Sources: PRD §7 (the whole Federato agent), `docs/federato/live-schema.json`
 * (the real 12-resource schema), `docs/federato/QUERY_REQUEST_BODY.pdf` (the
 * query language) and `docs/contracts/LIVE_DATA_FACTS.md` (what was measured).
 */

import type {
  AppetiteFactorId,
  Citation,
  ExternalValue,
  FactorId,
  FieldMap,
  LineOfBusiness,
  RawBundle,
  SchemaDocument,
  Severity,
  Verdict,
} from '@retrofit/engine';

/* -------------------------------------------------------------------------- */
/* 0. Primitives                                                              */
/* -------------------------------------------------------------------------- */

/** Which adapter answered. Rendered in the never-hidden console banner (PRD §7.4). */
export type AdapterKind = 'live' | 'mock';

/** One record as Federato returns it: plain JSON, ids are numbers, missing is null. */
export type FederatoRecord = Readonly<Record<string, unknown>>;

/**
 * The twelve resources in `docs/federato/live-schema.json`. A `string` fallback
 * is deliberately absent: a typo in a resource name must not typecheck.
 */
export type FederatoResource =
  | 'Submission'
  | 'Policy'
  | 'Insured'
  | 'Location'
  | 'Building'
  | 'ExposureUnit'
  | 'Coverage'
  | 'Claim'
  | 'Endorsement'
  | 'Broker'
  | 'Contact'
  | 'Underwriter';

/** Monotonic milliseconds for trace durations. Injected; never `Date.now()` inline. */
export type PlannerClock = () => number;

/* -------------------------------------------------------------------------- */
/* 1. Query language (QUERY_REQUEST_BODY.pdf)                                 */
/* -------------------------------------------------------------------------- */

/** A leaf comparison value. `null` is a real value in this API, not "missing". */
export type QueryScalar = string | number | boolean | null;

export type QueryValue = QueryScalar | readonly QueryScalar[];

/**
 * The operator set the handler supports. Multiple operators in one clause
 * implicitly form `$and`.
 */
export interface QueryOperators {
  readonly $eq?: QueryValue;
  readonly $ne?: QueryValue;
  /** `true` requires the field to be present, `false` requires it absent. */
  readonly $exists?: boolean;
  readonly $gt?: number | string;
  readonly $gte?: number | string;
  readonly $lt?: number | string;
  readonly $lte?: number | string;
  readonly $in?: readonly QueryScalar[];
  readonly $nin?: readonly QueryScalar[];
  /** Substring on scalars, element membership on arrays. */
  readonly $contains?: QueryScalar;
  /** Arrays only. The one way to cross an array boundary (LIVE_DATA_FACTS). */
  readonly $elemMatch?: QueryClause;
}

/**
 * Anything that can sit to the right of a path key: a literal, an operator
 * bag, or a nested object mirroring the record shape.
 */
export type QueryClauseNode = QueryValue | QueryOperators | QueryClause;

/**
 * `where` and `filter` share one shape. Keys are either dot-paths / field names
 * or the combinators `$and` / `$or` / `$not`.
 */
export interface QueryClause {
  readonly $and?: readonly QueryClause[];
  readonly $or?: readonly QueryClause[];
  readonly $not?: QueryClause;
  readonly [path: string]:
    | QueryClauseNode
    | readonly QueryClause[]
    | QueryClause
    | undefined;
}

/**
 * The `expand` STAGE: hydrates references so later stages can reach through
 * them. `{ producer: 'broker' }`, `{ producer: { broker: true } }` and
 * `{ producer: { broker: {} } }` are all legal and equivalent.
 */
export interface ExpandClause {
  readonly [field: string]: true | string | ExpandClause;
}

export type UnwindType = 'inner' | 'left';

export interface UnwindSpec {
  readonly path: string;
  readonly type?: UnwindType;
}

/** Each entry is a path string or `{ path, type }`. */
export type UnwindClause = readonly (string | UnwindSpec)[];

/**
 * `over` partitions rows like SQL `GROUP BY`. **The deployed handler does not
 * actually partition** (LIVE_DATA_FACTS.md), so the planner never emits it and
 * F10 records a trace note when it declines server-side aggregation. F04 may
 * still implement it in the mock, per the PDF.
 */
export type OverClause = readonly string[];

/** `$sum`/`$avg`/`$min`/`$max` take a path; `$count` takes `true`. */
export type SelectReduction =
  | { readonly $sum: string }
  | { readonly $avg: string }
  | { readonly $min: string }
  | { readonly $max: string }
  | { readonly $count: true }
  | { readonly $countDistinct: string | readonly string[] };

/** The `$expand` SELECT LEAF: resolves a reference in the output only. */
export interface SelectExpandLeaf {
  readonly $expand: true | { readonly select?: SelectClause };
}

export type SelectNode =
  | true
  | readonly string[]
  | SelectReduction
  | SelectExpandLeaf
  | SelectObject;

export interface SelectObject {
  readonly [field: string]: SelectNode;
}

/** `["id", "status"]` and `{ id: true, status: true }` are equivalent. */
export type SelectClause = readonly (string | SelectObject)[] | SelectObject;

export type SortDirection = 'asc' | 'desc';

export interface SortRule {
  readonly field: string;
  /** Defaults to `asc`. Nulls sort last. */
  readonly direction?: SortDirection;
}

export type SortClause = readonly SortRule[];

export interface PaginationClause {
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * One request body. Every key is optional except `resource`. Stage order is
 * fixed: where → expand → unwind → filter → over → select → sort → pagination.
 */
export interface QueryPayload {
  readonly resource: FederatoResource;
  readonly where?: QueryClause;
  readonly expand?: ExpandClause;
  readonly unwind?: UnwindClause;
  readonly filter?: QueryClause;
  readonly over?: OverClause;
  readonly select?: SelectClause;
  readonly sort?: SortClause;
  readonly pagination?: PaginationClause;
}

/** The named stages, in pipeline order. Used by the mock and by the console. */
export const QUERY_STAGES = [
  'where',
  'expand',
  'unwind',
  'filter',
  'over',
  'select',
  'sort',
  'pagination',
] as const;

export type QueryStage = (typeof QUERY_STAGES)[number];

/**
 * What `query` resolves to. `total` is the count of matching records before
 * pagination. `groups` only ever appears if a future handler implements `over`.
 */
export interface QueryResult<T = FederatoRecord> {
  readonly resource: FederatoResource;
  readonly total: number;
  readonly results: readonly T[];
  readonly groups?: readonly FederatoRecord[];
}

/* -------------------------------------------------------------------------- */
/* 2. Transport and errors                                                    */
/* -------------------------------------------------------------------------- */

/** `{ action, payload }` is the whole body of the integrations handler. */
export type FederatoAction = 'schema' | 'query';

export interface FederatoRequestBody {
  readonly action: FederatoAction;
  readonly payload: QueryPayload | Readonly<Record<string, never>>;
}

/**
 * Responses arrive as `{ output: [{ data }] }` with HTTP 201 even when
 * `?outputOnly=true` is set. F01 unwraps both shapes.
 */
export interface FederatoEnvelope<T> {
  readonly output?: readonly { readonly data?: T }[];
  readonly data?: T;
}

/** Errors are plain strings with a `[CODE]` prefix. F01 parses the prefix. */
export interface FederatoErrorShape {
  readonly code: string | null;
  readonly message: string;
  readonly httpStatus: number | null;
  readonly raw: string;
}

export interface OAuthToken {
  readonly accessToken: string;
  /** Epoch milliseconds. Tokens last 4 hours; refresh before this. */
  readonly expiresAtMs: number;
  readonly tokenType: string;
  readonly scope?: string;
}

/** Everything the live adapter needs. Populated only from `apps/api/src/env.ts`. */
export interface FederatoEnv {
  readonly baseUrl?: string | undefined;
  readonly tokenUrl?: string | undefined;
  readonly audience?: string | undefined;
  readonly clientId?: string | undefined;
  readonly clientSecret?: string | undefined;
}

/* -------------------------------------------------------------------------- */
/* 3. Reference documents (PDFs, not endpoints)                               */
/* -------------------------------------------------------------------------- */

export interface GuidelineRow {
  readonly factor: FactorId;
  readonly label: string;
  readonly acceptable: string;
  readonly target: string;
  readonly notAcceptable: string;
  readonly citation: Citation;
}

export interface ReferenceSection {
  readonly id: string;
  readonly title: string;
  readonly page: number;
  readonly text: string;
}

export interface GuidelinesDocument {
  readonly doc: string;
  readonly version: string;
  readonly rows: readonly GuidelineRow[];
  readonly sections: readonly ReferenceSection[];
}

export interface GlossaryEntry {
  readonly term: string;
  readonly definition: string;
  readonly page: number;
  readonly aliases: readonly string[];
}

export interface GlossaryDocument {
  readonly doc: string;
  readonly version: string;
  readonly entries: readonly GlossaryEntry[];
}

/* -------------------------------------------------------------------------- */
/* 4. The adapter (PRD §7.4)                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Live and mock implement exactly this. Removing `FEDERATO_BASE_URL` swaps one
 * for the other with no code change (PRD §15).
 */
export interface FederatoAdapter {
  readonly kind: AdapterKind;
  getSchema(): Promise<SchemaDocument>;
  query<T = FederatoRecord>(payload: QueryPayload): Promise<QueryResult<T>>;
  getGuidelines(): Promise<GuidelinesDocument>;
  getGlossary(): Promise<GlossaryDocument>;
}

/** The saved snapshot the mock adapter serves, and the wifi-failure fallback. */
export interface FederatoSnapshot {
  readonly fetchedAt: string;
  readonly schema: SchemaDocument;
  /** Resource name -> every record of that resource, unmodified. */
  readonly records: Readonly<Record<FederatoResource, readonly FederatoRecord[]>>;
  readonly counts: Readonly<Record<FederatoResource, number>>;
}

/* -------------------------------------------------------------------------- */
/* 5. Query trace (PRD §7.5 step 6)                                           */
/* -------------------------------------------------------------------------- */

/** Which pass of the plan a query belongs to. */
export type QueryPass =
  | 'schema'
  | 'triage'
  | 'deep'
  | 'no_policy_followup'
  | 'high_scorer_followup'
  | 'adapt_retry';

/** What F10 changed when a query came back empty. */
export type AdaptationKind = 'elem_match_swap' | 'drop_narrowest_filter' | 'none';

export type QueryOutcome = 'ok' | 'empty' | 'error' | 'declined';

/** "Which rule needed it" — the link from a query back to the rulebook. */
export interface TraceRuleNeed {
  readonly ruleId: string;
  readonly factor: FactorId | null;
  readonly canonicalPath: string;
  readonly why: string;
}

/** "The path chosen and why" — the resource-graph decision, with what lost. */
export interface TracePathChoice {
  readonly rootResource: FederatoResource;
  /** Reference hops from the root, e.g. `['exposure_units','location','buildings']`. */
  readonly path: readonly string[];
  readonly why: string;
  readonly alternativesRejected: readonly {
    readonly rootResource: FederatoResource;
    readonly path: readonly string[];
    readonly why: string;
  }[];
}

/** One stored query. The console renders these as "How the agent got here". */
export interface QueryTraceEntry {
  readonly id: string;
  /** 0-based order within one planner run. */
  readonly seq: number;
  readonly pass: QueryPass;
  /** Plain English: what this query was for. */
  readonly goal: string;
  readonly requiredBy: readonly TraceRuleNeed[];
  readonly pathChosen: TracePathChoice;
  readonly payload: QueryPayload;
  readonly rowCount: number;
  /** `total` from the response, before pagination. Null on error. */
  readonly totalAvailable: number | null;
  readonly durationMs: number;
  readonly adapterKind: AdapterKind;
  /** ISO-8601, from the injected clock. */
  readonly startedAt: string;
  readonly outcome: QueryOutcome;
  readonly error: FederatoErrorShape | null;
  /** Set on an adapt retry: the trace id of the query this one replaced. */
  readonly adaptedFrom: string | null;
  readonly adaptation: AdaptationKind;
  /** Free notes, e.g. why server-side `over` was declined. */
  readonly notes: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* 6. Planner (PRD §7.5)                                                      */
/* -------------------------------------------------------------------------- */

/** Step 2: one field the rulebook or rating table needs. */
export interface NeededField {
  readonly canonicalPath: string;
  readonly componentKey: string | null;
  readonly factor: FactorId | null;
  readonly requiredBy: readonly TraceRuleNeed[];
  readonly required: boolean;
}

/** Step 3: where that field actually lives in the Federato schema. */
export type LocateMethod = 'synonym' | 'graph' | 'llm' | 'unmapped';

export interface LocatedField {
  readonly canonicalPath: string;
  /** Null exactly when `method === 'unmapped'`. */
  readonly rootResource: FederatoResource | null;
  /** Full dot-path from the root, e.g. `exposure_units.location.buildings.tiv`. */
  readonly schemaPath: string | null;
  readonly referenceHops: readonly string[];
  /** 0..1. Below `MIN_MAP_CONFIDENCE` (0.8) the field stays visibly unmapped. */
  readonly confidence: number;
  readonly method: LocateMethod;
  /** True when the path crosses an array and needs `$elemMatch`. */
  readonly crossesArray: boolean;
  readonly why: string;
}

export interface LocateResult {
  readonly located: readonly LocatedField[];
  /** Kept visible on the console; never silently dropped (PRD §7.5 step 3). */
  readonly unmapped: readonly LocatedField[];
  readonly fieldMap: FieldMap;
  readonly assistUsed: boolean;
}

/** Step 3's optional Gemini escape hatch. INJECTED — the planner never imports it. */
export interface SchemaAssistRequest {
  readonly unmappedKeys: readonly {
    readonly rawPath: string;
    readonly sampleValues: readonly unknown[];
  }[];
  readonly canonicalFields: readonly {
    readonly canonicalPath: string;
    readonly description: string;
  }[];
}

export interface SchemaAssistMapping {
  readonly rawPath: string;
  readonly canonicalPath: string;
  /** Accepted only at >= 0.8. */
  readonly confidence: number;
  readonly reason: string;
}

/**
 * The injected assist function. Supplying it is optional: with no assist the
 * planner is fully deterministic, which is how every offline test runs it.
 */
export type SchemaAssistFn = (
  request: SchemaAssistRequest,
) => Promise<readonly SchemaAssistMapping[]>;

/** Step 4, triage pass: one submission ruled out before any deep query. */
export interface TriageKnockout {
  readonly externalId: string;
  readonly submissionId: number;
  readonly lineOfBusiness: string;
  readonly status: string;
  readonly reason: string;
  readonly ruleId: string;
  readonly factor: AppetiteFactorId;
}

/** Step 4, triage pass: one submission that survives to the deep pass. */
export interface TriageSurvivor {
  readonly externalId: string;
  readonly submissionId: number;
  readonly lineOfBusiness: string;
  readonly status: string;
}

export interface TriagePlan {
  readonly payload: QueryPayload;
  readonly goal: string;
  readonly requiredBy: readonly TraceRuleNeed[];
  readonly pathChosen: TracePathChoice;
}

/**
 * Step 4, deep pass. **Rooted at `Policy`, never at `Submission`.**
 * `Submission` carries no premium, TIV, state, construction or building field
 * and no reverse reference to `Policy` (LIVE_DATA_FACTS.md), so the deep query
 * is a `Policy` query that expands `submission` alongside `insured`, `claims`
 * and `exposure_units.location.buildings`. The literal type below is what
 * stops F09 inverting it.
 */
export interface DeepPlan {
  readonly payload: QueryPayload & {
    readonly resource: 'Policy';
    readonly expand: ExpandClause & {
      readonly submission: true;
      readonly insured: true;
      readonly claims: true;
      readonly exposure_units: { readonly location: { readonly buildings: true } };
    };
  };
  readonly goal: string;
  readonly requiredBy: readonly TraceRuleNeed[];
  readonly pathChosen: TracePathChoice;
  /** External ids of the survivors this query is expected to hydrate. */
  readonly expectedExternalIds: readonly string[];
}

/**
 * Step 4's follow-up for submissions with no policy: `Submission -> insured ->
 * hq`. These resolve to REFER with missing data; they never get a deep pass.
 */
export interface NoPolicyPlan {
  readonly payload: QueryPayload & { readonly resource: 'Submission' };
  readonly goal: string;
  readonly requiredBy: readonly TraceRuleNeed[];
  readonly pathChosen: TracePathChoice;
  readonly expectedExternalIds: readonly string[];
}

/** Step 5's extra query for accounts that scored well. */
export interface FollowUpPlan {
  readonly payload: QueryPayload;
  readonly goal: string;
  readonly requiredBy: readonly TraceRuleNeed[];
  readonly pathChosen: TracePathChoice;
  readonly forExternalIds: readonly string[];
}

/** Everything F09 decides before a single deep query runs. */
export interface QueryPlan {
  readonly triage: TriagePlan;
  readonly deep: DeepPlan | null;
  readonly noPolicy: NoPolicyPlan | null;
  readonly followUps: readonly FollowUpPlan[];
  readonly knockedOut: readonly TriageKnockout[];
  readonly survivors: readonly TriageSurvivor[];
}

export interface PlannerCounts {
  readonly submissionsSeen: number;
  readonly knockedOut: number;
  readonly survivors: number;
  readonly deepHydrated: number;
  readonly noPolicy: number;
  readonly followUps: number;
  readonly queries: number;
  readonly totalDurationMs: number;
}

/** What `runPlanner` returns. The API stores it unchanged. */
export interface PlannerResult {
  readonly adapterKind: AdapterKind;
  readonly schema: SchemaDocument;
  /** One per submission that survived triage, plus one per no-policy submission. */
  readonly bundles: readonly RawBundle[];
  readonly trace: readonly QueryTraceEntry[];
  readonly plan: QueryPlan;
  readonly locate: LocateResult;
  readonly needed: readonly NeededField[];
  readonly counts: PlannerCounts;
  /** Non-fatal problems the console shows rather than hides (PRD G3). */
  readonly warnings: readonly string[];
}

export interface PlannerOptions {
  /** Absent means fully deterministic: no LLM call is made. */
  readonly schemaAssist?: SchemaAssistFn | undefined;
  readonly clock?: PlannerClock | undefined;
  /** ISO-8601 stamp written into every trace entry's `startedAt` base. */
  readonly now?: string | undefined;
  readonly lineOfBusiness?: LineOfBusiness | undefined;
  /** Cap on deep-pass rows. Defaults to 200 (enough for all 27 property policies). */
  readonly pageLimit?: number | undefined;
  /** Skip the step-5 high-scorer follow-up. */
  readonly skipFollowUps?: boolean | undefined;
}

/* -------------------------------------------------------------------------- */
/* 7. Resource graph (PRD §7.5 steps 1 and 3)                                 */
/* -------------------------------------------------------------------------- */

export type EdgeCardinality = 'one' | 'many';

export interface ResourceEdge {
  readonly from: FederatoResource;
  readonly to: FederatoResource;
  /** The field name on `from` that holds the reference. */
  readonly field: string;
  readonly cardinality: EdgeCardinality;
}

export interface ResourceGraph {
  readonly resources: readonly FederatoResource[];
  readonly edges: readonly ResourceEdge[];
}

export interface GraphPath {
  readonly from: FederatoResource;
  readonly to: FederatoResource;
  readonly edges: readonly ResourceEdge[];
  /** Dot-path of field names, e.g. `exposure_units.location.buildings`. */
  readonly dotPath: string;
  /** True when any hop is `many`, so the path needs `$elemMatch` in a filter. */
  readonly crossesArray: boolean;
  readonly hops: number;
}

/** One row of the synonym table: the only place Federato field names appear. */
export interface SynonymEntry {
  readonly canonicalPath: string;
  readonly resource: FederatoResource;
  /** Dot-path relative to `resource`. Must exist in `live-schema.json`. */
  readonly schemaPath: string;
  readonly confidence: number;
  readonly note?: string;
}

/* -------------------------------------------------------------------------- */
/* 8. Actions (PRD §7.6)                                                      */
/* -------------------------------------------------------------------------- */

export interface UnderwriterRecord {
  readonly id: number;
  readonly name: string;
  readonly email: string;
  readonly team: string;
  readonly region: string;
  readonly authorityLimit: number;
}

export interface BrokerRecord {
  readonly id: number;
  readonly name: string;
  readonly tier: string;
  readonly region: string;
}

export interface ContactRecord {
  readonly id: number;
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly title: string | null;
}

/** Why a candidate underwriter did or did not qualify. Shown on the console. */
export interface RoutingCandidate {
  readonly underwriter: UnderwriterRecord;
  readonly regionMatches: boolean;
  readonly authorityCovers: boolean;
  readonly reason: string;
}

/** Route: region matches the primary state and authority covers the limit. */
export interface RoutingDecision {
  readonly submissionId: string;
  readonly primaryState: string | null;
  readonly requestedLimit: number | null;
  readonly assigned: UnderwriterRecord | null;
  /** True when nobody qualifies: "needs referral to senior authority". */
  readonly needsSeniorReferral: boolean;
  readonly reason: string;
  readonly candidates: readonly RoutingCandidate[];
}

export type RequestTrigger =
  | 'missing_data'
  | 'high_contradiction'
  | 'one_flip_from_fit';

/** One field the broker is being asked for, and why it matters. */
export interface RequestedField {
  readonly canonicalPath: string;
  readonly componentKey: string | null;
  readonly label: string;
  /** "it decides the building-age factor" */
  readonly why: string;
  readonly factor: FactorId | null;
  readonly ruleId: string | null;
  readonly currentValue: string | null;
  readonly severity: Severity;
}

/**
 * Code picks the fields; Gemini only drafts the wording. The draft validator
 * checks that every field here appears in the message and nothing else is asked.
 */
export interface RequestSelection {
  readonly submissionId: string;
  readonly triggers: readonly RequestTrigger[];
  readonly fields: readonly RequestedField[];
  readonly insuredName: string | null;
  readonly broker: BrokerRecord | null;
  readonly contact: ContactRecord | null;
  readonly rationale: string;
  /** False when nothing qualifies; no draft is generated. */
  readonly qualifies: boolean;
}

export interface DraftValidation {
  readonly ok: boolean;
  readonly missingFields: readonly string[];
  /** Fields asked for that were never selected. */
  readonly extraneousFields: readonly string[];
  readonly problems: readonly string[];
}

/** One value Gemini pulled out of the broker's reply, before validation. */
export interface ExtractedFieldValue {
  readonly canonicalPath: string;
  readonly value: unknown;
  /** 0..1 as stated by the model. */
  readonly confidence: number;
  /** Must appear verbatim in the source text. */
  readonly quote: string;
}

export type ExtractionRejection =
  | 'low_confidence'
  | 'quote_not_found'
  | 'wrong_type'
  | 'out_of_range'
  | 'not_requested'
  | 'unparseable'
  /** Passed every check but landed on no field the engine reads (R2-7). */
  | 'not_applied';

/** The same value after code checked type, range, quote and the 0.8 gate. */
export interface ValidatedFieldValue extends ExtractedFieldValue {
  readonly accepted: boolean;
  readonly quoteFound: boolean;
  readonly typeOk: boolean;
  readonly rangeOk: boolean;
  readonly rejection: ExtractionRejection | null;
  /** Below 0.8 but otherwise clean: the underwriter confirms it by hand. */
  readonly needsConfirmation: boolean;
}

/** The numbers before and after a reply, for the action log. */
export interface ScoreSnapshot {
  readonly appetiteScore: number;
  readonly verdict: Verdict;
  readonly completeness: number;
  readonly confidence: number;
  readonly predictedPremium: number | null;
  readonly qualityIndex: number;
  readonly rank: number | null;
}

/** Applying a validated reply: what goes into the engine, and what changed. */
export interface ReplyApplication {
  readonly submissionId: string;
  readonly sourceText: string;
  readonly extracted: readonly ValidatedFieldValue[];
  readonly accepted: readonly ValidatedFieldValue[];
  readonly rejected: readonly ValidatedFieldValue[];
  readonly needsConfirmation: readonly ValidatedFieldValue[];
  /** What the engine is re-run with, all carrying `answer` provenance. */
  readonly externalValues: readonly ExternalValue[];
  /** Ids of contradictions raised because the reply disagrees with the submission. */
  readonly newContradictionPaths: readonly string[];
  readonly before: ScoreSnapshot | null;
  readonly after: ScoreSnapshot | null;
}

/* -------------------------------------------------------------------------- */
/* 9. Explanation (PRD §7.7)                                                  */
/* -------------------------------------------------------------------------- */

export type Recommendation = 'accept' | 'review' | 'decline' | 'investigate';

export interface ExplanationFactorNote {
  readonly factor: AppetiteFactorId;
  readonly label: string;
  readonly inAppetite: boolean;
  readonly tier: string | null;
  readonly valueText: string;
}

/**
 * Deterministic template output. Gemini's `narrate` call may only polish the
 * wording; `narrate-guard` checks every number and the recommendation survived.
 */
export interface Explanation {
  readonly submissionId: string;
  /** 2–3 sentences, joined. This is what is stored and shown. */
  readonly text: string;
  readonly sentences: readonly string[];
  readonly recommendation: Recommendation;
  /** True when the account is in appetite on some factors and out on others. */
  readonly mixed: boolean;
  readonly inAppetite: readonly ExplanationFactorNote[];
  readonly outOfAppetite: readonly ExplanationFactorNote[];
  /** Every number that appears in `text`, so the guard can check it survived. */
  readonly numbers: Readonly<Record<string, number>>;
  readonly citations: readonly Citation[];
  /** The pre-polish template text. Kept even after narration. */
  readonly template: string;
  readonly narrated: boolean;
}

export interface NarrateGuardResult {
  readonly ok: boolean;
  /** The text to store: the polished version when ok, the template when not. */
  readonly text: string;
  readonly changedNumbers: readonly string[];
  readonly recommendationChanged: boolean;
  readonly problems: readonly string[];
}
