/**
 * Monotonic priors for the commercial rating fit. Body owned by Run 1 unit E15.
 *
 * With only 27 property policies the fit is thin (PRD 6.7 and the risk table in
 * PRD 16), so every factor family carries a prior ordering that the fit may
 * scale but never invert.
 *
 * Construction keys are the eight live `Building.construction_type` values
 * (LIVE_DATA_FACTS "Enum values the rulebook must match"), spelled exactly as
 * the data spells them. Banded families use the level keys whose bounds live in
 * `least-squares.ts`. Rationale for every ordering: docs/decisions/E15.md.
 */
import type { FitOptions } from './least-squares.js';

const CONSTRUCTION_WORST_TO_BEST = [
  'Wood Frame',
  'Frame',
  'Joisted Masonry',
  'Non-Combustible',
  'Steel Frame',
  'Masonry Non-Combustible',
  'Modified Fire Resistive',
  'Fire Resistive',
] as const;

/** Oldest (worst) to newest (best). */
const AGE_WORST_TO_BEST = [
  'built_pre_1950',
  'built_1950_1969',
  'built_1970_1989',
  'built_1990_2009',
  'built_2010_plus',
] as const;

/** Public protection class 10 (worst) to 1-3 (best). */
const PROTECTION_WORST_TO_BEST = ['pc_10', 'pc_9', 'pc_7_8', 'pc_4_6', 'pc_1_3'] as const;

const SPRINKLER_WORST_TO_BEST = ['unsprinklered', 'sprinklered'] as const;

/** Largest five-year loss (worst) to none (best). */
const LOSS_WORST_TO_BEST = [
  'loss_over_250k',
  'loss_to_250k',
  'loss_to_100k',
  'loss_to_25k',
  'loss_none',
] as const;

/** Construction classes worst-to-best, and the other factor families likewise. */
export function commercialPriors(): FitOptions['monotonicOrder'] {
  return {
    construction: [...CONSTRUCTION_WORST_TO_BEST],
    age: [...AGE_WORST_TO_BEST],
    protectionClass: [...PROTECTION_WORST_TO_BEST],
    sprinkler: [...SPRINKLER_WORST_TO_BEST],
    lossHistory: [...LOSS_WORST_TO_BEST],
  };
}

/** Starting factor values, used when a class has too few observations to fit. */
export function priorFactors(): Readonly<Record<string, Readonly<Record<string, number>>>> {
  return {
    /** PRD 6.7: real rate runs $0.23–$0.66 per $100 TIV, median $0.40. */
    base: { baseRate: 0.4 },
    construction: {
      'Wood Frame': 1.35,
      Frame: 1.3,
      'Joisted Masonry': 1.12,
      'Non-Combustible': 1.0,
      'Steel Frame': 1.0,
      'Masonry Non-Combustible': 0.95,
      'Modified Fire Resistive': 0.85,
      'Fire Resistive': 0.8,
    },
    age: {
      built_pre_1950: 1.3,
      built_1950_1969: 1.2,
      built_1970_1989: 1.1,
      built_1990_2009: 1.0,
      built_2010_plus: 0.9,
    },
    protectionClass: {
      pc_10: 1.6,
      pc_9: 1.35,
      pc_7_8: 1.15,
      pc_4_6: 1.0,
      pc_1_3: 0.9,
    },
    sprinkler: {
      unsprinklered: 1.0,
      sprinklered: 0.85,
    },
    lossHistory: {
      loss_over_250k: 1.45,
      loss_to_250k: 1.25,
      loss_to_100k: 1.1,
      loss_to_25k: 1.0,
      loss_none: 0.95,
    },
  };
}
