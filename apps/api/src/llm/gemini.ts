/**
 * The Gemini provider, ported from `prototype/gemini.js`.
 * Body owned by Run 1 unit A02.
 */
import type { LlmProvider } from './types';

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

export interface GeminiProviderOptions {
  /** Supplied by `env.ts`. Undefined means the provider reports unconfigured. */
  readonly apiKey?: string | undefined;
  readonly models?: readonly string[];
  /** Thinking is on by default, so this must stay generous. */
  readonly maxOutputTokens?: number;
  readonly fetchImpl?: typeof fetch;
}

export function createGeminiProvider(_options: GeminiProviderOptions): LlmProvider {
  throw new Error('NOT_IMPLEMENTED:A02');
}
