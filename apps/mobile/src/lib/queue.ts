/**
 * The offline sweep queue (unit M1, PRD §11: "offline queues the sweep").
 *
 * `submit` tries to upload a sweep once (the API client already retries a few
 * times with backoff). If that fails because there is no connection, the sweep
 * is held in memory and retried on an exponential schedule until it goes
 * through, and the UI can say "Queued, will send when you are back online".
 * A failure that is not about connectivity (e.g. a 422) is not queued: it is
 * returned so the screen can show it.
 *
 * In memory only: a queued sweep is lost if the app is killed (recorded in
 * docs/decisions/M1.md). Pure and injectable (send, clock, random) so it runs
 * in node under vitest. No react-native import.
 */
import type { SweepCreateRequestDto, SweepDto } from '@retrofit/contracts';
import { backoffDelay, describeApiError, isOfflineError, type RetryPolicy } from './api';

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface QueueClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const systemClock: QueueClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type QueueItemStatus = 'queued' | 'sending' | 'sent' | 'failed';

export interface QueueItem {
  readonly id: string;
  readonly request: SweepCreateRequestDto;
  readonly status: QueueItemStatus;
  readonly enqueuedAt: number;
  /** Background attempts made since it was queued (the first submit is not counted). */
  readonly attempts: number;
  /** Epoch ms of the next scheduled try, or null when not waiting. */
  readonly nextAttemptAt: number | null;
  /** Plain-language reason for the last failure. */
  readonly lastError: string | null;
  readonly sweep: SweepDto | null;
}

export interface QueueSnapshot {
  readonly items: readonly QueueItem[];
  /** Items still waiting to go (queued or sending). */
  readonly pendingCount: number;
}

export type SubmitResult =
  | { readonly status: 'sent'; readonly sweep: SweepDto }
  | { readonly status: 'queued'; readonly queueId: string; readonly message: string }
  | { readonly status: 'failed'; readonly error: unknown; readonly message: string };

export interface SweepQueueOptions {
  /** Uploads one sweep; normally `getApi().createSweep`. */
  readonly send: (request: SweepCreateRequestDto) => Promise<SweepDto>;
  readonly clock?: QueueClock;
  readonly random?: () => number;
  /** Background retry schedule. `maxAttempts` is ignored: an offline sweep waits indefinitely. */
  readonly backoff?: Partial<Pick<RetryPolicy, 'baseDelayMs' | 'maxDelayMs' | 'factor' | 'jitter'>>;
  /** Decides "no connection" (queue it) vs "the server said no" (fail it). */
  readonly isOffline?: (error: unknown) => boolean;
  readonly describeError?: (error: unknown) => string;
  /** Sent items are dropped from the snapshot after this long. */
  readonly keepSentMs?: number;
}

export interface SweepQueue {
  submit(request: SweepCreateRequestDto): Promise<SubmitResult>;
  /** Resolves with the created sweep once a queued item goes through; rejects if it fails for good or is removed. */
  waitFor(queueId: string): Promise<SweepDto>;
  /** Try every waiting item now (e.g. the app came to the foreground, or the user tapped "Try now"). */
  retryNow(): Promise<void>;
  remove(queueId: string): void;
  getSnapshot(): QueueSnapshot;
  subscribe(listener: (snapshot: QueueSnapshot) => void): () => void;
  dispose(): void;
}

export const QUEUED_MESSAGE = 'Queued. Your sweep will send when you are back online.';

export const DEFAULT_QUEUE_BACKOFF = {
  baseDelayMs: 2_000,
  maxDelayMs: 60_000,
  factor: 2,
  jitter: 0.3,
} as const;

/** One plain-language line about the queue for a banner; null when there is nothing to say. */
export function queueStatusMessage(snapshot: QueueSnapshot): string | null {
  const pending = snapshot.pendingCount;
  if (pending === 0) {
    const failed = snapshot.items.filter((item) => item.status === 'failed').length;
    if (failed === 0) return null;
    return failed === 1 ? 'One sweep could not be sent.' : `${failed} sweeps could not be sent.`;
  }
  if (snapshot.items.some((item) => item.status === 'sending')) {
    return pending === 1 ? 'Sending your sweep…' : `Sending ${pending} sweeps…`;
  }
  return pending === 1
    ? QUEUED_MESSAGE
    : `${pending} sweeps are queued. They will send when you are back online.`;
}

