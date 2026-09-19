/** Gemini call 1 of 8: `observe`. Body owned by Run 1 unit A03. */
import type { ObserveInput, ObserveOutput } from '@retrofit/contracts';
import type { LlmImagePart, LlmProvider } from '../types';

export function observeCall(
  _provider: LlmProvider,
  _input: ObserveInput,
  _frames: readonly LlmImagePart[],
): Promise<ObserveOutput> {
  throw new Error('NOT_IMPLEMENTED:A03');
}
