import { describe, expect, it } from 'vitest';

import {
  angularDistance,
  createHeadingFilter,
  headingFromReading,
  normalizeDeg,
  signedDelta,
} from './heading';

describe('normalizeDeg', () => {
  it('wraps into [0, 360)', () => {
    expect(normalizeDeg(0)).toBe(0);
    expect(normalizeDeg(360)).toBe(0);
    expect(normalizeDeg(-1)).toBe(359);
    expect(normalizeDeg(725)).toBe(5);
    expect(normalizeDeg(-360)).toBe(0);
    expect(Object.is(normalizeDeg(-0), 0)).toBe(true);
  });
});

describe('signedDelta / angularDistance', () => {
  it('takes the short way across 359 -> 0', () => {
    expect(signedDelta(359, 1)).toBe(2);
    expect(signedDelta(1, 359)).toBe(-2);
    expect(signedDelta(350, 10)).toBe(20);
    expect(angularDistance(355, 5)).toBe(10);
  });
  it('returns (-180, 180]', () => {
    expect(signedDelta(0, 180)).toBe(180);
    expect(signedDelta(180, 0)).toBe(180);
    expect(signedDelta(0, 181)).toBe(-179);
    expect(signedDelta(90, 90)).toBe(0);
  });
});

describe('headingFromReading', () => {
  it('prefers magnetic heading, falls back to true heading, else null', () => {
    expect(headingFromReading({ magHeading: 42, trueHeading: 50 })).toBe(42);
    expect(headingFromReading({ magHeading: -1, trueHeading: 50 })).toBe(50);
    expect(headingFromReading({ magHeading: -1, trueHeading: -1 })).toBeNull();
    expect(headingFromReading({ magHeading: Number.NaN, trueHeading: -1 })).toBeNull();
    expect(headingFromReading({ magHeading: 360, trueHeading: -1 })).toBe(0);
  });
});

describe('createHeadingFilter', () => {
  it('seeds with the first reading unfiltered', () => {
    const f = createHeadingFilter(0.25);
    expect(f.value()).toBeNull();
    expect(f.push(123)).toBe(123);
  });

  it('smooths toward the new reading by alpha', () => {
    const f = createHeadingFilter(0.5);
    f.push(0);
    expect(f.push(20)).toBeCloseTo(10, 9);
    expect(f.push(20)).toBeCloseTo(15, 9);
  });

  it('crosses 359 -> 0 without swinging through 180', () => {
    const f = createHeadingFilter(0.5);
    f.push(358);
    const v = f.push(2)!;
    expect(v).toBeCloseTo(0, 9);
    const w = f.push(2)!;
    expect(w).toBeCloseTo(1, 9);
    // Naive averaging would give ~180; the filter must stay within 5° of north.
    for (const x of [f.push(359)!, f.push(1)!, f.push(358)!]) {
      expect(angularDistance(x, 0)).toBeLessThan(5);
    }
  });

  it('crosses 0 -> 359 going counter-clockwise', () => {
    const f = createHeadingFilter(0.5);
    f.push(2);
    expect(f.push(356)).toBeCloseTo(359, 9);
  });

  it('converges on a steady heading on the far side of the wrap', () => {
    const f = createHeadingFilter(0.25);
    f.push(350);
    let v = 0;
    for (let i = 0; i < 60; i++) v = f.push(10)!;
    expect(angularDistance(v, 10)).toBeLessThan(0.01);
  });

  it('keeps output in [0, 360)', () => {
    const f = createHeadingFilter(0.3);
    const seq = [355, 5, 350, 15, 359, 0, 1, 358];
    for (const x of seq) {
      const v = f.push(x)!;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(360);
    }
  });

  it('ignores non-finite input and supports reset', () => {
    const f = createHeadingFilter();
    f.push(90);
    expect(f.push(Number.NaN)).toBe(90);
    f.reset();
    expect(f.value()).toBeNull();
    expect(f.push(270)).toBe(270);
  });

  it('rejects an alpha outside (0, 1]', () => {
    expect(() => createHeadingFilter(0)).toThrow(RangeError);
    expect(() => createHeadingFilter(1.5)).toThrow(RangeError);
    expect(() => createHeadingFilter(1)).not.toThrow();
  });
});
