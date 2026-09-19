import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorSchema, replyResponseSchema } from '@retrofit/contracts';
import type { ActionDto, ReplyResponseDto, ScoreSnapshotDto } from '@retrofit/contracts';
import type { EngineResult } from '@retrofit/engine';
import type { FederatoAdapter } from '@retrofit/federato';
import { createApp } from '../app';
import { createDb } from '../db/client';
import type { DbHandle } from '../db/client';
import { migrate } from '../db/migrate';
import { createRepos } from '../db/repos';
import { createFakeLlm } from '../llm/fake-provider';
import { LlmError, LlmUnavailableError } from '../llm/types';
import { fixedClock } from '../services/types';
import type { Deps } from '../services/types';
import { registerReplyRoutes } from './reply';

/** The service is A17's and built in parallel; the route is what is under test. */
const svc = vi.hoisted(() => ({ applyBrokerReply: vi.fn() }));
vi.mock('../services/reply', () => svc);

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
const storedResult = {
  id: 's1',
  vector: { x: [], t: [], m: [] },
  evaluate: { appetiteScore: 61.5 },
  verdict: { verdict: 'REFER', decidingRule: null },
  price: { predictedPremium: 81234 },
} as unknown as EngineResult;

const replyAction: ActionDto = {
  id: 'r1',
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
  note: null,
  createdAt: NOW,
};

const accepted = {
  canonicalPath: 'buildings[2].yearBuilt',
  value: 1998,
  confidence: 0.93,
  quote: 'Building C was built in 1998.',
  accepted: true,
  quoteFound: true,
  typeOk: true,
  rangeOk: true,
  rejection: null,
  needsConfirmation: false,
};

const serviceResponse: ReplyResponseDto = {
  id: 'r1',
  action: replyAction,
  extracted: [accepted],
  accepted: [accepted],
  rejected: [],
  needsConfirmation: [],
  newContradictions: [],
  before,
  after,
  rankBefore: 17,
  rankAfter: 4,
  result: storedResult,
};

let handle: DbHandle;
let deps: Deps;

beforeEach(() => {
  svc.applyBrokerReply.mockReset();
  handle = createDb({ url: ':memory:' });
  migrate(handle);
  deps = { db: handle.db, adapter, llm: createFakeLlm(), clock: fixedClock(NOW) };
  const repos = createRepos(deps.db);
  const sub = (id: string, externalId: string, result: EngineResult | null) =>
    repos.submissions.upsertByExternalId({
      id,
      source: 'federato',
      lineOfBusiness: 'commercial_property',
      externalId,
      insuredName: 'Acme Holdings',
      raw: null,
      canonical: null,
      result,
      shareSlug: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
  sub('s1', 'SUB-001', storedResult);
  sub('s2', 'SUB-002', storedResult);
  sub('unscored', 'SUB-003', null);
  repos.actions.insert({ id: 'req-1', submissionId: 's1', type: 'request', status: 'sent', actor: 'code', payload: {}, createdAt: NOW });
  repos.actions.insert({ id: 'req-2', submissionId: 's2', type: 'request', status: 'sent', actor: 'code', payload: {}, createdAt: NOW });
});

afterEach(() => handle.close());

const makeApp = () => createApp({ deps, registrars: [registerReplyRoutes] });

const postJson = (path: string, body: unknown, raw?: string) =>
  makeApp().request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  });

const errorOf = async (res: Response) => errorSchema.parse(await res.json()).error;

