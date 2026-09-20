import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PAGE_LIMIT,
  actionsPlanResponseSchema,
  actionsResponseSchema,
  approveActionResponseSchema,
  errorSchema,
} from '@retrofit/contracts';
import type {
  ActionDto,
  ActionsPlanResponseDto,
  RequestedFieldDto,
  ScoreSnapshotDto,
} from '@retrofit/contracts';
import type { FederatoAdapter } from '@retrofit/federato';
import { createApp } from '../app';
import { createDb } from '../db/client';
import type { DbHandle } from '../db/client';
import { migrate } from '../db/migrate';
import { createRepos } from '../db/repos';
import type { NewActionRow } from '../db/schema';
import { createFakeLlm } from '../llm/fake-provider';
import { LlmError, LlmUnavailableError } from '../llm/types';
import { fixedClock } from '../services/types';
import type { Deps } from '../services/types';
import { registerActionRoutes } from './actions';

/** The services are A17's and built in parallel; the route is what is under test. */
const svc = vi.hoisted(() => ({ planActions: vi.fn(), approveAction: vi.fn() }));
vi.mock('../services/actions', () => svc);

const NOW = '2026-09-19T12:00:00.000Z';

const adapter: FederatoAdapter = {
  kind: 'mock',
  getSchema: () => Promise.reject(new Error('unused')),
  query: () => Promise.reject(new Error('unused')),
  getGuidelines: () => Promise.reject(new Error('unused')),
  getGlossary: () => Promise.reject(new Error('unused')),
};

const before: ScoreSnapshotDto = {
  appetiteScore: 61.5,
  verdict: 'REFER',
  completeness: 0.75,
  confidence: 0.8,
  predictedPremium: 81234,
  qualityIndex: 0.42,
  rank: 17,
};
const after: ScoreSnapshotDto = { ...before, appetiteScore: 78, verdict: 'FIT', rank: 4 };

const field: RequestedFieldDto = {
  canonicalPath: 'buildings[2].yearBuilt',
  componentKey: 'building_age',
  label: 'Year built, Building C',
  why: 'it decides the building-age factor',
  factor: 'building_age',
  ruleId: 'AG-BA-R',
  currentValue: null,
  severity: 'HIGH',
};

let handle: DbHandle;
let deps: Deps;

beforeEach(() => {
  svc.planActions.mockReset();
  svc.approveAction.mockReset();
  handle = createDb({ url: ':memory:' });
  migrate(handle);
  deps = { db: handle.db, adapter, llm: createFakeLlm(), clock: fixedClock(NOW) };
});

afterEach(() => handle.close());

const makeApp = () => createApp({ deps, registrars: [registerActionRoutes] });
const repos = () => createRepos(deps.db);

