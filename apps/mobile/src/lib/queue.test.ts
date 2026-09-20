import { describe, expect, it } from 'vitest';
import type { SweepCreateRequestDto, SweepDto } from '@retrofit/contracts';
import { ApiError } from './api';
import {
  QUEUED_MESSAGE,
  createSweepQueue,
  queueStatusMessage,
  type QueueClock,
  type QueueSnapshot,
} from './queue';

/** A manual clock: timers fire only when `advance` passes them. */
function fakeClock() {
  let now = 1_000_000;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: QueueClock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (handle) => {
      timers.delete(handle as number);
    },
  };
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 10; i += 1) await new Promise<void>((r) => setImmediate(r));
  };
  const advance = async (ms: number): Promise<void> => {
    const target = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (due === undefined) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
      await settle();
    }
    now = target;
    await settle();
  };
  return { clock, advance, settle, pendingTimers: () => timers.size };
}

const offline = (): ApiError => new ApiError({ kind: 'network', message: 'Network request failed' });
const rejected = (): ApiError => new ApiError({ kind: 'http', status: 422, message: 'bad' });

function request(label: string): SweepCreateRequestDto {
  return {
    roomLabel: label,
    termMonths: 12,
    frames: [{ bearingDeg: 0, capturedAt: '2026-09-19T00:00:00.000Z', imageBase64: 'AAAA' }],
  };
}

/** The server's defaults for the two fields the phone no longer collects. */
const labelOf = (req: SweepCreateRequestDto): string => req.roomLabel ?? 'Room';
const termOf = (req: SweepCreateRequestDto): number => req.termMonths ?? 12;

function sweepFor(req: SweepCreateRequestDto): SweepDto {
  return {
    id: `sw_${labelOf(req)}`,
    submissionId: null,
    roomLabel: labelOf(req),
    termMonths: termOf(req),
    stage: 'received',
    frames: [],
    coverage: null,
    observations: [],
    needsConfirmation: [],
    result: null,
    hazardCosts: [],
    pendingQuestion: null,
    askedQuestionIds: [],
    skippedCount: 0,
    error: null,
    createdAt: '2026-09-19T00:00:00.000Z',
    updatedAt: '2026-09-19T00:00:00.000Z',
  };
}

/** `send` backed by a switchable connection. */
function network() {
  const state = { online: true, failWith: null as (() => unknown) | null };
  const sent: string[] = [];
  const send = async (req: SweepCreateRequestDto): Promise<SweepDto> => {
    sent.push(labelOf(req));
    if (state.failWith !== null) throw state.failWith();
    if (!state.online) throw offline();
    return sweepFor(req);
  };
  return { state, sent, send };
}

// random() = 0 with jitter 0.3 -> delays of 0.7 * 2s * 2^(n-1): 1400, 2800, 5600, ...
const opts = { random: () => 0 };

