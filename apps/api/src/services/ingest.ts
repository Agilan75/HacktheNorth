/** Ingest service: planner -> normalize -> engine -> store. Unit A16. */
import type { IngestRequestDto, IngestResponseDto } from '@retrofit/contracts';
import type { Deps } from './types';

/** Idempotent by `externalId`; `force` re-runs an account that already exists. */
export function ingestFederato(
  _deps: Deps,
  _request: IngestRequestDto,
): Promise<IngestResponseDto> {
  throw new Error('NOT_IMPLEMENTED:A16');
}
