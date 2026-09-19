/**
 * Gemini call 4 of 8: `narrate`. Polished wording only — every number and the
 * recommendation are checked to survive. Body owned by Run 1 unit A04.
 */
import type { NarrateInput, NarrateOutput } from '@retrofit/contracts';
import type { LlmProvider } from '../types';

export function narrateCall(
  _provider: LlmProvider,
  _input: NarrateInput,
): Promise<NarrateOutput> {
  throw new Error('NOT_IMPLEMENTED:A04');
}
