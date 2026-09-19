import { describe, expect, it } from 'vitest';
import { MINI_HYDRATED_POLICIES, MINI_SNAPSHOT } from '../fixtures/mini-snapshot';
import { adapterBanner, createAdapter, selectAdapterKind } from './create-adapter';
import type { FederatoEnv } from './types';

const FULL: FederatoEnv = {
  baseUrl: 'https://api.example.test/integrations/handler?x=1',
  tokenUrl: 'https://auth.example.test/oauth/token',
  audience: 'aud',
  clientId: 'client-id-value',
  clientSecret: 'super-secret-value',
};

describe('selectAdapterKind', () => {
  it('needs base URL + client id + client secret for live', () => {
    expect(selectAdapterKind(FULL)).toBe('live');
    expect(selectAdapterKind({ ...FULL, tokenUrl: undefined, audience: undefined })).toBe('live');
  });

  it('falls back to the mock when anything required is missing or blank', () => {
    expect(selectAdapterKind({})).toBe('mock');
    expect(selectAdapterKind({ ...FULL, baseUrl: undefined })).toBe('mock');
    expect(selectAdapterKind({ ...FULL, baseUrl: '   ' })).toBe('mock');
    expect(selectAdapterKind({ ...FULL, clientId: undefined })).toBe('mock');
    expect(selectAdapterKind({ ...FULL, clientSecret: '' })).toBe('mock');
  });
});

describe('adapterBanner', () => {
  it('names the live host and never a credential or path', () => {
    const line = adapterBanner('live', FULL);
    expect(line).toBe('*** FEDERATO: LIVE API (api.example.test) ***');
    expect(line).not.toContain('secret');
    expect(line).not.toContain('client-id');
  });

  it('is loud about the snapshot and says why', () => {
    expect(adapterBanner('mock', {})).toBe(
      '*** FEDERATO: SNAPSHOT (MockFederatoAdapter) - NOT the live API - FEDERATO_BASE_URL is unset ***',
    );
    const partial = adapterBanner('mock', { baseUrl: FULL.baseUrl });
    expect(partial).toContain('FEDERATO_CLIENT_ID, FEDERATO_CLIENT_SECRET are missing');
    expect(adapterBanner('mock', { ...FULL, clientSecret: undefined })).toContain(
      'FEDERATO_CLIENT_SECRET is missing',
    );
    expect(adapterBanner('mock', FULL)).toContain('mock forced');
    expect(adapterBanner('mock', { ...FULL, clientSecret: undefined })).not.toContain('client-id');
  });
});

describe('createAdapter', () => {
  it('builds the mock over the supplied snapshot when the base URL is unset', async () => {
    const adapter = createAdapter({ env: {}, snapshot: MINI_SNAPSHOT });
    expect(adapter.kind).toBe('mock');
    const res = await adapter.query({
      resource: 'Policy',
      where: { line_of_business: 'property' },
      expand: {
        insured: true,
        submission: true,
        claims: true,
        exposure_units: { location: { buildings: true } },
      },
      pagination: { limit: 200 },
    });
    expect(res.total).toBe(3);
    expect(res.results).toEqual(MINI_HYDRATED_POLICIES);
  });

  it('builds the live adapter with full credentials without touching the network at construction', () => {
    let calls = 0;
    const fetchImpl = (() => {
      calls += 1;
      return Promise.reject(new Error('no network in tests'));
    }) as unknown as typeof fetch;
    const adapter = createAdapter({ env: FULL, snapshot: MINI_SNAPSHOT, fetchImpl });
    expect(adapter.kind).toBe('live');
    expect(calls).toBe(0);
  });
});
