/**
 * The synonym table — the ONLY place Federato field names appear in Retrofit.
 * Every `schemaPath` must exist in `docs/federato/live-schema.json` (F07 tests
 * exactly that). Body owned by Run 1 unit F07.
 *
 * Conventions (docs/decisions/F07.md):
 * - `canonicalPath` uses the engine's discover-stage spelling: collections are
 *   written `buildings[].tiv`, `locations[].state`, `history[].paidIndemnity`,
 *   `coverage.lines[].limit`.
 * - `resource` is the resource that OWNS the leaf. The planner's graph search
 *   supplies the reference hops from its root resource to `resource`.
 * - `schemaPath` is relative to `resource`. It is normally a plain leaf or a
 *   nested-object path (`dates.effective`). It crosses a reference only where
 *   the owning resource alone would be ambiguous (`Insured` → `hq.state`, so the
 *   headquarters state never collides with the risk locations' state).
 * - One canonical path may have several rows (e.g. a field on both `Policy` and
 *   `Submission`). Rows are ordered by preference; `lookupSynonym` returns the
 *   highest confidence and, on a tie, the earliest row.
 * - Rollup paths (`rollup.*`) and hazards are derived or swept, never Federato
 *   fields, so they have no row here.
 */
import type { FederatoResource, SynonymEntry } from '../types';

