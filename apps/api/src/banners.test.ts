import { afterEach, describe, expect, it } from 'vitest';
import type { FederatoAdapter } from '@retrofit/federato';
import { startupBanner } from './banners';
import { createFakeLlm } from './llm/index';
import { createGeminiProvider } from './llm/index';
import { fixedClock } from './services/types';
import type { Db, Deps } from './services/types';
import { loadEnv, setEnv } from './env';
import { DRIVER_BETTER_SQLITE3, DRIVER_NODE_SQLITE } from './db/client';

const SECRET = 'sk-this-must-never-appear';

function deps(kind: 'live' | 'mock', llm: Deps['llm']): Deps {
  return {
    db: {} as unknown as Db,
    adapter: { kind } as unknown as FederatoAdapter,
    llm,
    clock: fixedClock('2026-09-19T12:00:00.000Z'),
  };
}

afterEach(() => setEnv(null));

describe('startupBanner', () => {
  it('names the port, version, snapshot adapter, unconfigured Gemini and driver', () => {
    setEnv(loadEnv({ DATABASE_URL: ':memory:' }));
    const lines = startupBanner({
      deps: deps('mock', createGeminiProvider({ apiKey: undefined })),
      driver: DRIVER_BETTER_SQLITE3,
      port: 3000,
      version: '0.1.0',
    });
    expect(lines[0]).toBe('Retrofit API v0.1.0 listening on http://localhost:3000');
    expect(lines[1]).toMatch(/snapshot|mock/i);
    expect(lines[2]).toMatch(/^LLM: NOT CONFIGURED/);
    expect(lines[2]).toContain('seeded sweep');
    expect(lines[3]).toBe('SQLite driver: better-sqlite3');
    expect(lines[4]).toBe('Started 2026-09-19T12:00:00.000Z');
    expect(lines).toHaveLength(5);
  });

  it('says live and configured when they are, and never prints a credential', () => {
    setEnv(
      loadEnv({
        DATABASE_URL: ':memory:',
        ANTHROPIC_API_KEY: SECRET,
        FEDERATO_BASE_URL: 'https://example.invalid',
        FEDERATO_CLIENT_ID: 'id-must-not-print',
        FEDERATO_CLIENT_SECRET: SECRET,
      }),
    );
    const lines = startupBanner({
      deps: deps('live', createFakeLlm()),
      driver: DRIVER_BETTER_SQLITE3,
      port: 4123,
      version: '9.9.9',
    });
    expect(lines[0]).toContain('http://localhost:4123');
    expect(lines[0]).toContain('v9.9.9');
    expect(lines[1]).toMatch(/live/i);
    expect(lines[1]).not.toMatch(/snapshot/i);
    expect(lines[2]).toBe('LLM: configured (provider fake)');
    const all = lines.join('\n');
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain('id-must-not-print');
  });

  it('flags the node:sqlite fallback driver loudly', () => {
    setEnv(loadEnv({}));
    const lines = startupBanner({
      deps: deps('mock', createFakeLlm()),
      driver: DRIVER_NODE_SQLITE,
      port: 3000,
      version: '0.1.0',
    });
    expect(lines[3]).toMatch(/^SQLite driver: node-sqlite-proxy \(fallback/);
  });
});
