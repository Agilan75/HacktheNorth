import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  computeBookStats,
  evaluate,
  flip,
  parseRulebook,
  parseVectorSpec,
  peers,
  scaleVector,
  tiersFor,
  vectorize,
  verdict,
} from '@retrofit/engine';
import type {
  BookStats,
  CanonicalSubmission,
  Contradiction,
  EngineResult,
  EvaluateResult,
  FeatureVector,
  FlipResult,
  LineOfBusiness,
  PeerVectorEntry,
  RatingTable,
  Rollup,
  Rulebook,
  SubmissionType,
  VectorSpec,
  VerdictResult,
} from '@retrofit/engine';

import type {
  ComparisonOutcome,
  EngineResultView,
  FieldDisagreement,
  GeneratedCase,
  NaiveFactorId,
  NaiveInput,
  NaiveResult,
} from './types.js';

/**
 * The engine-vs-naive comparator (V05), PRD §12 layer B.
 *
 * Tolerances come from docs/contracts/INTERPRETATIONS.md §7: 1e-6 on any
 * number, exact equality on every categorical field. A disagreement is a bug in
 * one of the two implementations and is always reported with both sides'
 * numbers.
 *
 * V05 adapts the real `EngineResult` into `EngineResultView` inside this file.
 * Nothing else in `packages/verify` may import `@retrofit/engine`, and
 * `src/naive/**` may never import it at all.
 *
 * Because this is the one file allowed to import the engine, it also carries
 * the engine-side adapters the V05 flip and vector invariants need
 * (`engineVectorForInput`, `engineFlipForCase`, ...). They are exported so the
 * invariants and the worker (V08) reach the engine through this file only.
 * See docs/decisions/V05.md.
 */

/* ------------------------------------------------------------ tolerances */

/** INTERPRETATIONS §7 `SCORE_TOLERANCE`: score, tier values, any engine-vs-naive number. */
const SCORE_TOLERANCE = 1e-6;
/** INTERPRETATIONS §7 `RATIO_TOLERANCE`: ratios, shares, completeness, confidence. */
const RATIO_TOLERANCE = 1e-9;

/** INTERPRETATIONS §2 factor order. */
const FACTOR_ORDER: readonly NaiveFactorId[] = [
  'submission_type',
  'line_of_business',
  'primary_risk_state',
  'tiv',
  'total_premium',
  'building_age',
  'construction_type',
  'loss_value',
];

/* ------------------------------------------------------------ comparator */

