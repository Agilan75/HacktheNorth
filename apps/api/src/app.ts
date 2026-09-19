/**
 * The Hono app. **FROZEN after Run 0 (W0-3) — no Run 1 unit ever edits this
 * file.** That is the whole point of how it is built:
 *
 *  1. Every route module (`routes/*.ts`, owned by A11–A15) is offered the app
 *     first, through a registrar. In Run 0 those registrars throw
 *     `NOT_IMPLEMENTED:<unit>`; that is caught, recorded, and the boot
 *     continues. In Run 1 they register real handlers and nothing here changes.
 *  2. Then every route in `ROUTE_LIST` gets a fallback handler returning 501.
 *     Hono runs matched handlers in registration order and stops at the first
 *     that returns a response, so a real handler always wins over its fallback.
 *  3. Observability goes through the no-op hook, so Sentry (Run 3) needs no
 *     edit here either.
 *
 * Handlers are thin by construction: they get `Deps` off the context and call a
 * service. No business logic lives in this file or in any route module.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ErrorDto } from '@retrofit/contracts';
import { NOT_IMPLEMENTED_STATUS, ROUTE_LIST } from '@retrofit/contracts';
import type { Deps } from './services/types';
import { captureError } from './observability/index';
import { registerStaticRoutes } from './routes/static';
import { registerIngestRoutes } from './routes/ingest';
import { registerSubmissionRoutes } from './routes/submissions';
import { registerRunRoutes } from './routes/run';
import { registerAggregateRoutes } from './routes/aggregate';
import { registerActionRoutes } from './routes/actions';
import { registerReplyRoutes } from './routes/reply';
import { registerSweepRoutes } from './routes/sweeps';

/** What every handler finds on the context. */
export type ApiEnv = {
  Variables: {
    deps: Deps;
    startedAt: string;
    version: string;
  };
};

export type RouteRegistrar = (app: Hono<ApiEnv>, deps: Deps) => void;

export interface CreateAppOptions {
  readonly deps: Deps;
  readonly version?: string;
  /** ISO-8601. Taken from `deps.clock` when omitted, never from `Date.now()`. */
  readonly startedAt?: string;
  /** Overrides the registrar list. Tests use it to mount one module in isolation. */
  readonly registrars?: readonly RouteRegistrar[];
}

/** The modules that may add handlers, in the order they are offered the app. */
export const DEFAULT_REGISTRARS: readonly RouteRegistrar[] = [
  registerStaticRoutes,
  registerIngestRoutes,
  registerSubmissionRoutes,
  registerRunRoutes,
  registerAggregateRoutes,
  registerActionRoutes,
  registerReplyRoutes,
  registerSweepRoutes,
];

const isNotImplemented = (error: unknown): boolean =>
  error instanceof Error && error.message.startsWith('NOT_IMPLEMENTED:');

const notImplementedBody = (routeId: string, unit: string): ErrorDto => ({
  error: {
    code: 'NOT_IMPLEMENTED',
    message: `route "${routeId}" is not implemented yet (Run 1 unit ${unit})`,
  },
});

export function createApp(options: CreateAppOptions): Hono<ApiEnv> {
  const { deps, version = '0.1.0' } = options;
  const startedAt = options.startedAt ?? deps.clock.nowIso();
  const registrars = options.registrars ?? DEFAULT_REGISTRARS;

  const app = new Hono<ApiEnv>();

  /** CORS is wide open: this is a hackathon dev server, never a public API. */
  app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'] }));

  app.use('*', async (c, next) => {
    c.set('deps', deps);
    c.set('startedAt', startedAt);
    c.set('version', version);
    await next();
  });

  /** Step 1: let every route module register its real handlers. */
  for (const register of registrars) {
    try {
      register(app, deps);
    } catch (error) {
      if (!isNotImplemented(error)) throw error;
      /* Run 0 stub: the 501 fallback below answers this route instead. */
    }
  }

  /** Step 2: a 501 fallback for every route in the table. */
  for (const route of ROUTE_LIST) {
    const body = notImplementedBody(route.id, route.unit);
    if (route.method === 'GET') {
      app.get(route.path, (c) => c.json(body, NOT_IMPLEMENTED_STATUS));
    } else {
      app.post(route.path, (c) => c.json(body, NOT_IMPLEMENTED_STATUS));
    }
  }

  app.notFound((c) => {
    const body: ErrorDto = {
      error: {
        code: 'NOT_FOUND',
        message: `no route for ${c.req.method} ${c.req.path}`,
      },
    };
    return c.json(body, 404);
  });

  app.onError((error, c) => {
    captureError(error, { path: c.req.path, method: c.req.method });
    if (isNotImplemented(error)) {
      const body: ErrorDto = {
        error: { code: 'NOT_IMPLEMENTED', message: error.message },
      };
      return c.json(body, NOT_IMPLEMENTED_STATUS);
    }
    const body: ErrorDto = { error: { code: 'INTERNAL', message: error.message } };
    return c.json(body, 500);
  });

  return app;
}

/** Which route modules are still stubs, for the startup banner. */
export function pendingRouteModules(options: CreateAppOptions): readonly string[] {
  const registrars = options.registrars ?? DEFAULT_REGISTRARS;
  const pending: string[] = [];
  const probe = new Hono<ApiEnv>();
  for (const register of registrars) {
    try {
      register(probe, options.deps);
    } catch (error) {
      if (isNotImplemented(error)) pending.push((error as Error).message);
    }
  }
  return pending;
}
