import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { createDb } from './client';
import { migrate, migrationStatements } from './migrate';
import { schema } from './schema';

interface PragmaColumn {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}
interface PragmaIndex {
  name: string;
  unique: number;
  origin: string;
}

function sqliteDefault(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value) || typeof value === 'object') return `'${JSON.stringify(value)}'`;
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'string') return `'${value}'`;
  return String(value);
}

describe('migrate', () => {
  it('issues 4 tables and 11 indexes, all IF NOT EXISTS', () => {
    const statements = migrationStatements();
    expect(statements).toHaveLength(15);
    expect(statements.filter((s) => s.startsWith('CREATE TABLE IF NOT EXISTS'))).toHaveLength(4);
    expect(statements.filter((s) => /^CREATE (UNIQUE )?INDEX IF NOT EXISTS/.test(s))).toHaveLength(11);
  });

  it('creates exactly the columns and indexes declared in schema.ts', () => {
    const handle = createDb({ url: ':memory:' });
    migrate(handle);
    const client = {
      prepare: (text: string) => ({ all: (): unknown[] => handle.db.all(sql.raw(text)) }),
    };

    for (const table of Object.values(schema) as SQLiteTable[]) {
      const config = getTableConfig(table);
      const cols = client.prepare(`PRAGMA table_info(${config.name})`).all() as PragmaColumn[];
      expect(cols.map((c) => c.name)).toEqual(config.columns.map((c) => c.name));
      for (const column of config.columns) {
        const actual = cols.find((c) => c.name === column.name);
        expect(actual, `${config.name}.${column.name}`).toBeDefined();
        expect(actual!.type.toLowerCase(), `${config.name}.${column.name} type`).toBe(
          column.getSQLType().toLowerCase(),
        );
        expect(actual!.notnull === 1 || actual!.pk === 1, `${config.name}.${column.name} notNull`).toBe(
          column.notNull,
        );
        expect(actual!.pk === 1, `${config.name}.${column.name} pk`).toBe(column.primary);
        expect(actual!.dflt_value, `${config.name}.${column.name} default`).toBe(
          sqliteDefault(column.default),
        );
      }

      const indexes = (client.prepare(`PRAGMA index_list(${config.name})`).all() as PragmaIndex[]).filter(
        (i) => i.origin === 'c',
      );
      const expected = config.indexes.map((i) => ({ name: i.config.name, unique: i.config.unique }));
      expect(
        indexes.map((i) => ({ name: i.name, unique: i.unique === 1 })).sort((a, b) => a.name.localeCompare(b.name)),
      ).toEqual(expected.sort((a, b) => a.name.localeCompare(b.name)));
      for (const index of config.indexes) {
        const info = client.prepare(`PRAGMA index_info(${index.config.name})`).all() as { name: string }[];
        expect(info.map((c) => c.name)).toEqual(
          index.config.columns.map((c) => (c as { name: string }).name),
        );
      }
    }
    handle.close();
  });

  it('adds the facts column to a submissions table created before it existed, keeping its rows', () => {
    const handle = createDb({ url: ':memory:' });
    // The submissions table exactly as the first release created it.
    handle.db.run(
      sql.raw(`CREATE TABLE submissions (
  id text PRIMARY KEY NOT NULL,
  source text NOT NULL,
  line_of_business text NOT NULL,
  external_id text NOT NULL,
  insured_name text,
  raw text,
  canonical text,
  result text,
  query_trace text DEFAULT '[]' NOT NULL,
  share_slug text,
  rank integer,
  created_at text NOT NULL,
  updated_at text NOT NULL
)`),
    );
    handle.db.run(
      sql.raw(
        `INSERT INTO submissions (id, source, line_of_business, external_id, created_at, updated_at) VALUES ('S-1', 'federato', 'commercial_property', 'S-1', 'x', 'x')`,
      ),
    );
    migrate(handle);
    migrate(handle);
    const cols = handle.db.all<{ name: string }>(sql.raw('PRAGMA table_info(submissions)'));
    expect(cols.map((c) => c.name)).toEqual(getTableConfig(schema.submissions).columns.map((c) => c.name));
    const rows = handle.db.all<{ id: string; facts: string | null }>(sql.raw('SELECT id, facts FROM submissions'));
    expect(rows).toEqual([{ id: 'S-1', facts: null }]);
    handle.close();
  });

  it('is idempotent', () => {
    const handle = createDb({ url: ':memory:' });
    migrate(handle);
    expect(() => migrate(handle)).not.toThrow();
    handle.close();
  });
});