function insertSubmission(id: string, externalId: string, insuredName: string | null) {
  repos().submissions.upsertByExternalId({
    id,
    source: 'federato',
    lineOfBusiness: 'commercial_property',
    externalId,
    insuredName,
    raw: null,
    canonical: null,
    result: null,
    shareSlug: null,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

function insertAction(row: Partial<NewActionRow> & { id: string; submissionId: string; createdAt: string }) {
  return repos().actions.insert({ type: 'request', status: 'draft', actor: 'code', payload: {}, ...row });
}

const post = (app: ReturnType<typeof makeApp>, path: string, body?: unknown, raw?: string) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });

const errorCode = async (res: Response) => errorSchema.parse(await res.json()).error.code;

describe('POST /actions/plan', () => {
  const planned: ActionsPlanResponseDto = { routed: 3, needsSeniorReferral: 1, drafted: 2, skipped: 5, actions: [] };

  it('passes the parsed request to the service and returns its counts unchanged', async () => {
    svc.planActions.mockResolvedValue(planned);
    const res = await post(makeApp(), '/actions/plan', { externalIds: ['SUB-1', 'SUB-2'], draftsOff: true });
    expect(res.status).toBe(200);
    const body = actionsPlanResponseSchema.parse(await res.json());
    expect(body).toEqual(planned);
    expect(svc.planActions).toHaveBeenCalledTimes(1);
    expect(svc.planActions).toHaveBeenCalledWith(deps, { externalIds: ['SUB-1', 'SUB-2'], draftsOff: true });
  });

  it('treats an empty body as "plan everything"', async () => {
    svc.planActions.mockResolvedValue(planned);
    const res = await post(makeApp(), '/actions/plan');
    expect(res.status).toBe(200);
    expect(svc.planActions).toHaveBeenCalledWith(deps, {});
  });

  it('400s malformed JSON and 422s a bad shape without calling the service', async () => {
    const app = makeApp();
    const bad = await post(app, '/actions/plan', undefined, '{not json');
    expect(bad.status).toBe(400);
    expect(await errorCode(bad)).toBe('INVALID_JSON');

    const wrong = await post(app, '/actions/plan', { draftsOff: 'yes', externalIds: [''] });
    expect(wrong.status).toBe(422);
    const err = errorSchema.parse(await wrong.json()).error;
    expect(err.code).toBe('VALIDATION');
    expect(err.issues?.map((i) => i.path).sort()).toEqual(['draftsOff', 'externalIds.0']);
    expect(svc.planActions).not.toHaveBeenCalled();
  });

  it('maps Gemini failures to 503 / 502', async () => {
    const app = makeApp();
    svc.planActions.mockRejectedValueOnce(new LlmUnavailableError('draft-request'));
    const off = await post(app, '/actions/plan', {});
    expect(off.status).toBe(503);
    expect(await errorCode(off)).toBe('LLM_UNAVAILABLE');

    svc.planActions.mockRejectedValueOnce(new LlmError('bad json', { callName: 'draft-request' }));
    const failed = await post(app, '/actions/plan', {});
    expect(failed.status).toBe(502);
    expect(await errorCode(failed)).toBe('LLM_FAILED');
  });

  it('still answers 501 while the service is a stub', async () => {
    svc.planActions.mockRejectedValue(new Error('NOT_IMPLEMENTED:A17'));
    const res = await post(makeApp(), '/actions/plan', {});
    expect(res.status).toBe(501);
  });
});

describe('GET /actions', () => {
  beforeEach(() => {
    insertSubmission('s1', 'SUB-001', 'Acme Holdings');
    insertSubmission('s2', 'SUB-002', null);
    insertAction({
      id: 'a1',
      submissionId: 's1',
      createdAt: '2026-09-19T10:00:00.000Z',
      payload: {
        triggers: ['missing_data'],
        fields: [field],
        draft: 'Year built for Building C is missing; it decides the building-age factor.',
        recipient: { name: 'Pat Broker', email: 'pat@example.test', brokerName: 'Broker Co' },
      },
    });
    insertAction({
      id: 'a2',
      submissionId: 's1',
      type: 'reply',
      status: 'applied',
      actor: 'gemini:extract-reply',
      createdAt: '2026-09-19T11:00:00.000Z',
      before,
      after,
      sourceText: 'Building C was built in 1998.',
      payload: { rankBefore: 17, rankAfter: 4, note: '1 value accepted' },
    });
    insertAction({ id: 'a3', submissionId: 's2', type: 'route', status: 'sent', createdAt: '2026-09-19T09:00:00.000Z' });
  });

  it('returns every action newest first, fully mapped, with the simulated-sending flag', async () => {
    const res = await makeApp().request('/actions');
    expect(res.status).toBe(200);
    const body = actionsResponseSchema.parse(await res.json());
    expect(body.sendingIsSimulated).toBe(true);
    expect(body.page).toEqual({ total: 3, limit: DEFAULT_PAGE_LIMIT, offset: 0 });
    expect(body.actions.map((a) => a.id)).toEqual(['a2', 'a1', 'a3']);

    const [reply, request, route] = body.actions as [ActionDto, ActionDto, ActionDto];
    expect(reply).toEqual({
      id: 'a2',
      submissionId: 's1',
      externalId: 'SUB-001',
      insuredName: 'Acme Holdings',
      type: 'reply',
      status: 'applied',
      actor: 'gemini:extract-reply',
      triggers: [],
      fields: [],
      draft: null,
      recipient: null,
      routing: null,
      sourceText: 'Building C was built in 1998.',
      extracted: [],
      before,
      after,
      rankBefore: 17,
      rankAfter: 4,
      note: '1 value accepted',
      createdAt: '2026-09-19T11:00:00.000Z',
    });
    expect(request.triggers).toEqual(['missing_data']);
    expect(request.fields).toEqual([field]);
    expect(request.recipient?.email).toBe('pat@example.test');
    expect(request.before).toBeNull();
    expect(route.externalId).toBe('SUB-002');
    expect(route.insuredName).toBeNull();
  });

  it('filters by status, type and submission, and pages', async () => {
    const app = makeApp();
    const drafts = actionsResponseSchema.parse(await (await app.request('/actions?status=draft')).json());
    expect(drafts.actions.map((a) => a.id)).toEqual(['a1']);
    expect(drafts.page.total).toBe(1);

    const routes = actionsResponseSchema.parse(await (await app.request('/actions?type=route')).json());
    expect(routes.actions.map((a) => a.id)).toEqual(['a3']);

    const s1 = actionsResponseSchema.parse(await (await app.request('/actions?submissionId=s1')).json());
    expect(s1.actions.map((a) => a.id)).toEqual(['a2', 'a1']);

    const paged = actionsResponseSchema.parse(await (await app.request('/actions?limit=1&offset=1')).json());
    expect(paged.actions.map((a) => a.id)).toEqual(['a1']);
    expect(paged.page).toEqual({ total: 3, limit: 1, offset: 1 });
  });

  it('422s an unknown status or an out-of-range limit', async () => {
    const app = makeApp();
    const status = await app.request('/actions?status=emailed');
    expect(status.status).toBe(422);
    expect(await errorCode(status)).toBe('VALIDATION');
    const limit = await app.request('/actions?limit=501');
    expect(limit.status).toBe(422);
  });

  it('returns an empty page rather than an error when nothing matches', async () => {
    const body = actionsResponseSchema.parse(await (await makeApp().request('/actions?submissionId=none')).json());
    expect(body.actions).toEqual([]);
    expect(body.page.total).toBe(0);
  });
});

describe('POST /actions/:id/approve', () => {
  beforeEach(() => {
    insertSubmission('s1', 'SUB-001', 'Acme Holdings');
    insertAction({ id: 'draft-1', submissionId: 's1', createdAt: NOW });
    insertAction({ id: 'sent-1', submissionId: 's1', status: 'sent', createdAt: NOW });
  });

  it('approves a draft through the service and returns the action it gives back', async () => {
    const full: ActionDto = {
      id: 'draft-1',
      submissionId: 's1',
      externalId: 'SUB-001',
      insuredName: 'Acme Holdings',
      type: 'request',
      status: 'sent',
      actor: 'underwriter',
      triggers: ['missing_data'],
      fields: [field],
      draft: 'text',
      recipient: null,
      routing: null,
      sourceText: null,
      extracted: [],
      before: null,
      after: null,
      rankBefore: null,
      rankAfter: null,
      note: 'simulated send',
      createdAt: NOW,
    };
    svc.approveAction.mockResolvedValue(full);
    const res = await post(makeApp(), '/actions/draft-1/approve');
    expect(res.status).toBe(200);
    const body = approveActionResponseSchema.parse(await res.json());
    expect(body.action.status).toBe('sent');
    expect(body.action.id).toBe('draft-1');
    expect(svc.approveAction).toHaveBeenCalledWith(deps, 'draft-1');
  });

  it('404s an unknown action and 409s one that is not a draft, never calling the service', async () => {
    const app = makeApp();
    const missing = await post(app, '/actions/nope/approve');
    expect(missing.status).toBe(404);
    expect(await errorCode(missing)).toBe('NOT_FOUND');

    const again = await post(app, '/actions/sent-1/approve');
    expect(again.status).toBe(409);
    expect(await errorCode(again)).toBe('NOT_A_DRAFT');
    expect(svc.approveAction).not.toHaveBeenCalled();
  });
});
