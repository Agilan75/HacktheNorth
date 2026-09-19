/**
 * The deterministic explanation template (PRD §7.7). Never LLM output: all 158
 * explanations exist instantly and can never contradict the numbers.
 * Body owned by Run 1 unit F12.
 */
import type { EngineResult } from '@retrofit/engine';
import type { Explanation, Recommendation } from '../types';

export interface ExplainInput {
  readonly result: EngineResult;
  readonly insuredName?: string | null;
  /** 1-based queue position, when known. */
  readonly rank?: number | null;
}

/** accept / review / decline / investigate, from the verdict and the flip. */
export function recommendationFor(_result: EngineResult): Recommendation {
  throw new Error('NOT_IMPLEMENTED:F12');
}

/** "In appetite on TIV and state, out on premium." */
export function mixedCaseSentence(_result: EngineResult): string | null {
  throw new Error('NOT_IMPLEMENTED:F12');
}

export function explain(_input: ExplainInput): Explanation {
  throw new Error('NOT_IMPLEMENTED:F12');
}
