import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enrichResponseSchema, runResponseSchema } from '@retrofit/contracts';
import type { EnrichmentCardDto, ScoreSnapshotDto } from '@retrofit/contracts';
import type { CanonicalSubmission, EngineResult, ExternalValue } from '@retrofit/engine';
import type { FederatoAdapter } from '@retrofit/federato';
import { createApp } from '../app';
import { createDb } from '../db/client';
import type { DbHandle } from '../db/client';
import { migrate } from '../db/migrate';
import { createRepos } from '../db/repos';
import type { EnrichContext, EnrichOutcome } from '../enrich/types';
import { createFakeLlm } from '../llm/fake-provider';
import type { RescoreOneInput, RescoreOneResult } from '../services/rescore';
import { fixedClock } from '../services/types';
import type { Deps } from '../services/types';
import { registerRunRoutes } from './run';

/* The runner (A08) and rescore (A16) are built in parallel; the route is under test. */
const runEnrichmentMock = vi.hoisted(() => vi.fn());
const rescoreOneMock = vi.hoisted(() => vi.fn());
vi.mock('../enrich/runner', () => ({ runEnrichment: runEnrichmentMock, defaultPlugins: () => [] }));
vi.mock('../services/rescore', () => ({ rescoreOne: rescoreOneMock }));

const NOW = '2026-09-19T12:00:00.000Z';

const adapter: FederatoAdapter = {
  kind: 'mock',
  getSchema: () => Promise.reject(new Error('unused')),
  query: () => Promise.reject(new Error('unused')),
  getGuidelines: () => Promise.reject(new Error('unused')),
  getGlossary: () => Promise.reject(new Error('unused')),
};

const broker = { source: 'broker' } as unknown as ExternalValue['provenance'];
const enriched = { source: 'enrichment' } as unknown as ExternalValue['provenance'];

const canonical = {
  id: 'sub-1',
  lineOfBusiness: 'commercial_property',
  locations: [
    {
      externalId: 'LOC-1',
      state: [{ value: 'TX', provenance: broker }],
      city: [{ value: 'Austin', provenance: broker }],
      postalCode: [{ value: '78701', provenance: broker }],
      latitude: [{ value: 30.27, provenance: broker }],
      longitude: [{ value: -97.74, provenance: broker }],
    },
    { externalId: 'LOC-2' },
  ],
} as unknown as CanonicalSubmission;

const snap = (score: number, rank: number | null): ScoreSnapshotDto => ({
  appetiteScore: score,
  verdict: 'REFER',
  completeness: 0.9,
  confidence: 0.8,
  predictedPremium: 81234,
  qualityIndex: 0.7,
  rank,
});

const result = {
  id: 'sub-1',
  lineOfBusiness: 'commercial_property',
  vector: {},
  evaluate: { appetiteScore: 71.5 },
  verdict: { verdict: 'REFER', decidingRule: null },
  price: { predictedPremium: 81234 },
} as unknown as EngineResult;

const floodValue: ExternalValue = {
  canonicalPath: 'locations.LOC-1.floodZone',
  value: 'AE',
  provenance: enriched,
};
const fireValue: ExternalValue = {
  canonicalPath: 'locations.LOC-1.fireStationDistanceKm',
  value: 2.4,
  provenance: enriched,
};

function card(source: string, available: boolean): EnrichmentCardDto {
  return {
    source,
    title: source,
    available,
    unavailableReason: available ? null : 'timeout after 6000 ms',
    fetchedAt: available ? NOW : null,
    fields: [],
    attribution: 'test',
  };
}

function outcome(source: string, available: boolean, values: readonly ExternalValue[]): EnrichOutcome {
  return {
    source,
    available,
    unavailableReason: available ? null : 'timeout after 6000 ms',
    values,
    card: card(source, available),
    raw: { source },
    durationMs: 12,
  };
}

let handle: DbHandle;
let deps: Deps;

beforeEach(() => {
  runEnrichmentMock.mockReset();
  rescoreOneMock.mockReset();
  rescoreOneMock.mockImplementation(
    (_d: Deps, input: RescoreOneInput): Promise<RescoreOneResult> =>
      Promise.resolve({
        before: snap(61.5, 7),
        after: snap(61.5 + 10 * (input.extra?.length ?? 0), 3),
        result,
        rankChanged: true,
      }),
  );
  handle = createDb({ url: ':memory:' });
  migrate(handle);
  deps = { db: handle.db, adapter, llm: createFakeLlm(), clock: fixedClock(NOW) };
});

afterEach(() => handle.close());

const makeApp = () => createApp({ deps, registrars: [registerRunRoutes] });

