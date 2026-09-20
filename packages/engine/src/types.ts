/**
 * Retrofit engine — frozen type contracts.
 *
 * Written by W0-2 (Run 0). FROZEN after Run 0: Run 1 units replace stub bodies,
 * they never change a signature in this file. Anything that must change goes
 * through `docs/contracts/requests/<unit>.md`.
 *
 * Every boundary, tier value and tolerance referenced here is pinned in
 * `docs/contracts/INTERPRETATIONS.md`. That file, not this one, is the oracle.
 *
 * The engine is pure arithmetic: no I/O, no `Date.now`, no `Math.random`.
 * Wall-clock inputs arrive as ISO date strings on `EngineInput`.
 */

/* -------------------------------------------------------------------------- */
/* Provenance and fields (PRD 6.2)                                            */
/* -------------------------------------------------------------------------- */

/** Where a value came from. `self_reported` means broker-typed. */
export type SourceKind = 'self_reported' | 'enrichment' | 'sweep' | 'answer';

export interface Provenance {
  readonly source: SourceKind;
  /** Free text: the resource+path, the enrichment plugin id, the frame id, the question id. */
  readonly sourceDetail?: string;
  /**
   * 0..1. Omitted means "use the fixed table in constants.ts"
   * (SOURCE_CONFIDENCE). For `sweep` this is the model's stated confidence
   * after the PRD 9.3 adjustments and is always present.
   */
  readonly confidence?: number;
  /** ISO-8601 date or date-time. */
  readonly observedAt?: string;
}

/** One measured value with one provenance. */
export interface Field<T> {
  readonly value: T;
  readonly provenance: Provenance;
}

/**
 * A canonical slot. Several competing values from different sources may sit
 * side by side; nothing ever overwrites anything (PRD 6.2). Ordering is
 * insertion order; `merge` appends, it never reorders or removes.
 */
export type Sourced<T> = readonly Field<T>[];

/* -------------------------------------------------------------------------- */
/* Vocabularies                                                               */
/* -------------------------------------------------------------------------- */

export type LineOfBusiness = 'commercial_property' | 'tenant';

/** The eight Federato appetite factors (APPETITE_GUIDELINES.pdf, 2025 sample table). */
export type AppetiteFactorId =
  | 'submission_type'
  | 'line_of_business'
  | 'primary_risk_state'
  | 'tiv'
  | 'total_premium'
  | 'building_age'
  | 'construction_type'
  | 'loss_value';

/** Appetite factors plus Retrofit's own extension factors and tenant factors. */
export type FactorId = AppetiteFactorId | (string & {});

/** Tier labels. Numeric values live in TIER_VALUE (constants.ts). */
export type Tier = 'target' | 'acceptable' | 'not_acceptable' | 'refer';

/** The 21-label fixed object vocabulary (PRD 9.2). */
export type ObjectLabel =
  | 'portable_heater'
  | 'extension_cord'
  | 'power_bar'
  | 'outlet'
  | 'curtain'
  | 'fabric'
  | 'bedding'
  | 'smoke_detector'
  | 'sprinkler_head'
  | 'window_ac_unit'
  | 'stove'
  | 'candle'
  | 'bike'
  | 'jewelry'
  | 'camera'
  | 'laptop'
  | 'tv'
  | 'instrument'
  | 'blocked_exit'
  | 'water_heater'
  | 'unknown';

export type ObjectCategory =
  | 'heat_source'
  | 'electrical'
  | 'combustible'
  | 'protection'
  | 'appliance'
  | 'valuables'
  | 'egress'
  | 'other';

export type DistanceBand = 'near' | 'mid' | 'far';

export type Verdict = 'FIT' | 'REFER' | 'DOES_NOT_FIT';

export type Severity = 'HIGH' | 'MEDIUM' | 'LOW';

/* -------------------------------------------------------------------------- */
/* Raw input (stage 1 input)                                                  */
/* -------------------------------------------------------------------------- */

export interface SchemaField {
  readonly path: string;
  readonly type: string;
  readonly nullable?: boolean;
  /** Resource name this field references, when it is a reference. */
  readonly reference?: string;
  readonly isArray?: boolean;
  readonly description?: string;
}

export interface SchemaResource {
  readonly name: string;
  readonly fields: readonly SchemaField[];
}

/** The live schema document, flattened. The engine never calls Federato. */
export interface SchemaDocument {
  readonly resources: readonly SchemaResource[];
  readonly fetchedAt?: string;
}

