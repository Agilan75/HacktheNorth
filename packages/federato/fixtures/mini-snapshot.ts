/**
 * A small hand-written Federato fixture, shaped EXACTLY like the real API
 * response, so every offline test can use it without the 3 MB snapshot.
 * Owned by W0-3, frozen after Run 0.
 *
 * Shapes are taken from `docs/federato/live-schema.json` and the measured facts
 * in `docs/contracts/LIVE_DATA_FACTS.md`:
 *   - ids are numbers, money is a plain USD number, dates are `YYYY-MM-DD`,
 *     missing is `null`;
 *   - flat records reference each other by numeric id;
 *   - hydrated rows are what the deep `Policy` query returns, with `submission`,
 *     `insured`, `claims` and `exposure_units.location.buildings` as objects;
 *   - `Policy.business_type` is `new` / `renewal`, lower case;
 *   - `construction_type` uses the eight real enum values.
 *
 * The cast, by design:
 *   SUB-1001 / policy 9001  FIT-shaped: new, property, CA, TIV $65M,
 *                           premium $88K, every building post-2010, loss $32K.
 *   SUB-1002 / policy 9002  pre-1990 building (1978) at 40% of TIV — the REFER
 *                           path, not the >50% knockout.
 *   SUB-1003 / policy 9003  cyber: knocked out on line of business at triage.
 *   SUB-1004                property submission with NO policy (status `lost`),
 *                           reachable only through `insured -> hq`.
 *   SUB-1005 / policy 9005  renewal, TX, wood frame majority, premium $240K —
 *                           knocked out on four factors at once.
 */
import type {
  FederatoRecord,
  FederatoResource,
  FederatoSnapshot,
} from '../src/types';
import type { SchemaDocument } from '@retrofit/engine';

export const MINI_FETCHED_AT = '2026-09-19T00:00:00.000Z';

/* -------------------------------------------------------------------------- */
/* Flat records — exactly as `{ resource, total, results }` returns them       */
/* -------------------------------------------------------------------------- */

export const MINI_BROKERS: readonly FederatoRecord[] = [
  {
    id: 601,
    name: 'Harbor Point Brokerage',
    tier: 'preferred',
    region: 'West',
    commission_pct: 12.5,
    license_number: 'BR-601-CA',
  },
  {
    id: 602,
    name: 'Lakeside Risk Partners',
    tier: 'standard',
    region: 'Southeast',
    commission_pct: 10,
    license_number: 'BR-602-FL',
  },
];

export const MINI_CONTACTS: readonly FederatoRecord[] = [
  {
    id: 701,
    name: 'Dana Reyes',
    email: 'dana.reyes@harborpoint.example',
    phone: '+1-415-555-0142',
    title: 'Account Executive',
    broker: 601,
  },
  {
    id: 702,
    name: 'Marcus Hale',
    email: 'marcus.hale@lakesiderisk.example',
    phone: '+1-305-555-0188',
    title: null,
    broker: 602,
  },
];

export const MINI_UNDERWRITERS: readonly FederatoRecord[] = [
  {
    id: 801,
    name: 'Priya Natarajan',
    team: 'Property West',
    email: 'priya.natarajan@carrier.example',
    region: 'West',
    authority_limit: 100000000,
  },
  {
    id: 802,
    name: 'Tom Okafor',
    team: 'Property Southeast',
    email: 'tom.okafor@carrier.example',
    region: 'Southeast',
    authority_limit: 50000000,
  },
  {
    id: 803,
    name: 'Elena Brandt',
    team: 'Property Central',
    email: 'elena.brandt@carrier.example',
    region: 'Central',
    authority_limit: 25000000,
  },
];

