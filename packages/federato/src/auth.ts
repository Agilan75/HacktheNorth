/** Auth0 client-credentials token cache. Body owned by Run 1 unit F01. */
import type { FederatoEnv, OAuthToken } from './types';

/** Refresh this many ms before `expiresAtMs`. Tokens last 4 hours. */
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

export interface TokenSource {
  /** Returns a live token, minting or refreshing as needed. */
  getToken(): Promise<OAuthToken>;
  /** Drops the cached token so the next call mints a fresh one. */
  invalidate(): void;
}

/** Mints one token. The only place the client secret is used. */
export function mintToken(_env: FederatoEnv): Promise<OAuthToken> {
  throw new Error('NOT_IMPLEMENTED:F01');
}

export function isExpired(_token: OAuthToken, _nowMs: number): boolean {
  throw new Error('NOT_IMPLEMENTED:F01');
}

/** Caching wrapper. `nowMs` is injected so tests never touch the clock. */
export function createTokenSource(
  _env: FederatoEnv,
  _nowMs?: () => number,
): TokenSource {
  throw new Error('NOT_IMPLEMENTED:F01');
}
