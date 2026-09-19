import type { BoundaryPosition, GeneratedCase, Prng } from '../types.js';

/**
 * Vector-level case generator (V02): each component sampled just under, at and
 * just over every threshold in docs/contracts/INTERPRETATIONS.md §3, with
 * random presence masks and extreme values (0, negatives, huge numbers, NaN
 * through `null`).
 *
 * Stubs frozen by W0-4; unit V02 replaces these bodies only.
 */
export function generateCase(_seed: number, _index: number): GeneratedCase {
  throw new Error('NOT_IMPLEMENTED:V02');
}

export function generateCases(
  _seed: number,
  _startIndex: number,
  _count: number,
): readonly GeneratedCase[] {
  throw new Error('NOT_IMPLEMENTED:V02');
}

/** Samples one numeric component at a named position around a threshold. */
export function sampleAroundThreshold(
  _prng: Prng,
  _threshold: number,
  _position: BoundaryPosition,
): number {
  throw new Error('NOT_IMPLEMENTED:V02');
}

/** Every boundary value INTERPRETATIONS §3 and §8 require the run to hit. */
export function boundaryCatalogue(): readonly {
  readonly component: string;
  readonly threshold: number;
}[] {
  throw new Error('NOT_IMPLEMENTED:V02');
}
