/** GET /aggregate. Body owned by Run 1 unit A13. */
import type { Hono } from 'hono';
import { ROUTES } from '@retrofit/contracts';
import type { ApiEnv } from '../app';
import { aggregate } from '../services/aggregate';
import type { Deps } from '../services/types';

/**
 * Registers this module's handlers on the frozen app. Throwing here in Run 0 is
 * expected: `app.ts` catches it and serves the 501 fallbacks instead.
 */
export function registerAggregateRoutes(app: Hono<ApiEnv>, deps: Deps): void {
  app.get(ROUTES.aggregate.path, async (c) => c.json(await aggregate(deps), 200));
}
