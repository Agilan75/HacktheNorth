import type { GeneratedCase, LayerCFacts } from './types.js';

/**
 * Layer-C facts text (V07). The model is given the guideline text and the
 * rolled-up facts and nothing else: this function must never include a
 * verdict, a score, a tier, a rule id or any other engine output, or layer C
 * stops being an independent opinion.
 *
 * Stubs frozen by W0-4; unit V07 replaces these bodies only.
 */
export function factsForCase(_testCase: GeneratedCase): LayerCFacts {
  throw new Error('NOT_IMPLEMENTED:V07');
}

/** The guideline text handed to the model alongside the facts. */
export function guidelineBrief(): string {
  throw new Error('NOT_IMPLEMENTED:V07');
}
