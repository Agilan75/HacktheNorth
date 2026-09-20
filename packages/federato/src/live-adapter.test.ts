import { describe, expect, it, vi } from 'vitest';
import type { TokenSource } from './auth';
import {
  createLiveAdapter,
  liveGlossary,
  liveGuidelines,
  liveQuery,
  liveSchema,
  parseFederatoError,
  unwrapEnvelope,
} from './live-adapter';
import type { FederatoEnv, QueryPayload } from './types';

vi.mock('./reference/guidelines', () => ({
  readGuidelines: () => ({ doc: 'APPETITE_GUIDELINES.pdf', version: 't', rows: [], sections: [] }),
}));
vi.mock('./reference/glossary', () => ({
  readGlossary: () => ({ doc: 'GLOSSARY.pdf', version: 't', entries: [] }),
}));

const ENV: FederatoEnv = { baseUrl: 'https://product.federato.ai', clientId: 'x', clientSecret: 'y' };
const HANDLER =
  'https://product.federato.ai/integrations-api/handlers/federato-hack-north?outputOnly=true';

function fakeTokens(): TokenSource & { invalidations: number; mints: number } {
  let current = 0;
  const src = {
    invalidations: 0,
    mints: 0,
    async getToken() {
      if (current === 0) {
        src.mints += 1;
        current = src.mints;
      }
      return { accessToken: `tok-${current}`, expiresAtMs: Number.MAX_SAFE_INTEGER, tokenType: 'Bearer' };
    },
    invalidate() {
      src.invalidations += 1;
      current = 0;
    },
  };
  return src;
}

function json(body: unknown, status = 201): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const PAYLOAD: QueryPayload = { resource: 'Policy', where: { line_of_business: 'property' }, pagination: { limit: 2 } };
const RESULT = { resource: 'Policy', total: 27, results: [{ id: 1 }, { id: 2 }] };

describe('unwrapEnvelope', () => {
  it('unwraps the workflow envelope', () => {
    expect(unwrapEnvelope({ output: [{ data: RESULT }] })).toEqual(RESULT);
  });
  it('unwraps the bare { data } shape', () => {
    expect(unwrapEnvelope({ data: RESULT })).toEqual(RESULT);
  });
  it('passes an already-bare payload through', () => {
    expect(unwrapEnvelope(RESULT)).toEqual(RESULT);
  });
  it('unwraps an envelope around a { data } wrapper and a JSON string body', () => {
    expect(unwrapEnvelope({ output: [{ data: { data: RESULT } }] })).toEqual(RESULT);
    expect(unwrapEnvelope(JSON.stringify({ output: [{ data: RESULT }] }))).toEqual(RESULT);
  });
});

describe('parseFederatoError', () => {
  it('splits the [CODE] prefix from the message', () => {
    const raw = '[VALIDATION_ERROR] Unknown operator "$grt" {"operator":"$grt"}';
    expect(parseFederatoError(raw, 201)).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Unknown operator "$grt" {"operator":"$grt"}',
      httpStatus: 201,
      raw,
    });
  });
  it('tolerates an "Error: " prefix', () => {
    expect(parseFederatoError('Error: [NOT_FOUND] no such resource').code).toBe('NOT_FOUND');
  });
  it('returns a null code for an unprefixed message', () => {
    expect(parseFederatoError('Unknown action frob')).toEqual({
      code: null,
      message: 'Unknown action frob',
      httpStatus: null,
      raw: 'Unknown action frob',
    });
  });
});

