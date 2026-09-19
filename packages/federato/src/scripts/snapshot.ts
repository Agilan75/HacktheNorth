/**
 * `npm run federato:snapshot` — the ONLY live Federato caller in the build.
 * Body owned by Run 1 unit F02.
 */
import type { FederatoSnapshot } from '../types';

/** Pulls all 12 resources plus the hydrated Policy query and writes the file. */
export function refreshSnapshot(): Promise<FederatoSnapshot> {
  throw new Error('NOT_IMPLEMENTED:F02');
}

export function main(): Promise<void> {
  throw new Error('NOT_IMPLEMENTED:F02');
}
