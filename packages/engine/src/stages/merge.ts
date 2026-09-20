/** Stage 4 — merge. Body owned by Run 1 unit E04. */
import { HIGH_VALUE_LABELS, OBJECT_VOCAB } from '../constants.js';
import { bestValue } from '../util/fields.js';
import type {
  CanonicalSubmission,
  ExternalValue,
  Field,
  HazardKey,
  ObjectLabel,
  Observation,
  Provenance,
} from '../types.js';

/* -------------------------------------------------------------------------- */
/* Private types                                                              */
/* -------------------------------------------------------------------------- */

/** Loosely typed view of the canonical submission, used only inside this file. */
type Bag = Record<string, unknown>;

interface Write {
  readonly path: string;
  readonly value: unknown;
  readonly provenance: Provenance;
}

interface Slot {
  readonly container: Bag;
  readonly key: string;
}

/* -------------------------------------------------------------------------- */
/* Path grammar                                                               */
/* -------------------------------------------------------------------------- */

/** Top-level `Sourced` slots on CanonicalSubmission. */
const TOP_LEVEL_KEYS: readonly string[] = [
  'submissionType',
  'receivedDate',
  'effectiveDate',
  'expirationDate',
  'status',
];

const GROUP_KEYS: Readonly<Record<string, readonly string[]>> = {
  insured: [
    'name',
    'industry',
    'revenue',
    'employeeCount',
    'brokerName',
    'contactName',
    'contactEmail',
    'headquartersState',
  ],
  exposure: [
    'requestedLimit',
    'contentsLimit',
    'termMonths',
    'occupancyType',
    'squareFeet',
    'roomLabel',
  ],
  pricing: ['quotedPremium', 'technicalPremium', 'targetPremium'],
};

const LIST_KEYS: Readonly<Record<string, readonly string[]>> = {
  locations: [
    'state',
    'city',
    'postalCode',
    'latitude',
    'longitude',
    'protectionClass',
    'hazardTags',
    'floodZone',
    'fireStationDistanceKm',
  ],
  buildings: [
    'tiv',
    'yearBuilt',
    'constructionType',
    'sprinklered',
    'stories',
    'roofYear',
    'occupancy',
    'protectionClass',
  ],
  history: ['dateOfLoss', 'causeOfLoss', 'paidIndemnity', 'paidExpense', 'reserves'],
};

/** `hazards.*` leaves that are NOT hazard presence keys. */
const HAZARD_DIRECT_KEYS: readonly string[] = [
  'smokeDetectorCount',
  'sprinklerHeadCount',
  'ceilingObserved',
];

/* -------------------------------------------------------------------------- */
/* Observation -> hazard mapping                                              */
/* -------------------------------------------------------------------------- */

/**
 * Presence-only mapping: seeing the object is itself the hazard fact. Relational
 * judgements (`heaterNearCombustible`, `powerBarOverload`) are produced by the
 * sweep pair rules (E12) and arrive here as ordinary `ExternalValue`s, so they
 * are deliberately absent from this table.
 */
const LABEL_TO_HAZARD: Readonly<Partial<Record<ObjectLabel, HazardKey>>> = {
  portable_heater: 'portableHeater',
  extension_cord: 'extensionCord',
  candle: 'candle',
  stove: 'stove',
  blocked_exit: 'blockedExit',
  window_ac_unit: 'windowAcUnit',
  water_heater: 'waterHeater',
};

/* -------------------------------------------------------------------------- */
/* Helpers (private to this file — see docs/contracts/HELPERS.md)             */
/* -------------------------------------------------------------------------- */

/** A value that is `null`, `undefined` or `NaN` is missing (INTERPRETATIONS G-1). */
function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'number') return Number.isFinite(value);
  return true;
}

function isBag(v: unknown): v is Bag {
  return typeof v === 'object' && v !== null;
}

function shallow(v: unknown): Bag {
  return isBag(v) ? { ...v } : {};
}

