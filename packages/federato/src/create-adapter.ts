/** Adapter selection and the startup banner. Body owned by Run 1 unit F05. */
import type { AdapterKind, FederatoAdapter, FederatoEnv, FederatoSnapshot } from './types';
import { createLiveAdapter } from './live-adapter';
import { createMockAdapter } from './mock/adapter';
import { loadSnapshot } from './snapshot/index';

export interface CreateAdapterOptions {
  /** Supplied by `apps/api/src/env.ts`. No other file reads `process.env`. */
  readonly env: FederatoEnv;
  /** Pre-loaded snapshot for the mock. Loaded from disk when absent. */
  readonly snapshot?: FederatoSnapshot;
  readonly fetchImpl?: typeof fetch;
}

function present(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/** What the live adapter cannot run without. Token URL and audience have defaults (auth.ts). */
function missingLiveSettings(env: FederatoEnv): readonly string[] {
  const missing: string[] = [];
  if (!present(env.baseUrl)) missing.push('FEDERATO_BASE_URL');
  if (!present(env.clientId)) missing.push('FEDERATO_CLIENT_ID');
  if (!present(env.clientSecret)) missing.push('FEDERATO_CLIENT_SECRET');
  return missing;
}

/** Host only — never a path, query string or credential. */
function hostOf(url: string | undefined): string {
  if (!present(url)) return 'unknown host';
  try {
    return new URL(url as string).host || 'unknown host';
  } catch {
    return 'unparseable URL';
  }
}

/** `FEDERATO_BASE_URL` unset (or credentials missing) selects the mock. */
export function selectAdapterKind(env: FederatoEnv): AdapterKind {
  return missingLiveSettings(env).length === 0 ? 'live' : 'mock';
}

/** The loud, never-hidden banner line naming the active adapter (PRD §7.4). */
export function adapterBanner(kind: AdapterKind, env: FederatoEnv): string {
  if (kind === 'live') {
    return `*** FEDERATO: LIVE API (${hostOf(env.baseUrl)}) ***`;
  }
  const missing = missingLiveSettings(env);
  const why =
    missing.length === 0
      ? 'mock forced'
      : missing.includes('FEDERATO_BASE_URL')
        ? 'FEDERATO_BASE_URL is unset'
        : `FEDERATO_BASE_URL is set but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing`;
  return `*** FEDERATO: SNAPSHOT (MockFederatoAdapter) - NOT the live API - ${why} ***`;
}

export function createAdapter(options: CreateAdapterOptions): FederatoAdapter {
  const kind = selectAdapterKind(options.env);
  if (kind === 'live') {
    return createLiveAdapter(
      options.fetchImpl === undefined
        ? { env: options.env }
        : { env: options.env, fetchImpl: options.fetchImpl },
    );
  }
  const snapshot = options.snapshot ?? loadSnapshot();
  return createMockAdapter({ snapshot });
}