const TABLE: readonly SynonymEntry[] = Object.freeze([
  // --- submission identity (triage pass is Submission-rooted) -------------
  { canonicalPath: 'externalId', resource: 'Submission', schemaPath: 'submission_number', confidence: 1 },
  { canonicalPath: 'lineOfBusiness', resource: 'Submission', schemaPath: 'line_of_business', confidence: 1 },
  { canonicalPath: 'lineOfBusiness', resource: 'Policy', schemaPath: 'line_of_business', confidence: 1 },
  { canonicalPath: 'status', resource: 'Submission', schemaPath: 'status', confidence: 1 },
  {
    canonicalPath: 'status',
    resource: 'Policy',
    schemaPath: 'status',
    confidence: 0.85,
    note: 'Policy status is the policy lifecycle (active, expired, non_renewed, cancelled), not the submission status.',
  },
  { canonicalPath: 'receivedDate', resource: 'Submission', schemaPath: 'received_date', confidence: 1 },
  { canonicalPath: 'receivedDate', resource: 'Policy', schemaPath: 'dates.submission_received', confidence: 0.95 },
  { canonicalPath: 'exposure.requestedLimit', resource: 'Submission', schemaPath: 'requested_limit', confidence: 1 },
  {
    canonicalPath: 'exposure.requestedLimit',
    resource: 'Policy',
    schemaPath: 'limit',
    confidence: 0.9,
    note: 'The bound policy limit, used when the submission row is not hydrated.',
  },

  // --- policy (deep pass is Policy-rooted) --------------------------------
  { canonicalPath: 'effectiveDate', resource: 'Policy', schemaPath: 'dates.effective', confidence: 1 },
  {
    canonicalPath: 'effectiveDate',
    resource: 'Submission',
    schemaPath: 'target_effective_date',
    confidence: 0.9,
    note: 'Requested effective date; the policy date wins when both exist.',
  },
  { canonicalPath: 'expirationDate', resource: 'Policy', schemaPath: 'dates.expiration', confidence: 1 },
  {
    canonicalPath: 'submissionType',
    resource: 'Policy',
    schemaPath: 'business_type',
    confidence: 1,
    note: "Values are lowercase 'new' / 'renewal' (LIVE_DATA_FACTS.md).",
  },
  { canonicalPath: 'pricing.quotedPremium', resource: 'Policy', schemaPath: 'premium', confidence: 1 },
  { canonicalPath: 'pricing.technicalPremium', resource: 'Policy', schemaPath: 'technical_premium', confidence: 1 },
  { canonicalPath: 'pricing.targetPremium', resource: 'Policy', schemaPath: 'target_premium', confidence: 1 },

  // --- insured ------------------------------------------------------------
  { canonicalPath: 'insured.name', resource: 'Insured', schemaPath: 'name', confidence: 1 },
  { canonicalPath: 'insured.industry', resource: 'Insured', schemaPath: 'naics_code', confidence: 0.9 },
  { canonicalPath: 'insured.industry', resource: 'Insured', schemaPath: 'sic_code', confidence: 0.85 },
  { canonicalPath: 'insured.revenue', resource: 'Insured', schemaPath: 'annual_revenue', confidence: 1 },
  { canonicalPath: 'insured.employeeCount', resource: 'Insured', schemaPath: 'employee_count', confidence: 1 },
  {
    canonicalPath: 'insured.headquartersState',
    resource: 'Insured',
    schemaPath: 'hq.state',
    confidence: 0.95,
    note: 'Crosses the one-to-one `hq` reference to Location.',
  },
  { canonicalPath: 'insured.brokerName', resource: 'Broker', schemaPath: 'name', confidence: 1 },
  { canonicalPath: 'insured.contactName', resource: 'Contact', schemaPath: 'name', confidence: 1 },
  { canonicalPath: 'insured.contactEmail', resource: 'Contact', schemaPath: 'email', confidence: 1 },

  // --- locations ----------------------------------------------------------
  { canonicalPath: 'locations[].state', resource: 'Location', schemaPath: 'state', confidence: 1 },
  { canonicalPath: 'locations[].city', resource: 'Location', schemaPath: 'city', confidence: 1 },
  { canonicalPath: 'locations[].postalCode', resource: 'Location', schemaPath: 'zip', confidence: 1 },
  { canonicalPath: 'locations[].latitude', resource: 'Location', schemaPath: 'latitude', confidence: 1 },
  { canonicalPath: 'locations[].longitude', resource: 'Location', schemaPath: 'longitude', confidence: 1 },
  { canonicalPath: 'locations[].protectionClass', resource: 'Location', schemaPath: 'protection_class', confidence: 1 },
  {
    canonicalPath: 'locations[].hazardTags',
    resource: 'Location',
    schemaPath: 'hazard_tags',
    confidence: 1,
    note: 'Catastrophe perils, not room hazards.',
  },

  // --- buildings ----------------------------------------------------------
  { canonicalPath: 'buildings[].tiv', resource: 'Building', schemaPath: 'tiv', confidence: 1 },
  { canonicalPath: 'buildings[].yearBuilt', resource: 'Building', schemaPath: 'year_built', confidence: 1 },
  { canonicalPath: 'buildings[].constructionType', resource: 'Building', schemaPath: 'construction_type', confidence: 1 },
  { canonicalPath: 'buildings[].sprinklered', resource: 'Building', schemaPath: 'sprinklered', confidence: 1 },
  { canonicalPath: 'buildings[].stories', resource: 'Building', schemaPath: 'stories', confidence: 1 },
  { canonicalPath: 'buildings[].roofYear', resource: 'Building', schemaPath: 'roof_year', confidence: 1 },
  { canonicalPath: 'buildings[].occupancy', resource: 'Building', schemaPath: 'occupancy', confidence: 1 },
  { canonicalPath: 'buildings[].label', resource: 'Building', schemaPath: 'name', confidence: 0.9 },

  // --- loss history -------------------------------------------------------
  { canonicalPath: 'history[].dateOfLoss', resource: 'Claim', schemaPath: 'date_of_loss', confidence: 1 },
  { canonicalPath: 'history[].causeOfLoss', resource: 'Claim', schemaPath: 'cause_of_loss', confidence: 1 },
  { canonicalPath: 'history[].paidIndemnity', resource: 'Claim', schemaPath: 'paid_indemnity', confidence: 1 },
  { canonicalPath: 'history[].paidExpense', resource: 'Claim', schemaPath: 'paid_expense', confidence: 1 },
  {
    canonicalPath: 'history[].reserves',
    resource: 'Claim',
    schemaPath: 'reserve_indemnity',
    confidence: 0.9,
    note: 'Open reserves = reserve_indemnity + reserve_expense; read both rows.',
  },
  {
    canonicalPath: 'history[].reserves',
    resource: 'Claim',
    schemaPath: 'reserve_expense',
    confidence: 0.9,
    note: 'Open reserves = reserve_indemnity + reserve_expense; read both rows.',
  },

  // --- coverage -----------------------------------------------------------
  { canonicalPath: 'coverage.lines[].code', resource: 'Coverage', schemaPath: 'code', confidence: 1 },
  {
    canonicalPath: 'coverage.lines[].limit',
    resource: 'Coverage',
    schemaPath: 'limit_occurrence',
    confidence: 0.9,
    note: 'Per-occurrence limit; limit_aggregate is the aggregate.',
  },
  { canonicalPath: 'coverage.lines[].deductible', resource: 'Coverage', schemaPath: 'deductible', confidence: 1 },
] satisfies SynonymEntry[]);

