/**
 * Hand-built submissions with their expected vectors. Body owned by Run 1 unit E16.
 *
 * These are the engine's own unit fixtures: small, fully specified, and paired
 * with the exact `x`, `t` and `m` arrays INTERPRETATIONS.md says they must
 * produce. They are what stages 3-11 are tested against before any real data.
 */
import type { CanonicalSubmission, FeatureVector } from '../types.js';

export interface SyntheticCase {
  readonly id: string;
  readonly why: string;
  readonly submission: CanonicalSubmission;
  readonly expectedVector: FeatureVector;
  readonly expectedAppetite: number;
  readonly expectedVerdict: 'FIT' | 'REFER' | 'DOES_NOT_FIT';
}

/** One case per INTERPRETATIONS boundary, plus the all-missing and extreme cases. */
export function syntheticCases(): readonly SyntheticCase[] {
  throw new Error('NOT_IMPLEMENTED:E16');
}
