/** Flood zone via OpenFEMA. Body owned by Run 1 unit A07. */
import type { ExternalValue } from '@retrofit/engine';
import type { EnrichmentCardDto } from '@retrofit/contracts';
import { geocode } from './geocode';
import { createMemoryCache, fetchJson } from './http';
import { ENRICH_TIMEOUT_MS } from './types';
import type { EnrichContext, EnrichLocation, EnrichOutcome, EnrichPlugin } from './types';

export const FLOOD_SOURCE = 'openfema_flood';

/**
 * FEMA flood hazard zone polygons (`S_Fld_Haz_Ar`), tried in order. OpenFEMA's
 * own REST datasets carry no point-in-polygon flood zone lookup, so the first
 * endpoint is FEMA's National Flood Hazard Layer (layer 28); the second is
 * Esri's hosted copy of the same NFHL polygons with the same fields, used when
 * hazards.fema.gov is unreachable (it reset every connection when measured —
 * docs/decisions/A07.md). Both share the 6 s budget: 3 s each.
 */
const ENDPOINTS: readonly { readonly id: string; readonly url: string }[] = [
  {
    id: 'fema_nfhl',
    url: 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query',
  },
  {
    id: 'esri_nfhl_mirror',
    url: 'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Flood_Hazard_Reduced_Set_gdb/FeatureServer/0/query',
  },
];
const PER_ENDPOINT_TIMEOUT_MS = Math.floor(ENRICH_TIMEOUT_MS / ENDPOINTS.length);

const TITLE = 'Flood zone';
const ATTRIBUTION = 'FEMA National Flood Hazard Layer (NFHL), public domain';
const SOURCE_DETAIL = `${FLOOD_SOURCE}: FEMA NFHL S_Fld_Haz_Ar`;

/** Per-source cache of parsed zones, keyed by coordinates rounded to ~1 m. */
const cache = createMemoryCache();
/** Matches http.ts: refetch after a day, measured only on the injected clock. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** `FLD_ZONE` values that mean "no determination here", not a zone. */
const NOT_A_ZONE = new Set(['AREA NOT INCLUDED', 'OPEN WATER', '']);

interface NfhlAttributes {
  readonly FLD_ZONE?: unknown;
  readonly ZONE_SUBTY?: unknown;
  readonly SFHA_TF?: unknown;
}

interface NfhlResponse {
  readonly features?: readonly { readonly attributes?: NfhlAttributes }[];
  readonly error?: { readonly code?: unknown; readonly message?: unknown };
}

interface FloodZone {
  readonly zone: string;
  readonly subtype: string | null;
  /** Special Flood Hazard Area (the 1 %-annual-chance floodplain). */
  readonly sfha: boolean;
}

interface LocationResult {
  readonly externalId: string;
  readonly label: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly geocoded: boolean;
  readonly zone: FloodZone | null;
  /** Which entry of ENDPOINTS answered, or null. */
  readonly endpoint: string | null;
  /** Lookup succeeded (a zone, or confirmed unmapped). */
  readonly ok: boolean;
  readonly error: string | null;
}

export function createFloodPlugin(): EnrichPlugin {
  return {
    source: FLOOD_SOURCE,
    title: TITLE,
    attribution: ATTRIBUTION,
    writes: ['locations[].floodZone'],
    run,
  };
}

