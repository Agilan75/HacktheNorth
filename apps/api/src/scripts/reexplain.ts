/**
 * `reexplain`: re-derive the stored explanation text for every scored
 * submission, in place, from what is already in the database.
 *
 * Why it exists: `result.explanation` is the deterministic template text
 * (PRD §7.7) frozen at the moment the row was scored. When the template
 * changes — a new sentence, different wording — every stored explanation goes
 * stale, and the only way to refresh them today is a full re-score, which
 * re-ingests the Federato book over the network and re-runs the engine. This
 * script does neither. It reads each row's stored `result`, hands it straight
 * back to `explain()` from `@retrofit/federato`, and writes only the returned
 * `text` into `result.explanation`. No network, no engine, no LLM.
 *
 * Safety, in the order it matters:
 *
 * 1. Dry run by default. `--write` is the only way to touch the file.
 * 2. `--write` checkpoints the WAL and copies the database to a timestamped
 *    backup beside it before the first write, and prints the path.
 * 3. Every row is re-derived and checked before anything is written; one bad
 *    row aborts the whole run with nothing changed.
 * 4. The writes go out in a single transaction.
 * 5. `assertOnlyExplanationChanged` proves, per row, that the new blob differs
 *    from the old one in the `explanation` key and nowhere else — same keys,
 *    same order, every sibling byte-identical. No other column is ever named
 *    in the UPDATE, so `raw`, `canonical`, `facts`, `query_trace`, `rank` and
 *    `updated_at` cannot move.
 *
 * Decision (AGENTS.md §8) — the queue rank is NOT passed by default.
 * `explain()` will prepend ", ranked #N in the queue" to the headline when it
 * is given a rank, and `services/rescore.ts` deliberately omits it so the
 * stored text never goes stale when another account moves. Passing it here
 * would make every one of the 158 rows differ, and the next `rescore` would
 * silently strip it again. `--rank` opts in for a one-off; the default matches
 * what the rest of the pipeline stores. Rejected alternative: always pass the
 * rank, matching the `GET /submissions/:id` route — but that route composes the
 * text per request and stores nothing.
 *
 * Usage (there is no npm script; `--import tsx`, as every other script here):
 *   node --env-file-if-exists=.env --import tsx \
 *     apps/api/src/scripts/reexplain.ts [--write] [--rank] [--db <path>]
 */
import { copyFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { sql } from 'drizzle-orm';
import { explain } from '@retrofit/federato';
import type { ExplainInput } from '@retrofit/federato';
import type { EngineResult } from '@retrofit/engine';
import { getEnv } from '../env';
import { createDb } from '../db/client';
import type { Db } from '../services/types';

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/** The only part of `Explanation` this script stores. */
export interface ExplainedText {
  readonly text: string;
}

export interface ReexplainOptions {
  /** Write the rows back. Anything else is a dry run that touches nothing. */
  readonly write?: boolean;
  /** The database file to back up before writing. Null (or `:memory:`) skips the copy. */
  readonly dbPath?: string | null;
  /** Pass each row's queue rank to `explain()`. Off by default; see the header. */
  readonly includeRank?: boolean;
  readonly log?: (line: string) => void;
  /** Injected for tests; production always uses `@retrofit/federato`'s `explain`. */
  readonly explainFn?: (input: ExplainInput) => ExplainedText;
  /** How many before/after diffs to print. */
  readonly diffCount?: number;
}

export interface ReexplainChange {
  readonly id: string;
  readonly before: string | null;
  readonly after: string;
}

export interface ReexplainSummary {
  readonly scanned: number;
  readonly changed: number;
  readonly unchanged: number;
  readonly written: number;
  readonly backupPath: string | null;
  /** How many explanations mention a contradiction after the run. */
  readonly mentioningContradiction: number;
  readonly changes: readonly ReexplainChange[];
}

/** One row, read as raw text so nothing is re-serialised on the way in. */
interface RawRow {
  readonly id: string;
  readonly rank: number | null;
  readonly insuredName: string | null;
  readonly result: string | null;
}

/* -------------------------------------------------------------------------- */
/* Private helpers (kept local per AGENTS.md §7)                              */
/* -------------------------------------------------------------------------- */

/**
 * Anything that mentions a contradiction, however the template words it. The
 * template says "the open conflict on X", "N other open contradictions are
 * recorded" and "conflicting values on X"; in this wording "conflict" is only
 * ever a contradiction.
 */
const CONTRADICTION_RE = /contradict|conflict/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(id: string, reason: string, cause?: unknown): never {
  throw new Error(`reexplain: submission ${id}: ${reason}`, cause === undefined ? undefined : { cause });
}

/**
 * Proves the rewrite touched `explanation` and nothing else: the same keys in
 * the same order, and every sibling serialising to the identical bytes.
 * Throws rather than returning a boolean — a silent corruption of the book is
 * exactly what this script must not be able to do.
 */
export function assertOnlyExplanationChanged(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  id: string,
): void {
  const beforeKeys = Object.keys(before);
  const afterKeys = Object.keys(after);
  if (beforeKeys.length !== afterKeys.length || beforeKeys.some((k, i) => k !== afterKeys[i])) {
    fail(id, `the result keys moved (${beforeKeys.join(',')} -> ${afterKeys.join(',')})`);
  }
  for (const key of beforeKeys) {
    if (key === 'explanation') continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      fail(id, `key "${key}" would change, but only "explanation" may`);
    }
  }
}

