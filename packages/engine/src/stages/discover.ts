/** Stage 1 — discover. Body owned by Run 1 unit E02. */
import { MIN_MAP_CONFIDENCE } from '../constants.js';
import type { FieldMap, FieldMapEntry, RawBundle, SchemaDocument, UnmappedKey, VectorSpec } from '../types.js';

/** Assist callback for names the synonym table cannot resolve. Injected, never called by the engine itself. */
export type SchemaAssist = (
  unmapped: readonly { rawPath: string; sampleValues: readonly unknown[] }[],
) => readonly { rawPath: string; canonicalPath: string; confidence: number }[];

/* -------------------------------------------------------------------------- */
/* Private vocabulary                                                         */
/*                                                                            */
/* NOTE: this is generic insurance vocabulary (canonical leaf names plus the   */
/* ordinary English synonyms for them), not a Federato schema table. Federato  */
/* field *paths* live only in packages/federato/src/planner/synonyms.ts (F07). */
/* Discovery here is by normalized-name equality first (`year_built` and       */
/* `yearBuilt` both normalize to `yearbuilt`), aliases only as a fallback.     */
/* -------------------------------------------------------------------------- */

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
  | 'exposure'
  | 'other';

interface Target {
  readonly canonicalPath: string;
  readonly group: Group;
  /** Extra accepted names, normalized. The canonical leaf itself is implicit. */
  readonly aliases: readonly string[];
  /** Only offered when the vector spec is the tenant spec. */
  readonly tenantOnly?: boolean;
}

const EXACT_CONFIDENCE = 1;
const SYNONYM_CONFIDENCE = 0.9;
/** A nested / referenced path costs a little confidence but stays above the gate. */
const GRAPH_PENALTY = 0.05;
/** A fuzzy guess is never accepted; it is only shown next to the unmapped key. */
const MAX_GUESS_CONFIDENCE = 0.7;