export const MINI_LOCATIONS: readonly FederatoRecord[] = [
  {
    id: 401,
    zip: '94107',
    city: 'San Francisco',
    name: 'Mission Bay Campus',
    state: 'CA',
    county: 'San Francisco',
    address: '1200 Fourth Street',
    country: 'US',
    latitude: 37.7706,
    longitude: -122.3921,
    buildings: [501, 502],
    occupancy: 'Office',
    hazard_tags: ['earthquake', 'flood'],
    protection_class: 2,
  },
  {
    id: 402,
    zip: '33131',
    city: 'Miami',
    name: 'Brickell Distribution',
    state: 'FL',
    county: 'Miami-Dade',
    address: '800 Brickell Avenue',
    country: 'US',
    latitude: 25.7657,
    longitude: -80.1936,
    buildings: [503, 504],
    occupancy: 'Warehouse',
    hazard_tags: ['hurricane', 'flood'],
    protection_class: 4,
  },
  {
    id: 403,
    zip: '78701',
    city: 'Austin',
    name: 'Congress Avenue Works',
    state: 'TX',
    county: 'Travis',
    address: '400 Congress Avenue',
    country: 'US',
    latitude: 30.2672,
    longitude: -97.7431,
    buildings: [505],
    occupancy: 'Manufacturing',
    hazard_tags: ['hail', 'tornado'],
    protection_class: 7,
  },
  {
    id: 404,
    zip: '94105',
    city: 'San Francisco',
    name: 'Atlas Freight HQ',
    state: 'CA',
    county: 'San Francisco',
    address: '55 Beale Street',
    country: 'US',
    latitude: 37.7912,
    longitude: -122.3966,
    buildings: [],
    occupancy: 'Office',
    hazard_tags: ['earthquake'],
    protection_class: 3,
  },
  {
    id: 405,
    zip: '30303',
    city: 'Atlanta',
    name: 'Peachtree Data Center',
    state: 'GA',
    county: 'Fulton',
    address: '101 Peachtree Street',
    country: 'US',
    latitude: 33.7537,
    longitude: -84.3863,
    buildings: [],
    occupancy: 'Data Center',
    hazard_tags: ['tornado'],
    protection_class: 3,
  },
];

export const MINI_BUILDINGS: readonly FederatoRecord[] = [
  {
    id: 501,
    tiv: 40000000,
    name: 'Building A',
    stories: 6,
    occupancy: 'Office',
    roof_year: 2018,
    year_built: 2015,
    sprinklered: true,
    building_value: 31000000,
    contents_value: 8000000,
    square_footage: 180000,
    construction_type: 'Non-Combustible',
    business_interruption_value: 1000000,
  },
  {
    id: 502,
    tiv: 25000000,
    name: 'Building B',
    stories: 4,
    occupancy: 'Office',
    roof_year: 2016,
    year_built: 2012,
    sprinklered: true,
    building_value: 20000000,
    contents_value: 5000000,
    square_footage: 110000,
    construction_type: 'Steel Frame',
    business_interruption_value: null,
  },
  {
    id: 503,
    tiv: 20000000,
    name: 'Building C',
    stories: 2,
    occupancy: 'Warehouse',
    roof_year: 2009,
    year_built: 1978,
    sprinklered: false,
    building_value: 16000000,
    contents_value: 4000000,
    square_footage: 240000,
    construction_type: 'Joisted Masonry',
    business_interruption_value: null,
  },
  {
    id: 504,
    tiv: 30000000,
    name: 'Building D',
    stories: 1,
    occupancy: 'Warehouse',
    roof_year: 2019,
    year_built: 2005,
    sprinklered: true,
    building_value: 24000000,
    contents_value: 6000000,
    square_footage: 310000,
    construction_type: 'Masonry Non-Combustible',
    business_interruption_value: 2000000,
  },
  {
    id: 505,
    tiv: 18000000,
    name: 'Building E',
    stories: 3,
    occupancy: 'Manufacturing',
    roof_year: null,
    year_built: 1968,
    sprinklered: false,
    building_value: 14000000,
    contents_value: 4000000,
    square_footage: 150000,
    construction_type: 'Wood Frame',
    business_interruption_value: null,
  },
];

