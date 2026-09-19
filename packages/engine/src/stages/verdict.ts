/** Stage 9 — verdict. Body owned by Run 1 unit E06. */
import type { Contradiction, EvaluateResult, FlipResult, VerdictResult } from '../types.js';

/**
 * knockout -> DOES_NOT_FIT; else completeness < 100 or an open HIGH
 * contradiction or a fired refer rule -> REFER; else FIT.
 * `flip` is optional: when supplied it fills `distanceToAppetite`.
 */
export function verdict(
  _evaluated: EvaluateResult,
  _contradictions: readonly Contradiction[],
  _flip?: FlipResult,
): VerdictResult {
  throw new Error('NOT_IMPLEMENTED:E06');
}
