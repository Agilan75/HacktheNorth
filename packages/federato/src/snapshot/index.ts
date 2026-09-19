/** Saved snapshot loading and shape checks. Body owned by Run 1 unit F02. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FederatoRecord, FederatoResource, FederatoSnapshot } from '../types';

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

/** File name of the snapshot inside the snapshot directory. */
const SNAPSHOT_FILE = 'snapshot.json';

/** Stable resource order, taken from `EXPECTED_COUNTS`, so saved files diff cleanly. */
const RESOURCES = Object.keys(EXPECTED_COUNTS) as FederatoResource[];

/**
 * Repo root, located from this module rather than `process.cwd()`, because the
 * npm script runs from `packages/federato` and the API from the repo root.
 * `src/snapshot/index.ts` (and `dist/snapshot/index.js`) sit four levels deep.
 */
function repoRoot(): string {
  return fileURLToPath(new URL('../../../../', import.meta.url));
}

/** Resolves a snapshot directory; relative paths are repo-relative, like `SNAPSHOT_DIR`. */
function resolveDir(dir?: string): string {
  const d = dir ?? SNAPSHOT_DIR;
  return isAbsolute(d) ? d : resolve(repoRoot(), d);
}

export function snapshotPath(dir?: string): string {
  return join(resolveDir(dir), SNAPSHOT_FILE);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** Shape-checks parsed JSON as a `FederatoSnapshot`. Never trusts `counts` over `records`. */
function parseSnapshot(raw: unknown, source: string): FederatoSnapshot {
  if (!isPlainObject(raw)) throw new SnapshotError(`${source}: snapshot is not a JSON object.`);
  const { fetchedAt, schema, records, counts } = raw;
  if (typeof fetchedAt !== 'string' || fetchedAt.length === 0) {
    throw new SnapshotError(`${source}: missing fetchedAt.`);
  }
  if (!isPlainObject(schema) || !Array.isArray(schema.resources)) {
    throw new SnapshotError(`${source}: schema.resources is missing.`);
  }
  if (!isPlainObject(records)) throw new SnapshotError(`${source}: records is missing.`);
  const outRecords = {} as Record<FederatoResource, readonly FederatoRecord[]>;
  const outCounts = {} as Record<FederatoResource, number>;
  for (const resource of RESOURCES) {
    const rows = records[resource];
    if (!Array.isArray(rows)) {
      throw new SnapshotError(`${source}: records.${resource} is missing.`);
    }
    if (!rows.every(isPlainObject)) {
      throw new SnapshotError(`${source}: records.${resource} holds a non-object row.`);
    }
    outRecords[resource] = rows as FederatoRecord[];
    const declared = isPlainObject(counts) ? counts[resource] : undefined;
    if (typeof declared === 'number' && declared !== rows.length) {
      throw new SnapshotError(
        `${source}: counts.${resource} says ${declared} but records.${resource} holds ${rows.length}.`,
      );
    }
    outCounts[resource] = rows.length;
  }
  return {
    fetchedAt,
    schema: schema as unknown as FederatoSnapshot['schema'],
    records: outRecords,
    counts: outCounts,
  };
}

export function loadSnapshot(dir?: string): FederatoSnapshot {
  const path = snapshotPath(dir);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new SnapshotError(
      `No Federato snapshot at ${path} (${msg}). Run \`npm run federato:snapshot\` with live credentials.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new SnapshotError(`${path}: not valid JSON (${msg}).`);
  }
  return parseSnapshot(parsed, path);
}

/**
 * Serialises with one record per line: small enough to commit, and a refresh
 * that changes one record shows up as a one-line diff.
 */
function serialise(snapshot: FederatoSnapshot): string {
  const lines: string[] = ['{'];
  lines.push(`  "fetchedAt": ${JSON.stringify(snapshot.fetchedAt)},`);
  const counts: Record<string, number> = {};
  for (const r of RESOURCES) counts[r] = snapshot.records[r]?.length ?? 0;
  lines.push(`  "counts": ${JSON.stringify(counts)},`);
  lines.push(`  "schema": ${JSON.stringify(snapshot.schema)},`);
  lines.push('  "records": {');
  RESOURCES.forEach((r, i) => {
    const rows = snapshot.records[r] ?? [];
    const tail = i === RESOURCES.length - 1 ? '' : ',';
    if (rows.length === 0) {
      lines.push(`    ${JSON.stringify(r)}: []${tail}`);
      return;
    }
    lines.push(`    ${JSON.stringify(r)}: [`);
    rows.forEach((row, j) => {
      lines.push(`      ${JSON.stringify(row)}${j === rows.length - 1 ? '' : ','}`);
    });
    lines.push(`    ]${tail}`);
  });
  lines.push('  }');
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

export function saveSnapshot(snapshot: FederatoSnapshot, dir?: string): void {
  const path = snapshotPath(dir);
  // Round-trip the shape check first, so a malformed snapshot never lands on disk.
  const text = serialise(snapshot);
  parseSnapshot(JSON.parse(text) as unknown, path);
  mkdirSync(dirname(path), { recursive: true });
  // Write-then-rename: a crash mid-write never leaves a truncated snapshot.
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, path);
}

/** Returns the resources whose record count does not match `EXPECTED_COUNTS`. */
export function verifySnapshotCounts(
  snapshot: FederatoSnapshot,
): readonly { resource: FederatoResource; expected: number; actual: number }[] {
  const out: { resource: FederatoResource; expected: number; actual: number }[] = [];
  for (const resource of RESOURCES) {
    const expected = EXPECTED_COUNTS[resource];
    // The records are the truth; a stale `counts` field cannot mask a short pull.
    const actual = snapshot.records[resource]?.length ?? 0;
    if (actual !== expected) out.push({ resource, expected, actual });
  }
  return out;
}
