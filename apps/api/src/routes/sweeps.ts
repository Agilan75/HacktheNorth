/** POST /sweeps, GET /sweeps/:id, answers, next-question, verify-fix. Body owned by Run 1 unit A15. */
import type { Context, Hono } from 'hono';
import type { z } from 'zod';
import type {
  ErrorDto,
  NextQuestionResponseDto,
  SweepDto,
  VerifyFixResponseDto,
} from '@retrofit/contracts';
import {
  ROUTES,
  sweepAnswersRequestSchema,
  sweepCreateRequestSchema,
  verifyFixRequestSchema,
} from '@retrofit/contracts';
import type { ApiEnv } from '../app';
import { captureError } from '../observability/index';
import { nextQuestion, submitAnswers } from '../services/questions';
import { advanceSweep, createSweep, getSweep } from '../services/sweep';
import type { Deps } from '../services/types';
import { verifyFix } from '../services/verify-fix';

/* -------------------------------------------------------------------------- */
/* Request parsing                                                            */
/* -------------------------------------------------------------------------- */

const errorBody = (
  code: string,
  message: string,
  issues?: ErrorDto['error']['issues'],
): ErrorDto => ({ error: issues === undefined ? { code, message } : { code, message, issues } });

type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly response: Response };

/** Malformed JSON is a 400; well-formed JSON that fails the schema is a 422 with the zod issues. */
async function parseBody<S extends z.ZodType>(
  c: Context<ApiEnv>,
  schema: S,
): Promise<Parsed<z.output<S>>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false, response: c.json(errorBody('BAD_REQUEST', 'request body is not valid JSON'), 400) };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    }));
    return {
      ok: false,
      response: c.json(errorBody('VALIDATION', 'request body failed validation', issues), 422),
    };
  }
  return { ok: true, value: result.data };
}

const notFound = (c: Context<ApiEnv>, id: string): Response =>
  c.json(errorBody('NOT_FOUND', `no sweep "${id}"`), 404);

/* -------------------------------------------------------------------------- */
/* The stage driver                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Stages at which the pipeline stops on its own. `questions` hands over to the
 * VOI loop (answers / next-question); `done` and `failed` are final.
 */
const RESTING_STAGES: ReadonlySet<SweepDto['stage']> = new Set(['questions', 'done', 'failed']);

/** Hard ceiling on advances per drive: there are six stages before `questions`. */
const MAX_ADVANCES = 12;

/**
 * Drives one sweep from its current stage to a resting stage, one
 * `advanceSweep` at a time, in the background. At most one driver runs per
 * sweep in this process, so concurrent polls never double-advance a stage. A
 * drive stops when the stage stops moving, so a service that does not advance
 * can never spin this loop (docs/decisions/A15.md).
 */
function createDriver(deps: Deps): (sweep: SweepDto) => void {
  const inFlight = new Set<string>();

  const drive = async (start: SweepDto): Promise<void> => {
    let current = start;
    for (let i = 0; i < MAX_ADVANCES && !RESTING_STAGES.has(current.stage); i += 1) {
      const next = await advanceSweep(deps, current.id);
      if (next.stage === current.stage) break;
      current = next;
    }
  };

  return (sweep) => {
    if (RESTING_STAGES.has(sweep.stage) || inFlight.has(sweep.id)) return;
    inFlight.add(sweep.id);
    void drive(sweep)
      .catch((error: unknown) => {
        captureError(error, { route: 'sweeps', sweepId: sweep.id, stage: sweep.stage });
      })
      .finally(() => {
        inFlight.delete(sweep.id);
      });
  };
}

/* -------------------------------------------------------------------------- */
/* Registrar                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Registers this module's handlers on the frozen app. Throwing here in Run 0 is
 * expected: `app.ts` catches it and serves the 501 fallbacks instead.
 */
export function registerSweepRoutes(app: Hono<ApiEnv>, deps: Deps): void {
  const kick = createDriver(deps);

  /** 201 with the sweep as created; the stages then run in the background. */
  app.post(ROUTES.createSweep.path, async (c) => {
    const parsed = await parseBody(c, sweepCreateRequestSchema);
    if (!parsed.ok) return parsed.response;
    const sweep: SweepDto = await createSweep(deps, parsed.value);
    kick(sweep);
    return c.json(sweep, 201);
  });

  /** Poll `stage`. A sweep left mid-pipeline (e.g. by a restart) is picked up again here. */
  app.get(ROUTES.getSweep.path, async (c) => {
    const id = c.req.param('id') ?? '';
    const sweep = await getSweep(deps, id);
    if (sweep === null) return notFound(c, id);
    kick(sweep);
    return c.json(sweep, 200);
  });

  app.post(ROUTES.answerSweep.path, async (c) => {
    const id = c.req.param('id') ?? '';
    const parsed = await parseBody(c, sweepAnswersRequestSchema);
    if (!parsed.ok) return parsed.response;
    if ((await getSweep(deps, id)) === null) return notFound(c, id);
    const sweep: SweepDto = await submitAnswers(deps, id, parsed.value);
    return c.json(sweep, 200);
  });

  app.get(ROUTES.nextQuestion.path, async (c) => {
    const id = c.req.param('id') ?? '';
    if ((await getSweep(deps, id)) === null) return notFound(c, id);
    const body: NextQuestionResponseDto = await nextQuestion(deps, id);
    return c.json(body, 200);
  });

  app.post(ROUTES.verifyFix.path, async (c) => {
    const id = c.req.param('id') ?? '';
    const parsed = await parseBody(c, verifyFixRequestSchema);
    if (!parsed.ok) return parsed.response;
    if ((await getSweep(deps, id)) === null) return notFound(c, id);
    const body: VerifyFixResponseDto = await verifyFix(deps, id, parsed.value);
    return c.json(body, 200);
  });
}
