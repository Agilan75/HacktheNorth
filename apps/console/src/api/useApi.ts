import { useCallback, useEffect, useRef, useState } from 'react';

import type { ApiClient } from './client.js';
import { createApiClient } from './client.js';

export interface AsyncState<T> {
  readonly data: T | null;
  readonly loading: boolean;
  readonly error: Error | null;
  readonly reload: () => void;
}

/** Default when `VITE_API_URL` is unset: the API's default PORT (PRD §8). */
const DEFAULT_API_URL = 'http://localhost:3000';

let sharedClient: ApiClient | null = null;

/** The API origin, for the few requests that are not JSON routes (the verification field's byte layers). */
export function resolveBaseUrl(): string {
  let fromEnv: unknown;
  try {
    fromEnv = (import.meta as { env?: Record<string, unknown> }).env?.VITE_API_URL;
  } catch {
    fromEnv = undefined;
  }
  return typeof fromEnv === 'string' && fromEnv.trim().length > 0 ? fromEnv.trim() : DEFAULT_API_URL;
}

/**
 * One client for the whole console, built from `VITE_API_URL` (never a
 * secret). Module-level so every page shares it without a provider, since
 * App.tsx is frozen.
 */
export function useApiClient(): ApiClient {
  if (sharedClient === null) sharedClient = createApiClient({ baseUrl: resolveBaseUrl() });
  return sharedClient;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * Runs `select(client)` whenever `deps` change or `reload()` is called.
 * A response that arrives after a newer request started is discarded, so a
 * slow earlier call can never overwrite a later one. Previous `data` is kept
 * while reloading so tables do not flash empty.
 */
export function useApi<T>(
  select: (client: ApiClient) => Promise<T>,
  deps: readonly unknown[],
): AsyncState<T> {
  const client = useApiClient();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);

  const selectRef = useRef(select);
  selectRef.current = select;
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    let active = true;
    setLoading(true);
    setError(null);
    let promise: Promise<T>;
    try {
      promise = selectRef.current(client);
    } catch (thrown) {
      promise = Promise.reject(thrown);
    }
    promise.then(
      (value) => {
        if (!active || id !== requestId.current) return;
        setData(value);
        setLoading(false);
      },
      (thrown: unknown) => {
        if (!active || id !== requestId.current) return;
        setError(toError(thrown));
        setLoading(false);
      },
    );
    return () => {
      active = false;
    };
    // `deps` is the caller's dependency list, spread on purpose.
  }, [client, nonce, ...deps]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data, loading, error, reload };
}
