/** Gemini call 5 of 8: `schema-assist`. Body owned by Run 1 unit A05. */
import type { SchemaAssistInput, SchemaAssistOutput } from '@retrofit/contracts';
import type { LlmProvider } from '../types';

export function schemaAssistCall(
  _provider: LlmProvider,
  _input: SchemaAssistInput,
): Promise<SchemaAssistOutput> {
  throw new Error('NOT_IMPLEMENTED:A05');
}
