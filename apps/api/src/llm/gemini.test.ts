/**
 * A02 offline tests: every branch of the provider and of `generateJson`, driven
 * by an injected `fetchImpl` / the fake provider. No network (the fetch is a
 * stub). Moved verbatim out of `gemini.live.test.ts` at CP1 (docs/contracts/
 * requests/A02.md) so they run in the default suite.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createFakeLlm } from './fake-provider';
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  MAX_ROUNDS,
  MODELS,
  ROUND_BACKOFF_MS,
  VisionError,
  buildRequestBody,
  clamp01,
  createGeminiProvider,
  parseEnvelope,
  sanitize,
} from './gemini';
import { generateJson, safeEmptyAnswer, withRetry } from './generate-json';
import type { GenerateJsonRequest, LlmProvider, ResponseSchemaNode } from './types';
import { LlmError, LlmUnavailableError } from './types';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const hazardZod = z.object({
  hazards: z.array(
    z.object({
      hazardKey: z.string(),
      present: z.boolean(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});
type Hazards = z.infer<typeof hazardZod>;

const hazardResponse: ResponseSchemaNode = {
  type: 'OBJECT',
  properties: {
    hazards: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          hazardKey: { type: 'STRING' },
          present: { type: 'BOOLEAN' },
          confidence: { type: 'NUMBER' },
        },
        required: ['hazardKey', 'present', 'confidence'],
      },
    },
  },
  required: ['hazards'],
};

const relateRequest = (over: Partial<GenerateJsonRequest<Hazards>> = {}): GenerateJsonRequest<Hazards> => ({
  callName: 'relate',
  prompt: 'relate these observations',
  schema: { zod: hazardZod, response: hazardResponse },
  ...over,
});

const narrateZod = z.object({ text: z.string().min(1) });
const narrateResponse: ResponseSchemaNode = {
  type: 'OBJECT',
  properties: { text: { type: 'STRING' } },
  required: ['text'],
};

const envelope = (text: string, finishReason = 'STOP', extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    candidates: [
      {
        content: { parts: [{ text: 'let me think', thought: true }, { text }] },
        finishReason,
      },
    ],
    usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 12, thoughtsTokenCount: 187 },
    ...extra,
  });

interface Call {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
}

/** A scripted fetch: each call consumes the next `[status, body]`. */
function scriptedFetch(script: readonly (readonly [number, string])[]) {
  const calls: Call[] = [];
  let i = 0;
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    const step = script[Math.min(i, script.length - 1)];
    i += 1;
    if (step === undefined) throw new Error('empty script');
    return new Response(step[1], { status: step[0] });
  }) as typeof fetch;
  return { impl, calls };
}

const busy = [503, JSON.stringify({ error: { message: 'model overloaded' } })] as const;
const good = (payload: unknown, finish = 'STOP') => [200, envelope(JSON.stringify(payload), finish)] as const;

afterEach(() => {
  vi.useRealTimers();
});

/* -------------------------------------------------------------------------- */
/* Offline                                                                    */
/* -------------------------------------------------------------------------- */

describe('offline: constants ported from prototype/gemini.js', () => {
  it('keeps the verified model chain and round count', () => {
    expect(MODELS).toEqual(['gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-3.5-flash']);
    expect(MAX_ROUNDS).toBe(2);
    expect(ROUND_BACKOFF_MS).toBe(2500);
    expect(DEFAULT_MAX_OUTPUT_TOKENS).toBeGreaterThanOrEqual(4096);
  });
});

