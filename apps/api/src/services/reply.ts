/** Broker reply: extract, validate, apply, re-score, log. Unit A17. */
import type { ReplyRequestDto, ReplyResponseDto } from '@retrofit/contracts';
import type { Deps } from './types';

export function applyBrokerReply(
  _deps: Deps,
  _submissionId: string,
  _request: ReplyRequestDto,
): Promise<ReplyResponseDto> {
  throw new Error('NOT_IMPLEMENTED:A17');
}