/** Sentence split that matches how the template joins its sentences. */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z"'(])/).filter((s) => s.trim().length > 0);
}

/** A readable before/after for the log: what the sentence list gained and lost. */
function diffLines(change: ReexplainChange): string[] {
  const before = change.before === null ? [] : sentences(change.before);
  const after = sentences(change.after);
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const lines = [`  ${change.id}`];
  for (const s of before) if (!afterSet.has(s)) lines.push(`    - ${s}`);
  for (const s of after) if (!beforeSet.has(s)) lines.push(`    + ${s}`);
  if (lines.length === 1) lines.push('    (wording changed with no whole sentence added or removed)');
  lines.push(`    before: ${change.before ?? '(null)'}`);
  lines.push(`    after:  ${change.after}`);
  return lines;
}

function timestampSuffix(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-').replace(/Z$/, 'Z');
}

/** `…/retrofit.db` -> `…/retrofit.db.2026-09-20T00-00-00-000Z.bak`. */
export function backupPathFor(dbPath: string, now: Date): string {
  return `${dbPath}.${timestampSuffix(now)}.bak`;
}

function backupsPossible(dbPath: string | null | undefined): dbPath is string {
  return typeof dbPath === 'string' && dbPath.length > 0 && dbPath !== ':memory:' && !dbPath.startsWith('file::memory:');
}

/* -------------------------------------------------------------------------- */
/* Public                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The whole pass over an injected `Db`; `main` only opens the real one.
 * Reads every scored row, re-derives its explanation, and — with `write` —
 * rewrites only the rows whose text actually moved, inside one transaction.
 * Throws before writing anything if any row fails to parse, re-derive, or
 * survive `assertOnlyExplanationChanged`.
 */