describe('offline: clamp01 / sanitize', () => {
  it('clamps like the prototype', () => {
    expect(clamp01(1.4)).toBe(1);
    expect(clamp01(-0.2)).toBe(0);
    expect(clamp01(0.37)).toBe(0.37);
    expect(clamp01('x')).toBe(0);
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it('clamps every nested confidence and respects declared min/max', () => {
    const schema: ResponseSchemaNode = {
      type: 'OBJECT',
      properties: {
        hazards: hazardResponse.properties?.hazards as ResponseSchemaNode,
        yearBuilt: { type: 'INTEGER', minimum: 1800, maximum: 2026 },
      },
    };
    const out = sanitize(
      {
        hazards: [
          { hazardKey: 'a', present: true, confidence: 1.7 },
          { hazardKey: 'b', present: false, confidence: -3 },
        ],
        yearBuilt: 2400,
        extra: 'kept',
      },
      schema,
    );
    expect(out).toEqual({
      hazards: [
        { hazardKey: 'a', present: true, confidence: 1 },
        { hazardKey: 'b', present: false, confidence: 0 },
      ],
      yearBuilt: 2026,
      extra: 'kept',
    });
  });

  it('leaves shape errors for zod to catch', () => {
    expect(sanitize({ hazards: 'nope' }, hazardResponse)).toEqual({ hazards: 'nope' });
  });
});

describe('offline: request body', () => {
  it('sends the enforced schema as application/json with a generous budget', () => {
    const body = buildRequestBody(
      relateRequest({
        systemInstruction: 'be terse',
        parts: [
          { kind: 'image', mimeType: 'image/jpeg', dataBase64: 'data:image/jpeg;base64,QUJD', label: 'frame 3, bearing 120°' },
          { kind: 'pdf', mimeType: 'application/pdf', dataBase64: 'JVBE', filename: 'loss-runs.pdf' },
          { kind: 'text', text: 'trailing note' },
        ],
      }),
    );
    expect(body.generationConfig).toEqual({
      temperature: 0.2,
      maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
      responseMimeType: 'application/json',
      responseSchema: hazardResponse,
    });
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'be terse' }] });
    expect(body.contents).toEqual([
      {
        role: 'user',
        parts: [
          { text: 'relate these observations' },
          { text: 'frame 3, bearing 120°' },
          { inline_data: { mime_type: 'image/jpeg', data: 'QUJD' } },
          { text: 'Document: loss-runs.pdf' },
          { inline_data: { mime_type: 'application/pdf', data: 'JVBE' } },
          { text: 'trailing note' },
        ],
      },
    ]);
  });

  it('lets the request override the output budget and temperature', () => {
    const body = buildRequestBody(relateRequest({ maxOutputTokens: 16384, temperature: 0 }));
    expect(body.generationConfig).toMatchObject({ maxOutputTokens: 16384, temperature: 0 });
    expect(body.systemInstruction).toBeUndefined();
  });
});

describe('offline: envelope parsing', () => {
  it('drops thought parts and reads usage including thought tokens', () => {
    const parsed = parseEnvelope(JSON.parse(envelope('{"a":1}')));
    expect(parsed.text).toBe('{"a":1}');
    expect(parsed.finishReason).toBe('STOP');
    expect(parsed.usage).toEqual({ promptTokens: 40, outputTokens: 12, thoughtTokens: 187 });
  });

  it('maps finish reasons and prompt blocks', () => {
    expect(parseEnvelope(JSON.parse(envelope('x', 'MAX_TOKENS'))).finishReason).toBe('MAX_TOKENS');
    expect(parseEnvelope(JSON.parse(envelope('x', 'PROHIBITED_CONTENT'))).finishReason).toBe('SAFETY');
    expect(parseEnvelope(JSON.parse(envelope('x', 'MALFORMED_FUNCTION_CALL'))).finishReason).toBe('OTHER');
    const blocked = parseEnvelope({ promptFeedback: { blockReason: 'SAFETY' } });
    expect(blocked.text).toBeNull();
    expect(blocked.blockReason).toBe('SAFETY');
    expect(blocked.usage).toBeNull();
  });
});

