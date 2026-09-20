import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb, openNodeSqlite } from './client';
import type { DbHandle } from './client';
import { migrate } from './migrate';
import { createRepos } from './repos';

const scratch = mkdtempSync(join(import.meta.dirname, '.a01-client-test-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function roundTrip(handle: DbHandle): void {
  migrate(handle);
  const repos = createRepos(handle.db);
  const row = repos.submissions.upsertByExternalId({
    id: 's1',
    source: 'federato',
    lineOfBusiness: 'tenant',
    externalId: 'SUB-1',
    insuredName: 'Acme',
    raw: null,
    queryTrace: [{ step: 1 } as never],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  expect(row.queryTrace).toEqual([{ step: 1 }]);
  expect(repos.submissions.byExternalId('SUB-1')?.insuredName).toBe('Acme');
  const e = repos.enrichments.upsert({
    id: 'e1',
    submissionId: 's1',
    source: 'openfema_flood',
    payload: { zone: 'AE' },
    available: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  expect(e.available).toBe(false);
  repos.submissions.setRanks([{ id: 's1', rank: 3 }]);
  expect(repos.submissions.byId('s1')?.rank).toBe(3);
  expect(repos.submissions.list({}).total).toBe(1);
}

describe('createDb', () => {
  it('uses better-sqlite3 on this machine', () => {
    const handle = createDb({ url: ':memory:' });
    expect(handle.driver).toBe('better-sqlite3');
    roundTrip(handle);
    handle.close();
    expect(() => handle.close()).not.toThrow();
  });

  it('opens a file database, creating the parent directory, and persists across handles', () => {
    const url = join(scratch, 'nested', 'dir', 'retrofit.db');
    const first = createDb({ url });
    roundTrip(first);
    first.close();
    const second = createDb({ url, readonly: true });
    expect(createRepos(second.db).submissions.byId('s1')?.rank).toBe(3);
    second.close();
  });
});

describe('node:sqlite fallback', () => {
  it('presents the same synchronous Db surface', () => {
    const handle = openNodeSqlite({ url: ':memory:' });
    expect(handle.driver).toBe('node-sqlite-proxy');
    roundTrip(handle);
    handle.close();
  });

  it('rolls back a failed transaction', () => {
    const handle = openNodeSqlite({ url: ':memory:' });
    migrate(handle);
    const repos = createRepos(handle.db);
    repos.submissions.upsertByExternalId({
      id: 's1',
      source: 'seed',
      lineOfBusiness: 'tenant',
      externalId: 'X',
      createdAt: 't',
      updatedAt: 't',
    });
    expect(() =>
      handle.db.transaction((tx) => {
        tx.run(sql`UPDATE submissions SET rank = 9`);
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(repos.submissions.byId('s1')?.rank).toBeNull();
    handle.close();
  });
});
