import type { Prng } from '../types.js';

/**
 * Seeded PRNG (V02). Deterministic: the same seed must reproduce the same
 * stream on every machine and in every worker, because a disagreement is
 * reported by seed + index and has to be replayable.
 *
 * Algorithm: sfc32 (Small Fast Counter, 128-bit state, 32-bit output), with
 * its state expanded from the seed by splitmix32. Pure 32-bit integer
 * arithmetic (`Math.imul`, `>>>`), so the stream is bit-identical in every
 * JS engine. No `Math.random()`, no clock.
 */

const TWO_POW_32 = 4294967296;

/**
 * Folds any JS number into a uint32 without discarding its high bits, so
 * `2**32 + 1` and `1` are different seeds. Non-finite seeds fold to 0.
 */
function foldSeed(seed: number): number {
  if (!Number.isFinite(seed)) return 0;
  const whole = Math.trunc(seed);
  const lo = whole >>> 0;
  const hi = Math.floor(whole / TWO_POW_32) >>> 0;
  // The fractional part is folded in too, so 1.5 and 1 differ.
  const frac = Math.floor((seed - whole) * TWO_POW_32) >>> 0;
  return (lo ^ Math.imul(hi, 0x9e3779b1) ^ Math.imul(frac, 0x85ebca6b)) >>> 0;
}

/** splitmix32 step: returns the next state and a well-mixed output. */
function splitmix32(state: number): { state: number; out: number } {
  const next = (state + 0x9e3779b9) >>> 0;
  let z = next;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  z = (z ^ (z >>> 15)) >>> 0;
  return { state: next, out: z };
}

export function createPrng(seed: number): Prng {
  let sm = foldSeed(seed);
  const words: number[] = [];
  for (let i = 0; i < 4; i++) {
    const step = splitmix32(sm);
    sm = step.state;
    words.push(step.out);
  }
  let a = words[0] ?? 0;
  let b = words[1] ?? 0;
  let c = words[2] ?? 0;
  let d = words[3] ?? 1;

  const nextU32 = (): number => {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    c = (c + t) >>> 0;
    return t;
  };

  // Discard the first outputs so near-identical seeds diverge fully.
  for (let i = 0; i < 12; i++) nextU32();

  const next = (): number => nextU32() / TWO_POW_32;

  return {
    seed,
    next,
    int(min: number, max: number): number {
      const lo = Math.ceil(min);
      const hi = Math.floor(max);
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) {
        throw new RangeError(`prng.int: empty or non-finite range [${min}, ${max}]`);
      }
      return lo + Math.floor(next() * (hi - lo + 1));
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new RangeError('prng.pick: empty array');
      return items[Math.floor(next() * items.length)] as T;
    },
    chance(p: number): boolean {
      // Always draw, so the stream position does not depend on p.
      const r = next();
      return r < p;
    },
  };
}

/** FNV-1a over the UTF-16 code units of a label. */
function hashLabel(label: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Derives a stable child seed, e.g. per chunk or per component. */
export function deriveSeed(seed: number, label: string): number {
  let z = (foldSeed(seed) ^ Math.imul(hashLabel(label), 0x9e3779b1)) >>> 0;
  // murmur3 fmix32 finaliser.
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  return (z ^ (z >>> 16)) >>> 0;
}
