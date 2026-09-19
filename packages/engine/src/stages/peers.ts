/** Stage 12 — peers. Body owned by Run 1 unit E10. */
import type {
  BookStats,
  FeatureVector,
  PeerResult,
  PeerVectorEntry,
  VectorSpec,
} from '../types.js';

export function peers(
  _vector: FeatureVector,
  _spec: VectorSpec,
  _candidates: readonly PeerVectorEntry[],
  _bookStats: BookStats | null,
  _k?: number,
): PeerResult {
  throw new Error('NOT_IMPLEMENTED:E10');
}

/**
 * The reduced vector used for the 11 accounts with no policy: requested limit,
 * insured revenue and headquarters state only. Matches are labelled coarse.
 */
export function reduceForCoarseMatch(
  _vector: FeatureVector,
  _spec: VectorSpec,
): FeatureVector {
  throw new Error('NOT_IMPLEMENTED:E10');
}
