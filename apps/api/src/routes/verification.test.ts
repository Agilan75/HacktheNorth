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

describe('GET /verification/field and /verification/cases/:index', () => {
  it('serves the field summary and one byte per case', async () => {
    const app = createApp({ deps, registrars: [registerVerificationRoutes] });
    const summary = (await (await app.request('/verification/field')).json()) as { total: number; byVerdict: number[] };
    expect(summary.byVerdict.reduce((a, b) => a + b, 0)).toBe(summary.total);
    const res = await app.request('/verification/field/cases');
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe(summary.total);
    expect((await app.request('/verification/field/nope')).status).toBe(404);
  });

  it('rebuilds a case whose verdict matches its recorded byte, with the engine and the naive side agreeing', async () => {
    const app = createApp({ deps, registrars: [registerVerificationRoutes] });
    const bytes = new Uint8Array(await (await app.request('/verification/field/cases')).arrayBuffer());
    for (const index of [0, 9, 4382119]) {
      const res = await app.request(`/verification/cases/${index}`);
      expect(res.status).toBe(200);
      const c = (await res.json()) as { index: number; agreed: boolean; engine: { verdict: string }; invariants: { violations: string[] }[] };
      expect(c.index).toBe(index);
      expect(c.agreed).toBe(true);
      expect(['FIT', 'REFER', 'DOES_NOT_FIT'][bytes[index]! & 3]).toBe(c.engine.verdict);
      expect(c.invariants.every((i) => i.violations.length === 0)).toBe(true);
    }
    expect((await app.request('/verification/cases/-1')).status).toBe(404);
    expect((await app.request('/verification/cases/abc')).status).toBe(404);
  });
});
