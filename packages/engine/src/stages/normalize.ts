/** Stage 2 — normalize. Body owned by Run 1 unit E02. */
import type {
  BuildingFacts,
  CanonicalSubmission,
  ClaimFacts,
  CoverageFacts,
  ExposureFacts,
  Field,
  FieldMap,
  FieldMapEntry,
  InsuredFacts,
  LineOfBusiness,
  LocationFacts,
  PricingFacts,
  Provenance,
  RawBundle,
  Sourced,
  SubmissionType,
} from '../types.js';

/* -------------------------------------------------------------------------- */
/* Private vocabulary — kinds and groups, keyed by CANONICAL path only.        */
/* -------------------------------------------------------------------------- */

type Kind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'state'
  | 'construction'
  | 'submissionType'
  | 'stringArray'
  | 'skip';

const KIND: Readonly<Record<string, Kind>> = {
  externalId: 'string',
  status: 'string',
  receivedDate: 'date',
  effectiveDate: 'date',
  expirationDate: 'date',
  submissionType: 'submissionType',
  lineOfBusiness: 'skip',
  'insured.name': 'string',
  'insured.industry': 'string',
  'insured.revenue': 'number',
  'insured.employeeCount': 'number',
  'insured.brokerName': 'string',
  'insured.contactName': 'string',
  'insured.contactEmail': 'string',
  'insured.headquartersState': 'state',
  'pricing.quotedPremium': 'number',
  'pricing.technicalPremium': 'number',
  'pricing.targetPremium': 'number',
  'exposure.requestedLimit': 'number',
  'exposure.contentsLimit': 'number',
  'exposure.termMonths': 'number',
  'exposure.squareFeet': 'number',
  'exposure.occupancyType': 'string',
  'exposure.roomLabel': 'string',
  'locations[].state': 'state',
  'locations[].city': 'string',
  'locations[].postalCode': 'string',
  'locations[].latitude': 'number',
  'locations[].longitude': 'number',
  'locations[].protectionClass': 'number',
  'locations[].hazardTags': 'stringArray',
  'locations[].floodZone': 'string',
  'locations[].fireStationDistanceKm': 'number',
  'buildings[].label': 'string',
  'buildings[].tiv': 'number',
  'buildings[].yearBuilt': 'number',
  'buildings[].constructionType': 'construction',
  'buildings[].sprinklered': 'boolean',
  'buildings[].stories': 'number',
  'buildings[].roofYear': 'number',
  'buildings[].occupancy': 'string',
  'buildings[].protectionClass': 'number',
  'history[].dateOfLoss': 'date',
  'history[].causeOfLoss': 'string',
  'history[].paidIndemnity': 'number',
  'history[].paidExpense': 'number',
  'history[].reserves': 'number',
  'coverage.lines[].code': 'string',
  'coverage.lines[].limit': 'number',
  'coverage.lines[].deductible': 'number',
};

/** Canonical paths whose several raw sources are summed, not held side by side. */
const SUMMED: readonly string[] = ['history[].reserves'];

type Group =
  | 'submission'
  | 'policy'
  | 'insured'
  | 'broker'
  | 'contact'
  | 'location'
  | 'building'
  | 'claim'
  | 'coverage'
  | 'other';

/** Resource or segment name -> canonical group. Plain English, not a schema. */
const GROUP_NAMES: Readonly<Record<string, Group>> = {
  submission: 'submission',
  policy: 'policy',
  insured: 'insured',
  account: 'insured',
  organization: 'insured',
  broker: 'broker',
  producer: 'broker',
  agency: 'broker',
  contact: 'contact',
  location: 'location',
  property: 'location',
  site: 'location',
  building: 'building',
  structure: 'building',
  claim: 'claim',
  loss: 'claim',
  coverage: 'coverage',
};

/** Which entity group holds each canonical collection. */
const COLLECTION_GROUP: Readonly<Record<string, Group>> = {
  'locations[]': 'location',
  'buildings[]': 'building',
  'history[]': 'claim',
  'coverage.lines[]': 'coverage',
};

