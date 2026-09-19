/**
 * Sweep observation handling and pair rules — pure. Body owned by Run 1 unit E12.
 * Implements PRD 9.3 steps 3, 4 and 5, then PRD 6.3's pair rules.
 */
import type {
  CoverageResult,
  ExternalValue,
  HazardKey,
  Observation,
  PairRuleHit,
} from '../types.js';

/** Same label within DEDUPE_ANGLE_DEG merges, keeping max confidence. */
export function dedupeObservations(_observations: readonly Observation[]): Observation[] {
  throw new Error('NOT_IMPLEMENTED:E12');
}

/** Objects seen in both shuffled runs keep their confidence; single-run objects are halved. */
export function applySelfConsistency(
  _runA: readonly Observation[],
  _runB: readonly Observation[],
): Observation[] {
  throw new Error('NOT_IMPLEMENTED:E12');
}

/**
 * "No smoke detector" counts only when `ceilingVisible` held over at least
 * CEILING_COVERAGE_REQUIRED of the sweep. Otherwise the field stays unknown.
 */
export function negativeEvidence(
  _observations: readonly Observation[],
  _coverage: CoverageResult,
): { readonly path: string; readonly value: false; readonly confidence: number }[] {
  throw new Error('NOT_IMPLEMENTED:E12');
}

/** Engine pair rules from PAIR_RULES, run before the `relate` call. */
export function pairRules(_observations: readonly Observation[]): PairRuleHit[] {
  throw new Error('NOT_IMPLEMENTED:E12');
}

/** Turn observations plus pair hits into `hazards.*` values with sweep provenance. */
export function toHazardValues(
  _observations: readonly Observation[],
  _hits: readonly PairRuleHit[],
  _coverage: CoverageResult,
): ExternalValue[] {
  throw new Error('NOT_IMPLEMENTED:E12');
}

/** Hazard keys the observation set leaves unknown, for the VOI loop. */
export function unknownHazards(
  _observations: readonly Observation[],
  _coverage: CoverageResult,
): HazardKey[] {
  throw new Error('NOT_IMPLEMENTED:E12');
}
