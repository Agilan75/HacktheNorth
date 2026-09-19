/**
 * `npm run federato:snapshot` — the ONLY live Federato caller in the build.
 * Body owned by Run 1 unit F02.
 *
 * Pulls every record of all 12 resources plus the verified deep hydrated
 * `Policy` query, asserts the counts in LIVE_DATA_FACTS.md, and only then
 * writes `packages/federato/snapshot/`. A short or wrong pull never overwrites
 * a good snapshot.
 */
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createLiveAdapter } from '../live-adapter';
import { EXPECTED_COUNTS, saveSnapshot, snapshotPath, verifySnapshotCounts } from '../snapshot/index';
import type {
  FederatoAdapter,
  FederatoEnv,
  FederatoRecord,
  FederatoResource,
  FederatoSnapshot,
  QueryPayload,
} from '../types';

/** Rows per page. Larger than every resource but ExposureUnit, which pages. */
const PAGE_LIMIT = 500;
/** Hard stop so a handler that ignores `offset` can never loop forever. */
const MAX_PAGES = 50;

/** The deep pass, verbatim from LIVE_DATA_FACTS.md ("works in one call"). */
export const HYDRATED_POLICY_QUERY: QueryPayload = {
  resource: 'Policy',
  where: { line_of_business: 'property' },
  expand: {
    insured: true,
    submission: true,
    claims: true,
    exposure_units: { location: { buildings: true } },
  },
  pagination: { limit: 200 },
};

/** LIVE_DATA_FACTS: all 27 property policies come back hydrated. */
const EXPECTED_HYDRATED_PROPERTY_POLICIES = 27;

/** Written beside `snapshot.json`. */
export const HYDRATED_POLICY_FILE = 'policy-property-hydrated.json';

export interface HydratedPolicySnapshot {
  readonly fetchedAt: string;
  readonly payload: QueryPayload;
  readonly total: number;
  readonly results: readonly FederatoRecord[];
}

export interface BuiltSnapshot {
  readonly snapshot: FederatoSnapshot;
  readonly hydrated: HydratedPolicySnapshot;
}

export interface BuildSnapshotOptions {
  readonly adapter: FederatoAdapter;
  /** ISO timestamp source. Injected so tests are deterministic. */
  readonly now?: () => string;
  readonly expectedCounts?: Readonly<Record<FederatoResource, number>>;
  readonly expectedHydrated?: number;
  /** Progress lines. Never receives a credential. */
  readonly log?: (line: string) => void;
}

class SnapshotAssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotAssertionError';
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function recordKey(row: FederatoRecord): string {
  return row.id === undefined || row.id === null ? JSON.stringify(row) : String(row.id);
}

/** Every record of one resource, paging with limit/offset, deduplicated by id. */
async function pullResource(
  adapter: FederatoAdapter,
  resource: FederatoResource,
): Promise<readonly FederatoRecord[]> {
  const seen = new Map<string, FederatoRecord>();
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const res = await adapter.query({ resource, pagination: { limit: PAGE_LIMIT, offset } });
    if (res.results.length === 0) break;
    let added = 0;
    for (const row of res.results) {
      const key = recordKey(row);
      if (!seen.has(key)) {
        seen.set(key, row);
        added += 1;
      }
    }
    if (added === 0) {
      throw new SnapshotAssertionError(
        `${resource}: page ${page + 1} returned no new records; the handler appears to ignore offset.`,
      );
    }
    offset += res.results.length;
    // `total` is the server's full count (it falls back to the page length when
    // absent, in which case a short pull is caught by the count assertion).
    // Continuing on a short page also survives a server-side cap below PAGE_LIMIT.
    if (seen.size >= res.total) break;
  }
  const rows = [...seen.values()];
  // Deterministic order so refreshes diff cleanly.
  rows.sort((a, b) => {
    const x = a.id;
    const y = b.id;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return String(x).localeCompare(String(y));
  });
  return rows;
}

function hasHydratedBuilding(policy: FederatoRecord): boolean {
  const units = policy.exposure_units;
  if (!Array.isArray(units)) return false;
  return units.some((u: unknown) => {
    if (!isPlainObject(u)) return false;
    const loc = u.location;
    if (!isPlainObject(loc)) return false;
    return Array.isArray(loc.buildings) && loc.buildings.some(isPlainObject);
  });
}

/** Checks the deep pass really hydrated: objects, not ids, all the way down. */
function checkHydrated(results: readonly FederatoRecord[], expected: number): string[] {
  const problems: string[] = [];
  if (results.length !== expected) {
    problems.push(`hydrated Policy query: expected ${expected} property policies, got ${results.length}`);
  }
  results.forEach((p) => {
    const id = String(p.id);
    if (!isPlainObject(p.insured)) problems.push(`policy ${id}: insured not hydrated`);
    if (!isPlainObject(p.submission)) problems.push(`policy ${id}: submission not hydrated`);
    if (!hasHydratedBuilding(p)) problems.push(`policy ${id}: no hydrated building under exposure_units.location`);
    if (typeof p.premium !== 'number') problems.push(`policy ${id}: no premium`);
  });
  return problems;
}

/**
 * Pulls and asserts; writes nothing. Throws, listing every mismatch, when a
 * count or the hydration check disagrees with LIVE_DATA_FACTS.md.
 */
