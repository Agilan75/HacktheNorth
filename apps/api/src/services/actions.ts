/** Routing plus request drafting for every qualifying account. Unit A17. */
import type {
  ActionDto,
  ActionsPlanRequestDto,
  ActionsPlanResponseDto,
} from '@retrofit/contracts';
import type { Deps } from './types';

export function planActions(
  _deps: Deps,
  _request: ActionsPlanRequestDto,
): Promise<ActionsPlanResponseDto> {
  throw new Error('NOT_IMPLEMENTED:A17');
}

/** Approving marks a draft sent. Nothing is ever really emailed (PRD §7.6). */
export function approveAction(_deps: Deps, _actionId: string): Promise<ActionDto> {
  throw new Error('NOT_IMPLEMENTED:A17');
}