/** Scalar slots are searched in this order; the first source wins the slot. */
const SCALAR_GROUP_ORDER: readonly Group[] = [
  'submission',
  'policy',
  'insured',
  'contact',
  'broker',
];

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function singular(s: string): string {
  if (s.endsWith('ies')) return `${s.slice(0, -3)}y`;
  if (s.endsWith('ses')) return s.slice(0, -2);
  if (s.endsWith('s')) return s.slice(0, -1);
  return s;
}

function groupOf(name: string): Group {
  const n = norm(name.replace(/\[\]$/, ''));
  return GROUP_NAMES[n] ?? GROUP_NAMES[singular(n)] ?? 'other';
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/* -------------------------------------------------------------------------- */
/* Coercion                                                                   */
/* -------------------------------------------------------------------------- */

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[,$\s]/g, '');
    if (cleaned === '') return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toText(v: unknown): string | null {
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? null : t;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function toBoolean(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1 ? true : v === 0 ? false : null;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (['true', 'yes', 'y', '1'].includes(t)) return true;
    if (['false', 'no', 'n', '0'].includes(t)) return false;
  }
  return null;
}

/** G-8: construction types compare as lower snake_case. */
function toSnake(v: unknown): string | null {
  const text = toText(v);
  if (text === null) return null;
  const snake = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return snake === '' ? null : snake;
}

/** G-7: state codes compare as trimmed upper case. */
function toStateCode(v: unknown): string | null {
  const text = toText(v);
  return text === null ? null : text.toUpperCase();
}

function toSubmissionType(v: unknown): SubmissionType | null {
  const snake = toSnake(v);
  if (snake === null) return null;
  if (snake === 'new' || snake === 'new_business' || snake === 'newbusiness') return 'new_business';
  if (snake === 'renewal' || snake === 'renewal_business' || snake === 'renew') return 'renewal';
  return null;
}

/* -------------------------------------------------------------------------- */
/* G-11 canonicalizers — exported so stage 6 (vectorize) applies the same      */
/* rule to input that never passed through normalize (CP1 FX1). Each one       */
/* trims and case-folds; empty or whitespace-only after trimming is missing    */
/* (null), per G-2.                                                            */
/* -------------------------------------------------------------------------- */

/** G-11 submission type: `'new_business'`, `'renewal'`, or null (missing or unrecognized). */
export function canonicalSubmissionType(v: unknown): SubmissionType | null {
  return toSubmissionType(v);
}

/** G-11 line of business, as lower snake_case; null when absent or blank. */
export function canonicalLineOfBusiness(v: unknown): string | null {
  return typeof v === 'string' ? toSnake(v) : null;
}

/** G-7 / G-11 primary risk state, trimmed upper case; null when absent or blank. */
export function canonicalStateCode(v: unknown): string | null {
  return typeof v === 'string' ? toStateCode(v) : null;
}

/** G-8 / G-11 construction type, lower snake_case; null when absent or blank. */
export function canonicalConstructionType(v: unknown): string | null {
  return typeof v === 'string' ? toSnake(v) : null;
}

function toStringArray(v: unknown): readonly string[] | null {
  if (!Array.isArray(v)) {
    const one = toText(v);
    return one === null ? null : [one];
  }
  const out = v.map(toText).filter((s): s is string => s !== null);
  return out.length === 0 ? null : out;
}

