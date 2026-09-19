/**
 * FROZEN (W0-4) — the verification contract, PRD §12.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ THIS FILE IMPORTS NOTHING FROM `@retrofit/engine`, NOW OR EVER.          │
 * │                                                                         │
 * │ `packages/verify` holds the deliberately independent second             │
 * │ implementation (layer B). If the verifier borrowed the engine's types,   │
 * │ the engine's reading of the guidelines would leak into the oracle and    │
 * │ the differential test would agree with itself. Every shape the verifier  │
 * │ needs is therefore restated here, structurally, from the PDF and from    │
 * │ docs/contracts/INTERPRETATIONS.md.                                       │
 * │                                                                         │
 * │ CP1 greps for "@retrofit/engine" under packages/verify/src/naive and it  │
 * │ must return nothing. Only the comparator (V05) and the worker (V08) may  │
 * │ import the engine at all, and they do it in their own files.             │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

/* ------------------------------------------------- the naive oracle (V01) */

export type NaiveVerdict = 'FIT' | 'REFER' | 'DOES_NOT_FIT';
export type NaiveTierLabel = 'target' | 'acceptable' | 'not_acceptable';

/** The eight appetite factors of AG p2, in INTERPRETATIONS §2 weight order. */
export type NaiveFactorId =
  | 'submission_type'
  | 'line_of_business'
  | 'primary_risk_state'
  | 'tiv'
  | 'total_premium'
  | 'building_age'
  | 'construction_type'
  | 'loss_value';

/**
 * The rolled-up facts of one submission, in raw units, exactly as
 * `NAIVE_SPEC.md` describes them. `null` means **missing** (INTERPRETATIONS
 * G-1/G-2), never zero.
 */
export interface NaiveInput {
  /** `'new_business' | 'renewal'` or any other string, which is not acceptable. */
  readonly submissionType: string | null;
  /** `'commercial_property'` is property; anything else is another line. */
  readonly lineOfBusiness: string | null;
  /** Two-letter US state code of the largest TIV share (I-1). */
  readonly primaryState: string | null;
  /** Dollars. `$150M` is `150000000`. */
  readonly totalTiv: number | null;
  /** Dollars, the quoted total premium. */
  readonly quotedPremium: number | null;
  /** Share of known TIV in buildings with `yearBuilt < 1990`, in [0, 1]. */
  readonly pctTivPre1990: number | null;
  /** Share of known TIV in buildings with `yearBuilt >= 2010`, in [0, 1]. */
  readonly pctTivPost2010: number | null;
  /** Share of known TIV in acceptable construction classes, in [0, 1]. */
  readonly pctTivAcceptableConstruction: number | null;
  /** Five-year incurred loss value, in dollars. */
  readonly fiveYearLoss: number | null;
  /** True when at least one building is pre-1990 (drives the REFER path). */
  readonly anyBuildingPre1990: boolean | null;
  /** True when an unresolved HIGH-severity contradiction is open (V-3). */
  readonly hasOpenHighContradiction: boolean;
}

/** One factor's outcome in the naive implementation. */
export interface NaiveFactorOutcome {
  readonly factorId: NaiveFactorId;
  /** `null` when the input was missing: `m = 0`, 0 points, lowers completeness. */
  readonly tier: NaiveTierLabel | null;
  /** 0, 0.6 or 1; `null` when missing. */
  readonly tierValue: number | null;
  readonly weight: number;
  /** `weight * tierValue * 100`, or 0 when missing. */
  readonly points: number;
  readonly knockout: boolean;
}

/** What the naive implementation returns, and what the comparator diffs. */
export interface NaiveResult {
  readonly appetiteScore: number;
  readonly completeness: number;
  readonly verdict: NaiveVerdict;
  readonly knockoutFactorIds: readonly NaiveFactorId[];
  readonly referReasons: readonly string[];
  readonly decidingFactorId: NaiveFactorId | null;
  readonly factors: readonly NaiveFactorOutcome[];
}

/** The single entry point `packages/verify/src/naive/index.ts` must export. */
export type NaiveEvaluate = (input: NaiveInput) => NaiveResult;

/* ---------------------------------------------- what the engine gives back */

/**
 * A structural, minimal view of the engine's result. Declared here rather than
 * imported so that nothing in this package depends on engine types. The
 * comparator (V05) adapts the real `EngineResult` into this shape.
 */
export interface EngineResultView {
  readonly appetiteScore: number;
  readonly completeness: number;
  readonly verdict: NaiveVerdict;
  readonly knockoutFactorIds: readonly string[];
  readonly decidingFactorId: string | null;
  readonly tierValuesByFactor: Readonly<Record<string, number | null>>;
}

/* --------------------------------------------------- generation (V02/V03) */

/** A seeded, reproducible pseudo-random source. Same seed → same stream. */
export interface Prng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Integer in [min, max]. */
  int(min: number, max: number): number;
  /** One element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** True with probability p. */
  chance(p: number): boolean;
  /** The seed this stream was created with. */
  readonly seed: number;
}

/** Where a sampled value sits relative to a guideline threshold. */
export type BoundaryPosition = 'under' | 'at' | 'over' | 'far_under' | 'far_over' | 'random';

/** One generated test case, fully described by its seed and index. */
export interface GeneratedCase {
  readonly caseId: string;
  readonly seed: number;
  readonly index: number;
  readonly input: NaiveInput;
  /** Which components were deliberately placed on a boundary. */
  readonly boundaries: Readonly<Record<string, BoundaryPosition>>;
  /** True when the case came from a full multi-building submission (V03). */
  readonly fromSubmission: boolean;
}

