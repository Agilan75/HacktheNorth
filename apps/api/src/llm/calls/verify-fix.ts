/** Gemini call 3 of 8: `verify-fix`. Body owned by Run 1 unit A04. */
import type { VerifyFixInput, VerifyFixOutput } from '@retrofit/contracts';
import type { LlmImagePart, LlmProvider } from '../types';

export function verifyFixCall(
  _provider: LlmProvider,
  _input: VerifyFixInput,
  _photo: LlmImagePart,
): Promise<VerifyFixOutput> {
  throw new Error('NOT_IMPLEMENTED:A04');
}
