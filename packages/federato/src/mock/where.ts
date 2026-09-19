/**
 * Mock query engine, part 1: `where` / `filter` matching.
 * Operators, `$elemMatch` and the combinators. Body owned by Run 1 unit F03.
 */
import type { FederatoRecord, QueryClause, QueryOperators, QueryValue } from '../types';

/** Reads a dot-path. Does NOT cross arrays — that is what `$elemMatch` is for. */
export function readDotPath(_record: unknown, _path: string): unknown {
  throw new Error('NOT_IMPLEMENTED:F03');
}

/** Deep equality with the API's semantics: arrays compare element-wise. */
export function deepEqual(_a: unknown, _b: unknown): boolean {
  throw new Error('NOT_IMPLEMENTED:F03');
}

/** Applies one operator bag to one value. Multiple operators are implicit `$and`. */
export function matchOperators(_value: unknown, _ops: QueryOperators): boolean {
  throw new Error('NOT_IMPLEMENTED:F03');
}

/** `$contains`: substring on scalars, element membership on arrays. */
export function matchContains(_value: unknown, _needle: QueryValue): boolean {
  throw new Error('NOT_IMPLEMENTED:F03');
}

/** `$elemMatch`: true when at least one array element satisfies the sub-clause. */
export function matchElemMatch(_value: unknown, _clause: QueryClause): boolean {
  throw new Error('NOT_IMPLEMENTED:F03');
}

/** Whole-clause matching, including `$and` / `$or` / `$not`. */
export function matchClause(_record: FederatoRecord, _clause: QueryClause): boolean {
  throw new Error('NOT_IMPLEMENTED:F03');
}

/** Convenience: filter a list of records by a clause. */
export function applyWhere(
  _records: readonly FederatoRecord[],
  _clause: QueryClause | undefined,
): readonly FederatoRecord[] {
  throw new Error('NOT_IMPLEMENTED:F03');
}