export const MINI_INSUREDS: readonly FederatoRecord[] = [
  {
    id: 301,
    hq: 401,
    dba: null,
    fein: '94-1122334',
    name: 'Northgate Biotech Holdings',
    parent: null,
    website: 'https://northgate.example',
    sic_code: '8731',
    naics_code: '541714',
    entity_type: 'Corporation',
    year_founded: 2004,
    annual_revenue: 240000000,
    employee_count: 610,
  },
  {
    id: 302,
    hq: 402,
    dba: 'Brickell Cold Chain',
    fein: '65-9988776',
    name: 'Brickell Logistics Group',
    parent: null,
    website: 'https://brickell-logistics.example',
    sic_code: '4225',
    naics_code: '493110',
    entity_type: 'LLC',
    year_founded: 1989,
    annual_revenue: 118000000,
    employee_count: 340,
  },
  {
    id: 303,
    hq: 405,
    dba: null,
    fein: '58-4433221',
    name: 'Peachtree Data Services',
    parent: null,
    website: 'https://peachtreedata.example',
    sic_code: '7374',
    naics_code: '518210',
    entity_type: 'Corporation',
    year_founded: 2016,
    annual_revenue: 42000000,
    employee_count: 95,
  },
  {
    id: 304,
    hq: 404,
    dba: null,
    fein: '94-5566778',
    name: 'Atlas Freight Systems',
    parent: null,
    website: null,
    sic_code: '4213',
    naics_code: '484121',
    entity_type: 'Corporation',
    year_founded: 1998,
    annual_revenue: 76000000,
    employee_count: 210,
  },
  {
    id: 305,
    hq: 403,
    dba: null,
    fein: '74-1029384',
    name: 'Congress Avenue Manufacturing',
    parent: null,
    website: null,
    sic_code: '3089',
    naics_code: '326199',
    entity_type: 'LLC',
    year_founded: 1971,
    annual_revenue: 54000000,
    employee_count: 180,
  },
];

export const MINI_EXPOSURE_UNITS: readonly FederatoRecord[] = [
  {
    id: 201,
    kind: 'location',
    name: 'Mission Bay Campus',
    basis: 'tiv',
    location: 401,
    basis_amount: 65000000,
  },
  {
    id: 202,
    kind: 'location',
    name: 'Brickell Distribution',
    basis: 'tiv',
    location: 402,
    basis_amount: 50000000,
  },
  {
    id: 203,
    kind: 'digital_asset',
    name: 'Peachtree primary estate',
    basis: 'records',
    location: 405,
    basis_amount: 1800000,
    digital_asset: {
      hosting: 'cloud',
      controls: {
        edr: true,
        mfa: true,
        siem: false,
        training: true,
        offline_backups: true,
        pen_test_annual: false,
      },
      pci_records: 250000,
      phi_records: 0,
      pii_records: 1550000,
    },
  },
  {
    id: 204,
    kind: 'location',
    name: 'Congress Avenue Works',
    basis: 'tiv',
    location: 403,
    basis_amount: 18000000,
  },
];

export const MINI_COVERAGES: readonly FederatoRecord[] = [
  {
    id: 101,
    code: 'PROP-BLDG',
    name: 'Building',
    basis: 'replacement_cost',
    sublimit: null,
    retention: null,
    deductible: 100000,
    limit_aggregate: 65000000,
    limit_occurrence: 65000000,
    waiting_period_hours: null,
  },
  {
    id: 102,
    code: 'PROP-BI',
    name: 'Business Interruption',
    basis: 'actual_loss_sustained',
    sublimit: 3000000,
    retention: null,
    deductible: 50000,
    limit_aggregate: 3000000,
    limit_occurrence: 3000000,
    waiting_period_hours: 72,
  },
];

