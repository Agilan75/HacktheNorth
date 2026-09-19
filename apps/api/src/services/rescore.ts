/**
 * Re-score: recompute `BookStats`, run the engine over one or every account,
 * then peers and rank across the whole set. Unit A16.
 */
import type { EngineResult, ExternalValue } from '@retrofit/engine';
import type { ScoreSnapshotDto } from '@retrofit/contracts';
import type { Deps } from './types';

export interface RescoreOneInput {
  readonly submissionId: string;
  readonly extra?: readonly ExternalValue[];
}

export interface RescoreOneResult {
  readonly before: ScoreSnapshotDto | null;
  readonly after: ScoreSnapshotDto;
  readonly result: EngineResult;
  readonly rankChanged: boolean;
}

export function rescoreOne(
  _deps: Deps,
  _input: RescoreOneInput,
): Promise<RescoreOneResult> {
  throw new Error('NOT_IMPLEMENTED:A16');
}

/** Re-runs peers and rank across the book and writes the new positions. */
export function rescoreBook(_deps: Deps): Promise<number> {
  throw new Error('NOT_IMPLEMENTED:A16');
}

export function snapshotOf(_result: EngineResult, _rank: number | null): ScoreSnapshotDto {
  throw new Error('NOT_IMPLEMENTED:A16');
}
