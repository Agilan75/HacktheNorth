/**
 * The Gemini provider, ported from `prototype/gemini.js`.
 * Body owned by Run 1 unit A02.
 *
 * One call to `generateJson` here is ONE logical attempt: the request is sent
 * to each model in `MODELS` in turn, falling through on a retryable HTTP
 * status, and the whole chain is cycled `MAX_ROUNDS` times with a backoff
 * between rounds. What comes back is parsed out of the envelope, sanitised
 * against the enforced response schema (the prototype's `clamp01`/`sanitize`),
 * and validated with the caller's zod schema. Any failure is a `VisionError`
 * (an `LlmError`) whose `retryable` flag tells `generate-json.ts` whether its
 * one retry is worth spending. The retry and the degrade live there, not here,
 * so every provider (this one and the fake) gets the same policy.
 *
 * Talks to the REST endpoint through an injectable `fetch` rather than the
 * `@google/genai` SDK, so offline tests can drive every branch — see
 * docs/decisions/A02.md.
 */
import type { LlmCallName } from '@retrofit/contracts';
import type {
  GenerateJsonRequest,
  GenerateJsonResult,
  LlmFinishReason,
  LlmPart,
  LlmProvider,
  LlmUsage,
  ResponseSchemaNode,
} from './types';
import { LlmError, LlmUnavailableError } from './types';

/**
 * The model chain, verified live 2026-09-19. Falls through on 429/500/503.
 * `gemini-3.7-flash` is held in reserve and is deliberately not listed.
 */
export const MODELS: readonly string[] = [
  'gemini-3.6-flash',
  'gemini-3.8-flash',
  'gemini-3.5-flash',
];

export const RETRYABLE_STATUSES: readonly number[] = [408, 429, 500, 502, 503, 504];

/** The whole model chain is cycled this many times before giving up. */
export const MAX_ROUNDS = 2;
/** Pause between rounds of the chain (not between models within a round). */
export const ROUND_BACKOFF_MS = 2500;
/**
 * Thinking is on by default and spends 89-263 thought tokens even on a trivial
 * prompt, all counted against this budget before the answer starts.
 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
export const DEFAULT_TEMPERATURE = 0.2;

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const endpoint = (model: string): string =>
  `${API_BASE}/${encodeURIComponent(model)}:generateContent`;

export interface GeminiProviderOptions {
  /** Supplied by `env.ts`. Undefined means the provider reports unconfigured. */
  readonly apiKey?: string | undefined;
  readonly models?: readonly string[];
  /** Thinking is on by default, so this must stay generous. */
  readonly maxOutputTokens?: number;
  readonly fetchImpl?: typeof fetch;
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The prototype's `VisionError`, now an `LlmError` so callers handle every
 * provider failure one way. `rawText` holds the model output (or envelope) that
 * failed, for diagnostics; it is never shown to a client.
 */
export class VisionError extends LlmError {
  readonly rawText: string | null;
  readonly finishReason: LlmFinishReason | null;
  readonly model: string | null;

  constructor(
    message: string,
    options: {
      readonly callName: LlmCallName;
      readonly retryable?: boolean;
      readonly status?: number | null;
      readonly cause?: unknown;
      readonly rawText?: string | null;
      readonly finishReason?: LlmFinishReason | null;
      readonly model?: string | null;
    },
  ) {
    super(message, options);
    this.name = 'VisionError';
    this.rawText = options.rawText ?? null;
    this.finishReason = options.finishReason ?? null;
    this.model = options.model ?? null;
  }
}

/* -------------------------------------------------------------------------- */
/* clamp01 / sanitize                                                         */
/* -------------------------------------------------------------------------- */

