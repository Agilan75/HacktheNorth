/** Enrichment HTTP helper: 6 s timeout plus a per-source cache. Unit A07. */
import { ENRICH_TIMEOUT_MS } from './types';
import type { EnrichCache, EnrichCacheEntry } from './types';

export interface FetchJsonOptions {
  readonly url: string;
  readonly timeoutMs?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly cache?: EnrichCache;
  readonly cacheKey?: string;
  readonly nowMs?: number;
  readonly signal?: AbortSignal;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Cached entries older than this are refetched — but only when the caller
 * passes `nowMs` (from the injected clock). Without `nowMs` an entry lives for
 * the life of the process: this module never reads the wall clock.
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * GET a URL and parse the JSON body, under a hard timeout (default
 * `ENRICH_TIMEOUT_MS`, 6 s) that covers both the response and the body read.
 *
 * With `cache` + `cacheKey`, a fresh cached value is returned without a request,
 * and a successful response is stored. Failures are never cached.
 *
 * Throws `Error` with a short, card-ready message:
 * `timeout after 6000 ms`, `HTTP 503`, `invalid JSON`, `aborted`, or the
 * underlying network error message.
 */
export async function fetchJson<T>(options: FetchJsonOptions): Promise<T> {
  const { url, cache, cacheKey, nowMs } = options;
  const timeoutMs = options.timeoutMs ?? ENRICH_TIMEOUT_MS;

  if (cache && cacheKey !== undefined) {
    const hit = cache.get(cacheKey);
    if (hit && isFresh(hit, nowMs)) return hit.value as T;
  }

  if (options.signal?.aborted) throw new Error('aborted');

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onOuterAbort = (): void => controller.abort();
  options.signal?.addEventListener('abort', onOuterAbort, { once: true });

  const doFetch = options.fetchImpl ?? globalThis.fetch;
  try {
    const work = (async (): Promise<T> => {
      const response = await doFetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json', ...(options.headers ?? {}) },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error('invalid JSON');
      }
    })();
    // A fetch implementation that ignores the abort signal must still time out.
    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error('aborted')), {
        once: true,
      });
    });
    aborted.catch(() => undefined);
    const value = await Promise.race([work, aborted]);
    if (cache && cacheKey !== undefined) cache.set(cacheKey, value, nowMs ?? 0);
    return value;
  } catch (error) {
    if (timedOut) throw new Error(`timeout after ${timeoutMs} ms`);
    if (controller.signal.aborted) throw new Error('aborted');
    if (error instanceof Error) throw error;
    throw new Error(String(error));
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onOuterAbort);
  }
}

function isFresh(entry: EnrichCacheEntry, nowMs: number | undefined): boolean {
  if (nowMs === undefined) return true;
  return nowMs - entry.storedAtMs < CACHE_TTL_MS;
}

/** An in-process Map cache. One per source (flood, geocode, fire station). */
export function createMemoryCache(): EnrichCache {
  const entries = new Map<string, EnrichCacheEntry>();
  return {
    get(key) {
      return entries.get(key);
    },
    set(key, value, nowMs) {
      entries.set(key, { key, value, storedAtMs: nowMs });
    },
    clear() {
      entries.clear();
    },
  };
}
