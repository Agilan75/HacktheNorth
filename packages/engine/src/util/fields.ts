/**
 * Field and provenance helpers. Body owned by Run 1 unit E01.
 * Signatures frozen by W0-2.
 *
 * Confidence numbers come from `SOURCE_CONFIDENCE` (PRD 6.5, INTERPRETATIONS
 * V-7): self_reported 0.7, answer 0.8, enrichment 0.9, sweep = the model's own
 * stated confidence after the PRD 9.3 adjustments.
 */

import { SOURCE_CONFIDENCE, SWEEP_FALLBACK_CONFIDENCE } from '../constants.js';
import type { Field, Provenance, SourceKind, Sourced } from '../types.js';
import { approxEqual, clamp01, isFiniteNumber } from './math.js';

/* -------------------------------------------------------------------------- */
/* Confidence                                                                 */
/* -------------------------------------------------------------------------- */

/** The confidence for a provenance: its own number, or the SOURCE_CONFIDENCE table. */
export function sourceConfidence(provenance: Provenance): number {
  const stated = provenance?.confidence;
  if (isFiniteNumber(stated)) return clamp01(stated);
  return tableConfidence(provenance?.source);
}

/** The fixed-table confidence for a source kind, ignoring any stated confidence. */
export function tableConfidence(source: SourceKind): number {
  const entry = SOURCE_CONFIDENCE[source];
  // `sweep` is null in the table: the camera carries its own number, and this
  // fallback is only reached when a sweep provenance arrives without one.
  if (entry === null || entry === undefined) return SWEEP_FALLBACK_CONFIDENCE;
  return clamp01(entry);
}

/* -------------------------------------------------------------------------- */
/* Private helpers (HELPERS.md: private to this file, never exported)          */
/* -------------------------------------------------------------------------- */

/** Tie-break order for equal confidence. Lower number wins. */
const SOURCE_RANK: Readonly<Record<SourceKind, number>> = {
  enrichment: 0,
  answer: 1,
  sweep: 2,
  self_reported: 3,
};

function sourceRank(source: SourceKind): number {
  const rank = SOURCE_RANK[source];
  return rank === undefined ? Number.MAX_SAFE_INTEGER : rank;
}

/** ISO-8601 → epoch ms. An absent or unparseable stamp sorts as oldest. */
function observedAtMs(provenance: Provenance): number {
  const raw = provenance?.observedAt;
  if (typeof raw !== 'string' || raw.trim() === '') return Number.NEGATIVE_INFINITY;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

function normalizeString(s: string): string {
  return s.trim().toLowerCase();
}

/** Material equality: the same rule the condition operators use, plus arrays. */
function materiallyEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') {
    if (!isFiniteNumber(a) || !isFiniteNumber(b)) return isFiniteNumber(a) === isFiniteNumber(b);
    return approxEqual(a, b);
  }
  if (typeof a === 'string' && typeof b === 'string') {
    return normalizeString(a) === normalizeString(b);
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((entry, i) => materiallyEqual(entry, b[i]));
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao).sort();
  const bk = Object.keys(bo).sort();
  if (ak.length !== bk.length) return false;
  if (!ak.every((k, i) => k === bk[i])) return false;
  return ak.every((k) => materiallyEqual(ao[k], bo[k]));
}

/** True for `{ value, provenance: { source } }`. */
function isFieldLike(v: unknown): v is Field<unknown> {
  if (v === null || typeof v !== 'object') return false;
  const record = v as Record<string, unknown>;
  if (!('value' in record) || !('provenance' in record)) return false;
  const prov = record['provenance'];
  return prov !== null && typeof prov === 'object' && typeof (prov as Provenance).source === 'string';
}

function isSourcedLike(v: unknown): v is Sourced<unknown> {
  return Array.isArray(v) && v.length > 0 && v.every(isFieldLike);
}

/* -------------------------------------------------------------------------- */
/* Slot readers                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The value the engine scores on: the highest-confidence field, ties broken by
 * the source order enrichment > answer > sweep > self_reported, then by the
 * latest `observedAt`, then by insertion order. Null when the slot is empty.
 */
