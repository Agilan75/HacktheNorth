/**
 * Retrofit engine — pure math helpers. FULLY IMPLEMENTED in Run 0.
 *
 * Rules: no I/O, no `Date.now`, no `Math.random`, no mutation of arguments.
 * Every function is total: it returns a number or null for every input,
 * including NaN, Infinity, empty arrays and null entries.
 *
 * The exact definitions here are part of the differential-test contract and are
 * restated in `docs/contracts/INTERPRETATIONS.md` (section M).
 */

import { RATIO_TOLERANCE, SCORE_TOLERANCE } from '../constants.js';

/* -------------------------------------------------------------------------- */
/* Guards                                                                     */
/* -------------------------------------------------------------------------- */

/** True for a real, finite number. Rejects NaN, ±Infinity, null, undefined. */
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Every finite number in `xs`, in order. Nulls, NaN and Infinity are dropped. */
export function finiteOnly(xs: readonly (number | null | undefined)[]): number[] {
  const out: number[] = [];
  for (const x of xs) {
    if (isFiniteNumber(x)) out.push(x);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Clamping                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Clamp `v` into [lo, hi]. If `lo > hi` the bounds are swapped.
 * Non-finite `v` returns `lo`.
 */
export function clamp(v: number, lo: number, hi: number): number {
  const min = lo <= hi ? lo : hi;
  const max = lo <= hi ? hi : lo;
  if (!isFiniteNumber(v)) return min;
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

/** Clamp into [0, 1]. Non-finite returns 0. */
export function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

/* -------------------------------------------------------------------------- */
/* Scaling                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The "log" scaling of PRD 6.4 (TIV, quoted premium).
 * `logScale(x) = ln(max(x, 1))`, so the result is always >= 0 and the function
 * is defined at 0 and for negatives (both map to 0). Monotonic non-decreasing.
 */
export function logScale(x: number): number {
  if (!isFiniteNumber(x)) return 0;
  return Math.log(x < 1 ? 1 : x);
}

/**
 * The "log(1 + x)" scaling of PRD 6.4 (five-year loss).
 * `log1pScale(x) = ln(1 + max(x, 0))`. Monotonic non-decreasing, 0 at 0.
 */
export function log1pScale(x: number): number {
  if (!isFiniteNumber(x)) return 0;
  return Math.log1p(x < 0 ? 0 : x);
}

/**
 * Min-max to [0, 1], clamped. A degenerate range (max - min <= RATIO_TOLERANCE)
 * returns 0 for every input, so an entire book of identical values contributes
 * nothing to a distance.
 */
export function minMax(v: number, min: number, max: number): number {
  if (!isFiniteNumber(v) || !isFiniteNumber(min) || !isFiniteNumber(max)) return 0;
  const span = max - min;
  if (span <= RATIO_TOLERANCE) return 0;
  return clamp01((v - min) / span);
}

/** `v / divisor`, clamped to [0, 1]. A zero or non-finite divisor returns 0. */
export function divideScale(v: number, divisor: number): number {
  if (!isFiniteNumber(v) || !isFiniteNumber(divisor) || divisor === 0) return 0;
  return clamp01(v / divisor);
}

/** Linear interpolation. `t` is clamped to [0, 1]. */
export function lerp(a: number, b: number, t: number): number {
  if (!isFiniteNumber(a) || !isFiniteNumber(b)) return 0;
  return a + (b - a) * clamp01(t);
}

/* -------------------------------------------------------------------------- */
/* Arithmetic                                                                 */
/* -------------------------------------------------------------------------- */

/** Sum of the finite entries. Empty returns 0. */
export function sum(xs: readonly (number | null | undefined)[]): number {
  let total = 0;
  for (const x of xs) {
    if (isFiniteNumber(x)) total += x;
  }
  return total;
}

/** Arithmetic mean of the finite entries, or null when there are none. */
export function mean(xs: readonly (number | null | undefined)[]): number | null {
  const vs = finiteOnly(xs);
  if (vs.length === 0) return null;
  return sum(vs) / vs.length;
}

/**
 * Median of the finite entries, or null when there are none.
 * Even counts return the mean of the two middle values.
 */
export function median(xs: readonly (number | null | undefined)[]): number | null {
  const vs = finiteOnly(xs).sort((a, b) => a - b);
  if (vs.length === 0) return null;
  const mid = vs.length >> 1;
  if (vs.length % 2 === 1) return vs[mid] as number;
  return ((vs[mid - 1] as number) + (vs[mid] as number)) / 2;
}

/**
 * Linear-interpolated percentile, `p` in [0, 1]. Matches the "type 7" /
 * `numpy.percentile` default so a second implementation can reproduce it.
 * Null when there are no finite entries.
 */
export function percentile(xs: readonly (number | null | undefined)[], p: number): number | null {
  const vs = finiteOnly(xs).sort((a, b) => a - b);
  if (vs.length === 0) return null;
  if (vs.length === 1) return vs[0] as number;
  const pos = clamp01(p) * (vs.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return vs[lo] as number;
  return (vs[lo] as number) + ((vs[hi] as number) - (vs[lo] as number)) * (pos - lo);
}

/** Population variance of the finite entries, or null when there are none. */
export function variance(xs: readonly (number | null | undefined)[]): number | null {
  const vs = finiteOnly(xs);
  if (vs.length === 0) return null;
  const mu = sum(vs) / vs.length;
  let acc = 0;
  for (const v of vs) acc += (v - mu) * (v - mu);
  return acc / vs.length;
}

/** Population standard deviation, or null when there are no finite entries. */
export function stdDev(xs: readonly (number | null | undefined)[]): number | null {
  const v = variance(xs);
  return v === null ? null : Math.sqrt(v);
}

/** `a / b`, or null when `b` is 0 or either side is not finite. */
export function safeDiv(a: number | null | undefined, b: number | null | undefined): number | null {
  if (!isFiniteNumber(a) || !isFiniteNumber(b)) return null;
  if (b === 0) return null;
  const r = a / b;
  return Number.isFinite(r) ? r : null;
}

/**
 * Dot product over the entries where BOTH sides are finite. Entries where
 * either side is null are skipped and contribute nothing (PRD 6.5: a missing
 * component is never imputed).
 */
export function dot(
  a: readonly (number | null | undefined)[],
  b: readonly (number | null | undefined)[],
): number {
  const n = Math.min(a.length, b.length);
  let acc = 0;
  for (let i = 0; i < n; i += 1) {
    const ai = a[i];
    const bi = b[i];
    if (isFiniteNumber(ai) && isFiniteNumber(bi)) acc += ai * bi;
  }
  return acc;
}

/** Round half away from zero to `digits` decimal places. Deterministic. */
export function roundTo(v: number, digits: number): number {
  if (!isFiniteNumber(v)) return 0;
  const d = Math.max(0, Math.min(15, Math.trunc(digits)));
  const factor = 10 ** d;
  const scaled = v * factor;
  const r = scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
  return r / factor;
}

/** |a - b| <= tol. Two non-finite values are never approximately equal. */
export function approxEqual(a: number, b: number, tol: number = SCORE_TOLERANCE): boolean {
  if (!isFiniteNumber(a) || !isFiniteNumber(b)) return false;
  return Math.abs(a - b) <= tol;
}

/* -------------------------------------------------------------------------- */
/* Distance                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Scaled Euclidean distance over a presence mask (PRD 6.4 peers).
 *
 * A component is compared only when `maskA[i] === 1`, `maskB[i] === 1`, both
 * values are finite, and `include` (when given) contains `i`. The squared
 * differences are averaged over the number compared and square-rooted, so the
 * result does not grow with the number of known components:
 *
 *   d = sqrt( sum_i (a_i - b_i)^2 / nCompared )
 *
 * Returns null when nothing could be compared. Symmetric by construction, and
 * exactly 0 for identical inputs.
 */
export function scaledEuclidean(
  a: readonly (number | null | undefined)[],
  b: readonly (number | null | undefined)[],
  maskA: readonly (0 | 1)[],
  maskB: readonly (0 | 1)[],
  include?: readonly number[],
): { distance: number; comparedComponents: number } | null {
  const n = Math.min(a.length, b.length, maskA.length, maskB.length);
  const allowed = include === undefined ? null : new Set(include);
  let acc = 0;
  let compared = 0;
  for (let i = 0; i < n; i += 1) {
    if (allowed !== null && !allowed.has(i)) continue;
    if (maskA[i] !== 1 || maskB[i] !== 1) continue;
    const ai = a[i];
    const bi = b[i];
    if (!isFiniteNumber(ai) || !isFiniteNumber(bi)) continue;
    const d = ai - bi;
    acc += d * d;
    compared += 1;
  }
  if (compared === 0) return null;
  return { distance: Math.sqrt(acc / compared), comparedComponents: compared };
}

/* -------------------------------------------------------------------------- */
/* Monotonic helpers                                                          */
/* -------------------------------------------------------------------------- */

export type MonotonicDirection = 'non_decreasing' | 'non_increasing';

/**
 * True when the finite entries are monotonic in `direction`, allowing ties.
 * Non-finite entries are skipped. Fewer than two finite entries is monotonic.
 */
export function isMonotonic(
  xs: readonly (number | null | undefined)[],
  direction: MonotonicDirection = 'non_decreasing',
  tol: number = SCORE_TOLERANCE,
): boolean {
  const vs = finiteOnly(xs);
  for (let i = 1; i < vs.length; i += 1) {
    const prev = vs[i - 1] as number;
    const cur = vs[i] as number;
    if (direction === 'non_decreasing') {
      if (cur - prev < -tol) return false;
    } else if (prev - cur < -tol) return false;
  }
  return true;
}

/**
 * Pool-adjacent-violators: the weighted least-squares fit to `values` that is
 * monotonic non-decreasing. Used by the rating fit (E15) so a worse class is
 * never cheaper. Pass `direction: 'non_increasing'` to fit the other way.
 *
 * Non-finite values are treated as 0 with weight 0. Weights default to 1 and
 * negative or non-finite weights are treated as 0. The input is not mutated.
 */
export function poolAdjacentViolators(
  values: readonly (number | null | undefined)[],
  weights?: readonly (number | null | undefined)[],
  direction: MonotonicDirection = 'non_decreasing',
): number[] {
  const n = values.length;
  if (n === 0) return [];

  const flip = direction === 'non_increasing';
  const v: number[] = new Array<number>(n);
  const w: number[] = new Array<number>(n);
  for (let i = 0; i < n; i += 1) {
    const src = values[flip ? n - 1 - i : i];
    const wsrc = weights === undefined ? 1 : weights[flip ? n - 1 - i : i];
    const wv = isFiniteNumber(wsrc) && wsrc > 0 ? wsrc : 0;
    v[i] = isFiniteNumber(src) ? src : 0;
    w[i] = isFiniteNumber(src) ? wv : 0;
  }

  // Blocks of equal fitted value, held as running weighted means.
  const blockValue: number[] = [];
  const blockWeight: number[] = [];
  const blockSize: number[] = [];
  for (let i = 0; i < n; i += 1) {
    let value = v[i] as number;
    let weight = w[i] as number;
    let size = 1;
    while (blockValue.length > 0 && (blockValue[blockValue.length - 1] as number) > value) {
      const pv = blockValue.pop() as number;
      const pw = blockWeight.pop() as number;
      const ps = blockSize.pop() as number;
      const totalW = pw + weight;
      value = totalW > 0 ? (pv * pw + value * weight) / totalW : (pv + value) / 2;
      weight = totalW;
      size += ps;
    }
    blockValue.push(value);
    blockWeight.push(weight);
    blockSize.push(size);
  }

  const out: number[] = [];
  for (let b = 0; b < blockValue.length; b += 1) {
    const size = blockSize[b] as number;
    for (let k = 0; k < size; k += 1) out.push(blockValue[b] as number);
  }
  return flip ? out.reverse() : out;
}

/* -------------------------------------------------------------------------- */
/* Angles (sweep geometry support)                                            */
/* -------------------------------------------------------------------------- */

/** Normalize any bearing to [0, 360). Non-finite returns 0. */
export function normalizeDeg(deg: number): number {
  if (!isFiniteNumber(deg)) return 0;
  const r = deg % 360;
  return r < 0 ? r + 360 : r;
}

/** Smallest absolute separation between two bearings, in [0, 180]. */
export function angularSeparationDeg(a: number, b: number): number {
  const d = Math.abs(normalizeDeg(a) - normalizeDeg(b));
  return d > 180 ? 360 - d : d;
}
