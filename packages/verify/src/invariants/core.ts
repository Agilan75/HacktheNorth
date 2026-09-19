import type { Invariant, InvariantSuite } from '../types.js';

/**
 * Core invariants (V04), PRD §12 layer A: determinism, knockout implies
 * DOES_NOT_FIT, completeness and confidence stay in range, no crash on nulls,
 * empty arrays or absurd values.
 *
 * Stubs frozen by W0-4; unit V04 replaces these bodies only.
 */
export const determinism: Invariant = () => {
  throw new Error('NOT_IMPLEMENTED:V04');
};

export const knockoutImpliesDoesNotFit: Invariant = () => {
  throw new Error('NOT_IMPLEMENTED:V04');
};

export const scoreInRange: Invariant = () => {
  throw new Error('NOT_IMPLEMENTED:V04');
};

export const completenessAndConfidenceInRange: Invariant = () => {
  throw new Error('NOT_IMPLEMENTED:V04');
};

export function coreSuite(): InvariantSuite {
  throw new Error('NOT_IMPLEMENTED:V04');
}
