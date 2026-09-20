import { afterEach, describe, expect, it, vi } from 'vitest';
import { TOKEN_REFRESH_MARGIN_MS, createTokenSource, isExpired, mintToken } from './auth';
import type { FederatoEnv, OAuthToken } from './types';

const ENV: FederatoEnv = {
  baseUrl: 'https://handler.test',
  tokenUrl: 'https://auth.test/oauth/token',
  audience: 'https://aud.test/core-api',
  clientId: 'cid',
  clientSecret: 'shh',
};

function tokenResponse(n: number, expiresIn = 14400): Response {
  return new Response(
    JSON.stringify({ access_token: `tok-${n}`, expires_in: expiresIn, token_type: 'Bearer' }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isExpired', () => {
  const token: OAuthToken = { accessToken: 'a', expiresAtMs: 1_000_000, tokenType: 'Bearer' };
  it('is live until the 5-minute refresh margin', () => {
    expect(TOKEN_REFRESH_MARGIN_MS).toBe(300_000);
    expect(isExpired(token, 1_000_000 - 300_001)).toBe(false);
    expect(isExpired(token, 1_000_000 - 300_000)).toBe(true);
    expect(isExpired(token, 2_000_000)).toBe(true);
  });
});

describe('mintToken', () => {
  it('posts client credentials and computes a 4-hour expiry', async () => {
    const fetchFn = stubFetch(async () => tokenResponse(1));
    const before = Date.now();
    const token = await mintToken(ENV);
    expect(token.accessToken).toBe('tok-1');
    expect(token.tokenType).toBe('Bearer');
    expect(token.expiresAtMs - before).toBeGreaterThanOrEqual(14_400_000);
    expect(token.expiresAtMs - before).toBeLessThan(14_400_000 + 5_000);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://auth.test/oauth/token');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      client_id: 'cid',
      client_secret: 'shh',
      audience: 'https://aud.test/core-api',
      grant_type: 'client_credentials',
    });
  });

  it('defaults to the Federato Auth0 domain and audience', async () => {
    const fetchFn = stubFetch(async () => tokenResponse(1));
    await mintToken({ clientId: 'cid', clientSecret: 'shh' });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://auth.product.federato.ai/oauth/token');
    expect(JSON.parse(String(init.body)).audience).toBe('https://product.federato.ai/core-api');
  });

  it('rejects without credentials and never calls fetch', async () => {
    const fetchFn = stubFetch(async () => tokenResponse(1));
    await expect(mintToken({ clientId: 'cid' })).rejects.toMatchObject({ code: 'MISSING_CREDENTIALS' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('surfaces an Auth0 rejection without leaking the secret', async () => {
    stubFetch(async () =>
      new Response(JSON.stringify({ error: 'access_denied', error_description: 'Unauthorized' }), {
        status: 401,
      }),
    );
    const err = (await mintToken(ENV).then(
      () => null,
      (e: unknown) => e,
    )) as Error & { httpStatus: number };
    expect(err.httpStatus).toBe(401);
    expect(err.message).toContain('access_denied: Unauthorized');
    expect(err.message).not.toContain('shh');
  });
});

describe('createTokenSource', () => {
  it('caches, refreshes 5 minutes before expiry, and uses the injected clock', async () => {
    let now = 1_000_000;
    let n = 0;
    const fetchFn = stubFetch(async () => tokenResponse(++n));
    const src = createTokenSource(ENV, () => now);

    const t1 = await src.getToken();
    expect(t1.accessToken).toBe('tok-1');
    expect(t1.expiresAtMs).toBe(1_000_000 + 14_400_000);

    now += 14_400_000 - 300_001; // 1 ms before the refresh margin
    expect((await src.getToken()).accessToken).toBe('tok-1');
    expect(fetchFn).toHaveBeenCalledTimes(1);

    now += 1; // exactly at the margin
    expect((await src.getToken()).accessToken).toBe('tok-2');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('single-flights concurrent mints', async () => {
    let n = 0;
    const fetchFn = stubFetch(async () => tokenResponse(++n));
    const src = createTokenSource(ENV, () => 0);
    const [a, b, c] = await Promise.all([src.getToken(), src.getToken(), src.getToken()]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect([a.accessToken, b.accessToken, c.accessToken]).toEqual(['tok-1', 'tok-1', 'tok-1']);
  });

  it('invalidate forces a fresh mint', async () => {
    let n = 0;
    stubFetch(async () => tokenResponse(++n));
    const src = createTokenSource(ENV, () => 0);
    expect((await src.getToken()).accessToken).toBe('tok-1');
    src.invalidate();
    expect((await src.getToken()).accessToken).toBe('tok-2');
  });

  it('does not cache a failed mint', async () => {
    let n = 0;
    stubFetch(async () => (++n === 1 ? new Response('boom', { status: 500 }) : tokenResponse(n)));
    const src = createTokenSource(ENV, () => 0);
    await expect(src.getToken()).rejects.toMatchObject({ httpStatus: 500 });
    expect((await src.getToken()).accessToken).toBe('tok-2');
  });
});