describe('offline: Gemini provider', () => {
  const payload = { hazards: [{ hazardKey: 'heaterNearCombustible', present: true, confidence: 1.3 }] };

  it('reports unconfigured without a key and refuses to call', async () => {
    const { impl, calls } = scriptedFetch([good(payload)]);
    const provider = createGeminiProvider({ apiKey: undefined, fetchImpl: impl });
    expect(provider.name).toBe('gemini');
    expect(provider.configured).toBe(false);
    await expect(provider.generateJson(relateRequest())).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(createGeminiProvider({ apiKey: '   ' }).configured).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('returns validated, clamped data from the first model; key only in a header', async () => {
    const { impl, calls } = scriptedFetch([good(payload)]);
    const provider = createGeminiProvider({ apiKey: 'test-key', fetchImpl: impl });
    const result = await provider.generateJson(relateRequest());
    expect(result.data).toEqual({
      hazards: [{ hazardKey: 'heaterNearCombustible', present: true, confidence: 1 }],
    });
    expect(result.model).toBe('gemini-3.6-flash');
    expect(result.finishReason).toBe('STOP');
    expect(result.degraded).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.usage?.thoughtTokens).toBe(187);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',
    );
    expect(calls[0]?.url).not.toContain('test-key');
    expect(calls[0]?.headers['x-goog-api-key']).toBe('test-key');
  });

  it('falls through the chain on 429/503 in order', async () => {
    const { impl, calls } = scriptedFetch([[429, '{}'], busy, good(payload)]);
    const provider = createGeminiProvider({ apiKey: 'k', fetchImpl: impl });
    const result = await provider.generateJson(relateRequest());
    expect(result.model).toBe('gemini-3.5-flash');
    expect(calls.map((c) => c.url.split('/').pop())).toEqual([
      'gemini-3.6-flash:generateContent',
      'gemini-3.8-flash:generateContent',
      'gemini-3.5-flash:generateContent',
    ]);
  });

  it('cycles the chain MAX_ROUNDS times with backoff, then throws a retryable error', async () => {
    vi.useFakeTimers();
    const { impl, calls } = scriptedFetch([busy]);
    const provider = createGeminiProvider({ apiKey: 'k', fetchImpl: impl });
    const pending = provider.generateJson(relateRequest());
    const settled = pending.then(
      () => null,
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(ROUND_BACKOFF_MS);
    const error = await settled;
    expect(calls).toHaveLength(MODELS.length * MAX_ROUNDS);
    expect(error).toBeInstanceOf(VisionError);
    expect(error).toBeInstanceOf(LlmError);
    expect((error as VisionError).retryable).toBe(true);
    expect((error as VisionError).status).toBe(503);
    expect((error as VisionError).message).toContain('model overloaded');
  });

  it('stops immediately on a non-retryable status', async () => {
    const { impl, calls } = scriptedFetch([[400, JSON.stringify({ error: { message: 'API key not valid' } })]]);
    const provider = createGeminiProvider({ apiKey: 'k', fetchImpl: impl });
    const error = await provider.generateJson(relateRequest()).catch((e: unknown) => e);
    expect(calls).toHaveLength(1);
    expect((error as VisionError).retryable).toBe(false);
    expect((error as VisionError).status).toBe(400);
  });

  it('treats a MAX_TOKENS cut-off as a retryable diagnostic', async () => {
    const { impl } = scriptedFetch([[200, envelope('{"hazards":[{"hazardKey":"a"', 'MAX_TOKENS')]]);
    const provider = createGeminiProvider({ apiKey: 'k', fetchImpl: impl });
    const error = (await provider.generateJson(relateRequest()).catch((e: unknown) => e)) as VisionError;
    expect(error).toBeInstanceOf(VisionError);
    expect(error.retryable).toBe(true);
    expect(error.finishReason).toBe('MAX_TOKENS');
    expect(error.message).toContain('token limit');
    expect(error.rawText).toBe('{"hazards":[{"hazardKey":"a"');
  });

  it('treats an empty MAX_TOKENS answer (all thinking) as retryable', async () => {
    const body = JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'hmm', thought: true }] }, finishReason: 'MAX_TOKENS' }],
    });
    const { impl } = scriptedFetch([[200, body]]);
    const provider = createGeminiProvider({ apiKey: 'k', fetchImpl: impl });
    const error = (await provider.generateJson(relateRequest()).catch((e: unknown) => e)) as VisionError;
    expect(error.retryable).toBe(true);
    expect(error.finishReason).toBe('MAX_TOKENS');
    expect(error.message).toContain('reason: MAX_TOKENS');
  });

  it('does not retry a prompt block', async () => {
    const { impl } = scriptedFetch([[200, JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } })]]);
    const provider = createGeminiProvider({ apiKey: 'k', fetchImpl: impl });
    const error = (await provider.generateJson(relateRequest()).catch((e: unknown) => e)) as VisionError;
    expect(error.retryable).toBe(false);
    expect(error.message).toContain('reason: SAFETY');
  });

  it('rejects schema-invalid output as retryable, never returning it unchecked', async () => {
    const { impl } = scriptedFetch([good({ hazards: [{ hazardKey: 'a', present: 'yes', confidence: 0.5 }] })]);
    const provider = createGeminiProvider({ apiKey: 'k', fetchImpl: impl });
    const error = (await provider.generateJson(relateRequest()).catch((e: unknown) => e)) as VisionError;
    expect(error.retryable).toBe(true);
    expect(error.message).toContain('failed validation');
    expect(error.message).toContain('hazards.0.present');
  });

  it('turns a network failure into a retryable error', async () => {
    const impl = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const provider = createGeminiProvider({ apiKey: 'k', fetchImpl: impl });
    const error = (await provider.generateJson(relateRequest()).catch((e: unknown) => e)) as VisionError;
    expect(error.retryable).toBe(true);
    expect(error.message).toContain('Network error reaching Gemini: fetch failed');
  });

  it('honours an explicit model list and provider budget', async () => {
    const { impl, calls } = scriptedFetch([good(payload)]);
    const provider = createGeminiProvider({ apiKey: 'k', fetchImpl: impl, models: ['m-x'], maxOutputTokens: 12000 });
    const result = await provider.generateJson(relateRequest());
    expect(result.model).toBe('m-x');
    expect((calls[0]?.body.generationConfig as Record<string, unknown>).maxOutputTokens).toBe(12000);
  });
});