async function run(context: EnrichContext): Promise<EnrichOutcome> {
  const started = performance.now();
  const nowMs = Date.parse(context.nowIso);
  const results = await Promise.all(
    context.locations.map((location) =>
      lookupLocation(location, context.signal, Number.isFinite(nowMs) ? nowMs : undefined),
    ),
  );
  const durationMs = Math.round(performance.now() - started);

  const values: ExternalValue[] = [];
  for (const r of results) {
    if (!r.zone) continue;
    values.push({
      canonicalPath: `locations.${r.externalId}.floodZone`,
      value: r.zone.zone,
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
    source: FLOOD_SOURCE,
    title: TITLE,
    available,
    unavailableReason,
    fetchedAt: available ? context.nowIso : null,
    fields: available
      ? results.map((r) => ({
          canonicalPath: `locations.${r.externalId}.floodZone`,
          label: `Flood zone, ${r.label}`,
          valueText: describe(r),
          value: r.zone ? r.zone.zone : null,
        }))
      : [],
    attribution: ATTRIBUTION,
  };

  return {
    source: FLOOD_SOURCE,
    available,
    unavailableReason,
    values,
    card,
    raw: {
      endpoints: ENDPOINTS.map((e) => e.url),
      locations: results.map((r) => ({
        endpoint: r.endpoint,
        externalId: r.externalId,
        latitude: r.latitude,
        longitude: r.longitude,
        geocoded: r.geocoded,
        floodZone: r.zone?.zone ?? null,
        zoneSubtype: r.zone?.subtype ?? null,
        sfha: r.zone?.sfha ?? null,
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
  const label = locationLabel(location);
  const base = { externalId: location.externalId, label };

  let point: { latitude: number; longitude: number } | null;
  try {
    point = await geocode(location);
  } catch (error) {
    return {
      ...base,
      latitude: null,
      longitude: null,
      geocoded: true,
      zone: null,
      endpoint: null,
      ok: false,
      error: `geocoding failed: ${message(error)}`,
    };
  }
  if (!point) {
    return {
      ...base,
      latitude: null,
      longitude: null,
      geocoded: false,
      zone: null,
      endpoint: null,
      ok: false,
      error: 'no coordinates and no geocodable address',
    };
  }

  const { latitude, longitude } = point;
  const geocoded = !(location.latitude === latitude && location.longitude === longitude);
  const located = { ...base, latitude, longitude, geocoded };
  const query = new URLSearchParams({
    geometry: `${longitude},${latitude}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'FLD_ZONE,ZONE_SUBTY,SFHA_TF',
    returnGeometry: 'false',
    f: 'json',
  }).toString();
  const cacheKey = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;

  // The parsed zone is cached, not the body: an ArcGIS error envelope arrives
  // as HTTP 200 and must never be cached as an answer.
  const hit = cache.get(cacheKey);
  if (hit && (nowMs === undefined || nowMs - hit.storedAtMs < CACHE_TTL_MS)) {
    const cached = hit.value as { zone: FloodZone | null; endpoint: string };
    return { ...located, zone: cached.zone, endpoint: cached.endpoint, ok: true, error: null };
  }

  const errors: string[] = [];
  for (const endpoint of ENDPOINTS) {
    if (signal?.aborted) {
      errors.push('aborted');
      break;
    }
    try {
      const body = await fetchJson<NfhlResponse>({
        url: `${endpoint.url}?${query}`,
        timeoutMs: PER_ENDPOINT_TIMEOUT_MS,
        ...(signal ? { signal } : {}),
      });
      const zone = parseNfhl(body);
      cache.set(cacheKey, { zone, endpoint: endpoint.id }, nowMs ?? 0);
      return { ...located, zone, endpoint: endpoint.id, ok: true, error: null };
    } catch (error) {
      errors.push(`${endpoint.id}: ${message(error)}`);
    }
  }
  return { ...located, zone: null, endpoint: null, ok: false, error: errors.join('; ') };
}

/**
 * The most hazardous zone among the polygons the point touches (a point on a
 * boundary returns more than one). Throws on an ArcGIS error envelope, which
 * arrives with HTTP 200.
 */
function parseNfhl(body: NfhlResponse): FloodZone | null {
  if (body.error) {
    const msg = typeof body.error.message === 'string' ? body.error.message : 'ArcGIS error';
    throw new Error(`FEMA NFHL: ${msg}`);
  }
  if (!Array.isArray(body.features)) throw new Error('FEMA NFHL: unexpected response');
  let best: FloodZone | null = null;
  for (const feature of body.features) {
    const a = feature.attributes ?? {};
    const zone = typeof a.FLD_ZONE === 'string' ? a.FLD_ZONE.trim().toUpperCase() : '';
    if (NOT_A_ZONE.has(zone)) continue;
    const subtype =
      typeof a.ZONE_SUBTY === 'string' && a.ZONE_SUBTY.trim().length > 0 ? a.ZONE_SUBTY.trim() : null;
    const sfha = a.SFHA_TF === 'T' || a.SFHA_TF === true;
    const candidate: FloodZone = { zone, subtype, sfha };
    if (!best || severity(candidate) > severity(best)) best = candidate;
  }
  return best;
}

/** V (coastal) > A (1 % floodplain) > D (undetermined) > shaded X (0.2 %) > X. */
function severity(z: FloodZone): number {
  if (z.zone.startsWith('V')) return 5;
  if (z.zone.startsWith('A')) return 4;
  if (z.sfha) return 4;
  if (z.zone === 'D') return 3;
  if (z.zone === 'X' && z.subtype !== null && z.subtype.includes('0.2')) return 2;
  return 1;
}

function reasonIfUnavailable(results: readonly LocationResult[]): string | null {
  if (results.length === 0) return 'No locations on this submission';
  if (results.some((r) => r.ok)) return null;
  const errors = [...new Set(results.map((r) => r.error).filter((e): e is string => e !== null))];
  return errors.length === 0 ? 'Flood zone lookup failed' : errors.join('; ');
}

function describe(r: LocationResult): string {
  if (!r.ok) return `Unavailable (${r.error ?? 'lookup failed'})`;
  if (!r.zone) return 'Not mapped by FEMA';
  const parts = [`Zone ${r.zone.zone}`];
  if (r.zone.sfha) parts.push('Special Flood Hazard Area');
  else if (r.zone.subtype) parts.push(r.zone.subtype.toLowerCase());
  return parts.length === 1 ? parts[0]! : `${parts[0]} (${parts[1]})`;
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