const TARGETS: readonly Target[] = [
  // submission
  { canonicalPath: 'externalId', group: 'submission', aliases: ['submissionnumber', 'accountnumber', 'reference', 'externalid'] },
  { canonicalPath: 'receivedDate', group: 'submission', aliases: ['datereceived', 'submissionreceived'] },
  { canonicalPath: 'effectiveDate', group: 'submission', aliases: ['targeteffectivedate', 'inceptiondate', 'effective'] },
  { canonicalPath: 'expirationDate', group: 'submission', aliases: ['expirydate', 'expiration'] },
  { canonicalPath: 'status', group: 'submission', aliases: [] },
  { canonicalPath: 'lineOfBusiness', group: 'submission', aliases: ['lob'] },
  { canonicalPath: 'exposure.requestedLimit', group: 'submission', aliases: ['limitrequested', 'requestedlimit'] },
  // policy
  { canonicalPath: 'pricing.quotedPremium', group: 'policy', aliases: ['premium', 'writtenpremium', 'quotedpremium'] },
  { canonicalPath: 'pricing.technicalPremium', group: 'policy', aliases: ['technicalpremium'] },
  { canonicalPath: 'pricing.targetPremium', group: 'policy', aliases: ['targetpremium'] },
  { canonicalPath: 'submissionType', group: 'policy', aliases: ['businesstype', 'transactiontype', 'submissiontype'] },
  { canonicalPath: 'effectiveDate', group: 'policy', aliases: ['effective', 'inceptiondate'] },
  { canonicalPath: 'expirationDate', group: 'policy', aliases: ['expiration', 'expirydate'] },
  { canonicalPath: 'receivedDate', group: 'policy', aliases: ['submissionreceived', 'datereceived'] },
  { canonicalPath: 'lineOfBusiness', group: 'policy', aliases: ['lob'] },
  { canonicalPath: 'exposure.requestedLimit', group: 'policy', aliases: ['limit', 'requestedlimit'] },
  // insured
  { canonicalPath: 'insured.name', group: 'insured', aliases: ['insuredname', 'legalname'] },
  { canonicalPath: 'insured.industry', group: 'insured', aliases: ['naicscode', 'naics', 'industry'] },
  { canonicalPath: 'insured.revenue', group: 'insured', aliases: ['annualrevenue', 'revenue'] },
  { canonicalPath: 'insured.employeeCount', group: 'insured', aliases: ['employees', 'headcount', 'employeecount'] },
  { canonicalPath: 'insured.headquartersState', group: 'insured', aliases: ['state', 'hqstate', 'headquartersstate'] },
  // broker / contact
  { canonicalPath: 'insured.brokerName', group: 'broker', aliases: ['name', 'brokername'] },
  { canonicalPath: 'insured.contactName', group: 'contact', aliases: ['name', 'contactname'] },
  { canonicalPath: 'insured.contactEmail', group: 'contact', aliases: ['email', 'emailaddress', 'contactemail'] },
  // location
  { canonicalPath: 'locations[].state', group: 'location', aliases: ['riskstate', 'primaryriskstate'] },
  { canonicalPath: 'locations[].city', group: 'location', aliases: ['town'] },
  { canonicalPath: 'locations[].postalCode', group: 'location', aliases: ['zip', 'zipcode', 'postcode', 'postalcode'] },
  { canonicalPath: 'locations[].latitude', group: 'location', aliases: ['lat'] },
  { canonicalPath: 'locations[].longitude', group: 'location', aliases: ['lon', 'lng', 'long'] },
  { canonicalPath: 'locations[].protectionClass', group: 'location', aliases: ['ppc', 'publicprotectionclass', 'protectionclass'] },
  { canonicalPath: 'locations[].hazardTags', group: 'location', aliases: ['perils', 'hazards', 'hazardtags'] },
  { canonicalPath: 'locations[].floodZone', group: 'location', aliases: ['floodzone'] },
  { canonicalPath: 'locations[].fireStationDistanceKm', group: 'location', aliases: ['distancetofirestation', 'firestationdistancekm'] },
  // building
  { canonicalPath: 'buildings[].tiv', group: 'building', aliases: ['totalinsuredvalue', 'insuredvalue', 'tiv'] },
  { canonicalPath: 'buildings[].yearBuilt', group: 'building', aliases: ['constructionyear', 'builtyear', 'yearbuilt'] },
  { canonicalPath: 'buildings[].constructionType', group: 'building', aliases: ['construction', 'constructionclass', 'constructiontype'] },
  { canonicalPath: 'buildings[].sprinklered', group: 'building', aliases: ['sprinklers', 'sprinklerprotected', 'sprinklered'] },
  { canonicalPath: 'buildings[].stories', group: 'building', aliases: ['numberofstories', 'floors', 'storeys'] },
  { canonicalPath: 'buildings[].roofYear', group: 'building', aliases: ['roofreplacementyear', 'roofyear'] },
  { canonicalPath: 'buildings[].occupancy', group: 'building', aliases: ['occupancytype'] },
  { canonicalPath: 'buildings[].protectionClass', group: 'building', aliases: ['ppc', 'protectionclass'] },
  { canonicalPath: 'buildings[].label', group: 'building', aliases: ['name', 'label'] },
  // claim
  { canonicalPath: 'history[].dateOfLoss', group: 'claim', aliases: ['lossdate', 'dateofloss'] },
  { canonicalPath: 'history[].causeOfLoss', group: 'claim', aliases: ['losscause', 'peril', 'causeofloss'] },
  { canonicalPath: 'history[].paidIndemnity', group: 'claim', aliases: ['indemnitypaid', 'paidindemnity'] },
  { canonicalPath: 'history[].paidExpense', group: 'claim', aliases: ['expensepaid', 'paidexpense'] },
  { canonicalPath: 'history[].reserves', group: 'claim', aliases: ['reserveindemnity', 'reserveexpense', 'outstandingreserve', 'reserves'] },
  // coverage
  { canonicalPath: 'coverage.lines[].code', group: 'coverage', aliases: ['coveragecode', 'code'] },
  { canonicalPath: 'coverage.lines[].limit', group: 'coverage', aliases: ['limitoccurrence', 'occurrencelimit', 'limitaggregate', 'aggregatelimit', 'limit'] },
  { canonicalPath: 'coverage.lines[].deductible', group: 'coverage', aliases: ['retention', 'deductible'] },
  // tenant-only exposure
  { canonicalPath: 'exposure.contentsLimit', group: 'building', aliases: ['contentsvalue', 'contents', 'contentslimit'], tenantOnly: true },
  { canonicalPath: 'exposure.squareFeet', group: 'building', aliases: ['squarefootage', 'sqft', 'area', 'squarefeet'], tenantOnly: true },
  { canonicalPath: 'exposure.termMonths', group: 'submission', aliases: ['term', 'termmonths'], tenantOnly: true },
  { canonicalPath: 'exposure.roomLabel', group: 'submission', aliases: ['room', 'roomlabel'], tenantOnly: true },
];

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
  exposureunit: 'exposure',
  exposure: 'exposure',
};

