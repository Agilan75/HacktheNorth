/**
 * Unit tests for `reexplain`. Every one runs against a throwaway SQLite file
 * under this process's temp directory — never `apps/api/data/retrofit.db`.
 *
 * `explain()` is injected, so the tests exercise the script's own contract
 * (parse, re-derive, prove only `explanation` moved, write once) without
 * needing a real 200 KB `EngineResult`.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../db/client';
import type { DbHandle } from '../db/client';
import { migrate } from '../db/migrate';
import type { Db } from '../services/types';
import { assertOnlyExplanationChanged, backupPathFor, runReexplain } from './reexplain';
import type { ExplainedText } from './reexplain';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/** A stand-in for the stored blob: the keys the script must leave alone, plus one. */
function storedResult(id: string, explanation: string | null): Record<string, unknown> {
  return {
    id,
    lineOfBusiness: 'commercial_property',
    asOf: '2026-09-19',
    canonical: { insured: { name: [{ value: 'Acme LLC' }] }, locations: [] },
    contradictions: [{ id: 'c1', status: 'open', severity: 'HIGH', canonicalPath: 'buildings.0.tiv' }],
    verdict: { verdict: 'REFER', openHighContradictionIds: ['c1'] },
    peers: null,
    qualityIndex: 0.5,
    explanation,
  };
}

let dir: string;
let dbPath: string;
let handle: DbHandle;

function insert(db: Db, id: string, explanation: string | null, rank: number): void {
  db.run(sql`
    insert into submissions (id, source, line_of_business, external_id, insured_name, raw, canonical,
                             result, query_trace, share_slug, rank, created_at, updated_at, facts)
    values (${id}, 'federato', 'commercial_property', ${id}, 'Acme LLC',
            ${JSON.stringify({ untouched: true })}, ${JSON.stringify({ untouched: 'canonical' })},
            ${JSON.stringify(storedResult(id, explanation))}, ${JSON.stringify([{ q: 'one' }])},
            ${`slug-${id}`}, ${rank}, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z',
            ${JSON.stringify({ broker: 'B' })})
  `);
}

interface StoredRow {
  readonly result: string | null;
  readonly raw: string | null;
  readonly canonical: string | null;
  readonly queryTrace: string | null;
  readonly facts: string | null;
  readonly rank: number | null;
  readonly updatedAt: string;
}

function read(db: Db, id: string): StoredRow {
  const row = db.get<StoredRow>(
    sql`select result as result, raw as raw, canonical as canonical, query_trace as queryTrace,
               facts as facts, rank as rank, updated_at as updatedAt
        from submissions where id = ${id}`,
  );
  if (row === undefined || row === null) throw new Error(`no row ${id}`);
  return row;
}

/** Appends a contradiction sentence, standing in for the template change. */
const appending = (input: { readonly result: unknown }): ExplainedText => {
  const result = input.result as { readonly id: string };
  return { text: `${result.id} is a risk. One open contradiction is unresolved.` };
};

/** Returns exactly what is already stored, so nothing changes. */
const stable = (input: { readonly result: unknown }): ExplainedText => {
  const result = input.result as { readonly explanation: string };
  return { text: result.explanation };
};

const silent = (): void => {};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'reexplain-'));
  dbPath = join(dir, 'test.db');
  handle = createDb({ url: dbPath });
  migrate(handle);
});