function finiteOrNull(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** True when two numbers agree within the INTERPRETATIONS §7 tolerance. */
export function numbersAgree(a: number | null, b: number | null, tolerance: number): boolean {
  // G-1: a non-finite value is missing, exactly like null.
  const x = finiteOrNull(a);
  const y = finiteOrNull(b);
  if (x === null || y === null) return x === y;
  const tol = typeof tolerance === 'number' && Number.isFinite(tolerance) && tolerance > 0 ? tolerance : 0;
  return Math.abs(x - y) <= tol;
}

function sortedUnique(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  const x = sortedUnique(a);
  const y = sortedUnique(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

export function compareResults(
  testCase: GeneratedCase,
  engine: EngineResultView,
  naive: NaiveResult,
): ComparisonOutcome {
  const fields: FieldDisagreement[] = [];

  const numeric = (field: string, e: number | null, n: number | null, tolerance: number): void => {
    if (!numbersAgree(e, n, tolerance)) fields.push({ field, engine: e, naive: n, tolerance });
  };
  const exact = (field: string, e: unknown, n: unknown): void => {
    if (e !== n) fields.push({ field, engine: e, naive: n, tolerance: null });
  };

  numeric('appetiteScore', engine.appetiteScore, naive.appetiteScore, SCORE_TOLERANCE);
  numeric('completeness', engine.completeness, naive.completeness, RATIO_TOLERANCE);
  exact('verdict', engine.verdict, naive.verdict);
  exact('decidingFactorId', engine.decidingFactorId ?? null, naive.decidingFactorId ?? null);

  if (!sameStringSet(engine.knockoutFactorIds, naive.knockoutFactorIds)) {
    fields.push({
      field: 'knockoutFactorIds',
      engine: sortedUnique(engine.knockoutFactorIds),
      naive: sortedUnique(naive.knockoutFactorIds),
      tolerance: null,
    });
  }

  const naiveTiers = new Map<string, number | null>();
  for (const outcome of naive.factors) naiveTiers.set(outcome.factorId, outcome.tierValue);
  for (const factor of FACTOR_ORDER) {
    const e = engine.tierValuesByFactor[factor];
    const n = naiveTiers.get(factor);
    numeric(`tierValue.${factor}`, e ?? null, n ?? null, SCORE_TOLERANCE);
  }

  if (fields.length === 0) return { agreed: true, disagreement: null };
  return {
    agreed: false,
    disagreement: {
      caseId: testCase.caseId,
      seed: testCase.seed,
      input: testCase.input,
      fields,
    },
  };
}

/* --------------------------------------------- EngineResult → the view */

/** Stage 7 + stage 9 outputs, reduced to the fields layer B compares. */
export function toEngineResultView(
  evaluated: EvaluateResult,
  decided: VerdictResult,
): EngineResultView {
  const tierValuesByFactor: Record<string, number | null> = {};
  for (const factor of FACTOR_ORDER) tierValuesByFactor[factor] = null;
  for (const outcome of evaluated.factors) {
    tierValuesByFactor[outcome.factor] = outcome.known ? finiteOrNull(outcome.tierValue) : null;
  }
  return {
    appetiteScore: evaluated.appetiteScore,
    completeness: evaluated.completeness,
    verdict: decided.verdict,
    knockoutFactorIds: [...evaluated.knockoutFactors],
    decidingFactorId: decided.decidingRule === null ? null : String(decided.decidingRule.factor),
    tierValuesByFactor,
  };
}

/** The full engine result, reduced to the view. */
export function engineResultView(result: EngineResult): EngineResultView {
  return toEngineResultView(result.evaluate, result.verdict);
}

/* ------------------------------------------------ engine configuration */

export interface VerifyEngineConfig {
  readonly spec: VectorSpec;
  readonly rulebook: Rulebook;
  /** A fixed reference book (INTERPRETATIONS §8 B1–B12) for scaled space. */
  readonly bookStats: BookStats;
  /** Placeholder; flip tolerates a table pricing cannot use (premium → null). */
  readonly ratingTable: RatingTable;
}

function readEngineJson(relative: string): unknown {
  const path = fileURLToPath(new URL(`../../engine/${relative}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function parseOrCast<T>(parse: (json: unknown) => T, json: unknown): T {
  try {
    return parse(json);
  } catch (err) {
    // E13's loaders may still be a Run-1 stub; the JSON is frozen data either way.
    if (err instanceof Error && err.message.startsWith('NOT_IMPLEMENTED')) return json as T;
    throw err;
  }
}

/** INTERPRETATIONS §8 B1, the base every worked case derives from. */
const B1: NaiveInput = {
  submissionType: 'new_business',
  lineOfBusiness: 'commercial_property',
  primaryState: 'OH',
  totalTiv: 150_000_000,
  quotedPremium: 175_000,
  pctTivPre1990: 0,
  pctTivPost2010: 0,
  pctTivAcceptableConstruction: 0.5,
  fiveYearLoss: 100_000,
  anyBuildingPre1990: false,
  hasOpenHighContradiction: false,
};

/** INTERPRETATIONS §8 B1–B12, as rolled-up inputs. */
export const REFERENCE_INPUTS: readonly NaiveInput[] = [
  B1,
  { ...B1, totalTiv: 150_000_000.01 },
  { ...B1, quotedPremium: 49_999.99 },
  { ...B1, fiveYearLoss: 100_000.01 },
  { ...B1, pctTivAcceptableConstruction: 0.4999 },
  { ...B1, pctTivPre1990: 0.5, anyBuildingPre1990: true },
  { ...B1, pctTivPre1990: 0.500001, anyBuildingPre1990: true },
  { ...B1, pctTivPost2010: 1 },
  { ...B1, totalTiv: 50_000_000, quotedPremium: 75_000 },
  { ...B1, totalTiv: 50_000_000, quotedPremium: 75_000, primaryState: 'NC' },
  { ...B1, totalTiv: 50_000_000, quotedPremium: null },
  { ...B1, totalTiv: 50_000_000, quotedPremium: 75_000, submissionType: 'renewal' },
];

let cachedConfig: VerifyEngineConfig | null = null;

/** The commercial spec and rulebook, read once per thread. */
export function verifyEngineConfig(): VerifyEngineConfig {
  if (cachedConfig !== null) return cachedConfig;
  const spec = parseOrCast(parseVectorSpec, readEngineJson('vectors/commercial.json'));
  const rulebook = parseOrCast(parseRulebook, readEngineJson('rules/commercial.json'));
  const ratingTable = { lineOfBusiness: 'commercial_property' } as unknown as RatingTable;
  const book = REFERENCE_INPUTS.map((input) => vectorFromSubmission(input, spec, rulebook));
  const bookStats = computeBookStats(book, spec);
  cachedConfig = { spec, rulebook, bookStats, ratingTable };
  return cachedConfig;
}

/* ------------------------------------------ NaiveInput → engine inputs */

/**
 * A canonical submission carrying exactly the rolled-up facts of the case.
 * The age-refer trigger (R-AGE-REFER) reaches the engine through
 * `rollup.oldestYearBuilt`: 1989 when a pre-1990 building exists, 1990 when
 * it is known that none does, null when unknown.
 */
export function engineSubmissionForInput(input: NaiveInput, id = 'verify-case'): CanonicalSubmission {
  const provenance = { source: 'self_reported' as const };
  const any = input.anyBuildingPre1990;
  const rollup: Rollup = {
    totalTiv: input.totalTiv,
    buildingCount: 0,
    tivKnownBuildingCount: 0,
    pctTivPre1990: input.pctTivPre1990,
    pctTivPost2010: input.pctTivPost2010,
    pctTivByConstruction: [],
    pctTivAcceptableConstruction: input.pctTivAcceptableConstruction,
    pctTivSprinklered: null,
    tivWeightedProtectionClass: null,
    // Extension-only components are left unset by the generator, so the
    // extension rules never fire in the differential and the naive twin has no
    // flood logic to mirror.
    worstFloodZoneTier: null,
    primaryState: input.primaryState,
    stateShares: [],
    fiveYearLoss: input.fiveYearLoss,
    fiveYearClaimCount: 0,
    claimCount: 0,
    pre1990BuildingIds: any === true ? [`${id}-pre1990`] : [],
    oldestYearBuilt: any === true ? 1989 : any === false ? 1990 : null,
    newestYearBuilt: null,
    lossWindow: null,
  };
  return {
    id,
    // A missing line is patched out of the vector in `vectorFromSubmission`.
    lineOfBusiness: (input.lineOfBusiness ?? 'commercial_property') as LineOfBusiness,
    ...(input.submissionType === null
      ? {}
      : { submissionType: [{ value: input.submissionType as SubmissionType, provenance }] }),
    insured: {},
    locations: [],
    buildings: [],
    hazards: { present: {} },
    exposure: {},
    coverage: { lines: [] },
    history: [],
    pricing:
      input.quotedPremium === null
        ? {}
        : { quotedPremium: [{ value: input.quotedPremium, provenance }] },
    rollup,
  };
}

function vectorFromSubmission(input: NaiveInput, spec: VectorSpec, rulebook: Rulebook): FeatureVector {
  const vector = vectorize(engineSubmissionForInput(input), spec, rulebook);
  if (input.lineOfBusiness !== null) return vector;
  // `CanonicalSubmission.lineOfBusiness` cannot be absent, so a missing line
  // (G-2) is expressed on the vector itself: m = 0, x = t = null.
  const index = spec.components.findIndex((c) => c.key === 'isPropertyLine');
  if (index < 0) return vector;
  const x = vector.x.slice();
  x[index] = null;
  const m = x.map((v) => (v === null ? 0 : 1)) as (0 | 1)[];
  return { ...vector, x, m, t: tiersFor(x, spec, rulebook) };
}

/** Stage 6 on the case's rolled-up facts. */
export function engineVectorForInput(input: NaiveInput): FeatureVector {
  const { spec, rulebook } = verifyEngineConfig();
  return vectorFromSubmission(input, spec, rulebook);
}

function contradictionsFor(input: NaiveInput): Contradiction[] {
  if (!input.hasOpenHighContradiction) return [];
  return [
    {
      id: 'verify-open-high',
      canonicalPath: 'rollup.totalTiv',
      values: [],
      severity: 'HIGH',
      affectedRules: [],
      status: 'open',
    },
  ];
}

/** Stages 7 and 9 on a vector, in the case's submission context. */
export function engineEvaluateVector(
  vector: FeatureVector,
  input: NaiveInput,
  withContradictions = true,
): { readonly evaluated: EvaluateResult; readonly verdict: VerdictResult } {
  const { spec, rulebook } = verifyEngineConfig();
  const evaluated = evaluate(vector, spec, rulebook, engineSubmissionForInput(input));
  const decided = verdict(evaluated, withContradictions ? contradictionsFor(input) : []);
  return { evaluated, verdict: decided };
}

/** Layer B's engine side: the case's rolled-up facts through stages 6, 7, 9. */
export function engineViewForInput(input: NaiveInput): EngineResultView & {
  readonly confidence: number;
} {
  const run = engineEvaluateVector(engineVectorForInput(input), input);
  return { ...toEngineResultView(run.evaluated, run.verdict), confidence: run.evaluated.confidence };
}

const flipMemo = new WeakMap<GeneratedCase, FlipResult>();

/** Stage 10 for a case, memoised per case object (three invariants read it). */
export function engineFlipForCase(testCase: GeneratedCase): FlipResult {
  const memo = flipMemo.get(testCase);
  if (memo !== undefined) return memo;
  const { spec, rulebook, ratingTable, bookStats } = verifyEngineConfig();
  const vector = engineVectorForInput(testCase.input);
  const result = flip(
    vector,
    spec,
    rulebook,
    ratingTable,
    engineSubmissionForInput(testCase.input, testCase.caseId),
    bookStats,
  );
  flipMemo.set(testCase, result);
  return result;
}

/** `x` with the flip's moves applied, and `t`/`m` re-derived. */
export function engineApplyMoves(
  vector: FeatureVector,
  moves: readonly { readonly componentIndex: number; readonly to: number }[],
): FeatureVector {
  const { spec, rulebook } = verifyEngineConfig();
  const x = vector.x.slice();
  for (const move of moves) x[move.componentIndex] = move.to;
  const m = x.map((v) => (v === null ? 0 : 1)) as (0 | 1)[];
  return { ...vector, x, m, t: tiersFor(x, spec, rulebook) };
}

/** Stage 6 scaling against the given book (default: the reference book). */
export function engineScaleVector(
  x: readonly (number | null)[],
  bookStats: BookStats | null = verifyEngineConfig().bookStats,
): (number | null)[] {
  return scaleVector(x, verifyEngineConfig().spec, bookStats);
}

/** Book statistics over the given vectors (commercial spec). */
export function engineBookStats(vectors: readonly FeatureVector[]): BookStats {
  return computeBookStats(vectors, verifyEngineConfig().spec);
}

/** Stage 6 on an arbitrary canonical submission (commercial spec + rulebook). */
export function engineVectorize(submission: CanonicalSubmission): FeatureVector {
  const { spec, rulebook } = verifyEngineConfig();
  return vectorize(submission, spec, rulebook);
}

/**
 * The stage-12 peer distance from `a` to `b` (P-1), through the real `peers`
 * stage, or `null` when the pair is not a peer.
 */
export function enginePeerDistance(
  a: FeatureVector,
  b: FeatureVector,
  bookStats: BookStats | null = verifyEngineConfig().bookStats,
): { readonly distance: number; readonly componentsUsed: readonly number[] } | null {
  const entry: PeerVectorEntry = {
    id: 'peer',
    vector: b,
    totalTiv: null,
    quotedPremium: null,
    ratePer100: null,
    annualLoss: null,
    coarse: false,
  };
  const result = peers(a, verifyEngineConfig().spec, [entry], bookStats, 1);
  const match = result.peers[0];
  if (match === undefined) return null;
  return { distance: match.distance, componentsUsed: result.componentsUsed };
}
