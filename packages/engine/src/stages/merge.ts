/** Stage 4 — merge. Body owned by Run 1 unit E04. */
import type { CanonicalSubmission, ExternalValue, Observation } from '../types.js';

export function merge(
  _submission: CanonicalSubmission,
  _enrichment: readonly ExternalValue[],
  _observations: readonly Observation[],
  _answers: readonly ExternalValue[],
): CanonicalSubmission {
  throw new Error('NOT_IMPLEMENTED:E04');
}
