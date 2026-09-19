/**
 * Hand-written `CREATE TABLE IF NOT EXISTS` statements matching `schema.ts`
 * exactly. There is no drizzle-kit. Body owned by Run 1 unit A01.
 */
import type { DbHandle } from './client';

export function migrate(_handle: DbHandle): void {
  throw new Error('NOT_IMPLEMENTED:A01');
}

/** The statements, exported so a test can assert they match `schema.ts`. */
export function migrationStatements(): readonly string[] {
  throw new Error('NOT_IMPLEMENTED:A01');
}
