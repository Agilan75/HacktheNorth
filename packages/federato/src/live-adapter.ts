/** The live Federato adapter. Body owned by Run 1 unit F01. */
import type { SchemaDocument, SchemaField, SchemaResource } from '@retrofit/engine';
import type {
  FederatoAdapter,
  FederatoEnv,
  FederatoErrorShape,
  FederatoRecord,
  FederatoResource,
  GlossaryDocument,
  GuidelinesDocument,
  QueryPayload,
  QueryResult,
} from './types';
import type { TokenSource } from './auth';
import { createTokenSource } from './auth';
import { readGuidelines } from './reference/guidelines';
import { readGlossary } from './reference/glossary';

/* -------------------------------------------------------------------------- */
/* Envelope and errors                                                        */
/* -------------------------------------------------------------------------- */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Unwraps `{ output: [{ data }] }` and the bare `{ data }` shape alike. */
export function unwrapEnvelope<T>(body: unknown): T {
  let cur: unknown = body;
  if (typeof cur === 'string') {
    const trimmed = cur.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        cur = JSON.parse(trimmed);
      } catch {
        // Not JSON: return the string itself.
      }
    }
  }
  // Bounded: at most a workflow envelope around a `{ data }` wrapper, twice.
  for (let i = 0; i < 4; i += 1) {
    if (isPlainObject(cur) && Array.isArray(cur.output)) {
      const first: unknown = cur.output[0];
      if (first === undefined) return undefined as T;
      cur = isPlainObject(first) && 'data' in first ? first.data : first;
      continue;
    }
    if (isPlainObject(cur) && 'data' in cur && Object.keys(cur).length === 1) {
      cur = cur.data;
      continue;
    }
    break;
  }
  return cur as T;
}

const CODE_PREFIX = /^\s*(?:[A-Za-z]*Error:\s*)?\[([A-Za-z0-9_.:-]+)\]\s*([\s\S]*)$/;

/** Parses a `[CODE] message` error string into its parts. */
export function parseFederatoError(raw: string, httpStatus?: number): FederatoErrorShape {
  const status = typeof httpStatus === 'number' ? httpStatus : null;
  const m = CODE_PREFIX.exec(raw);
  if (m) {
    const message = (m[2] ?? '').trim();
    return { code: m[1] ?? null, message: message || raw.trim(), httpStatus: status, raw };
  }
  return { code: null, message: raw.trim(), httpStatus: status, raw };
}

/** Thrown by the adapter; structurally a `FederatoErrorShape`. */
class FederatoApiError extends Error implements FederatoErrorShape {
  readonly code: string | null;
  readonly httpStatus: number | null;
  readonly raw: string;
  constructor(shape: FederatoErrorShape) {
    super(shape.code ? `[${shape.code}] ${shape.message}` : shape.message);
    this.name = 'FederatoApiError';
    this.code = shape.code;
    this.httpStatus = shape.httpStatus;
    this.raw = shape.raw;
  }
}

/** Finds an error string in a response body, wherever the workflow put it. */
function extractErrorString(body: unknown): string | null {
  if (typeof body === 'string') return body.trim() ? body : null;
  if (!isPlainObject(body)) return null;
  for (const key of ['error', 'message', 'errorMessage'] as const) {
    const v = body[key];
    if (typeof v === 'string' && v.trim()) return v;
    if (isPlainObject(v) && typeof v.message === 'string' && v.message.trim()) return v.message;
  }
  if (Array.isArray(body.output) && body.output.length > 0) {
    const inner = extractErrorString(body.output[0]);
    if (inner) return inner;
  }
  if ('data' in body) return extractErrorString(body.data);
  return null;
}

