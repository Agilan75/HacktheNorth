/**
 * The observability hook. A NO-OP in Run 0, and FROZEN.
 *
 * Its whole purpose is that Sentry can be added in Run 3 (unit X1, in
 * `observability/sentry.ts`) by calling `setObservability(...)` from
 * `index.ts` — without ever editing `app.ts`, which is frozen, or touching a
 * single route handler.
 *
 * Nothing here may throw: an observability failure must never fail a request.
 */

export interface SpanHandle {
  /** Adds a key/value to the span. Never a secret, never a credential. */
  setAttribute(key: string, value: string | number | boolean): void;
  end(): void;
}

export interface ObservabilitySink {
  readonly name: string;
  /** Wraps a unit of work — a planner query, a Gemini call, a route. */
  startSpan(name: string, attributes?: Readonly<Record<string, string | number | boolean>>): SpanHandle;
  captureError(error: unknown, context?: Readonly<Record<string, unknown>>): void;
  captureMessage(message: string, context?: Readonly<Record<string, unknown>>): void;
  /** Called once at shutdown. */
  flush(): Promise<void>;
}

const NOOP_SPAN: SpanHandle = {
  setAttribute: () => undefined,
  end: () => undefined,
};

const NOOP_SINK: ObservabilitySink = {
  name: 'noop',
  startSpan: () => NOOP_SPAN,
  captureError: () => undefined,
  captureMessage: () => undefined,
  flush: () => Promise.resolve(),
};

let sink: ObservabilitySink = NOOP_SINK;

/** Run 3 calls this once, from `index.ts`, with the Sentry-backed sink. */
export function setObservability(next: ObservabilitySink | null): void {
  sink = next ?? NOOP_SINK;
}

export function observability(): ObservabilitySink {
  return sink;
}

/** Convenience wrappers so call sites never branch on whether a sink exists. */
export function startSpan(
  name: string,
  attributes?: Readonly<Record<string, string | number | boolean>>,
): SpanHandle {
  try {
    return sink.startSpan(name, attributes);
  } catch {
    return NOOP_SPAN;
  }
}

export function captureError(
  error: unknown,
  context?: Readonly<Record<string, unknown>>,
): void {
  try {
    sink.captureError(error, context);
  } catch {
    /* observability must never fail a request */
  }
}

export function captureMessage(
  message: string,
  context?: Readonly<Record<string, unknown>>,
): void {
  try {
    sink.captureMessage(message, context);
  } catch {
    /* observability must never fail a request */
  }
}

/** Runs `work` inside a span, ending it whether or not `work` throws. */
export async function withSpan<T>(
  name: string,
  work: () => Promise<T>,
  attributes?: Readonly<Record<string, string | number | boolean>>,
): Promise<T> {
  const span = startSpan(name, attributes);
  try {
    return await work();
  } catch (error) {
    captureError(error, { span: name });
    throw error;
  } finally {
    span.end();
  }
}
