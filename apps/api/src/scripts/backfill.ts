/**
 * `npm run backfill`: apply the hand-authored values in `apps/api/data/backfill/`
 * to the property submissions Federato holds no Policy for (no buildings, no
 * locations, no pricing), then re-score the book and route them.
 *
 * Every value but one is read from `packages/federato/snapshot/snapshot.json`:
 * the submission's insured, its headquarters location, that location's
 * buildings, and the claims on the insured's other policies. Federato returns
 * none of it for these eleven submissions, because the query reaches buildings
 * through a Policy record they do not have. The premium is the one figure with
 * no source; each file's `rationale` says how it was derived. No LLM API is
 * called, here or at runtime. Every value lands with `answer` provenance and
 * `sourceDetail: 'synthetic:backfill-v1'`, so the console labels it synthetic;
 * the engine still does all the arithmetic (appetite, verdict, adequacy).
 *
 * Idempotent: an account whose canonical already carries a synthetic value is
 * skipped. A `seed --force` rebuilds canonical from Federato, and the next
 * backfill re-applies. Broker-request drafts use the code template (no keys).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { CanonicalSubmission, ExternalValue, Provenance } from '@retrofit/engine';
import { merge } from '@retrofit/engine';
import { createAdapter } from '@retrofit/federato';
import { federatoEnv, getEnv } from '../env';
import { createDb } from '../db/client';
import { migrate } from '../db/migrate';
import { createRepos } from '../db/repos';
import { createAppLlm } from '../llm/index';
import { planActions } from '../services/actions';
import { rescoreBook } from '../services/rescore';
import { systemClock } from '../services/types';
import type { Deps } from '../services/types';

export const SYNTHETIC_DETAIL = 'synthetic:backfill-v1';

const DEFAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../data/backfill');

/** The merge grammar's writable paths this backfill may use (merge.ts, path grammar). */
const PATH_TYPES: Readonly<Record<string, z.ZodType>> = {
  submissionType: z.enum(['new_business', 'renewal']),
  'locations.*.state': z.string().regex(/^[A-Z]{2}$/),
  'locations.*.city': z.string().min(1),
  'locations.*.postalCode': z.string().min(3),
  'locations.*.protectionClass': z.number().int().min(1).max(10),
  'locations.*.fireStationDistanceKm': z.number().min(0).max(100),
  'locations.*.floodZone': z.string().min(1),
  'buildings.*.tiv': z.number().positive(),
  'buildings.*.yearBuilt': z.number().int().min(1800).max(2026),
  'buildings.*.constructionType': z.enum([
    'frame',
    'joisted_masonry',
    'non_combustible',
    'masonry_non_combustible',
    'steel',
    'modified_fire_resistive',
    'fire_resistive',
  ]),
  'buildings.*.sprinklered': z.boolean(),
  'buildings.*.stories': z.number().int().min(1).max(120),
  'buildings.*.roofYear': z.number().int().min(1900).max(2026),
  'buildings.*.occupancy': z.string().min(1),
  'buildings.*.protectionClass': z.number().int().min(1).max(10),
  'pricing.quotedPremium': z.number().positive(),
  'rollup.totalTiv': z.number().positive(),
  'rollup.fiveYearLoss': z.number().min(0),
};

const BackfillFile = z.object({
  externalId: z.string().regex(/^SUB-\d{4}-\d{5}$/),
  targetVerdict: z.enum(['FIT', 'REFER', 'DOES_NOT_FIT']).optional(),
  rationale: z.string().optional(),
  values: z
    .array(z.object({ canonicalPath: z.string(), value: z.unknown() }))
    .min(1),
});
export type BackfillFile = z.infer<typeof BackfillFile>;

