import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

/** This file sits next to env.ts, so the repo root is three levels up. */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CANONICAL_DB = resolve(REPO_ROOT, 'apps/api/data/retrofit.db');

describe('DATABASE_URL (R6-1)', () => {
  it('defaults to the one repo-root database, independent of the working directory', () => {
    const url = loadEnv({}).DATABASE_URL;
    // A cwd-relative default opened <root>/apps/api/apps/api/data/retrofit.db
    // when the api package scripts ran with cwd = apps/api.
    expect(isAbsolute(url)).toBe(true);
    expect(url).toBe(CANONICAL_DB);
  });

  it('resolves a relative value against the repo root, not the cwd', () => {
    expect(loadEnv({ DATABASE_URL: 'apps/api/data/other.db' }).DATABASE_URL).toBe(
      resolve(REPO_ROOT, 'apps/api/data/other.db'),
    );
  });

  it('keeps :memory:, file: URIs and absolute paths exactly as given', () => {
    expect(loadEnv({ DATABASE_URL: ':memory:' }).DATABASE_URL).toBe(':memory:');
    expect(loadEnv({ DATABASE_URL: 'file::memory:?cache=shared' }).DATABASE_URL).toBe('file::memory:?cache=shared');
    const abs = resolve(REPO_ROOT, 'somewhere/x.db');
    expect(loadEnv({ DATABASE_URL: abs }).DATABASE_URL).toBe(abs);
  });
});
