import type { GeneratedCase, StratifiedCase, Stratum } from '../types.js';

/**
 * Layer-C stratifier (V03): over-samples every threshold and every §6.6
 * ambiguity so that ~2,000 LLM calls say something, instead of 2,000 easy
 * cases agreeing.
 *
 * Stubs frozen by W0-4; unit V03 replaces these bodies only.
 */
export function strata(): readonly Stratum[] {
  throw new Error('NOT_IMPLEMENTED:V03');
}

export function stratifiedSample(
  _seed: number,
  _totalCases: number,
): readonly StratifiedCase[] {
  throw new Error('NOT_IMPLEMENTED:V03');
}

/** Which stratum a case belongs to, or null when it is an ordinary case. */
export function classifyStratum(_testCase: GeneratedCase): string | null {
  throw new Error('NOT_IMPLEMENTED:V03');
}
