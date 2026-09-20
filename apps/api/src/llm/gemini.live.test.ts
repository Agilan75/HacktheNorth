/**
 * A02 live test: ONE tiny Gemini call, only with RUN_LIVE=1 and a configured key.
 * The offline suites live in `gemini.test.ts` (moved at CP1, docs/contracts/requests/A02.md).
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loadEnv } from '../env';
import { MODELS, createGeminiProvider } from './gemini';
import { generateJson } from './generate-json';
import type { ResponseSchemaNode } from './types';
/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */
const narrateZod = z.object({ text: z.string().min(1) });
const narrateResponse: ResponseSchemaNode = {
  type: 'OBJECT',
  properties: { text: { type: 'STRING' } },
  required: ['text'],
};

/* -------------------------------------------------------------------------- */
/* Live — one tiny call, RUN_LIVE=1 only                                      */
/* -------------------------------------------------------------------------- */

const env = loadEnv();
const LIVE = env.RUN_LIVE === '1' && env.GEMINI_API_KEY !== undefined;

describe.skipIf(!LIVE)('live: Gemini smoke', () => {
  it(
    'answers a trivial prompt through the real chain with an enforced schema',
    async () => {
      const provider = createGeminiProvider({ apiKey: env.GEMINI_API_KEY });
      expect(provider.configured).toBe(true);
      const result = await generateJson(provider, {
        callName: 'narrate',
        prompt: 'Return JSON with "text" set to exactly the word: pong',
        schema: {
          zod: narrateZod,
          response: { ...narrateResponse, propertyOrdering: ['text'] },
        },
      });
      expect(result.degraded).toBe(false);
      expect(MODELS).toContain(result.model);
      expect(result.data.text.toLowerCase()).toContain('pong');
      expect(result.finishReason).toBe('STOP');
      // Thinking is on by default; record it but do not require a number.
      console.info(
        `[A02 live] model=${result.model} attempts=${result.attempts} ` +
          `thoughtTokens=${result.usage?.thoughtTokens ?? 'n/a'} durationMs=${result.durationMs}`,
      );
    },
    60_000,
  );
});