/** Parse and check one file; throws with every problem named. */
export function parseBackfill(raw: unknown, name = 'backfill'): BackfillFile {
  const file = BackfillFile.parse(raw);
  const problems: string[] = [];
  for (const v of file.values) {
    const type = PATH_TYPES[v.canonicalPath];
    if (type === undefined) {
      problems.push(`${v.canonicalPath}: not a backfill path`);
      continue;
    }
    const checked = type.safeParse(v.value);
    if (!checked.success) problems.push(`${v.canonicalPath}: ${checked.error.issues[0]?.message ?? 'invalid'}`);
  }
  if (problems.length > 0) throw new Error(`${name} (${file.externalId}): ${problems.join('; ')}`);
  return file;
}

export function toExternalValues(file: BackfillFile, observedAt: string): ExternalValue[] {
  const provenance: Provenance = { source: 'answer', sourceDetail: SYNTHETIC_DETAIL, observedAt };
  return file.values.map((v) => ({ canonicalPath: v.canonicalPath, value: v.value, provenance }));
}

/** True when any field anywhere in the canonical record carries the synthetic tag. */
export function hasSynthetic(canonical: CanonicalSubmission): boolean {
  return JSON.stringify(canonical).includes(`"sourceDetail":"${SYNTHETIC_DETAIL}"`);
}

export function readBackfillDir(dir: string): BackfillFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => parseBackfill(JSON.parse(readFileSync(join(dir, f), 'utf8')) as unknown, f));
}

export interface BackfillSummary {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
  readonly missing: readonly string[];
}

/** Apply every file over injected `Deps`; `main` only builds the real ones. */
export async function runBackfill(
  deps: Deps,
  files: readonly BackfillFile[],
  log: (line: string) => void = (l) => console.log(l),
): Promise<BackfillSummary> {
  const repos = createRepos(deps.db);
  const nowIso = deps.clock.nowIso();
  const applied: string[] = [];
  const skipped: string[] = [];
  const missing: string[] = [];

  for (const file of files) {
    const row = repos.submissions.byExternalId(file.externalId);
    if (row === null || row.canonical === null || row.canonical === undefined) {
      missing.push(file.externalId);
      continue;
    }
    if (hasSynthetic(row.canonical)) {
      skipped.push(file.externalId);
      continue;
    }
    const merged = merge(row.canonical, [], [], toExternalValues(file, deps.clock.today()));
    repos.submissions.update(row.id, { canonical: merged, updatedAt: nowIso });
    // The open broker request asked for the fields just supplied. Close it;
    // `planActions` below drafts a fresh one if anything is still missing.
    for (const draft of repos.actions.list({ submissionId: row.id, type: 'request' }).rows) {
      if (draft.status !== 'draft') continue;
      repos.actions.update(draft.id, {
        status: 'applied',
        payload: { ...draft.payload, note: 'Superseded: synthetic backfill supplied these fields.' },
      });
    }
    applied.push(file.externalId);
  }
  log(`Backfill: ${applied.length} applied, ${skipped.length} already applied, ${missing.length} not in the database.`);
  if (missing.length > 0) log(`  missing: ${missing.join(', ')}`);

  if (applied.length > 0) {
    log('Re-scoring the book...');
    log(`  ${await rescoreBook(deps)} scored`);
    const plan = await planActions(deps, { externalIds: applied });
    log(`  ${plan.routed} routed, ${plan.needsSeniorReferral} need senior referral, ${plan.drafted} request drafts`);
  }
  return { applied, skipped, missing };
}

/** `npm run backfill [dir]`. */
export async function main(): Promise<void> {
  const env = getEnv();
  const dir = process.argv[2] ?? DEFAULT_DIR;
  const files = readBackfillDir(dir);
  const handle = createDb({ url: env.DATABASE_URL });
  try {
    migrate(handle);
    const deps: Deps = {
      db: handle.db,
      adapter: createAdapter({ env: federatoEnv(env) }),
      // No keys: broker-request drafts fall back to the code template. No API calls.
      llm: createAppLlm({ geminiApiKey: undefined, anthropicApiKey: undefined }),
      clock: systemClock(),
    };
    await runBackfill(deps, files);
  } finally {
    handle.close();
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
