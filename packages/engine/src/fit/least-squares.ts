/**
 * Monotonic least-squares fitting for the commercial rating table.
 * Body owned by Run 1 unit E15. Pure: no I/O, no Date.now, no Math.random.
 *
 * PRD 6.7 — factors are fitted once against `technical_premium`, constrained so
 * that a worse class is never cheaper, then frozen into `rating/commercial.json`.
 * The engine only ever reads the frozen file; nothing calls this at runtime.
 */
import type { CommercialRatingTable, FitError } from '../types.js';

/** One fitted observation: the raw feature row plus the premium to fit against. */
export interface FitRow {
  readonly tiv: number;
  readonly constructionClass: string;
  readonly yearBuilt: number;
  readonly protectionClass: number | null;
  readonly sprinklered: boolean | null;
  readonly fiveYearLoss: number;
  readonly technicalPremium: number;
}

export interface FitOptions {
  /** Ordered worst-to-best; the fit forces factors to be non-increasing along it. */
  readonly monotonicOrder: Readonly<Record<string, readonly string[]>>;
  readonly maxIterations: number;
  readonly tolerance: number;
}

/**
 * Fit multiplicative rating factors by iteratively reweighted least squares in
 * log space, projecting onto the monotonic cone after each pass.
 */
export function fitMonotonic(
  _rows: readonly FitRow[],
  _options: FitOptions,
): { table: CommercialRatingTable; error: FitError } {
  throw new Error('NOT_IMPLEMENTED:E15');
}

/** Pool-adjacent-violators: the monotonic projection used after each pass. */
export function isotonic(_values: readonly number[], _weights: readonly number[]): number[] {
  throw new Error('NOT_IMPLEMENTED:E15');
}

/** Mean absolute percentage error and R squared, reported on screen per PRD 6.7. */
export function fitError(_actual: readonly number[], _predicted: readonly number[]): FitError {
  throw new Error('NOT_IMPLEMENTED:E15');
}