/** Non-numbers and NaN read as 0, as in the prototype. */
export const clamp01 = (x: unknown): number => {
  const n = Number(x);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : Number.isNaN(n) ? 0 : n > 0 ? 1 : 0;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Generalises the prototype's `sanitize` to any enforced schema: every
 * `confidence` number is clamped to [0, 1], every other number is clamped to
 * the schema's declared `minimum`/`maximum`. Shape errors are left alone — zod
 * decides those, and a shape error costs a retry rather than a silent repair.
 */
export function sanitize(value: unknown, schema: ResponseSchemaNode, key?: string): unknown {
  if (value === null || value === undefined) return value;
  switch (schema.type) {
    case 'NUMBER':
    case 'INTEGER': {
      if (typeof value !== 'number') return value;
      if (key === 'confidence') return clamp01(value);
      let n = value;
      if (schema.minimum !== undefined && n < schema.minimum) n = schema.minimum;
      if (schema.maximum !== undefined && n > schema.maximum) n = schema.maximum;
      return n;
    }
    case 'ARRAY': {
      if (!Array.isArray(value) || schema.items === undefined) return value;
      const items = schema.items;
      return value.map((item) => sanitize(item, items, key));
    }
    case 'OBJECT': {
      if (!isRecord(value) || schema.properties === undefined) return value;
      const out: Record<string, unknown> = { ...value };
      for (const [prop, node] of Object.entries(schema.properties)) {
        if (prop in out) out[prop] = sanitize(out[prop], node, prop);
      }
      return out;
    }
    default:
      return value;
  }
}

/* -------------------------------------------------------------------------- */
/* Request body                                                               */
/* -------------------------------------------------------------------------- */

type RestPart =
  | { readonly text: string }
  | { readonly inline_data: { readonly mime_type: string; readonly data: string } };

const stripDataUrl = (data: string): string => {
  // inline_data.data wants the raw payload, not a data URL.
  const comma = data.indexOf(',');
  return data.startsWith('data:') && comma >= 0 ? data.slice(comma + 1) : data;
};

function toRestParts(parts: readonly LlmPart[]): RestPart[] {
  const out: RestPart[] = [];
  for (const part of parts) {
    switch (part.kind) {
      case 'text':
        out.push({ text: part.text });
        break;
      case 'image':
        if (part.label !== undefined) out.push({ text: part.label });
        out.push({ inline_data: { mime_type: part.mimeType, data: stripDataUrl(part.dataBase64) } });
        break;
      case 'pdf':
        if (part.filename !== undefined) out.push({ text: `Document: ${part.filename}` });
        out.push({ inline_data: { mime_type: part.mimeType, data: stripDataUrl(part.dataBase64) } });
        break;
    }
  }
  return out;
}

/** The exact JSON body sent to `:generateContent`. Pure; exported for tests. */
export function buildRequestBody<T>(
  request: GenerateJsonRequest<T>,
  defaults: { readonly maxOutputTokens: number } = { maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS },
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    contents: [
      {
        role: 'user',
        parts: [{ text: request.prompt }, ...toRestParts(request.parts ?? [])],
      },
    ],
    generationConfig: {
      temperature: request.temperature ?? DEFAULT_TEMPERATURE,
      maxOutputTokens: request.maxOutputTokens ?? defaults.maxOutputTokens,
      responseMimeType: 'application/json',
      responseSchema: request.schema.response,
    },
  };
  if (request.systemInstruction !== undefined && request.systemInstruction.length > 0) {
    body.systemInstruction = { parts: [{ text: request.systemInstruction }] };
  }
  return body;
}

/* -------------------------------------------------------------------------- */
/* Response envelope                                                          */
/* -------------------------------------------------------------------------- */

const SAFETY_REASONS = new Set([
  'SAFETY',
  'RECITATION',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
  'IMAGE_SAFETY',
]);

export function toFinishReason(raw: unknown): LlmFinishReason {
  if (raw === 'STOP' || raw === 'MAX_TOKENS') return raw;
  if (typeof raw === 'string' && SAFETY_REASONS.has(raw)) return 'SAFETY';
  return 'OTHER';
}

const numOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export function readUsage(envelope: unknown): LlmUsage | null {
  if (!isRecord(envelope) || !isRecord(envelope.usageMetadata)) return null;
  const u = envelope.usageMetadata;
  return {
    promptTokens: numOrNull(u.promptTokenCount),
    outputTokens: numOrNull(u.candidatesTokenCount),
    thoughtTokens: numOrNull(u.thoughtsTokenCount),
  };
}

export interface ParsedEnvelope {
  readonly text: string | null;
  readonly rawFinishReason: string | null;
  readonly finishReason: LlmFinishReason;
  readonly blockReason: string | null;
  readonly usage: LlmUsage | null;
}

/** Pulls the answer text (thought parts excluded) and diagnostics out. */
export function parseEnvelope(envelope: unknown): ParsedEnvelope {
  const usage = readUsage(envelope);
  const root = isRecord(envelope) ? envelope : {};
  const candidates = Array.isArray(root.candidates) ? root.candidates : [];
  const candidate: unknown = candidates[0];
  const blockReason =
    isRecord(root.promptFeedback) && typeof root.promptFeedback.blockReason === 'string'
      ? root.promptFeedback.blockReason
      : null;
  if (!isRecord(candidate)) {
    return { text: null, rawFinishReason: null, finishReason: 'OTHER', blockReason, usage };
  }
  const rawFinishReason = typeof candidate.finishReason === 'string' ? candidate.finishReason : null;
  const content = isRecord(candidate.content) ? candidate.content : {};
  const parts = Array.isArray(content.parts) ? content.parts : [];
  const text = parts
    .filter((p): p is Record<string, unknown> => isRecord(p) && p.thought !== true)
    .map((p) => (typeof p.text === 'string' ? p.text : ''))
    .join('');
  return {
    text: text.length > 0 ? text : null,
    rawFinishReason,
    finishReason: toFinishReason(rawFinishReason),
    blockReason,
    usage,
  };
}

/* -------------------------------------------------------------------------- */
/* Transport                                                                  */
/* -------------------------------------------------------------------------- */

