import { describe, expect, it, vi } from 'vitest';
import { routePath } from '@retrofit/contracts';
import type { SweepCreateRequestDto, SweepDto, SweepStageDto } from '@retrofit/contracts';
import {
  API_PATHS,
  ApiError,
  backoffDelay,
  createApiClient,
  describeApiError,
  isOfflineError,
  isRestingStage,
  isRetryable,
  normalizeBaseUrl,
  pollSweep,
  type ApiClient,
} from './api';

const BASE = 'http://localhost:3000';

function sweep(stage: SweepStageDto = 'received', id = 'sw_1'): SweepDto {
  return {
    id,
    submissionId: null,
    roomLabel: 'Kitchen',
    termMonths: 12,
    stage,
    frames: [],
    coverage: null,
    observations: [],
    needsConfirmation: [],
    result: null,
    hazardCosts: [],
    pendingQuestion: null,
    askedQuestionIds: [],
    skippedCount: 0,
    error: null,
    createdAt: '2026-09-19T00:00:00.000Z',
    updatedAt: '2026-09-19T00:00:00.000Z',
  };
}

const createBody: SweepCreateRequestDto = {
  roomLabel: 'Kitchen',
  termMonths: 12,
  frames: [{ bearingDeg: 0, capturedAt: '2026-09-19T00:00:00.000Z', imageBase64: 'AAAA' }],
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Step = Response | Error | (() => Promise<Response>);

/** A scripted fetch: each call consumes the next step. */
function scriptedFetch(steps: Step[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    const step = steps.shift();
    if (step === undefined) throw new Error('fetch called more times than scripted');
    if (step instanceof Error) throw step;
    if (typeof step === 'function') return step();
    return step;
  });
  return { fn, calls };
}

function client(steps: Step[], extra: Partial<Parameters<typeof createApiClient>[0]> = {}) {
  const f = scriptedFetch(steps);
  const sleeps: number[] = [];
  const api = createApiClient({
    baseUrl: BASE,
    fetch: f.fn,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0,
    ...extra,
  });
  return { api, calls: f.calls, fetch: f.fn, sleeps };
}

describe('API_PATHS', () => {
  it('matches the frozen route table in @retrofit/contracts', () => {
    expect(API_PATHS.createSweep()).toBe(routePath('createSweep'));
    expect(API_PATHS.getSweep('a b')).toBe(routePath('getSweep', { id: 'a b' }));
    expect(API_PATHS.answerSweep('x')).toBe(routePath('answerSweep', { id: 'x' }));
    expect(API_PATHS.nextQuestion('x')).toBe(routePath('nextQuestion', { id: 'x' }));
    expect(API_PATHS.verifyFix('x')).toBe(routePath('verifyFix', { id: 'x' }));
    expect(API_PATHS.share('s/1')).toBe(routePath('share', { shareSlug: 's/1' }));
  });
});

describe('normalizeBaseUrl', () => {
  it('trims whitespace and trailing slashes; empty is null', () => {
    expect(normalizeBaseUrl(' http://10.0.0.2:3000/ ')).toBe('http://10.0.0.2:3000');
    expect(normalizeBaseUrl('http://h//')).toBe('http://h');
    expect(normalizeBaseUrl('')).toBeNull();
    expect(normalizeBaseUrl('   ')).toBeNull();
    expect(normalizeBaseUrl(undefined)).toBeNull();
  });
});

describe('backoffDelay', () => {
  const policy = { baseDelayMs: 500, maxDelayMs: 8_000, factor: 2, jitter: 0.5 };
  it('doubles per retry, with jitter in [cap*(1-j), cap]', () => {
    expect(backoffDelay(1, policy, () => 0)).toBe(250);
    expect(backoffDelay(1, policy, () => 1)).toBe(500);
    expect(backoffDelay(2, policy, () => 0)).toBe(500);
    expect(backoffDelay(3, policy, () => 0)).toBe(1_000);
  });
  it('is capped at maxDelayMs', () => {
    expect(backoffDelay(20, policy, () => 1)).toBe(8_000);
    expect(backoffDelay(20, { ...policy, jitter: 0 }, () => 0.9)).toBe(8_000);
  });
  it('clamps silly inputs', () => {
    expect(backoffDelay(0, policy, () => 0)).toBe(250);
    expect(backoffDelay(1, { ...policy, jitter: 5 }, () => 2)).toBe(500);
  });
});

