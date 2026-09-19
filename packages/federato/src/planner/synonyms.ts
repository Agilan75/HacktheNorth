/**
 * The synonym table — the ONLY place Federato field names appear in Retrofit.
 * Every `schemaPath` must exist in `docs/federato/live-schema.json` (F07 tests
 * exactly that). Body owned by Run 1 unit F07.
 */
import type { FederatoResource, SynonymEntry } from '../types';

export function synonymTable(): readonly SynonymEntry[] {
  throw new Error('NOT_IMPLEMENTED:F07');
}

/** Exact or normalized match on a canonical path. Null when unknown. */
export function lookupSynonym(_canonicalPath: string): SynonymEntry | null {
  throw new Error('NOT_IMPLEMENTED:F07');
}

/** Reverse direction: which canonical path a raw schema path maps to. */
export function reverseSynonym(
  _resource: FederatoResource,
  _schemaPath: string,
): SynonymEntry | null {
  throw new Error('NOT_IMPLEMENTED:F07');
}
