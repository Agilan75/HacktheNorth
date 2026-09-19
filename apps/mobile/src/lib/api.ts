/**
 * The phone app's API client (unit M1, PRD §11 "Networking").
 *
 * Typed calls for every sweep endpoint plus the public share route. The API
 * computes every number; this module only moves JSON. Retries with
 * exponential backoff on network failure, timeouts, 429 and 5xx.
 *
 * Pure and injectable (fetch, sleep, random) so it is unit-tested in node. It
 * must never import react-native. `@retrofit/contracts` is imported type-only
 * (DECISIONS R3-4), so route paths are mirrored here and a test pins them to
 * the contracts route table.
 */
import type {
  ErrorDto,
  NextQuestionResponseDto,
  ShareDto,
  SweepAnswersRequestDto,
  SweepCreateRequestDto,
  SweepDto,
  SweepStageDto,
  VerifyFixRequestDto,
  VerifyFixResponseDto,
} from '@retrofit/contracts';

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * - `network`: no response at all (offline, DNS, refused). Retryable; the
 *   offline queue treats it as "no connection".
 * - `timeout`: the request was aborted by our own deadline. Retryable, offline-ish.
 * - `http`: the server answered with a non-2xx status.
 * - `parse`: a 2xx whose body was not JSON.
 * - `config`: EXPO_PUBLIC_API_URL is missing.
 * - `aborted`: the caller cancelled. Never retried.
 */
