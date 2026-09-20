/** MockFederatoAdapter over the saved snapshot. Body owned by Run 1 unit F05. */
import type { SchemaDocument } from '@retrofit/engine';
import type {
  FederatoAdapter,
  FederatoRecord,
  FederatoResource,
  FederatoSnapshot,
  GlossaryDocument,
  GuidelinesDocument,
  QueryPayload,
  QueryResult,
} from '../types';
import { readGlossary } from '../reference/glossary';
import { readGuidelines } from '../reference/guidelines';
import { buildReferenceIndex, runPipeline } from './pipeline';

export interface MockAdapterOptions {
  readonly snapshot: FederatoSnapshot;
  readonly guidelines?: GuidelinesDocument;
  readonly glossary?: GlossaryDocument;
  readonly schema?: SchemaDocument;
}

/** Mirrors the live handler's `[CODE] message` error strings (F01 parses the prefix). */
function validationError(message: string): Error {
  const err = new Error(`[VALIDATION_ERROR] ${message}`);
  err.name = 'FederatoApiError';
  return err;
}

/**
 * Implements the same `query` contract as the live adapter over saved records —
 * at least the subset the planner emits. Same input, same output, no network.
 */
export function createMockAdapter(options: MockAdapterOptions): FederatoAdapter {
  const { snapshot } = options;
  const store = snapshot.records;
  const refs = buildReferenceIndex(store);
  const schema = options.schema ?? snapshot.schema;

  const query = <T = FederatoRecord>(payload: QueryPayload): Promise<QueryResult<T>> =>
    Promise.resolve().then(() => {
      if (payload === null || typeof payload !== 'object') {
        throw validationError('Query payload must be an object.');
      }
      const resource = payload.resource as FederatoResource | undefined;
      if (typeof resource !== 'string' || !Object.prototype.hasOwnProperty.call(store, resource)) {
        throw validationError(`Unknown resource "${String(resource)}".`);
      }
      const result = runPipeline<T>(payload, store, refs);
      // Callers get their own copy: nobody may mutate the snapshot through a result.
      return structuredClone(result);
    });

  return {
    kind: 'mock',
    getSchema: () => Promise.resolve().then(() => structuredClone(schema)),
    query,
    getGuidelines: () => Promise.resolve().then(() => options.guidelines ?? readGuidelines()),
    getGlossary: () => Promise.resolve().then(() => options.glossary ?? readGlossary()),
  };
}
