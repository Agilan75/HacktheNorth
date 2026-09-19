/**
 * Mock query engine, part 2: the rest of the pipeline —
 * expand / unwind / filter / over / select (incl. `$expand` and reductions) /
 * sort / pagination. Body owned by Run 1 unit F04.
 *
 * Semantics follow QUERY_REQUEST_BODY.pdf; every open point is recorded in
 * docs/decisions/F04.md. `where` / `filter` matching is F03's (`./where`).
 */
import type {
  ExpandClause,
  FederatoRecord,
  FederatoResource,
  OverClause,
  PaginationClause,
  QueryPayload,
  QueryResult,
  SelectClause,
  SelectNode,
  SelectObject,
  SortClause,
  UnwindClause,
} from '../types';
import { applyWhere, readDotPath } from './where';

/** Every resource's records, keyed by resource name, as the snapshot holds them. */
export type RecordStore = Readonly<Record<FederatoResource, readonly FederatoRecord[]>>;

/** Which field on which resource points where, derived from the live schema. */
export interface ReferenceIndex {
  readonly resolve: (
    resource: FederatoResource,
    field: string,
  ) => { readonly target: FederatoResource; readonly many: boolean } | null;
}

/* -------------------------------------------------------------------------- */
/* Private helpers                                                            */
/* -------------------------------------------------------------------------- */

type Ref = { readonly target: FederatoResource; readonly many: boolean };
type Mutable = Record<string, unknown>;

/**
 * Every reference field in `docs/federato/live-schema.json`, transcribed.
 * Keys are dot-paths inside the owning resource (`producer.broker` sits in the
 * nested `producer` object). Cardinality `many` fields hold arrays of ids.
 */
const LIVE_SCHEMA_REFERENCES: Readonly<Record<FederatoResource, Readonly<Record<string, Ref>>>> = {
  Claim: {
    policy: { target: 'Policy', many: false },
    coverage: { target: 'Coverage', many: false },
    exposure_unit: { target: 'ExposureUnit', many: false },
  },
  Policy: {
    claims: { target: 'Claim', many: true },
    insured: { target: 'Insured', many: false },
    'producer.broker': { target: 'Broker', many: false },
    'producer.contact': { target: 'Contact', many: false },
    coverages: { target: 'Coverage', many: true },
    submission: { target: 'Submission', many: false },
    underwriter: { target: 'Underwriter', many: false },
    endorsements: { target: 'Endorsement', many: true },
    exposure_units: { target: 'ExposureUnit', many: true },
  },
  Contact: { broker: { target: 'Broker', many: false } },
  Insured: {
    hq: { target: 'Location', many: false },
    parent: { target: 'Insured', many: false },
  },
  Location: { buildings: { target: 'Building', many: true } },
  Submission: {
    broker: { target: 'Broker', many: false },
    contact: { target: 'Contact', many: false },
    insured: { target: 'Insured', many: false },
    underwriter: { target: 'Underwriter', many: false },
  },
  ExposureUnit: {
    location: { target: 'Location', many: false },
    'underlying_layer.policy': { target: 'Policy', many: false },
  },
  Broker: {},
  Building: {},
  Coverage: {},
  Endorsement: {},
  Underwriter: {},
};

const ALL_RESOURCES = Object.keys(LIVE_SCHEMA_REFERENCES) as FederatoResource[];

/** Hidden group metadata carried from `over` to `select`. Non-enumerable, so never serialised. */
const GROUP = Symbol('retrofit.mock.group');
interface GroupMeta {
  readonly rows: readonly FederatoRecord[];
  readonly keys: readonly string[];
}

const REDUCTION_KEYS = new Set(['$sum', '$avg', '$min', '$max', '$count', '$countDistinct']);

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function groupMeta(record: FederatoRecord): GroupMeta | undefined {
  return (record as { [GROUP]?: GroupMeta })[GROUP];
}

const idIndexCache = new WeakMap<readonly FederatoRecord[], Map<unknown, FederatoRecord>>();

function lookup(store: RecordStore, resource: FederatoResource, id: unknown): FederatoRecord | null {
  const rows = store[resource] ?? [];
  let index = idIndexCache.get(rows);
  if (index === undefined) {
    index = new Map();
    for (const row of rows) index.set(row['id'], row);
    idIndexCache.set(rows, index);
  }
  return index.get(id) ?? null;
}

