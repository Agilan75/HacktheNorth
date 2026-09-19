/** Enrichment HTTP helper: 6 s timeout plus a per-source cache. Unit A07. */
import type { EnrichCache } from './types';

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

export function fetchJson<T>(_options: FetchJsonOptions): Promise<T> {
  throw new Error('NOT_IMPLEMENTED:A07');
}

export function createMemoryCache(): EnrichCache {
  throw new Error('NOT_IMPLEMENTED:A07');
}
