/**
 * Step 5 of PRD §7.5: adapt. Zero results -> retry with `$elemMatch` in place
 * of a dot-path, or drop the narrowest filter, and record that it did.
 * Body owned by Run 1 unit F10.
 */
import type { AdaptationKind, QueryClause, QueryPayload } from '../types';

export interface Adaptation {
  readonly kind: AdaptationKind;
  readonly payload: QueryPayload;
  readonly why: string;
}

/** `{'a.b.c': v}` -> `{a: {$elemMatch: {b: {c: v}}}}` at the array boundary. */
export function swapToElemMatch(
  _clause: QueryClause,
  _arrayPaths: readonly string[],
): QueryClause | null {
  throw new Error('NOT_IMPLEMENTED:F10');
}

/** Removes the single most selective condition, so the query widens by one step. */
export function dropNarrowestFilter(_clause: QueryClause): QueryClause | null {
  throw new Error('NOT_IMPLEMENTED:F10');
}

/** Returns the next thing to try, or null when nothing is left to adapt. */
export function nextAdaptation(
  _payload: QueryPayload,
  _attempted: readonly AdaptationKind[],
  _arrayPaths: readonly string[],
): Adaptation | null {
  throw new Error('NOT_IMPLEMENTED:F10');
}
