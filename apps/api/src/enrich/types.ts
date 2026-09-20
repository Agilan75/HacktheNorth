/**
 * The enrichment plugin contract (PRD §8). FROZEN after Run 0 (W0-3).
 *
 * Two plugins ship: flood zone (OpenFEMA) and fire-station distance
 * (Overpass), with Nominatim geocoding only when a location has no
 * coordinates. Each has a 6 s timeout and a per-source cache, and a failure
 * produces an "unavailable" card rather than an error.
 *
 * A plugin that cannot move a score, the premium, or raise a contradiction is
 * cut — so every plugin here declares which canonical paths it writes.
 */

import type { ExternalValue } from '@retrofit/engine';
import type { EnrichmentCardDto } from '@retrofit/contracts';

/** Every plugin gets a 6 s budget (PRD §8). */
export const ENRICH_TIMEOUT_MS = 6_000;

export interface EnrichLocation {
  readonly externalId: string;
  readonly address: string | null;
  readonly city: string | null;
  readonly state: string | null;
  readonly zip: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
}

export interface EnrichContext {
  readonly submissionId: string;
  readonly locations: readonly EnrichLocation[];
  /** ISO-8601, from the injected clock. Plugins never read the clock. */
  readonly nowIso: string;
  readonly signal?: AbortSignal;
}

export interface EnrichOutcome {
  readonly source: string;
  readonly available: boolean;
  readonly unavailableReason: string | null;
  /** Merged into the submission with `enrichment` provenance. */
  readonly values: readonly ExternalValue[];
  readonly card: EnrichmentCardDto;
  /** The plugin's raw response, stored for the audit trail. */
  readonly raw: Readonly<Record<string, unknown>>;
  readonly durationMs: number;
}

export interface EnrichPlugin {
  /** `openfema_flood`, `overpass_fire_station`. */
  readonly source: string;
  readonly title: string;
  readonly attribution: string;
  /** Canonical paths this plugin can write. Empty means it would be cut. */
  readonly writes: readonly string[];
  run(context: EnrichContext): Promise<EnrichOutcome>;
}

export interface EnrichCacheEntry {
  readonly key: string;
  readonly value: unknown;
  readonly storedAtMs: number;
}

export interface EnrichCache {
  get(key: string): EnrichCacheEntry | undefined;
  set(key: string, value: unknown, nowMs: number): void;
  clear(): void;
}
