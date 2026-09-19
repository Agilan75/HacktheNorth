import { describe, expect, it } from 'vitest';
import { wilsonInterval } from './wilson.js';

describe('wilsonInterval', () => {
  it('matches the closed form at 95% (z = 1.959963984540054)', () => {
    const w = wilsonInterval(8, 10);
    expect(w.point).toBe(0.8);
    expect(w.low).toBeCloseTo(0.4901624715366418, 7);
    expect(w.high).toBeCloseTo(0.9433178485456248, 7);
    expect(w.n).toBe(10);
    expect(w.confidence).toBe(0.95);
  });

  it('is symmetric about one half at 50/100', () => {
    const w = wilsonInterval(50, 100);
    expect(w.low).toBeCloseTo(0.4038315303659956, 7);
    expect(w.high).toBeCloseTo(0.5961684696340044, 7);
    expect(w.low + w.high).toBeCloseTo(1, 12);
  });

  it('handles a layer-C-sized sample', () => {
    const w = wilsonInterval(1900, 2038);
    expect(w.low).toBeCloseTo(0.9205448986502247, 7);
    expect(w.high).toBeCloseTo(0.9424016305174601, 7);
  });

  it('pins the bounds to exactly 0 and 1 at the extremes', () => {
    const none = wilsonInterval(0, 10);
    expect(none.low).toBe(0);
    expect(none.high).toBeCloseTo(0.2775327998628892, 7);
    const all = wilsonInterval(10, 10);
    expect(all.high).toBe(1);
    expect(all.low).toBeCloseTo(0.7224672001371107, 7);
  });

  it('widens at 99%', () => {
    const w = wilsonInterval(8, 10, 0.99);
    expect(w.low).toBeCloseTo(0.4008186965216716, 6);
    expect(w.high).toBeCloseTo(0.9598688474953836, 6);
    expect(w.confidence).toBe(0.99);
  });

  it('returns the whole unit interval for zero trials', () => {
    expect(wilsonInterval(0, 0)).toEqual({ point: 0, low: 0, high: 1, n: 0, confidence: 0.95 });
  });

  it('rejects impossible inputs', () => {
    expect(() => wilsonInterval(11, 10)).toThrow(RangeError);
    expect(() => wilsonInterval(-1, 10)).toThrow(RangeError);
    expect(() => wilsonInterval(1.5, 10)).toThrow(RangeError);
    expect(() => wilsonInterval(1, 10, 1)).toThrow(RangeError);
    expect(() => wilsonInterval(1, 10, 0)).toThrow(RangeError);
  });
});