export const MINI_CLAIMS: readonly FederatoRecord[] = [
  {
    id: 1101,
    policy: 9001,
    status: 'closed',
    claimant: 'Northgate Biotech Holdings',
    coverage: 101,
    litigated: false,
    closed_date: '2024-02-19',
    claim_number: 'CLM-1101',
    date_of_loss: '2023-11-04',
    paid_expense: 4000,
    cause_of_loss: 'water_damage',
    exposure_unit: 201,
    reported_date: '2023-11-06',
    paid_indemnity: 28000,
    reserve_expense: 0,
    reserve_indemnity: 0,
  },
  {
    id: 1102,
    policy: 9002,
    status: 'closed',
    claimant: 'Brickell Logistics Group',
    coverage: 101,
    litigated: false,
    closed_date: '2023-08-30',
    claim_number: 'CLM-1102',
    date_of_loss: '2023-05-12',
    paid_expense: 5000,
    cause_of_loss: 'wind',
    exposure_unit: 202,
    reported_date: '2023-05-14',
    paid_indemnity: 40000,
    reserve_expense: 0,
    reserve_indemnity: 0,
  },
  {
    id: 1103,
    policy: 9005,
    status: 'open',
    claimant: 'Congress Avenue Manufacturing',
    coverage: 101,
    litigated: true,
    closed_date: null,
    claim_number: 'CLM-1103',
    date_of_loss: '2025-03-22',
    paid_expense: 18000,
    cause_of_loss: 'fire',
    exposure_unit: 204,
    reported_date: '2025-03-23',
    paid_indemnity: 120000,
    reserve_expense: 12000,
    reserve_indemnity: 90000,
  },
];

export const MINI_ENDORSEMENTS: readonly FederatoRecord[] = [
  {
    id: 1201,
    type: 'sprinkler_warranty',
    title: 'Protective Safeguards',
    form_number: 'IL 04 15',
    edition_date: '2019-09-01',
    effective_date: '2026-01-01',
    premium_change: 0,
  },
];

/** Triage shape: what the cheap `Submission` pass selects, plus the rest. */
export const MINI_SUBMISSIONS: readonly FederatoRecord[] = [
  {
    id: 1001,
    broker: 601,
    status: 'bound',
    contact: 701,
    insured: 301,
    competitor: null,
    underwriter: 801,
    received_date: '2025-11-03',
    decline_reason: null,
    requested_limit: 65000000,
    line_of_business: 'property',
    submission_number: 'SUB-1001',
    target_effective_date: '2026-01-01',
  },
  {
    id: 1002,
    broker: 602,
    status: 'bound',
    contact: 702,
    insured: 302,
    competitor: 'Meridian Mutual',
    underwriter: 802,
    received_date: '2025-10-14',
    decline_reason: null,
    requested_limit: 50000000,
    line_of_business: 'property',
    submission_number: 'SUB-1002',
    target_effective_date: '2026-01-01',
  },
  {
    id: 1003,
    broker: 601,
    status: 'bound',
    contact: 701,
    insured: 303,
    competitor: null,
    underwriter: 801,
    received_date: '2025-09-30',
    decline_reason: null,
    requested_limit: 10000000,
    line_of_business: 'cyber',
    submission_number: 'SUB-1003',
    target_effective_date: '2026-01-01',
  },
  {
    /** No policy anywhere in this fixture: reachable only via `insured -> hq`. */
    id: 1004,
    broker: 601,
    status: 'lost',
    contact: 701,
    insured: 304,
    competitor: 'Cascade Specialty',
    underwriter: 801,
    received_date: '2025-12-02',
    decline_reason: null,
    requested_limit: 30000000,
    line_of_business: 'property',
    submission_number: 'SUB-1004',
    target_effective_date: '2026-02-01',
  },
  {
    id: 1005,
    broker: 602,
    status: 'bound',
    contact: 702,
    insured: 305,
    competitor: null,
    underwriter: 803,
    received_date: '2025-08-19',
    decline_reason: null,
    requested_limit: 18000000,
    line_of_business: 'property',
    submission_number: 'SUB-1005',
    target_effective_date: '2026-01-01',
  },
];

