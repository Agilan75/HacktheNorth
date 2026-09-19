import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ingestResponseSchema } from '@retrofit/contracts';
import type { ErrorDto, IngestRequestDto, IngestResponseDto } from '@retrofit/contracts';
import type { FederatoAdapter } from '@retrofit/federato';
import { createApp } from '../app';
import { createDb } from '../db/client';
import type { DbHandle } from '../db/client';
import { migrate } from '../db/migrate';
import { createFakeLlm } from '../llm/fake-provider';
import { fixedClock } from '../services/types';
import type { Deps } from '../services/types';
import { registerIngestRoutes } from './ingest';

/** The ingest service (A16) is built in parallel; the route is what is under test. */
const ingestMock = vi.hoisted(() => vi.fn());
vi.mock('../services/ingest', () => ({ ingestFederato: ingestMock }));

const unused = () => Promise.reject(new Error('unused'));
const adapter: FederatoAdapter = {
  kind: 'mock',
  getSchema: unused,
  query: unused,
  getGuidelines: unused,
  getGlossary: unused,
};

const RESPONSE: IngestResponseDto = {
  adapter: 'mock',
  ingested: 38,
  updated: 0,
  skipped: 0,
  knockedOutAtTriage: 120,
  noPolicy: 11,
  queryCount: 4,
  durationMs: 1400,
  warnings: [],
  externalIds: ['SUB-1001', 'SUB-1002'],
};

let handle: DbHandle;
let deps: Deps;

beforeEach(() => {
  ingestMock.mockReset();
  ingestMock.mockImplementation((_deps: Deps, _req: IngestRequestDto) => Promise.resolve(RESPONSE));
  handle = createDb({ url: ':memory:' });
  migrate(handle);
  deps = { db: handle.db, adapter, llm: createFakeLlm(), clock: fixedClock('2026-09-19T12:00:00.000Z') };
});

afterEach(() => handle.close());

const makeApp = () => createApp({ deps, registrars: [registerIngestRoutes] });

const post = (body: string | undefined) =>
  makeApp().request('/ingest/federato', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body }),
  });

describe('POST /ingest/federato', () => {
  it('passes the parsed request to the service with the injected deps and returns its result', async () => {
    const res = await post(JSON.stringify({ lineOfBusiness: 'commercial_property', externalIds: ['SUB-1001'], force: true }));
    expect(res.status).toBe(200);
    const body = ingestResponseSchema.parse(await res.json());
    expect(body).toEqual(RESPONSE);
    expect(ingestMock).toHaveBeenCalledTimes(1);
    const [calledDeps, request] = ingestMock.mock.calls[0] as [Deps, IngestRequestDto];
    expect(calledDeps).toBe(deps);
    expect(request).toEqual({ lineOfBusiness: 'commercial_property', externalIds: ['SUB-1001'], force: true });
  });

  it('an empty body ingests the whole book with no options', async () => {
    const res = await post(undefined);
    expect(res.status).toBe(200);
    expect(ingestMock.mock.calls[0]?.[1]).toEqual({});
  });

  it('a body that fails the request schema is a 422 with flattened issues, and nothing runs', async () => {
    const res = await post(JSON.stringify({ lineOfBusiness: 'auto', externalIds: [''] }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as ErrorDto;
    expect(body.error.code).toBe('INVALID_REQUEST');
    const paths = (body.error.issues ?? []).map((i) => i.path).sort();
    expect(paths).toEqual(['externalIds.0', 'lineOfBusiness']);
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it('a body that is not JSON is a 422, and nothing runs', async () => {
    const res = await post('{not json');
    expect(res.status).toBe(422);
    const body = (await res.json()) as ErrorDto;
    expect(body.error.code).toBe('INVALID_REQUEST');
    expect(body.error.issues).toHaveLength(1);
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it('more than 500 external ids is rejected', async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `SUB-${i}`);
    const res = await post(JSON.stringify({ externalIds: ids }));
    expect(res.status).toBe(422);
    expect(ingestMock).not.toHaveBeenCalled();
  });
});
