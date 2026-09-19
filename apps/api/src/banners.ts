/**
 * The startup banners. They are never hidden: which adapter is live, whether
 * Gemini is configured, which driver SQLite is using. Unit A10.
 *
 * Only booleans and names are printed, never a credential (env.ts describeEnv).
 */
import { adapterBanner } from '@retrofit/federato';
import type { AdapterKind, FederatoEnv } from '@retrofit/federato';
import type { Deps } from './services/types';
import { federatoEnv, getEnv } from './env';
import { DRIVER_NODE_SQLITE } from './db/client';

export interface BannerInput {
  readonly deps: Deps;
  readonly driver: string;
  readonly port: number;
  readonly version: string;
}

/** F05 owns the adapter wording; this is the fallback if it cannot answer. */
function adapterLine(kind: AdapterKind): string {
  let env: FederatoEnv = {};
  try {
    env = federatoEnv(getEnv());
  } catch {
    /* a malformed env must not hide the banner */
  }
  try {
    const line = adapterBanner(kind, env);
    if (typeof line === 'string' && line.trim().length > 0) return line;
  } catch {
    /* fall through to the local wording */
  }
  return kind === 'live'
    ? '*** FEDERATO: LIVE API ***'
    : '*** FEDERATO: SNAPSHOT (MockFederatoAdapter) - not the live API ***';
}

function llmLine(deps: Deps): string {
  if (deps.llm.configured) return `Gemini: configured (provider ${deps.llm.name})`;
  return (
    `Gemini: NOT CONFIGURED (provider ${deps.llm.name}) - GEMINI_API_KEY is unset; ` +
    'LLM calls degrade and the seeded sweep is served'
  );
}

function driverLine(driver: string): string {
  if (driver === DRIVER_NODE_SQLITE) {
    return `SQLite driver: ${driver} (fallback - better-sqlite3 native binding failed to load)`;
  }
  return `SQLite driver: ${driver}`;
}

export function startupBanner(input: BannerInput): readonly string[] {
  const { deps, driver, port, version } = input;
  return [
    `Retrofit API v${version} listening on http://localhost:${port}`,
    adapterLine(deps.adapter.kind),
    llmLine(deps),
    driverLine(driver),
    `Started ${deps.clock.nowIso()}`,
  ];
}
