/** The VOI question loop, with the skipped counter and its reasons. Unit A18. */
import type {
  NextQuestionResponseDto,
  SweepAnswersRequestDto,
  SweepDto,
} from '@retrofit/contracts';
import type { Deps } from './types';

export function nextQuestion(
  _deps: Deps,
  _sweepId: string,
): Promise<NextQuestionResponseDto> {
  throw new Error('NOT_IMPLEMENTED:A18');
}

export function submitAnswers(
  _deps: Deps,
  _sweepId: string,
  _request: SweepAnswersRequestDto,
): Promise<SweepDto> {
  throw new Error('NOT_IMPLEMENTED:A18');
}
