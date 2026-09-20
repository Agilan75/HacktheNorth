/**
 * `Deps` — everything a service or a route handler is allowed to reach.
 * FROZEN after Run 0 (W0-3).
 *
 * Handlers are thin (PRD §8): they parse, call a service with `Deps`, and
 * serialize. Nothing in `apps/api` constructs a database, an adapter, a
 * provider or a clock on its own — it receives them here, which is what makes
 * every route test an in-process `app.request()` against `:memory:`.
 */

import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type { FederatoAdapter } from '@retrofit/federato';
import type { Schema } from '../db/schema';
import type { LlmProvider } from '../llm/types';

/**
 * The Drizzle handle. Synchronous, because both drivers are: `better-sqlite3`
 * and, if it has to be used, `node:sqlite` behind a sync proxy in
 * `db/client.ts`. No other file knows which one is underneath.
 */
export type Db = BaseSQLiteDatabase<'sync', unknown, Schema>;

/**
 * The only clock in the system. `packages/engine` never reads time at all; the
 * API reads it here and nowhere else, so every test can freeze it.
 */
export interface Clock {
  /** Milliseconds since the epoch. */
  nowMs(): number;
  /** ISO-8601, the format every stored timestamp uses. */
  nowIso(): string;
  /** `YYYY-MM-DD`, the `asOf` the engine takes. */
  today(): string;
}

export interface Deps {
  readonly db: Db;
  readonly adapter: FederatoAdapter;
  readonly llm: LlmProvider;
  readonly clock: Clock;
}

/** A frozen clock for tests. Deterministic by construction. */
export function fixedClock(iso: string): Clock {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`fixedClock: not an ISO timestamp: ${iso}`);
  const isoNormalized = new Date(ms).toISOString();
  return {
    nowMs: () => ms,
    nowIso: () => isoNormalized,
    today: () => isoNormalized.slice(0, 10),
  };
}

/** The real clock. Constructed once, in `index.ts`. */
export function systemClock(): Clock {
  return {
    nowMs: () => Date.now(),
    nowIso: () => new Date().toISOString(),
    today: () => new Date().toISOString().slice(0, 10),
  };
}
