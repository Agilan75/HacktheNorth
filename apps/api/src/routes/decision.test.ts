import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decisionResponseSchema } from '@retrofit/contracts';
import type { ErrorDto } from '@retrofit/contracts';
import type { CanonicalSubmission, EngineResult } from '@retrofit/engine';
import type { FederatoAdapter } from '@retrofit/federato';
import { createApp } from '../app';
import { createDb } from '../db/client';
import type { DbHandle } from '../db/client';
import { migrate } from '../db/migrate';
import { createRepos } from '../db/repos';
import { createFakeLlm } from '../llm/fake-provider';
import { fixedClock } from '../services/types';
import type { Deps } from '../services/types';
import { registerRunRoutes } from './run';

/**
 * `POST /submissions/:id/decision` — the underwriter's accept or decline.
 *
 * The one thing these tests exist to defend: **recording a decision never
 * changes the engine's answer.** The whole system's claim is that a verdict
 * traces to a guideline row; a verdict a person could overwrite would trace to
 * nothing. So every test here re-reads the stored result afterwards and asserts
 * it is byte-identical.
 *
 * Unlike `run.test.ts` this file mocks nothing: the decision path touches the
 * real repository and never re-runs the engine, which is itself the point.
 */

const NOW = '2026-09-19T12:00:00.000Z';

const adapter: FederatoAdapter = {
  kind: 'mock',
  getSchema: () => Promise.reject(new Error('unused')),
  query: () => Promise.reject(new Error('unused')),
  getGuidelines: () => Promise.reject(new Error('unused')),
  getGlossary: () => Promise.reject(new Error('unused')),
};

const result = {
  id: 'sub-1',
  lineOfBusiness: 'commercial_property',
  vector: {},
  rollup: {},
  evaluate: { appetiteScore: 71.5, completeness: 88, confidence: 0.7 },
  verdict: { verdict: 'REFER', decidingRule: { ruleId: 'AG-TIV-A-LOW' } },
  price: { predictedPremium: 81_234 },
  qualityIndex: 64.25,
} as unknown as EngineResult;

/** Every scored account has one; the route's lookup requires it. */
const canonical = {
  id: 'sub-1',
  lineOfBusiness: 'commercial_property',
  insured: {},
  locations: [],
  buildings: [],
  hazards: { present: {} },
  exposure: {},
  coverage: { lines: [] },
  history: [],
  pricing: {},
} as unknown as CanonicalSubmission;

let handle: DbHandle;
let deps: Deps;

beforeEach(() => {
  handle = createDb({ url: ':memory:' });
  migrate(handle);
  deps = { db: handle.db, adapter, llm: createFakeLlm(), clock: fixedClock(NOW) };
});

afterEach(() => handle.close());

const makeApp = () => createApp({ deps, registrars: [registerRunRoutes] });

function seed(scored: boolean): void {
  createRepos(deps.db).submissions.upsertByExternalId({
    id: 'sub-1',
    source: 'federato',
    lineOfBusiness: 'commercial_property',
    externalId: 'EXT-sub-1',
    insuredName: 'Acme Freight',
    raw: null,
    canonical,
    result: scored ? result : null,
    rank: 7,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

const decide = (body: unknown, id = 'sub-1') =>
  makeApp().request(`/submissions/${id}/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const stored = () => createRepos(deps.db).submissions.byId('sub-1');

describe('POST /submissions/:id/decision', () => {
  it('records an accept beside the verdict, and leaves the verdict exactly as the engine left it', async () => {
    seed(true);
    const before = stored()?.result;

    const res = await decide({ decision: 'accept', reason: 'Quote is adequate and the flood zone is clear.' });
    expect(res.status).toBe(200);
    const body = decisionResponseSchema.parse(await res.json());

    expect(body.decision).toBe('accept');
    // The engine's verdict is reported back, not replaced by the decision.
    expect(body.engineVerdict).toBe('REFER');
    expect(body.action.type).toBe('decision');
    expect(body.action.actor).toBe('underwriter');
    expect(body.action.status).toBe('applied');
    expect(body.action.decision).toBe('accept');
    expect(body.action.note).toContain('Quote is adequate');
    expect(body.action.note).toContain('that verdict is unchanged');

    // The stored result is untouched, field for field.
    expect(stored()?.result).toEqual(before);
    expect(stored()?.rank).toBe(7);
  });

  it('records a decline that disagrees with the engine, and keeps both sides', async () => {
    seed(true);
    const res = await decide({ decision: 'decline', reason: 'Broker relationship is not worth the referral.' });
    const body = decisionResponseSchema.parse(await res.json());

    expect(body.decision).toBe('decline');
    expect(body.engineVerdict).toBe('REFER');
    expect(body.action.decision).toBe('decline');
    // A disagreement is exactly the case worth reading later, so the reason survives verbatim.
    expect(body.action.note).toContain('Broker relationship is not worth the referral.');
    expect(stored()?.result?.verdict.verdict).toBe('REFER');
  });

  it('moves no score: the before and after snapshots are identical', async () => {
    seed(true);
    const body = decisionResponseSchema.parse(await (await decide({ decision: 'accept' })).json());

    expect(body.action.before).not.toBeNull();
    expect(body.action.after).toEqual(body.action.before);
    expect(body.action.before?.appetiteScore).toBe(71.5);
    expect(body.action.before?.verdict).toBe('REFER');
    // The snapshot says what the decision was taken against, which matters once
    // a later broker reply re-scores the account.
    expect(body.action.before?.rank).toBe(7);
  });

  it('accepts a decision with no reason, and still says what the engine concluded', async () => {
    seed(true);
    const body = decisionResponseSchema.parse(await (await decide({ decision: 'accept' })).json());
    expect(body.action.note).toContain('Accepted by the underwriter');
    expect(body.action.note).toContain('REFER');
  });

  it('keeps every decision, so a change of mind is an addition and not an edit', async () => {
    seed(true);
    await decide({ decision: 'accept', reason: 'first call' });
    await decide({ decision: 'decline', reason: 'second call' });

    const rows = createRepos(deps.db).actions.list({ submissionId: 'sub-1', type: 'decision' }).rows;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.payload.decision).sort()).toEqual(['accept', 'decline']);
  });

  it('rejects a decision that is not accept or decline', async () => {
    seed(true);
    const res = await decide({ decision: 'maybe' });
    expect(res.status).toBe(422);
    const body = (await res.json()) as ErrorDto;
    expect(body.error.code).toBe('INVALID_REQUEST');
    expect((body.error.issues ?? []).map((i) => i.path)).toEqual(['decision']);
  });

  it('rejects a body that is not JSON, and an empty body', async () => {
    seed(true);
    expect((await decide('{not json')).status).toBe(422);
    // An empty body has no decision, so it fails the schema rather than guessing one.
    expect((await decide('')).status).toBe(422);
  });

  it('refuses to decide an account the engine has not scored', async () => {
    seed(false);
    const res = await decide({ decision: 'accept' });
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorDto;
    expect(body.error.code).toBe('NOT_SCORED');
    expect(body.error.message).toContain('not been scored');
  });

  it('is a 404 for an unknown submission', async () => {
    seed(true);
    const res = await decide({ decision: 'accept' }, 'nope');
    expect(res.status).toBe(404);
  });
});
