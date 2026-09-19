import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFireStationPlugin, FIRE_STATION_SOURCE, SEARCH_RADIUS_M } from './fire-station';
import type { EnrichContext, EnrichLocation } from './types';

const NOW = '2026-09-19T12:00:00.000Z';
const PRIMARY = 'overpass-api.de';
const MIRROR = 'overpass.kumi.systems';

/** Unique coordinates per test: the fire-station cache is per process. */
let seq = 0;
function loc(over: Partial<EnrichLocation> = {}): EnrichLocation {
  seq += 1;
  return {
    externalId: `F${seq}`,
    address: `${seq} Main St`,
    city: 'Springfield',
    state: 'PA',
    zip: null,
    latitude: 40 + seq / 100,
    longitude: -75,
    ...over,
  };
}

const ctx = (locations: EnrichLocation[]): EnrichContext => ({ submissionId: 'S1', nowIso: NOW, locations });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function stubFetch(handler: (url: URL) => Response | Promise<Response>) {
  const fn = vi.fn(async (input: unknown) => handler(new URL(String(input))));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createFireStationPlugin', () => {
  it('declares its source and the one canonical path it writes', () => {
    const p = createFireStationPlugin();
    expect(p.source).toBe('overpass_fire_station');
    expect(FIRE_STATION_SOURCE).toBe('overpass_fire_station');
    expect(p.writes).toEqual(['locations[].fireStationDistanceKm']);
    expect(p.attribution).toMatch(/OpenStreetMap/);
    expect(SEARCH_RADIUS_M).toBe(8_047);
  });

  it('writes the straight-line distance to the nearest station, node or way', async () => {
    const l = loc();
    const lat = l.latitude!;
    const fn = stubFetch((url) => {
      expect(url.hostname).toBe(PRIMARY);
      const data = url.searchParams.get('data') ?? '';
      expect(data).toContain('[out:json]');
      expect(data).toContain('"amenity"="fire_station"');
      expect(data).toContain(`around:8047,${lat},-75`);
      expect(data).toContain('out center');
      return json({
        elements: [
          // way 0.02° east: 1.70 km at this latitude band
          { type: 'way', id: 7, center: { lat, lon: -75.02 }, tags: { amenity: 'fire_station' } },
          // node 0.01° north: 1.11 km
          { type: 'node', id: 9, lat: lat + 0.01, lon: -75, tags: { name: 'Engine 12' } },
          { type: 'relation', id: 3, tags: {} }, // no point: ignored
        ],
      });
    });

    const out = await createFireStationPlugin().run(ctx([l]));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(out.available).toBe(true);
    expect(out.unavailableReason).toBeNull();
    expect(out.values).toEqual([
      {
        canonicalPath: `locations.${l.externalId}.fireStationDistanceKm`,
        value: 1.11,
        provenance: {
          source: 'enrichment',
          sourceDetail:
            'overpass_fire_station: OSM amenity=fire_station, straight-line distance (overpass_de)',
          observedAt: NOW,
        },
      },
    ]);
    expect(out.card.fetchedAt).toBe(NOW);
    expect(out.card.fields).toHaveLength(1);
    expect(out.card.fields[0]!.value).toBe(1.11);
    expect(out.card.fields[0]!.valueText).toBe('1.1 km (0.7 mi) straight line, Engine 12');
    const raw = out.raw.locations as { stationsInRadius: number; nearest: { osmId: string } }[];
    expect(raw[0]!.stationsInRadius).toBe(2);
    expect(raw[0]!.nearest.osmId).toBe('node/9');
  });

  it('uses the way centre when it is nearest (1.70 km)', async () => {
    const l = loc();
    stubFetch(() =>
      json({ elements: [{ type: 'way', id: 1, center: { lat: 40, lon: -75.02 } }] }),
    );
    const out = await createFireStationPlugin().run(ctx([{ ...l, latitude: 40, longitude: -75 }]));
    expect(out.values[0]!.value).toBe(1.7);
  });

  it('finds no station within 5 mi: available, no value written', async () => {
    const l = loc();
    stubFetch(() => json({ version: 0.6, elements: [] }));
    const out = await createFireStationPlugin().run(ctx([l]));
    expect(out.available).toBe(true);
    expect(out.values).toEqual([]);
    expect(out.card.fields[0]!.value).toBeNull();
    expect(out.card.fields[0]!.valueText).toBe('None within 5 mi (straight line)');
  });

  it('falls back to the mirror on HTTP failure and on an Overpass runtime-error remark', async () => {
    const a = loc();
    const b = loc();
    const hosts: string[] = [];
    stubFetch((url) => {
      hosts.push(url.hostname);
      const data = url.searchParams.get('data') ?? '';
      if (url.hostname === PRIMARY) {
        return data.includes(`${a.latitude}`)
          ? json({ error: 'busy' }, 429)
          : json({ elements: [], remark: 'runtime error: Query timed out in "query" at line 1' });
      }
      return json({ elements: [{ type: 'node', id: 1, lat: 40.5, lon: -75 }] });
    });
    const out = await createFireStationPlugin().run(ctx([a, b]));
    expect(hosts).toEqual([PRIMARY, MIRROR, PRIMARY, MIRROR]);
    expect(out.available).toBe(true);
    expect(out.values).toHaveLength(2);
    for (const v of out.values) expect(v.provenance.sourceDetail).toMatch(/\(overpass_kumi\)$/);
  });

  it('is unavailable when every endpoint fails, with the reasons and no fields', async () => {
    const l = loc();
    stubFetch(() => json({}, 503));
    const out = await createFireStationPlugin().run(ctx([l]));
    expect(out.available).toBe(false);
    expect(out.values).toEqual([]);
    expect(out.unavailableReason).toBe('overpass_de: HTTP 503; overpass_kumi: HTTP 503');
    expect(out.card).toMatchObject({
      source: 'overpass_fire_station',
      available: false,
      fetchedAt: null,
      fields: [],
    });
  });

  it('keeps partial success: one location fails, the card stays available', async () => {
    const good = loc();
    const noWhere = loc({ address: null, zip: null, latitude: null, longitude: null });
    stubFetch(() => json({ elements: [{ type: 'node', id: 2, lat: good.latitude! + 0.01, lon: -75 }] }));
    const out = await createFireStationPlugin().run(ctx([good, noWhere]));
    expect(out.available).toBe(true);
    expect(out.values).toHaveLength(1);
    expect(out.card.fields.map((f) => f.valueText)).toEqual([
      expect.stringContaining('1.1 km'),
      'Unavailable (no coordinates and no geocodable address)',
    ]);
  });

  it('caches the parsed result per coordinate', async () => {
    const l = loc();
    const fn = stubFetch(() => json({ elements: [{ type: 'node', id: 4, lat: l.latitude! + 0.01, lon: -75 }] }));
    const first = await createFireStationPlugin().run(ctx([l]));
    const second = await createFireStationPlugin().run(ctx([l]));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(second.values).toEqual(first.values);
  });

  it('never caches a failure', async () => {
    const l = loc();
    stubFetch(() => json({}, 500));
    expect((await createFireStationPlugin().run(ctx([l]))).available).toBe(false);
    const fn = stubFetch(() => json({ elements: [] }));
    expect((await createFireStationPlugin().run(ctx([l]))).available).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('has an unavailable card for a submission with no locations', async () => {
    const out = await createFireStationPlugin().run(ctx([]));
    expect(out.available).toBe(false);
    expect(out.unavailableReason).toBe('No locations on this submission');
  });

  it('stops before any request once the signal is aborted', async () => {
    const fn = stubFetch(() => json({ elements: [] }));
    const controller = new AbortController();
    controller.abort();
    const out = await createFireStationPlugin().run({ ...ctx([loc()]), signal: controller.signal });
    expect(fn).not.toHaveBeenCalled();
    expect(out.available).toBe(false);
    expect(out.unavailableReason).toBe('aborted');
  });
});
