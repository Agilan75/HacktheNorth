/** Stage 11 — voi. Body owned by Run 1 unit E09. */
import type {
  EvaluateResult,
  FeatureVector,
  Question,
  Rulebook,
  VectorSpec,
  VoiResult,
} from '../types.js';

export function voi(
  _vector: FeatureVector,
  _spec: VectorSpec,
  _rulebook: Rulebook,
  _evaluated: EvaluateResult,
  _questions: readonly Question[],
  _askedQuestionIds?: readonly string[],
): VoiResult {
  throw new Error('NOT_IMPLEMENTED:E09');
}
