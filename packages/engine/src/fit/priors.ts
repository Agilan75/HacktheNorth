/**
 * Monotonic priors for the commercial rating fit. Body owned by Run 1 unit E15.
 *
 * With only 27 property policies the fit is thin (PRD 6.7 and the risk table in
 * PRD 16), so every factor family carries a prior ordering that the fit may
 * scale but never invert.
 */
import type { FitOptions } from './least-squares.js';

/** Construction classes worst-to-best, and the other factor families likewise. */
export function commercialPriors(): FitOptions['monotonicOrder'] {
  throw new Error('NOT_IMPLEMENTED:E15');
}

/** Starting factor values, used when a class has too few observations to fit. */
export function priorFactors(): Readonly<Record<string, Readonly<Record<string, number>>>> {
  throw new Error('NOT_IMPLEMENTED:E15');
}