/* -------------------------------------------------------------------------- */
/* Implementation                                                             */
/* -------------------------------------------------------------------------- */

interface Waiter {
  resolve(sweep: SweepDto): void;
  reject(error: unknown): void;
}

type MutableItem = { -readonly [K in keyof QueueItem]: QueueItem[K] } & {
  lastErrorRaw: unknown;
  sentAt: number | null;
};

export class QueueItemError extends Error {
  readonly cause: unknown;
  constructor(message: string, cause: unknown) {
    super(message);
    this.name = 'QueueItemError';
    this.cause = cause;
  }
}

export function createSweepQueue(options: SweepQueueOptions): SweepQueue {
  const clock = options.clock ?? systemClock;
  const random = options.random ?? Math.random;
  const backoff = { ...DEFAULT_QUEUE_BACKOFF, ...options.backoff };
  const isOffline = options.isOffline ?? isOfflineError;
  const describe = options.describeError ?? describeApiError;
  const keepSentMs = options.keepSentMs ?? 30_000;

  const items: MutableItem[] = [];
  const waiters = new Map<string, Waiter[]>();
  const listeners = new Set<(snapshot: QueueSnapshot) => void>();
  let timer: unknown = null;
  let flushing: Promise<void> | null = null;
  let disposed = false;
  let seq = 0;

  const snapshot = (): QueueSnapshot => {
    const now = clock.now();
    const visible = items.filter(
      (item) => !(item.status === 'sent' && item.sentAt !== null && now - item.sentAt > keepSentMs),
    );
    return {
      items: visible.map(
        (item): QueueItem => ({
          id: item.id,
          request: item.request,
          status: item.status,
          enqueuedAt: item.enqueuedAt,
          attempts: item.attempts,
          nextAttemptAt: item.nextAttemptAt,
          lastError: item.lastError,
          sweep: item.sweep,
        }),
      ),
      pendingCount: items.filter((item) => item.status === 'queued' || item.status === 'sending').length,
    };
  };

  const emit = (): void => {
    const snap = snapshot();
    for (const listener of listeners) listener(snap);
  };

  const settle = (id: string, outcome: { sweep: SweepDto } | { error: unknown }): void => {
    const list = waiters.get(id);
    waiters.delete(id);
    if (list === undefined) return;
    for (const waiter of list) {
      if ('sweep' in outcome) waiter.resolve(outcome.sweep);
      else waiter.reject(outcome.error);
    }
  };

  const clearTimer = (): void => {
    if (timer !== null) {
      clock.clearTimeout(timer);
      timer = null;
    }
  };

  /** Arms one timer for the earliest waiting item. */
  const schedule = (): void => {
    clearTimer();
    if (disposed) return;
    const due = items
      .filter((item) => item.status === 'queued' && item.nextAttemptAt !== null)
      .map((item) => item.nextAttemptAt as number);
    if (due.length === 0) return;
    const wait = Math.max(0, Math.min(...due) - clock.now());
    timer = clock.setTimeout(() => {
      timer = null;
      void flush(false);
    }, wait);
  };

  /** Tries one item. Returns false if it is still offline (so the rest can wait too). */
  const tryItem = async (item: MutableItem): Promise<boolean> => {
    item.status = 'sending';
    item.nextAttemptAt = null;
    item.attempts += 1;
    emit();
    try {
      const sweep = await options.send(item.request);
      if (disposed || !items.includes(item)) return true;
      item.status = 'sent';
      item.sentAt = clock.now();
      item.sweep = sweep;
      item.lastError = null;
      item.lastErrorRaw = null;
      emit();
      settle(item.id, { sweep });
      return true;
    } catch (error) {
      if (disposed || !items.includes(item)) return true;
      item.lastError = describe(error);
      item.lastErrorRaw = error;
      if (isOffline(error)) {
        item.status = 'queued';
        item.nextAttemptAt = clock.now() + backoffDelay(item.attempts + 1, backoff, random);
        emit();
        return false;
      }
      item.status = 'failed';
      emit();
      settle(item.id, { error: new QueueItemError(item.lastError, error) });
      return true;
    }
  };

  /**
   * Sends waiting items one at a time, oldest first. When `force` is false only
   * items whose time has come are tried. One offline failure pushes every other
   * due item back to the same moment, so a dead connection costs one request.
   */
  const flush = (force: boolean): Promise<void> => {
    if (flushing !== null) return flushing;
    const run = async (): Promise<void> => {
      clearTimer();
      for (;;) {
        if (disposed) return;
        const now = clock.now();
        const next = items.find(
          (item) =>
            item.status === 'queued' &&
            (force || (item.nextAttemptAt !== null && item.nextAttemptAt <= now)),
        );
        if (next === undefined) break;
        const ok = await tryItem(next);
        if (!ok) {
          const at = next.nextAttemptAt;
          for (const other of items) {
            if (other !== next && other.status === 'queued' && at !== null) {
              other.nextAttemptAt = Math.max(other.nextAttemptAt ?? at, at);
            }
          }
          emit();
          break;
        }
      }
    };
    flushing = run().finally(() => {
      flushing = null;
      schedule();
    });
    return flushing;
  };

  return {
    async submit(request) {
      if (disposed) throw new Error('sweep queue is disposed');
      try {
        const sweep = await options.send(request);
        return { status: 'sent', sweep };
      } catch (error) {
        if (!isOffline(error)) {
          return { status: 'failed', error, message: describe(error) };
        }
        seq += 1;
        const now = clock.now();
        const item: MutableItem = {
          id: `q${now.toString(36)}-${seq}`,
          request,
          status: 'queued',
          enqueuedAt: now,
          attempts: 0,
          nextAttemptAt: now + backoffDelay(1, backoff, random),
          lastError: describe(error),
          lastErrorRaw: error,
          sentAt: null,
          sweep: null,
        };
        items.push(item);
        emit();
        if (flushing === null) schedule();
        return { status: 'queued', queueId: item.id, message: QUEUED_MESSAGE };
      }
    },

    waitFor(queueId) {
      const item = items.find((candidate) => candidate.id === queueId);
      if (item === undefined) return Promise.reject(new Error(`no queued sweep "${queueId}"`));
      if (item.status === 'sent' && item.sweep !== null) return Promise.resolve(item.sweep);
      if (item.status === 'failed') {
        return Promise.reject(new QueueItemError(item.lastError ?? 'failed', item.lastErrorRaw));
      }
      return new Promise<SweepDto>((resolve, reject) => {
        const list = waiters.get(queueId) ?? [];
        list.push({ resolve, reject });
        waiters.set(queueId, list);
      });
    },

    retryNow() {
      if (disposed) return Promise.resolve();
      return flush(true);
    },

    remove(queueId) {
      const index = items.findIndex((item) => item.id === queueId);
      if (index === -1) return;
      items.splice(index, 1);
      settle(queueId, { error: new Error('removed from the queue') });
      emit();
      if (flushing === null) schedule();
    },

    getSnapshot: snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    dispose() {
      disposed = true;
      clearTimer();
      for (const item of items) settle(item.id, { error: new Error('sweep queue disposed') });
      listeners.clear();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The app's shared queue                                                     */
/* -------------------------------------------------------------------------- */

let sharedQueue: SweepQueue | null = null;

/**
 * The one queue the screens share, lazily bound to a `send` function (pass
 * `(req) => getApi().createSweep(req)`). Later calls ignore `send` and return
 * the same queue, so a screen that remounts keeps its pending sweeps.
 */
export function getSweepQueue(send: SweepQueueOptions['send']): SweepQueue {
  if (sharedQueue === null) sharedQueue = createSweepQueue({ send });
  return sharedQueue;
}
