/** POST /ingest/federato, GET /ingest/runs/:runId. Body owned by Run 1 unit A12. */
import type { Hono } from 'hono';
import type { ErrorDto, IngestRequestDto, IngestStartedDto } from '@retrofit/contracts';
import { ROUTES, ingestRequestSchema } from '@retrofit/contracts';
import type { ApiEnv } from '../app';
import { ingestFederato } from '../services/ingest';
import { createIngestRun, readIngestRun } from '../services/ingest-progress';
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

    /*
     * Async: answer with a run id at once and keep working. The console polls
     * `GET /ingest/runs/:runId` and shows each planner query as it lands, which
     * is the only way to watch a 10-second run happen. `void` is deliberate —
     * the promise is owned by the recorder from here on, and every failure path
     * ends up on the run as `error`, never as an unhandled rejection.
     */
    if (request.async === true) {
      const startedAt = deps.clock.nowIso();
      const runId = `run-${startedAt.replace(/[^0-9]/g, '')}-${Math.random().toString(36).slice(2, 8)}`;
      const run = createIngestRun(runId, startedAt);
      void ingestFederato(deps, request, run.onQuery).then(
        (response) => run.succeed(response, deps.clock.nowIso()),
        (error: unknown) =>
          run.fail(error instanceof Error ? error.message : String(error), deps.clock.nowIso()),
      );
      const started: IngestStartedDto = { runId, startedAt };
      return c.json(started, 202);
    }

    const response = await ingestFederato(deps, request);
    return c.json(response, 200);
  });

  app.get(ROUTES.getIngestRun.path, (c) => {
    const runId = c.req.param('runId') ?? '';
    const run = readIngestRun(runId);
    if (run === null) {
      const body: ErrorDto = {
        error: {
          code: 'NOT_FOUND',
          message: `no ingest run "${runId}" — it finished long enough ago to be forgotten, or the API restarted`,
        },
      };
      return c.json(body, 404);
    }
    return c.json(run, 200);
  });
}
