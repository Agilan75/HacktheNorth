/** GET /submissions and GET /submissions/:id. Body owned by Run 1 unit A12. */
import type { Hono } from 'hono';
import type { ApiEnv } from '../app';
import type { Deps } from '../services/types';

/**
 * Registers this module's handlers on the frozen app. Throwing here in Run 0 is
 * expected: `app.ts` catches it and serves the 501 fallbacks instead.
 */
export function registerSubmissionRoutes(_app: Hono<ApiEnv>, _deps: Deps): void {
  throw new Error('NOT_IMPLEMENTED:A12');
}
