import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createClaudeProvider, CLAUDE_MODEL, toJsonSchema } from './claude';
import { createRoutedLlm, providerFor } from './router';
import type { LlmProvider, ResponseSchemaNode } from './types';

const response: ResponseSchemaNode = {
  type: 'OBJECT',
  properties: { city: { type: 'STRING' }, note: { type: 'STRING', nullable: true } },
  required: ['city'],
};
const schema = { zod: z.object({ city: z.string(), note: z.string().nullable().optional() }), response };

/** A stand-in for the SDK client that records the request and returns a canned message. */
function fakeClient(reply: { text?: string; stop?: string }) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    beta: {
      messages: {
        create: async (params: Record<string, unknown>) => {
          calls.push(params);
          return {
            model: String(params['model']),
            stop_reason: reply.stop ?? 'end_turn',
            stop_details: null,
            content: reply.text === undefined ? [] : [{ type: 'text', text: reply.text }],
            usage: { input_tokens: 12, output_tokens: 7 },
          };
        },
      },
    },
  };
  return { client: client as never, calls };
}

describe('Claude provider (DECISIONS L-1, L-2)', () => {
  it('uses claude-sonnet-5 and sends no refusal-fallback parameters to it', async () => {
    const { client, calls } = fakeClient({ text: '{"city":"Paris"}' });
    const p = createClaudeProvider({ apiKey: 'test', client });
    const r = await p.generateJson({ callName: 'narrate', prompt: 'x', schema });
    expect(CLAUDE_MODEL).toBe('claude-sonnet-5');
    expect(r.data.city).toBe('Paris');
    expect(calls[0]!['model']).toBe('claude-sonnet-5');
    expect(calls[0]).not.toHaveProperty('fallbacks');
    expect(calls[0]).not.toHaveProperty('betas');
    expect(calls[0]).not.toHaveProperty('temperature');
  });

  it('enforces the JSON shape through output_config.format', async () => {
    const { client, calls } = fakeClient({ text: '{"city":"Paris"}' });
    await createClaudeProvider({ apiKey: 'test', client }).generateJson({ callName: 'narrate', prompt: 'x', schema });
    const format = (calls[0]!['output_config'] as { format: { type: string } }).format;
    expect(format.type).toBe('json_schema');
  });

  it('throws a non-retryable error on a refusal instead of reading content', async () => {
    const { client } = fakeClient({ stop: 'refusal' });
    await expect(
      createClaudeProvider({ apiKey: 'test', client }).generateJson({ callName: 'narrate', prompt: 'x', schema }),
    ).rejects.toMatchObject({ retryable: false });
  });

  it('rejects output that fails the zod schema, as a retryable error', async () => {
    const { client } = fakeClient({ text: '{"town":"Paris"}' });
    await expect(
      createClaudeProvider({ apiKey: 'test', client }).generateJson({ callName: 'narrate', prompt: 'x', schema }),
    ).rejects.toMatchObject({ retryable: true });
  });

  it('converts the neutral schema to strict JSON Schema', () => {
    const js = toJsonSchema(response) as { additionalProperties: boolean; properties: Record<string, unknown> };
    expect(js.additionalProperties).toBe(false);
    expect(js.properties['note']).toEqual({ anyOf: [{ type: 'string' }, { type: 'null' }] });
  });
});

describe('LLM routing: Gemini for images, Claude for text (DECISIONS L-1)', () => {
  const named = (name: string, configured = true): LlmProvider => ({
    name,
    configured,
    generateJson: async () => ({ data: name, model: name, attempts: 1, finishReason: 'STOP', usage: null, degraded: false, durationMs: 0 }) as never,
  });

  it('sends the two vision calls to Gemini and every text call to Claude', () => {
    const opts = { vision: named('gemini'), text: named('claude') };
    expect(providerFor('observe', opts).name).toBe('gemini');
    expect(providerFor('verify-fix', opts).name).toBe('gemini');
    for (const call of ['relate', 'narrate', 'schema-assist', 'draft-request', 'extract-reply', 'second-opinion'] as const) {
      expect(providerFor(call, opts).name).toBe('claude');
    }
  });

  it('falls back to Gemini for text calls when no Claude key is configured', () => {
    const opts = { vision: named('gemini'), text: named('claude', false) };
    expect(providerFor('extract-reply', opts).name).toBe('gemini');
    expect(createRoutedLlm(opts).name).toBe('gemini (text) + gemini (vision)');
  });
});
