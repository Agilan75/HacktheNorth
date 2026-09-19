/** Adapter selection and the startup banner. Body owned by Run 1 unit F05. */
import type { AdapterKind, FederatoAdapter, FederatoEnv, FederatoSnapshot } from './types';

export interface CreateAdapterOptions {
  /** Supplied by `apps/api/src/env.ts`. No other file reads `process.env`. */
  readonly env: FederatoEnv;
  /** Pre-loaded snapshot for the mock. Loaded from disk when absent. */
  readonly snapshot?: FederatoSnapshot;
  readonly fetchImpl?: typeof fetch;
}

/** `FEDERATO_BASE_URL` unset (or credentials missing) selects the mock. */
export function selectAdapterKind(_env: FederatoEnv): AdapterKind {
  throw new Error('NOT_IMPLEMENTED:F05');
}

/** The loud, never-hidden banner line naming the active adapter (PRD §7.4). */
export function adapterBanner(_kind: AdapterKind, _env: FederatoEnv): string {
  throw new Error('NOT_IMPLEMENTED:F05');
}

export function createAdapter(_options: CreateAdapterOptions): FederatoAdapter {
  throw new Error('NOT_IMPLEMENTED:F05');
}
