import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROUTES, verificationResponseSchema } from '@retrofit/contracts';
import type { FederatoAdapter } from '@retrofit/federato';
import { createApp } from '../app';
import { createDb } from '../db/client';
import type { DbHandle } from '../db/client';
import { migrate } from '../db/migrate';
import { createFakeLlm } from '../llm/fake-provider';
import { fixedClock } from '../services/types';
import type { Deps } from '../services/types';
import { registerVerificationRoutes } from './verification';

const unused = () => Promise.reject(new Error('unused'));
const adapter: FederatoAdapter = { kind: 'mock', getSchema: unused, query: unused, getGuidelines: unused, getGlossary: unused };

let handle: DbHandle;
let deps: Deps;

beforeEach(() => {
  handle = createDb({ url: ':memory:' });
  migrate(handle);
  deps = { db: handle.db, adapter, llm: createFakeLlm(), clock: fixedClock('2026-09-19T12:00:00.000Z') };
});
afterEach(() => handle.close());

describe('GET /verification', () => {
  it('is in the route table and serves the committed verification in the wire shape', async () => {
    expect(ROUTES.verification).toMatchObject({ method: 'GET', path: '/verification' });
    const res = await createApp({ deps, registrars: [registerVerificationRoutes] }).request('/verification');
    expect(res.status).toBe(200);
    const body = verificationResponseSchema.parse(await res.json());
    expect(body.layersAB?.completed).toBeGreaterThan(0);
    expect(body.layerC?.byStratum.length).toBeGreaterThan(0);
    expect(body.extraction.status).toBe('not_measured');
  });

  it('is registered by the default app', async () => {
    const res = await createApp({ deps }).request('/verification');
    expect(res.status).toBe(200);
  });
});
