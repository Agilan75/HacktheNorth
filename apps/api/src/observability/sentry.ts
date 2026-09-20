/**
 * The Sentry-backed observability sink. Body owned by Run 3 unit X1.
 * It is installed through `setObservability(...)` from `index.ts`; `app.ts`
 * and every route handler stay untouched.
 */
import type { ObservabilitySink } from './index';

export interface SentryOptions {
  readonly dsn: string;
  readonly environment: string;
  readonly release?: string;
  readonly tracesSampleRate?: number;
}

export function createSentrySink(_options: SentryOptions): ObservabilitySink {
  throw new Error('NOT_IMPLEMENTED:X1');
}