/** A 2xx body that is really an error: a bare `[CODE]` string, or an `error` key. */
function embeddedError(body: unknown, unwrapped: unknown): string | null {
  if (typeof unwrapped === 'string' && CODE_PREFIX.test(unwrapped)) return unwrapped;
  if (isPlainObject(unwrapped) && typeof unwrapped.error === 'string') return unwrapped.error;
  if (isPlainObject(body) && typeof body.error === 'string') return body.error;
  if (isPlainObject(body) && Array.isArray(body.output)) {
    const first: unknown = body.output[0];
    if (isPlainObject(first) && typeof first.error === 'string') return first.error;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Transport                                                                  */
/* -------------------------------------------------------------------------- */

const DEFAULT_HANDLER_URL =
  'https://product.federato.ai/integrations-api/handlers/federato-hack-north';
const HANDLER_PATH = '/integrations-api/handlers/federato-hack-north';

/**
 * `FEDERATO_BASE_URL` may be the full handler URL or just the host. Either
 * way the result is the handler URL with `outputOnly=true`.
 */
function resolveHandlerUrl(baseUrl: string | undefined): string {
  const raw = (baseUrl ?? '').trim() || DEFAULT_HANDLER_URL;
  const url = new URL(raw);
  if (!url.pathname.includes('/handlers/')) {
    url.pathname = url.pathname.replace(/\/+$/, '') + HANDLER_PATH;
  }
  if (!url.searchParams.has('outputOnly')) url.searchParams.set('outputOnly', 'true');
  return url.toString();
}

/** One token source per env object, so bare `liveQuery` calls share a cache. */
const sharedSources = new WeakMap<FederatoEnv, TokenSource>();

function tokenSourceFor(options: LiveAdapterOptions): TokenSource {
  if (options.tokenSource) return options.tokenSource;
  let src = sharedSources.get(options.env);
  if (!src) {
    src = createTokenSource(options.env);
    sharedSources.set(options.env, src);
  }
  return src;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function callHandler(
  options: LiveAdapterOptions,
  tokens: TokenSource,
  body: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = resolveHandlerUrl(options.env.baseUrl);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await tokens.getToken();
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          authorization: `${token.tokenType || 'Bearer'} ${token.accessToken}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new FederatoApiError({
        code: 'NETWORK_ERROR',
        message: `Federato request failed: ${msg}`,
        httpStatus: null,
        raw: msg,
      });
    }
    const parsed = await readBody(res);

    // An expired or revoked token: drop it and mint once more.
    if (res.status === 401 && attempt === 0) {
      tokens.invalidate();
      continue;
    }
    // 200 and 201 are both success; the handler answers 201 (LIVE_DATA_FACTS).
    if (!res.ok) {
      const raw = extractErrorString(parsed) ?? `HTTP ${res.status} ${res.statusText}`.trim();
      throw new FederatoApiError(parseFederatoError(raw, res.status));
    }
    const data = unwrapEnvelope<unknown>(parsed);
    const embedded = embeddedError(parsed, data);
    if (embedded !== null) {
      throw new FederatoApiError(parseFederatoError(embedded, res.status));
    }
    return data;
  }
  // Unreachable: the second 401 falls through to the !res.ok branch.
  throw new FederatoApiError({ code: 'AUTH_ERROR', message: 'Unauthorized', httpStatus: 401, raw: '401' });
}

/* -------------------------------------------------------------------------- */
/* Schema flattening                                                          */
/* -------------------------------------------------------------------------- */

interface RawSchemaField {
  readonly type?: unknown;
  readonly optional?: unknown;
  readonly resource?: unknown;
  readonly cardinality?: unknown;
  readonly fields?: unknown;
  readonly description?: unknown;
}

function flattenFields(fields: unknown, prefix: string, out: SchemaField[]): void {
  if (!isPlainObject(fields)) return;
  for (const [name, def] of Object.entries(fields)) {
    if (!isPlainObject(def)) continue;
    const f = def as RawSchemaField;
    const path = prefix ? `${prefix}.${name}` : name;
    const type = typeof f.type === 'string' ? f.type : 'unknown';
    // Nested objects become dot-paths (`dates.effective`, `producer.broker`).
    if (type === 'object' && isPlainObject(f.fields)) {
      flattenFields(f.fields, path, out);
      continue;
    }
    const field: {
      path: string;
      type: string;
      nullable?: boolean;
      reference?: string;
      isArray?: boolean;
      description?: string;
    } = { path, type };
    if (f.optional === true) field.nullable = true;
    if (type === 'reference' && typeof f.resource === 'string') {
      field.reference = f.resource;
      if (f.cardinality === 'many') field.isArray = true;
    }
    if (typeof f.description === 'string') field.description = f.description;
    out.push(field);
  }
}

/** Live schema `{ Resource: { type, fields } }` → the engine's flat `SchemaDocument`. */
function toSchemaDocument(data: unknown, fetchedAt: string): SchemaDocument {
  if (isPlainObject(data) && Array.isArray(data.resources)) {
    return { ...(data as unknown as SchemaDocument), fetchedAt };
  }
  if (!isPlainObject(data)) {
    throw new FederatoApiError({
      code: 'BAD_SCHEMA',
      message: 'Schema response was not an object.',
      httpStatus: null,
      raw: String(data),
    });
  }
  // Some deployments nest the map under `resources` or `schema`.
  const map = isPlainObject(data.resources)
    ? data.resources
    : isPlainObject(data.schema)
      ? data.schema
      : data;
  const resources: SchemaResource[] = [];
  for (const [name, def] of Object.entries(map)) {
    if (!isPlainObject(def) || !isPlainObject(def.fields)) continue;
    const fields: SchemaField[] = [];
    flattenFields(def.fields, '', fields);
    resources.push({ name, fields });
  }
  return { resources, fetchedAt };
}

/* -------------------------------------------------------------------------- */
/* Query result normalisation                                                 */
/* -------------------------------------------------------------------------- */

function toQueryResult<T>(data: unknown, payload: QueryPayload): QueryResult<T> {
  if (Array.isArray(data)) {
    return { resource: payload.resource, total: data.length, results: data as T[] };
  }
  if (!isPlainObject(data)) {
    throw new FederatoApiError({
      code: 'BAD_RESPONSE',
      message: 'Query response carried no results.',
      httpStatus: null,
      raw: typeof data === 'string' ? data : JSON.stringify(data ?? null),
    });
  }
  const results = Array.isArray(data.results) ? (data.results as T[]) : [];
  const total = typeof data.total === 'number' && Number.isFinite(data.total) ? data.total : results.length;
  const resource =
    typeof data.resource === 'string' ? (data.resource as FederatoResource) : payload.resource;
  const groups = Array.isArray(data.groups) ? (data.groups as FederatoRecord[]) : undefined;
  return groups ? { resource, total, results, groups } : { resource, total, results };
}

/* -------------------------------------------------------------------------- */
/* Public surface                                                             */
/* -------------------------------------------------------------------------- */

export interface LiveAdapterOptions {
  readonly env: FederatoEnv;
  readonly tokenSource?: TokenSource;
  /** Injected for tests. Defaults to global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

export function createLiveAdapter(options: LiveAdapterOptions): FederatoAdapter {
  // Pin one token source for the adapter's lifetime.
  const pinned: LiveAdapterOptions = { ...options, tokenSource: tokenSourceFor(options) };
  return {
    kind: 'live',
    getSchema: () => liveSchema(pinned),
    query: <T = FederatoRecord>(payload: QueryPayload) => liveQuery<T>(pinned, payload),
    getGuidelines: () => liveGuidelines(pinned),
    getGlossary: () => liveGlossary(pinned),
  };
}

export async function liveQuery<T = FederatoRecord>(
  options: LiveAdapterOptions,
  payload: QueryPayload,
): Promise<QueryResult<T>> {
  const data = await callHandler(options, tokenSourceFor(options), { action: 'query', payload });
  return toQueryResult<T>(data, payload);
}

export async function liveSchema(options: LiveAdapterOptions): Promise<SchemaDocument> {
  // API_DOCUMENTATION.pdf sends `{ action: "schema" }` with no payload.
  const data = await callHandler(options, tokenSourceFor(options), { action: 'schema' });
  return toSchemaDocument(data, new Date().toISOString());
}

/** Guidelines are a PDF, not an endpoint (PRD §7.1): served from the transcription. */
export function liveGuidelines(_options: LiveAdapterOptions): Promise<GuidelinesDocument> {
  return Promise.resolve().then(() => readGuidelines());
}

/** The glossary is a PDF, not an endpoint (PRD §7.1): served from the transcription. */
export function liveGlossary(_options: LiveAdapterOptions): Promise<GlossaryDocument> {
  return Promise.resolve().then(() => readGlossary());
}