describe('error classification', () => {
  it('retries network, timeout, 408, 429 and 5xx only', () => {
    expect(isRetryable(new ApiError({ kind: 'network', message: '' }))).toBe(true);
    expect(isRetryable(new ApiError({ kind: 'timeout', message: '' }))).toBe(true);
    for (const status of [408, 429, 500, 502, 503]) {
      expect(isRetryable(new ApiError({ kind: 'http', status, message: '' }))).toBe(true);
    }
    for (const status of [400, 404, 422]) {
      expect(isRetryable(new ApiError({ kind: 'http', status, message: '' }))).toBe(false);
    }
    expect(isRetryable(new ApiError({ kind: 'aborted', message: '' }))).toBe(false);
    expect(isRetryable(new ApiError({ kind: 'config', message: '' }))).toBe(false);
    expect(isRetryable(new Error('x'))).toBe(false);
  });
  it('treats only network and timeout as offline', () => {
    expect(isOfflineError(new ApiError({ kind: 'network', message: '' }))).toBe(true);
    expect(isOfflineError(new ApiError({ kind: 'timeout', message: '' }))).toBe(true);
    expect(isOfflineError(new ApiError({ kind: 'http', status: 503, message: '' }))).toBe(false);
  });
  it('describes errors in plain language without status codes', () => {
    for (const kind of ['network', 'timeout', 'http', 'parse', 'config', 'aborted'] as const) {
      const text = describeApiError(new ApiError({ kind, status: kind === 'http' ? 503 : null, message: 'raw 503' }));
      expect(text).not.toMatch(/\d{3}/);
      expect(text.length).toBeGreaterThan(0);
    }
    expect(describeApiError('nope')).toMatch(/try again/i);
  });
});

