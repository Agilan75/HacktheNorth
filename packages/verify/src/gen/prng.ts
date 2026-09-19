import type { Prng } from '../types.js';

/**
 * Seeded PRNG (V02). Deterministic: the same seed must reproduce the same
 * stream on every machine and in every worker, because a disagreement is
 * reported by seed + index and has to be replayable.
 *
 * Stub frozen by W0-4; unit V02 replaces these bodies only.
 */
export function createPrng(_seed: number): Prng {
  throw new Error('NOT_IMPLEMENTED:V02');
}

/** Derives a stable child seed, e.g. per chunk or per component. */
export function deriveSeed(_seed: number, _label: string): number {
  throw new Error('NOT_IMPLEMENTED:V02');
}
