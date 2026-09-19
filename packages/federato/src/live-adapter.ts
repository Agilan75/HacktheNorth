/** The live Federato adapter. Body owned by Run 1 unit F01. */
import type { SchemaDocument } from '@retrofit/engine';
import type {
  FederatoAdapter,
  FederatoEnv,
  FederatoErrorShape,
  FederatoRecord,
  GlossaryDocument,
  GuidelinesDocument,
  QueryPayload,
  QueryResult,
} from './types';
import type { TokenSource } from './auth';

/** Unwraps `{ output: [{ data }] }` and the bare `{ data }` shape alike. */
export function unwrapEnvelope<T>(_body: unknown): T {
  throw new Error('NOT_IMPLEMENTED:F01');
}

/** Parses a `[CODE] message` error string into its parts. */
export function parseFederatoError(
  _raw: string,
  _httpStatus?: number,
): FederatoErrorShape {
  throw new Error('NOT_IMPLEMENTED:F01');
}

export interface LiveAdapterOptions {
  readonly env: FederatoEnv;
  readonly tokenSource?: TokenSource;
  /** Injected for tests. Defaults to global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

export function createLiveAdapter(_options: LiveAdapterOptions): FederatoAdapter {
  throw new Error('NOT_IMPLEMENTED:F01');
}

export function liveQuery<T = FederatoRecord>(
  _options: LiveAdapterOptions,
  _payload: QueryPayload,
): Promise<QueryResult<T>> {
  throw new Error('NOT_IMPLEMENTED:F01');
}

export function liveSchema(_options: LiveAdapterOptions): Promise<SchemaDocument> {
  throw new Error('NOT_IMPLEMENTED:F01');
}

export function liveGuidelines(_options: LiveAdapterOptions): Promise<GuidelinesDocument> {
  throw new Error('NOT_IMPLEMENTED:F01');
}

export function liveGlossary(_options: LiveAdapterOptions): Promise<GlossaryDocument> {
  throw new Error('NOT_IMPLEMENTED:F01');
}