/** Resolves an id, an array of ids, or an already-hydrated value against `target`. */
function hydrate(value: unknown, target: FederatoResource, store: RecordStore): unknown {
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const el of value) {
      const h = hydrate(el, target, store);
      if (h !== null) out.push(h);
    }
    return out;
  }
  if (value === null || value === undefined) return null;
  if (isPlainObject(value)) return value;
  return lookup(store, target, value);
}

function joinPath(prefix: string, key: string): string {
  return prefix === '' ? key : `${prefix}.${key}`;
}

/** Returns a copy of `record` with the dot-path `path` replaced by `value`. */
function setDotPath(record: FederatoRecord, segments: readonly string[], value: unknown): FederatoRecord {
  const [head, ...rest] = segments;
  if (head === undefined) return record;
  if (rest.length === 0) return { ...record, [head]: value };
  const child = record[head];
  return { ...record, [head]: setDotPath(isPlainObject(child) ? child : {}, rest, value) };
}

/** Like `readDotPath`, but fans across arrays and collects every leaf. Used by reductions. */
function collectPath(value: unknown, segments: readonly string[]): unknown[] {
  if (Array.isArray(value)) return value.flatMap((el) => collectPath(el, segments));
  const [head, ...rest] = segments;
  if (head === undefined) return [value];
  if (!isPlainObject(value) || !Object.prototype.hasOwnProperty.call(value, head)) return [];
  return collectPath(value[head], rest);
}

/** Total order used by sort and `$min`/`$max`: numbers, then strings, then booleans. */
function typeRank(v: unknown): number {
  if (typeof v === 'number') return 0;
  if (typeof v === 'string') return 1;
  if (typeof v === 'boolean') return 2;
  return 3;
}

function compareValues(a: unknown, b: unknown): number {
  const ra = typeRank(a);
  const rb = typeRank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 3) {
    const sa = JSON.stringify(a) ?? '';
    const sb = JSON.stringify(b) ?? '';
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  }
  const x = a as number | string | boolean;
  const y = b as number | string | boolean;
  return x < y ? -1 : x > y ? 1 : 0;
}

function isNullish(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v));
}

/* -------------------------------------------------------------------------- */
/* Reference index                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The index is the live schema's reference table (transcribed above). The store
 * is accepted for signature stability; references are never guessed from data.
 */
export function buildReferenceIndex(_store: RecordStore): ReferenceIndex {
  return {
    resolve: (resource, field) => LIVE_SCHEMA_REFERENCES[resource]?.[field] ?? null,
  };
}

/** Resolves a path whose owning resource is unknown: accepted only if every candidate agrees. */
function resolveAnywhere(refs: ReferenceIndex, field: string): Ref | null {
  let found: Ref | null = null;
  for (const r of ALL_RESOURCES) {
    const ref = refs.resolve(r, field);
    if (ref === null) continue;
    if (found !== null && found.target !== ref.target) return null;
    found = found ?? ref;
  }
  return found;
}

function resolveRef(refs: ReferenceIndex, resource: FederatoResource | null, field: string): Ref | null {
  return resource === null ? resolveAnywhere(refs, field) : refs.resolve(resource, field);
}

/* -------------------------------------------------------------------------- */
/* expand stage                                                               */
/* -------------------------------------------------------------------------- */

/** `true` and `{}` mean "stop here"; a string `'x'` means `{ x: true }`. */
function normalizeExpand(node: true | string | ExpandClause): ExpandClause {
  if (node === true) return {};
  if (typeof node === 'string') return { [node]: true };
  return node;
}

function expandValue(
  value: unknown,
  resource: FederatoResource,
  prefix: string,
  clause: ExpandClause,
  store: RecordStore,
  refs: ReferenceIndex,
): unknown {
  if (Array.isArray(value)) {
    return value.map((el) => expandValue(el, resource, prefix, clause, store, refs));
  }
  if (!isPlainObject(value)) return value;
  const out: Mutable = { ...value };
  for (const [key, raw] of Object.entries(clause)) {
    if (raw === undefined) continue;
    const sub = normalizeExpand(raw);
    const path = joinPath(prefix, key);
    const ref = refs.resolve(resource, path);
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    if (ref !== null) {
      const hydrated = hydrate(value[key], ref.target, store);
      out[key] =
        Object.keys(sub).length === 0
          ? hydrated
          : expandValue(hydrated, ref.target, '', sub, store, refs);
    } else {
      // A nested plain object (e.g. `producer`) — descend without changing resource.
      out[key] = expandValue(value[key], resource, path, sub, store, refs);
    }
  }
  return out;
}

