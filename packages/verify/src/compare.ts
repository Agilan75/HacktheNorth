import type {
  ComparisonOutcome,
  EngineResultView,
  GeneratedCase,
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
 * Stubs frozen by W0-4; unit V05 replaces these bodies only.
 */
export function compareResults(
  _testCase: GeneratedCase,
  _engine: EngineResultView,
  _naive: NaiveResult,
): ComparisonOutcome {
  throw new Error('NOT_IMPLEMENTED:V05');
}

/** True when two numbers agree within the INTERPRETATIONS §7 tolerance. */
export function numbersAgree(_a: number | null, _b: number | null, _tolerance: number): boolean {
  throw new Error('NOT_IMPLEMENTED:V05');
}
