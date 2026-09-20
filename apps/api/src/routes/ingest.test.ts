import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ingestResponseSchema, ingestRunSchema, ingestStartedSchema } from '@retrofit/contracts';
import type { ErrorDto, IngestRequestDto, IngestResponseDto } from '@retrofit/contracts';
import type { FederatoAdapter, QueryTraceEntry } from '@retrofit/federato';
import { createApp } from '../app';
import { createDb } from '../db/client';
import type { DbHandle } from '../db/client';
import { migrate } from '../db/migrate';
import { createFakeLlm } from '../llm/fake-provider';
import { resetIngestRuns } from '../services/ingest-progress';
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

/*
 * The async path is what the console's live run uses: a 202 with a run id,
 * then polling while the planner works. These tests hold the service open on a
 * deferred promise so the run is observed mid-flight, which is the only state
 * the console ever renders.
 */
describe('POST /ingest/federato with async, and GET /ingest/runs/:runId', () => {
  const STEP: QueryTraceEntry = {
    id: 'q-000',
    seq: 0,
    pass: 'triage',
    goal: 'List every submission cheaply and knock out every non-property line.',
    requiredBy: [],
    pathChosen: { rootResource: 'Submission', path: [], why: 'Submission carries line_of_business.', alternativesRejected: [] },
    payload: { resource: 'Submission' } as QueryTraceEntry['payload'],
    rowCount: 158,
    totalAvailable: 158,
    durationMs: 1851,
    adapterKind: 'mock',
    startedAt: '2026-09-19T12:00:00.000Z',
    outcome: 'ok',
    error: null,
    adaptedFrom: null,
    adaptation: 'none',
    notes: [],
  };

  beforeEach(() => resetIngestRuns());

  const startAsync = () => post(JSON.stringify({ async: true }));

  const runIdOf = async (res: Response): Promise<string> => {
    const body = ingestStartedSchema.parse(await res.json());
    return body.runId;
  };

  const getRun = (runId: string) => makeApp().request(`/ingest/runs/${runId}`);

  it('answers 202 with a run id at once, without waiting for the run', async () => {
    let settle: (value: IngestResponseDto) => void = () => undefined;
    ingestMock.mockImplementation(() => new Promise<IngestResponseDto>((resolve) => (settle = resolve)));

    const res = await startAsync();
    expect(res.status).toBe(202);
    const runId = await runIdOf(res);
    expect(runId).not.toBe('');

    // The run is still going: no result yet, and it is not done.
    const pending = ingestRunSchema.parse(await (await getRun(runId)).json());
    expect(pending.done).toBe(false);
    expect(pending.result).toBeNull();
    expect(pending.error).toBeNull();

    settle(RESPONSE);
    await vi.waitFor(async () => {
      const finished = ingestRunSchema.parse(await (await getRun(runId)).json());
      expect(finished.done).toBe(true);
      expect(finished.result).toEqual(RESPONSE);
      expect(finished.finishedAt).not.toBeNull();
    });
  });

  it('reports each planner query as it lands, with its real row count and duration', async () => {
    let settle: (value: IngestResponseDto) => void = () => undefined;
    let report: ((entry: QueryTraceEntry) => void) | undefined;
    ingestMock.mockImplementation(
      (_deps: Deps, _req: IngestRequestDto, onQuery?: (entry: QueryTraceEntry) => void) => {
        report = onQuery;
        return new Promise<IngestResponseDto>((resolve) => (settle = resolve));
      },
    );

    const runId = await runIdOf(await startAsync());
    expect(report).toBeTypeOf('function');

    // Nothing has landed yet, so there is nothing to show.
    expect(ingestRunSchema.parse(await (await getRun(runId)).json()).steps).toEqual([]);

    report?.(STEP);
    report?.({ ...STEP, id: 'q-001', seq: 1, pass: 'deep', rowCount: 27, durationMs: 4100 });

    const mid = ingestRunSchema.parse(await (await getRun(runId)).json());
    expect(mid.done).toBe(false);
    expect(mid.steps.map((s) => [s.pass, s.rowCount, s.durationMs])).toEqual([
      ['triage', 158, 1851],
      ['deep', 27, 4100],
    ]);
    expect(mid.steps[0]?.goal).toContain('knock out');
    expect(mid.steps[0]?.rootResource).toBe('Submission');

    settle(RESPONSE);
  });

  it('a run that throws is reported as a failed run, never as an unhandled rejection', async () => {
    ingestMock.mockImplementation(() => Promise.reject(new Error('Federato token expired')));

    const runId = await runIdOf(await startAsync());
    await vi.waitFor(async () => {
      const failed = ingestRunSchema.parse(await (await getRun(runId)).json());
      expect(failed.done).toBe(true);
      expect(failed.error).toBe('Federato token expired');
      expect(failed.result).toBeNull();
    });
  });

  it('an unknown run id is a 404, so the console can fall back to the stored trace', async () => {
    const res = await getRun('run-does-not-exist');
    expect(res.status).toBe(404);
    const body = (await res.json()) as ErrorDto;
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('without async it still blocks and returns the summary, so the seed script is unchanged', async () => {
    const res = await post(JSON.stringify({}));
    expect(res.status).toBe(200);
    expect(ingestResponseSchema.parse(await res.json())).toEqual(RESPONSE);
  });
});
