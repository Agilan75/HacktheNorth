/** Saved snapshot loading and shape checks. Body owned by Run 1 unit F02. */
import type { FederatoResource, FederatoSnapshot } from '../types';

/** Repo-relative directory holding the saved snapshot JSON. */
export const SNAPSHOT_DIR = 'packages/federato/snapshot';

/**
 * The counts F02 asserts against the live API (LIVE_DATA_FACTS.md).
 * A snapshot that does not match these is not the real dataset.
 */
export const EXPECTED_COUNTS: Readonly<Record<FederatoResource, number>> = {
  Submission: 158,
  Policy: 113,
  Claim: 179,
  Building: 129,
  Location: 70,
  ExposureUnit: 938,
  Coverage: 366,
  Endorsement: 253,
  Insured: 30,
  Contact: 14,
  Underwriter: 8,
  Broker: 6,
};

export function snapshotPath(_dir?: string): string {
  throw new Error('NOT_IMPLEMENTED:F02');
}

export function loadSnapshot(_dir?: string): FederatoSnapshot {
  throw new Error('NOT_IMPLEMENTED:F02');
}

export function saveSnapshot(_snapshot: FederatoSnapshot, _dir?: string): void {
  throw new Error('NOT_IMPLEMENTED:F02');
}

/** Returns the resources whose record count does not match `EXPECTED_COUNTS`. */
export function verifySnapshotCounts(
  _snapshot: FederatoSnapshot,
): readonly { resource: FederatoResource; expected: number; actual: number }[] {
  throw new Error('NOT_IMPLEMENTED:F02');
}
