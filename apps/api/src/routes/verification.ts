/** GET /verification: the testing in full (FILL-backend D7). */
import type { Hono } from 'hono';
import { ROUTES } from '@retrofit/contracts';
import type { VerificationDto } from '@retrofit/contracts';
import type { ApiEnv } from '../app';
import { verification } from '../services/verification';
import type { Deps } from '../services/types';

export function registerVerificationRoutes(app: Hono<ApiEnv>, _deps: Deps): void {
  app.get(ROUTES.verification.path, (c) => {
    const body: VerificationDto = verification();
    return c.json(body, 200);
  });
}
