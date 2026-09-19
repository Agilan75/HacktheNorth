/** One new photo of a fixed hazard: re-run and return the new price. Unit A18. */
import type { VerifyFixRequestDto, VerifyFixResponseDto } from '@retrofit/contracts';
import type { Deps } from './types';

export function verifyFix(
  _deps: Deps,
  _sweepId: string,
  _request: VerifyFixRequestDto,
): Promise<VerifyFixResponseDto> {
  throw new Error('NOT_IMPLEMENTED:A18');
}
