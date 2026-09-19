/**
 * `generateJson`: enforced response schema, zod validation, one retry, then
 * graceful degrade. Body owned by Run 1 unit A02.
 */
import type {
  GenerateJsonRequest,
  GenerateJsonResult,
  LlmProvider,
} from './types';

/** Runs `attempt` again once on a retryable failure, then gives up. */
export function withRetry<T>(
  _attempt: () => Promise<T>,
  _isRetryable: (error: unknown) => boolean,
  _maxAttempts?: number,
): Promise<T> {
  throw new Error('NOT_IMPLEMENTED:A02');
}

export function generateJson<T>(
  _provider: LlmProvider,
  _request: GenerateJsonRequest<T>,
): Promise<GenerateJsonResult<T>> {
  throw new Error('NOT_IMPLEMENTED:A02');
}
