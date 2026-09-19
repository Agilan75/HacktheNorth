/** Stage 10 — flip. Body owned by Run 1 unit E08. */
import type {
  BookStats,
  CanonicalSubmission,
  FeatureVector,
  FlipResult,
  RatingTable,
  Rulebook,
  VectorSpec,
} from '../types.js';

/** The acceptable interval for one component, in raw (x) units. */
export interface FlipBound {
  readonly componentIndex: number;
  readonly componentKey: string;
  readonly min: number | null;
  readonly max: number | null;
  readonly satisfied: boolean;
  readonly immovable: boolean;
}

/** Turn the rulebook's thresholds into per-component acceptable intervals. */
export function flipBounds(
  _vector: FeatureVector,
  _spec: VectorSpec,
  _rulebook: Rulebook,
): FlipBound[] {
  throw new Error('NOT_IMPLEMENTED:E08');
}

/** The shortest scaled move over at most 2 movable components that reaches FIT. */
export function flip(
  _vector: FeatureVector,
  _spec: VectorSpec,
  _rulebook: Rulebook,
  _table: RatingTable,
  _submission: CanonicalSubmission,
  _bookStats: BookStats | null,
): FlipResult {
  throw new Error('NOT_IMPLEMENTED:E08');
}