/** The `expand` STAGE: replaces reference ids with hydrated records. */
export function applyExpand(
  records: readonly FederatoRecord[],
  resource: FederatoResource,
  clause: ExpandClause | undefined,
  store: RecordStore,
  refs: ReferenceIndex,
): readonly FederatoRecord[] {
  if (clause === undefined || Object.keys(clause).length === 0) return records;
  return records.map(
    (r) => expandValue(r, resource, '', clause, store, refs) as FederatoRecord,
  );
}

/* -------------------------------------------------------------------------- */
/* unwind stage                                                               */
/* -------------------------------------------------------------------------- */

/** Fans arrays into rows. `inner` drops empty parents, `left` keeps them. */
export function applyUnwind(
  records: readonly FederatoRecord[],
  clause: UnwindClause | undefined,
): readonly FederatoRecord[] {
  if (clause === undefined || clause.length === 0) return records;
  let rows = records;
  for (const entry of clause) {
    const path = typeof entry === 'string' ? entry : entry.path;
    const type = typeof entry === 'string' ? 'inner' : (entry.type ?? 'inner');
    const segments = path.split('.');
    const next: FederatoRecord[] = [];
    for (const row of rows) {
      const value = readDotPath(row, path);
      if (Array.isArray(value)) {
        if (value.length === 0) {
          if (type === 'left') next.push(setDotPath(row, segments, null));
          continue;
        }
        for (const el of value) next.push(setDotPath(row, segments, el));
      } else if (value === null || value === undefined) {
        if (type === 'left') next.push(row);
      } else {
        // A scalar or object is a one-element array.
        next.push(row);
      }
    }
    rows = next;
  }
  return rows;
}

/* -------------------------------------------------------------------------- */
/* over stage                                                                 */
/* -------------------------------------------------------------------------- */

function isReduction(node: unknown): boolean {
  if (!isPlainObject(node)) return false;
  const keys = Object.keys(node);
  return keys.length === 1 && REDUCTION_KEYS.has(keys[0] as string);
}

function isExpandLeaf(node: unknown): boolean {
  return isPlainObject(node) && Object.prototype.hasOwnProperty.call(node, '$expand');
}

/** True when any reduction sits in the tree (not inside a `$expand` sub-select). */
function hasReduction(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(hasReduction);
  if (!isPlainObject(node)) return false;
  if (isReduction(node)) return true;
  if (isExpandLeaf(node)) return false;
  return Object.values(node).some(hasReduction);
}

/**
 * Partitions rows like SQL `GROUP BY`, per `QUERY_REQUEST_BODY.pdf`.
 * The live handler does NOT do this and the planner never emits `over`
 * (LIVE_DATA_FACTS.md); the mock implements it only for parity testing.
 *
 * `over` defaults to `['id']`, but only when `select` holds a reduction — with
 * neither, the stage is a no-op and rows pass through untouched.
 */
