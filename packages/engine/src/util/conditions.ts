/**
 * Condition operators (PRD 6.6). Body owned by Run 1 unit E01.
 * Signatures frozen by W0-2.
 *
 * Semantics are fixed by INTERPRETATIONS.md G-1 (null/undefined/NaN/±Infinity
 * are MISSING, never 0), G-7 and G-8 (string comparison is trimmed and
 * case-insensitive, so `"oh"`, `" OH "` and `"OH"` are the same state and
 * `"Masonry Non-Combustible"` normalizes the same way on both sides).
 */

import type { Condition, ConditionValue, FeatureVector, VectorSpec } from '../types.js';
import { isFiniteNumber } from './math.js';

/** Resolve a condition field to a number/string/boolean from the vector or the rollup context. */
export type ConditionResolver = (field: string) => unknown;

/* -------------------------------------------------------------------------- */
/* Private helpers (HELPERS.md: private to this file, never exported)          */
/* -------------------------------------------------------------------------- */

type Scalar = number | string | boolean;

/** G-1: a value that is absent, NaN or ±Infinity is missing, never 0. */
function isMissing(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'number') return !isFiniteNumber(v);
  return false;
}

/** G-7/G-8: strings compare trimmed and case-folded. */
function normalizeString(s: string): string {
  return s.trim().toLowerCase();
}

function isScalar(v: unknown): v is Scalar {
  return typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean';
}

/** Strict scalar equality, with the string normalization of G-7/G-8. */
function scalarEquals(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string') {
    return normalizeString(a) === normalizeString(b);
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return isFiniteNumber(a) && isFiniteNumber(b) && a === b;
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b;
  return false;
}

/** Ordering operands must be finite numbers on both sides. */
function asOrderable(v: unknown): number | null {
  return isFiniteNumber(v) ? v : null;
}

function asList(value: ConditionValue | undefined): readonly Scalar[] | null {
  if (!Array.isArray(value)) return null;
  return value as readonly Scalar[];
}

/* -------------------------------------------------------------------------- */
/* Operators                                                                  */
/* -------------------------------------------------------------------------- */

/** Evaluate one condition. A missing operand makes every op except `missing` false. */
export function evaluateCondition(condition: Condition, resolve: ConditionResolver): boolean {
  const actual = resolve(condition.field);
  const missing = isMissing(actual);

  if (condition.op === 'missing') return missing;
  if (missing) return false;
  if (condition.op === 'exists') return true;

  const expected = condition.value;

  switch (condition.op) {
    case 'eq':
      return isScalar(expected) && scalarEquals(actual, expected);
    case 'neq':
      return isScalar(expected) && !scalarEquals(actual, expected);
    case 'in': {
      const list = asList(expected);
      if (list === null) return false;
      return list.some((candidate) => scalarEquals(actual, candidate));
    }
    case 'notin': {
      const list = asList(expected);
      if (list === null) return false;
      return !list.some((candidate) => scalarEquals(actual, candidate));
    }
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte': {
      const left = asOrderable(actual);
      const right = asOrderable(expected);
      if (left === null || right === null) return false;
      if (condition.op === 'lt') return left < right;
      if (condition.op === 'lte') return left <= right;
      if (condition.op === 'gt') return left > right;
      return left >= right;
    }
    default:
      return false;
  }
}

/** AND over every condition. An empty list is false, never vacuously true. */
export function evaluateConditions(
  conditions: readonly Condition[],
  resolve: ConditionResolver,
): boolean {
  if (conditions.length === 0) return false;
  for (const condition of conditions) {
    if (!evaluateCondition(condition, resolve)) return false;
  }
  return true;
}

/**
 * True when any condition's operand is missing, so the rule is undetermined.
 *
 * `exists` and `missing` ask about presence itself, so they are always
 * determined and never make the rule undetermined (E01 decision).
 */
export function isUndetermined(
  conditions: readonly Condition[],
  resolve: ConditionResolver,
): boolean {
  for (const condition of conditions) {
    if (condition.op === 'exists' || condition.op === 'missing') continue;
    if (isMissing(resolve(condition.field))) return true;
  }
  return false;
}

/**
 * A resolver over a feature vector plus its spec, addressing components by key.
 *
 * `key` yields the raw measured value `x[i]`; `key.t` yields the tier value
 * `t[i]`; `key.m` yields the presence mask as a boolean. A component whose
 * mask is 0, or a key the spec does not carry, resolves to `undefined`, which
 * every operator except `missing` reads as false (G-2).
 */
export function vectorResolver(vector: FeatureVector, spec: VectorSpec): ConditionResolver {
  const byKey = new Map<string, number>();
  for (let i = 0; i < spec.components.length; i += 1) {
    const component = spec.components[i];
    if (component !== undefined) byKey.set(component.key, component.index);
  }

  return (field: string): unknown => {
    let key = field;
    let want: 'x' | 't' | 'm' = 'x';
    if (field.endsWith('.t')) {
      key = field.slice(0, -2);
      want = 't';
    } else if (field.endsWith('.m')) {
      key = field.slice(0, -2);
      want = 'm';
    }

    const index = byKey.get(key);
    if (index === undefined) return undefined;

    const present = vector.m[index] === 1;
    if (want === 'm') return present;
    if (!present) return undefined;

    const value = want === 't' ? vector.t[index] : vector.x[index];
    return value === null ? undefined : value;
  };
}
