/** POST /actions/plan, GET /actions, POST /actions/:id/approve. Body owned by Run 1 unit A14. */
import type { Context, Hono } from 'hono';
import type { z } from 'zod';
import type {
  ActionDto,
  ActionsPlanRequestDto,
  ActionsResponseDto,
  ApproveActionResponseDto,
  ErrorDto,
} from '@retrofit/contracts';
import {
  DEFAULT_PAGE_LIMIT,
  ROUTES,
  actionsPlanRequestSchema,
  actionsQuerySchema,
} from '@retrofit/contracts';
import type { ApiEnv } from '../app';
import { createRepos } from '../db/repos';
import type { Repos } from '../db/repos';
import type { ActionRow, SubmissionRow } from '../db/schema';
import { LlmError, LlmUnavailableError } from '../llm/types';
import { approveAction, planActions } from '../services/actions';
import type { Deps } from '../services/types';

/* -------------------------------------------------------------------------- */
/* Envelope helpers (private to this module)                                  */
/* -------------------------------------------------------------------------- */

const errorBody = (
  code: string,
  message: string,
  issues?: readonly { readonly path: string; readonly message: string }[],
): ErrorDto => ({ error: issues === undefined ? { code, message } : { code, message, issues } });

const flattenIssues = (error: z.ZodError): { path: string; message: string }[] =>
  error.issues.map((issue) => ({
    path: issue.path.map((p) => String(p)).join('.'),
    message: issue.message,
  }));

type BodyRead = { readonly ok: true; readonly value: unknown } | { readonly ok: false };

/** An empty body is `{}`: every field of the plan request is optional. */
async function readJsonBody(c: Context<ApiEnv>): Promise<BodyRead> {
  const text = await c.req.text();
  if (text.trim() === '') return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/**
 * Gemini failures become 503/502 with a code the console can show; everything
 * else (including a `NOT_IMPLEMENTED:` service) goes to the app's `onError`.
 */
function llmErrorResponse(c: Context<ApiEnv>, error: unknown): Response | null {
  if (error instanceof LlmUnavailableError) {
    return c.json(errorBody('LLM_UNAVAILABLE', error.message), 503);
  }
  if (error instanceof LlmError) {
    return c.json(errorBody('LLM_FAILED', error.message), 502);
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Row -> DTO                                                                 */
/* -------------------------------------------------------------------------- */

/** Maps a stored action to the wire shape. Every optional payload field defaults explicitly. */
function toActionDto(row: ActionRow, submission: SubmissionRow | null): ActionDto {
  const p = row.payload ?? {};
  return {
    id: row.id,
    submissionId: row.submissionId,
    externalId: submission?.externalId ?? null,
    insuredName: submission?.insuredName ?? null,
    type: row.type,
    status: row.status,
    actor: row.actor,
    triggers: [...(p.triggers ?? [])],
    fields: [...(p.fields ?? [])],
    draft: p.draft ?? null,
    recipient: p.recipient ?? null,
    routing: p.routing ?? null,
    sourceText: row.sourceText ?? null,
    extracted: [...(p.extracted ?? [])],
    before: row.before ?? null,
    after: row.after ?? null,
    rankBefore: p.rankBefore ?? null,
    rankAfter: p.rankAfter ?? null,
    note: p.note ?? null,
    createdAt: row.createdAt,
  };
}

function submissionLookup(repos: Repos): (id: string) => SubmissionRow | null {
  const cache = new Map<string, SubmissionRow | null>();
  return (id) => {
    if (!cache.has(id)) cache.set(id, repos.submissions.byId(id));
    return cache.get(id) ?? null;
  };
}

/* -------------------------------------------------------------------------- */
/* Registrar                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Registers this module's handlers on the frozen app. Throwing here in Run 0 is
 * expected: `app.ts` catches it and serves the 501 fallbacks instead.
 */
export function registerActionRoutes(app: Hono<ApiEnv>, deps: Deps): void {
  const repos = createRepos(deps.db);

  /** Routing plus request drafts for every qualifying account (PRD §7.6). */
  app.post(ROUTES.planActions.path, async (c) => {
    const body = await readJsonBody(c);
    if (!body.ok) return c.json(errorBody('INVALID_JSON', 'request body is not valid JSON'), 400);
    const parsed = actionsPlanRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return c.json(
        errorBody('VALIDATION', 'invalid plan request', flattenIssues(parsed.error)),
        422,
      );
    }
    const request: ActionsPlanRequestDto = parsed.data;
    try {
      const result = await planActions(deps, request);
      return c.json(result, 200);
    } catch (error) {
      const res = llmErrorResponse(c, error);
      if (res !== null) return res;
      throw error;
    }
  });

  /** The outbox and the action log, newest first. */
  app.get(ROUTES.listActions.path, (c) => {
    const parsed = actionsQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json(
        errorBody('VALIDATION', 'invalid actions query', flattenIssues(parsed.error)),
        422,
      );
    }
    const q = parsed.data;
    const limit = q.limit ?? DEFAULT_PAGE_LIMIT;
    const offset = q.offset ?? 0;
    const { rows, total } = repos.actions.list({
      status: q.status,
      type: q.type,
      submissionId: q.submissionId,
      limit,
      offset,
    });
    const submissionOf = submissionLookup(repos);
    const body: ActionsResponseDto = {
      actions: rows.map((row) => toActionDto(row, submissionOf(row.submissionId))),
      page: { total, limit, offset },
      sendingIsSimulated: true,
    };
    return c.json(body, 200);
  });

  /** Approving marks a draft sent. Nothing is ever really emailed (PRD §7.6). */
  app.post(ROUTES.approveAction.path, async (c) => {
    const id = c.req.param('id') ?? '';
    const existing = id === '' ? null : repos.actions.byId(id);
    if (existing === null) {
      return c.json(errorBody('NOT_FOUND', `no action "${id}"`), 404);
    }
    if (existing.status !== 'draft') {
      return c.json(
        errorBody('NOT_A_DRAFT', `action "${id}" is "${existing.status}"; only a draft can be approved`),
        409,
      );
    }
    const action = await approveAction(deps, id);
    const body: ApproveActionResponseDto = { action };
    return c.json(body, 200);
  });
}