export const MINI_POLICIES: readonly FederatoRecord[] = [
  {
    id: 9001,
    dates: {
      bound: '2025-12-10',
      quoted: '2025-11-20',
      cancelled: null,
      effective: '2026-01-01',
      expiration: '2027-01-01',
      submission_received: '2025-11-03',
    },
    limit: 65000000,
    terms: {
      prior_acts: null,
      funding_type: null,
      coverage_basis: 'occurrence',
      aggregate_limit: 65000000,
      attachment_point: null,
      retroactive_date: null,
      participation_pct: 100,
    },
    claims: [1101],
    status: 'active',
    insured: 301,
    premium: 88000,
    currency: 'USD',
    producer: { broker: 601, contact: 701 },
    coverages: [101, 102],
    deductible: 100000,
    submission: 1001,
    rate_change: 0.02,
    underwriter: 801,
    endorsements: [],
    business_type: 'new',
    policy_number: 'POL-9001',
    commission_pct: 12.5,
    exposure_units: [201],
    target_premium: 90000,
    line_of_business: 'property',
    technical_premium: 84000,
  },
  {
    id: 9002,
    dates: {
      bound: '2025-11-25',
      quoted: '2025-10-30',
      cancelled: null,
      effective: '2026-01-01',
      expiration: '2027-01-01',
      submission_received: '2025-10-14',
    },
    limit: 50000000,
    terms: {
      prior_acts: null,
      funding_type: null,
      coverage_basis: 'occurrence',
      aggregate_limit: 50000000,
      attachment_point: null,
      retroactive_date: null,
      participation_pct: 100,
    },
    claims: [1102],
    status: 'active',
    insured: 302,
    premium: 120000,
    currency: 'USD',
    producer: { broker: 602, contact: 702 },
    coverages: [101],
    deductible: 250000,
    submission: 1002,
    rate_change: 0.06,
    underwriter: 802,
    endorsements: [1201],
    business_type: 'new',
    policy_number: 'POL-9002',
    commission_pct: 10,
    exposure_units: [202],
    target_premium: 115000,
    line_of_business: 'property',
    technical_premium: 112000,
  },
  {
    id: 9003,
    dates: {
      bound: '2025-10-28',
      quoted: '2025-10-05',
      cancelled: null,
      effective: '2026-01-01',
      expiration: '2027-01-01',
      submission_received: '2025-09-30',
    },
    limit: 10000000,
    terms: {
      prior_acts: true,
      funding_type: null,
      coverage_basis: 'claims_made',
      aggregate_limit: 10000000,
      attachment_point: null,
      retroactive_date: '2022-01-01',
      participation_pct: 100,
    },
    claims: [],
    status: 'active',
    insured: 303,
    premium: 64000,
    currency: 'USD',
    producer: { broker: 601, contact: 701 },
    coverages: [],
    deductible: 50000,
    submission: 1003,
    rate_change: null,
    underwriter: 801,
    endorsements: [],
    business_type: 'new',
    policy_number: 'POL-9003',
    commission_pct: 12.5,
    exposure_units: [203],
    target_premium: null,
    line_of_business: 'cyber',
    technical_premium: 61000,
  },
  {
    id: 9005,
    dates: {
      bound: '2025-09-15',
      quoted: '2025-08-29',
      cancelled: null,
      effective: '2026-01-01',
      expiration: '2027-01-01',
      submission_received: '2025-08-19',
    },
    limit: 18000000,
    terms: {
      prior_acts: null,
      funding_type: null,
      coverage_basis: 'occurrence',
      aggregate_limit: 18000000,
      attachment_point: null,
      retroactive_date: null,
      participation_pct: 100,
    },
    claims: [1103],
    status: 'active',
    insured: 305,
    premium: 240000,
    currency: 'USD',
    producer: { broker: 602, contact: 702 },
    coverages: [101],
    deductible: 500000,
    submission: 1005,
    rate_change: 0.11,
    underwriter: 803,
    endorsements: [],
    business_type: 'renewal',
    policy_number: 'POL-9005',
    commission_pct: 10,
    exposure_units: [204],
    target_premium: 235000,
    line_of_business: 'property',
    technical_premium: 228000,
  },
];

/* -------------------------------------------------------------------------- */
/* Hydrated rows — what the deep `Policy` query actually returns               */
/* -------------------------------------------------------------------------- */

const byId = (rows: readonly FederatoRecord[], id: number): FederatoRecord => {
  const found = rows.find((r) => r['id'] === id);
  if (found === undefined) throw new Error(`mini-snapshot: no record with id ${id}`);
  return found;
};

