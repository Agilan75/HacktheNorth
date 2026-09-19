/** Stage 13 — rank, plus the quality index. Body owned by Run 1 unit E10. */
import type { EngineResult, QualityComponents, QualityWeights, RankedEntry } from '../types.js';

export function qualityIndex(
  _result: EngineResult,
  _weights: QualityWeights,
): { index: number; components: QualityComponents } {
  throw new Error('NOT_IMPLEMENTED:E10');
}

/**
 * Knockouts rank below every non-knockout regardless of index, ordered among
 * themselves by distance to appetite, then by index.
 */
export function rank(
  _results: readonly EngineResult[],
  _weights?: QualityWeights,
): RankedEntry[] {
  throw new Error('NOT_IMPLEMENTED:E10');
}