/** Collections whose canonical paths carry an element marker. */
const COLLECTIONS: readonly string[] = ['coverage.lines', 'buildings', 'locations', 'history'];

export function synonymTable(): readonly SynonymEntry[] {
  return TABLE;
}

/** Exact or normalized match on a canonical path. Null when unknown. */
export function lookupSynonym(canonicalPath: string): SynonymEntry | null {
  if (typeof canonicalPath !== 'string') return null;
  const exact = best(TABLE.filter((e) => e.canonicalPath === canonicalPath));
  if (exact !== null) return exact;
  const key = normalizeCanonical(canonicalPath);
  if (key === '') return null;
  return best(TABLE.filter((e) => normalizeCanonical(e.canonicalPath) === key));
}

/** Reverse direction: which canonical path a raw schema path maps to. */
export function reverseSynonym(
  resource: FederatoResource,
  schemaPath: string,
): SynonymEntry | null {
  if (typeof schemaPath !== 'string') return null;
  const key = normalizeSchemaPath(schemaPath);
  if (key === '') return null;
  return best(
    TABLE.filter((e) => e.resource === resource && normalizeSchemaPath(e.schemaPath) === key),
  );
}

/* -------------------------------------------------------------------------- */
/* Private                                                                    */
/* -------------------------------------------------------------------------- */

/** Highest confidence; ties keep table order. */
function best(rows: readonly SynonymEntry[]): SynonymEntry | null {
  let winner: SynonymEntry | null = null;
  for (const row of rows) {
    if (winner === null || row.confidence > winner.confidence) winner = row;
  }
  return winner;
}

/**
 * Case-, whitespace- and index-insensitive canonical key. Accepts every element
 * spelling the engine uses: `buildings[0].tiv`, `buildings[].tiv`,
 * `buildings.B1.tiv` (merge-style id key) and `buildings.tiv`.
 */
function normalizeCanonical(path: string): string {
  let p = path.trim().replace(/\s+/g, '').replace(/\[[^\]]*\]/g, '[]');
  for (const collection of COLLECTIONS) {
    if (p === collection || !p.startsWith(`${collection}`)) continue;
    const rest = p.slice(collection.length);
    if (rest.startsWith('[].')) break;
    if (!rest.startsWith('.')) continue;
    const segments = rest.slice(1).split('.').filter((s) => s !== '');
    if (segments.length === 0) break;
    // `buildings.B1.tiv` → drop the id segment; `buildings.tiv` → implicit element.
    const leaf = segments.length >= 2 ? segments.slice(1) : segments;
    p = `${collection}[].${leaf.join('.')}`;
    break;
  }
  return p.toLowerCase();
}

/** Case- and separator-insensitive schema path key (`dates.effective`, `Year_Built`). */
function normalizeSchemaPath(path: string): string {
  return path
    .trim()
    .replace(/\[[^\]]*\]/g, '')
    .split('.')
    .filter((s) => s !== '')
    .map((s) => s.toLowerCase())
    .join('.');
}
