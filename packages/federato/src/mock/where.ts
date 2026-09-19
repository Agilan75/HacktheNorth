/**
 * Mock query engine, part 1: `where` / `filter` matching.
 * Operators, `$elemMatch` and the combinators. Body owned by Run 1 unit F03.
 *
 * Semantics follow QUERY_REQUEST_BODY.pdf and LIVE_DATA_FACTS.md:
 *   - a clause mirrors the record shape; nesting and dot-paths are equivalent;
 *   - dot-paths never cross an array (`exposure_units.location.state` -> 0 rows);
 *   - `$elemMatch` is the one way across an array boundary;
 *   - `null` is a real value, distinct from a missing field.
 * Open points are recorded in docs/decisions/F03.md.
 */
import type { FederatoRecord, QueryClause, QueryOperators, QueryValue } from '../types';

const OPERATOR_KEYS = new Set<string>([
  '$eq',
  '$ne',
  '$exists',
  '$gt',
  '$gte',
  '$lt',
  '$lte',
  '$in',
  '$nin',
  '$contains',
  '$elemMatch',
]);

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOperatorBag(node: Readonly<Record<string, unknown>>): boolean {
  const keys = Object.keys(node);
  return keys.length > 0 && keys.every((k) => OPERATOR_KEYS.has(k));
}

/** Reads a dot-path. Does NOT cross arrays — that is what `$elemMatch` is for. */
export function readDotPath(record: unknown, path: string): unknown {
  if (path === '') return record;
  let current: unknown = record;
  for (const segment of path.split('.')) {
    if (!isPlainObject(current)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

/** Deep equality with the API's semantics: arrays compare element-wise. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a).filter((k) => a[k] !== undefined);
    const bKeys = Object.keys(b).filter((k) => b[k] !== undefined);
    if (aKeys.length !== bKeys.length) return false;
    for (const k of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
      if (!deepEqual(a[k], b[k])) return false;
    }
    return true;
  }
  return false;
}

type Comparable = number | string;

function compare(value: unknown, bound: Comparable, test: (c: number) => boolean): boolean {
  if (typeof value === 'number' && typeof bound === 'number') {
    if (Number.isNaN(value) || Number.isNaN(bound)) return false;
    return test(value < bound ? -1 : value > bound ? 1 : 0);
  }
  if (typeof value === 'string' && typeof bound === 'string') {
    return test(value < bound ? -1 : value > bound ? 1 : 0);
  }
  return false;
}

function matchIn(value: unknown, list: readonly unknown[]): boolean {
  if (value === undefined) return false;
  if (Array.isArray(value)) {
    return value.some((el) => list.some((candidate) => deepEqual(el, candidate)));
  }
  return list.some((candidate) => deepEqual(value, candidate));
}

/** Applies one operator bag to one value. Multiple operators are implicit `$and`. */
export function matchOperators(value: unknown, ops: QueryOperators): boolean {
  for (const [op, arg] of Object.entries(ops)) {
    if (arg === undefined) continue;
    switch (op) {
      case '$eq':
        if (!deepEqual(value, arg)) return false;
        break;
      case '$ne':
        if (deepEqual(value, arg)) return false;
        break;
      case '$exists':
        if ((value !== undefined) !== Boolean(arg)) return false;
        break;
      case '$gt':
        if (!compare(value, arg as Comparable, (c) => c > 0)) return false;
        break;
      case '$gte':
        if (!compare(value, arg as Comparable, (c) => c >= 0)) return false;
        break;
      case '$lt':
        if (!compare(value, arg as Comparable, (c) => c < 0)) return false;
        break;
      case '$lte':
        if (!compare(value, arg as Comparable, (c) => c <= 0)) return false;
        break;
      case '$in':
        if (!Array.isArray(arg)) throw new Error('mock where: $in expects an array');
        if (!matchIn(value, arg)) return false;
        break;
      case '$nin':
        if (!Array.isArray(arg)) throw new Error('mock where: $nin expects an array');
        if (matchIn(value, arg)) return false;
        break;
      case '$contains':
        if (!matchContains(value, arg as QueryValue)) return false;
        break;
      case '$elemMatch':
        if (!matchElemMatch(value, arg as QueryClause)) return false;
        break;
      default:
        throw new Error(`mock where: unsupported operator ${op}`);
    }
  }
  return true;
}

/** `$contains`: substring on scalars, element membership on arrays. */
export function matchContains(value: unknown, needle: QueryValue): boolean {
  if (Array.isArray(value)) return value.some((el) => deepEqual(el, needle));
  if (typeof value === 'string') {
    if (typeof needle === 'string') return value.includes(needle);
    if (typeof needle === 'number' || typeof needle === 'boolean') {
      return value.includes(String(needle));
    }
    return false;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    if (needle === null || Array.isArray(needle)) return false;
    return String(value).includes(String(needle));
  }
  return false;
}

/** `$elemMatch`: true when at least one array element satisfies the sub-clause. */
export function matchElemMatch(value: unknown, clause: QueryClause): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((el) => matchNode(el, clause));
}

/**
 * Matches one value against anything that can sit to the right of a key:
 * a literal (deep equality), an operator bag, a nested clause, or a mix.
 */
function matchNode(value: unknown, node: unknown): boolean {
  if (!isPlainObject(node)) return deepEqual(value, node);
  if (isOperatorBag(node)) return matchOperators(value, node as QueryOperators);

  for (const [key, sub] of Object.entries(node)) {
    if (sub === undefined) continue;
    if (key === '$and') {
      if (!Array.isArray(sub)) throw new Error('mock where: $and expects an array');
      if (!sub.every((s) => matchNode(value, s))) return false;
    } else if (key === '$or') {
      if (!Array.isArray(sub)) throw new Error('mock where: $or expects an array');
      if (!sub.some((s) => matchNode(value, s))) return false;
    } else if (key === '$not') {
      if (matchNode(value, sub)) return false;
    } else if (OPERATOR_KEYS.has(key)) {
      if (!matchOperators(value, { [key]: sub } as QueryOperators)) return false;
    } else if (key.startsWith('$')) {
      throw new Error(`mock where: unsupported operator ${key}`);
    } else {
      if (!isPlainObject(value)) return false;
      if (!matchNode(readDotPath(value, key), sub)) return false;
    }
  }
  return true;
}

/** Whole-clause matching, including `$and` / `$or` / `$not`. */
export function matchClause(record: FederatoRecord, clause: QueryClause): boolean {
  return matchNode(record, clause);
}

/** Convenience: filter a list of records by a clause. */
export function applyWhere(
  records: readonly FederatoRecord[],
  clause: QueryClause | undefined,
): readonly FederatoRecord[] {
  if (clause === undefined) return records;
  return records.filter((r) => matchClause(r, clause));
}