describe('offline: withRetry', () => {
  it('retries once on a retryable failure and succeeds', async () => {
    let n = 0;
    const out = await withRetry(
      async () => {
        n += 1;
        if (n === 1) throw new Error('transient');
        return 'ok';
      },
      () => true,
    );
    expect(out).toBe('ok');
    expect(n).toBe(2);
  });

  it('makes exactly two attempts by default, then rethrows the last error', async () => {
    let n = 0;
    await expect(
      withRetry(
        async () => {
          n += 1;
          throw new Error(`fail ${n}`);
        },
        () => true,
      ),
    ).rejects.toThrow('fail 2');
    expect(n).toBe(2);
  });

  it('does not retry a non-retryable failure', async () => {
    let n = 0;
    await expect(
      withRetry(
        async () => {
          n += 1;
          throw new Error('fatal');
        },
        () => false,
      ),
    ).rejects.toThrow('fatal');
    expect(n).toBe(1);
  });
});

describe('offline: generateJson', () => {
  it('passes a good answer through with attempts = 1', async () => {
    const fake = createFakeLlm();
    const result = await generateJson(fake, relateRequest());
    expect(result.degraded).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.data.hazards[0]?.hazardKey).toBe('heaterNearCombustible');
  });

  it('spends one retry on a MAX_TOKENS failure, doubling the output budget', async () => {
    const { impl, calls } = scriptedFetch([
      [200, envelope('{"hazards":[', 'MAX_TOKENS')],
      good({ hazards: [] }),
    ]);
    const provider = createGeminiProvider({ apiKey: 'k', fetchImpl: impl });
    const result = await generateJson(provider, relateRequest({ maxOutputTokens: 6000 }));
    expect(result.attempts).toBe(2);
    expect(result.degraded).toBe(false);
    expect(result.data).toEqual({ hazards: [] });
    const budgets = calls.map((c) => (c.body.generationConfig as Record<string, unknown>).maxOutputTokens);
    expect(budgets).toEqual([6000, 12000]);
  });

  it('degrades to the safe empty answer after the retry fails, for an array-shaped schema', async () => {
    const fake = createFakeLlm({ failFor: ['relate'] });
    const result = await generateJson(fake, relateRequest());
    expect(result).toMatchObject({ data: { hazards: [] }, degraded: true, attempts: 2, usage: null });
    expect(fake.callsFor('relate')).toHaveLength(2);
  });

  it('throws instead of inventing a string/boolean/enum answer', async () => {
    const fake = createFakeLlm({ failFor: ['narrate'] });
    await expect(
      generateJson(fake, {
        callName: 'narrate',
        prompt: 'polish',
        schema: { zod: narrateZod, response: narrateResponse },
      }),
    ).rejects.toBeInstanceOf(LlmError);
    expect(fake.callsFor('narrate')).toHaveLength(2);
  });

  it('throws a non-retryable failure at once, without degrading', async () => {
    const provider = createGeminiProvider({ apiKey: undefined });
    await expect(generateJson(provider, relateRequest())).rejects.toBeInstanceOf(LlmUnavailableError);
    const fake = createFakeLlm({ overrides: { relate: { hazards: 'bad' } } });
    await expect(generateJson(fake, relateRequest())).rejects.toBeInstanceOf(LlmError);
    expect(fake.callsFor('relate')).toHaveLength(1);
  });

  it('does not retry once the caller has aborted', async () => {
    const controller = new AbortController();
    let n = 0;
    const provider: LlmProvider = {
      name: 'stub',
      configured: true,
      generateJson: async () => {
        n += 1;
        controller.abort();
        throw new LlmError('boom', { callName: 'relate', retryable: true });
      },
    };
    await expect(generateJson(provider, relateRequest({ signal: controller.signal }))).rejects.toThrow('boom');
    expect(n).toBe(1);
  });

  it('only degrades when the empty answer passes the caller zod schema', async () => {
    const strict = z.object({ hazards: z.array(z.unknown()).min(1) });
    const fake = createFakeLlm({ failFor: ['relate'] });
    await expect(
      generateJson(fake, { callName: 'relate', prompt: 'p', schema: { zod: strict, response: hazardResponse } }),
    ).rejects.toBeInstanceOf(LlmError);
  });

  it('computes safe empty answers only where nothing must be invented', () => {
    expect(safeEmptyAnswer(hazardResponse)).toEqual({ hazards: [] });
    expect(
      safeEmptyAnswer({
        type: 'OBJECT',
        properties: {
          values: { type: 'ARRAY', items: { type: 'STRING' } },
          notFound: { type: 'ARRAY', items: { type: 'STRING' } },
          note: { type: 'STRING', nullable: true },
          optional: { type: 'STRING' },
        },
        required: ['values', 'notFound', 'note'],
      }),
    ).toEqual({ values: [], notFound: [], note: null });
    expect(typeof safeEmptyAnswer(narrateResponse)).toBe('symbol');
    expect(
      typeof safeEmptyAnswer({
        type: 'OBJECT',
        properties: { verdict: { type: 'STRING', enum: ['FIT', 'REFER', 'DECLINE'] } },
        required: ['verdict'],
      }),
    ).toBe('symbol');
  });
});
