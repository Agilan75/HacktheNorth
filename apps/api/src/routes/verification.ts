/** GET /verification: the testing in full (FILL-backend D7), and the per-case field under it. */
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import type { Hono } from 'hono';
import { ROUTES } from '@retrofit/contracts';
import type { ErrorDto, VerificationDto } from '@retrofit/contracts';
import type { ApiEnv } from '../app';
import { verification } from '../services/verification';
import type { Deps } from '../services/types';

/**
 * The field: one byte per layer A+B case, written by
 * `packages/verify/src/scripts/record-field.ts`. Like services/verification.ts
 * this reads the verify package's OUTPUT files, never its code -- except
 * `explain.ts`, loaded at runtime by URL so there is no package dependency
 * (verify depends on api; a static import would be a cycle).
 */
const FIELD_DIR = new URL('../../../../packages/verify/out/field/', import.meta.url);
const EXPLAIN_URL = new URL('../../../../packages/verify/src/explain.ts', import.meta.url);
const FIELD_LAYERS = ['cases', 'scores', 'strata'] as const;

interface FieldSummary {
  readonly seed: number;
  readonly total: number;
}

const fileCache = new Map<string, { readonly mtimeMs: number; readonly bytes: Buffer }>();

const gzipCache = new WeakMap<Buffer, Buffer>();

function readField(name: string): Buffer | null {
  const path = fileURLToPath(new URL(name, FIELD_DIR));
  let mtimeMs: number;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    return null;
  }
  const hit = fileCache.get(path);
  if (hit !== undefined && hit.mtimeMs === mtimeMs) return hit.bytes;
  const bytes = readFileSync(path);
  fileCache.set(path, { mtimeMs, bytes });
  return bytes;
}

function fieldSummary(): FieldSummary | null {
  const bytes = readField('summary.json');
  return bytes === null ? null : (JSON.parse(bytes.toString('utf8')) as FieldSummary);
}

const notFound = (message: string): ErrorDto => ({ error: { code: 'NOT_FOUND', message } });

let explain: Promise<{ explainCase: (seed: number, index: number) => unknown }> | null = null;

export function registerVerificationRoutes(app: Hono<ApiEnv>, _deps: Deps): void {
  app.get(ROUTES.verification.path, (c) => {
    const body: VerificationDto = verification();
    return c.json(body, 200);
  });

  app.get(`${ROUTES.verification.path}/field`, (c) => {
    const bytes = readField('summary.json');
    if (bytes === null) return c.json(notFound('the field has not been recorded'), 404);
    return c.body(new Uint8Array(bytes), 200, { 'content-type': 'application/json' });
  });

  app.get(`${ROUTES.verification.path}/field/:layer`, (c) => {
    const layer = c.req.param('layer');
    const bytes = (FIELD_LAYERS as readonly string[]).includes(layer) ? readField(`${layer}.bin`) : null;
    if (bytes === null) return c.json(notFound(`no field layer "${layer}"`), 404);
    const headers = { 'content-type': 'application/octet-stream', 'cache-control': 'public, max-age=3600', vary: 'accept-encoding' };
    if (!(c.req.header('accept-encoding') ?? '').includes('gzip')) return c.body(new Uint8Array(bytes), 200, headers);
    /* hono/compress skips octet-stream; these bytes are a third smaller gzipped, so zip each layer once. */
    let zipped = gzipCache.get(bytes);
    if (zipped === undefined) gzipCache.set(bytes, (zipped = gzipSync(bytes)));
    return c.body(new Uint8Array(zipped), 200, { ...headers, 'content-encoding': 'gzip' });
  });

  app.get(`${ROUTES.verification.path}/cases/:index`, async (c) => {
    const summary = fieldSummary();
    if (summary === null) return c.json(notFound('the field has not been recorded'), 404);
    const index = Number(c.req.param('index'));
    if (!Number.isInteger(index) || index < 0 || index >= summary.total) {
      return c.json(notFound(`no case ${c.req.param('index')}`), 404);
    }
    explain ??= import(EXPLAIN_URL.href) as NonNullable<typeof explain>;
    const { explainCase } = await explain;
    return c.json(explainCase(summary.seed, index) as object, 200);
  });
}
