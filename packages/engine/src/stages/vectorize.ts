/** Stage 6 — vectorize, plus the book statistics it scales against. Body owned by Run 1 unit E05. */
import type {
  BookStats,
  CanonicalSubmission,
  FeatureVector,
  Rulebook,
  VectorSpec,
} from '../types.js';

/**
 * Pure function of the merged submission. `bookStats` only affects the scaled
 * space used by peers and flip; `x`, `t` and `m` are independent of it.
 */
export function vectorize(
  _submission: CanonicalSubmission,
  _spec: VectorSpec,
  _rulebook: Rulebook,
): FeatureVector {
  throw new Error('NOT_IMPLEMENTED:E05');
}

/** The tier vector alone, for tests that build `x` directly. */
export function tiersFor(
  _x: readonly (number | null)[],
  _spec: VectorSpec,
  _rulebook: Rulebook,
): (number | null)[] {
  throw new Error('NOT_IMPLEMENTED:E05');
}

/** Each component of `x` mapped into 0..1 scaling space per its spec rule. */
export function scaleVector(
  _x: readonly (number | null)[],
  _spec: VectorSpec,
  _stats: BookStats | null,
): (number | null)[] {
  throw new Error('NOT_IMPLEMENTED:E05');
}

/** Min/max/mean/median per component, computed over the whole book. */
export function computeBookStats(
  _vectors: readonly FeatureVector[],
  _spec: VectorSpec,
): BookStats {
  throw new Error('NOT_IMPLEMENTED:E05');
}