function copyList(v: unknown): Bag[] {
  return Array.isArray(v) ? v.map((e) => shallow(e)) : [];
}

/** A mutable working copy deep enough that every writable slot is safe to touch. */
function draftOf(submission: CanonicalSubmission): Bag {
  const src = submission as unknown as Bag;
  const hazards = shallow(src.hazards);
  hazards.present = shallow(hazards.present);
  const coverage = shallow(src.coverage);
  coverage.lines = copyList(coverage.lines);
  return {
    ...src,
    insured: shallow(src.insured),
    exposure: shallow(src.exposure),
    pricing: shallow(src.pricing),
    hazards,
    coverage,
    locations: copyList(src.locations),
    buildings: copyList(src.buildings),
    history: copyList(src.history),
  };
}

function findByExternalId(list: readonly Bag[], id: string): Bag | null {
  for (const entry of list) {
    if (entry.externalId === id) return entry;
  }
  return null;
}

/*
 * Wildcard and rollup answers (R-I4-2, docs/decisions/R2b-G2.md).
 *
 * A request for an account with no buildings asks for `buildings.*.tiv`, and
 * one whose claims were never listed asks for `rollup.fiveYearLoss`. Neither
 * names a slot the account has, but the broker's answer is still a fact about
 * it. These paths land where stage 3 reads them:
 *
 * - `buildings.*` / `locations.*`: the account's only entity, or — when it has
 *   none — one entity reported by the broker. Several entities make `*`
 *   ambiguous, so the value is dropped.
 * - `rollup.totalTiv`: the TIV of the account's only (or reported) building.
 * - `rollup.fiveYearLoss`: one aggregate claim dated at the received date (the
 *   inclusive end of the I-4 window), when no claim is listed. A second answer
 *   joins the same aggregate claim.
 * - Every other `rollup.*` path is derived arithmetic and is dropped.
 *
 * A concrete id the account does not have is still dropped, never invented.
 */
const REPORTED_ID: Readonly<Record<string, string>> = {
  buildings: 'reply-building-1',
  locations: 'reply-location-1',
};
const REPORTED_BUILDING_LABEL = 'reported by broker';
const AGGREGATE_CLAIM_ID = 'reply-five-year-loss';

