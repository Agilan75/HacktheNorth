/** Gemini call 2 of 8: `relate`. No images. Body owned by Run 1 unit A03. */
import type { RelateInput, RelateOutput } from '@retrofit/contracts';
import type { LlmProvider } from '../types';

export function relateCall(
  _provider: LlmProvider,
  _input: RelateInput,
): Promise<RelateOutput> {
  throw new Error('NOT_IMPLEMENTED:A03');
}
