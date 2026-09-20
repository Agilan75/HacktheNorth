/**
 * The SQLite client. `better-sqlite3` first; the `node:sqlite` fallback, if it
 * is ever needed, is confined to THIS file so nothing else knows the
 * difference. Body owned by Run 1 unit A01.
 *
 * The fallback does not use `drizzle-orm/sqlite-proxy` (which is async-typed and
 * would break the synchronous `Db` surface). Instead it wraps `node:sqlite`'s
 * `DatabaseSync` in the small slice of the `better-sqlite3` API that Drizzle's
 * better-sqlite3 session actually calls (`prepare` → `run`/`all`/`get`/`raw`,
 * `transaction`, `exec`, `close`), so both drivers go through the same Drizzle
 * driver and produce the same `Db`.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite';
import { schema } from './schema';
import type { Db } from '../services/types';

export interface ClientOptions {
  /** A file path, or `:memory:` for tests. */
  readonly url: string;
  readonly readonly?: boolean;
}

export interface DbHandle {
  readonly db: Db;
  /** `better-sqlite3` or `node-sqlite-proxy`; printed in the startup banner. */
  readonly driver: string;
  close(): void;
}

export const DRIVER_BETTER_SQLITE3 = 'better-sqlite3';
export const DRIVER_NODE_SQLITE = 'node-sqlite-proxy';

type BetterSqliteClient = InstanceType<typeof Database>;

function isMemory(url: string): boolean {
  return url === ':memory:' || url === '' || url.startsWith('file::memory:');
}

function prepareFile(url: string, readonly: boolean): void {
  if (isMemory(url) || readonly) return;
  mkdirSync(dirname(url), { recursive: true });
}

function applyPragmas(exec: (sql: string) => void, url: string, readonly: boolean): void {
  if (!isMemory(url) && !readonly) exec('PRAGMA journal_mode = WAL');
  exec('PRAGMA busy_timeout = 5000');
}

function openBetterSqlite(options: ClientOptions): DbHandle {
  const readonly = options.readonly === true;
  prepareFile(options.url, readonly);
  const client = new Database(options.url, { readonly });
  applyPragmas((s) => client.exec(s), options.url, readonly);
  const db = drizzle(client, { schema }) as unknown as Db;
  return {
    db,
    driver: DRIVER_BETTER_SQLITE3,
    close: () => {
      if (client.open) client.close();
    },
  };
}

/** The `better-sqlite3` statement surface Drizzle's session uses, over `node:sqlite`. */
function shimStatement(database: DatabaseSync, sql: string) {
  const objects: StatementSync = database.prepare(sql);
  let arrays: StatementSync | null = null;
  const rawStmt = (): StatementSync => {
    if (arrays === null) {
      arrays = database.prepare(sql);
      arrays.setReturnArrays(true);
    }
    return arrays;
  };
  type Param = SQLInputValue;
  return {
    run: (...params: Param[]) => objects.run(...params),
    all: (...params: Param[]) => objects.all(...params),
    get: (...params: Param[]) => objects.get(...params),
    raw: () => ({
      all: (...params: Param[]) => rawStmt().all(...params),
      get: (...params: Param[]) => rawStmt().get(...params),
    }),
  };
}

function shimTransaction<A extends unknown[], R>(database: DatabaseSync, fn: (...args: A) => R) {
  const make =
    (begin: string) =>
    (...args: A): R => {
      if (database.isTransaction) {
        // Nested: better-sqlite3 uses a savepoint here.
        database.exec('SAVEPOINT node_sqlite_shim');
        try {
          const out = fn(...args);
          database.exec('RELEASE node_sqlite_shim');
          return out;
        } catch (err) {
          database.exec('ROLLBACK TO node_sqlite_shim');
          database.exec('RELEASE node_sqlite_shim');
          throw err;
        }
      }
      database.exec(begin);
      try {
        const out = fn(...args);
        database.exec('COMMIT');
        return out;
      } catch (err) {
        if (database.isTransaction) database.exec('ROLLBACK');
        throw err;
      }
    };
  const deferred = make('BEGIN DEFERRED');
  return Object.assign(deferred, {
    deferred,
    immediate: make('BEGIN IMMEDIATE'),
    exclusive: make('BEGIN EXCLUSIVE'),
  });
}

/**
 * The fallback. Exported only so the client test can exercise it on a machine
 * where `better-sqlite3` loads fine; production code calls `createDb`.
 */
export function openNodeSqlite(options: ClientOptions): DbHandle {
  const readonly = options.readonly === true;
  prepareFile(options.url, readonly);
  const mod = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite') | undefined;
  if (!mod) throw new Error('node:sqlite is not available in this Node runtime');
  const database = new mod.DatabaseSync(isMemory(options.url) ? ':memory:' : options.url, {
    readOnly: readonly,
  });
  applyPragmas((s) => database.exec(s), options.url, readonly);
  const client = {
    prepare: (sql: string) => shimStatement(database, sql),
    transaction: <A extends unknown[], R>(fn: (...args: A) => R) => shimTransaction(database, fn),
    exec: (sql: string) => {
      database.exec(sql);
      return client;
    },
    close: () => {
      if (database.isOpen) database.close();
    },
  };
  const db = drizzle(client as unknown as BetterSqliteClient, { schema }) as unknown as Db;
  return { db, driver: DRIVER_NODE_SQLITE, close: client.close };
}

/**
 * Opens the database. Tries `better-sqlite3`; if its native binding cannot load
 * (the only way it fails on a valid path), falls back to `node:sqlite`.
 * Errors that are not about the driver (a bad path, a read-only miss) are
 * rethrown from the fallback too, so they still surface.
 */
export function createDb(options: ClientOptions): DbHandle {
  try {
    return openBetterSqlite(options);
  } catch (err) {
    if (!isNativeLoadError(err)) throw err;
    return openNodeSqlite(options);
  }
}

function isNativeLoadError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const text = `${err.message} ${(err as { code?: unknown }).code ?? ''}`;
  return /bindings|\.node\b|NODE_MODULE_VERSION|ERR_DLOPEN_FAILED|MODULE_NOT_FOUND|Could not locate/i.test(
    text,
  );
}
