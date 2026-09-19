/** Stage 1 — discover. Body owned by Run 1 unit E02. */
import type { FieldMap, RawBundle, SchemaDocument, VectorSpec } from '../types.js';

/** Assist callback for names the synonym table cannot resolve. Injected, never called by the engine itself. */
export type SchemaAssist = (
  unmapped: readonly { rawPath: string; sampleValues: readonly unknown[] }[],
) => readonly { rawPath: string; canonicalPath: string; confidence: number }[];

export function discover(
  _bundle: RawBundle,
  _schema: SchemaDocument | undefined,
  _spec: VectorSpec,
  _assisted?: readonly { rawPath: string; canonicalPath: string; confidence: number }[],
): FieldMap {
  throw new Error('NOT_IMPLEMENTED:E02');
}