export async function buildSnapshot(options: BuildSnapshotOptions): Promise<BuiltSnapshot> {
  const { adapter } = options;
  const now = options.now ?? (() => new Date().toISOString());
  const expectedCounts = options.expectedCounts ?? EXPECTED_COUNTS;
  const expectedHydrated = options.expectedHydrated ?? EXPECTED_HYDRATED_PROPERTY_POLICIES;
  const log = options.log ?? (() => undefined);
  const resources = Object.keys(expectedCounts) as FederatoResource[];

  const fetchedAt = now();
  const schema = await adapter.getSchema();
  log(`schema: ${schema.resources.length} resources`);

  const records = {} as Record<FederatoResource, readonly FederatoRecord[]>;
  const counts = {} as Record<FederatoResource, number>;
  // Sequential on purpose: one caller, gentle on a shared hackathon API.
  for (const resource of resources) {
    const rows = await pullResource(adapter, resource);
    records[resource] = rows;
    counts[resource] = rows.length;
    log(`${resource}: ${rows.length} (expected ${expectedCounts[resource]})`);
  }
  const snapshot: FederatoSnapshot = { fetchedAt, schema: { ...schema, fetchedAt }, records, counts };

  const deep = await adapter.query(HYDRATED_POLICY_QUERY);
  log(`hydrated Policy (property): ${deep.results.length}`);
  const hydrated: HydratedPolicySnapshot = {
    fetchedAt,
    payload: HYDRATED_POLICY_QUERY,
    total: deep.total,
    results: deep.results,
  };

  const problems: string[] = [];
  const schemaNames = new Set(schema.resources.map((r) => r.name));
  for (const resource of resources) {
    if (!schemaNames.has(resource)) problems.push(`schema: resource ${resource} missing`);
    const actual = records[resource].length;
    if (actual !== expectedCounts[resource]) {
      problems.push(`${resource}: expected ${expectedCounts[resource]}, got ${actual}`);
    }
  }
  if (expectedCounts === EXPECTED_COUNTS) {
    // Belt and braces: the exported checker must agree with the loop above.
    for (const m of verifySnapshotCounts(snapshot)) {
      const line = `${m.resource}: expected ${m.expected}, got ${m.actual}`;
      if (!problems.includes(line)) problems.push(line);
    }
  }
  problems.push(...checkHydrated(deep.results, expectedHydrated));
  if (problems.length > 0) {
    throw new SnapshotAssertionError(
      `Federato snapshot does not match LIVE_DATA_FACTS.md; nothing written.\n  - ${problems.join('\n  - ')}`,
    );
  }
  return { snapshot, hydrated };
}

function saveHydrated(hydrated: HydratedPolicySnapshot, dir: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, HYDRATED_POLICY_FILE);
  const body = [
    '{',
    `  "fetchedAt": ${JSON.stringify(hydrated.fetchedAt)},`,
    `  "payload": ${JSON.stringify(hydrated.payload)},`,
    `  "total": ${hydrated.total},`,
    '  "results": [',
    hydrated.results.map((r) => `    ${JSON.stringify(r)}`).join(',\n'),
    '  ]',
    '}',
  ].join('\n');
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${body}\n`, 'utf8');
  renameSync(tmp, path);
  return path;
}

interface ApiEnvModule {
  readonly loadEnv: () => unknown;
  readonly federatoEnv: (env: never) => FederatoEnv;
}

/**
 * Credentials come through `apps/api/src/env.ts`, the one file allowed to read
 * `process.env`. Imported by path at run time because a package may not
 * statically depend on an app.
 */
async function readFederatoEnv(): Promise<FederatoEnv> {
  const envPath = fileURLToPath(new URL('../../../../apps/api/src/env.ts', import.meta.url));
  const mod = (await import(pathToFileURL(envPath).href)) as ApiEnvModule;
  const env = mod.federatoEnv(mod.loadEnv() as never);
  if (!env.clientId || !env.clientSecret) {
    throw new Error(
      'FEDERATO_CLIENT_ID / FEDERATO_CLIENT_SECRET are not set; the snapshot needs live credentials.',
    );
  }
  return env;
}

/** Pulls all 12 resources plus the hydrated Policy query and writes the file. */
export async function refreshSnapshot(): Promise<FederatoSnapshot> {
  const env = await readFederatoEnv();
  const adapter = createLiveAdapter({ env });
  const { snapshot, hydrated } = await buildSnapshot({
    adapter,
    log: (line) => console.log(`[federato:snapshot] ${line}`),
  });
  saveSnapshot(snapshot);
  const hydratedPath = saveHydrated(hydrated, dirname(snapshotPath()));
  console.log(`[federato:snapshot] wrote ${snapshotPath()}`);
  console.log(`[federato:snapshot] wrote ${hydratedPath}`);
  return snapshot;
}

export async function main(): Promise<void> {
  try {
    const snap = await refreshSnapshot();
    const total = Object.values(snap.counts).reduce((a, b) => a + b, 0);
    console.log(`[federato:snapshot] OK: ${total} records across 12 resources, fetched ${snap.fetchedAt}`);
  } catch (err) {
    console.error(`[federato:snapshot] FAILED: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) void main();