describe('createSweepQueue', () => {
  it('sends straight through when online', async () => {
    const net = network();
    const { clock } = fakeClock();
    const q = createSweepQueue({ send: net.send, clock, ...opts });
    const out = await q.submit(request('kitchen'));
    expect(out).toEqual({ status: 'sent', sweep: sweepFor(request('kitchen')) });
    expect(q.getSnapshot()).toEqual({ items: [], pendingCount: 0 });
  });

  it('queues an offline sweep, retries with growing backoff, and delivers when back online', async () => {
    const net = network();
    net.state.online = false;
    const { clock, advance } = fakeClock();
    const q = createSweepQueue({ send: net.send, clock, ...opts });

    const out = await q.submit(request('kitchen'));
    expect(out.status).toBe('queued');
    if (out.status !== 'queued') throw new Error('unreachable');
    expect(out.message).toBe(QUEUED_MESSAGE);
    const delivered = q.waitFor(out.queueId);

    const snap = q.getSnapshot();
    expect(snap.pendingCount).toBe(1);
    expect(snap.items[0]).toMatchObject({ status: 'queued', attempts: 0, nextAttemptAt: 1_000_000 + 1_400 });
    expect(snap.items[0]?.lastError).toMatch(/offline/i);

    await advance(1_399);
    expect(net.sent).toEqual(['kitchen']);
    await advance(1);
    expect(net.sent).toEqual(['kitchen', 'kitchen']);
    // second background attempt is 2.8 s later
    expect(q.getSnapshot().items[0]?.nextAttemptAt).toBe(1_000_000 + 1_400 + 2_800);

    net.state.online = true;
    await advance(2_800);
    await expect(delivered).resolves.toMatchObject({ id: 'sw_kitchen' });
    const after = q.getSnapshot();
    expect(after.pendingCount).toBe(0);
    expect(after.items[0]).toMatchObject({ status: 'sent', attempts: 2, nextAttemptAt: null });
  });

  it('keeps retrying indefinitely, capped at the max delay', async () => {
    const net = network();
    net.state.online = false;
    const { clock, advance } = fakeClock();
    const q = createSweepQueue({ send: net.send, clock, ...opts, backoff: { maxDelayMs: 10_000, jitter: 0 } });
    await q.submit(request('bath'));
    await advance(10 * 60_000);
    // 2s, 4s, 8s, then every 10s for the rest of ten minutes
    expect(net.sent.length).toBeGreaterThan(55);
    expect(q.getSnapshot().pendingCount).toBe(1);
  });

  it('does not queue a sweep the server rejected', async () => {
    const net = network();
    net.state.failWith = rejected;
    const { clock } = fakeClock();
    const q = createSweepQueue({ send: net.send, clock, ...opts });
    const out = await q.submit(request('kitchen'));
    expect(out.status).toBe('failed');
    if (out.status !== 'failed') throw new Error('unreachable');
    expect(out.error).toBeInstanceOf(ApiError);
    expect(out.message).toMatch(/would not accept/i);
    expect(q.getSnapshot().pendingCount).toBe(0);
  });

  it('fails a queued sweep for good when the server later rejects it', async () => {
    const net = network();
    net.state.online = false;
    const { clock, advance, pendingTimers } = fakeClock();
    const q = createSweepQueue({ send: net.send, clock, ...opts });
    const out = await q.submit(request('kitchen'));
    if (out.status !== 'queued') throw new Error('expected queued');
    const delivered = q.waitFor(out.queueId);
    delivered.catch(() => undefined);

    net.state.failWith = rejected;
    await advance(1_400);
    await expect(delivered).rejects.toThrow(/would not accept/i);
    expect(q.getSnapshot().items[0]?.status).toBe('failed');
    expect(queueStatusMessage(q.getSnapshot())).toBe('One sweep could not be sent.');
    expect(pendingTimers()).toBe(0);
  });

  it('retryNow sends immediately without waiting for the timer', async () => {
    const net = network();
    net.state.online = false;
    const { clock } = fakeClock();
    const q = createSweepQueue({ send: net.send, clock, ...opts });
    const out = await q.submit(request('kitchen'));
    if (out.status !== 'queued') throw new Error('expected queued');
    net.state.online = true;
    await q.retryNow();
    await expect(q.waitFor(out.queueId)).resolves.toMatchObject({ id: 'sw_kitchen' });
    expect(net.sent).toEqual(['kitchen', 'kitchen']);
  });

  it('sends oldest first, and one offline failure defers the rest (one request per outage tick)', async () => {
    const net = network();
    net.state.online = false;
    const { clock, advance } = fakeClock();
    const q = createSweepQueue({ send: net.send, clock, ...opts });
    await q.submit(request('a'));
    await advance(100);
    await q.submit(request('b'));
    net.sent.length = 0;

    await advance(1_400); // a is due; it fails; b is pushed back with it
    expect(net.sent).toEqual(['a']);

    net.state.online = true;
    await q.retryNow();
    expect(net.sent).toEqual(['a', 'a', 'b']);
    expect(q.getSnapshot().pendingCount).toBe(0);
  });

  it('remove stops retrying and rejects waiters', async () => {
    const net = network();
    net.state.online = false;
    const { clock, advance, pendingTimers } = fakeClock();
    const q = createSweepQueue({ send: net.send, clock, ...opts });
    const out = await q.submit(request('kitchen'));
    if (out.status !== 'queued') throw new Error('expected queued');
    const waiting = q.waitFor(out.queueId);
    q.remove(out.queueId);
    await expect(waiting).rejects.toThrow(/removed/);
    expect(pendingTimers()).toBe(0);
    await advance(60_000);
    expect(net.sent).toEqual(['kitchen']);
  });

  it('notifies subscribers and stops after unsubscribe', async () => {
    const net = network();
    net.state.online = false;
    const { clock, advance } = fakeClock();
    const q = createSweepQueue({ send: net.send, clock, ...opts });
    const seen: QueueSnapshot[] = [];
    const off = q.subscribe((s) => seen.push(s));
    await q.submit(request('kitchen'));
    expect(seen.at(-1)?.pendingCount).toBe(1);
    await advance(1_400);
    expect(seen.some((s) => s.items[0]?.status === 'sending')).toBe(true);
    const count = seen.length;
    off();
    await advance(10_000);
    expect(seen.length).toBe(count);
  });

  it('drops sent items from the snapshot after keepSentMs', async () => {
    const net = network();
    net.state.online = false;
    const { clock, advance } = fakeClock();
    const q = createSweepQueue({ send: net.send, clock, ...opts, keepSentMs: 5_000 });
    await q.submit(request('kitchen'));
    net.state.online = true;
    await q.retryNow();
    expect(q.getSnapshot().items).toHaveLength(1);
    await advance(5_001);
    expect(q.getSnapshot().items).toHaveLength(0);
  });

  it('dispose clears timers and rejects waiters', async () => {
    const net = network();
    net.state.online = false;
    const { clock, pendingTimers } = fakeClock();
    const q = createSweepQueue({ send: net.send, clock, ...opts });
    const out = await q.submit(request('kitchen'));
    if (out.status !== 'queued') throw new Error('expected queued');
    const waiting = q.waitFor(out.queueId);
    q.dispose();
    await expect(waiting).rejects.toThrow(/disposed/);
    expect(pendingTimers()).toBe(0);
    await expect(q.submit(request('x'))).rejects.toThrow(/disposed/);
  });

  it('treats a timeout as offline', async () => {
    const { clock } = fakeClock();
    const q = createSweepQueue({
      send: async () => {
        throw new ApiError({ kind: 'timeout', message: 'slow' });
      },
      clock,
      ...opts,
    });
    expect((await q.submit(request('kitchen'))).status).toBe('queued');
  });

  it('rejects waitFor on an unknown id', async () => {
    const q = createSweepQueue({ send: async (r) => sweepFor(r), clock: fakeClock().clock });
    await expect(q.waitFor('nope')).rejects.toThrow(/no queued sweep/);
  });
});

describe('queueStatusMessage', () => {
  const item = (status: 'queued' | 'sending' | 'sent' | 'failed') => ({
    id: status,
    request: request('r'),
    status,
    enqueuedAt: 0,
    attempts: 0,
    nextAttemptAt: null,
    lastError: null,
    sweep: null,
  });
  it('says nothing when idle', () => {
    expect(queueStatusMessage({ items: [], pendingCount: 0 })).toBeNull();
    expect(queueStatusMessage({ items: [item('sent')], pendingCount: 0 })).toBeNull();
  });
  it('uses plain language for one and many', () => {
    expect(queueStatusMessage({ items: [item('queued')], pendingCount: 1 })).toBe(QUEUED_MESSAGE);
    expect(queueStatusMessage({ items: [item('queued'), item('queued')], pendingCount: 2 })).toMatch(
      /^2 sweeps are queued/,
    );
    expect(queueStatusMessage({ items: [item('sending')], pendingCount: 1 })).toBe('Sending your sweep…');
    expect(queueStatusMessage({ items: [item('failed'), item('failed')], pendingCount: 0 })).toBe(
      '2 sweeps could not be sent.',
    );
  });
});
