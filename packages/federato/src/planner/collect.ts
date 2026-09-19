/** Step 2 of PRD §7.5: collect the fields the rules need. Body: Run 1 unit F08. */
import type { RatingTable, Rulebook, VectorSpec } from '@retrofit/engine';
import type { NeededField } from '../types';

export interface CollectInput {
  readonly spec: VectorSpec;
  readonly rulebook: Rulebook;
  readonly extensions?: Rulebook | undefined;
  readonly ratingTable?: RatingTable | undefined;
}

/**
 * Walks every rule condition and every rating factor and returns the canonical
 * paths they read, each carrying the rules that need it.
 */
export function collectNeededFields(_input: CollectInput): readonly NeededField[] {
  throw new Error('NOT_IMPLEMENTED:F08');
}