export function applyOver(
  records: readonly FederatoRecord[],
  clause: OverClause | undefined,
  select: SelectClause | undefined,
): readonly FederatoRecord[] {
  if (clause === undefined && !hasReduction(select)) return records;
  const keys = clause ?? ['id'];
  const groups = new Map<string, FederatoRecord[]>();
  for (const row of records) {
    const k = JSON.stringify(keys.map((p) => readDotPath(row, p) ?? null));
    const bucket = groups.get(k);
    if (bucket === undefined) groups.set(k, [row]);
    else bucket.push(row);
  }
  const out: FederatoRecord[] = [];
  for (const rows of groups.values()) {
    const rep: Mutable = { ...(rows[0] as FederatoRecord) };
    const meta: GroupMeta = { rows, keys };
    Object.defineProperty(rep, GROUP, { value: meta, enumerable: false });
    out.push(rep);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* select stage                                                               */
/* -------------------------------------------------------------------------- */

function mergeSelect(into: Mutable, key: string, rawNode: SelectNode): void {
  const node: SelectNode = Array.isArray(rawNode)
    ? normalizeSelect(rawNode as readonly string[])
    : rawNode;
  const existing = into[key];
  if (existing === true || node === true) {
    into[key] = true;
    return;
  }
  if (
    existing === undefined ||
    !isPlainObject(existing) ||
    !isPlainObject(node) ||
    isReduction(node) ||
    isExpandLeaf(node) ||
    isReduction(existing) ||
    isExpandLeaf(existing)
  ) {
    into[key] = node;
    return;
  }
  const merged: Mutable = { ...existing };
  for (const [k, v] of Object.entries(normalizeSelect(node as SelectObject))) {
    mergeSelect(merged, k, v);
  }
  into[key] = merged;
}

/** Array form, dot-path keys and nested forms all become one nested `SelectObject`. */
function normalizeSelect(clause: SelectClause | readonly string[]): SelectObject {
  const out: Mutable = {};
  const put = (path: string, node: SelectNode): void => {
    const [head, ...rest] = path.split('.');
    if (head === undefined) return;
    if (rest.length === 0) mergeSelect(out, head, node);
    else {
      const wrapped: Mutable = {};
      let cursor = wrapped;
      rest.forEach((seg, i) => {
        if (i === rest.length - 1) cursor[seg] = node;
        else {
          const nextObj: Mutable = {};
          cursor[seg] = nextObj;
          cursor = nextObj;
        }
      });
      mergeSelect(out, head, wrapped as SelectObject);
    }
  };
  if (Array.isArray(clause)) {
    for (const entry of clause as readonly (string | SelectObject)[]) {
      if (typeof entry === 'string') put(entry, true);
      else for (const [k, v] of Object.entries(entry)) put(k, v);
    }
  } else {
    for (const [k, v] of Object.entries(clause as SelectObject)) put(k, v);
  }
  return out as SelectObject;
}

function reduce(node: Readonly<Record<string, unknown>>, rows: readonly FederatoRecord[]): unknown {
  const [op, arg] = Object.entries(node)[0] as [string, unknown];
  if (op === '$count') return rows.length;
  if (op === '$countDistinct') {
    const paths = (Array.isArray(arg) ? arg : [arg]) as string[];
    const seen = new Set<string>();
    for (const row of rows) {
      if (paths.length === 1) {
        for (const v of collectPath(row, (paths[0] as string).split('.'))) {
          if (!isNullish(v)) seen.add(JSON.stringify(v));
        }
      } else {
        const tuple = paths.map((p) => readDotPath(row, p));
        if (tuple.some(isNullish)) continue;
        seen.add(JSON.stringify(tuple));
      }
    }
    return seen.size;
  }
  const segments = String(arg).split('.');
  const values = rows.flatMap((row) => collectPath(row, segments)).filter((v) => !isNullish(v));
  switch (op) {
    case '$sum':
      return values.reduce<number>(
        (acc, v) => (typeof v === 'number' && Number.isFinite(v) ? acc + v : acc),
        0,
      );
    case '$avg': {
      const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      return nums.length === 0 ? null : nums.reduce((a, b) => a + b, 0) / nums.length;
    }
    case '$min':
    case '$max': {
      let best: unknown = null;
      for (const v of values) {
        if (best === null) best = v;
        else {
          const c = compareValues(v, best);
          if (op === '$min' ? c < 0 : c > 0) best = v;
        }
      }
      return best;
    }
    default:
      throw new Error(`mock select: unsupported reduction ${op}`);
  }
}

interface SelectContext {
  readonly store: RecordStore;
  readonly refs: ReferenceIndex;
  /** Rows reductions run over; paths in reductions are absolute from these. */
  readonly rows: readonly FederatoRecord[];
}

function projectValue(
  value: unknown,
  node: SelectNode,
  resource: FederatoResource | null,
  path: string,
  ctx: SelectContext,
): unknown {
  if (node === true) return value === undefined ? null : value;
  if (isReduction(node)) return reduce(node as Readonly<Record<string, unknown>>, ctx.rows);
  if (isExpandLeaf(node)) {
    const ref = resolveRef(ctx.refs, resource, path);
    const spec = (node as { $expand: true | { select?: SelectClause } }).$expand;
    const hydrated = ref === null ? (value === undefined ? null : value) : hydrate(value, ref.target, ctx.store);
    const sub = spec === true ? undefined : spec.select;
    if (sub === undefined || hydrated === null) return hydrated;
    const target = ref?.target ?? null;
    const one = (h: unknown): unknown =>
      isPlainObject(h)
        ? projectObject(h, normalizeSelect(sub), target, '', { ...ctx, rows: [h] })
        : h;
    return Array.isArray(hydrated) ? hydrated.map(one) : one(hydrated);
  }
  const obj = Array.isArray(node) ? normalizeSelect(node as readonly string[]) : (node as SelectObject);
  // Descending through a hydrated reference changes the resource context.
  const ref = resolveRef(ctx.refs, resource, path);
  const nextResource = ref !== null ? ref.target : resource;
  const nextPrefix = ref !== null ? '' : path;
  if (Array.isArray(value)) {
    return value.map((el) =>
      isPlainObject(el) ? projectObject(el, obj, nextResource, nextPrefix, ctx) : el,
    );
  }
  if (isPlainObject(value)) return projectObject(value, obj, nextResource, nextPrefix, ctx);
  if (hasReduction(obj)) return projectObject({}, obj, nextResource, nextPrefix, ctx);
  return value === undefined ? null : value;
}

function projectObject(
  source: Readonly<Record<string, unknown>>,
  select: SelectObject,
  resource: FederatoResource | null,
  prefix: string,
  ctx: SelectContext,
): FederatoRecord {
  const out: Mutable = {};
  for (const [key, node] of Object.entries(select)) {
    out[key] = projectValue(source[key], node, resource, joinPath(prefix, key), ctx);
  }
  return out;
}

function selectRows(
  records: readonly FederatoRecord[],
  clause: SelectClause | undefined,
  store: RecordStore,
  refs: ReferenceIndex,
  resource: FederatoResource | null,
): readonly FederatoRecord[] {
  if (clause === undefined) {
    return records.map((r) => {
      const meta = groupMeta(r);
      if (meta === undefined) return r;
      const keySelect = normalizeSelect(meta.keys as readonly string[]);
      return projectObject(r, keySelect, resource, '', { store, refs, rows: meta.rows });
    });
  }
  const select = normalizeSelect(clause);
  return records.map((r) => {
    const rows = groupMeta(r)?.rows ?? [r];
    return projectObject(r, select, resource, '', { store, refs, rows });
  });
}

/** Projection, `$expand` leaves and the six reductions. */
export function applySelect(
  records: readonly FederatoRecord[],
  clause: SelectClause | undefined,
  store: RecordStore,
  refs: ReferenceIndex,
): readonly FederatoRecord[] {
  return selectRows(records, clause, store, refs, null);
}

/* -------------------------------------------------------------------------- */
/* sort + pagination                                                          */
/* -------------------------------------------------------------------------- */

/** Priority order, `asc` by default, nulls last. Runs after `select`. */
export function applySort(
  records: readonly FederatoRecord[],
  clause: SortClause | undefined,
): readonly FederatoRecord[] {
  if (clause === undefined || clause.length === 0) return records;
  return [...records].sort((a, b) => {
    for (const rule of clause) {
      const va = readDotPath(a, rule.field);
      const vb = readDotPath(b, rule.field);
      const na = isNullish(va);
      const nb = isNullish(vb);
      if (na && nb) continue;
      if (na) return 1;
      if (nb) return -1;
      const c = compareValues(va, vb);
      if (c !== 0) return rule.direction === 'desc' ? -c : c;
    }
    return 0;
  });
}

export function applyPagination(
  records: readonly FederatoRecord[],
  clause: PaginationClause | undefined,
): readonly FederatoRecord[] {
  if (clause === undefined) return records;
  const offset =
    clause.offset !== undefined && Number.isFinite(clause.offset)
      ? Math.max(0, Math.floor(clause.offset))
      : 0;
  if (clause.limit === undefined || !Number.isFinite(clause.limit)) return records.slice(offset);
  const limit = Math.max(0, Math.floor(clause.limit));
  return records.slice(offset, offset + limit);
}

/* -------------------------------------------------------------------------- */
/* whole pipeline                                                             */
/* -------------------------------------------------------------------------- */

/** Runs the whole pipeline in order. `total` is the count before pagination. */
export function runPipeline<T = FederatoRecord>(
  payload: QueryPayload,
  store: RecordStore,
  refs?: ReferenceIndex,
): QueryResult<T> {
  const index = refs ?? buildReferenceIndex(store);
  const resource = payload.resource;
  let rows: readonly FederatoRecord[] = store[resource] ?? [];
  rows = applyWhere(rows, payload.where);
  rows = applyExpand(rows, resource, payload.expand, store, index);
  rows = applyUnwind(rows, payload.unwind);
  rows = applyWhere(rows, payload.filter);
  rows = applyOver(rows, payload.over, payload.select);
  rows = selectRows(rows, payload.select, store, index, resource);
  rows = applySort(rows, payload.sort);
  const total = rows.length;
  const page = applyPagination(rows, payload.pagination) as readonly T[];
  if (payload.over !== undefined) {
    return { resource, total, results: page, groups: page as readonly FederatoRecord[] };
  }
  return { resource, total, results: page };
}
