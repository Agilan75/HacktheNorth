/**
 * Fixtures built from the real Federato snapshot. Body owned by Run 1 unit E17.
 *
 * The 27 property policies that carry buildings and a premium, normalized to
 * CanonicalSubmission, plus the 11 property submissions with no policy. These
 * back the golden test and are the rows the rating fit is trained on.
 *
 * This file is fixture/CLI support, not a stage: it is the one place under
 * `src/fixtures` that reads the committed snapshot from disk (docs/decisions/E17.md
 * D-1). No stage imports it. It never touches the network.
 */
import { readFileSync } from 'node:fs';
import type {
  CanonicalSubmission,
  RawBundle,
  RawRecord,
  SchemaDocument,
  VectorSpec,
} from '../types.js';
import { vectorSpecSchema } from '../schemas.js';
import { discover } from '../stages/discover.js';
import { normalize } from '../stages/normalize.js';

export interface RealCase {
  readonly externalId: string;
  readonly submission: CanonicalSubmission;
  readonly hasPolicy: boolean;
}

type Row = Readonly<Record<string, unknown>>;

/** packages/federato/snapshot, resolved from this module (src/fixtures/real.ts). */
const SNAPSHOT_URL = new URL('../../../federato/snapshot/snapshot.json', import.meta.url);
const HYDRATED_URL = new URL(
  '../../../federato/snapshot/policy-property-hydrated.json',
  import.meta.url,
);
const SPEC_URL = new URL('../../vectors/commercial.json', import.meta.url);

/** Statuses of a property submission that never became a policy (LIVE_DATA_FACTS). */
const NO_POLICY_STATUSES = new Set(['lost', 'cleared', 'quoted', 'declined', 'received']);

function isRow(v: unknown): v is Row {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function readJson(url: URL): unknown {
  return JSON.parse(readFileSync(url, 'utf8')) as unknown;
}

function rowsOf(v: unknown, what: string): Row[] {
  if (!Array.isArray(v) || !v.every(isRow)) throw new Error(`realCases: ${what} is not a row array`);
  return v;
}

function idOf(row: Row): string | number {
  const id = row['id'];
  if (typeof id === 'number' || typeof id === 'string') return id;
  throw new Error('realCases: row without an id');
}

function submissionNumber(row: Row): string {
  const n = row['submission_number'];
  if (typeof n !== 'string' || n.trim() === '') throw new Error('realCases: row without submission_number');
  return n.trim();
}

function raw(resource: string, row: Row): RawRecord {
  return { resource, id: idOf(row), data: row };
}

function referencedId(v: unknown): unknown {
  return isRow(v) ? v['id'] : v;
}

function build(bundle: RawBundle, spec: VectorSpec): CanonicalSubmission {
  const fieldMap = discover(bundle, bundle.schema, spec);
  return normalize(bundle, fieldMap, 'commercial_property');
}

let cache: readonly RealCase[] | null = null;

/** Loads from packages/federato's committed snapshot. Never hits the network. */
export function realCases(): readonly RealCase[] {
  if (cache !== null) return cache;

  const snapshot = readJson(SNAPSHOT_URL);
  const hydrated = readJson(HYDRATED_URL);
  if (!isRow(snapshot) || !isRow(snapshot['records']) || !isRow(snapshot['schema'])) {
    throw new Error('realCases: snapshot.json has no records/schema');
  }
  if (!isRow(hydrated)) throw new Error('realCases: policy-property-hydrated.json is not an object');

  const spec = vectorSpecSchema.parse(readJson(SPEC_URL)) as unknown as VectorSpec;
  const schema = snapshot['schema'] as unknown as SchemaDocument;
  const records = snapshot['records'];
  const fetchedAt =
    typeof hydrated['fetchedAt'] === 'string'
      ? hydrated['fetchedAt']
      : String(snapshot['fetchedAt'] ?? '');

  /* 27 hydrated property policies (the deep pass, PRD 7.5 step 4). ---------- */
  const policies = rowsOf(hydrated['results'], 'hydrated results')
    .map((row) => {
      const sub = row['submission'];
      if (!isRow(sub)) throw new Error('realCases: hydrated policy without a submission object');
      return { externalId: submissionNumber(sub), row };
    })
    .sort((a, b) => a.externalId.localeCompare(b.externalId));

  const policyCases: RealCase[] = policies.map(({ externalId, row }) => {
    const bundle: RawBundle = {
      externalId,
      lineOfBusiness: 'commercial_property',
      records: { Policy: [raw('Policy', row)] },
      schema,
      fetchedAt,
    };
    return { externalId, submission: build(bundle, spec), hasPolicy: true };
  });

  /* 11 property submissions with no policy, insured -> hq and broker expanded. */
  const allPolicies = rowsOf(records['Policy'], 'records.Policy');
  const withPolicy = new Set(allPolicies.map((p) => String(referencedId(p['submission']))));
  const insuredById = new Map(rowsOf(records['Insured'], 'records.Insured').map((r) => [String(idOf(r)), r]));
  const locationById = new Map(rowsOf(records['Location'], 'records.Location').map((r) => [String(idOf(r)), r]));
  const brokerById = new Map(rowsOf(records['Broker'], 'records.Broker').map((r) => [String(idOf(r)), r]));

  const noPolicyCases: RealCase[] = rowsOf(records['Submission'], 'records.Submission')
    .filter(
      (s) =>
        s['line_of_business'] === 'property' &&
        typeof s['status'] === 'string' &&
        NO_POLICY_STATUSES.has(s['status']) &&
        !withPolicy.has(String(idOf(s))),
    )
    .map((s) => {
      const insured = insuredById.get(String(s['insured']));
      const hq = insured === undefined ? undefined : locationById.get(String(insured['hq']));
      const broker = brokerById.get(String(s['broker']));
      const expanded: Row = {
        ...s,
        ...(insured === undefined ? {} : { insured: hq === undefined ? insured : { ...insured, hq } }),
        ...(broker === undefined ? {} : { broker }),
      };
      return { externalId: submissionNumber(s), row: expanded };
    })
    .sort((a, b) => a.externalId.localeCompare(b.externalId))
    .map(({ externalId, row }) => {
      const bundle: RawBundle = {
        externalId,
        lineOfBusiness: 'commercial_property',
        records: { Submission: [raw('Submission', row)] },
        schema,
        fetchedAt,
      };
      return { externalId, submission: build(bundle, spec), hasPolicy: false };
    });

  cache = [...policyCases, ...noPolicyCases];
  return cache;
}
