import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aggregateResponseSchema } from '@retrofit/contracts';
import type { AggregateDto } from '@retrofit/contracts';
import type { FederatoAdapter } from '@retrofit/federato';
import { createApp } from '../app';
import { createDb } from '../db/client';
import type { DbHandle } from '../db/client';
import { migrate } from '../db/migrate';
import { createFakeLlm } from '../llm/fake-provider';
import { fixedClock } from '../services/types';
import type { Deps } from '../services/types';
import { registerAggregateRoutes } from './aggregate';

/* The aggregate service (A19) is built in parallel; the route is under test. */
const aggregateMock = vi.hoisted(() => vi.fn());
vi.mock('../services/aggregate', () => ({ aggregate: aggregateMock }));

const adapter: FederatoAdapter = {
  kind: 'mock',
  getSchema: () => Promise.reject(new Error('unused')),
  query: () => Promise.reject(new Error('unused')),
  getGuidelines: () => Promise.reject(new Error('unused')),
  getGlossary: () => Promise.reject(new Error('unused')),
};

const dto: AggregateDto = {
  counts: {
    total: 158,
    byVerdict: { FIT: 40, REFER: 70, DOES_NOT_FIT: 48 },
    byLine: { commercial_property: 158 },
    scored: 158,
    knockedOut: 31,
  },
  scoreHistogram: [0, 2, 5, 9, 14, 22, 30, 38, 25, 13],
  topKnockoutFactors: [{ factor: 'primary_risk_state', label: 'Primary risk state', count: 19 }],
  oneFlipAway: [
    {
      id: 'sub-9',
      externalId: 'SUB-0009',
      insuredName: null,
      appetiteScore: 68.5,
      moveLabel: 'Sprinkler Building B',
      scoreAfter: 74.5,
      premiumAfter: null,
    },
  ],
  bookAdequacy: { median: 0.94, underpricedCount: 41, n: 120 },
  verification: null,
};

let handle: DbHandle;
let deps: Deps;

beforeEach(() => {
  aggregateMock.mockReset();
  handle = createDb({ url: ':memory:' });
  migrate(handle);
  deps = { db: handle.db, adapter, llm: createFakeLlm(), clock: fixedClock('2026-09-19T12:00:00.000Z') };
});

afterEach(() => handle.close());

describe('GET /aggregate', () => {
  it('serves the aggregate service output unchanged', async () => {
    aggregateMock.mockResolvedValue(dto);
    const app = createApp({ deps, registrars: [registerAggregateRoutes] });
    const res = await app.request('/aggregate');
    expect(res.status).toBe(200);
    const body = aggregateResponseSchema.parse(await res.json());
    expect(body).toEqual(dto);
    expect(body.scoreHistogram.reduce((a, b) => a + b, 0)).toBe(158);
    expect(aggregateMock).toHaveBeenCalledWith(deps);
  });

  it('returns 500 INTERNAL when the service fails', async () => {
    aggregateMock.mockRejectedValue(new Error('summary.json unreadable'));
    const app = createApp({ deps, registrars: [registerAggregateRoutes] });
    const res = await app.request('/aggregate');
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INTERNAL');
  });
});