describe('POST /submissions/:id/reply — JSON', () => {
  it('hands the parsed reply to the service and returns its before/after unchanged', async () => {
    svc.applyBrokerReply.mockResolvedValue(serviceResponse);
    const res = await postJson('/submissions/s1/reply', { text: 'Building C was built in 1998.', actionId: 'req-1' });
    expect(res.status).toBe(200);
    const body = replyResponseSchema.parse(await res.json());
    expect(body.before.appetiteScore).toBe(61.5);
    expect(body.after.appetiteScore).toBe(78);
    expect(body.after.verdict).toBe('FIT');
    expect([body.rankBefore, body.rankAfter]).toEqual([17, 4]);
    expect(body.accepted).toEqual([accepted]);
    expect(svc.applyBrokerReply).toHaveBeenCalledWith(deps, 's1', {
      text: 'Building C was built in 1998.',
      actionId: 'req-1',
    });
  });

  it('accepts a base64 PDF with its filename', async () => {
    svc.applyBrokerReply.mockResolvedValue(serviceResponse);
    const pdfBase64 = Buffer.from('%PDF-1.4 loss runs').toString('base64');
    const res = await postJson('/submissions/s1/reply', { pdfBase64, filename: 'loss-runs.pdf' });
    expect(res.status).toBe(200);
    expect(svc.applyBrokerReply).toHaveBeenCalledWith(deps, 's1', { pdfBase64, filename: 'loss-runs.pdf' });
  });

  it('422s both or neither of text and pdfBase64, and 400s malformed JSON', async () => {
    const both = await postJson('/submissions/s1/reply', { text: 'x', pdfBase64: 'eA==' });
    expect(both.status).toBe(422);
    expect((await errorOf(both)).code).toBe('VALIDATION');

    const neither = await postJson('/submissions/s1/reply', {});
    expect(neither.status).toBe(422);
    expect((await errorOf(neither)).issues?.[0]?.message).toMatch(/exactly one/);

    const broken = await postJson('/submissions/s1/reply', undefined, '{"text":');
    expect(broken.status).toBe(400);
    expect((await errorOf(broken)).code).toBe('INVALID_BODY');
    expect(svc.applyBrokerReply).not.toHaveBeenCalled();
  });

  it('404s an unknown submission or action, 422s an action from another submission', async () => {
    const noSub = await postJson('/submissions/missing/reply', { text: 'x' });
    expect(noSub.status).toBe(404);
    expect((await errorOf(noSub)).code).toBe('NOT_FOUND');

    const noAction = await postJson('/submissions/s1/reply', { text: 'x', actionId: 'ghost' });
    expect(noAction.status).toBe(404);
    expect((await errorOf(noAction)).code).toBe('ACTION_NOT_FOUND');

    const wrong = await postJson('/submissions/s1/reply', { text: 'x', actionId: 'req-2' });
    expect(wrong.status).toBe(422);
    expect((await errorOf(wrong)).code).toBe('ACTION_MISMATCH');
    expect(svc.applyBrokerReply).not.toHaveBeenCalled();
  });

  it('409s a submission that has never been scored', async () => {
    const res = await postJson('/submissions/unscored/reply', { text: 'x' });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe('NOT_SCORED');
    expect(svc.applyBrokerReply).not.toHaveBeenCalled();
  });

  it('413s a PDF larger than 20 MB decoded', async () => {
    const pdfBase64 = 'A'.repeat(Math.ceil((20 * 1024 * 1024) / 3) * 4 + 4);
    const res = await postJson('/submissions/s1/reply', { pdfBase64 });
    expect(res.status).toBe(413);
    expect(svc.applyBrokerReply).not.toHaveBeenCalled();
  });

  it('maps Gemini failures to 503 / 502, and a stub service to 501', async () => {
    svc.applyBrokerReply.mockRejectedValueOnce(new LlmUnavailableError('extract-reply'));
    const off = await postJson('/submissions/s1/reply', { text: 'x' });
    expect(off.status).toBe(503);
    expect((await errorOf(off)).code).toBe('LLM_UNAVAILABLE');

    svc.applyBrokerReply.mockRejectedValueOnce(new LlmError('schema mismatch', { callName: 'extract-reply' }));
    const failed = await postJson('/submissions/s1/reply', { text: 'x' });
    expect(failed.status).toBe(502);
    expect((await errorOf(failed)).code).toBe('LLM_FAILED');

    svc.applyBrokerReply.mockRejectedValueOnce(new Error('NOT_IMPLEMENTED:A17'));
    const stub = await postJson('/submissions/s1/reply', { text: 'x' });
    expect(stub.status).toBe(501);
  });
});

describe('POST /submissions/:id/reply — multipart upload', () => {
  it('turns an uploaded PDF into pdfBase64 and keeps its file name', async () => {
    svc.applyBrokerReply.mockResolvedValue(serviceResponse);
    const bytes = new TextEncoder().encode('%PDF-1.7 loss run 2023: 2 claims, $41,000');
    const form = new FormData();
    form.set('file', new File([bytes], 'loss-runs-2023.pdf', { type: 'application/pdf' }));
    form.set('actionId', 'req-1');
    const res = await makeApp().request('/submissions/s1/reply', { method: 'POST', body: form });
    expect(res.status).toBe(200);
    expect(svc.applyBrokerReply).toHaveBeenCalledWith(deps, 's1', {
      pdfBase64: Buffer.from(bytes).toString('base64'),
      filename: 'loss-runs-2023.pdf',
      actionId: 'req-1',
    });
  });

  it('reads a text upload or a text field as text', async () => {
    svc.applyBrokerReply.mockResolvedValue(serviceResponse);
    const upload = new FormData();
    upload.set('file', new File(['Roof replaced in 2019.'], 'reply.txt', { type: 'text/plain' }));
    expect((await makeApp().request('/submissions/s1/reply', { method: 'POST', body: upload })).status).toBe(200);
    expect(svc.applyBrokerReply).toHaveBeenLastCalledWith(deps, 's1', { text: 'Roof replaced in 2019.' });

    const field = new FormData();
    field.set('text', 'Sprinklered throughout.');
    expect((await makeApp().request('/submissions/s1/reply', { method: 'POST', body: field })).status).toBe(200);
    expect(svc.applyBrokerReply).toHaveBeenLastCalledWith(deps, 's1', { text: 'Sprinklered throughout.' });
  });

  it('422s a form with a text field and a PDF at once', async () => {
    const form = new FormData();
    form.set('text', 'see attached');
    form.set('file', new File(['%PDF'], 'a.pdf', { type: 'application/pdf' }));
    const res = await makeApp().request('/submissions/s1/reply', { method: 'POST', body: form });
    expect(res.status).toBe(422);
    expect(svc.applyBrokerReply).not.toHaveBeenCalled();
  });
});