const HQ_SEGMENTS: readonly string[] = ['hq', 'headquarters', 'headquarter'];

/** Lower-case, strip everything that is not a letter or a digit. */
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
  const n = norm(name);
  return GROUP_NAMES[n] ?? GROUP_NAMES[singular(n)] ?? 'other';
}

function leafOf(canonicalPath: string): string {
  const parts = canonicalPath.split('.');
  return norm(parts[parts.length - 1] ?? canonicalPath);
}

/* -------------------------------------------------------------------------- */
/* Walking the raw records                                                    */
/* -------------------------------------------------------------------------- */

interface RawLeaf {
  /** Path inside the record, e.g. `dates.effective` or `exposure_units[].location.state`. */
  readonly path: string;
  readonly samples: unknown[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const MAX_SAMPLES = 3;
const MAX_DEPTH = 8;

function collectLeaves(
  value: unknown,
  prefix: string,
  out: Map<string, unknown[]>,
  depth: number,
): void {
  if (depth > MAX_DEPTH) return;
  if (Array.isArray(value)) {
    const objects = value.filter(isPlainObject);
    if (objects.length > 0) {
      for (const item of objects) collectLeaves(item, `${prefix}[]`, out, depth + 1);
      return;
    }
    // Array of scalars (ids, tags) — a leaf in its own right.
    push(out, prefix, value);
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      const next = prefix === '' ? key : `${prefix}.${key}`;
      collectLeaves(child, next, out, depth + 1);
    }
    return;
  }
  if (prefix !== '') push(out, prefix, value);
}

function push(out: Map<string, unknown[]>, path: string, value: unknown): void {
  const bucket = out.get(path);
  if (bucket === undefined) {
    out.set(path, value === null || value === undefined ? [] : [value]);
    return;
  }
  if (value === null || value === undefined) return;
  if (bucket.length >= MAX_SAMPLES) return;
  if (bucket.some((v) => v === value)) return;
  bucket.push(value);
}

/* -------------------------------------------------------------------------- */
/* Group resolution for one raw path                                          */
/* -------------------------------------------------------------------------- */

function referenceTarget(
  schema: SchemaDocument | undefined,
  resource: string,
  fieldPath: string,
): string | null {
  if (schema === undefined) return null;
  const res = schema.resources.find((r) => norm(r.name) === norm(resource));
  if (res === undefined) return null;
  const field = res.fields.find((f) => f.path === fieldPath);
  return field?.reference ?? null;
}

interface Resolved {
  readonly group: Group;
  /** True when the leaf sat under a nested object or a reference hop. */
  readonly viaGraph: boolean;
  readonly hint: string | null;
  /** True when a `hq`-style segment pinned the leaf to the insured. */
  readonly viaHq: boolean;
}

/**
 * The only insured attribute a hq Location carries. Its name, city, zip and so
 * on describe a building, not the account (R2 I3-2): `hq.name` is never
 * `insured.name`.
 */
const HQ_CANONICAL = 'insured.headquartersState';

/**
 * Which canonical group a leaf inside `resource` belongs to. The nearest
 * ancestor segment that names a group wins; a `hq`-style segment pins the leaf
 * to the insured instead of to a location; otherwise the record's own resource
 * decides.
 */
function resolveGroup(resource: string, path: string, schema: SchemaDocument | undefined): Resolved {
  const segments = path.split('.').map((s) => s.replace(/\[\]$/, ''));
  const ancestors = segments.slice(0, -1);
  const viaGraph = ancestors.length > 0;
  let hint: string | null = null;
  for (let i = ancestors.length - 1; i >= 0; i -= 1) {
    const seg = ancestors[i] ?? '';
    if (HQ_SEGMENTS.includes(norm(seg))) return { group: 'insured', viaGraph, hint: seg, viaHq: true };
    const byName = groupOf(seg);
    if (byName !== 'other' && byName !== 'exposure') return { group: byName, viaGraph, hint: seg, viaHq: false };
    const ownerPath = ancestors.slice(0, i + 1).join('.');
    const ref = referenceTarget(schema, resource, ownerPath);
    if (ref !== null) {
      const byRef = groupOf(ref);
      if (byRef !== 'other' && byRef !== 'exposure') return { group: byRef, viaGraph, hint: ref, viaHq: false };
    }
    if (hint === null) hint = seg;
  }
  return { group: groupOf(resource), viaGraph, hint, viaHq: false };
}

/* -------------------------------------------------------------------------- */
/* Matching                                                                   */
/* -------------------------------------------------------------------------- */

interface Match {
  readonly canonicalPath: string;
  readonly confidence: number;
  readonly method: 'exact' | 'synonym';
}

function matchTarget(group: Group, rawLeaf: string, tenant: boolean): Match | null {
  const leaf = norm(rawLeaf);
  let synonym: Match | null = null;
  for (const target of TARGETS) {
    if (target.group !== group) continue;
    if (target.tenantOnly === true && !tenant) continue;
    if (leafOf(target.canonicalPath) === leaf) {
      return { canonicalPath: target.canonicalPath, confidence: EXACT_CONFIDENCE, method: 'exact' };
    }
    if (synonym === null && target.aliases.some((a) => norm(a) === leaf)) {
      synonym = {
        canonicalPath: target.canonicalPath,
        confidence: SYNONYM_CONFIDENCE,
        method: 'synonym',
      };
    }
  }
  return synonym;
}

/** Character-bigram similarity, 0..1. Only ever used to show a rejected guess. */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s: string): string[] => {
    const out: string[] = [];
    for (let i = 0; i < s.length - 1; i += 1) out.push(s.slice(i, i + 2));
    return out;
  };
  const left = grams(a);
  const right = grams(b);
  const pool = [...right];
  let hits = 0;
  for (const g of left) {
    const at = pool.indexOf(g);
    if (at >= 0) {
      hits += 1;
      pool.splice(at, 1);
    }
  }
  return (2 * hits) / (left.length + right.length);
}

