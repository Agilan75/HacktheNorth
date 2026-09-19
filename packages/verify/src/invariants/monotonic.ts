import type { Invariant, InvariantSuite } from '../types.js';

/**
 * Monotonicity invariants (V04): improving any factor never lowers the
 * appetite score, and the premium moves monotonically in every factor.
 *
 * Stubs frozen by W0-4; unit V04 replaces these bodies only.
 */
export const scoreMonotonicInEveryFactor: Invariant = () => {
  throw new Error('NOT_IMPLEMENTED:V04');
};

export const premiumMonotonicInEveryFactor: Invariant = () => {
  throw new Error('NOT_IMPLEMENTED:V04');
};

export function monotonicSuite(): InvariantSuite {
  throw new Error('NOT_IMPLEMENTED:V04');
}
