/**
 * Field and provenance helpers. Body owned by Run 1 unit E01.
 * Signatures frozen by W0-2.
 */

import type { Field, Provenance, SourceKind, Sourced } from '../types.js';

/** The confidence for a provenance: its own number, or the SOURCE_CONFIDENCE table. */
export function sourceConfidence(_provenance: Provenance): number {
  throw new Error('NOT_IMPLEMENTED:E01');
}

/** The fixed-table confidence for a source kind, ignoring any stated confidence. */
export function tableConfidence(_source: SourceKind): number {
  throw new Error('NOT_IMPLEMENTED:E01');
}

/**
 * The value the engine scores on: the highest-confidence field, ties broken by
 * the source order enrichment > answer > sweep > self_reported, then by the
 * latest `observedAt`, then by insertion order. Null when the slot is empty.
 */
export function bestValue<T>(_field: Sourced<T> | undefined): Field<T> | null {
  throw new Error('NOT_IMPLEMENTED:E01');
}

/** True when the slot holds two or more materially different values. */
export function hasCompetingValues<T>(_field: Sourced<T> | undefined): boolean {
  throw new Error('NOT_IMPLEMENTED:E01');
}

/** Append a value without removing or reordering anything already present. */
export function addValue<T>(
  _field: Sourced<T> | undefined,
  _value: T,
  _provenance: Provenance,
): Sourced<T> {
  throw new Error('NOT_IMPLEMENTED:E01');
}

/** Product of the source confidences over the fields the deciding rules used. */
export function combinedConfidence(_fields: readonly Field<unknown>[]): number {
  throw new Error('NOT_IMPLEMENTED:E01');
}

/** Read a dotted canonical path out of a submission-shaped object. */
export function readPath(_root: unknown, _canonicalPath: string): unknown {
  throw new Error('NOT_IMPLEMENTED:E01');
}