export type ApiErrorKind = 'network' | 'timeout' | 'http' | 'parse' | 'config' | 'aborted';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  /** HTTP status for `http`, else null. */
  readonly status: number | null;
  /** The server's `ErrorDto.error.code` when it sent one. */
  readonly code: string | null;
  readonly issues: ErrorDto['error']['issues'] | null;
  /** How many attempts were made before giving up. */
  readonly attempts: number;

  constructor(init: {
    kind: ApiErrorKind;
    message: string;
    status?: number | null;
    code?: string | null;
    issues?: ErrorDto['error']['issues'] | null;
    attempts?: number;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.kind = init.kind;
    this.status = init.status ?? null;
    this.code = init.code ?? null;
    this.issues = init.issues ?? null;
    this.attempts = init.attempts ?? 1;
  }

  withAttempts(attempts: number): ApiError {
    return new ApiError({
      kind: this.kind,
      message: this.message,
      status: this.status,
      code: this.code,
      issues: this.issues,
      attempts,
    });
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** Worth trying again: no connection, our timeout, 408, 429, or any 5xx. */
export function isRetryable(error: unknown): boolean {
  if (!isApiError(error)) return false;
  if (error.kind === 'network' || error.kind === 'timeout') return true;
  if (error.kind === 'http' && error.status !== null) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  return false;
}

/** The failure looks like "no connection" rather than "the server said no". */
export function isOfflineError(error: unknown): boolean {
  return isApiError(error) && (error.kind === 'network' || error.kind === 'timeout');
}

/**
 * One plain-language sentence for the UI. Never shows a status code or a stack
 * trace to the tenant.
 */
export function describeApiError(error: unknown): string {
  if (!isApiError(error)) return 'Something went wrong. Please try again.';
  switch (error.kind) {
    case 'network':
      return "You seem to be offline. We'll try again when you're back online.";
    case 'timeout':
      return 'The connection is slow and the request timed out. We will try again.';
    case 'config':
      return 'The app is not connected to a server. Ask the person who set it up to add the server address.';
    case 'aborted':
      return 'Cancelled.';
    case 'parse':
      return 'The server sent a reply we could not read. Please try again.';
    case 'http':
      if (error.status === 404) return 'We could not find that. It may have expired.';
      if (error.status === 400 || error.status === 422) {
        return 'Some of the information sent was not accepted. Please check it and try again.';
      }
      if (error.status === 429) return 'The server is busy. Please wait a moment and try again.';
      return 'The server had a problem. Please try again in a moment.';
  }
}

/* -------------------------------------------------------------------------- */
/* Backoff                                                                    */
/* -------------------------------------------------------------------------- */

export interface RetryPolicy {
  /** Total attempts including the first. 1 = no retry. */
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly factor: number;
  /** 0..1: the share of each delay that is randomised ("equal jitter"). */
  readonly jitter: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 4,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  factor: 2,
  jitter: 0.5,
};

/**
 * Delay before retry number `retry` (1 = the first retry). Exponential, capped,
 * with jitter: `cap * (1 - jitter) + cap * jitter * random()`.
 * With random() in [0,1) the result is in [cap*(1-jitter), cap).
 */
export function backoffDelay(
  retry: number,
  policy: Pick<RetryPolicy, 'baseDelayMs' | 'maxDelayMs' | 'factor' | 'jitter'>,
  random: () => number = Math.random,
): number {
  const n = Math.max(1, Math.floor(retry));
  const raw = policy.baseDelayMs * Math.pow(policy.factor, n - 1);
  const cap = Math.min(policy.maxDelayMs, raw);
  const jitter = Math.min(1, Math.max(0, policy.jitter));
  const r = Math.min(1, Math.max(0, random()));
  return Math.round(cap * (1 - jitter) + cap * jitter * r);
}

/* -------------------------------------------------------------------------- */
/* Client                                                                     */
/* -------------------------------------------------------------------------- */

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  /** e.g. `http://192.168.1.20:3000`. Null/empty -> every call fails with kind `config`. */
  readonly baseUrl: string | null | undefined;
  readonly fetch?: FetchLike;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
  readonly retry?: Partial<RetryPolicy>;
  /** Per-attempt deadline for ordinary calls. */
  readonly timeoutMs?: number;
  /** Per-attempt deadline for calls that upload images (POST /sweeps, verify-fix). */
  readonly uploadTimeoutMs?: number;
  /** Called before each retry; handy for a "retrying…" hint. */
  readonly onRetry?: (info: { path: string; retry: number; delayMs: number; error: ApiError }) => void;
}

export interface CallOptions {
  readonly signal?: AbortSignal;
  /** Override the client's retry policy for this call (e.g. `{ maxAttempts: 1 }`). */
  readonly retry?: Partial<RetryPolicy>;
}

export interface ApiClient {
  readonly baseUrl: string | null;
  createSweep(body: SweepCreateRequestDto, opts?: CallOptions): Promise<SweepDto>;
  getSweep(id: string, opts?: CallOptions): Promise<SweepDto>;
  nextQuestion(id: string, opts?: CallOptions): Promise<NextQuestionResponseDto>;
  submitAnswers(id: string, body: SweepAnswersRequestDto, opts?: CallOptions): Promise<SweepDto>;
  verifyFix(id: string, body: VerifyFixRequestDto, opts?: CallOptions): Promise<VerifyFixResponseDto>;
  getShare(slug: string, opts?: CallOptions): Promise<ShareDto>;
  /** Live sweep pricing: the items in one frame, each with its ballpark price. */
  identifyItems(imageBase64: string, opts?: CallOptions): Promise<{ readonly items: readonly LiveItem[] }>;
  /** Live sweep pricing: a sourced price for one branded item. */
  lookupPrice(item: LiveLookupRequest, opts?: CallOptions): Promise<LiveLookupResult>;
}

/* Live sweep pricing (POST /price/identify, /price/lookup). Mirrors apps/api/src/pricing/live.ts. */

export interface LiveItem {
  readonly label: string;
  readonly name: string;
  readonly brand: string | null;
  readonly model: string | null;
  readonly confidence: number;
  readonly tablePrice: number;
  readonly key: string;
}

export interface LiveLookupRequest {
  readonly label: string;
  readonly name: string;
  readonly brand: string | null;
  readonly model: string | null;
}

export interface LivePriceSource {
  readonly url: string;
  readonly title: string | null;
  readonly quote: string;
  readonly price: number;
}

export interface LiveLookupResult {
  readonly key: string;
  readonly price: number | null;
  readonly tablePrice: number;
  readonly sources: readonly LivePriceSource[];
  readonly cached: boolean;
}

/** Route paths, mirrored from `ROUTES` in @retrofit/contracts (pinned by api.test.ts). */
export const API_PATHS = {
  createSweep: () => '/sweeps',
  getSweep: (id: string) => `/sweeps/${encodeURIComponent(id)}`,
  answerSweep: (id: string) => `/sweeps/${encodeURIComponent(id)}/answers`,
  nextQuestion: (id: string) => `/sweeps/${encodeURIComponent(id)}/next-question`,
  verifyFix: (id: string) => `/sweeps/${encodeURIComponent(id)}/verify-fix`,
  share: (slug: string) => `/s/${encodeURIComponent(slug)}`,
  identifyItems: () => '/price/identify',
  lookupPrice: () => '/price/lookup',
} as const;

export function normalizeBaseUrl(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim().replace(/\/+$/, '');
  return trimmed.length > 0 ? trimmed : null;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function isErrorDto(value: unknown): value is ErrorDto {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const inner = (value as { error: unknown }).error;
  return typeof inner === 'object' && inner !== null && 'message' in inner;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const doFetch: FetchLike =
    options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const uploadTimeoutMs = options.uploadTimeoutMs ?? 60_000;
  const basePolicy: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...options.retry };

  /** One attempt: fetch with a deadline, map every failure to an ApiError. */
  async function attempt<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    deadlineMs: number,
    outer: AbortSignal | undefined,
  ): Promise<T> {
    if (baseUrl === null) {
      throw new ApiError({
        kind: 'config',
        message: 'EXPO_PUBLIC_API_URL is not set',
      });
    }
    if (outer?.aborted) throw new ApiError({ kind: 'aborted', message: 'request cancelled' });

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, deadlineMs);
    const onOuterAbort = (): void => controller.abort();
    outer?.addEventListener('abort', onOuterAbort);

    let response: Response;
    try {
      const init: RequestInit = {
        method,
        headers:
          body === undefined
            ? { Accept: 'application/json' }
            : { Accept: 'application/json', 'Content-Type': 'application/json' },
        signal: controller.signal,
      };
      if (body !== undefined) init.body = JSON.stringify(body);
      response = await doFetch(`${baseUrl}${path}`, init);
    } catch (error) {
      if (timedOut) {
        throw new ApiError({ kind: 'timeout', message: `${method} ${path} timed out after ${deadlineMs} ms` });
      }
      if (outer?.aborted === true) {
        throw new ApiError({ kind: 'aborted', message: 'request cancelled' });
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new ApiError({ kind: 'network', message: `${method} ${path} failed: ${detail}` });
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onOuterAbort);
    }

    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new ApiError({ kind: 'network', message: `${method} ${path} body read failed: ${detail}` });
    }

    let parsed: unknown = undefined;
    let parseFailed = false;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parseFailed = true;
      }
    }

    if (!response.ok) {
      const dto = isErrorDto(parsed) ? parsed : null;
      throw new ApiError({
        kind: 'http',
        status: response.status,
        code: dto?.error.code ?? null,
        issues: dto?.error.issues ?? null,
        message: dto?.error.message ?? `${method} ${path} answered ${response.status}`,
      });
    }
    if (parseFailed || parsed === undefined) {
      throw new ApiError({ kind: 'parse', status: response.status, message: `${method} ${path}: response is not JSON` });
    }
    return parsed as T;
  }

  /** Attempts with exponential backoff between retryable failures. */
  async function request<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    deadlineMs: number,
    opts: CallOptions | undefined,
  ): Promise<T> {
    const policy: RetryPolicy = { ...basePolicy, ...opts?.retry };
    const maxAttempts = Math.max(1, Math.floor(policy.maxAttempts));
    for (let n = 1; ; n += 1) {
      try {
        return await attempt<T>(method, path, body, deadlineMs, opts?.signal);
      } catch (raw) {
        const error = isApiError(raw)
          ? raw
          : new ApiError({ kind: 'network', message: raw instanceof Error ? raw.message : String(raw) });
        if (n >= maxAttempts || !isRetryable(error) || opts?.signal?.aborted) {
          throw error.withAttempts(n);
        }
        const delayMs = backoffDelay(n, policy, random);
        options.onRetry?.({ path, retry: n, delayMs, error });
        await sleep(delayMs);
        if (opts?.signal?.aborted) {
          throw new ApiError({ kind: 'aborted', message: 'request cancelled', attempts: n });
        }
      }
    }
  }

  return {
    baseUrl,
    createSweep: (body, opts) =>
      request<SweepDto>('POST', API_PATHS.createSweep(), body, uploadTimeoutMs, opts),
    getSweep: (id, opts) => request<SweepDto>('GET', API_PATHS.getSweep(id), undefined, timeoutMs, opts),
    nextQuestion: (id, opts) =>
      request<NextQuestionResponseDto>('GET', API_PATHS.nextQuestion(id), undefined, timeoutMs, opts),
    submitAnswers: (id, body, opts) =>
      request<SweepDto>('POST', API_PATHS.answerSweep(id), body, timeoutMs, opts),
    verifyFix: (id, body, opts) =>
      request<VerifyFixResponseDto>('POST', API_PATHS.verifyFix(id), body, uploadTimeoutMs, opts),
    getShare: (slug, opts) => request<ShareDto>('GET', API_PATHS.share(slug), undefined, timeoutMs, opts),
    identifyItems: (imageBase64, opts) =>
      request<{ readonly items: readonly LiveItem[] }>('POST', API_PATHS.identifyItems(), { imageBase64 }, timeoutMs, {
        retry: { maxAttempts: 1 },
        ...opts,
      }),
    lookupPrice: (item, opts) =>
      request<LiveLookupResult>('POST', API_PATHS.lookupPrice(), item, timeoutMs, { retry: { maxAttempts: 1 }, ...opts }),
  };
}