afterEach(() => {
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

/* -------------------------------------------------------------------------- */

describe('runReexplain', () => {
  it('rewrites a changed explanation and leaves every sibling key and column untouched', () => {
    insert(handle.db, 'SUB-1', 'Old text.', 1);
    const before = read(handle.db, 'SUB-1');

    const summary = runReexplain(handle.db, {
      write: true,
      dbPath,
      log: silent,
      explainFn: appending,
    });

    expect(summary).toMatchObject({ scanned: 1, changed: 1, unchanged: 0, written: 1 });
    const after = read(handle.db, 'SUB-1');
    const parsedBefore = JSON.parse(before.result as string) as Record<string, unknown>;
    const parsedAfter = JSON.parse(after.result as string) as Record<string, unknown>;

    expect(parsedAfter['explanation']).toBe('SUB-1 is a risk. One open contradiction is unresolved.');
    // Every other key of the blob, byte for byte.
    for (const key of Object.keys(parsedBefore)) {
      if (key === 'explanation') continue;
      expect(JSON.stringify(parsedAfter[key])).toBe(JSON.stringify(parsedBefore[key]));
    }
    expect(Object.keys(parsedAfter)).toEqual(Object.keys(parsedBefore));
    // And every other column.
    expect(after.raw).toBe(before.raw);
    expect(after.canonical).toBe(before.canonical);
    expect(after.queryTrace).toBe(before.queryTrace);
    expect(after.facts).toBe(before.facts);
    expect(after.rank).toBe(before.rank);
    expect(after.updatedAt).toBe(before.updatedAt);
  });

  it('leaves a row whose explanation is already current completely alone', () => {
    insert(handle.db, 'SUB-1', 'Already current.', 1);
    const before = read(handle.db, 'SUB-1');

    const summary = runReexplain(handle.db, { write: true, dbPath, log: silent, explainFn: stable });

    expect(summary).toMatchObject({ scanned: 1, changed: 0, unchanged: 1, written: 0 });
    expect(read(handle.db, 'SUB-1').result).toBe(before.result);
    // Nothing was written, so no backup was taken either.
    expect(summary.backupPath).toBeNull();
  });

  it('aborts the whole run and writes nothing when one row holds malformed JSON', () => {
    insert(handle.db, 'SUB-1', 'Old text.', 1);
    insert(handle.db, 'SUB-2', 'Old text.', 2);
    handle.db.run(sql`update submissions set result = '{not json' where id = 'SUB-2'`);
    const before1 = read(handle.db, 'SUB-1').result;

    expect(() => runReexplain(handle.db, { write: true, dbPath, log: silent, explainFn: appending })).toThrow(
      /submission SUB-2: stored result is not valid JSON/,
    );
    // The good row is untouched: the failure happens before any write.
    expect(read(handle.db, 'SUB-1').result).toBe(before1);
    expect(read(handle.db, 'SUB-2').result).toBe('{not json');
  });

  it('aborts and names the submission when explain() throws', () => {
    insert(handle.db, 'SUB-1', 'Old text.', 1);
    const before = read(handle.db, 'SUB-1').result;
    expect(() =>
      runReexplain(handle.db, {
        write: true,
        dbPath,
        log: silent,
        explainFn: () => {
          throw new Error('NOT_IMPLEMENTED:F12');
        },
      }),
    ).toThrow(/submission SUB-1: explain\(\) threw/);
    expect(read(handle.db, 'SUB-1').result).toBe(before);
  });

  it('aborts when the re-derived explanation has no text', () => {
    insert(handle.db, 'SUB-1', 'Old text.', 1);
    expect(() =>
      runReexplain(handle.db, {
        write: true,
        dbPath,
        log: silent,
        explainFn: () => ({ text: '' }),
      }),
    ).toThrow(/submission SUB-1: the re-derived explanation has no text/);
  });

  it('writes nothing on a dry run but still reports what would change', () => {
    insert(handle.db, 'SUB-1', 'Old text.', 1);
    const before = read(handle.db, 'SUB-1').result;

    const summary = runReexplain(handle.db, { dbPath, log: silent, explainFn: appending });

    expect(summary).toMatchObject({ scanned: 1, changed: 1, written: 0, backupPath: null });
    expect(summary.changes[0]).toMatchObject({ id: 'SUB-1', before: 'Old text.' });
    expect(read(handle.db, 'SUB-1').result).toBe(before);
    expect(existsSync(`${dbPath}.bak`)).toBe(false);
  });

  it('is idempotent: the second --write run changes nothing and produces the same bytes', () => {
    insert(handle.db, 'SUB-1', 'Old text.', 1);
    insert(handle.db, 'SUB-2', 'Old text.', 2);

    const first = runReexplain(handle.db, { write: true, dbPath, log: silent, explainFn: appending });
    expect(first).toMatchObject({ changed: 2, written: 2 });
    const afterFirst = [read(handle.db, 'SUB-1').result, read(handle.db, 'SUB-2').result];

    const second = runReexplain(handle.db, { write: true, dbPath, log: silent, explainFn: appending });
    expect(second).toMatchObject({ scanned: 2, changed: 0, unchanged: 2, written: 0, backupPath: null });
    expect([read(handle.db, 'SUB-1').result, read(handle.db, 'SUB-2').result]).toEqual(afterFirst);
  });

  it('backs the database file up before writing, and the backup holds the pre-run text', () => {
    insert(handle.db, 'SUB-1', 'Old text.', 1);

    const summary = runReexplain(handle.db, { write: true, dbPath, log: silent, explainFn: appending });

    expect(summary.backupPath).not.toBeNull();
    const backup = summary.backupPath as string;
    expect(existsSync(backup)).toBe(true);
    const copy = createDb({ url: backup, readonly: true });
    try {
      const row = copy.db.get<{ readonly result: string }>(
        sql`select result as result from submissions where id = 'SUB-1'`,
      );
      expect(JSON.parse(row?.result ?? '{}')).toMatchObject({ explanation: 'Old text.' });
    } finally {
      copy.close();
    }
  });

  it('counts the explanations that mention a contradiction', () => {
    insert(handle.db, 'SUB-1', 'Old text.', 1);
    insert(handle.db, 'SUB-2', 'Old text.', 2);
    const summary = runReexplain(handle.db, {
      log: silent,
      explainFn: (input) =>
        (input.result as { readonly id: string }).id === 'SUB-1'
          ? { text: 'One open contradiction remains.' }
          : { text: 'Nothing unusual.' },
    });
    expect(summary.mentioningContradiction).toBe(1);
  });

  it('skips rows with no result at all', () => {
    insert(handle.db, 'SUB-1', 'Old text.', 1);
    handle.db.run(sql`update submissions set result = null where id = 'SUB-1'`);
    const summary = runReexplain(handle.db, { log: silent, explainFn: appending });
    expect(summary).toMatchObject({ scanned: 0, changed: 0 });
  });
});

describe('assertOnlyExplanationChanged', () => {
  it('passes when only the explanation differs', () => {
    expect(() =>
      assertOnlyExplanationChanged(storedResult('X', 'a'), storedResult('X', 'b'), 'X'),
    ).not.toThrow();
  });

  it('throws, naming the key, when a sibling differs', () => {
    const after = { ...storedResult('X', 'b'), qualityIndex: 0.9 };
    expect(() => assertOnlyExplanationChanged(storedResult('X', 'a'), after, 'X')).toThrow(
      /key "qualityIndex" would change/,
    );
  });

  it('throws when the key set or order moves', () => {
    const before = storedResult('X', 'a');
    const after: Record<string, unknown> = { explanation: 'b', ...before };
    delete after['id'];
    expect(() => assertOnlyExplanationChanged(before, after, 'X')).toThrow(/result keys moved/);
  });
});

describe('backupPathFor', () => {
  it('stamps the backup beside the database with a filesystem-safe timestamp', () => {
    expect(backupPathFor('/data/retrofit.db', new Date('2026-09-20T01:02:03.456Z'))).toBe(
      '/data/retrofit.db.2026-09-20T01-02-03-456Z.bak',
    );
  });
});
