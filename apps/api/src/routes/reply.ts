/** POST /submissions/:id/reply. Body owned by Run 1 unit A14. */
import type { Context, Hono } from 'hono';
import type { z } from 'zod';
import type { ErrorDto, ReplyRequestDto } from '@retrofit/contracts';
import { ROUTES, replyRequestSchema } from '@retrofit/contracts';
import type { ApiEnv } from '../app';
import { createRepos } from '../db/repos';
import { LlmError, LlmUnavailableError } from '../llm/types';
import { applyBrokerReply } from '../services/reply';
import type { Deps } from '../services/types';

/**
 * Largest PDF accepted, decoded. Gemini's inline-data ceiling is 20 MB per
 * request; anything bigger would fail there after a wasted round trip.
 */
const MAX_REPLY_PDF_BYTES = 20 * 1024 * 1024;
const MAX_REPLY_PDF_BASE64_CHARS = Math.ceil(MAX_REPLY_PDF_BYTES / 3) * 4;

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

type BodyRead =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly message: string };

const isFile = (value: unknown): value is File =>
  typeof value === 'object' && value !== null && typeof (value as File).arrayBuffer === 'function';

/**
 * Two wire forms, one request shape:
 *  - `application/json` — a `ReplyRequestDto` as is;
 *  - `multipart/form-data` — fields `text`, `actionId`, `filename`, and a
 *    `file` upload. A `text/*` upload is read as text; anything else is sent on
 *    as `pdfBase64` (loss runs arrive as PDFs).
 */
async function readReplyBody(c: Context<ApiEnv>): Promise<BodyRead> {
  const contentType = c.req.header('content-type') ?? '';
  if (contentType.toLowerCase().startsWith('multipart/form-data')) {
    let form: Record<string, string | File | (string | File)[]>;
    try {
      form = (await c.req.parseBody({ all: true })) as Record<string, string | File | (string | File)[]>;
    } catch {
      return { ok: false, message: 'multipart body could not be parsed' };
    }
    const one = (key: string): string | File | undefined => {
      const v = form[key];
      return Array.isArray(v) ? v[0] : v;
    };
    const out: Record<string, unknown> = {};
    for (const key of ['text', 'actionId', 'filename'] as const) {
      const v = one(key);
      if (typeof v === 'string' && v !== '') out[key] = v;
    }
    const file = one('file');
    if (isFile(file)) {
      const bytes = Buffer.from(await file.arrayBuffer());
      if (file.type.toLowerCase().startsWith('text/')) {
        if (out.text === undefined) out.text = bytes.toString('utf8');
        else out.pdfBase64 = bytes.toString('base64'); // both given: let the schema reject it
      } else {
        out.pdfBase64 = bytes.toString('base64');
        if (out.filename === undefined && file.name !== '') out.filename = file.name;
      }
    }
    return { ok: true, value: out };
  }
  const text = await c.req.text();
  if (text.trim() === '') return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, message: 'request body is not valid JSON' };
  }
}

/* -------------------------------------------------------------------------- */
/* Registrar                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Registers this module's handlers on the frozen app. Throwing here in Run 0 is
 * expected: `app.ts` catches it and serves the 501 fallbacks instead.
 */
export function registerReplyRoutes(app: Hono<ApiEnv>, deps: Deps): void {
  const repos = createRepos(deps.db);

  /** Extract, validate, apply, re-score; returns the before and after (PRD §7.6, §8). */
  app.post(ROUTES.replyToSubmission.path, async (c) => {
    const submissionId = c.req.param('id') ?? '';
    const submission = submissionId === '' ? null : repos.submissions.byId(submissionId);
    if (submission === null) {
      return c.json(errorBody('NOT_FOUND', `no submission "${submissionId}"`), 404);
    }

    const body = await readReplyBody(c);
    if (!body.ok) return c.json(errorBody('INVALID_BODY', body.message), 400);
    const parsed = replyRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return c.json(
        errorBody('VALIDATION', 'invalid reply', flattenIssues(parsed.error)),
        422,
      );
    }
    const request: ReplyRequestDto = parsed.data;

    if (request.pdfBase64 !== undefined && request.pdfBase64.length > MAX_REPLY_PDF_BASE64_CHARS) {
      return c.json(
        errorBody('TOO_LARGE', `the PDF exceeds ${MAX_REPLY_PDF_BYTES} bytes`),
        413,
      );
    }

    if (request.actionId !== undefined) {
      const action = repos.actions.byId(request.actionId);
      if (action === null) {
        return c.json(errorBody('ACTION_NOT_FOUND', `no action "${request.actionId}"`), 404);
      }
      if (action.submissionId !== submission.id) {
        return c.json(
          errorBody(
            'ACTION_MISMATCH',
            `action "${request.actionId}" belongs to submission "${action.submissionId}", not "${submission.id}"`,
          ),
          422,
        );
      }
    }

    /* The response carries a non-null `before`: a reply can only re-score a scored account. */
    if (submission.result === null || submission.result === undefined) {
      return c.json(
        errorBody('NOT_SCORED', `submission "${submission.id}" has no result yet; run it first`),
        409,
      );
    }

    try {
      const result = await applyBrokerReply(deps, submission.id, request);
      return c.json(result, 200);
    } catch (error) {
      if (error instanceof LlmUnavailableError) {
        return c.json(errorBody('LLM_UNAVAILABLE', error.message), 503);
      }
      if (error instanceof LlmError) {
        return c.json(errorBody('LLM_FAILED', error.message), 502);
      }
      throw error;
    }
  });
}
