import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultPlugins, PLUGIN_DEADLINE_MS, runEnrichment } from './runner';
import type { EnrichContext, EnrichOutcome, EnrichPlugin } from './types';

const NOW = '2026-09-19T12:00:00.000Z';
const CONTEXT: EnrichContext = {
  submissionId: 'S1',
  nowIso: NOW,
  locations: [
    { externalId: 'L1', address: null, city: 'Miami', state: 'FL', zip: null, latitude: 25.76, longitude: -80.19 },
  ],
};

function plugin(source: string, run: EnrichPlugin['run'], writes = [`locations[].${source}`]): EnrichPlugin {
  return { source, title: `${source} title`, attribution: `${source} attribution`, writes, run };
}

function ok(source: string, values: EnrichOutcome['values']): EnrichOutcome {
  return {
    source,
    available: true,
    unavailableReason: null,
    values,
    card: {
      source,
      title: `${source} title`,
      available: true,
      unavailableReason: null,
      fetchedAt: NOW,
      fields: [{ canonicalPath: `locations.L1.${source}`, label: 'x', valueText: 'x', value: 1 }],
      attribution: `${source} attribution`,
    },
    raw: { from: source },
    durationMs: 12,
  };
}

const value = (path: string, v: unknown) => ({
  canonicalPath: path,
  value: v,
  provenance: { source: 'enrichment' as const, observedAt: NOW },
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('defaultPlugins', () => {
  it('ships exactly flood and fire station, in that order, each writing a canonical path', () => {
    const plugins = defaultPlugins();
    expect(plugins.map((p) => p.source)).toEqual(['openfema_flood', 'overpass_fire_station']);
    expect(plugins.map((p) => p.writes)).toEqual([
      ['locations[].floodZone'],
      ['locations[].fireStationDistanceKm'],
    ]);
  });
});

describe('runEnrichment', () => {
  it('returns one outcome per plugin in plugin order, values intact', async () => {
    const a = plugin('floodZone', async () => ok('floodZone', [value('locations.L1.floodZone', 'AE')]));
    const b = plugin('fireStationDistanceKm', async () =>
      ok('fireStationDistanceKm', [value('locations.L1.fireStationDistanceKm', 1.11)]),
    );
    const out = await runEnrichment(CONTEXT, [a, b]);
    expect(out.map((o) => o.source)).toEqual(['floodZone', 'fireStationDistanceKm']);
    expect(out.every((o) => o.available)).toBe(true);
    expect(out.flatMap((o) => o.values.map((v) => v.value))).toEqual(['AE', 1.11]);
    expect(out[0]!.durationMs).toBe(12);
    expect(out[0]!.raw).toEqual({ from: 'floodZone' });
  });

  it('runs plugins concurrently, not one after another', async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    const slow = (name: string, ms: number) =>
      plugin(name, () => new Promise((resolve) => setTimeout(() => { order.push(name); resolve(ok(name, [])); }, ms)));
    const pending = runEnrichment(CONTEXT, [slow('a', 3_000), slow('b', 1_000)]);
    await vi.advanceTimersByTimeAsync(3_000);
    const out = await pending;
    expect(order).toEqual(['b', 'a']);
    expect(out.map((o) => o.source)).toEqual(['a', 'b']);
  });

  it('turns a throwing plugin into an unavailable card and keeps the others', async () => {
    const bad = plugin('floodZone', async () => {
      throw new Error('HTTP 503');
    });
    const syncBad = plugin('other', () => {
      throw new Error('sync boom');
    });
    const good = plugin('fireStationDistanceKm', async () =>
      ok('fireStationDistanceKm', [value('locations.L1.fireStationDistanceKm', 2.5)]),
    );
    const out = await runEnrichment(CONTEXT, [bad, syncBad, good]);
    expect(out[0]).toEqual({
      source: 'floodZone',
      available: false,
      unavailableReason: 'HTTP 503',
      values: [],
      card: {
        source: 'floodZone',
        title: 'floodZone title',
        available: false,
        unavailableReason: 'HTTP 503',
        fetchedAt: null,
        fields: [],
        attribution: 'floodZone attribution',
      },
      raw: { error: 'HTTP 503' },
      durationMs: expect.any(Number),
    });
    expect(out[1]!.unavailableReason).toBe('sync boom');
    expect(out[2]!.available).toBe(true);
    expect(out[2]!.values[0]!.value).toBe(2.5);
  });

  it(`cuts a plugin off at ${PLUGIN_DEADLINE_MS} ms with a timeout card and aborts its signal`, async () => {
    vi.useFakeTimers();
    let seen: AbortSignal | undefined;
    const hang = plugin('floodZone', (c) => {
      seen = c.signal;
      return new Promise<EnrichOutcome>(() => undefined);
    });
    const pending = runEnrichment(CONTEXT, [hang]);
    await vi.advanceTimersByTimeAsync(PLUGIN_DEADLINE_MS);
    const [out] = await pending;
    expect(PLUGIN_DEADLINE_MS).toBe(12_000);
    expect(out!.available).toBe(false);
    expect(out!.unavailableReason).toBe('timeout after 12000 ms');
    expect(out!.card.available).toBe(false);
    expect(seen?.aborted).toBe(true);
  });

  it('is unavailable with "aborted" when the caller aborts mid-run', async () => {
    const controller = new AbortController();
    const hang = plugin('floodZone', () => new Promise<EnrichOutcome>(() => undefined));
    const pending = runEnrichment({ ...CONTEXT, signal: controller.signal }, [hang]);
    controller.abort();
    const [out] = await pending;
    expect(out!.unavailableReason).toBe('aborted');
    expect(out!.values).toEqual([]);
  });

  it('does not run a plugin at all when the caller already aborted', async () => {
    const run = vi.fn(async () => ok('floodZone', []));
    const controller = new AbortController();
    controller.abort();
    const [out] = await runEnrichment({ ...CONTEXT, signal: controller.signal }, [plugin('floodZone', run)]);
    expect(run).not.toHaveBeenCalled();
    expect(out!.unavailableReason).toBe('aborted');
  });

  it('cuts a plugin that declares no canonical path without running it (PRD §8)', async () => {
    const run = vi.fn(async () => ok('x', []));
    const [out] = await runEnrichment(CONTEXT, [plugin('x', run, [])]);
    expect(run).not.toHaveBeenCalled();
    expect(out!.available).toBe(false);
    expect(out!.unavailableReason).toBe('Plugin writes no canonical field and is cut');
  });

  it('rejects a malformed outcome', async () => {
    const weird = plugin('floodZone', async () => ({ nope: true }) as unknown as EnrichOutcome);
    const [out] = await runEnrichment(CONTEXT, [weird]);
    expect(out!.available).toBe(false);
    expect(out!.unavailableReason).toBe('Plugin returned a malformed result');
  });

  it('strips values from an unavailable outcome and keeps its reason and raw', async () => {
    const p = plugin('floodZone', async () => ({
      ...ok('floodZone', [value('locations.L1.floodZone', 'AE')]),
      available: false,
      unavailableReason: 'fema_nfhl: timeout after 3000 ms',
      raw: { tried: 2 },
    }));
    const [out] = await runEnrichment(CONTEXT, [p]);
    expect(out!.values).toEqual([]);
    expect(out!.card.fields).toEqual([]);
    expect(out!.card.fetchedAt).toBeNull();
    expect(out!.unavailableReason).toBe('fema_nfhl: timeout after 3000 ms');
    expect(out!.raw).toEqual({ tried: 2 });
  });

  it('drops values on undeclared paths and forces enrichment provenance', async () => {
    const p = plugin('floodZone', async () =>
      ok('wrong-source', [
        value('locations.L1.floodZone', 'X'),
        value('buildings.B1.yearBuilt', 1900),
        value('locations.floodZone', 'A'),
        {
          canonicalPath: 'locations.L2.floodZone',
          value: 'VE',
          provenance: { source: 'self_reported' as const },
        },
      ]),
    );
    const [out] = await runEnrichment(CONTEXT, [p]);
    expect(out!.source).toBe('floodZone');
    expect(out!.card.source).toBe('floodZone');
    expect(out!.values).toEqual([
      value('locations.L1.floodZone', 'X'),
      { canonicalPath: 'locations.L2.floodZone', value: 'VE', provenance: { source: 'enrichment', observedAt: NOW } },
    ]);
  });

  it('with the default plugins and every network call failing, returns two unavailable cards', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    const out = await runEnrichment({
      ...CONTEXT,
      locations: [{ ...CONTEXT.locations[0]!, externalId: 'L-RUNNER', latitude: 12.3456, longitude: -45.6789 }],
    });
    expect(out.map((o) => [o.source, o.available])).toEqual([
      ['openfema_flood', false],
      ['overpass_fire_station', false],
    ]);
    expect(out[1]!.unavailableReason).toBe('overpass_de: HTTP 503; overpass_kumi: HTTP 503');
    expect(out.flatMap((o) => o.values)).toEqual([]);
  });
});