/** A generated multi-building submission, before rollup. */
export interface GeneratedBuilding {
  readonly id: string;
  readonly state: string | null;
  readonly yearBuilt: number | null;
  readonly constructionType: string | null;
  readonly tiv: number | null;
  readonly sprinklered: boolean | null;
  readonly protectionClass: number | null;
}

export interface GeneratedSubmission {
  readonly caseId: string;
  readonly seed: number;
  readonly submissionType: string | null;
  readonly lineOfBusiness: string | null;
  readonly quotedPremium: number | null;
  readonly fiveYearLoss: number | null;
  readonly buildings: readonly GeneratedBuilding[];
}

/** A layer-C stratum: one threshold or ambiguity being over-sampled. */
export interface Stratum {
  readonly key: string;
  readonly description: string;
  readonly targetCount: number;
}

export interface StratifiedCase {
  readonly stratum: string;
  readonly case: GeneratedCase;
}

/* ---------------------------------------------------- invariants (V04/V05) */

export interface InvariantViolation {
  readonly invariant: string;
  readonly caseId: string;
  readonly seed: number;
  readonly message: string;
  readonly observed: unknown;
  readonly expected: unknown;
}

/** An invariant returns an empty array when the case obeys it. */
export type Invariant = (
  testCase: GeneratedCase,
  result: EngineResultView,
) => readonly InvariantViolation[];

export interface InvariantSuite {
  readonly name: string;
  readonly invariants: readonly { readonly name: string; readonly check: Invariant }[];
}

/* --------------------------------------------------- the comparator (V05) */

export interface FieldDisagreement {
  readonly field: string;
  readonly engine: unknown;
  readonly naive: unknown;
  readonly tolerance: number | null;
}

export interface Disagreement {
  readonly caseId: string;
  readonly seed: number;
  readonly input: NaiveInput;
  readonly fields: readonly FieldDisagreement[];
}

export interface ComparisonOutcome {
  readonly agreed: boolean;
  readonly disagreement: Disagreement | null;
}

/* ------------------------------------------------ the run (V07/V08 layers) */

export interface RunConfig {
  /** Total cases to run across all workers. */
  readonly total: number;
  readonly seed: number;
  readonly workers: number;
  readonly chunkSize: number;
  /** Stop after this many disagreements are recorded. 0 = never stop. */
  readonly maxDisagreements: number;
  readonly outDir: string;
}

export interface ChunkRequest {
  readonly chunkId: number;
  readonly seed: number;
  readonly startIndex: number;
  readonly count: number;
}

export interface ChunkResult {
  readonly chunkId: number;
  /** Cases actually completed, which may be fewer than requested. */
  readonly completed: number;
  readonly violations: readonly InvariantViolation[];
  readonly disagreements: readonly Disagreement[];
  readonly errors: readonly { readonly caseId: string; readonly message: string }[];
  readonly durationMs: number;
}

export interface RunSummary {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly config: RunConfig;
  /** The real number of cases completed — never the number requested. */
  readonly completed: number;
  readonly invariantViolations: number;
  readonly disagreements: number;
  readonly errors: number;
  readonly casesPerSecond: number;
  readonly firstViolations: readonly InvariantViolation[];
  readonly firstDisagreements: readonly Disagreement[];
}

export interface WilsonInterval {
  readonly point: number;
  readonly low: number;
  readonly high: number;
  readonly n: number;
  readonly confidence: number;
}

/* ----------------------------------------------------------- layer C (V09) */

/** Facts handed to the model. It never sees engine output (PRD §12). */
export interface LayerCFacts {
  readonly caseId: string;
  readonly text: string;
}

export interface LayerCJudgement {
  readonly verdict: NaiveVerdict;
  readonly decidingFactor: string;
  readonly reasoning: string;
}

export interface LayerCCaseResult {
  readonly caseId: string;
  readonly stratum: string;
  readonly engine: EngineResultView;
  readonly model: LayerCJudgement;
  readonly agreed: boolean;
  readonly cached: boolean;
}

export interface LayerCConfig {
  /** All 38 real property submissions plus this many generated cases. */
  readonly generatedCount: number;
  readonly seed: number;
  readonly concurrency: number;
  readonly cacheDir: string;
  readonly outDir: string;
  readonly resume: boolean;
}

export interface LayerCSummary {
  readonly total: number;
  readonly agreed: number;
  readonly agreement: WilsonInterval;
  readonly byStratum: readonly {
    readonly stratum: string;
    readonly total: number;
    readonly agreed: number;
  }[];
  readonly disagreements: readonly LayerCCaseResult[];
}

/* ------------------------------------------------ extraction check (V06) */

export interface BrokerReplyFixture {
  readonly id: string;
  readonly style: 'clean' | 'partial' | 'vague' | 'self_contradicting' | 'loss_run';
  readonly text: string;
  readonly expected: Readonly<Record<string, string | number | boolean | null>>;
}

export interface ExtractionScore {
  readonly fixtures: number;
  readonly fieldsExpected: number;
  readonly fieldsCorrect: number;
  readonly fieldAccuracy: number;
  /** How often a wrong value still cleared the 0.8 confidence gate. */
  readonly wrongThroughGate: number;
}
