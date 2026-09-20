import { describe, expect, it } from 'vitest';

import { factorOf, fieldSide, groupedOrder, isFromSubmission, isOnThreshold, paintField, randomCase, verdictOf } from './verification-field.js';

const byte = (verdict: number, factor: number, sub = false, at = false): number => verdict | (factor << 2) | (sub ? 64 : 0) | (at ? 128 : 0);

describe('the verification field', () => {
  it('decodes a case byte', () => {
    const b = byte(2, 5, true, true);
    expect([verdictOf(b), factorOf(b), isFromSubmission(b), isOnThreshold(b)]).toEqual([2, 5, true, true]);
    expect(isOnThreshold(byte(1, 0))).toBe(false);
  });

  it('groups like with like, keeps run order inside a band, and loses no case', () => {
    const cases = Uint8Array.from([byte(2, 1), byte(0, 0), byte(2, 3), byte(1, 2), byte(0, 0)]);
    const order = groupedOrder({ cases, scores: null, strata: null }, 'verdict');
    expect(Array.from(order)).toEqual([1, 4, 3, 0, 2]);
  });

  it('paints one pixel per case and washes what is not picked out', () => {
    const cases = Uint8Array.from([byte(0, 0, false, true), byte(0, 0)]);
    const side = fieldSide(cases.length);
    const out = new Uint32Array(side * side);
    paintField(out, { cases, scores: null, strata: null }, null, 'verdict', { kind: 'threshold' });
    expect(out[0]).not.toBe(out[1]);
    expect(out[2]).toBe(0);
    paintField(out, { cases, scores: null, strata: null }, null, 'verdict', { kind: 'none' });
    expect(out[0]).toBe(out[1]);
  });

  it('finds a random case of a kind, or gives up', () => {
    expect(randomCase(10, (i) => i === 7)).toBe(7);
    expect(randomCase(10, () => false)).toBeNull();
  });
});
