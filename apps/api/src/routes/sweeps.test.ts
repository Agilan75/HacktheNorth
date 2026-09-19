import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  NextQuestionResponseDto,
  SweepCreateRequestDto,
  SweepDto,
  VerifyFixResponseDto,
} from '@retrofit/contracts';
import {
  errorSchema,
  nextQuestionResponseSchema,
  routePath,
  sweepSchema,
} from '@retrofit/contracts';
import type { FederatoAdapter } from '@retrofit/federato';
import { createApp } from '../app';
import { createDb } from '../db/client';
import type { DbHandle } from '../db/client';
import { migrate } from '../db/migrate';
import { createFakeLlm } from '../llm/fake-provider';
import { fixedClock } from '../services/types';
import type { Deps } from '../services/types';
import { registerSweepRoutes } from './sweeps';

/**
 * The services (A18) are built in parallel with this unit, so they are mocked:
 * what is under test is the route — parsing, status codes, 404s, and the
 * background stage driver — not the pipeline.
 */
const svc = vi.hoisted(() => ({
  createSweep: vi.fn(),
  advanceSweep: vi.fn(),
  getSweep: vi.fn(),
  nextQuestion: vi.fn(),
  submitAnswers: vi.fn(),
  verifyFix: vi.fn(),
}));
vi.mock('../services/sweep', () => ({
  createSweep: svc.createSweep,
  advanceSweep: svc.advanceSweep,
  getSweep: svc.getSweep,
}));
vi.mock('../services/questions', () => ({
  nextQuestion: svc.nextQuestion,
  submitAnswers: svc.submitAnswers,
}));
vi.mock('../services/verify-fix', () => ({ verifyFix: svc.verifyFix }));

const NOW = '2026-09-19T12:00:00.000Z';

const adapter: FederatoAdapter = {
  kind: 'mock',
  getSchema: () => Promise.reject(new Error('unused')),
  query: () => Promise.reject(new Error('unused')),
  getGuidelines: () => Promise.reject(new Error('unused')),
  getGlossary: () => Promise.reject(new Error('unused')),
};

function sweep(id: string, stage: SweepDto['stage'], extra: Partial<SweepDto> = {}): SweepDto {
  return {
    id,
    submissionId: null,
    roomLabel: 'Bedroom',
    termMonths: 12,
    stage,
    frames: [],
    coverage: null,
    observations: [],
    needsConfirmation: [],
    result: null,
    askedQuestionIds: [],
    skippedCount: 0,
    error: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  };
}

const validCreate: SweepCreateRequestDto = {
  roomLabel: 'Bedroom',
  termMonths: 12,
  frames: [
    { bearingDeg: 0, capturedAt: NOW, imageBase64: 'AAAA' },
    { bearingDeg: 120, pitchDeg: 5, capturedAt: NOW, imageBase64: 'BBBB' },
  ],
};

let handle: DbHandle;
let deps: Deps;

beforeEach(() => {
  for (const fn of Object.values(svc)) fn.mockReset();
  handle = createDb({ url: ':memory:' });
  migrate(handle);
  deps = { db: handle.db, adapter, llm: createFakeLlm(), clock: fixedClock(NOW) };
});

afterEach(() => handle.close());

const makeApp = () => createApp({ deps, registrars: [registerSweepRoutes] });

