/** Stage 7 — evaluate. Body owned by Run 1 unit E06. */
import type {
  CanonicalSubmission,
  EvaluateResult,
  FeatureVector,
  Rulebook,
  VectorSpec,
} from '../types.js';

export function evaluate(
  _vector: FeatureVector,
  _spec: VectorSpec,
  _rulebook: Rulebook,
  _submission: CanonicalSubmission,
  _extensions?: Rulebook,
): EvaluateResult {
  throw new Error('NOT_IMPLEMENTED:E06');
}
