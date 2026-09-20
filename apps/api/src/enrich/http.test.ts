import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryCache, fetchJson } from './http';
import { ENRICH_TIMEOUT_MS } from './types';

const URL_A = 'https://example.test/a';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A fetch that never answers but honours its abort signal. */
function hangingFetch(): typeof fetch {
  return ((_input: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('The operation was aborted')));
    })) as typeof fetch;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('fetchJson', () => {
  it('parses JSON and sends the caller headers', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ zone: 'AE' }));
    const out = await fetchJson<{ zone: string }>({
      url: URL_A,
      headers: { 'User-Agent': 'Retrofit-test' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out).toEqual({ zone: 'AE' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)['User-Agent']).toBe('Retrofit-test');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('serves a cached value without a second request', async () => {
    const cache = createMemoryCache();
    const fetchImpl = vi.fn(async () => jsonResponse({ n: 1 }));
    const opts = { url: URL_A, cache, cacheKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch };
    expect(await fetchJson(opts)).toEqual({ n: 1 });
    expect(await fetchJson(opts)).toEqual({ n: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refetches after 24 h measured on the injected clock', async () => {
    const cache = createMemoryCache();
    let n = 0;
    const fetchImpl = vi.fn(async () => jsonResponse({ n: ++n }));
    const base = { url: URL_A, cache, cacheKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch };
    const t0 = 1_000_000;
    expect(await fetchJson({ ...base, nowMs: t0 })).toEqual({ n: 1 });
    expect(cache.get('k')!.storedAtMs).toBe(t0);
    expect(await fetchJson({ ...base, nowMs: t0 + 24 * 3_600_000 - 1 })).toEqual({ n: 1 });
    expect(await fetchJson({ ...base, nowMs: t0 + 24 * 3_600_000 })).toEqual({ n: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('throws HTTP <status> on a non-2xx and does not cache the failure', async () => {
    const cache = createMemoryCache();
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'x' }, 503));
    await expect(
      fetchJson({ url: URL_A, cache, cacheKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow('HTTP 503');
    expect(cache.get('k')).toBeUndefined();
  });

  it('throws "invalid JSON" on an unparseable body', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>', { status: 200 }));
    await expect(
      fetchJson({ url: URL_A, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow('invalid JSON');
  });

  it('times out at exactly 6000 ms by default', async () => {
    expect(ENRICH_TIMEOUT_MS).toBe(6_000);
    vi.useFakeTimers();
    let settled: string | null = null;
    const p = fetchJson({ url: URL_A, fetchImpl: hangingFetch() }).then(
      () => (settled = 'resolved'),
      (e: Error) => (settled = e.message),
    );
    await vi.advanceTimersByTimeAsync(5_999);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(settled).toBe('timeout after 6000 ms');
  });

  it('times out even when the fetch implementation ignores the abort signal', async () => {
    const deaf = (() => new Promise<Response>(() => undefined)) as typeof fetch;
    await expect(fetchJson({ url: URL_A, timeoutMs: 20, fetchImpl: deaf })).rejects.toThrow(
      'timeout after 20 ms',
    );
  });

  it('reports "aborted" when the caller signal aborts', async () => {
    const outer = new AbortController();
    const p = fetchJson({ url: URL_A, signal: outer.signal, fetchImpl: hangingFetch() });
    outer.abort();
    await expect(p).rejects.toThrow('aborted');

    const already = new AbortController();
    already.abort();
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    await expect(
      fetchJson({ url: URL_A, signal: already.signal, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow('aborted');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('createMemoryCache', () => {
  it('stores, returns and clears entries', () => {
    const cache = createMemoryCache();
    expect(cache.get('a')).toBeUndefined();
    cache.set('a', { v: 1 }, 42);
    expect(cache.get('a')).toEqual({ key: 'a', value: { v: 1 }, storedAtMs: 42 });
    cache.clear();
    expect(cache.get('a')).toBeUndefined();
  });

  it('keeps separate instances separate (one cache per source)', () => {
    const flood = createMemoryCache();
    const geo = createMemoryCache();
    flood.set('k', 1, 0);
    expect(geo.get('k')).toBeUndefined();
  });
});