const hydrateLocation = (locationId: number): FederatoRecord => {
  const location = byId(MINI_LOCATIONS, locationId);
  const buildingIds = (location['buildings'] as readonly number[] | undefined) ?? [];
  return { ...location, buildings: buildingIds.map((b) => byId(MINI_BUILDINGS, b)) };
};

const hydrateExposureUnit = (unitId: number): FederatoRecord => {
  const unit = byId(MINI_EXPOSURE_UNITS, unitId);
  const locationId = unit['location'] as number | null | undefined;
  return {
    ...unit,
    location: typeof locationId === 'number' ? hydrateLocation(locationId) : null,
  };
};

const hydratePolicy = (policy: FederatoRecord): FederatoRecord => ({
  ...policy,
  insured: byId(MINI_INSUREDS, policy['insured'] as number),
  submission: byId(MINI_SUBMISSIONS, policy['submission'] as number),
  claims: ((policy['claims'] as readonly number[] | undefined) ?? []).map((c) =>
    byId(MINI_CLAIMS, c),
  ),
  exposure_units: ((policy['exposure_units'] as readonly number[] | undefined) ?? []).map(
    hydrateExposureUnit,
  ),
});

/**
 * The deep pass, verbatim:
 * `{ resource: 'Policy', where: { line_of_business: 'property' },
 *    expand: { insured: true, submission: true, claims: true,
 *              exposure_units: { location: { buildings: true } } } }`
 *
 * Rooted at `Policy`, never at `Submission` — `Submission` has no premium, TIV,
 * state, construction or building field and no reverse reference to `Policy`.
 */
export const MINI_HYDRATED_POLICIES: readonly FederatoRecord[] = MINI_POLICIES.filter(
  (p) => p['line_of_business'] === 'property',
).map(hydratePolicy);

/** The no-policy follow-up: `Submission -> insured -> hq`, one row. */
export const MINI_NO_POLICY_SUBMISSIONS: readonly FederatoRecord[] = MINI_SUBMISSIONS.filter(
  (s) =>
    s['line_of_business'] === 'property' &&
    !MINI_POLICIES.some((p) => p['submission'] === s['id']),
).map((s) => {
  const insured = byId(MINI_INSUREDS, s['insured'] as number);
  return {
    ...s,
    insured: { ...insured, hq: byId(MINI_LOCATIONS, insured['hq'] as number) },
    broker: byId(MINI_BROKERS, s['broker'] as number),
  };
});

/* -------------------------------------------------------------------------- */
/* Snapshot assembly                                                          */
/* -------------------------------------------------------------------------- */

export const MINI_RECORDS: Readonly<Record<FederatoResource, readonly FederatoRecord[]>> = {
  Submission: MINI_SUBMISSIONS,
  Policy: MINI_POLICIES,
  Insured: MINI_INSUREDS,
  Location: MINI_LOCATIONS,
  Building: MINI_BUILDINGS,
  ExposureUnit: MINI_EXPOSURE_UNITS,
  Coverage: MINI_COVERAGES,
  Claim: MINI_CLAIMS,
  Endorsement: MINI_ENDORSEMENTS,
  Broker: MINI_BROKERS,
  Contact: MINI_CONTACTS,
  Underwriter: MINI_UNDERWRITERS,
};

export const MINI_COUNTS: Readonly<Record<FederatoResource, number>> = {
  Submission: MINI_SUBMISSIONS.length,
  Policy: MINI_POLICIES.length,
  Insured: MINI_INSUREDS.length,
  Location: MINI_LOCATIONS.length,
  Building: MINI_BUILDINGS.length,
  ExposureUnit: MINI_EXPOSURE_UNITS.length,
  Coverage: MINI_COVERAGES.length,
  Claim: MINI_CLAIMS.length,
  Endorsement: MINI_ENDORSEMENTS.length,
  Broker: MINI_BROKERS.length,
  Contact: MINI_CONTACTS.length,
  Underwriter: MINI_UNDERWRITERS.length,
};

/**
 * A schema document covering exactly the resources and fields this fixture
 * uses. Field types and reference targets match `live-schema.json`; it is a
 * subset, not a substitute, so F07's "every synonym path exists" test reads the
 * real file, not this one.
 */
