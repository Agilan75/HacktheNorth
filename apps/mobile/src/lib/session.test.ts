import { describe, expect, it, vi } from 'vitest';

import { MAX_FRAMES } from './capture';
import {
  buildCreateRequest,
  createSessionStore,
  initialSession,
  isTermMonths,
  sessionStore,
  stripDataUrl,
  type SessionFrame,
  type TermMonths,
} from './session';

const frame = (bearingDeg: number, extra: Partial<SessionFrame> = {}): SessionFrame => ({
  bearingDeg,
  capturedAt: '2026-09-19T12:00:00.000Z',
  imageBase64: 'AAAA',
  ...extra,
});

describe('session store', () => {
  it('starts blank with a 12-month term', () => {
    const s = createSessionStore().getState();
    expect(s).toEqual({ roomLabel: '', termMonths: 12, submissionId: null, source: null, frames: [], sweepId: null });
  });

  it('holds room label, term, submission and sweep id', () => {
    const store = createSessionStore();
    store.setRoomLabel('Kitchen');
    store.setTerm(4);
    store.attachSubmission('  sub_123 ');
    store.setSweepId('sw_1');
    expect(store.getState()).toMatchObject({ roomLabel: 'Kitchen', termMonths: 4, submissionId: 'sub_123', sweepId: 'sw_1' });
    store.attachSubmission('   ');
    expect(store.getState().submissionId).toBeNull();
    store.attachSubmission(null);
    expect(store.getState().submissionId).toBeNull();
  });

  it('accepts only 4, 8 or 12 months', () => {
    const store = createSessionStore();
    for (const t of [4, 8, 12] as const) {
      store.setTerm(t);
      expect(store.getState().termMonths).toBe(t);
    }
    expect(() => store.setTerm(6 as TermMonths)).toThrow(RangeError);
    expect(isTermMonths(8)).toBe(true);
    expect(isTermMonths('8')).toBe(false);
  });

  it('keeps frames with their bearings, normalised, capped at 15', () => {
    const store = createSessionStore();
    store.addFrame(frame(0));
    store.addFrame(frame(370));
    store.addFrame(frame(-10));
    expect(store.getState().frames.map((f) => f.bearingDeg)).toEqual([0, 10, 350]);
    expect(store.getState().source).toBe('sweep');
    for (let i = 0; i < 20; i++) store.addFrame(frame(i * 10));
    expect(store.getState().frames).toHaveLength(MAX_FRAMES);
  });

  it('upload replaces frames; a sweep after an upload starts over', () => {
    const store = createSessionStore();
    store.addFrame(frame(0));
    store.setFrames([frame(0), frame(120), frame(240)], 'upload');
    expect(store.getState().source).toBe('upload');
    expect(store.getState().frames.map((f) => f.bearingDeg)).toEqual([0, 120, 240]);
    store.addFrame(frame(30));
    expect(store.getState().source).toBe('sweep');
    expect(store.getState().frames.map((f) => f.bearingDeg)).toEqual([30]);
    store.setFrames(Array.from({ length: 20 }, (_, i) => frame(i)), 'upload');
    expect(store.getState().frames).toHaveLength(MAX_FRAMES);
    store.clearFrames();
    expect(store.getState()).toMatchObject({ frames: [], source: null });
  });

  it('strips a data: URL prefix from images', () => {
    expect(stripDataUrl('data:image/jpeg;base64,QUJD')).toBe('QUJD');
    expect(stripDataUrl('QUJD')).toBe('QUJD');
    const store = createSessionStore();
    store.addFrame(frame(0, { imageBase64: 'data:image/png;base64,Wlla' }));
    expect(store.getState().frames[0]?.imageBase64).toBe('Wlla');
  });

  it('notifies subscribers and stops after unsubscribe', () => {
    const store = createSessionStore();
    const l = vi.fn();
    const off = store.subscribe(l);
    store.setRoomLabel('Bedroom');
    expect(l).toHaveBeenCalledTimes(1);
    off();
    store.setRoomLabel('Den');
    expect(l).toHaveBeenCalledTimes(1);
  });

  it('reset returns to the blank session', () => {
    const store = createSessionStore();
    store.setRoomLabel('Kitchen');
    store.addFrame(frame(0));
    store.reset();
    expect(store.getState()).toBe(initialSession);
  });

  it('exports an app-wide singleton', () => {
    expect(sessionStore.getState()).toBe(initialSession);
  });
});

describe('buildCreateRequest', () => {
  it('lists every reason it cannot send yet', () => {
    const r = buildCreateRequest(initialSession);
    expect(r).toEqual({ ok: false, problems: ['room-label-missing', 'no-frames'] });
  });

  it('rejects an over-long room label', () => {
    const r = buildCreateRequest({ ...initialSession, roomLabel: 'x'.repeat(121), frames: [frame(0)] });
    expect(r).toEqual({ ok: false, problems: ['room-label-too-long'] });
  });

  it('builds the POST /sweeps body', () => {
    const store = createSessionStore();
    store.setRoomLabel('  Kitchen ');
    store.setTerm(8);
    store.attachSubmission('sub_9');
    store.addFrame(frame(0, { pitchDeg: 5 }));
    store.addFrame(frame(120, { pitchDeg: 120, uri: 'file://x.jpg' }));
    const r = buildCreateRequest(store.getState());
    expect(r).toEqual({
      ok: true,
      request: {
        roomLabel: 'Kitchen',
        termMonths: 8,
        submissionId: 'sub_9',
        frames: [
          { bearingDeg: 0, pitchDeg: 5, capturedAt: '2026-09-19T12:00:00.000Z', imageBase64: 'AAAA' },
          { bearingDeg: 120, pitchDeg: 90, capturedAt: '2026-09-19T12:00:00.000Z', imageBase64: 'AAAA' },
        ],
      },
    });
  });

  it('omits submissionId when none is attached', () => {
    const r = buildCreateRequest({ ...initialSession, roomLabel: 'Den', frames: [frame(0)] });
    expect(r.ok && 'submissionId' in r.request).toBe(false);
  });
});