/** The one entity a `*` names: the only entry, or a new reported one. Null when ambiguous. */
function wildcardEntry(draft: Bag, list: string): Bag | null {
  const entries = draft[list] as Bag[];
  if (entries.length === 1) return entries[0] ?? null;
  if (entries.length > 1) return null;
  const id = REPORTED_ID[list];
  if (id === undefined) return null;
  const created: Bag =
    list === 'buildings' ? { externalId: id, label: REPORTED_BUILDING_LABEL } : { externalId: id };
  entries.push(created);
  return created;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The aggregate claim a five-year-loss answer lands on, or null when it cannot land. */
function aggregateClaim(draft: Bag, provenance: Provenance): Bag | null {
  const history = draft.history as Bag[];
  const existing = findByExternalId(history, AGGREGATE_CLAIM_ID);
  if (existing !== null) return existing;
  if (history.length > 0) return null;
  const received = bestValue(draft.receivedDate as readonly Field<unknown>[] | undefined);
  const date = typeof received?.value === 'string' ? received.value.trim() : '';
  if (!ISO_DATE.test(date)) return null;
  const claim: Bag = {
    externalId: AGGREGATE_CLAIM_ID,
    // The window's inclusive end (I-4), carried by the answer that placed it.
    dateOfLoss: [{ value: date, provenance }],
  };
  history.push(claim);
  return claim;
}

function rollupSlot(draft: Bag, key: string, provenance: Provenance): Slot | null {
  if (key === 'totalTiv') {
    const building = wildcardEntry(draft, 'buildings');
    return building === null ? null : { container: building, key: 'tiv' };
  }
  if (key === 'fiveYearLoss') {
    const claim = aggregateClaim(draft, provenance);
    return claim === null ? null : { container: claim, key: 'paidIndemnity' };
  }
  return null;
}

/**
 * Resolve a dotted canonical path to the object and key that hold its
 * `Sourced` slot. Returns null when the path names nothing this submission has
 * — an unresolvable external value is dropped, never invented into the tree.
 * The one exception is a `*` or `rollup.*` answer (see `wildcardEntry`), which
 * may create the single reported building, location or aggregate claim.
 */
function resolveSlot(draft: Bag, path: string, provenance: Provenance): Slot | null {
  const seg = path.split('.').filter((s) => s.length > 0);
  if (seg.length === 0) return null;
  const head = seg[0] ?? '';
  const second = seg[1] ?? '';
  const third = seg[2] ?? '';
  const fourth = seg[3] ?? '';

  if (seg.length === 1) {
    return TOP_LEVEL_KEYS.includes(head) ? { container: draft, key: head } : null;
  }

  const groupKeys = GROUP_KEYS[head];
  if (groupKeys !== undefined) {
    if (seg.length !== 2) return null;
    return groupKeys.includes(second) ? { container: draft[head] as Bag, key: second } : null;
  }

  if (head === 'hazards') {
    const hazards = draft.hazards as Bag;
    if (seg.length === 2) {
      return HAZARD_DIRECT_KEYS.includes(second)
        ? { container: hazards, key: second }
        : { container: hazards.present as Bag, key: second };
    }
    if (seg.length === 3 && second === 'present') {
      return { container: hazards.present as Bag, key: third };
    }
    return null;
  }

  const listKeys = LIST_KEYS[head];
  if (listKeys !== undefined) {
    if (seg.length !== 3) return null;
    if (!listKeys.includes(third)) return null;
    if (second === '*') {
      const entry = head === 'history' ? null : wildcardEntry(draft, head);
      return entry ? { container: entry, key: third } : null;
    }
    const entry = findByExternalId(draft[head] as Bag[], second);
    return entry ? { container: entry, key: third } : null;
  }

  if (head === 'rollup') {
    return seg.length === 2 ? rollupSlot(draft, second, provenance) : null;
  }

  if (head === 'coverage') {
    if (seg.length !== 4 || second !== 'lines') return null;
    if (fourth !== 'limit' && fourth !== 'deductible') return null;
    const lines = (draft.coverage as Bag).lines as Bag[];
    const line = lines.find((l) => l.code === third);
    return line ? { container: line, key: fourth } : null;
  }

  return null;
}

/** Append one field. Nothing is ever removed, reordered or overwritten. */
function applyWrite(draft: Bag, write: Write): void {
  if (!isPresent(write.value)) return;
  const slot = resolveSlot(draft, write.path, write.provenance);
  if (slot === null) return;
  const existing = slot.container[slot.key];
  const before: readonly Field<unknown>[] = Array.isArray(existing)
    ? (existing as readonly Field<unknown>[])
    : [];
  slot.container[slot.key] = [...before, { value: write.value, provenance: write.provenance }];
}

function externalWrites(values: readonly ExternalValue[]): Write[] {
  return values.map((v) => ({
    path: v.canonicalPath,
    value: v.value,
    provenance: v.provenance,
  }));
}

function sweepProvenance(detail: string, confidence: number, observedAt?: string): Provenance {
  return observedAt === undefined
    ? { source: 'sweep', sourceDetail: detail, confidence }
    : { source: 'sweep', sourceDetail: detail, confidence, observedAt };
}

/**
 * Turn sweep observations into `hazards.*` writes. Deduplication, self
 * consistency and the pair rules already ran in the sweep module (E12); merge
 * only reads the observation list it is handed. Presence keeps the
 * highest-confidence sighting, counts keep the highest confidence among their
 * contributors, matching the sweep's own "merge, keeping max confidence".
 */
function observationWrites(observations: readonly Observation[]): Write[] {
  const writes: Write[] = [];

  const byLabel = new Map<ObjectLabel, Observation[]>();
  for (const obs of observations) {
    const list = byLabel.get(obs.label);
    if (list === undefined) byLabel.set(obs.label, [obs]);
    else list.push(obs);
  }

  const best = (list: readonly Observation[]): Observation =>
    list.reduce((a, b) => (b.confidence > a.confidence ? b : a));

  // Presence keys, in the fixed vocabulary order so output is deterministic.
  for (const label of OBJECT_VOCAB) {
    const key = LABEL_TO_HAZARD[label];
    if (key === undefined) continue;
    const seen = byLabel.get(label);
    if (seen === undefined || seen.length === 0) continue;
    const winner = best(seen);
    writes.push({
      path: `hazards.present.${key}`,
      value: true,
      provenance: sweepProvenance(`observation:${winner.id}`, winner.confidence),
    });
  }

  const countWrite = (path: string, list: readonly Observation[], value: number): void => {
    const detail = `observations:${list.map((o) => o.id).join('+')}`;
    const confidence = list.reduce((acc, o) => Math.max(acc, o.confidence), 0);
    writes.push({ path, value, provenance: sweepProvenance(detail, confidence) });
  };

  const detectors = byLabel.get('smoke_detector') ?? [];
  if (detectors.length > 0) countWrite('hazards.smokeDetectorCount', detectors, detectors.length);

  const sprinklers = byLabel.get('sprinkler_head') ?? [];
  if (sprinklers.length > 0)
    countWrite('hazards.sprinklerHeadCount', sprinklers, sprinklers.length);

  const valuables = HIGH_VALUE_LABELS.flatMap((label) => byLabel.get(label) ?? []);
  if (valuables.length > 0)
    countWrite('hazards.present.highValueContents', valuables, valuables.length);

  const ceiling = observations.filter((o) => o.ceilingVisible === true);
  if (ceiling.length > 0) {
    const winner = best(ceiling);
    writes.push({
      path: 'hazards.ceilingObserved',
      value: true,
      provenance: sweepProvenance(`observation:${winner.id}`, winner.confidence),
    });
  }

  return writes;
}

/* -------------------------------------------------------------------------- */
/* Stage 4                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Fold enrichment, sweep observations and broker answers into the canonical
 * submission. Nothing is ever overwritten (PRD 6.2): every incoming value is
 * appended beside the values already in its slot.
 *
 * **Provenance precedence.** Insertion order is the contract, because
 * `bestValue` (E01) breaks a confidence tie by source order and then by
 * insertion order. Merge therefore appends in a fixed order:
 * broker values already present, then `enrichment`, then sweep observations,
 * then `answers` — answers last, since a broker's reply to a targeted question
 * is the most recent correction of the same slot.
 *
 * Values that are `null`, `undefined` or `NaN` are missing (G-1) and are
 * dropped rather than appended, so a missing enrichment can never masquerade as
 * a competing value at stage 5.
 *
 * `rollup` is carried through untouched: merge does no arithmetic. A
 * `rollup.totalTiv` / `rollup.fiveYearLoss` answer lands on the building or
 * claim stage 3 sums, never on `rollup` itself (R-I4-2). When a merge
 * writes a rollup-feeding path (`buildings.*`, `locations.*`, `history.*`,
 * `receivedDate`), the composer must re-run stage 3 before vectorizing.
 */
export function merge(
  submission: CanonicalSubmission,
  enrichment: readonly ExternalValue[],
  observations: readonly Observation[],
  answers: readonly ExternalValue[],
): CanonicalSubmission {
  const writes: Write[] = [
    ...externalWrites(enrichment),
    ...observationWrites(observations),
    ...externalWrites(answers),
  ];
  if (writes.length === 0) return submission;

  const draft = draftOf(submission);
  for (const write of writes) applyWrite(draft, write);
  return draft as unknown as CanonicalSubmission;
}