export interface RawRecord {
  readonly resource: string;
  readonly id: string | number;
  readonly data: Readonly<Record<string, unknown>>;
}

/** Everything the Federato planner produced for one submission. */
export interface RawBundle {
  readonly externalId: string;
  readonly lineOfBusiness?: LineOfBusiness;
  /** resource name -> records. Always present, possibly empty. */
  readonly records: Readonly<Record<string, readonly RawRecord[]>>;
  readonly schema?: SchemaDocument;
  readonly fetchedAt?: string;
  /** Opaque to the engine; carried through for the console. */
  readonly queryTraceIds?: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* Stage 1 — discover                                                         */
/* -------------------------------------------------------------------------- */

export type FieldMapMethod = 'exact' | 'synonym' | 'graph' | 'llm';

export interface FieldMapEntry {
  readonly rawPath: string;
  readonly canonicalPath: string;
  /** 0..1. Below MIN_MAP_CONFIDENCE the entry belongs in `unmapped` instead. */
  readonly confidence: number;
  readonly method: FieldMapMethod;
  readonly note?: string;
}

export interface UnmappedKey {
  readonly rawPath: string;
  readonly sampleValues: readonly unknown[];
  readonly reason: string;
  /** Best rejected guess, if any. */
  readonly bestGuess?: { readonly canonicalPath: string; readonly confidence: number };
}

export interface FieldMap {
  readonly entries: readonly FieldMapEntry[];
  readonly unmapped: readonly UnmappedKey[];
}

/* -------------------------------------------------------------------------- */
/* Canonical submission (stage 2 output)                                      */
/* -------------------------------------------------------------------------- */

export type SubmissionType = 'new_business' | 'renewal';

export interface InsuredFacts {
  readonly name?: Sourced<string>;
  readonly industry?: Sourced<string>;
  readonly revenue?: Sourced<number>;
  readonly employeeCount?: Sourced<number>;
  readonly brokerName?: Sourced<string>;
  readonly contactName?: Sourced<string>;
  readonly contactEmail?: Sourced<string>;
  readonly headquartersState?: Sourced<string>;
}

export interface LocationFacts {
  readonly externalId: string;
  readonly state?: Sourced<string>;
  readonly city?: Sourced<string>;
  readonly postalCode?: Sourced<string>;
  readonly latitude?: Sourced<number>;
  readonly longitude?: Sourced<number>;
  /** 1..10, 1 best. */
  readonly protectionClass?: Sourced<number>;
  /** Catastrophe perils from Federato, not room hazards. */
  readonly hazardTags?: Sourced<readonly string[]>;
  readonly floodZone?: Sourced<string>;
  readonly fireStationDistanceKm?: Sourced<number>;
}

export interface BuildingFacts {
  readonly externalId: string;
  readonly label?: string;
  readonly locationExternalId?: string;
  readonly tiv?: Sourced<number>;
  readonly yearBuilt?: Sourced<number>;
  readonly constructionType?: Sourced<string>;
  readonly sprinklered?: Sourced<boolean>;
  readonly stories?: Sourced<number>;
  readonly roofYear?: Sourced<number>;
  readonly occupancy?: Sourced<string>;
  readonly protectionClass?: Sourced<number>;
}

/** Tenant / room hazards. Keys are `hazards.*` paths without the prefix. */
export type HazardKey =
  | 'portableHeater'
  | 'heaterNearCombustible'
  | 'extensionCord'
  | 'powerBarOverload'
  | 'candle'
  | 'stove'
  | 'blockedExit'
  | 'windowAcUnit'
  | 'waterHeater'
  | 'highValueContents'
  | (string & {});

export type HazardValue = boolean | number;

export interface HazardFacts {
  readonly present: Readonly<Partial<Record<HazardKey, Sourced<HazardValue>>>>;
  readonly smokeDetectorCount?: Sourced<number>;
  readonly sprinklerHeadCount?: Sourced<number>;
  readonly ceilingObserved?: Sourced<boolean>;
}

export interface ExposureFacts {
  readonly requestedLimit?: Sourced<number>;
  readonly contentsLimit?: Sourced<number>;
  /** 4, 8 or 12 for tenant. */
  readonly termMonths?: Sourced<number>;
  readonly occupancyType?: Sourced<string>;
  readonly squareFeet?: Sourced<number>;
  readonly roomLabel?: Sourced<string>;
}

export interface CoverageFacts {
  readonly lines: readonly {
    readonly code: string;
    readonly limit?: Sourced<number>;
    readonly deductible?: Sourced<number>;
  }[];
}

export interface ClaimFacts {
  readonly externalId: string;
  readonly dateOfLoss?: Sourced<string>;
  readonly causeOfLoss?: Sourced<string>;
  readonly paidIndemnity?: Sourced<number>;
  readonly paidExpense?: Sourced<number>;
  readonly reserves?: Sourced<number>;
}

export interface PricingFacts {
  readonly quotedPremium?: Sourced<number>;
  readonly technicalPremium?: Sourced<number>;
  readonly targetPremium?: Sourced<number>;
}

export interface CanonicalSubmission {
  readonly id: string;
  readonly externalId?: string;
  readonly lineOfBusiness: LineOfBusiness;
  readonly submissionType?: Sourced<SubmissionType>;
  /** ISO-8601 date. The five-year loss window is measured back from this. */
  readonly receivedDate?: Sourced<string>;
  readonly effectiveDate?: Sourced<string>;
  readonly expirationDate?: Sourced<string>;
  readonly status?: Sourced<string>;
  readonly insured: InsuredFacts;
  readonly locations: readonly LocationFacts[];
  readonly buildings: readonly BuildingFacts[];
  readonly hazards: HazardFacts;
  readonly exposure: ExposureFacts;
  readonly coverage: CoverageFacts;
  readonly history: readonly ClaimFacts[];
  readonly pricing: PricingFacts;
  /** Set by stage 3. Absent before rollup runs. */
  readonly rollup?: Rollup;
  readonly raw?: RawBundle;
  readonly fieldMap?: FieldMap;
}

/* -------------------------------------------------------------------------- */
/* Stage 3 — rollup                                                           */
/* -------------------------------------------------------------------------- */

export interface StateShare {
  readonly state: string;
  readonly tiv: number;
  /** 0..1 of total TIV. */
  readonly share: number;
}

export interface ConstructionShare {
  readonly constructionType: string;
  readonly tiv: number;
  readonly share: number;
  readonly acceptable: boolean;
  /** True for Fire Resistive / Modified Fire Resistive (PRD 6.6 interpretation 3). */
  readonly assumedAcceptable: boolean;
}

export interface Rollup {
  readonly totalTiv: number | null;
  readonly buildingCount: number;
  /** Buildings with a known TIV. Shares are computed over these only. */
  readonly tivKnownBuildingCount: number;
  /** 0..1, share of known TIV in buildings with yearBuilt < 1990. */
  readonly pctTivPre1990: number | null;
  /** 0..1, share of known TIV in buildings with yearBuilt >= 2010. */
  readonly pctTivPost2010: number | null;
  readonly pctTivByConstruction: readonly ConstructionShare[];
  readonly pctTivAcceptableConstruction: number | null;
  readonly pctTivSprinklered: number | null;
  /** TIV-weighted mean, 1..10. */
  readonly tivWeightedProtectionClass: number | null;
  /**
   * The worst FEMA flood hazard across the account's locations, as an ordinal:
   * 0 = outside the mapped hazard (zone X, X500, D or an unrecognised code),
   * 1 = a Special Flood Hazard Area without a wave hazard (A, AE, AO, AH, AR,
   * A99), 2 = a coastal SFHA with wave action (V, VE). `null` when no location
   * states a zone at all.
   *
   * The worst rather than a TIV-weighted mean: a single building standing in a
   * flood zone is the exposure, and averaging it away against dry buildings
   * would report an account as safer than it is.
   *
   * Fed only by `openfema_flood` enrichment today, so an account whose
   * enrichment has not run scores exactly as before. Read by the extension
   * rulebook (never by the appetite score) and by the rating table.
   */
  readonly worstFloodZoneTier: number | null;
  readonly primaryState: string | null;
  readonly stateShares: readonly StateShare[];
  /** paid indemnity + paid expense + open reserves, within the 5-year window. */
  readonly fiveYearLoss: number | null;
  readonly fiveYearClaimCount: number;
  readonly claimCount: number;
  /** Buildings with yearBuilt < 1990, for the REFER message. */
  readonly pre1990BuildingIds: readonly string[];
  readonly oldestYearBuilt: number | null;
  readonly newestYearBuilt: number | null;
  /** Inclusive ISO date bounds actually used for the loss window. */
  readonly lossWindow: { readonly from: string; readonly to: string } | null;
}

/* -------------------------------------------------------------------------- */
/* Stage 4/5 — merge inputs, contradictions                                   */
/* -------------------------------------------------------------------------- */

/** A value arriving from outside the broker submission, addressed by canonical path. */
export interface ExternalValue {
  /** Dotted canonical path, e.g. `buildings.B3.yearBuilt` or `hazards.candle`. */
  readonly canonicalPath: string;
  readonly value: unknown;
  readonly provenance: Provenance;
}

/** Sweep observation (PRD 9.2/9.3). Bearings are degrees clockwise from 0 = sweep start. */
export interface Observation {
  readonly id: string;
  readonly label: ObjectLabel;
  readonly category: ObjectCategory;
  /** 0..360, normalized. */
  readonly bearingDeg: number;
  readonly distanceBand: DistanceBand;
  /** 0..1 after the PRD 9.3 adjustments. */
  readonly confidence: number;
  readonly frameIndex: number;
  /** Gemini `box_2d` as [y0, x0, y1, x1] in 0..1000. */
  readonly box2d?: readonly [number, number, number, number];
  readonly ceilingVisible?: boolean;
  readonly notes?: string;
  /** How many of the two shuffled `observe` runs saw it (PRD 9.3 step 4). */
  readonly runsSeen?: 1 | 2;
  /** True when produced by an engine pair rule rather than by the model. */
  readonly derived?: boolean;
}

export interface Contradiction {
  readonly id: string;
  readonly canonicalPath: string;
  readonly values: readonly Field<unknown>[];
  readonly severity: Severity;
  /** Rule ids whose firing depends on this path. */
  readonly affectedRules: readonly string[];
  readonly status: 'open' | 'resolved';
  readonly note?: string;
}

/* -------------------------------------------------------------------------- */
/* Stage 6 — vector spec and feature vector                                   */
/* -------------------------------------------------------------------------- */

export type ScalingRule = 'none' | 'log_minmax' | 'log1p_minmax' | 'divide' | 'minmax';

export type Direction = 'higher_better' | 'lower_better' | 'band' | 'neutral';

export type ComponentType = 'binary' | 'tier' | 'currency' | 'ratio' | 'count' | 'ordinal' | 'year';

export interface VectorComponentSpec {
  /** Position in x/t/m. Must equal the array index. */
  readonly index: number;
  /** Stable key. Rules and flips address components by key, never by index. */
  readonly key: string;
  readonly label: string;
  /** Canonical source path, or a rollup field name. */
  readonly source: string;
  readonly type: ComponentType;
  readonly scaling: { readonly rule: ScalingRule; readonly divisor?: number };
  readonly direction: Direction;
  /** True for the components that drive one of the eight Federato factors. */
  readonly appetiteFactor: boolean;
  readonly factor: FactorId | null;
  /** True for components that feed pricing/peers/extension rules only. */
  readonly extensionOnly: boolean;
  /** Never proposed by `flip` (PRD 6.4). */
  readonly immovable: boolean;
  /** Counts toward completeness. */
  readonly required: boolean;
  readonly min?: number;
  readonly max?: number;
}

export interface VectorSpec {
  readonly lineOfBusiness: LineOfBusiness;
  readonly version: string;
  readonly components: readonly VectorComponentSpec[];
}

/**
 * Three parallel arrays, all of `spec.components.length`.
 * `x[i]` and `t[i]` are null exactly where `m[i] === 0`.
 */
export interface FeatureVector {
  readonly lineOfBusiness: LineOfBusiness;
  readonly specVersion: string;
  /** Raw measured values. */
  readonly x: readonly (number | null)[];
  /** Tier values: 0, 0.6 or 1 on appetite factors; null when missing. */
  readonly t: readonly (number | null)[];
  /** Presence mask. */
  readonly m: readonly (0 | 1)[];
}

/** Per-component book statistics used for min-max scaling and peer distance. */
export interface ComponentStats {
  readonly index: number;
  readonly key: string;
  /** Min/max AFTER the component's log transform, i.e. in scaling space. */
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly median: number;
  /** Number of accounts with this component present. */
  readonly count: number;
}

export interface BookStats {
  readonly lineOfBusiness: LineOfBusiness;
  readonly specVersion: string;
  /** Accounts contributing to the statistics. */
  readonly n: number;
  readonly components: readonly ComponentStats[];
  /** Book-wide fallbacks used by pricing and peers. */
  readonly medianRatePer100: number | null;
  readonly meanAnnualLoss: number | null;
  readonly meanClaimFrequency: number | null;
  readonly meanClaimSeverity: number | null;
}

/* -------------------------------------------------------------------------- */
/* Rulebook (PRD 6.6)                                                         */
/* -------------------------------------------------------------------------- */

export type ConditionOp =
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'eq'
  | 'neq'
  | 'in'
  | 'notin'
  | 'exists'
  | 'missing';

export type ConditionValue = number | string | boolean | readonly (number | string | boolean)[];

export interface Condition {
  /** A vector component key, or a rollup/canonical path. */
  readonly field: string;
  readonly op: ConditionOp;
  readonly value?: ConditionValue;
}

export interface Citation {
  readonly doc: string;
  readonly section: string;
  /** Verbatim text from the source document. */
  readonly quote: string;
}

export interface Rule {
  readonly id: string;
  readonly lineOfBusiness: LineOfBusiness;
  readonly factor: FactorId;
  readonly tier: Tier;
  /** AND only. No nesting (PRD 3 non-goals). */
  readonly when: readonly Condition[];
  /** Present on appetite rules; the eight factor weights sum to exactly 1. */
  readonly weight?: number;
  readonly citation: Citation;
  readonly fixHint?: string;
  /** Names a factor column in the rating table. */
  readonly ratingFactor?: string;
  /** True for `rules/extensions.json`: never touches the appetite score. */
  readonly extension?: boolean;
  /** Free text shown on the rule card when an interpretation was applied. */
  readonly interpretation?: string;
}

export interface Rulebook {
  readonly id: string;
  readonly lineOfBusiness: LineOfBusiness;
  readonly version: string;
  readonly source: string;
  /** factor id -> weight. Appetite factors only; sums to 1 within WEIGHT_SUM_TOLERANCE. */
  readonly weights: Readonly<Record<string, number>>;
  readonly rules: readonly Rule[];
  readonly interpretations?: readonly AppliedInterpretation[];
}

export interface AppliedInterpretation {
  readonly id: string;
  readonly title: string;
  readonly decision: string;
  readonly citation?: Citation;
  /** Vector component keys or canonical paths the interpretation touched. */
  readonly affects: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* Rating tables (PRD 6.7)                                                    */
/* -------------------------------------------------------------------------- */

/** Ordered breakpoints; the engine picks the first bucket whose `upTo` is >= x. */
export interface RatingBand {
  readonly key: string;
  /** Inclusive upper bound; null means "and above". */
  readonly upTo: number | null;
  readonly factor: number;
}

export interface FitError {
  /** Mean absolute percentage error of the fit against technical premium. */
  readonly mape: number;
  readonly r2: number;
  readonly n: number;
}

export interface CommercialRatingTable {
  readonly lineOfBusiness: 'commercial_property';
  readonly version: string;
  /** Dollars of premium per $100 of TIV before factors. */
  readonly baseRate: number;
  /** construction type -> factor. Monotonic: a worse class is never cheaper. */
  readonly construction: Readonly<Record<string, number>>;
  readonly age: readonly RatingBand[];
  readonly protectionClass: readonly RatingBand[];
  readonly sprinkler: { readonly sprinklered: number; readonly unsprinklered: number };
  readonly lossHistory: readonly RatingBand[];
  /**
   * Flood load by `rollup.worstFloodZoneTier`, applied once per account.
   *
   * Unlike every other factor here these are a documented judgement, not a fit:
   * the 27 real accounts carry too few flood-zone locations to fit against, and
   * inventing a fitted number from three observations would be worse than
   * saying so. `minimal` is therefore exactly 1, so an account outside the
   * mapped hazard — and an account whose flood enrichment has never run —
   * prices precisely as it did before flood existed, and the fitted MAPE still
   * describes it. Optional so a table written before flood existed still loads.
   */
  readonly flood?: {
    /** Outside the SFHA (zone X, X500, D). Pinned at 1: no load, no change. */
    readonly minimal: number;
    /** Special Flood Hazard Area without wave action (A, AE, AO, AH, AR, A99). */
    readonly sfha: number;
    /** Coastal high-hazard zone with wave action (V, VE). */
    readonly coastal: number;
  };
  readonly credibilityK: number;
  readonly fitError?: FitError;
  readonly fittedAt?: string;
}

export interface TenantRatingTable {
  readonly lineOfBusiness: 'tenant';
  readonly version: string;
  readonly baseMonthlyRate: number;
  readonly contents: readonly RatingBand[];
  readonly buildingAge: readonly RatingBand[];
  /** hazard key -> multiplicative factor applied when the hazard is present. */
  readonly hazards: Readonly<Record<string, number>>;
  /** term in months -> factor. */
  readonly term: Readonly<Record<string, number>>;
  readonly smokeDetector: { readonly present: number; readonly absent: number };
}

export type RatingTable = CommercialRatingTable | TenantRatingTable;

/* -------------------------------------------------------------------------- */
/* Stage 7 — evaluate                                                         */
/* -------------------------------------------------------------------------- */

export interface FiredRule {
  readonly ruleId: string;
  readonly factor: FactorId;
  readonly tier: Tier;
  readonly tierValue: number;
  readonly weight: number;
  /** 100 * weight * tierValue. */
  readonly points: number;
  readonly citation: Citation;
  readonly conditions: readonly Condition[];
  readonly extension: boolean;
  readonly interpretation?: string;
}

export interface FactorOutcome {
  readonly factor: AppetiteFactorId;
  readonly componentKeys: readonly string[];
  readonly tier: Tier | null;
  readonly tierValue: number | null;
  readonly weight: number;
  readonly points: number;
  readonly known: boolean;
  readonly knockout: boolean;
  readonly refer: boolean;
  readonly ruleId: string | null;
  readonly citation: Citation | null;
}

export interface MissingField {
  readonly componentKey: string;
  readonly canonicalPath: string;
  readonly factor: FactorId | null;
  readonly required: boolean;
  readonly reason: string;
}

export interface EvaluateResult {
  /** 0..100 = 100 * (w . t). */
  readonly appetiteScore: number;
  readonly factors: readonly FactorOutcome[];
  readonly firedRules: readonly FiredRule[];
  /** True when any known appetite factor has tier value 0. */
  readonly knockout: boolean;
  readonly knockoutFactors: readonly AppetiteFactorId[];
  /** Factors that fired a `refer` tier rule without a knockout. */
  readonly referFactors: readonly AppetiteFactorId[];
  readonly missingFields: readonly MissingField[];
  /** 0..100. */
  readonly completeness: number;
  /** 0..1, product of source confidences over deciding fields. */
  readonly confidence: number;
  readonly interpretationsApplied: readonly AppliedInterpretation[];
}

/* -------------------------------------------------------------------------- */
/* Stage 8 — price                                                            */
/* -------------------------------------------------------------------------- */

export interface AppliedFactor {
  readonly name: string;
  /** The input the factor was looked up with, as text for the console. */
  readonly input: string;
  readonly factor: number;
}

export interface BuildingPremium {
  readonly buildingExternalId: string;
  readonly tiv: number;
  readonly baseRate: number;
  readonly factors: readonly AppliedFactor[];
  readonly premium: number;
}

export interface ExpectedLossDetail {
  /** Claims per year over the 5-year window. */
  readonly frequency: number;
  readonly severity: number;
  readonly ownExpectedLoss: number;
  readonly peerMeanAnnualLoss: number | null;
  readonly bookMeanAnnualLoss: number | null;
  /** n / (n + k). */
  readonly credibility: number;
  readonly k: number;
  readonly n: number;
}

export interface PriceBreakdown {
  readonly lineOfBusiness: LineOfBusiness;
  readonly currency: 'USD';
  /** Annual for commercial; annualized for tenant. Null when TIV is unknown. */
  readonly predictedPremium: number | null;
  /** Tenant only. */
  readonly predictedMonthlyPremium: number | null;
  readonly termMonths: number | null;
  readonly perBuilding: readonly BuildingPremium[];
  readonly factors: readonly AppliedFactor[];
  readonly lossHistoryFactor: number | null;
  readonly expectedAnnualLoss: number | null;
  readonly expectedLossDetail: ExpectedLossDetail | null;
  readonly quotedPremium: number | null;
  /** quoted / predicted. Under 0.9 is underpriced. */
  readonly adequacy: number | null;
  /** predicted premium per $100 of TIV. */
  readonly ratePer100: number | null;
  readonly basis: 'fitted' | 'table';
  readonly fitError: FitError | null;
  /** True when the number is an estimate with no loss data behind it. */
  readonly estimate: boolean;
}

/* -------------------------------------------------------------------------- */
/* Stage 9 — verdict                                                          */
/* -------------------------------------------------------------------------- */

export interface DecidingRule {
  readonly ruleId: string;
  readonly factor: FactorId;
  readonly tier: Tier;
  readonly citation: Citation;
}

export interface VerdictResult {
  readonly verdict: Verdict;
  readonly decidingRule: DecidingRule | null;
  /** Plain sentences, ordered most-deciding first. */
  readonly reasons: readonly string[];
  /** Size of the minimal flip: 0, 1, 2, or null when no flip exists. */
  readonly distanceToAppetite: 0 | 1 | 2 | null;
  readonly openHighContradictionIds: readonly string[];
  readonly missingComponentKeys: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* Stage 10 — flip                                                            */
/* -------------------------------------------------------------------------- */

export interface FlipMove {
  readonly componentIndex: number;
  readonly componentKey: string;
  readonly from: number | null;
  readonly to: number;
  /** Move length in scaled (0..1) space. */
  readonly deltaScaled: number;
  readonly label: string;
  readonly fixHint?: string;
}

export interface Flip {
  /** 1 or 2 moves. Never contains an immovable component. */
  readonly moves: readonly FlipMove[];
  readonly scoreBefore: number;
  readonly scoreAfter: number;
  readonly premiumBefore: number | null;
  readonly premiumAfter: number | null;
  readonly verdictAfter: Verdict;
  /** Euclidean length of the whole move in scaled space. */
  readonly distanceScaled: number;
}

export interface FlipResult {
  readonly flip: Flip | null;
  /** Non-null exactly when `flip` is null. */
  readonly reason: string | null;
  /** Component keys that fail and cannot be moved. */
  readonly blockedByImmovable: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* Stage 11 — voi                                                             */
/* -------------------------------------------------------------------------- */

export type QuestionInputType = 'boolean' | 'number' | 'single_select' | 'multi_select' | 'text';

export interface QuestionOption {
  readonly value: string | number | boolean;
  readonly label: string;
}

export interface Question {
  readonly id: string;
  /** Canonical path or vector component key the answer writes to. */
  readonly field: string;
  readonly prompt: string;
  readonly inputType: QuestionInputType;
  readonly options?: readonly QuestionOption[];
  readonly accessibilityLabel: string;
  readonly unit?: string;
}

export interface QuestionCandidate {
  readonly question: Question;
  /** Rules that stay undetermined while this field is missing. */
  readonly undeterminedRuleIds: readonly string[];
  /** Largest possible change in appetite score, 0..100. */
  readonly expectedScoreSwing: number;
  readonly weight: number;
  readonly reason: string;
}

export interface SkippedField {
  readonly field: string;
  readonly reason: string;
}

export interface VoiResult {
  readonly nextQuestion: Question | null;
  /** Ordered best-first, including the one returned as `nextQuestion`. */
  readonly ranked: readonly QuestionCandidate[];
  readonly skipped: readonly SkippedField[];
  readonly askedCount: number;
}

/* -------------------------------------------------------------------------- */
/* Stage 12 — peers                                                           */
/* -------------------------------------------------------------------------- */

/** One other account's vector, plus the outcomes peers report on. */
export interface PeerVectorEntry {
  readonly id: string;
  readonly label?: string;
  readonly vector: FeatureVector;
  readonly totalTiv: number | null;
  readonly quotedPremium: number | null;
  readonly ratePer100: number | null;
  readonly annualLoss: number | null;
  /** True when only the reduced vector is available (no policy). */
  readonly coarse: boolean;
}

export interface PeerMatch {
  readonly id: string;
  readonly label?: string;
  /** Scaled Euclidean distance over compared components, rescaled by count. */
  readonly distance: number;
  readonly comparedComponents: number;
  readonly ratePer100: number | null;
  readonly annualLoss: number | null;
  readonly totalTiv: number | null;
  readonly quotedPremium: number | null;
  readonly coarse: boolean;
}

export interface PeerResult {
  readonly k: number;
  readonly peers: readonly PeerMatch[];
  readonly medianRatePer100: number | null;
  readonly meanAnnualLoss: number | null;
  /** True when this account itself was matched on the reduced vector. */
  readonly coarse: boolean;
  /** Component indices used for the distance. */
  readonly componentsUsed: readonly number[];
}

/* -------------------------------------------------------------------------- */
/* Stage 13 — rank                                                            */
/* -------------------------------------------------------------------------- */

export interface QualityComponents {
  /** Each already scaled to 0..100 and clamped. */
  readonly appetite: number;
  readonly adequacy: number;
  readonly lossRatio: number;
  readonly completeness: number;
  readonly confidence: number;
}

export interface RankedEntry {
  readonly id: string;
  /** 1-based. */
  readonly rank: number;
  readonly qualityIndex: number;
  readonly components: QualityComponents;
  readonly verdict: Verdict;
  readonly appetiteScore: number;
  readonly knockout: boolean;
  readonly distanceToAppetite: 0 | 1 | 2 | null;
  readonly completeness: number;
  readonly confidence: number;
  readonly adequacy: number | null;
}

/* -------------------------------------------------------------------------- */
/* Sweep geometry (pure, PRD 6.3 + 11)                                        */
/* -------------------------------------------------------------------------- */

export interface CoverageArc {
  /** Degrees, 0..360, clockwise. `startDeg` may exceed `endDeg` when wrapping. */
  readonly startDeg: number;
  readonly endDeg: number;
  readonly widthDeg: number;
}

export interface CoverageResult {
  /** 0..100. */
  readonly coveragePct: number;
  /** 36 panels of 10 degrees; true where scanned. */
  readonly panels: readonly boolean[];
  readonly coveredArcs: readonly CoverageArc[];
  readonly largestGap: CoverageArc | null;
  readonly frameCount: number;
  readonly bearingsDeg: readonly number[];
  /** True at or above MIN_COVERAGE_PCT. */
  readonly sufficient: boolean;
}

export interface PlacedObject {
  readonly observationId: string;
  readonly label: ObjectLabel;
  readonly bearingDeg: number;
  readonly distanceBand: DistanceBand;
  /** Unit-circle position for the 2D radar ring; radius by distance band. */
  readonly x: number;
  readonly y: number;
  readonly confidence: number;
}

export interface PairRuleHit {
  readonly hazardKey: HazardKey;
  readonly aObservationId: string;
  readonly bObservationId: string;
  readonly separationDeg: number;
  readonly confidence: number;
  readonly reason: string;
}

/* -------------------------------------------------------------------------- */
/* Engine composition                                                         */
/* -------------------------------------------------------------------------- */

export interface EngineInput {
  readonly submission: CanonicalSubmission;
  readonly enrichment?: readonly ExternalValue[];
  readonly answers?: readonly ExternalValue[];
  readonly observations?: readonly Observation[];
  /** Other accounts' vectors for stage 12. Empty disables peers. */
  readonly peerVectors?: readonly PeerVectorEntry[];
  /**
   * ISO-8601 date. Used for the five-year loss window and for any age
   * arithmetic. The engine never reads the clock.
   */
  readonly asOf: string;
}

export interface EngineConfig {
  readonly spec: VectorSpec;
  readonly rulebook: Rulebook;
  readonly extensions?: Rulebook;
  readonly ratingTable: RatingTable;
  readonly bookStats: BookStats | null;
  readonly questions?: readonly Question[];
  readonly qualityWeights?: QualityWeights;
}

export interface QualityWeights {
  readonly appetite: number;
  readonly adequacy: number;
  readonly lossRatio: number;
  readonly completeness: number;
  readonly confidence: number;
}

export interface EngineResult {
  readonly id: string;
  readonly lineOfBusiness: LineOfBusiness;
  readonly asOf: string;
  readonly specVersion: string;
  readonly rulebookVersion: string;
  readonly ratingVersion: string;
  readonly canonical: CanonicalSubmission;
  readonly rollup: Rollup;
  readonly vector: FeatureVector;
  readonly contradictions: readonly Contradiction[];
  readonly evaluate: EvaluateResult;
  readonly price: PriceBreakdown;
  readonly verdict: VerdictResult;
  readonly flip: FlipResult;
  readonly voi: VoiResult;
  readonly peers: PeerResult | null;
  readonly qualityIndex: number;
  readonly qualityComponents: QualityComponents;
  readonly interpretations: readonly AppliedInterpretation[];
  /** Deterministic template text (PRD 7.7). Never LLM output. */
  readonly explanation: string | null;
}