function insert(id: string, canon: CanonicalSubmission | null) {
  return createRepos(deps.db).submissions.upsertByExternalId({
    id,
    source: 'federato',
    lineOfBusiness: 'commercial_property',
    externalId: `EXT-${id}`,
    insuredName: 'Acme',
    raw: null,
    canonical: canon,
    result: null,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

describe('POST /enrich/:id', () => {
  it('runs the plugins on canonical locations, stores every card, re-scores with available values only', async () => {
    insert('sub-1', canonical);
    runEnrichmentMock.mockResolvedValue([
      outcome('openfema_flood', true, [floodValue]),
      outcome('overpass_fire_station', false, [fireValue]),
    ]);

    const res = await makeApp().request('/enrich/sub-1', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = enrichResponseSchema.parse(await res.json());

    const context = runEnrichmentMock.mock.calls[0]?.[0] as EnrichContext;
    expect(context.submissionId).toBe('sub-1');
    expect(context.nowIso).toBe(NOW);
    expect(context.locations).toEqual([
      { externalId: 'LOC-1', address: null, city: 'Austin', state: 'TX', zip: '78701', latitude: 30.27, longitude: -97.74 },
      { externalId: 'LOC-2', address: null, city: null, state: null, zip: null, latitude: null, longitude: null },
    ]);

    // The unavailable plugin's values never reach the engine.
    expect(rescoreOneMock).toHaveBeenCalledTimes(1);
    expect(rescoreOneMock.mock.calls[0]?.[1]).toEqual({ submissionId: 'sub-1', extra: [floodValue] });

    expect(body.id).toBe('sub-1');
    expect(body.cards.map((c) => [c.source, c.available])).toEqual([
      ['openfema_flood', true],
      ['overpass_fire_station', false],
    ]);
    expect(body.before).toEqual(snap(61.5, 7));
    expect(body.after).toEqual(snap(71.5, 3));

    const rows = createRepos(deps.db).enrichments.bySubmissionId('sub-1');
    expect(rows.map((r) => [r.id, r.source, r.available])).toEqual([
      ['sub-1:openfema_flood', 'openfema_flood', true],
      ['sub-1:overpass_fire_station', 'overpass_fire_station', false],
    ]);
    expect(rows[0]?.createdAt).toBe(NOW);
    expect((rows[0]?.payload as { values: unknown }).values).toEqual([floodValue]);
  });

  it('re-running replaces the stored payload instead of adding a row', async () => {
    insert('sub-1', canonical);
    runEnrichmentMock.mockResolvedValueOnce([outcome('openfema_flood', false, [])]);
    runEnrichmentMock.mockResolvedValueOnce([outcome('openfema_flood', true, [floodValue])]);
    const app = makeApp();
    await app.request('/enrich/sub-1', { method: 'POST' });
    await app.request('/enrich/sub-1', { method: 'POST' });
    const rows = createRepos(deps.db).enrichments.bySubmissionId('sub-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.available).toBe(true);
  });

  it('404s an unknown id and 409s a submission with no canonical record', async () => {
    insert('bare', null);
    const app = makeApp();
    const missing = await app.request('/enrich/nope', { method: 'POST' });
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
    const bare = await app.request('/enrich/bare', { method: 'POST' });
    expect(bare.status).toBe(409);
    expect(((await bare.json()) as { error: { code: string } }).error.code).toBe('NOT_NORMALIZED');
    expect(runEnrichmentMock).not.toHaveBeenCalled();
    expect(rescoreOneMock).not.toHaveBeenCalled();
  });
});

describe('POST /submissions/:id/run', () => {
  it('re-runs enrichment and the engine, returning before/after and rankChanged', async () => {
    insert('sub-1', canonical);
    runEnrichmentMock.mockResolvedValue([
      outcome('openfema_flood', true, [floodValue]),
      outcome('overpass_fire_station', true, [fireValue]),
    ]);
    const res = await makeApp().request('/submissions/sub-1/run', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = runResponseSchema.parse(await res.json());
    expect(rescoreOneMock.mock.calls[0]?.[1]).toEqual({
      submissionId: 'sub-1',
      extra: [floodValue, fireValue],
    });
    expect(body).toMatchObject({ id: 'sub-1', rankChanged: true });
    expect(body.before?.rank).toBe(7);
    expect(body.after.rank).toBe(3);
    expect(body.after.appetiteScore).toBe(81.5);
  });

  it('falls back to the last stored enrichment values when the runner throws', async () => {
    insert('sub-1', canonical);
    const app = makeApp();
    runEnrichmentMock.mockResolvedValueOnce([
      outcome('openfema_flood', true, [floodValue]),
      outcome('overpass_fire_station', false, [fireValue]),
    ]);
    await app.request('/enrich/sub-1', { method: 'POST' });

    runEnrichmentMock.mockRejectedValueOnce(new Error('runner down'));
    const res = await app.request('/submissions/sub-1/run', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(rescoreOneMock.mock.calls[1]?.[1]).toEqual({ submissionId: 'sub-1', extra: [floodValue] });
  });

  it('404s an unknown id', async () => {
    const res = await makeApp().request('/submissions/nope/run', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('surfaces a rescore failure as a 500 INTERNAL', async () => {
    insert('sub-1', canonical);
    runEnrichmentMock.mockResolvedValue([]);
    rescoreOneMock.mockRejectedValueOnce(new Error('engine blew up'));
    const res = await makeApp().request('/submissions/sub-1/run', { method: 'POST' });
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INTERNAL');
  });
});