describe('liveQuery', () => {
  it('posts { action, payload } with a bearer token and accepts 201 + envelope', async () => {
    const fetchImpl = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) =>
      json({ output: [{ data: RESULT }] }, 201),
    );
    const res = await liveQuery(
      { env: ENV, tokenSource: fakeTokens(), fetchImpl: fetchImpl as unknown as typeof fetch },
      PAYLOAD,
    );
    expect(res).toEqual(RESULT);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(HANDLER);
    expect(init!.method).toBe('POST');
    expect((init!.headers as Record<string, string>).authorization).toBe('Bearer tok-1');
    expect(JSON.parse(String(init!.body))).toEqual({ action: 'query', payload: PAYLOAD });
  });

  it('keeps a full handler URL and adds outputOnly once', async () => {
    const fetchImpl = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => json(RESULT, 200));
    await liveQuery(
      {
        env: { baseUrl: 'https://h.test/integrations-api/handlers/other?outputOnly=true' },
        tokenSource: fakeTokens(),
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
      PAYLOAD,
    );
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://h.test/integrations-api/handlers/other?outputOnly=true');
  });

  it('fills total from results when the handler omits it', async () => {
    const fetchImpl = vi.fn(async () => json({ output: [{ data: { results: [{ id: 9 }] } }] }));
    const res = await liveQuery({ env: ENV, tokenSource: fakeTokens(), fetchImpl: fetchImpl as unknown as typeof fetch }, PAYLOAD);
    expect(res).toEqual({ resource: 'Policy', total: 1, results: [{ id: 9 }] });
  });

  it('re-mints once on 401 and retries', async () => {
    const tokens = fakeTokens();
    let n = 0;
    const fetchImpl = vi.fn(async () => (++n === 1 ? new Response('Invalid token', { status: 401 }) : json({ data: RESULT })));
    const res = await liveQuery({ env: ENV, tokenSource: tokens, fetchImpl: fetchImpl as unknown as typeof fetch }, PAYLOAD);
    expect(res.total).toBe(27);
    expect(tokens.invalidations).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const auth = (fetchImpl.mock.calls as unknown as [string, RequestInit][])[1]![1].headers as Record<string, string>;
    expect(auth.authorization).toBe('Bearer tok-2');
  });

  it('gives up after a second 401', async () => {
    const fetchImpl = vi.fn(async () => new Response('Invalid token', { status: 401 }));
    await expect(
      liveQuery({ env: ENV, tokenSource: fakeTokens(), fetchImpl: fetchImpl as unknown as typeof fetch }, PAYLOAD),
    ).rejects.toMatchObject({ httpStatus: 401, message: 'Invalid token' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('parses a [CODE] error from a non-2xx body', async () => {
    const fetchImpl = vi.fn(async () => json({ error: '[VALIDATION_ERROR] Unknown operator "$grt"' }, 400));
    await expect(
      liveQuery({ env: ENV, tokenSource: fakeTokens(), fetchImpl: fetchImpl as unknown as typeof fetch }, PAYLOAD),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', httpStatus: 400, message: '[VALIDATION_ERROR] Unknown operator "$grt"' });
  });

  it('parses a [CODE] error string delivered inside a 201 envelope', async () => {
    const fetchImpl = vi.fn(async () => json({ output: [{ data: '[QUERY_ERROR] bad path' }] }, 201));
    await expect(
      liveQuery({ env: ENV, tokenSource: fakeTokens(), fetchImpl: fetchImpl as unknown as typeof fetch }, PAYLOAD),
    ).rejects.toMatchObject({ code: 'QUERY_ERROR', httpStatus: 201, raw: '[QUERY_ERROR] bad path' });
  });
});

describe('liveSchema', () => {
  it('flattens the live schema map into SchemaDocument dot-paths', async () => {
    const live = {
      Policy: {
        type: 'object',
        optional: false,
        fields: {
          id: { type: 'number', optional: false },
          dates: { type: 'object', optional: false, fields: { effective: { type: 'string', optional: false } } },
          claims: { type: 'reference', optional: false, resource: 'Claim', cardinality: 'many' },
          submission: { type: 'reference', optional: true, resource: 'Submission', cardinality: 'one' },
          producer: {
            type: 'object',
            optional: false,
            fields: { broker: { type: 'reference', optional: false, resource: 'Broker', cardinality: 'one' } },
          },
          technical_premium: { type: 'number', optional: true },
        },
      },
      Location: {
        type: 'object',
        optional: false,
        fields: { hazard_tags: { type: 'array', itemType: 'string', optional: false } },
      },
    };
    const fetchImpl = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => json({ output: [{ data: live }] }));
    const doc = await liveSchema({ env: ENV, tokenSource: fakeTokens(), fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body))).toEqual({ action: 'schema' });
    expect(doc.resources.map((r) => r.name)).toEqual(['Policy', 'Location']);
    expect(doc.resources[0]!.fields).toEqual([
      { path: 'id', type: 'number' },
      { path: 'dates.effective', type: 'string' },
      { path: 'claims', type: 'reference', reference: 'Claim', isArray: true },
      { path: 'submission', type: 'reference', reference: 'Submission', nullable: true },
      { path: 'producer.broker', type: 'reference', reference: 'Broker' },
      { path: 'technical_premium', type: 'number', nullable: true },
    ]);
    expect(doc.resources[1]!.fields).toEqual([{ path: 'hazard_tags', type: 'array' }]);
    expect(typeof doc.fetchedAt).toBe('string');
  });
});

describe('createLiveAdapter', () => {
  it('is kind "live" and serves guidelines and glossary from the transcriptions', async () => {
    const fetchImpl = vi.fn(async () => json(RESULT));
    const opts = { env: ENV, tokenSource: fakeTokens(), fetchImpl: fetchImpl as unknown as typeof fetch };
    const adapter = createLiveAdapter(opts);
    expect(adapter.kind).toBe('live');
    expect((await adapter.query(PAYLOAD)).total).toBe(27);
    expect((await adapter.getGuidelines()).doc).toBe('APPETITE_GUIDELINES.pdf');
    expect((await adapter.getGlossary()).doc).toBe('GLOSSARY.pdf');
    expect((await liveGuidelines(opts)).doc).toBe('APPETITE_GUIDELINES.pdf');
    expect((await liveGlossary(opts)).doc).toBe('GLOSSARY.pdf');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