export function bestValue<T>(field: Sourced<T> | undefined): Field<T> | null {
  if (field === undefined || field === null || field.length === 0) return null;

  let best: Field<T> | null = null;
  let bestConfidence = Number.NEGATIVE_INFINITY;
  let bestRank = Number.MAX_SAFE_INTEGER;
  let bestObserved = Number.NEGATIVE_INFINITY;

  for (const candidate of field) {
    if (candidate === undefined || candidate === null) continue;
    const confidence = sourceConfidence(candidate.provenance);
    const rank = sourceRank(candidate.provenance?.source);
    const observed = observedAtMs(candidate.provenance);

    if (best === null) {
      best = candidate;
      bestConfidence = confidence;
      bestRank = rank;
      bestObserved = observed;
      continue;
    }
    // Strictly better only: an exact tie keeps the earlier (insertion order).
    const better =
      confidence > bestConfidence ||
      (confidence === bestConfidence &&
        (rank < bestRank || (rank === bestRank && observed > bestObserved)));
    if (better) {
      best = candidate;
      bestConfidence = confidence;
      bestRank = rank;
      bestObserved = observed;
    }
  }

  return best;
}

/** True when the slot holds two or more materially different values. */
export function hasCompetingValues<T>(field: Sourced<T> | undefined): boolean {
  if (field === undefined || field === null || field.length < 2) return false;
  const first = field[0] as Field<T>;
  for (let i = 1; i < field.length; i += 1) {
    const other = field[i] as Field<T>;
    if (!materiallyEqual(first.value, other.value)) return true;
  }
  return false;
}

/** Append a value without removing or reordering anything already present. */
export function addValue<T>(
  field: Sourced<T> | undefined,
  value: T,
  provenance: Provenance,
): Sourced<T> {
  const existing = field === undefined || field === null ? [] : field;
  return [...existing, { value, provenance }];
}

/** Product of the source confidences over the fields the deciding rules used. */
export function combinedConfidence(fields: readonly Field<unknown>[]): number {
  if (fields === undefined || fields === null || fields.length === 0) return 1;
  let product = 1;
  for (const field of fields) {
    if (field === undefined || field === null) continue;
    product *= sourceConfidence(field.provenance);
  }
  return clamp01(product);
}

/* -------------------------------------------------------------------------- */
/* Path reader                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Read a dotted canonical path out of a submission-shaped object.
 *
 * - `pricing.quotedPremium` unwraps the `Sourced` slot to its `bestValue`
 *   value, so callers get the number the engine scores on.
 * - `buildings.B3.yearBuilt` and `locations.L1.state` address an array of
 *   records by their `externalId` (then `id`, then array index).
 * - `hazards.candle` falls back to `hazards.present.candle`.
 *
 * Returns `undefined` when any segment is absent.
 */
export function readPath(root: unknown, canonicalPath: string): unknown {
  if (typeof canonicalPath !== 'string' || canonicalPath.trim() === '') return undefined;
  const segments = canonicalPath.split('.').filter((s) => s !== '');
  let current: unknown = root;

  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;

    if (Array.isArray(current)) {
      const entries: readonly unknown[] = current;
      if (isSourcedLike(current)) {
        // Step through a slot that is not the last segment (e.g. an object value).
        const best = bestValue(current as Sourced<unknown>);
        current = best === null ? undefined : best.value;
        if (current === null || current === undefined) return undefined;
      } else {
        const index = Number(segment);
        if (Number.isInteger(index) && index >= 0 && index < entries.length) {
          current = entries[index];
          continue;
        }
        const match = entries.find((entry) => {
          if (entry === null || typeof entry !== 'object') return false;
          const record = entry as Record<string, unknown>;
          return record['externalId'] === segment || record['id'] === segment;
        });
        if (match === undefined) return undefined;
        current = match;
        continue;
      }
    }

    if (current === null || typeof current !== 'object') return undefined;
    const record = current as Record<string, unknown>;
    if (segment in record) {
      current = record[segment];
      continue;
    }
    const present = record['present'];
    if (present !== null && typeof present === 'object' && segment in (present as object)) {
      current = (present as Record<string, unknown>)[segment];
      continue;
    }
    return undefined;
  }

  if (isSourcedLike(current)) {
    const best = bestValue(current as Sourced<unknown>);
    return best === null ? undefined : best.value;
  }
  return current;
}
