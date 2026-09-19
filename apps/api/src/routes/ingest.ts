/** POST /ingest/federato. Body owned by Run 1 unit A12. */
import type { Hono } from 'hono';
import type { ErrorDto, IngestRequestDto } from '@retrofit/contracts';
import { ROUTES, ingestRequestSchema } from '@retrofit/contracts';
import type { ApiEnv } from '../app';
import { ingestFederato } from '../services/ingest';
import type { Deps } from '../services/types';

/** The 422 body (dto.schemas.ts header): zod issues flattened to path + message. */
function invalidBody(
  message: string,
  issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[],
): ErrorDto {
  return {
    error: {
      code: 'INVALID_REQUEST',
      message,
      issues: issues.map((issue) => ({
        path: issue.path.map((p) => String(p)).join('.'),
        message: issue.message,
      })),
    },
  };
}

/**
 * Reads the body as JSON. An empty body is the whole book with no options
 * (`{}`), so `curl -X POST /ingest/federato` does what `npm run seed` does.
 */
async function readJsonBody(
  raw: () => Promise<string>,
): Promise<{ ok: true; value: unknown } | { ok: false; message: string }> {
  const text = await raw();
  if (text.trim().length === 0) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'body is not JSON' };
  }
}

/**
 * Registers this module's handlers on the frozen app. Thin by construction:
 * parse, call the ingest service, serialize. Idempotency by `externalId` lives
 * in the service and the repository, not here.
 */
export function registerIngestRoutes(app: Hono<ApiEnv>, deps: Deps): void {
  app.post(ROUTES.ingestFederato.path, async (c) => {
    const body = await readJsonBody(() => c.req.text());
    if (!body.ok) {
      return c.json(
        invalidBody('request body is not valid JSON', [{ path: [], message: body.message }]),
        422,
      );
    }
    const parsed = ingestRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return c.json(invalidBody('invalid ingest request', parsed.error.issues), 422);
    }
    const request: IngestRequestDto = parsed.data;
    const response = await ingestFederato(deps, request);
    return c.json(response, 200);
  });
}
