/**
 * Fixtures built from the real Federato snapshot. Body owned by Run 1 unit E17.
 *
 * The 27 property policies that carry buildings and a premium, normalized to
 * CanonicalSubmission, plus the 11 property submissions with no policy. These
 * back the golden test and are the rows the rating fit is trained on.
 */
import type { CanonicalSubmission } from '../types.js';

export interface RealCase {
  readonly externalId: string;
  readonly submission: CanonicalSubmission;
  readonly hasPolicy: boolean;
}

/** Loads from packages/federato's committed snapshot. Never hits the network. */
export function realCases(): readonly RealCase[] {
  throw new Error('NOT_IMPLEMENTED:E17');
}