function bestGuess(
  rawLeaf: string,
  tenant: boolean,
): { canonicalPath: string; confidence: number } | undefined {
  const leaf = norm(rawLeaf);
  let best: { canonicalPath: string; confidence: number } | undefined;
  for (const target of TARGETS) {
    if (target.tenantOnly === true && !tenant) continue;
    const score = similarity(leaf, leafOf(target.canonicalPath));
    const confidence = Math.min(MAX_GUESS_CONFIDENCE, Math.round(score * 100) / 100);
    if (score >= 0.5 && (best === undefined || confidence > best.confidence)) {
      best = { canonicalPath: target.canonicalPath, confidence };
    }
  }
  return best;
}

const KNOWN_CANONICAL = new Set(TARGETS.map((t) => t.canonicalPath));

/* -------------------------------------------------------------------------- */
/* discover                                                                   */
/* -------------------------------------------------------------------------- */

export function discover(
  _bundle: RawBundle,
  _schema: SchemaDocument | undefined,
  _spec: VectorSpec,
  _assisted?: readonly { rawPath: string; canonicalPath: string; confidence: number }[],
): FieldMap {
  const schema = _schema ?? _bundle.schema;
  const tenant = _spec.lineOfBusiness === 'tenant';
  const specSources = new Set(_spec.components.map((c) => c.source));

  const entries: FieldMapEntry[] = [];
  const unmapped: UnmappedKey[] = [];
  const seenRawPaths = new Set<string>();

  const resources = Object.keys(_bundle.records).sort((a, b) => a.localeCompare(b));
  for (const resource of resources) {
    const records = _bundle.records[resource] ?? [];
    const leafMap = new Map<string, unknown[]>();
    for (const record of records) collectLeaves(record.data, '', leafMap, 0);

    const leaves: RawLeaf[] = [...leafMap.entries()]
      .map(([path, samples]) => ({ path, samples }))
      .sort((a, b) => a.path.localeCompare(b.path));

    for (const leaf of leaves) {
      const rawPath = `${resource}.${leaf.path}`;
      if (seenRawPaths.has(rawPath)) continue;
      seenRawPaths.add(rawPath);

      const segments = leaf.path.split('.');
      const rawLeaf = (segments[segments.length - 1] ?? '').replace(/\[\]$/, '');
      if (norm(rawLeaf) === 'id') {
        unmapped.push({ rawPath, sampleValues: leaf.samples, reason: 'record identifier' });
        continue;
      }

      const resolved = resolveGroup(resource, leaf.path, schema);
      if (resolved.group === 'other' || resolved.group === 'exposure') {
        unmapped.push({
          rawPath,
          sampleValues: leaf.samples,
          reason: `no canonical group for resource "${resource}"`,
          ...(bestGuess(rawLeaf, tenant) === undefined
            ? {}
            : { bestGuess: bestGuess(rawLeaf, tenant) }),
        });
        continue;
      }

      const match = matchTarget(resolved.group, rawLeaf, tenant);
      if (match !== null && resolved.viaHq && match.canonicalPath !== HQ_CANONICAL) {
        unmapped.push({
          rawPath,
          sampleValues: leaf.samples,
          reason: `hq location field "${rawLeaf}" is not an insured attribute`,
        });
        continue;
      }
      if (match === null) {
        const guess = bestGuess(rawLeaf, tenant);
        unmapped.push({
          rawPath,
          sampleValues: leaf.samples,
          reason: `no canonical ${resolved.group} field matches "${rawLeaf}"`,
          ...(guess === undefined ? {} : { bestGuess: guess }),
        });
        continue;
      }

      const viaGraph = resolved.viaGraph;
      const confidence = Math.round((match.confidence - (viaGraph ? GRAPH_PENALTY : 0)) * 100) / 100;
      const notes: string[] = [];
      if (viaGraph && resolved.hint !== null) notes.push(`reached through "${resolved.hint}"`);
      if (specSources.has(match.canonicalPath)) notes.push('feeds a vector component');
      entries.push({
        rawPath,
        canonicalPath: match.canonicalPath,
        confidence,
        method: viaGraph ? 'graph' : match.method,
        ...(notes.length > 0 ? { note: notes.join('; ') } : {}),
      });
    }
  }

  // Gemini's schema-assist pass: only for keys the deterministic pass left
  // unmapped, only at or above MIN_MAP_CONFIDENCE, only onto known canonicals.
  const accepted: FieldMapEntry[] = [];
  const stillUnmapped: UnmappedKey[] = [];
  const assistedByPath = new Map<string, { canonicalPath: string; confidence: number }>();
  for (const a of _assisted ?? []) {
    if (!assistedByPath.has(a.rawPath)) {
      assistedByPath.set(a.rawPath, { canonicalPath: a.canonicalPath, confidence: a.confidence });
    }
  }
  for (const key of unmapped) {
    const assist = assistedByPath.get(key.rawPath);
    if (assist === undefined) {
      stillUnmapped.push(key);
      continue;
    }
    if (!KNOWN_CANONICAL.has(assist.canonicalPath)) {
      stillUnmapped.push({
        ...key,
        reason: `schema-assist proposed unknown canonical path "${assist.canonicalPath}"`,
        bestGuess: { canonicalPath: assist.canonicalPath, confidence: assist.confidence },
      });
      continue;
    }
    if (assist.confidence < MIN_MAP_CONFIDENCE) {
      stillUnmapped.push({
        ...key,
        reason: `schema-assist confidence ${assist.confidence} below ${MIN_MAP_CONFIDENCE}`,
        bestGuess: assist,
      });
      continue;
    }
    accepted.push({
      rawPath: key.rawPath,
      canonicalPath: assist.canonicalPath,
      confidence: assist.confidence,
      method: 'llm',
      note: 'schema-assist',
    });
  }

  const all = [...entries, ...accepted].sort(
    (a, b) =>
      b.confidence - a.confidence ||
      a.canonicalPath.localeCompare(b.canonicalPath) ||
      a.rawPath.localeCompare(b.rawPath),
  );
  stillUnmapped.sort((a, b) => a.rawPath.localeCompare(b.rawPath));
  return { entries: all, unmapped: stillUnmapped };
}
