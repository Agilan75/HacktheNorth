import { afterEach, describe, expect, it, vi } from 'vitest';
import { geocode } from './geocode';
import type { EnrichLocation } from './types';

function loc(over: Partial<EnrichLocation>): EnrichLocation {
  return {
    externalId: 'L1',
    address: null,
    city: null,
    state: null,
    zip: null,
    latitude: null,
    longitude: null,
    ...over,
  };
}

function stubFetch(body: unknown, status = 200) {
  const fn = vi.fn(async (_input: unknown, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('geocode', () => {
  it('returns coordinates already on the location without a request', async () => {
    const fn = stubFetch([]);
    const r = await geocode(
      loc({ address: '1 Market St', city: 'San Francisco', state: 'CA', latitude: 37.7706, longitude: -122.3921 }),
    );
    expect(r).toEqual({ latitude: 37.7706, longitude: -122.3921, matchedAddress: '1 Market St, San Francisco, CA' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('returns null with no request when there is no address and no ZIP', async () => {
    const fn = stubFetch([]);
    expect(await geocode(loc({ city: 'Austin', state: 'TX' }))).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it('asks Nominatim (US, one result, identifying User-Agent) and parses string coordinates', async () => {
    const fn = stubFetch([{ lat: '30.2672', lon: '-97.7431', display_name: '100 Congress Ave, Austin, TX' }]);
    const r = await geocode(loc({ address: '100 Congress Ave', city: 'Austin', state: 'TX', zip: '78701' }));
    expect(r).toEqual({ latitude: 30.2672, longitude: -97.7431, matchedAddress: '100 Congress Ave, Austin, TX' });
    expect(fn).toHaveBeenCalledTimes(1);
    const [input, init] = fn.mock.calls[0]!;
    const url = new URL(String(input));
    expect(url.origin + url.pathname).toBe('https://nominatim.openstreetmap.org/search');
    expect(url.searchParams.get('q')).toBe('100 Congress Ave, Austin, TX, 78701');
    expect(url.searchParams.get('format')).toBe('jsonv2');
    expect(url.searchParams.get('limit')).toBe('1');
    expect(url.searchParams.get('countrycodes')).toBe('us');
    const headers = init!.headers as Record<string, string>;
    expect(headers['User-Agent']).toMatch(/^Retrofit\//);

    // Same address again: served from the per-source cache.
    const again = await geocode(loc({ externalId: 'L9', address: '100 congress ave', city: 'Austin', state: 'TX', zip: '78701' }));
    expect(again!.latitude).toBe(30.2672);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('treats (0, 0) as missing and geocodes by ZIP', async () => {
    const fn = stubFetch([{ lat: '25.7657', lon: '-80.1936', display_name: 'Miami, FL 33130' }]);
    const r = await geocode(loc({ zip: '33130', state: 'FL', latitude: 0, longitude: 0 }));
    expect(r!.latitude).toBe(25.7657);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('returns null when Nominatim finds nothing', async () => {
    stubFetch([]);
    expect(await geocode(loc({ address: 'Nowhere Rd 999', zip: '00000' }))).toBeNull();
  });

  it('throws on an HTTP failure so the caller can mark the card unavailable', async () => {
    stubFetch({ error: 'rate limited' }, 429);
    await expect(geocode(loc({ address: '5 Failing Way', zip: '99999' }))).rejects.toThrow('HTTP 429');
  });
});
