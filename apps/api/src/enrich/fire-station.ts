/** Fire-station distance via Overpass. Body owned by Run 1 unit A08. */
import { math } from '@retrofit/engine';
import type { ExternalValue } from '@retrofit/engine';
import { formatDistance } from '@retrofit/contracts';
import type { EnrichmentCardDto } from '@retrofit/contracts';
import { geocode } from './geocode';
import { createMemoryCache, fetchJson } from './http';
import { ENRICH_TIMEOUT_MS } from './types';
import type { EnrichContext, EnrichLocation, EnrichOutcome, EnrichPlugin } from './types';

export const FIRE_STATION_SOURCE = 'overpass_fire_station';

/**
 * Public Overpass instances, tried in order. They share the 6 s budget
 * (3 s each) so one location never exceeds it (docs/decisions/A08.md).
 */
const ENDPOINTS: readonly { readonly id: string; readonly url: string }[] = [
  { id: 'overpass_de', url: 'https://overpass-api.de/api/interpreter' },
  { id: 'overpass_kumi', url: 'https://overpass.kumi.systems/api/interpreter' },
];
const PER_ENDPOINT_TIMEOUT_MS = Math.floor(ENRICH_TIMEOUT_MS / ENDPOINTS.length);

/**
 * Search radius: 5 miles. ISO's Public Protection Classification treats a
 * building more than 5 road miles from a responding station as unprotected
 * (class 10), so a station beyond this radius tells the underwriter nothing
 * a "none within 5 mi" card does not.
 */
export const SEARCH_RADIUS_M = 8_047;

const TITLE = 'Nearest fire station';
const ATTRIBUTION = '© OpenStreetMap contributors (ODbL), via the Overpass API';
const SOURCE_DETAIL = `${FIRE_STATION_SOURCE}: OSM amenity=fire_station, straight-line distance`;
const USER_AGENT = 'Retrofit/0.1 (Hack the North underwriting agent; fire-station enrichment)';
const EARTH_RADIUS_KM = 6_371.0088;

/** Per-source cache of parsed results, keyed by coordinates rounded to ~1 m. */
const cache = createMemoryCache();
/** Matches http.ts: refetch after a day, measured only on the injected clock. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface OverpassElement {
  readonly type?: unknown;
  readonly id?: unknown;
  readonly lat?: unknown;
  readonly lon?: unknown;
  readonly center?: { readonly lat?: unknown; readonly lon?: unknown };
  readonly tags?: Readonly<Record<string, unknown>>;
}

interface OverpassResponse {
  readonly elements?: readonly OverpassElement[];
  readonly remark?: unknown;
}

interface Station {
  readonly osmId: string;
  readonly name: string | null;
  readonly latitude: number;
  readonly longitude: number;
  /** Straight-line distance, km, rounded to 0.01. */
  readonly distanceKm: number;
}

interface LocationResult {
  readonly externalId: string;
  readonly label: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly geocoded: boolean;
  /** Nearest station within SEARCH_RADIUS_M, or null when none. */
  readonly station: Station | null;
  readonly stationsInRadius: number;
  readonly endpoint: string | null;
  /** Lookup succeeded (a station, or confirmed none within the radius). */
  readonly ok: boolean;
  readonly error: string | null;
}

export function createFireStationPlugin(): EnrichPlugin {
  return {
    source: FIRE_STATION_SOURCE,
    title: TITLE,
    attribution: ATTRIBUTION,
    writes: ['locations[].fireStationDistanceKm'],
    run,
  };
}

async function run(context: EnrichContext): Promise<EnrichOutcome> {
  const started = performance.now();
  const parsedNow = Date.parse(context.nowIso);
  const nowMs = Number.isFinite(parsedNow) ? parsedNow : undefined;
  const results: LocationResult[] = [];
  // Sequential: public Overpass instances allow ~2 concurrent slots per client.
  for (const location of context.locations) {
    results.push(await lookupLocation(location, context.signal, nowMs));
  }
  const durationMs = Math.round(performance.now() - started);

  const values: ExternalValue[] = [];
  for (const r of results) {
    if (!r.station) continue;
    values.push({
      canonicalPath: pathOf(r.externalId),
      value: r.station.distanceKm,
      provenance: {
        source: 'enrichment',
        sourceDetail: `${SOURCE_DETAIL} (${r.endpoint ?? 'unknown'})`,
        observedAt: context.nowIso,
      },
    });
  }

  const unavailableReason = reasonIfUnavailable(results);
  const available = unavailableReason === null;

  const card: EnrichmentCardDto = {
    source: FIRE_STATION_SOURCE,
    title: TITLE,
    available,
    unavailableReason,
    fetchedAt: available ? context.nowIso : null,
    fields: available
      ? results.map((r) => ({
          canonicalPath: pathOf(r.externalId),
          label: `Nearest fire station, ${r.label}`,
          valueText: describe(r),
          value: r.station ? r.station.distanceKm : null,
        }))
      : [],
    attribution: ATTRIBUTION,
  };

  return {
    source: FIRE_STATION_SOURCE,
    available,
    unavailableReason,
    values,
    card,
    raw: {
      endpoints: ENDPOINTS.map((e) => e.url),
      radiusM: SEARCH_RADIUS_M,
      locations: results.map((r) => ({
        externalId: r.externalId,
        endpoint: r.endpoint,
        latitude: r.latitude,
        longitude: r.longitude,
        geocoded: r.geocoded,
        stationsInRadius: r.stationsInRadius,
        nearest: r.station,
        error: r.error,
      })),
    },
    durationMs,
  };
}

