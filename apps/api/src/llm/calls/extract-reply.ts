/**
 * Gemini call 8 of 8: `extract-reply`. Values are type- and range-checked by
 * code and the quote must appear in the source. Body owned by Run 1 unit A06.
 */
import type { ExtractReplyInput, ExtractReplyOutput } from '@retrofit/contracts';
import type { LlmPdfPart, LlmProvider } from '../types';

export function extractReplyCall(
  _provider: LlmProvider,
  _input: ExtractReplyInput,
  _pdf?: LlmPdfPart,
): Promise<ExtractReplyOutput> {
  throw new Error('NOT_IMPLEMENTED:A06');
}
