import type { ApiClient } from './client.js';

export interface AsyncState<T> {
  readonly data: T | null;
  readonly loading: boolean;
  readonly error: Error | null;
  readonly reload: () => void;
}

/** Stub frozen by W0-4. Unit C01 replaces this body only. */
export function useApiClient(): ApiClient {
  throw new Error('NOT_IMPLEMENTED:C01');
}

/** Stub frozen by W0-4. Unit C01 replaces this body only. */
export function useApi<T>(
  _select: (client: ApiClient) => Promise<T>,
  _deps: readonly unknown[],
): AsyncState<T> {
  throw new Error('NOT_IMPLEMENTED:C01');
}