function coerce(kind: Kind, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  switch (kind) {
    case 'number':
      return toNumber(v);
    case 'boolean':
      return toBoolean(v);
    case 'state':
      return toStateCode(v);
    case 'construction':
      return toSnake(v);
    case 'submissionType':
      return toSubmissionType(v);
    case 'stringArray':
      return toStringArray(v);
    case 'date':
    case 'string':
      return toText(v);
    case 'skip':
      return null;
    default:
      return null;
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'string' && typeof b === 'string') {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* Entities                                                                   */
/* -------------------------------------------------------------------------- */

interface Entity {
  readonly group: Group;
  /** Raw path prefix of this object, e.g. `Policy.exposure_units[].location`. */
  readonly prefix: string;
  readonly data: Record<string, unknown>;
  readonly key: string;
  readonly order: number;
  /**
   * Keys of the grouped entities this one was hydrated beneath, outermost
   * first. `prefix` carries no array index, so it cannot tell two sibling
   * locations apart; this can (R2-fixer-6, R1-1).
   */
  readonly ancestors: readonly string[];
}

const MAX_DEPTH = 8;

function collectEntities(
  value: unknown,
  prefix: string,
  group: Group,
  out: Entity[],
  depth: number,
  ancestors: readonly string[] = [],
): void {
  if (depth > MAX_DEPTH) return;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (isPlainObject(item)) collectEntities(item, `${prefix}[]`, group, out, depth, ancestors);
    }
    return;
  }
  if (!isPlainObject(value)) return;
  let childAncestors = ancestors;
  if (group !== 'other') {
    const id = value['id'];
    const key = id === null || id === undefined ? JSON.stringify(value) : `${group}:${String(id)}`;
    out.push({ group, prefix, data: value, key, order: out.length, ancestors });
    childAncestors = [...ancestors, key];
  }
  for (const [childKey, child] of Object.entries(value)) {
    // An ungrouped container (e.g. `exposure_units[]`) is walked through, never
    // emitted, so entities hydrated beneath it are still found.
    const childGroup = groupOf(childKey);
    if (childGroup === 'other' && !isPlainObject(child) && !Array.isArray(child)) continue;
    const nextPrefix = prefix === '' ? childKey : `${prefix}.${childKey}`;
    collectEntities(child, nextPrefix, childGroup, out, depth + 1, childAncestors);
  }
}

function entitiesOf(bundle: RawBundle): readonly Entity[] {
  const found: Entity[] = [];
  const resources = Object.keys(bundle.records).sort((a, b) => a.localeCompare(b));
  for (const resource of resources) {
    for (const record of bundle.records[resource] ?? []) {
      collectEntities(record.data, resource, groupOf(resource), found, 0);
    }
  }
  // Keep the first sighting of each entity; a hydrated copy and the flat record
  // are the same thing, and nothing is allowed to appear twice in a collection.
  const seen = new Set<string>();
  const unique: Entity[] = [];
  for (const entity of found) {
    if (seen.has(entity.key)) continue;
    seen.add(entity.key);
    unique.push(entity);
  }
  return unique;
}

/** Reads `a.b.c` inside one entity object. No `[]` segments reach this. */
function readIn(data: Record<string, unknown>, path: string): unknown {
  let cursor: unknown = data;
  for (const segment of path.split('.')) {
    if (!isPlainObject(cursor)) return null;
    cursor = cursor[segment];
  }
  return cursor === undefined ? null : cursor;
}

/* -------------------------------------------------------------------------- */
/* Slot building                                                              */
/* -------------------------------------------------------------------------- */

function provenanceFor(rawPath: string, bundle: RawBundle): Provenance {
  return {
    source: 'self_reported',
    sourceDetail: rawPath,
    ...(bundle.fetchedAt === undefined ? {} : { observedAt: bundle.fetchedAt }),
  };
}

interface Candidate {
  readonly value: unknown;
  readonly rawPath: string;
}

/** Entries that read directly out of this entity (no array hop in the tail). */
function entriesFor(entity: Entity, entries: readonly FieldMapEntry[]): readonly FieldMapEntry[] {
  const head = `${entity.prefix}.`;
  return entries.filter((e) => {
    if (!e.rawPath.startsWith(head)) return false;
    const tail = e.rawPath.slice(head.length);
    return tail !== '' && !tail.includes('[]');
  });
}

function candidatesFor(
  canonicalPath: string,
  entity: Entity,
  entries: readonly FieldMapEntry[],
): Candidate[] {
  const kind = KIND[canonicalPath] ?? 'string';
  const out: Candidate[] = [];
  for (const entry of entries) {
    if (entry.canonicalPath !== canonicalPath) continue;
    const tail = entry.rawPath.slice(entity.prefix.length + 1);
    const value = coerce(kind, readIn(entity.data, tail));
    if (value === null) continue;
    out.push({ value, rawPath: entry.rawPath });
  }
  return out;
}

