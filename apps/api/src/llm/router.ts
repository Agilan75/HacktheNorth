/**
 * Routes each LLM call to its provider (DECISIONS L-1): the calls that look at
 * images (`VISION_CALLS` -- observe, verify-fix) go to Gemini; every text-only
 * call goes to Claude. If Claude is not configured, text calls fall back to
 * Gemini, which is exactly the behaviour before the split.
 */
import { VISION_CALLS } from '@retrofit/contracts';
import type { LlmCallName } from '@retrofit/contracts';
import { createClaudeProvider } from './claude';
import { createGeminiProvider } from './gemini';
import type { GenerateJsonRequest, GenerateJsonResult, LlmProvider } from './types';

export interface RoutedLlmOptions {
  readonly vision: LlmProvider;
  readonly text: LlmProvider;
}

export function isVisionCall(callName: LlmCallName): boolean {
  return VISION_CALLS.includes(callName);
}

/** The provider a call goes to. Exported so the startup banner and tests can show it. */
export function providerFor(callName: LlmCallName, options: RoutedLlmOptions): LlmProvider {
  if (isVisionCall(callName)) return options.vision;
  return options.text.configured ? options.text : options.vision;
}

export function createRoutedLlm(options: RoutedLlmOptions): LlmProvider {
  const textName = options.text.configured ? options.text.name : options.vision.name;
  return {
    name: `${textName} (text) + ${options.vision.name} (vision)`,
    configured: options.vision.configured || options.text.configured,
    generateJson: <T>(request: GenerateJsonRequest<T>): Promise<GenerateJsonResult<T>> =>
      providerFor(request.callName, options).generateJson(request),
  };
}

/** The app's LLM, built the same way by the server, the seed and verify:llm. */
export function createAppLlm(keys: {
  readonly geminiApiKey: string | undefined;
  readonly anthropicApiKey: string | undefined;
  readonly anthropicWorkspaceId?: string | undefined;
}): LlmProvider {
  return createRoutedLlm({
    vision: createGeminiProvider({ apiKey: keys.geminiApiKey }),
    text: createClaudeProvider({ apiKey: keys.anthropicApiKey, workspaceId: keys.anthropicWorkspaceId }),
  });
}
