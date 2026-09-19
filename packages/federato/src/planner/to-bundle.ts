/**
 * Query results -> one `RawBundle` per submission, ready for engine stage 1.
 *
 * - A survivor with a hydrated policy gets `records.Policy` = its hydrated
 *   policy row(s) (plus any high-scorer follow-up rows for the same account).
 *   The engine walks the nested `submission`, `insured`, `claims` and
 *   `exposure_units[].location.buildings[]` objects itself.
 * - A survivor with no policy gets `records.Submission` = the no-policy
 *   follow-up row (`insured -> hq`, `broker` expanded).
 * - A survivor neither pass returned still gets a bundle carrying its triage
 *   row, so it resolves to REFER with missing data instead of vanishing.
 *
 * Body owned by Run 1 unit F09.
 */
import type { LineOfBusiness, RawBundle, RawRecord, SchemaDocument } from '@retrofit/engine';
import type { FederatoRecord, TriageSurvivor } from '../types';

export interface ToBundleInput {
  /** Hydrated `Policy` rows from the deep pass, each carrying `submission`. */
  readonly policies: readonly FederatoRecord[];
  /** `Submission` rows from the no-policy follow-up. */
  readonly noPolicySubmissions: readonly FederatoRecord[];
  readonly followUps: readonly FederatoRecord[];
  readonly survivors: readonly TriageSurvivor[];
  readonly schema: SchemaDocument;
  readonly fetchedAt: string;
  /** Trace ids to attach to every bundle, for the console. */
  readonly queryTraceIds: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* Private helpers                                                            */
/* -------------------------------------------------------------------------- */

function isPlainObject(v: unknown): v is Readonly<Record<string, unknown>> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function nonEmptyText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

function idText(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return nonEmptyText(v);
}

function recordId(row: FederatoRecord, fallback: string): string | number {
  const id = row['id'];
  if (typeof id === 'number' && Number.isFinite(id)) return id;
  if (typeof id === 'string' && id.trim() !== '') return id;
  return fallback;
}

function toRaw(resource: string, row: FederatoRecord, fallbackId: string): RawRecord {
  return { resource, id: recordId(row, fallbackId), data: row };
}

function byId(a: FederatoRecord, b: FederatoRecord): number {
  const x = a['id'];
  const y = b['id'];
  if (typeof x === 'number' && typeof y === 'number') return x - y;
  return String(x ?? '').localeCompare(String(y ?? ''));
}

/** The row carries an expanded claims list: claim objects, or an empty array. Bare ids do not count. */
function claimsExpanded(row: FederatoRecord): boolean {
  const claims = row['claims'];
  return Array.isArray(claims) && claims.every(isPlainObject);
}

/** Federato's `property` is the only line Retrofit scores as commercial property. */
function lineOf(value: unknown): LineOfBusiness | undefined {
  const t = nonEmptyText(value);
  return t !== null && t.toLowerCase() === 'property' ? 'commercial_property' : undefined;
}

/** Groups rows by external id; rows with no identity are dropped. */
function groupByExternalId(rows: readonly FederatoRecord[]): Map<string, FederatoRecord[]> {
  const out = new Map<string, FederatoRecord[]>();
  for (const row of rows) {
    let key: string;
    try {
      key = externalIdOf(row);
    } catch {
      continue;
    }
    const bucket = out.get(key);
    if (bucket === undefined) out.set(key, [row]);
    else bucket.push(row);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Public                                                                     */
/* -------------------------------------------------------------------------- */

/** Flattens a hydrated policy into the per-resource record map the engine reads. */
export function toBundles(input: ToBundleInput): readonly RawBundle[] {
  const policies = groupByExternalId(input.policies);
  const noPolicy = groupByExternalId(input.noPolicySubmissions);
  const followUps = groupByExternalId(input.followUps);
  const survivorById = new Map<string, TriageSurvivor>();
  for (const s of input.survivors) {
    if (!survivorById.has(s.externalId)) survivorById.set(s.externalId, s);
  }

  // Survivors first, in triage order; then anything a pass returned that
  // triage did not list, so no hydrated account is silently dropped.
  const order: string[] = [];
  const seen = new Set<string>();
  const add = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    order.push(id);
  };
  for (const s of input.survivors) add(s.externalId);
  for (const id of [...policies.keys()].sort((a, b) => a.localeCompare(b))) add(id);
  for (const id of [...noPolicy.keys()].sort((a, b) => a.localeCompare(b))) add(id);

  const queryTraceIds = [...input.queryTraceIds];

  return order.map((externalId): RawBundle => {
    const policyRows = [...(policies.get(externalId) ?? [])].sort(byId);
    const records: Record<string, readonly RawRecord[]> = {};
    let line: LineOfBusiness | undefined;

    if (policyRows.length > 0) {
      const extra = [...(followUps.get(externalId) ?? [])].sort(byId);
      records['Policy'] = [...policyRows, ...extra].map((row) => toRaw('Policy', row, externalId));
      // The deep pass expands claims inside the Policy row. An expanded list
      // (claim objects, or empty) means the claims list WAS retrieved, so mark
      // it with an empty Claim key: zero claims is then a known 0, not missing
      // (I-4, W0-2.8). Empty, so normalize never counts a claim twice.
      if (policyRows.some(claimsExpanded)) records['Claim'] = [];
      line = lineOf(policyRows[0]?.['line_of_business']);
      if (line === undefined) {
        const sub = policyRows[0]?.['submission'];
        if (isPlainObject(sub)) line = lineOf(sub['line_of_business']);
      }
    } else {
      const subRows = [...(noPolicy.get(externalId) ?? [])].sort(byId);
      if (subRows.length > 0) {
        records['Submission'] = subRows.map((row) => toRaw('Submission', row, externalId));
        line = lineOf(subRows[0]?.['line_of_business']);
      } else {
        const survivor = survivorById.get(externalId);
        if (survivor !== undefined) {
          const row: FederatoRecord = {
            id: survivor.submissionId,
            submission_number: externalId,
            status: survivor.status === '' ? null : survivor.status,
            line_of_business: survivor.lineOfBusiness === '' ? null : survivor.lineOfBusiness,
          };
          records['Submission'] = [toRaw('Submission', row, externalId)];
          line = lineOf(survivor.lineOfBusiness);
        }
      }
    }

    return {
      externalId,
      ...(line === undefined ? {} : { lineOfBusiness: line }),
      records,
      schema: input.schema,
      fetchedAt: input.fetchedAt,
      queryTraceIds,
    };
  });
}

/** The external id used everywhere: the submission number, not the policy id. */
export function externalIdOf(record: FederatoRecord): string {
  const own = nonEmptyText(record['submission_number']);
  if (own !== null) return own;

  if ('submission' in record) {
    const sub = record['submission'];
    if (isPlainObject(sub)) return externalIdOf(sub);
    const subId = idText(sub);
    if (subId !== null) return `submission:${subId}`;
    throw new Error('externalIdOf: policy row has no submission reference');
  }

  const id = idText(record['id']);
  if (id !== null) return `submission:${id}`;
  throw new Error('externalIdOf: record has neither submission_number, submission nor id');
}
