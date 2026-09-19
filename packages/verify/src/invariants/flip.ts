import type { Invariant, InvariantSuite } from '../types.js';

/**
 * Flip invariants (V05): applying the returned flip always yields FIT, a flip
 * never moves more than two components, and it never touches an immovable one
 * (INTERPRETATIONS F-1..F-6).
 *
 * Stubs frozen by W0-4; unit V05 replaces these bodies only.
 */
export const appliedFlipYieldsFit: Invariant = () => {
  throw new Error('NOT_IMPLEMENTED:V05');
};

export const flipMovesAtMostTwoComponents: Invariant = () => {
  throw new Error('NOT_IMPLEMENTED:V05');
};

export const flipNeverTouchesImmovable: Invariant = () => {
  throw new Error('NOT_IMPLEMENTED:V05');
};

export function flipSuite(): InvariantSuite {
  throw new Error('NOT_IMPLEMENTED:V05');
}
