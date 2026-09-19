/**
 * Gemini call 6 of 8: `second-opinion`. VERIFICATION ONLY (PRD §12 layer C).
 * It never sees engine output and is never called from a request path.
 * Body owned by Run 1 unit A05.
 */
import type { SecondOpinionInput, SecondOpinionOutput } from '@retrofit/contracts';
import type { LlmProvider } from '../types';

export function secondOpinionCall(
  _provider: LlmProvider,
  _input: SecondOpinionInput,
): Promise<SecondOpinionOutput> {
  throw new Error('NOT_IMPLEMENTED:A05');
}