function slot<T>(candidates: readonly Candidate[], bundle: RawBundle, canonicalPath: string): Sourced<T> | undefined {
  if (candidates.length === 0) return undefined;
  if (SUMMED.includes(canonicalPath)) {
    let total = 0;
    const paths: string[] = [];
    for (const candidate of candidates) {
      if (typeof candidate.value !== 'number') continue;
      total += candidate.value;
      paths.push(candidate.rawPath);
    }
    if (paths.length === 0) return undefined;
    return [
      { value: total as T, provenance: provenanceFor(paths.join(' + '), bundle) },
    ];
  }
  const fields: Field<T>[] = [];
  for (const candidate of candidates) {
    if (fields.some((f) => sameValue(f.value, candidate.value))) continue;
    fields.push({ value: candidate.value as T, provenance: provenanceFor(candidate.rawPath, bundle) });
  }
  return fields.length === 0 ? undefined : fields;
}

function externalIdOf(entity: Entity, fallback: string): string {
  const id = entity.data['id'];
  if (typeof id === 'string' && id.trim() !== '') return id.trim();
  if (typeof id === 'number' && Number.isFinite(id)) return String(id);
  return fallback;
}

/* -------------------------------------------------------------------------- */
/* normalize                                                                  */
/* -------------------------------------------------------------------------- */

