/**
 * Mock query engine, part 2: the rest of the pipeline —
 * expand / unwind / filter / over / select (incl. `$expand` and reductions) /
 * sort / pagination. Body owned by Run 1 unit F04.
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
  SortClause,
  UnwindClause,
} from '../types';

/** Every resource's records, keyed by resource name, as the snapshot holds them. */
export type RecordStore = Readonly<Record<FederatoResource, readonly FederatoRecord[]>>;

/** Which field on which resource points where, derived from the live schema. */
export interface ReferenceIndex {
  readonly resolve: (
    resource: FederatoResource,
    field: string,
  ) => { readonly target: FederatoResource; readonly many: boolean } | null;
}

export function buildReferenceIndex(_store: RecordStore): ReferenceIndex {
  throw new Error('NOT_IMPLEMENTED:F04');
}

/** The `expand` STAGE: replaces reference ids with hydrated records. */
export function applyExpand(
  _records: readonly FederatoRecord[],
  _resource: FederatoResource,
  _clause: ExpandClause | undefined,
  _store: RecordStore,
  _refs: ReferenceIndex,
): readonly FederatoRecord[] {
  throw new Error('NOT_IMPLEMENTED:F04');
}

/** Fans arrays into rows. `inner` drops empty parents, `left` keeps them. */
export function applyUnwind(
  _records: readonly FederatoRecord[],
  _clause: UnwindClause | undefined,
): readonly FederatoRecord[] {
  throw new Error('NOT_IMPLEMENTED:F04');
}

/**
 * Partitions rows like SQL `GROUP BY`, per `QUERY_REQUEST_BODY.pdf`.
 * The live handler does NOT do this and the planner never emits `over`
 * (LIVE_DATA_FACTS.md); the mock implements it only for parity testing.
 */
export function applyOver(
  _records: readonly FederatoRecord[],
  _clause: OverClause | undefined,
  _select: SelectClause | undefined,
): readonly FederatoRecord[] {
  throw new Error('NOT_IMPLEMENTED:F04');
}

/** Projection, `$expand` leaves and the six reductions. */
export function applySelect(
  _records: readonly FederatoRecord[],
  _clause: SelectClause | undefined,
  _store: RecordStore,
  _refs: ReferenceIndex,
): readonly FederatoRecord[] {
  throw new Error('NOT_IMPLEMENTED:F04');
}

/** Priority order, `asc` by default, nulls last. Runs after `select`. */
export function applySort(
  _records: readonly FederatoRecord[],
  _clause: SortClause | undefined,
): readonly FederatoRecord[] {
  throw new Error('NOT_IMPLEMENTED:F04');
}

export function applyPagination(
  _records: readonly FederatoRecord[],
  _clause: PaginationClause | undefined,
): readonly FederatoRecord[] {
  throw new Error('NOT_IMPLEMENTED:F04');
}

/** Runs the whole pipeline in order. `total` is the count before pagination. */
export function runPipeline<T = FederatoRecord>(
  _payload: QueryPayload,
  _store: RecordStore,
  _refs?: ReferenceIndex,
): QueryResult<T> {
  throw new Error('NOT_IMPLEMENTED:F04');
}
