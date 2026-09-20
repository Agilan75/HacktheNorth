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

/** PRD §7.1: the custom Auth0 domain, never the handler host. */
const DEFAULT_TOKEN_URL = 'https://auth.product.federato.ai/oauth/token';
const DEFAULT_AUDIENCE = 'https://product.federato.ai/core-api';
/** API_DOCUMENTATION.pdf: `expires_in: 14400`. Used only if the field is absent. */
const DEFAULT_EXPIRES_IN_S = 4 * 60 * 60;

/** Error carrying the `FederatoErrorShape` fields. Never carries the secret. */
class TokenMintError extends Error {
  readonly code: string | null;
  readonly httpStatus: number | null;
  readonly raw: string;
  constructor(code: string | null, message: string, httpStatus: number | null, raw: string) {
    super(message);
    this.name = 'TokenMintError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.raw = raw;
  }
}

function describeTokenError(body: unknown, text: string): string {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    const parts = [b.error, b.error_description, b.message].filter(
      (p): p is string => typeof p === 'string' && p.length > 0,
    );
    if (parts.length > 0) return parts.join(': ');
  }
  return text.trim().slice(0, 500) || 'empty response';
}

async function mintWith(env: FederatoEnv, nowMs: () => number): Promise<OAuthToken> {
  if (!env.clientId || !env.clientSecret) {
    throw new TokenMintError(
      'MISSING_CREDENTIALS',
      'Federato client credentials are not configured (FEDERATO_CLIENT_ID / FEDERATO_CLIENT_SECRET).',
      null,
      'missing credentials',
    );
  }
  const tokenUrl = env.tokenUrl ?? DEFAULT_TOKEN_URL;
  const requestedAt = nowMs();
  let res: Response;
  try {
    res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        client_id: env.clientId,
        client_secret: env.clientSecret,
        audience: env.audience ?? DEFAULT_AUDIENCE,
        grant_type: 'client_credentials',
      }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TokenMintError('NETWORK_ERROR', `Token request failed: ${msg}`, null, msg);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const reason = describeTokenError(body, text);
    throw new TokenMintError('AUTH_ERROR', `Token request rejected (HTTP ${res.status}): ${reason}`, res.status, reason);
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const accessToken = b.access_token;
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new TokenMintError('AUTH_ERROR', 'Token response carried no access_token.', res.status, 'no access_token');
  }
  const expiresIn =
    typeof b.expires_in === 'number' && Number.isFinite(b.expires_in) && b.expires_in > 0
      ? b.expires_in
      : DEFAULT_EXPIRES_IN_S;
  const token: OAuthToken = {
    accessToken,
    // Stamped from the moment the request was sent, so any latency eats into
    // the lifetime rather than extending it.
    expiresAtMs: requestedAt + expiresIn * 1000,
    tokenType: typeof b.token_type === 'string' && b.token_type ? b.token_type : 'Bearer',
    ...(typeof b.scope === 'string' ? { scope: b.scope } : {}),
  };
  return token;
}

/** Mints one token. The only place the client secret is used. */
export function mintToken(env: FederatoEnv): Promise<OAuthToken> {
  return mintWith(env, () => Date.now());
}

export function isExpired(token: OAuthToken, nowMs: number): boolean {
  return nowMs >= token.expiresAtMs - TOKEN_REFRESH_MARGIN_MS;
}

/** Caching wrapper. `nowMs` is injected so tests never touch the clock. */
export function createTokenSource(
  env: FederatoEnv,
  nowMs: () => number = () => Date.now(),
): TokenSource {
  let cached: OAuthToken | null = null;
  let inflight: Promise<OAuthToken> | null = null;
  // Bumped by invalidate() so a mint started before it never lands in the cache.
  let generation = 0;

  return {
    getToken(): Promise<OAuthToken> {
      if (cached && !isExpired(cached, nowMs())) return Promise.resolve(cached);
      if (inflight) return inflight;
      const gen = generation;
      const p = mintWith(env, nowMs).then(
        (token) => {
          if (gen === generation) {
            cached = token;
            inflight = null;
          }
          return token;
        },
        (err: unknown) => {
          if (gen === generation) inflight = null;
          throw err;
        },
      );
      inflight = p;
      return p;
    },
    invalidate(): void {
      generation += 1;
      cached = null;
      inflight = null;
    },
  };
}
