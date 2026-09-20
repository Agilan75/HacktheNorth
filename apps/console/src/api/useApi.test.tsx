import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApiClient } from './client';
import { useApi, useApiClient } from './useApi';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useApiClient', () => {
  it('returns one shared client pointed at localhost:3000 by default', async () => {
    const first = renderHook(() => useApiClient()).result.current;
    const second = renderHook(() => useApiClient()).result.current;
    expect(first).toBe(second);

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, version: '0.1.0', adapter: 'live', llmConfigured: true, submissionCount: 1, startedAt: 'x' })),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(first.health()).resolves.toEqual({ ok: true, adapter: 'live', version: '0.1.0' });
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe('http://localhost:3000/health');
  });
});

describe('useApi', () => {
  it('loads, exposes data, and reloads on demand', async () => {
    let n = 0;
    const select = vi.fn(async (_client: ApiClient) => ++n);
    const { result } = renderHook(() => useApi(select, []));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBe(1);
    expect(result.current.error).toBeNull();

    act(() => result.current.reload());
    await waitFor(() => expect(result.current.data).toBe(2));
    expect(select).toHaveBeenCalledTimes(2);
  });

  it('surfaces a rejection as an Error, including a non-Error throw', async () => {
    const { result } = renderHook(() => useApi(() => Promise.reject('boom'), []));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('boom');
    expect(result.current.data).toBeNull();
  });

  it('discards a stale response when deps change mid-flight', async () => {
    const resolvers = new Map<string, (v: string) => void>();
    const { result, rerender } = renderHook(({ id }: { id: string }) =>
      useApi(() => new Promise<string>((resolve) => resolvers.set(id, resolve)), [id]),
      { initialProps: { id: 'a' } },
    );
    rerender({ id: 'b' });
    await act(async () => {
      resolvers.get('b')?.('B');
    });
    await waitFor(() => expect(result.current.data).toBe('B'));
    await act(async () => {
      resolvers.get('a')?.('A');
    });
    expect(result.current.data).toBe('B');
    expect(result.current.loading).toBe(false);
  });
});
