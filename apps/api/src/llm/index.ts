/**
 * The LLM layer's barrel. FROZEN after Run 0 (W0-3).
 *
 * Everything outside `apps/api/src/llm` imports from here, so swapping the
 * provider is a one-file change (`gemini.ts`) and nothing else moves.
 */

export * from './types';
export {
  CANNED_RESPONSES,
  FAKE_DURATION_MS,
  FAKE_MODEL,
  createFakeLlm,
} from './fake-provider';
export type { FakeLlmOptions, FakeLlmProvider, RecordedCall } from './fake-provider';

export { MODELS, RETRYABLE_STATUSES, createGeminiProvider } from './gemini';
export type { GeminiProviderOptions } from './gemini';
export { generateJson, withRetry } from './generate-json';

export { observeCall } from './calls/observe';
export { relateCall } from './calls/relate';
export { verifyFixCall } from './calls/verify-fix';
export { narrateCall } from './calls/narrate';
export { schemaAssistCall } from './calls/schema-assist';
export { draftRequestCall } from './calls/draft-request';
export { extractReplyCall } from './calls/extract-reply';
export { secondOpinionCall } from './calls/second-opinion';
