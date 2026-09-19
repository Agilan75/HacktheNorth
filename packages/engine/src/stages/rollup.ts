/** Stage 3 — rollup. Body owned by Run 1 unit E03. */
import type { CanonicalSubmission, Rollup } from '../types.js';

/**
 * `asOf` is an ISO-8601 date. The five-year loss window is
 * (asOf - 5 years, asOf], inclusive of both endpoints as pinned in
 * INTERPRETATIONS.md I-4. The engine never reads the clock.
 */
export function rollup(_submission: CanonicalSubmission, _asOf: string): Rollup {
  throw new Error('NOT_IMPLEMENTED:E03');
}
