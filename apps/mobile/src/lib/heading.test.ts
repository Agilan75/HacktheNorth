import { describe, expect, it } from 'vitest';

import {
  angularDistance,
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
