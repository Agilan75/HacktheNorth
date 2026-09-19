/**
 * The SQLite client. `better-sqlite3` first; the `node:sqlite` fallback, if it
 * is ever needed, is confined to THIS file so nothing else knows the
 * difference. Body owned by Run 1 unit A01.
 */
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

export function createDb(_options: ClientOptions): DbHandle {
  throw new Error('NOT_IMPLEMENTED:A01');
}