export function normalize(
  _bundle: RawBundle,
  _fieldMap: FieldMap,
  _lineOfBusiness: LineOfBusiness,
): CanonicalSubmission {
  const entries = _fieldMap.entries;
  const entities = entitiesOf(_bundle);

  /** Scalar slot: search the scalar groups in order, keep every distinct value. */
  const scalar = <T,>(canonicalPath: string): Sourced<T> | undefined => {
    const candidates: Candidate[] = [];
    for (const group of SCALAR_GROUP_ORDER) {
      for (const entity of entities) {
        if (entity.group !== group) continue;
        candidates.push(...candidatesFor(canonicalPath, entity, entriesFor(entity, entries)));
      }
    }
    return slot<T>(candidates, _bundle, canonicalPath);
  };

  const collection = (prefix: string): readonly Entity[] => {
    const group = COLLECTION_GROUP[prefix];
    return group === undefined ? [] : entities.filter((e) => e.group === group);
  };

  const put = <T,>(
    target: Record<string, unknown>,
    key: string,
    value: Sourced<T> | undefined,
  ): void => {
    if (value !== undefined) target[key] = value;
  };

  /* locations ------------------------------------------------------------- */
  const locationEntities = collection('locations[]');
  const locations: LocationFacts[] = locationEntities.map((entity, index) => {
    const own = entriesFor(entity, entries);
    const facts: Record<string, unknown> = {
      externalId: externalIdOf(entity, `${entity.prefix}#${index}`),
    };
    for (const key of [
      'state',
      'city',
      'postalCode',
      'latitude',
      'longitude',
      'protectionClass',
      'hazardTags',
      'floodZone',
      'fireStationDistanceKm',
    ]) {
      const path = `locations[].${key}`;
      put(facts, key, slot(candidatesFor(path, entity, own), _bundle, path));
    }
    return facts as unknown as LocationFacts;
  });

  /* buildings ------------------------------------------------------------- */
  const buildingEntities = collection('buildings[]');
  const buildings: BuildingFacts[] = buildingEntities.map((entity, index) => {
    const own = entriesFor(entity, entries);
    const externalId = externalIdOf(entity, `${entity.prefix}#${index}`);
    const facts: Record<string, unknown> = { externalId };

    const label = slot<string>(
      candidatesFor('buildings[].label', entity, own),
      _bundle,
      'buildings[].label',
    );
    if (label !== undefined && label[0] !== undefined) facts['label'] = label[0].value;

    for (const key of [
      'tiv',
      'yearBuilt',
      'constructionType',
      'sprinklered',
      'stories',
      'roofYear',
      'occupancy',
      'protectionClass',
    ]) {
      const path = `buildings[].${key}`;
      put(facts, key, slot(candidatesFor(path, entity, own), _bundle, path));
    }

    // Which location this building sits at: either it was hydrated underneath
    // the location, or the location lists it by id.
    const owner = locationEntities.find((loc) => {
      if (entity.ancestors.includes(loc.key)) return true;
      const rawId = entity.data['id'];
      if (rawId === null || rawId === undefined) return false;
      return Object.entries(loc.data).some(([key, value]) => {
        if (groupOf(key) !== 'building' || !Array.isArray(value)) return false;
        return value.some((item) =>
          isPlainObject(item) ? item['id'] === rawId : item === rawId,
        );
      });
    });
    if (owner !== undefined) {
      const ownerIndex = locationEntities.indexOf(owner);
      const ownerFacts = locations[ownerIndex];
      if (ownerFacts !== undefined) {
        facts['locationExternalId'] = ownerFacts.externalId;
        // The building's public protection class is the location's, from the
        // same raw field: an inherited value, never an invented one.
        if (facts['protectionClass'] === undefined && ownerFacts.protectionClass !== undefined) {
          facts['protectionClass'] = ownerFacts.protectionClass;
        }
      }
    }
    return facts as unknown as BuildingFacts;
  });

  /* claims ---------------------------------------------------------------- */
  const history: ClaimFacts[] = collection('history[]').map((entity, index) => {
    const own = entriesFor(entity, entries);
    const facts: Record<string, unknown> = {
      externalId: externalIdOf(entity, `${entity.prefix}#${index}`),
    };
    for (const key of ['dateOfLoss', 'causeOfLoss', 'paidIndemnity', 'paidExpense', 'reserves']) {
      const path = `history[].${key}`;
      put(facts, key, slot(candidatesFor(path, entity, own), _bundle, path));
    }
    return facts as unknown as ClaimFacts;
  });

  /* coverage -------------------------------------------------------------- */
  const lines = collection('coverage.lines[]').map((entity) => {
    const own = entriesFor(entity, entries);
    const code = slot<string>(
      candidatesFor('coverage.lines[].code', entity, own),
      _bundle,
      'coverage.lines[].code',
    );
    const line: Record<string, unknown> = {
      code: code?.[0]?.value ?? externalIdOf(entity, 'unknown'),
    };
    for (const key of ['limit', 'deductible']) {
      const path = `coverage.lines[].${key}`;
      put(line, key, slot(candidatesFor(path, entity, own), _bundle, path));
    }
    return line;
  });
  const coverage = { lines } as unknown as CoverageFacts;

  /* scalars --------------------------------------------------------------- */
  const insured: Record<string, unknown> = {};
  for (const key of [
    'name',
    'industry',
    'revenue',
    'employeeCount',
    'brokerName',
    'contactName',
    'contactEmail',
    'headquartersState',
  ]) {
    put(insured, key, scalar(`insured.${key}`));
  }

  const exposure: Record<string, unknown> = {};
  for (const key of [
    'requestedLimit',
    'contentsLimit',
    'termMonths',
    'occupancyType',
    'squareFeet',
    'roomLabel',
  ]) {
    put(exposure, key, scalar(`exposure.${key}`));
  }

  const pricing: Record<string, unknown> = {};
  for (const key of ['quotedPremium', 'technicalPremium', 'targetPremium']) {
    put(pricing, key, scalar(`pricing.${key}`));
  }

  const externalIdSlot = scalar<string>('externalId');
  const externalId = externalIdSlot?.[0]?.value ?? _bundle.externalId;

  const submission: Record<string, unknown> = {
    id: _bundle.externalId,
    externalId,
    lineOfBusiness: _lineOfBusiness,
    insured: insured as unknown as InsuredFacts,
    locations,
    buildings,
    hazards: { present: {} },
    exposure: exposure as unknown as ExposureFacts,
    coverage,
    history,
    pricing: pricing as unknown as PricingFacts,
    raw: _bundle,
    fieldMap: _fieldMap,
  };
  put(submission, 'submissionType', scalar<SubmissionType>('submissionType'));
  put(submission, 'receivedDate', scalar<string>('receivedDate'));
  put(submission, 'effectiveDate', scalar<string>('effectiveDate'));
  put(submission, 'expirationDate', scalar<string>('expirationDate'));
  put(submission, 'status', scalar<string>('status'));

  return submission as unknown as CanonicalSubmission;
}