export const MINI_SCHEMA: SchemaDocument = {
  fetchedAt: MINI_FETCHED_AT,
  resources: [
    {
      name: 'Submission',
      fields: [
        { path: 'id', type: 'number' },
        { path: 'broker', type: 'reference', reference: 'Broker' },
        { path: 'status', type: 'string' },
        { path: 'contact', type: 'reference', reference: 'Contact' },
        { path: 'insured', type: 'reference', reference: 'Insured' },
        { path: 'competitor', type: 'string', nullable: true },
        { path: 'underwriter', type: 'reference', reference: 'Underwriter' },
        { path: 'received_date', type: 'string' },
        { path: 'decline_reason', type: 'string', nullable: true },
        { path: 'requested_limit', type: 'number' },
        { path: 'line_of_business', type: 'string' },
        { path: 'submission_number', type: 'string' },
        { path: 'target_effective_date', type: 'string' },
      ],
    },
    {
      name: 'Policy',
      fields: [
        { path: 'id', type: 'number' },
        { path: 'dates.effective', type: 'string' },
        { path: 'dates.expiration', type: 'string' },
        { path: 'dates.submission_received', type: 'string', nullable: true },
        { path: 'limit', type: 'number' },
        { path: 'claims', type: 'reference', reference: 'Claim', isArray: true },
        { path: 'status', type: 'string' },
        { path: 'insured', type: 'reference', reference: 'Insured' },
        { path: 'premium', type: 'number' },
        { path: 'currency', type: 'string' },
        { path: 'producer.broker', type: 'reference', reference: 'Broker' },
        { path: 'producer.contact', type: 'reference', reference: 'Contact' },
        { path: 'coverages', type: 'reference', reference: 'Coverage', isArray: true },
        { path: 'deductible', type: 'number' },
        { path: 'submission', type: 'reference', reference: 'Submission' },
        { path: 'underwriter', type: 'reference', reference: 'Underwriter' },
        {
          path: 'endorsements',
          type: 'reference',
          reference: 'Endorsement',
          isArray: true,
        },
        { path: 'business_type', type: 'string' },
        { path: 'policy_number', type: 'string' },
        {
          path: 'exposure_units',
          type: 'reference',
          reference: 'ExposureUnit',
          isArray: true,
        },
        { path: 'target_premium', type: 'number', nullable: true },
        { path: 'line_of_business', type: 'string' },
        { path: 'technical_premium', type: 'number', nullable: true },
      ],
    },
    {
      name: 'Insured',
      fields: [
        { path: 'id', type: 'number' },
        { path: 'hq', type: 'reference', reference: 'Location' },
        { path: 'name', type: 'string' },
        { path: 'naics_code', type: 'string' },
        { path: 'entity_type', type: 'string' },
        { path: 'year_founded', type: 'number' },
        { path: 'annual_revenue', type: 'number' },
        { path: 'employee_count', type: 'number' },
      ],
    },
    {
      name: 'Location',
      fields: [
        { path: 'id', type: 'number' },
        { path: 'zip', type: 'string' },
        { path: 'city', type: 'string' },
        { path: 'name', type: 'string' },
        { path: 'state', type: 'string' },
        { path: 'address', type: 'string' },
        { path: 'country', type: 'string' },
        { path: 'latitude', type: 'number', nullable: true },
        { path: 'longitude', type: 'number', nullable: true },
        { path: 'buildings', type: 'reference', reference: 'Building', isArray: true },
        { path: 'occupancy', type: 'string', nullable: true },
        { path: 'hazard_tags', type: 'array' },
        { path: 'protection_class', type: 'number', nullable: true },
      ],
    },
    {
      name: 'Building',
      fields: [
        { path: 'id', type: 'number' },
        { path: 'tiv', type: 'number' },
        { path: 'name', type: 'string' },
        { path: 'stories', type: 'number', nullable: true },
        { path: 'occupancy', type: 'string', nullable: true },
        { path: 'roof_year', type: 'number', nullable: true },
        { path: 'year_built', type: 'number' },
        { path: 'sprinklered', type: 'boolean' },
        { path: 'building_value', type: 'number' },
        { path: 'contents_value', type: 'number' },
        { path: 'square_footage', type: 'number' },
        { path: 'construction_type', type: 'string' },
      ],
    },
    {
      name: 'ExposureUnit',
      fields: [
        { path: 'id', type: 'number' },
        { path: 'kind', type: 'string' },
        { path: 'name', type: 'string' },
        { path: 'basis', type: 'string' },
        { path: 'location', type: 'reference', reference: 'Location' },
        { path: 'basis_amount', type: 'number' },
      ],
    },
    {
      name: 'Coverage',
      fields: [
        { path: 'id', type: 'number' },
        { path: 'code', type: 'string' },
        { path: 'name', type: 'string' },
        { path: 'basis', type: 'string' },
        { path: 'deductible', type: 'number', nullable: true },
        { path: 'limit_aggregate', type: 'number', nullable: true },
        { path: 'limit_occurrence', type: 'number', nullable: true },
      ],
    },
    {
      name: 'Claim',
      fields: [
        { path: 'id', type: 'number' },
        { path: 'policy', type: 'reference', reference: 'Policy' },
        { path: 'status', type: 'string' },
        { path: 'coverage', type: 'reference', reference: 'Coverage' },
        { path: 'litigated', type: 'boolean' },
        { path: 'closed_date', type: 'string', nullable: true },
        { path: 'claim_number', type: 'string' },
        { path: 'date_of_loss', type: 'string' },
        { path: 'paid_expense', type: 'number' },
        { path: 'cause_of_loss', type: 'string' },
        { path: 'exposure_unit', type: 'reference', reference: 'ExposureUnit' },
        { path: 'reported_date', type: 'string' },
        { path: 'paid_indemnity', type: 'number' },
        { path: 'reserve_expense', type: 'number' },
        { path: 'reserve_indemnity', type: 'number' },
      ],
    },
    {
      name: 'Endorsement',
      fields: [
        { path: 'id', type: 'number' },
        { path: 'type', type: 'string' },
        { path: 'title', type: 'string' },
        { path: 'form_number', type: 'string' },
        { path: 'edition_date', type: 'string' },
        { path: 'effective_date', type: 'string' },
        { path: 'premium_change', type: 'number' },
      ],
    },
    {
      name: 'Broker',
      fields: [
        { path: 'id', type: 'number' },
        { path: 'name', type: 'string' },
        { path: 'tier', type: 'string' },
        { path: 'region', type: 'string' },
        { path: 'commission_pct', type: 'number' },
        { path: 'license_number', type: 'string' },
      ],
    },
    {
      name: 'Contact',
      fields: [
        { path: 'id', type: 'number' },
        { path: 'name', type: 'string' },
        { path: 'email', type: 'string' },
        { path: 'phone', type: 'string' },
        { path: 'title', type: 'string', nullable: true },
        { path: 'broker', type: 'reference', reference: 'Broker' },
      ],
    },
    {
      name: 'Underwriter',
      fields: [
        { path: 'id', type: 'number' },
        { path: 'name', type: 'string' },
        { path: 'team', type: 'string' },
        { path: 'email', type: 'string' },
        { path: 'region', type: 'string' },
        { path: 'authority_limit', type: 'number' },
      ],
    },
  ],
};

/** Drop-in replacement for the real snapshot in any offline test. */
export const MINI_SNAPSHOT: FederatoSnapshot = {
  fetchedAt: MINI_FETCHED_AT,
  schema: MINI_SCHEMA,
  records: MINI_RECORDS,
  counts: MINI_COUNTS,
};

/**
 * What each account is here to exercise. Tests assert against these names
 * rather than re-deriving the intent from the numbers.
 */
export const MINI_EXPECTATIONS = {
  'SUB-1001': 'fit_shaped',
  'SUB-1002': 'refer_pre_1990_building',
  'SUB-1003': 'knocked_out_line_of_business',
  'SUB-1004': 'no_policy_refer_missing_data',
  'SUB-1005': 'knocked_out_multiple_factors',
} as const;

export type MiniExternalId = keyof typeof MINI_EXPECTATIONS;