export function runReexplain(db: Db, options: ReexplainOptions = {}): ReexplainSummary {
  const log = options.log ?? ((line: string) => console.log(line));
  const explainOne = options.explainFn ?? ((input: ExplainInput) => explain(input));
  const diffCount = options.diffCount ?? 3;

  const rows = db.all<RawRow>(
    sql`select id as id, rank as rank, insured_name as insuredName, result as result
        from submissions
        where result is not null
        order by id`,
  );

  const changes: ReexplainChange[] = [];
  const pending: { readonly id: string; readonly json: string }[] = [];
  let unchanged = 0;
  let mentioning = 0;

  // Pass one: derive and check everything. Nothing is written in this loop, so
  // a throw here leaves the database exactly as it was found.
  for (const row of rows) {
    if (row.result === null) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(row.result) as unknown;
    } catch (error) {
      fail(row.id, 'stored result is not valid JSON', error);
    }
    if (!isPlainObject(parsed)) fail(row.id, 'stored result is not a JSON object');

    let derived: ExplainedText;
    try {
      derived = explainOne({
        result: parsed as unknown as EngineResult,
        insuredName: row.insuredName,
        rank: options.includeRank === true ? row.rank : null,
      });
    } catch (error) {
      fail(row.id, 'explain() threw', error);
    }
    if (derived === null || derived === undefined || typeof derived.text !== 'string' || derived.text.length === 0) {
      fail(row.id, 'the re-derived explanation has no text');
    }

    const before = parsed['explanation'];
    const beforeText = typeof before === 'string' ? before : null;
    if (CONTRADICTION_RE.test(derived.text)) mentioning += 1;

    if (beforeText === derived.text) {
      unchanged += 1;
      continue;
    }
    const after: Record<string, unknown> = { ...parsed, explanation: derived.text };
    assertOnlyExplanationChanged(parsed, after, row.id);
    changes.push({ id: row.id, before: beforeText, after: derived.text });
    pending.push({ id: row.id, json: JSON.stringify(after) });
  }

  log(
    `reexplain: ${rows.length} scored submission(s) scanned — ` +
      `${changes.length} would change, ${unchanged} already current.`,
  );
  for (const change of changes.slice(0, diffCount)) for (const line of diffLines(change)) log(line);
  if (changes.length > diffCount) log(`  ... and ${changes.length - diffCount} more.`);

  // Pass two: write.
  let backupPath: string | null = null;
  let written = 0;
  if (options.write !== true) {
    log('Dry run: nothing written. Re-run with --write to apply.');
  } else if (pending.length === 0) {
    log('Nothing to write; the stored explanations are already current.');
  } else {
    if (backupsPossible(options.dbPath)) {
      // Fold the WAL back into the main file first, or the copy is a snapshot
      // of a database missing its most recent pages.
      db.run(sql.raw('PRAGMA wal_checkpoint(TRUNCATE)'));
      backupPath = backupPathFor(options.dbPath, new Date());
      copyFileSync(options.dbPath, backupPath);
      log(`Backup written: ${backupPath}`);
    } else {
      log('No database file to back up (in-memory).');
    }
    db.transaction((tx) => {
      for (const row of pending) {
        // `result` is the only column named here, so nothing else can move.
        tx.run(sql`update submissions set result = ${row.json} where id = ${row.id}`);
        written += 1;
      }
    });
    log(`Wrote ${written} row(s) in one transaction.`);
  }

  log(`${mentioning} of ${rows.length} explanation(s) mention a contradiction.`);

  return {
    scanned: rows.length,
    changed: changes.length,
    unchanged,
    written,
    backupPath,
    mentioningContradiction: mentioning,
    changes,
  };
}

/** `reexplain [--write] [--rank] [--db <path>]`. */
export function main(): void {
  const argv = process.argv.slice(2);
  const args = new Set(argv);
  const dbFlag = argv.indexOf('--db');
  const dbPath = dbFlag >= 0 ? argv[dbFlag + 1] : undefined;
  if (dbFlag >= 0 && (dbPath === undefined || dbPath.startsWith('--'))) {
    throw new Error('reexplain: --db needs a path');
  }
  const url = dbPath ?? getEnv().DATABASE_URL;

  const handle = createDb({ url });
  try {
    // No `migrate()`: this script only rewrites a column that already exists,
    // and must never be the thing that changes a schema.
    runReexplain(handle.db, {
      write: args.has('--write'),
      includeRank: args.has('--rank'),
      dbPath: url,
    });
  } finally {
    handle.close();
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  try {
    main();
  } catch (error: unknown) {
    console.error(error);
    process.exit(1);
  }
}
