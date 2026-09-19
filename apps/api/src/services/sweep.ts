/** The sweep pipeline; it is what drives the `stage` column. Unit A18. */
import type { SweepCreateRequestDto, SweepDto } from '@retrofit/contracts';
import type { Deps } from './types';

export function createSweep(
  _deps: Deps,
  _request: SweepCreateRequestDto,
): Promise<SweepDto> {
  throw new Error('NOT_IMPLEMENTED:A18');
}

/** Advances one stage: quality gate -> observe -> relate -> score -> questions. */
export function advanceSweep(_deps: Deps, _sweepId: string): Promise<SweepDto> {
  throw new Error('NOT_IMPLEMENTED:A18');
}

export function getSweep(_deps: Deps, _sweepId: string): Promise<SweepDto | null> {
  throw new Error('NOT_IMPLEMENTED:A18');
}
