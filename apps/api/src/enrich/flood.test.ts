import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFloodPlugin, FLOOD_SOURCE } from './flood';
import type { EnrichContext, EnrichLocation } from './types';

const NOW = '2026-09-19T12:00:00.000Z';
const FEMA = 'hazards.fema.gov';
const MIRROR = 'services.arcgis.com';

/** Unique coordinates per test: the flood cache is per process. */
let seq = 0;
function loc(over: Partial<EnrichLocation> = {}): EnrichLocation {
  seq += 1;
  return {
    externalId: `L${seq}`,
    address: `${seq} Ocean Dr`,
    city: 'Miami',
    state: 'FL',
    zip: null,
    latitude: 25 + seq / 1000,
    longitude: -80 - seq / 1000,
    ...over,
  };
}

function ctx(locations: EnrichLocation[]): EnrichContext {
  return { submissionId: 'S1', nowIso: NOW, locations };
}

function features(...attrs: Record<string, unknown>[]) {
  return { features: attrs.map((attributes) => ({ attributes })) };
}

type Handler = (url: URL) => Response | Promise<Response>;

function stubFetch(handler: Handler) {
  const fn = vi.fn(async (input: unknown) => handler(new URL(String(input))));
  vi.stubGlobal('fetch', fn);
  return fn;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('createFloodPlugin', () => {
  it('declares its source and the one canonical path it writes', () => {
    const p = createFloodPlugin();
    expect(p.source).toBe('openfema_flood');
    expect(FLOOD_SOURCE).toBe('openfema_flood');
    expect(p.writes).toEqual(['locations[].floodZone']);
    expect(p.attribution).toMatch(/FEMA/);
  });

  it('writes an AE zone with enrichment provenance and an available card', async () => {
    const l = loc();
    const fn = stubFetch((url) => {
      expect(url.hostname).toBe(FEMA);
      expect(url.pathname).toMatch(/NFHL\/MapServer\/28\/query$/);
      expect(url.searchParams.get('geometry')).toBe(`${l.longitude},${l.latitude}`);
      expect(url.searchParams.get('inSR')).toBe('4326');
      expect(url.searchParams.get('outFields')).toBe('FLD_ZONE,ZONE_SUBTY,SFHA_TF');
      return json(features({ FLD_ZONE: 'AE', ZONE_SUBTY: null, SFHA_TF: 'T' }));
    });

    const out = await createFloodPlugin().run(ctx([l]));
    expect(out.available).toBe(true);
    expect(out.unavailableReason).toBeNull();
    expect(out.values).toEqual([
      {
        canonicalPath: `locations.${l.externalId}.floodZone`,
        value: 'AE',
        provenance: {
          source: 'enrichment',
          sourceDetail: 'openfema_flood: FEMA NFHL S_Fld_Haz_Ar (fema_nfhl)',
          observedAt: NOW,
        },
      },
    ]);
    expect(out.card).toMatchObject({ source: 'openfema_flood', available: true, fetchedAt: NOW });
    expect(out.card.fields).toEqual([
      {
        canonicalPath: `locations.${l.externalId}.floodZone`,
        label: `Flood zone, ${l.address}, Miami, FL`,
        valueText: 'Zone AE (Special Flood Hazard Area)',
        value: 'AE',
      },
    ]);
    expect(out.durationMs).toBeGreaterThanOrEqual(0);

    // Second run for the same point is served from the per-source cache.
    await createFloodPlugin().run(ctx([l]));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('on a zone boundary keeps the most hazardous polygon', async () => {
    const a = loc();
    const b = loc();
    stubFetch((url) => {
      const lat = Number(url.searchParams.get('geometry')!.split(',')[1]);
      if (lat === a.latitude) {
        return json(
          features(
            { FLD_ZONE: 'X', ZONE_SUBTY: 'AREA OF MINIMAL FLOOD HAZARD', SFHA_TF: 'F' },
            { FLD_ZONE: 'VE', ZONE_SUBTY: null, SFHA_TF: 'T' },
            { FLD_ZONE: 'AE', ZONE_SUBTY: null, SFHA_TF: 'T' },
          ),
        );
      }
      return json(
        features(
          { FLD_ZONE: 'X', ZONE_SUBTY: 'AREA OF MINIMAL FLOOD HAZARD', SFHA_TF: 'F' },
          { FLD_ZONE: 'X', ZONE_SUBTY: '0.2 PCT ANNUAL CHANCE FLOOD HAZARD', SFHA_TF: 'F' },
        ),
      );
    });
    const out = await createFloodPlugin().run(ctx([a, b]));
    expect(out.values.map((v) => v.value)).toEqual(['VE', 'X']);
    expect(out.card.fields.map((f) => f.valueText)).toEqual([
      'Zone VE (Special Flood Hazard Area)',
      'Zone X (0.2 pct annual chance flood hazard)',
    ]);
    expect((out.raw.locations as { zoneSubtype: string | null }[])[1]!.zoneSubtype).toBe(
      '0.2 PCT ANNUAL CHANCE FLOOD HAZARD',
    );
  });

  it('falls back to the NFHL mirror when hazards.fema.gov is unreachable', async () => {
    const l = loc();
    const hosts: string[] = [];
    stubFetch((url) => {
      hosts.push(url.hostname);
      if (url.hostname === FEMA) throw new TypeError('fetch failed');
      return json(features({ FLD_ZONE: 'AO', ZONE_SUBTY: null, SFHA_TF: 'T' }));
    });
    const out = await createFloodPlugin().run(ctx([l]));
    expect(hosts).toEqual([FEMA, MIRROR]);
    expect(out.values[0]!.value).toBe('AO');
    expect(out.values[0]!.provenance.sourceDetail).toMatch(/esri_nfhl_mirror/);
  });

  it('treats an ArcGIS error envelope (HTTP 200) as a failure, not an answer', async () => {
    const l = loc();
    stubFetch((url) =>
      url.hostname === FEMA
        ? json({ error: { code: 500, message: 'Unable to complete operation.' } })
        : json(features({ FLD_ZONE: 'A', ZONE_SUBTY: null, SFHA_TF: 'T' })),
    );
    const out = await createFloodPlugin().run(ctx([l]));
    expect(out.values[0]!.value).toBe('A');
  });

  it('reports "Not mapped" for a point outside every panel, with no value written', async () => {
    const l = loc();
    stubFetch(() =>
      json(features({ FLD_ZONE: 'AREA NOT INCLUDED', ZONE_SUBTY: null, SFHA_TF: 'F' })),
    );
    const out = await createFloodPlugin().run(ctx([l]));
    expect(out.available).toBe(true);
    expect(out.values).toEqual([]);
    expect(out.card.fields[0]).toMatchObject({ valueText: 'Not mapped by FEMA', value: null });
  });

  it('returns an unavailable card, never a throw, when every endpoint fails', async () => {
    const l = loc();
    stubFetch(() => json({ message: 'down' }, 503));
    const out = await createFloodPlugin().run(ctx([l]));
    expect(out.available).toBe(false);
    expect(out.unavailableReason).toBe('fema_nfhl: HTTP 503; esri_nfhl_mirror: HTTP 503');
    expect(out.values).toEqual([]);
    expect(out.card).toMatchObject({ available: false, fetchedAt: null, fields: [] });
  });

  it('splits the 6 s budget: 3 s per endpoint', async () => {
    vi.useFakeTimers();
    const l = loc();
    stubFetch(
      () =>
        new Promise<Response>(() => {
          /* never answers */
        }),
    );
    const p = createFloodPlugin().run(ctx([l]));
    await vi.advanceTimersByTimeAsync(6_000);
    const out = await p;
    expect(out.available).toBe(false);
    expect(out.unavailableReason).toBe(
      'fema_nfhl: timeout after 3000 ms; esri_nfhl_mirror: timeout after 3000 ms',
    );
  });

  it('keeps the card available when only some locations fail', async () => {
    const good = loc();
    const bad = loc();
    stubFetch((url) => {
      const lat = Number(url.searchParams.get('geometry')!.split(',')[1]);
      if (lat === bad.latitude) return json({}, 500);
      return json(features({ FLD_ZONE: 'X', ZONE_SUBTY: 'AREA OF MINIMAL FLOOD HAZARD', SFHA_TF: 'F' }));
    });
    const out = await createFloodPlugin().run(ctx([good, bad]));
    expect(out.available).toBe(true);
    expect(out.values).toHaveLength(1);
    expect(out.card.fields[1]!.valueText).toBe(
      'Unavailable (fema_nfhl: HTTP 500; esri_nfhl_mirror: HTTP 500)',
    );
  });

  it('geocodes a location with no coordinates through Nominatim first', async () => {
    const l = loc({ address: '77 Geocode Blvd', zip: '33139', latitude: null, longitude: null });
    const hosts: string[] = [];
    stubFetch((url) => {
      hosts.push(url.hostname);
      if (url.hostname === 'nominatim.openstreetmap.org') {
        return json([{ lat: '25.7907', lon: '-80.1300', display_name: '77 Geocode Blvd' }]);
      }
      expect(url.searchParams.get('geometry')).toBe('-80.13,25.7907');
      return json(features({ FLD_ZONE: 'AE', SFHA_TF: 'T' }));
    });
    const out = await createFloodPlugin().run(ctx([l]));
    expect(hosts).toEqual(['nominatim.openstreetmap.org', FEMA]);
    expect(out.values[0]!.value).toBe('AE');
    expect((out.raw.locations as { geocoded: boolean }[])[0]!.geocoded).toBe(true);
  });

  it('is unavailable with no locations, and when nothing can be located', async () => {
    const fn = stubFetch(() => json({}));
    const none = await createFloodPlugin().run(ctx([]));
    expect(none.available).toBe(false);
    expect(none.unavailableReason).toBe('No locations on this submission');

    const lost = await createFloodPlugin().run(
      ctx([loc({ address: null, zip: null, latitude: null, longitude: null })]),
    );
    expect(lost.available).toBe(false);
    expect(lost.unavailableReason).toBe('no coordinates and no geocodable address');
    expect(fn).not.toHaveBeenCalled();
  });
});
