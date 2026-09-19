/**
 * The server entry point: build `Deps`, migrate, print the banners, listen.
 * The ONLY file that calls `serve()`. Body owned by Run 1 unit A10.
 */
import { pathToFileURL } from 'node:url';
import { serve } from '@hono/node-server';
import { createAdapter } from '@retrofit/federato';
import type { Deps } from './services/types';
import { systemClock } from './services/types';
import { describeEnv, federatoEnv, getEnv } from './env';
import { createDb } from './db/client';
import type { DbHandle } from './db/client';
import { migrate } from './db/migrate';
import { createGeminiProvider } from './llm/index';
import { createApp, pendingRouteModules } from './app';
import { observability } from './observability/index';
import { startupBanner } from './banners';

const VERSION = '0.1.0';

/** The handle behind the last `buildDeps()`, so `main` can migrate, name the driver and close. */
let currentHandle: DbHandle | null = null;

export function buildDeps(): Deps {
  const env = getEnv();
  const handle = createDb({ url: env.DATABASE_URL });
  currentHandle = handle;
  const adapter = createAdapter({ env: federatoEnv(env) });
  const llm = createGeminiProvider({ apiKey: env.GEMINI_API_KEY });
  return { db: handle.db, adapter, llm, clock: systemClock() };
}

export async function main(): Promise<void> {
  const env = getEnv();
  const deps = buildDeps();
  const handle = currentHandle;
  if (handle === null) throw new Error('buildDeps did not open a database');
  migrate(handle);

  const startedAt = deps.clock.nowIso();
  const app = createApp({ deps, version: VERSION, startedAt });

  const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    const lines = [
      ...startupBanner({ deps, driver: handle.driver, port: info.port, version: VERSION }),
      `Database: ${describeEnv(env).databaseUrl}`,
    ];
    const pending = pendingRouteModules({ deps });
    if (pending.length > 0) lines.push(`Routes answering 501 (stubs): ${pending.join(', ')}`);
    const width = Math.max(...lines.map((l) => l.length));
    const rule = '='.repeat(width);
    console.log([rule, ...lines, rule].join('\n'));
  });

  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) return;
    closing = true;
    console.log(`\n${signal} received, shutting down`);
    server.close(() => {
      observability()
        .flush()
        .catch(() => undefined)
        .finally(() => {
          handle.close();
          process.exit(0);
        });
    });
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

/** Run only when executed directly (`npm start`), never on import from a test. */
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