/* -------------------------------------------------------------------------- */
/* Polling                                                                    */
/* -------------------------------------------------------------------------- */

/** Stages at which the server pipeline stops on its own (mirrors apps/api sweeps.ts). */
export const RESTING_STAGES: readonly SweepStageDto[] = ['questions', 'done', 'failed'];

export function isRestingStage(stage: SweepStageDto): boolean {
  return RESTING_STAGES.includes(stage);
}

export interface PollOptions {
  readonly intervalMs?: number;
  /** Give up after this long; rejects with an ApiError of kind `timeout`. */
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  /** Every poll result, so `/analyzing` can render the live `stage`. */
  readonly onUpdate?: (sweep: SweepDto) => void;
}

/** Polls GET /sweeps/:id until the stage is resting (`questions`, `done`, `failed`). */
export async function pollSweep(client: ApiClient, id: string, opts: PollOptions = {}): Promise<SweepDto> {
  const intervalMs = opts.intervalMs ?? 1_200;
  const limitMs = opts.timeoutMs ?? 180_000;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const started = now();
  for (;;) {
    if (opts.signal?.aborted) throw new ApiError({ kind: 'aborted', message: 'polling cancelled' });
    const callOpts: CallOptions = opts.signal === undefined ? {} : { signal: opts.signal };
    const sweep = await client.getSweep(id, callOpts);
    opts.onUpdate?.(sweep);
    if (isRestingStage(sweep.stage)) return sweep;
    if (now() - started >= limitMs) {
      throw new ApiError({ kind: 'timeout', message: `sweep ${id} still at "${sweep.stage}" after ${limitMs} ms` });
    }
    await sleep(intervalMs);
  }
}

/* -------------------------------------------------------------------------- */
/* The app's default client                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Must be read as the literal `process.env.EXPO_PUBLIC_API_URL`: Expo inlines
 * EXPO_PUBLIC_* only on a static member access.
 */
export function readApiUrlFromEnv(): string | null {
  return normalizeBaseUrl(process.env.EXPO_PUBLIC_API_URL);
}

let defaultClient: ApiClient | null = null;

/** The shared client the screens use. Created on first use. */
export function getApi(): ApiClient {
  if (defaultClient === null) defaultClient = createApiClient({ baseUrl: readApiUrlFromEnv() });
  return defaultClient;
}
