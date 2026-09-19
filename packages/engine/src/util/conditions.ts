/**
 * Condition operators (PRD 6.6). Body owned by Run 1 unit E01.
 * Signatures frozen by W0-2.
 */

import type { Condition, FeatureVector, VectorSpec } from '../types.js';

/** Resolve a condition field to a number/string/boolean from the vector or the rollup context. */
export type ConditionResolver = (field: string) => unknown;

/** Evaluate one condition. A missing operand makes every op except `missing` false. */
export function evaluateCondition(_condition: Condition, _resolve: ConditionResolver): boolean {
  throw new Error('NOT_IMPLEMENTED:E01');
}

/** AND over every condition. An empty list is false, never vacuously true. */
export function evaluateConditions(
  _conditions: readonly Condition[],
  _resolve: ConditionResolver,
): boolean {
  throw new Error('NOT_IMPLEMENTED:E01');
}

/** True when any condition's operand is missing, so the rule is undetermined. */
export function isUndetermined(
  _conditions: readonly Condition[],
  _resolve: ConditionResolver,
): boolean {
  throw new Error('NOT_IMPLEMENTED:E01');
}

/** A resolver over a feature vector plus its spec, addressing components by key. */
export function vectorResolver(_vector: FeatureVector, _spec: VectorSpec): ConditionResolver {
  throw new Error('NOT_IMPLEMENTED:E01');
}
