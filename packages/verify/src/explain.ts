/**
 * One case of the layer A+B run, rebuilt and worked in full: what was
 * generated, what the engine decided and on which rule, what the naive
 * implementation decided, where they were compared, and every invariant that
 * was checked against it. This is exactly what `runChunk` does to a case,
 * except that it keeps the working instead of only counting failures.
 *
 * The API loads this file at runtime for `GET /verification/cases/:index`.
 */
import { compareResults, engineEvaluateVector, engineVectorForInput, toEngineResultView } from './compare.js';
import { classifyStratum } from './gen/stratify.js';
import { generateSubmission } from './gen/submissions.js';
import { coreSuite, setInvariantProbe } from './invariants/core.js';
import { flipSuite } from './invariants/flip.js';
import { monotonicSuite } from './invariants/monotonic.js';
import { vectorSuite } from './invariants/vector.js';
import { naiveEvaluate } from './naive/index.js';
import { engineViewForInput } from './compare.js';
import type {
  BoundaryPosition,
  FieldDisagreement,
  GeneratedBuilding,
  InvariantSuite,
  NaiveInput,
  NaiveResult,
} from './types.js';
import { caseAt } from './worker.js';

export interface ExplainedFactor {
  readonly factor: string;
  readonly tier: string | null;
  readonly tierValue: number | null;
  readonly weight: number;
  readonly points: number;
  readonly knockout: boolean;
  readonly refer: boolean;
  readonly ruleId: string | null;
  readonly citation: { readonly doc: string; readonly section: string; readonly quote: string } | null;
  /** The naive implementation's tier label for the same factor. */
  readonly naiveTier: string | null;
  /** The naive implementation's tier value; this, not the label, is what the comparator diffs. */
  readonly naiveTierValue: number | null;
  readonly naivePoints: number | null;
}

export interface ExplainedInvariant {
  readonly suite: string;
  readonly name: string;
  readonly violations: readonly string[];
}

export interface ExplainedCase {
  readonly caseId: string;
  readonly seed: number;
  readonly index: number;
  readonly stratum: string | null;
  readonly fromSubmission: boolean;
  /** The buildings the facts were rolled up from; null for a directly generated case. */
  readonly buildings: readonly GeneratedBuilding[] | null;
  readonly input: NaiveInput;
  readonly boundaries: Readonly<Record<string, BoundaryPosition>>;
  readonly engine: {
    readonly verdict: string;
    readonly appetiteScore: number;
    readonly completeness: number;
    readonly decidingFactorId: string | null;
    readonly decidingRule: {
      readonly ruleId: string;
      readonly factor: string;
      readonly tier: string;
      readonly citation: { readonly doc: string; readonly section: string; readonly quote: string };
    } | null;
    readonly reasons: readonly string[];
    readonly knockoutFactorIds: readonly string[];
  };
  readonly naive: Pick<
    NaiveResult,
    'verdict' | 'appetiteScore' | 'completeness' | 'decidingFactorId' | 'knockoutFactorIds' | 'referReasons'
  >;
  readonly factors: readonly ExplainedFactor[];
  readonly agreed: boolean;
  readonly disagreements: readonly FieldDisagreement[];
  readonly invariants: readonly ExplainedInvariant[];
}

let suites: readonly InvariantSuite[] | null = null;

function allSuites(): readonly InvariantSuite[] {
  if (suites === null) {
    setInvariantProbe(engineViewForInput);
    suites = [coreSuite(), monotonicSuite(), flipSuite(), vectorSuite()];
  }
  return suites;
}

export function explainCase(seed: number, index: number): ExplainedCase {
  const testCase = caseAt(seed, index);
  const run = engineEvaluateVector(engineVectorForInput(testCase.input), testCase.input);
  const view = { ...toEngineResultView(run.evaluated, run.verdict), confidence: run.evaluated.confidence };
  const naive = naiveEvaluate(testCase.input);
  const outcome = compareResults(testCase, view, naive);

  const naiveByFactor = new Map(naive.factors.map((f) => [f.factorId as string, f]));
  const factors = run.evaluated.factors.map((f): ExplainedFactor => {
    const n = naiveByFactor.get(f.factor);
    return {
      factor: f.factor,
      tier: f.tier,
      tierValue: f.known ? f.tierValue : null,
      weight: f.weight,
      points: f.points,
      knockout: f.knockout,
      refer: f.refer,
      ruleId: f.ruleId,
      citation: f.citation,
      naiveTier: n?.tier ?? null,
      naiveTierValue: n?.tierValue ?? null,
      naivePoints: n?.points ?? null,
    };
  });

  const invariants: ExplainedInvariant[] = [];
  for (const suite of allSuites()) {
    for (const inv of suite.invariants) {
      invariants.push({
        suite: suite.name,
        name: inv.name,
        violations: inv.check(testCase, view).map((v) => v.message),
      });
    }
  }

  return {
    caseId: testCase.caseId,
    seed,
    index,
    stratum: classifyStratum(testCase),
    fromSubmission: testCase.fromSubmission,
    buildings: testCase.fromSubmission ? generateSubmission(seed, index).buildings : null,
    input: testCase.input,
    boundaries: testCase.boundaries,
    engine: {
      verdict: view.verdict,
      appetiteScore: view.appetiteScore,
      completeness: view.completeness,
      decidingFactorId: view.decidingFactorId,
      decidingRule: run.verdict.decidingRule,
      reasons: run.verdict.reasons,
      knockoutFactorIds: view.knockoutFactorIds,
    },
    naive: {
      verdict: naive.verdict,
      appetiteScore: naive.appetiteScore,
      completeness: naive.completeness,
      decidingFactorId: naive.decidingFactorId,
      knockoutFactorIds: naive.knockoutFactorIds,
      referReasons: naive.referReasons,
    },
    factors,
    agreed: outcome.disagreement === null,
    disagreements: outcome.disagreement?.fields ?? [],
    invariants,
  };
}
