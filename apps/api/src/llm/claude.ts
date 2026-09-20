/**
 * Claude provider for every text-only LLM call (DECISIONS L-1). Gemini keeps the
 * calls that look at images (`VISION_CALLS`: observe, verify-fix); see router.ts.
 *
 * Same contract as gemini.ts: one request, the provider-enforced JSON shape, then
 * the shared `sanitize` + zod check. The retry and the graceful degrade live in
 * generate-json.ts, not here, so both providers are held to the same standard.
 *
 * `claude-sonnet-5` (Caleb's choice, DECISIONS L-2) with adaptive thinking, which
 * Sonnet 5 runs when `thinking` is omitted. Output is constrained with
 * `output_config.format` (json_schema). Server-side refusal fallbacks are sent only
 * to models documented to support them (Opus 5, Fable 5.1), never to Sonnet 5.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { LlmCallName } from '@retrofit/contracts';
import { sanitize } from './gemini';
import type {
  GenerateJsonRequest,
  GenerateJsonResult,
  LlmFinishReason,
  LlmPart,
  LlmProvider,
  ResponseSchemaNode,
} from './types';
import { LlmError, LlmUnavailableError } from './types';

export const CLAUDE_MODEL = 'claude-sonnet-5';
/** Models documented to accept `fallbacks: "default"`; any other model is sent none. */
const FALLBACK_MODELS = new Set(['claude-opus-5', 'claude-fable-5-1']);
/** Non-streaming ceiling: generous, because adaptive thinking spends tokens first. */
export const CLAUDE_MAX_TOKENS = 16000;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
/** Statuses worth one retry in generate-json.ts. The SDK has already retried twice. */
const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

export interface ClaudeProviderOptions {
  readonly apiKey: string | undefined;
  /**
   * Required when the API key is not scoped to a single workspace: Anthropic
   * then needs the `anthropic-workspace-id` header on every request.
   */
  readonly workspaceId?: string | undefined;
  readonly model?: string;
  /** Injected in tests. */
  readonly client?: Pick<Anthropic, 'beta'>;
}

type JsonSchema = Record<string, unknown>;

/**
 * The provider-neutral ResponseSchemaNode as JSON Schema for structured outputs.
 * Numeric bounds and key ordering are not sent -- structured outputs do not
 * enforce them -- and are still checked afterwards by `sanitize` and zod.
 */
export function toJsonSchema(node: ResponseSchemaNode): JsonSchema {
  const out: JsonSchema = { type: node.type.toLowerCase() };
  if (node.description !== undefined) out.description = node.description;
  if (node.enum !== undefined) out.enum = [...node.enum];
  if (node.type === 'ARRAY' && node.items !== undefined) out.items = toJsonSchema(node.items);
  if (node.type === 'OBJECT') {
    const props: Record<string, JsonSchema> = {};
    for (const [key, child] of Object.entries(node.properties ?? {})) props[key] = toJsonSchema(child);
    out.properties = props;
    out.required = [...(node.required ?? [])];
    out.additionalProperties = false;
  }
  return node.nullable === true ? { anyOf: [out, { type: 'null' }] } : out;
}

function contentOf(request: GenerateJsonRequest<unknown>): Anthropic.Beta.BetaContentBlockParam[] {
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const part of request.parts ?? ([] as readonly LlmPart[])) {
    if (part.kind === 'text') {
      blocks.push({ type: 'text', text: part.text });
    } else if (part.kind === 'image') {
      if (part.label !== undefined) blocks.push({ type: 'text', text: part.label });
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: part.mimeType, data: part.dataBase64 },
      });
    } else {
      blocks.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: part.dataBase64 },
        ...(part.filename !== undefined ? { title: part.filename } : {}),
      });
    }
  }
  blocks.push({ type: 'text', text: request.prompt });
  return blocks;
}

function finishOf(stop: string | null | undefined): LlmFinishReason {
  if (stop === 'end_turn' || stop === 'stop_sequence') return 'STOP';
  if (stop === 'max_tokens') return 'MAX_TOKENS';
  if (stop === 'refusal') return 'SAFETY';
  return 'OTHER';
}

function llmErrorFrom(err: unknown, callName: LlmCallName, model: string): LlmError {
  if (err instanceof Anthropic.APIError) {
    const status = typeof err.status === 'number' ? err.status : null;
    return new LlmError(`Claude (${model}) returned ${status ?? 'an error'}: ${err.message}`, {
      callName,
      retryable: status === null || RETRYABLE.has(status),
      status,
      cause: err,
    });
  }
  const detail = err instanceof Error ? err.message : String(err);
  return new LlmError(`Network error reaching Claude: ${detail}`, { callName, retryable: true, cause: err });
}

export function createClaudeProvider(options: ClaudeProviderOptions): LlmProvider {
  const apiKey = options.apiKey !== undefined && options.apiKey.trim().length > 0 ? options.apiKey : undefined;
  const model = options.model ?? CLAUDE_MODEL;
  let client: Pick<Anthropic, 'beta'> | null = options.client ?? null;

  const generateJson = async <T>(request: GenerateJsonRequest<T>): Promise<GenerateJsonResult<T>> => {
    const { callName } = request;
    if (apiKey === undefined && options.client === undefined) throw new LlmUnavailableError(callName);
    const workspaceId = options.workspaceId?.trim();
    client ??= new Anthropic({
      apiKey,
      maxRetries: 2,
      ...(workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': workspaceId } } : {}),
    });
    const started = performance.now();

    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await client.beta.messages.create(
        {
          model,
          max_tokens: request.maxOutputTokens !== undefined ? Math.max(request.maxOutputTokens, 4096) : CLAUDE_MAX_TOKENS,
          ...(FALLBACK_MODELS.has(model) ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}),
          ...(request.systemInstruction !== undefined ? { system: request.systemInstruction } : {}),
          output_config: {
            format: { type: 'json_schema', schema: toJsonSchema(request.schema.response) },
          },
          messages: [{ role: 'user', content: contentOf(request) }],
        },
        request.signal !== undefined ? { signal: request.signal } : undefined,
      );
    } catch (err) {
      throw llmErrorFrom(err, callName, model);
    }

    const finishReason = finishOf(response.stop_reason);
    if (response.stop_reason === 'refusal') {
      throw new LlmError(`Claude declined "${callName}" (${response.stop_details?.category ?? 'no category'}).`, {
        callName,
        retryable: false,
      });
    }
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const cutOff = finishReason === 'MAX_TOKENS' ? ' The output was cut off at the token limit.' : '';

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (err) {
      throw new LlmError(`Could not parse Claude's JSON for "${callName}".${cutOff}`, {
        callName,
        retryable: true,
        cause: err,
      });
    }

    const checked = request.schema.zod.safeParse(sanitize(json, request.schema.response));
    if (!checked.success) {
      const issues = checked.error.issues
        .slice(0, 8)
        .map((i) => `${i.path.join('.') || '(root)'} ${i.message}`)
        .join('; ');
      throw new LlmError(`Claude output for "${callName}" failed validation: ${issues}.${cutOff}`, {
        callName,
        retryable: true,
        cause: checked.error,
      });
    }

    return {
      data: checked.data,
      model: response.model,
      attempts: 1,
      finishReason,
      usage: { promptTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, thoughtTokens: null },
      degraded: false,
      durationMs: Math.round(performance.now() - started),
    };
  };

  return { name: 'claude', configured: apiKey !== undefined || options.client !== undefined, generateJson };
}