const post = (app: ReturnType<typeof makeApp>, path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

/** Lets the fire-and-forget driver run its queued microtasks. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('POST /sweeps', () => {
  it('returns 201 with the created sweep and drives it to the questions stage in the background', async () => {
    const stages: SweepDto['stage'][] = ['quality_gate', 'observing', 'relating', 'scoring', 'questions'];
    svc.createSweep.mockResolvedValue(sweep('sw-1', 'received'));
    let i = 0;
    svc.advanceSweep.mockImplementation(() => Promise.resolve(sweep('sw-1', stages[i++] ?? 'questions')));

    const res = await post(makeApp(), routePath('createSweep'), validCreate);
    expect(res.status).toBe(201);
    const body = sweepSchema.parse(await res.json());
    expect(body.id).toBe('sw-1');
    expect(body.stage).toBe('received');
    expect(svc.createSweep).toHaveBeenCalledWith(deps, validCreate);

    await vi.waitFor(() => expect(svc.advanceSweep).toHaveBeenCalledTimes(5));
    await settle();
    expect(svc.advanceSweep).toHaveBeenCalledTimes(5);
    for (const call of svc.advanceSweep.mock.calls) expect(call).toEqual([deps, 'sw-1']);
  });

  it('does not advance a sweep the service already finished', async () => {
    svc.createSweep.mockResolvedValue(sweep('sw-2', 'failed', { error: 'too few frames' }));
    const res = await post(makeApp(), '/sweeps', validCreate);
    expect(res.status).toBe(201);
    await settle();
    expect(svc.advanceSweep).not.toHaveBeenCalled();
  });

  it('stops driving when a stage does not move, and survives a throwing advance', async () => {
    svc.createSweep.mockResolvedValue(sweep('sw-3', 'received'));
    svc.advanceSweep.mockResolvedValueOnce(sweep('sw-3', 'quality_gate'));
    svc.advanceSweep.mockResolvedValueOnce(sweep('sw-3', 'quality_gate'));
    const app = makeApp();
    expect((await post(app, '/sweeps', validCreate)).status).toBe(201);
    await vi.waitFor(() => expect(svc.advanceSweep).toHaveBeenCalledTimes(2));
    await settle();
    expect(svc.advanceSweep).toHaveBeenCalledTimes(2);

    svc.createSweep.mockResolvedValue(sweep('sw-4', 'received'));
    svc.advanceSweep.mockRejectedValueOnce(new Error('gemini down'));
    expect((await post(app, '/sweeps', validCreate)).status).toBe(201);
    await settle();
    expect(svc.advanceSweep).toHaveBeenCalledTimes(3);
  });

  it('rejects malformed JSON with 400 and a bad body with 422 and the zod issues', async () => {
    const app = makeApp();
    const bad = await post(app, '/sweeps', '{not json');
    expect(bad.status).toBe(400);
    expect(errorSchema.parse(await bad.json()).error.code).toBe('BAD_REQUEST');

    const tooMany = { ...validCreate, frames: Array.from({ length: 16 }, () => validCreate.frames[0]) };
    const r1 = await post(app, '/sweeps', tooMany);
    expect(r1.status).toBe(422);
    const e1 = errorSchema.parse(await r1.json());
    expect(e1.error.code).toBe('VALIDATION');
    expect(e1.error.issues?.map((x) => x.path)).toContain('frames');

    const r2 = await post(app, '/sweeps', { ...validCreate, termMonths: 6 });
    expect(r2.status).toBe(422);
    expect(errorSchema.parse(await r2.json()).error.issues?.[0]?.path).toBe('termMonths');

    const r3 = await post(app, '/sweeps', { ...validCreate, frames: [] });
    expect(r3.status).toBe(422);
    expect(svc.createSweep).not.toHaveBeenCalled();
  });
});

describe('GET /sweeps/:id', () => {
  it('returns the sweep and never runs two drivers for one sweep', async () => {
    svc.getSweep.mockResolvedValue(sweep('sw-5', 'observing'));
    let release: (() => void) | undefined;
    svc.advanceSweep.mockImplementation(
      () =>
        new Promise<SweepDto>((resolve) => {
          release = () => resolve(sweep('sw-5', 'questions'));
        }),
    );
    const app = makeApp();
    const a = await app.request(routePath('getSweep', { id: 'sw-5' }));
    const b = await app.request('/sweeps/sw-5');
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(sweepSchema.parse(await a.json()).stage).toBe('observing');
    await settle();
    expect(svc.advanceSweep).toHaveBeenCalledTimes(1);
    release?.();
    await settle();
    expect(svc.advanceSweep).toHaveBeenCalledTimes(1);
  });

  it('404s an unknown sweep', async () => {
    svc.getSweep.mockResolvedValue(null);
    const res = await makeApp().request('/sweeps/nope');
    expect(res.status).toBe(404);
    expect(errorSchema.parse(await res.json()).error.code).toBe('NOT_FOUND');
  });

  it('answers 501 while the service is still a stub', async () => {
    svc.getSweep.mockRejectedValue(new Error('NOT_IMPLEMENTED:A18'));
    const res = await makeApp().request('/sweeps/sw-x');
    expect(res.status).toBe(501);
  });
});

describe('VOI loop', () => {
  it('GET next-question returns the question, asked count and skipped reasons', async () => {
    svc.getSweep.mockResolvedValue(sweep('sw-6', 'questions'));
    const dto: NextQuestionResponseDto = {
      question: null,
      askedCount: 3,
      skipped: [{ field: 'smokeDetector', reason: 'seen in frame 4' }],
      done: true,
    };
    svc.nextQuestion.mockResolvedValue(dto);
    const res = await makeApp().request(routePath('nextQuestion', { id: 'sw-6' }));
    expect(res.status).toBe(200);
    expect(nextQuestionResponseSchema.parse(await res.json())).toEqual(dto);
    expect(svc.nextQuestion).toHaveBeenCalledWith(deps, 'sw-6');
  });

  it('POST answers passes the parsed body through and returns the updated sweep', async () => {
    svc.getSweep.mockResolvedValue(sweep('sw-7', 'questions'));
    svc.submitAnswers.mockResolvedValue(sweep('sw-7', 'done', { askedQuestionIds: ['q1'], skippedCount: 1 }));
    const request = {
      answers: [
        { questionId: 'q1', field: 'hasSmokeDetector', value: true },
        { questionId: 'q2', field: 'floor', value: null, skipped: true },
      ],
      confirmations: [{ observationId: 'o1', confirmed: false }],
    };
    const res = await post(makeApp(), routePath('answerSweep', { id: 'sw-7' }), request);
    expect(res.status).toBe(200);
    const body = sweepSchema.parse(await res.json());
    expect(body.stage).toBe('done');
    expect(body.skippedCount).toBe(1);
    expect(svc.submitAnswers).toHaveBeenCalledWith(deps, 'sw-7', request);
  });

  it('POST answers validates before touching the service, and 404s an unknown sweep', async () => {
    const app = makeApp();
    const bad = await post(app, '/sweeps/sw-7/answers', { answers: [{ questionId: 'q1', value: 1 }] });
    expect(bad.status).toBe(422);
    expect(errorSchema.parse(await bad.json()).error.issues?.[0]?.path).toBe('answers.0.field');

    svc.getSweep.mockResolvedValue(null);
    const missing = await post(app, '/sweeps/nope/answers', { answers: [] });
    expect(missing.status).toBe(404);
    const missingQ = await app.request('/sweeps/nope/next-question');
    expect(missingQ.status).toBe(404);
    expect(svc.submitAnswers).not.toHaveBeenCalled();
    expect(svc.nextQuestion).not.toHaveBeenCalled();
  });
});

describe('POST /sweeps/:id/verify-fix', () => {
  it('returns the before and after snapshot from the service', async () => {
    svc.getSweep.mockResolvedValue(sweep('sw-8', 'done'));
    const dto = {
      sweepId: 'sw-8',
      hazardKey: 'heaterNearCombustible',
      stillPresent: false,
      confidence: 0.91,
      reason: 'heater moved away from the curtain',
      before: { verdict: 'REFER', appetiteScore: 61, premium: 312 },
      after: { verdict: 'FIT', appetiteScore: 74, premium: 268 },
      result: { id: 'sw-8', verdict: { verdict: 'FIT' }, price: { predictedPremium: 268 } },
    } as unknown as VerifyFixResponseDto;
    svc.verifyFix.mockResolvedValue(dto);
    const request = { hazardKey: 'heaterNearCombustible', imageBase64: 'CCCC', capturedAt: NOW };
    const res = await post(makeApp(), routePath('verifyFix', { id: 'sw-8' }), request);
    expect(res.status).toBe(200);
    const json: unknown = await res.json();
    expect(json).toEqual(dto);
    expect(svc.verifyFix).toHaveBeenCalledWith(deps, 'sw-8', request);
  });

  it('422s a missing image and 404s an unknown sweep', async () => {
    const app = makeApp();
    const bad = await post(app, '/sweeps/sw-8/verify-fix', { hazardKey: 'x', capturedAt: NOW });
    expect(bad.status).toBe(422);
    svc.getSweep.mockResolvedValue(null);
    const missing = await post(app, '/sweeps/nope/verify-fix', { hazardKey: 'x', imageBase64: 'A', capturedAt: NOW });
    expect(missing.status).toBe(404);
    expect(svc.verifyFix).not.toHaveBeenCalled();
  });
});