async function lookupLocation(
  location: EnrichLocation,
  signal: AbortSignal | undefined,
  nowMs: number | undefined,
): Promise<LocationResult> {
  const base = { externalId: location.externalId, label: locationLabel(location) };
  const failed = (error: string, geocoded: boolean): LocationResult => ({
    ...base,
    latitude: null,
    longitude: null,
    geocoded,
    station: null,
    stationsInRadius: 0,
    endpoint: null,
    ok: false,
    error,
  });

  let point: { latitude: number; longitude: number } | null;
  try {
    point = await geocode(location);
  } catch (error) {
    return failed(`geocoding failed: ${message(error)}`, true);
  }
  if (!point) return failed('no coordinates and no geocodable address', false);

  const { latitude, longitude } = point;
  const geocoded = !(location.latitude === latitude && location.longitude === longitude);
  const located = { ...base, latitude, longitude, geocoded };
  const cacheKey = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;

  const hit = cache.get(cacheKey);
  if (hit && (nowMs === undefined || nowMs - hit.storedAtMs < CACHE_TTL_MS)) {
    const cached = hit.value as { station: Station | null; count: number; endpoint: string };
    return {
      ...located,
      station: cached.station,
      stationsInRadius: cached.count,
      endpoint: cached.endpoint,
      ok: true,
      error: null,
    };
  }

  const data = buildQuery(latitude, longitude);
  const errors: string[] = [];
  for (const endpoint of ENDPOINTS) {
    if (signal?.aborted) {
      errors.push('aborted');
      break;
    }
    try {
      const body = await fetchJson<OverpassResponse>({
        url: `${endpoint.url}?${new URLSearchParams({ data }).toString()}`,
        timeoutMs: PER_ENDPOINT_TIMEOUT_MS,
        headers: { 'User-Agent': USER_AGENT },
        ...(signal ? { signal } : {}),
      });
      const stations = parseOverpass(body, latitude, longitude);
      const station = stations[0] ?? null;
      // The parsed result is cached, not the body: Overpass reports a query
      // timeout as HTTP 200 with a `remark`, which must never be cached.
      cache.set(cacheKey, { station, count: stations.length, endpoint: endpoint.id }, nowMs ?? 0);
      return {
        ...located,
        station,
        stationsInRadius: stations.length,
        endpoint: endpoint.id,
        ok: true,
        error: null,
      };
    } catch (error) {
      errors.push(`${endpoint.id}: ${message(error)}`);
    }
  }
  return {
    ...located,
    station: null,
    stationsInRadius: 0,
    endpoint: null,
    ok: false,
    error: errors.join('; '),
  };
}

function buildQuery(latitude: number, longitude: number): string {
  const around = `around:${SEARCH_RADIUS_M},${latitude},${longitude}`;
  const serverTimeoutS = Math.max(1, Math.floor(PER_ENDPOINT_TIMEOUT_MS / 1000));
  return `[out:json][timeout:${serverTimeoutS}];nwr["amenity"="fire_station"](${around});out center tags;`;
}

/**
 * Every station in the response with a usable point, nearest first. Ways and
 * relations carry `center`; nodes carry `lat`/`lon`. Throws on an Overpass
 * runtime-error remark (delivered with HTTP 200) or a body with no `elements`.
 */
function parseOverpass(body: OverpassResponse, lat: number, lon: number): Station[] {
  if (typeof body.remark === 'string' && /error/i.test(body.remark)) {
    throw new Error(`Overpass: ${body.remark.trim().slice(0, 160)}`);
  }
  if (!Array.isArray(body.elements)) throw new Error('Overpass: unexpected response');
  const seen = new Set<string>();
  const stations: Station[] = [];
  for (const el of body.elements) {
    const pLat = Number(el.lat ?? el.center?.lat);
    const pLon = Number(el.lon ?? el.center?.lon);
    if (!Number.isFinite(pLat) || !Number.isFinite(pLon)) continue;
    const osmId = `${typeof el.type === 'string' ? el.type : 'node'}/${String(el.id ?? '?')}`;
    if (seen.has(osmId)) continue;
    seen.add(osmId);
    const tags = el.tags ?? {};
    const name = typeof tags.name === 'string' && tags.name.trim().length > 0 ? tags.name.trim() : null;
    stations.push({
      osmId,
      name,
      latitude: pLat,
      longitude: pLon,
      distanceKm: math.roundTo(haversineKm(lat, lon, pLat, pLon), 2),
    });
  }
  stations.sort((a, b) => a.distanceKm - b.distanceKm || a.osmId.localeCompare(b.osmId));
  return stations;
}

/** Great-circle distance in km (mean Earth radius). */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

function reasonIfUnavailable(results: readonly LocationResult[]): string | null {
  if (results.length === 0) return 'No locations on this submission';
  if (results.some((r) => r.ok)) return null;
  const errors = [...new Set(results.map((r) => r.error).filter((e): e is string => e !== null))];
  return errors.length === 0 ? 'Fire-station lookup failed' : errors.join('; ');
}

function describe(r: LocationResult): string {
  if (!r.ok) return `Unavailable (${r.error ?? 'lookup failed'})`;
  if (!r.station) {
    return `None within ${formatDistance(SEARCH_RADIUS_M, { from: 'm', to: 'mi', decimals: 0 })} (straight line)`;
  }
  const km = formatDistance(r.station.distanceKm, { decimals: 1 });
  const mi = formatDistance(r.station.distanceKm, { to: 'mi', decimals: 1 });
  const name = r.station.name ? `, ${r.station.name}` : '';
  return `${km} (${mi}) straight line${name}`;
}

function pathOf(externalId: string): string {
  return `locations.${externalId}.fireStationDistanceKm`;
}

function locationLabel(l: EnrichLocation): string {
  const where = [l.address, l.city, l.state].filter(
    (p): p is string => typeof p === 'string' && p.trim().length > 0,
  );
  return where.length > 0 ? where.join(', ') : l.externalId;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