const isAbort = (err: unknown, signal: AbortSignal | undefined): boolean =>
  signal?.aborted === true || (err instanceof Error && err.name === 'AbortError');

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function errorMessageOf(bodyText: string): string {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.message === 'string') {
      return parsed.error.message;
    }
  } catch {
    // Not JSON: fall back to the raw text below.
  }
  return bodyText.slice(0, 500);
}

interface PostResult {
  readonly bodyText: string;
  readonly model: string;
}

/** Sends the same body to each model in turn until one is not overloaded. */
async function postWithFallback(
  body: string,
  apiKey: string,
  models: readonly string[],
  fetchImpl: typeof fetch,
  callName: LlmCallName,
  signal: AbortSignal | undefined,
): Promise<PostResult> {
  let lastError: VisionError | null = null;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (round > 0) {
      try {
        await sleep(ROUND_BACKOFF_MS, signal);
      } catch (err) {
        throw new VisionError(`Gemini call "${callName}" was aborted`, { callName, cause: err });
      }
    }
    for (const model of models) {
      let response: Response;
      try {
        response = await fetchImpl(endpoint(model), {
          method: 'POST',
          // The key travels in a header, never in the URL, so it cannot leak into a log line.
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body,
          ...(signal ? { signal } : {}),
        });
      } catch (err) {
        if (isAbort(err, signal)) {
          throw new VisionError(`Gemini call "${callName}" was aborted`, { callName, cause: err });
        }
        const detail = err instanceof Error ? err.message : String(err);
        throw new VisionError(`Network error reaching Gemini: ${detail}`, {
          callName,
          retryable: true,
          cause: err,
          model,
        });
      }

      const bodyText = await response.text();
      if (response.ok) return { bodyText, model };

      const retryable = RETRYABLE_STATUSES.includes(response.status);
      lastError = new VisionError(
        `Gemini (${model}) returned ${response.status}: ${errorMessageOf(bodyText)}`,
        { callName, retryable, status: response.status, model },
      );
      if (!retryable) throw lastError;
    }
  }
  throw (
    lastError ??
    new VisionError('Gemini model chain is empty', { callName, retryable: false })
  );
}

/* -------------------------------------------------------------------------- */
/* Provider                                                                   */
/* -------------------------------------------------------------------------- */

export function createGeminiProvider(options: GeminiProviderOptions): LlmProvider {
  const apiKey = options.apiKey !== undefined && options.apiKey.trim().length > 0 ? options.apiKey : undefined;
  const models = options.models ?? MODELS;
  const maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;

  const generateJson = async <T>(request: GenerateJsonRequest<T>): Promise<GenerateJsonResult<T>> => {
    const { callName } = request;
    if (apiKey === undefined) throw new LlmUnavailableError(callName);
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const started = performance.now();

    const body = JSON.stringify(buildRequestBody(request, { maxOutputTokens }));
    const { bodyText, model } = await postWithFallback(
      body,
      apiKey,
      models,
      fetchImpl,
      callName,
      request.signal,
    );

    let envelope: unknown;
    try {
      envelope = JSON.parse(bodyText);
    } catch (err) {
      throw new VisionError('Gemini response envelope was not JSON.', {
        callName,
        retryable: true,
        rawText: bodyText,
        cause: err,
        model,
      });
    }

    const parsed = parseEnvelope(envelope);
    const truncated =
      parsed.finishReason === 'MAX_TOKENS'
        ? ' The output was cut off at the token limit (thinking tokens count against it).'
        : '';

    if (parsed.text === null) {
      const reason = parsed.rawFinishReason ?? parsed.blockReason ?? 'unknown';
      // A prompt block or a safety stop will not change on a retry; anything else might.
      const retryable = parsed.blockReason === null && parsed.finishReason !== 'SAFETY';
      throw new VisionError(`Gemini returned no content (reason: ${reason}).${truncated}`, {
        callName,
        retryable,
        rawText: bodyText,
        finishReason: parsed.finishReason,
        model,
      });
    }

    let json: unknown;
    try {
      json = JSON.parse(parsed.text);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new VisionError(`Could not parse the model's JSON: ${detail}.${truncated}`, {
        callName,
        retryable: true,
        rawText: parsed.text,
        finishReason: parsed.finishReason,
        cause: err,
        model,
      });
    }

    const checked = request.schema.zod.safeParse(sanitize(json, request.schema.response));
    if (!checked.success) {
      const issues = checked.error.issues
        .slice(0, 8)
        .map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`)
        .join('; ');
      throw new VisionError(`Gemini output for "${callName}" failed validation: ${issues}.${truncated}`, {
        callName,
        retryable: true,
        rawText: parsed.text,
        finishReason: parsed.finishReason,
        cause: checked.error,
        model,
      });
    }

    return {
      data: checked.data,
      model,
      attempts: 1,
      finishReason: parsed.finishReason,
      usage: parsed.usage,
      degraded: false,
      durationMs: Math.round(performance.now() - started),
    };
  };

  return {
    name: 'gemini',
    configured: apiKey !== undefined,
    generateJson,
  };
}
