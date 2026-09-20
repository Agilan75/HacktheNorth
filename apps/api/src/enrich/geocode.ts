/** Nominatim geocoding — only when a location has no coordinates. Unit A07. */
import { createMemoryCache, fetchJson } from './http';
import type { EnrichLocation } from './types';

export interface GeocodeResult {
  readonly latitude: number;
  readonly longitude: number;
  readonly matchedAddress: string;
}

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

/** Nominatim's usage policy requires an identifying User-Agent. */
const USER_AGENT = 'Retrofit/0.1 (Hack the North underwriting agent; enrichment geocoder)';

/** Nominatim's usage policy: at most one request per second. */
const MIN_INTERVAL_MS = 1_100;

/** Per-source cache, shared by every caller (flood and fire-station plugins). */
const cache = createMemoryCache();

/** Serialises live requests so two plugins never burst Nominatim. */
let queue: Promise<void> = Promise.resolve();

interface NominatimHit {
  readonly lat?: unknown;
  readonly lon?: unknown;
  readonly display_name?: unknown;
}

/**
 * Coordinates for a location.
 *
 * - Coordinates already on the location are returned as-is, with no request.
 * - Otherwise the address parts are sent to Nominatim (US only, one result).
 * - `null` when there is nothing to search for or Nominatim finds no match.
 * - Throws on a network failure or timeout (the caller turns that into an
 *   "unavailable" card).
 */
export async function geocode(location: EnrichLocation): Promise<GeocodeResult | null> {
  const query = buildQuery(location);

  if (hasCoordinates(location)) {
    return {
      latitude: location.latitude,
      longitude: location.longitude,
      matchedAddress: query ?? location.externalId,
    };
  }
  if (query === null) return null;

  const cacheKey = query.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached) return parseHits(cached.value);

  const url = `${NOMINATIM_URL}?${new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '1',
    countrycodes: 'us',
    addressdetails: '0',
  }).toString()}`;

  const body = await throttled(() =>
    fetchJson<unknown>({
      url,
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
      cache,
      cacheKey,
    }),
  );
  return parseHits(body);
}

function buildQuery(location: EnrichLocation): string | null {
  const parts = [location.address, location.city, location.state, location.zip]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter((p) => p.length > 0);
  // A lone state or ZIP would geocode to a centroid miles from the building.
  if (location.address === null || location.address.trim().length === 0) {
    if (location.zip === null || location.zip.trim().length === 0) return null;
  }
  return parts.length === 0 ? null : parts.join(', ');
}

function parseHits(body: unknown): GeocodeResult | null {
  if (!Array.isArray(body) || body.length === 0) return null;
  const hit = body[0] as NominatimHit;
  const latitude = Number(hit.lat);
  const longitude = Number(hit.lon);
  if (!isLatitude(latitude) || !isLongitude(longitude)) return null;
  return {
    latitude,
    longitude,
    matchedAddress: typeof hit.display_name === 'string' ? hit.display_name : '',
  };
}

function throttled<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task);
  queue = run.then(
    () => pause(MIN_INTERVAL_MS),
    () => pause(MIN_INTERVAL_MS),
  );
  return run;
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    // Never keep the process alive just to honour the rate limit.
    if (typeof t === 'object' && t !== null && 'unref' in t) t.unref();
  });
}

/** (0, 0) is a missing-value placeholder, not a building in the Gulf of Guinea. */
function hasCoordinates(
  location: EnrichLocation,
): location is EnrichLocation & { latitude: number; longitude: number } {
  const { latitude, longitude } = location;
  if (!isLatitude(latitude) || !isLongitude(longitude)) return false;
  return !(latitude === 0 && longitude === 0);
}

function isLatitude(v: number | null): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= -90 && v <= 90;
}

function isLongitude(v: number | null): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= -180 && v <= 180;
}
