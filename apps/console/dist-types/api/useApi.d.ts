import type { ApiClient } from './client.js';
export interface AsyncState<T> {
    readonly data: T | null;
    readonly loading: boolean;
    readonly error: Error | null;
    readonly reload: () => void;
}
/** The API origin, for the few requests that are not JSON routes (the verification field's byte layers). */
export declare function resolveBaseUrl(): string;
/**
 * One client for the whole console, built from `VITE_API_URL` (never a
 * secret). Module-level so every page shares it without a provider, since
 * App.tsx is frozen.
 */
export declare function useApiClient(): ApiClient;
/**
 * Runs `select(client)` whenever `deps` change or `reload()` is called.
 * A response that arrives after a newer request started is discarded, so a
 * slow earlier call can never overwrite a later one. Previous `data` is kept
 * while reloading so tables do not flash empty.
 */
export declare function useApi<T>(select: (client: ApiClient) => Promise<T>, deps: readonly unknown[]): AsyncState<T>;
//# sourceMappingURL=useApi.d.ts.map