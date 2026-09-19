/**
 * Query results -> one `RawBundle` per submission, ready for engine stage 1.
 * Body owned by Run 1 unit F09.
 */
import type { RawBundle, SchemaDocument } from '@retrofit/engine';
import type { FederatoRecord, TriageSurvivor } from '../types';

export interface ToBundleInput {
  /** Hydrated `Policy` rows from the deep pass, each carrying `submission`. */
  readonly policies: readonly FederatoRecord[];
  /** `Submission` rows from the no-policy follow-up. */
  readonly noPolicySubmissions: readonly FederatoRecord[];
  readonly followUps: readonly FederatoRecord[];
  readonly survivors: readonly TriageSurvivor[];
  readonly schema: SchemaDocument;
  readonly fetchedAt: string;
  /** Trace ids to attach to every bundle, for the console. */
  readonly queryTraceIds: readonly string[];
}

/** Flattens a hydrated policy into the per-resource record map the engine reads. */
export function toBundles(_input: ToBundleInput): readonly RawBundle[] {
  throw new Error('NOT_IMPLEMENTED:F09');
}

/** The external id used everywhere: the submission number, not the policy id. */
export function externalIdOf(_record: FederatoRecord): string {
  throw new Error('NOT_IMPLEMENTED:F09');
}