describe('createApiClient', () => {
  it('GETs a sweep from the base URL and parses JSON', async () => {
    const { api, calls } = client([json(200, sweep('observing'))]);
    const out = await api.getSweep('sw_1');
    expect(out.stage).toBe('observing');
    expect(calls[0]?.url).toBe(`${BASE}/sweeps/sw_1`);
    expect(calls[0]?.init?.method).toBe('GET');
    expect(calls[0]?.init?.body).toBeUndefined();
  });

  it('POSTs JSON bodies with a content type', async () => {
    const { api, calls } = client([json(201, sweep())]);
    await api.createSweep(createBody);
    const init = calls[0]?.init;
    expect(calls[0]?.url).toBe(`${BASE}/sweeps`);
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(String(init?.body))).toEqual(createBody);
  });

  it('hits every sweep endpoint at the right path', async () => {
    const { api, calls } = client([
      json(200, { question: null, askedCount: 0, skipped: [], done: true }),
      json(200, sweep('questions')),
      json(200, { sweepId: 'sw_1', hazardKey: 'h', stillPresent: false }),
      json(200, { slug: 'abc' }),
    ]);
    await api.nextQuestion('sw_1');
    await api.submitAnswers('sw_1', { answers: [] });
    await api.verifyFix('sw_1', { hazardKey: 'h', imageBase64: 'AA', capturedAt: '2026-09-19T00:00:00.000Z' });
    await api.getShare('abc');
    expect(calls.map((c) => `${c.init?.method} ${c.url.slice(BASE.length)}`)).toEqual([
      'GET /sweeps/sw_1/next-question',
      'POST /sweeps/sw_1/answers',
      'POST /sweeps/sw_1/verify-fix',
      'GET /s/abc',
    ]);
  });

  it('retries a network failure with backoff, then succeeds', async () => {
    const onRetry = vi.fn();
    const { api, sleeps, fetch } = client(
      [new TypeError('Network request failed'), new TypeError('Network request failed'), json(200, sweep())],
      { onRetry },
    );
    await expect(api.getSweep('sw_1')).resolves.toMatchObject({ id: 'sw_1' });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([250, 500]);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('retries 5xx and surfaces the ErrorDto when it gives up', async () => {
    const err = { error: { code: 'INTERNAL', message: 'boom' } };
    const { api, fetch, sleeps } = client([json(503, err), json(500, err), json(502, err), json(500, err)]);
    const failure = await api.getSweep('sw_1').catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ kind: 'http', status: 500, code: 'INTERNAL', message: 'boom', attempts: 4 });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(sleeps).toEqual([250, 500, 1_000]);
  });

  it('does not retry a 422 and keeps the zod issues', async () => {
    const body = {
      error: { code: 'VALIDATION', message: 'bad', issues: [{ path: 'frames', message: 'too many' }] },
    };
    const { api, fetch } = client([json(422, body)]);
    const failure = await api.createSweep(createBody).catch((e: unknown) => e);
    expect(failure).toMatchObject({ kind: 'http', status: 422, code: 'VALIDATION', attempts: 1 });
    expect((failure as ApiError).issues).toEqual([{ path: 'frames', message: 'too many' }]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry a 404, and handles a non-JSON error body', async () => {
    const { api, fetch } = client([new Response('Not Found', { status: 404 })]);
    await expect(api.getSweep('nope')).rejects.toMatchObject({ kind: 'http', status: 404, code: null });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('honours a per-call retry override', async () => {
    const { api, fetch } = client([new TypeError('offline')]);
    await expect(api.createSweep(createBody, { retry: { maxAttempts: 1 } })).rejects.toMatchObject({
      kind: 'network',
      attempts: 1,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('fails a 2xx that is not JSON with kind parse, without retrying', async () => {
    const { api, fetch } = client([new Response('<html>', { status: 200 })]);
    await expect(api.getSweep('sw_1')).rejects.toMatchObject({ kind: 'parse' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('times out a hung request and retries it', async () => {
    let n = 0;
    const api = createApiClient({
      baseUrl: BASE,
      timeoutMs: 5,
      sleep: async () => undefined,
      random: () => 0,
      retry: { maxAttempts: 2 },
      fetch: (_url, init) => {
        n += 1;
        if (n === 1) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          });
        }
        return Promise.resolve(json(200, sweep()));
      },
    });
    await expect(api.getSweep('sw_1')).resolves.toMatchObject({ id: 'sw_1' });
    expect(n).toBe(2);
  });

  it('reports a timeout when every attempt hangs', async () => {
    const api = createApiClient({
      baseUrl: BASE,
      timeoutMs: 5,
      sleep: async () => undefined,
      retry: { maxAttempts: 2 },
      fetch: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    });
    await expect(api.getSweep('sw_1')).rejects.toMatchObject({ kind: 'timeout', attempts: 2 });
  });

  it('never retries when the caller aborts', async () => {
    const controller = new AbortController();
    const { api, fetch } = client([
      () => {
        controller.abort();
        return Promise.reject(new DOMException('aborted', 'AbortError'));
      },
    ]);
    await expect(api.getSweep('sw_1', { signal: controller.signal })).rejects.toMatchObject({ kind: 'aborted' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('fails fast with kind config when there is no base URL', async () => {
    const f = scriptedFetch([]);
    const api = createApiClient({ baseUrl: '', fetch: f.fn });
    expect(api.baseUrl).toBeNull();
    await expect(api.getSweep('sw_1')).rejects.toMatchObject({ kind: 'config', attempts: 1 });
    expect(f.fn).not.toHaveBeenCalled();
  });
});

describe('pollSweep', () => {
  function fakeClient(stages: SweepStageDto[]): ApiClient & { calls: number } {
    const state = { calls: 0 };
    const c = {
      baseUrl: BASE,
      get calls() {
        return state.calls;
      },
      getSweep: async () => {
        const stage = stages[Math.min(state.calls, stages.length - 1)] ?? 'received';
        state.calls += 1;
        return sweep(stage);
      },
    } as unknown as ApiClient & { calls: number };
    return c;
  }

  it('polls until a resting stage and reports every update', async () => {
    const c = fakeClient(['received', 'quality_gate', 'observing', 'scoring', 'questions']);
    const seen: SweepStageDto[] = [];
    const out = await pollSweep(c, 'sw_1', {
      sleep: async () => undefined,
      onUpdate: (s) => seen.push(s.stage),
    });
    expect(out.stage).toBe('questions');
    expect(seen).toEqual(['received', 'quality_gate', 'observing', 'scoring', 'questions']);
  });

  it('stops on failed', async () => {
    const out = await pollSweep(fakeClient(['observing', 'failed']), 'sw_1', { sleep: async () => undefined });
    expect(out.stage).toBe('failed');
  });

  it('gives up after timeoutMs with kind timeout', async () => {
    let t = 0;
    await expect(
      pollSweep(fakeClient(['observing']), 'sw_1', {
        intervalMs: 1_000,
        timeoutMs: 3_000,
        now: () => t,
        sleep: async (ms) => {
          t += ms;
        },
      }),
    ).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('knows the resting stages', () => {
    expect(isRestingStage('questions')).toBe(true);
    expect(isRestingStage('done')).toBe(true);
    expect(isRestingStage('failed')).toBe(true);
    expect(isRestingStage('scoring')).toBe(false);
  });
});
