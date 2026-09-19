/**
 * `generateJson`: enforced response schema, zod validation, one retry, then
 * graceful degrade. Body owned by Run 1 unit A02.
 *
 * The provider does one logical attempt (the Gemini provider already walks its
 * model chain inside that attempt) and validates with the caller's zod schema.
 * This wrapper spends exactly one retry on a retryable failure — overload,
 * network error, unparseable JSON, a zod failure, or a `MAX_TOKENS` cut-off
 * (retried with double the output budget, because thinking tokens count
 * against it). If the retry also fails, it degrades:
 *
 * - When the enforced response schema has a *safe empty* answer — every
 *   required field is an array (empty) or nullable (null) — and the caller's
 *   zod schema accepts it, that answer is returned with `degraded: true`.
 *   "Nothing observed", "no mappings", "no values extracted" are honest.
 * - Otherwise (a required string, number, boolean or enum — e.g. narrate's
 *   text, verify-fix's `stillPresent`, second-opinion's verdict) no default
 *   can be invented without the LLM deciding something by omission, so the
 *   last `LlmError` is thrown and the call unit falls back to its own
 *   deterministic path (the template text, "unverified", and so on).
 *
 * Non-retryable failures (no provider, auth/4xx, a safety block, an abort)
 * are thrown immediately. Never an unchecked object.
 */
import type {
  GenerateJsonRequest,
  GenerateJsonResult,
  LlmProvider,
  ResponseSchemaNode,
} from './types';
import { LlmError } from './types';

/** First attempt + one retry. */
const DEFAULT_MAX_ATTEMPTS = 2;
/** Used only to size the MAX_TOKENS retry when the request did not set a budget. */
const BASE_MAX_OUTPUT_TOKENS = 8192;
const MAX_OUTPUT_TOKENS_CEILING = 65536;

/** Runs `attempt` again once on a retryable failure, then gives up. */
export async function withRetry<T>(
  attempt: () => Promise<T>,
  isRetryable: (error: unknown) => boolean,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
): Promise<T> {
  const limit = Math.max(1, Math.floor(maxAttempts));
  let lastError: unknown;
  for (let i = 0; i < limit; i++) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || i === limit - 1) throw error;
    }
  }
  throw lastError;
}

const isRetryableLlmError = (error: unknown): boolean =>
  error instanceof LlmError && error.retryable;

const hitTokenLimit = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const finish = (error as { finishReason?: unknown }).finishReason;
  return finish === 'MAX_TOKENS' || /token limit/i.test(error.message);
};

const NO_SAFE_DEFAULT = Symbol('no-safe-default');

/**
 * The empty answer for a schema, or `NO_SAFE_DEFAULT` when one would have to
 * invent a string, number, boolean or enum value.
 */
export function safeEmptyAnswer(schema: ResponseSchemaNode): unknown {
  if (schema.type === 'ARRAY') return [];
  if (schema.type === 'OBJECT') {
    const out: Record<string, unknown> = {};
    const required = new Set(schema.required ?? []);
    for (const [key, node] of Object.entries(schema.properties ?? {})) {
      if (!required.has(key)) continue;
      if (node.type === 'ARRAY') out[key] = [];
      else if (node.nullable === true) out[key] = null;
      else if (node.type === 'OBJECT') {
        const nested = safeEmptyAnswer(node);
        if (nested === NO_SAFE_DEFAULT) return NO_SAFE_DEFAULT;
        out[key] = nested;
      } else return NO_SAFE_DEFAULT;
    }
    return out;
  }
  if (schema.nullable === true) return null;
  return NO_SAFE_DEFAULT;
}

export async function generateJson<T>(
  provider: LlmProvider,
  request: GenerateJsonRequest<T>,
): Promise<GenerateJsonResult<T>> {
  const started = performance.now();
  let attempts = 0;
  let current: GenerateJsonRequest<T> = request;

  const attempt = async (): Promise<GenerateJsonResult<T>> => {
    attempts += 1;
    try {
      return await provider.generateJson(current);
    } catch (error) {
      if (hitTokenLimit(error)) {
        const budget = current.maxOutputTokens ?? BASE_MAX_OUTPUT_TOKENS;
        current = { ...current, maxOutputTokens: Math.min(budget * 2, MAX_OUTPUT_TOKENS_CEILING) };
      }
      throw error;
    }
  };

  const elapsed = (): number => Math.round(performance.now() - started);

  try {
    const result = await withRetry(attempt, (error) => {
      if (request.signal?.aborted) return false;
      return isRetryableLlmError(error);
    });
    return { ...result, attempts, durationMs: elapsed() };
  } catch (error) {
    if (!isRetryableLlmError(error) || request.signal?.aborted) throw error;

    const empty = safeEmptyAnswer(request.schema.response);
    if (empty === NO_SAFE_DEFAULT) throw error;
    const checked = request.schema.zod.safeParse(empty);
    if (!checked.success) throw error;

    return {
      data: checked.data,
      model: provider.name,
      attempts,
      finishReason: 'OTHER',
      usage: null,
      degraded: true,
      durationMs: elapsed(),
    };
  }
}
