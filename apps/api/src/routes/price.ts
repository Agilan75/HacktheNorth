/**
 * POST /price/identify  { imageBase64 }                -> { items }
 * POST /price/lookup    { label, name, brand, model }  -> LookupResult
 *
 * The live sweep price chips. Separate from POST /sweeps on purpose: the phone
 * calls these per frame while the user is still panning, and the verdict
 * pipeline is untouched.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import type { ApiEnv, RouteRegistrar } from '../app';
import { getEnv } from '../env';
import { captureError } from '../observability/index';
import { createPricer } from '../pricing/live';
import type { Pricer } from '../pricing/live';
import { PRICE_LABELS } from '../pricing/table';

/** ~768px JPEG from the phone is ~100-200 KB of base64; anything far past that is not a frame. */
const MAX_IMAGE_BASE64 = 3_000_000;

const identifyBody = z.object({ imageBase64: z.string().min(100).max(MAX_IMAGE_BASE64) });
const lookupBody = z.object({
  label: z.enum(PRICE_LABELS as [string, ...string[]]),
  name: z.string().min(1).max(120),
  brand: z.string().max(80).nullable(),
  model: z.string().max(80).nullable(),
});

function defaultPricer(): Pricer | null {
  const env = getEnv();
  if (env.ANTHROPIC_API_KEY === undefined) return null;
  const workspaceId = env.ANTHROPIC_WORKSPACE_ID?.trim();
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    ...(workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': workspaceId } } : {}),
  });
  return createPricer(client, () => Date.now());
}

async function body<S extends z.ZodType>(c: Context<ApiEnv>, schema: S): Promise<z.output<S> | Response> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'request body is not valid JSON' } }, 400);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message }));
    return c.json({ error: { code: 'VALIDATION', message: 'request body failed validation', issues } }, 422);
  }
  return parsed.data;
}

function upstreamError(c: Context<ApiEnv>, err: unknown): Response {
  captureError(err, { path: c.req.path, method: c.req.method });
  const message = err instanceof Error ? err.message : String(err);
  return c.json({ error: { code: 'UPSTREAM', message } }, 502);
}

/** `pricer` is injected in tests; the server builds one from the env on first use. */
export function createPriceRoutes(pricer?: Pricer): RouteRegistrar {
  let resolved: Pricer | null | undefined = pricer;
  const get = (): Pricer | null => (resolved === undefined ? (resolved = defaultPricer()) : resolved);

  return (app: Hono<ApiEnv>) => {
    app.post('/price/identify', async (c) => {
      const p = get();
      if (p === null) return c.json({ error: { code: 'LLM_UNAVAILABLE', message: 'ANTHROPIC_API_KEY is not set' } }, 503);
      const parsed = await body(c, identifyBody);
      if (parsed instanceof Response) return parsed;
      try {
        return c.json({ items: await p.identify(parsed.imageBase64) });
      } catch (err) {
        return upstreamError(c, err);
      }
    });

    app.post('/price/lookup', async (c) => {
      const p = get();
      if (p === null) return c.json({ error: { code: 'LLM_UNAVAILABLE', message: 'ANTHROPIC_API_KEY is not set' } }, 503);
      const parsed = await body(c, lookupBody);
      if (parsed instanceof Response) return parsed;
      try {
        return c.json(await p.lookup({ ...parsed, label: parsed.label as (typeof PRICE_LABELS)[number] }));
      } catch (err) {
        return upstreamError(c, err);
      }
    });
  };
}

export const registerPriceRoutes: RouteRegistrar = createPriceRoutes();
