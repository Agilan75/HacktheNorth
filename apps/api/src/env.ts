/**
 * The ONLY place `process.env` is read in the whole repository. FROZEN (W0-3).
 *
 * Nothing here is ever logged, echoed or returned to a client. `describeEnv()`
 * exists so the startup banner and `GET /health` can say what is configured
 * without revealing a single character of a credential.
 *
 * Reviewers grep for `process.env` outside this file; there must be no hits.
 */

import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/**
 * The repo root. This module sits at `apps/api/src/env.ts` (and, if built, at
 * `apps/api/dist/env.js`), three levels below it either way.
 */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * R6-1: a relative database path is resolved against the repo root, never the
 * cwd, so root `npm run dev:api`, the api package's own `dev`/`start` (cwd
 * `apps/api`) and `npm run seed` all open the same git-ignored file.
 * `:memory:` and `file:` URIs pass through unchanged.
 */
function resolveDatabaseUrl(url: string): string {
  if (url === ':memory:' || url.startsWith('file:') || isAbsolute(url)) return url;
  return resolve(REPO_ROOT, url);
}

/**
 * An optional variable. A missing key and an empty string both read as
 * `undefined`, because `.env.example` ships every Federato key blank and an
 * empty `FEDERATO_BASE_URL` is exactly how the mock adapter is selected.
 */
const optionalNonEmpty = z
  .string()
  .trim()
  .transform((value) => (value.length === 0 ? undefined : value))
  .optional();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),

  /** Unset -> the API still starts, prints a banner and serves the seeded sweep. */
  GEMINI_API_KEY: optionalNonEmpty,

  /** Unset -> `MockFederatoAdapter` over the saved snapshot (PRD §7.4). */
  FEDERATO_BASE_URL: optionalNonEmpty,
  FEDERATO_TOKEN_URL: optionalNonEmpty,
  FEDERATO_AUDIENCE: optionalNonEmpty,
  FEDERATO_CLIENT_ID: optionalNonEmpty,
  FEDERATO_CLIENT_SECRET: optionalNonEmpty,

  /** One SQLite file. `:memory:` in tests. */
  DATABASE_URL: z.string().trim().min(1).default('apps/api/data/retrofit.db').transform(resolveDatabaseUrl),

  /** Sentry is added last and is never integral (PRD §14). */
  SENTRY_DSN: optionalNonEmpty,

  /** Set by `vitest.setup.ts`; live calls are refused unless this is `1`. */
  RUN_LIVE: z.enum(['0', '1']).default('0'),
});

export type Env = z.infer<typeof envSchema>;

/** Thrown only for a malformed value, never for a missing optional one. */
export class EnvError extends Error {
  readonly issues: readonly { readonly path: string; readonly message: string }[];

  constructor(issues: readonly { readonly path: string; readonly message: string }[]) {
    super(`invalid environment: ${issues.map((i) => `${i.path} ${i.message}`).join('; ')}`);
    this.name = 'EnvError';
    this.issues = issues;
  }
}

let cached: Env | null = null;

/**
 * Parses and caches the environment. `source` is injectable so route tests can
 * build a `Deps` without touching the real process environment.
 */
export function loadEnv(source: Readonly<Record<string, string | undefined>> = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new EnvError(
      parsed.error.issues.map((issue) => ({
        path: issue.path.map((p) => String(p)).join('.'),
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

export function getEnv(): Env {
  if (cached === null) cached = loadEnv();
  return cached;
}

/** Test seam. Never called by a request path. */
export function setEnv(env: Env | null): void {
  cached = env;
}

/** Exactly the slice `packages/federato` is allowed to see. */
export function federatoEnv(env: Env): {
  readonly baseUrl?: string | undefined;
  readonly tokenUrl?: string | undefined;
  readonly audience?: string | undefined;
  readonly clientId?: string | undefined;
  readonly clientSecret?: string | undefined;
} {
  return {
    baseUrl: env.FEDERATO_BASE_URL,
    tokenUrl: env.FEDERATO_TOKEN_URL,
    audience: env.FEDERATO_AUDIENCE,
    clientId: env.FEDERATO_CLIENT_ID,
    clientSecret: env.FEDERATO_CLIENT_SECRET,
  };
}

/** Booleans only — safe to log, safe to serve from `GET /health`. */
export function describeEnv(env: Env): {
  readonly nodeEnv: string;
  readonly port: number;
  readonly llmConfigured: boolean;
  readonly federatoConfigured: boolean;
  readonly sentryConfigured: boolean;
  readonly databaseUrl: string;
  readonly liveCallsAllowed: boolean;
} {
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    llmConfigured: env.GEMINI_API_KEY !== undefined,
    federatoConfigured:
      env.FEDERATO_BASE_URL !== undefined &&
      env.FEDERATO_CLIENT_ID !== undefined &&
      env.FEDERATO_CLIENT_SECRET !== undefined,
    sentryConfigured: env.SENTRY_DSN !== undefined,
    databaseUrl: env.DATABASE_URL,
    liveCallsAllowed: env.RUN_LIVE === '1',
  };
}
