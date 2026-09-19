import type { GeneratedCase, GeneratedSubmission } from '../types.js';

/**
 * Multi-building submission generator (V03): the smaller share of cases that
 * exercise rollup and vectorize as well as scoring. Policies hold up to 129
 * buildings, so the generator goes that wide.
 *
 * Stubs frozen by W0-4; unit V03 replaces these bodies only.
 */
export function generateSubmission(_seed: number, _index: number): GeneratedSubmission {
  throw new Error('NOT_IMPLEMENTED:V03');
}

/** Rolls a generated submission up into the flat facts the oracles compare. */
export function rollupGenerated(_submission: GeneratedSubmission): GeneratedCase {
  throw new Error('NOT_IMPLEMENTED:V03');
}
