import { describe, expect, it } from 'vitest';
import { discover } from './discover.js';
import type { FieldMapEntry, RawBundle, SchemaDocument, VectorSpec } from '../types.js';

/**
 * Records shaped exactly like `packages/federato/fixtures/mini-snapshot.ts`
 * (SUB-1001 / policy 9001). Copied, not imported: the engine never depends on
 * another package, and this file must stay pure.
 */
const record = (resource: string, data: Record<string, unknown>) => ({
  resource,
  id: data['id'] as number,
  data,
});

const COMMERCIAL_SPEC: VectorSpec = {
  lineOfBusiness: 'commercial_property',
  version: 'test',
  components: [
    {
      index: 0,
      key: 'quotedPremium',
      label: 'Quoted premium',
      source: 'pricing.quotedPremium',
      type: 'currency',
      scaling: { rule: 'log_minmax' },
      direction: 'band',
      appetiteFactor: true,
      factor: 'total_premium',
      extensionOnly: false,
      immovable: false,
      required: true,
    },
  ],
};

export const FLAT_BUNDLE: RawBundle = {
  externalId: 'SUB-1001',
  lineOfBusiness: 'commercial_property',
  fetchedAt: '2026-09-19T00:00:00.000Z',
  records: {
    Submission: [
      record('Submission', {
        id: 1001,
        broker: 601,
        status: 'bound',
        contact: 701,
        insured: 301,
        received_date: '2025-11-03',
        requested_limit: 65000000,
        line_of_business: 'property',
        submission_number: 'SUB-1001',
        target_effective_date: '2026-01-01',
      }),
    ],
    Policy: [
      record('Policy', {
        id: 9001,
        dates: {
          effective: '2026-01-01',
          expiration: '2027-01-01',
          submission_received: '2025-11-03',
        },
        limit: 65000000,
        status: 'active',
        insured: 301,
        premium: 88000,
        deductible: 100000,
        submission: 1001,
        business_type: 'new',
        target_premium: 90000,
        line_of_business: 'property',
        technical_premium: 84000,
      }),
    ],
    Insured: [
      record('Insured', {
        id: 301,
        hq: 401,
        name: 'Northgate Biotech Holdings',
        naics_code: '541714',
        annual_revenue: 240000000,
        employee_count: 610,
      }),
    ],
    Location: [
      record('Location', {
        id: 401,
        zip: '94107',
        city: 'San Francisco',
        state: 'CA',
        latitude: 37.7706,
        longitude: -122.3921,
        buildings: [501, 502],
        hazard_tags: ['earthquake', 'flood'],
        protection_class: 2,
      }),
    ],
    Building: [
      record('Building', {
        id: 501,
        tiv: 40000000,
        name: 'Building A',
        stories: 6,
        roof_year: 2018,
        year_built: 2015,
        sprinklered: true,
        square_footage: 180000,
        construction_type: 'Non-Combustible',
      }),
      record('Building', {
        id: 502,
        tiv: 25000000,
        name: 'Building B',
        stories: 4,
        roof_year: 2016,
        year_built: 2012,
        sprinklered: true,
        square_footage: 110000,
        construction_type: 'Steel Frame',
      }),
    ],
    Claim: [
      record('Claim', {
        id: 1101,
        policy: 9001,
        status: 'closed',
        date_of_loss: '2023-11-04',
        paid_expense: 4000,
        cause_of_loss: 'water_damage',
        paid_indemnity: 28000,
        reserve_expense: 0,
        reserve_indemnity: 0,
      }),
    ],
    Coverage: [
      record('Coverage', {
        id: 101,
        code: 'PROP-BLDG',
        name: 'Building',
        retention: null,
        deductible: 100000,
        limit_aggregate: 65000000,
        limit_occurrence: 65000000,
      }),
    ],
    Broker: [record('Broker', { id: 601, name: 'Harbor Point Brokerage', region: 'West' })],
    Contact: [
      record('Contact', { id: 701, name: 'Dana Reyes', email: 'dana.reyes@harborpoint.example' }),
    ],
  },
};

export const HQ_SCHEMA: SchemaDocument = {
  resources: [
    {
      name: 'Insured',
      fields: [
        { path: 'id', type: 'number' },
        { path: 'hq', type: 'reference', reference: 'Location' },
        { path: 'name', type: 'string' },
      ],
    },
  ],
};

/** SUB-1004: no policy, reachable only through `insured -> hq`. */
export const NO_POLICY_BUNDLE: RawBundle = {
  externalId: 'SUB-1004',
  lineOfBusiness: 'commercial_property',
  fetchedAt: '2026-09-19T00:00:00.000Z',
  records: {
    Submission: [
      record('Submission', {
        id: 1004,
        status: 'lost',
        received_date: '2025-12-02',
        requested_limit: 30000000,
        line_of_business: 'property',
        submission_number: 'SUB-1004',
        target_effective_date: '2026-02-01',
        insured: {
          id: 304,
          name: 'Atlas Freight Systems',
          annual_revenue: 76000000,
          hq: { id: 404, state: 'CA', city: 'San Francisco', zip: '94105', buildings: [] },
        },
      }),
    ],
  },
};

const entryFor = (entries: readonly FieldMapEntry[], rawPath: string): FieldMapEntry => {
  const found = entries.find((e) => e.rawPath === rawPath);
  if (found === undefined) throw new Error(`no field-map entry for ${rawPath}`);
  return found;
};

describe('discover', () => {
  const map = discover(FLAT_BUNDLE, undefined, COMMERCIAL_SPEC);

  it('maps names that match after normalization exactly, at confidence 1', () => {
    for (const [rawPath, canonicalPath] of [
      ['Building.year_built', 'buildings[].yearBuilt'],
      ['Building.tiv', 'buildings[].tiv'],
      ['Building.construction_type', 'buildings[].constructionType'],
      ['Building.sprinklered', 'buildings[].sprinklered'],
      ['Location.state', 'locations[].state'],
      ['Location.protection_class', 'locations[].protectionClass'],
      ['Location.hazard_tags', 'locations[].hazardTags'],
      ['Claim.date_of_loss', 'history[].dateOfLoss'],
      ['Claim.paid_indemnity', 'history[].paidIndemnity'],
      ['Insured.employee_count', 'insured.employeeCount'],
      ['Policy.technical_premium', 'pricing.technicalPremium'],
      ['Submission.received_date', 'receivedDate'],
      ['Submission.requested_limit', 'exposure.requestedLimit'],
    ] as const) {
      const entry = entryFor(map.entries, rawPath);
      expect(entry.canonicalPath).toBe(canonicalPath);
      expect(entry.method).toBe('exact');
      expect(entry.confidence).toBe(1);
    }
  });

  it('maps synonyms at 0.9, above the 0.8 acceptance gate', () => {
    for (const [rawPath, canonicalPath] of [
      ['Policy.premium', 'pricing.quotedPremium'],
      ['Policy.business_type', 'submissionType'],
      ['Submission.submission_number', 'externalId'],
      ['Insured.annual_revenue', 'insured.revenue'],
      ['Location.zip', 'locations[].postalCode'],
      ['Broker.name', 'insured.brokerName'],
      ['Contact.email', 'insured.contactEmail'],
      ['Claim.reserve_indemnity', 'history[].reserves'],
    ] as const) {
      const entry = entryFor(map.entries, rawPath);
      expect(entry.canonicalPath).toBe(canonicalPath);
      expect(entry.method).toBe('synonym');
      expect(entry.confidence).toBe(0.9);
    }
  });

  it('marks a nested path as graph, one step below its flat confidence', () => {
    const effective = entryFor(map.entries, 'Policy.dates.effective');
    expect(effective.canonicalPath).toBe('effectiveDate');
    expect(effective.method).toBe('graph');
    expect(effective.confidence).toBe(0.85);
    expect(effective.note).toContain('dates');
  });

  it('notes the entries a vector component reads', () => {
    expect(entryFor(map.entries, 'Policy.premium').note).toContain('vector component');
    expect(entryFor(map.entries, 'Building.tiv').note ?? '').not.toContain('vector component');
  });

  it('leaves names it cannot resolve visibly unmapped, never guessed into place', () => {
    const paths = map.unmapped.map((u) => u.rawPath);
    expect(paths).toContain('Building.square_footage');
    expect(paths).toContain('Policy.status');
    expect(paths).toContain('Insured.hq');
    expect(map.entries.some((e) => e.rawPath === 'Building.square_footage')).toBe(false);
    const squareFootage = map.unmapped.find((u) => u.rawPath === 'Building.square_footage');
    expect(squareFootage?.sampleValues).toEqual([180000, 110000]);
    expect(squareFootage?.bestGuess?.confidence ?? 0).toBeLessThan(0.8);
  });

  it('resolves a hq reference to the insured, not to a risk location', () => {
    const hq = discover(NO_POLICY_BUNDLE, HQ_SCHEMA, COMMERCIAL_SPEC);
    const state = entryFor(hq.entries, 'Submission.insured.hq.state');
    expect(state.canonicalPath).toBe('insured.headquartersState');
    expect(state.method).toBe('graph');
    expect(state.confidence).toBe(0.85);
  });

  it('I3-2/R3-5/R5-4: a hq Location name is never the insured name; only hq state maps', () => {
    const hq = discover(NO_POLICY_BUNDLE, HQ_SCHEMA, COMMERCIAL_SPEC);
    expect(entryFor(hq.entries, 'Submission.insured.name').canonicalPath).toBe('insured.name');
    expect(hq.entries.filter((e) => e.canonicalPath === 'insured.name').map((e) => e.rawPath)).toEqual([
      'Submission.insured.name',
    ]);
    const bundle: RawBundle = {
      ...NO_POLICY_BUNDLE,
      records: {
        Submission: [
          record('Submission', {
            id: 115,
            insured: {
              id: 5,
              name: 'Halcyon Metalworks Corp',
              hq: { id: 12, name: 'Regional Branch 1', state: 'OH', city: 'Dayton', zip: '45402' },
            },
          }),
        ],
      },
    };
    const map = discover(bundle, HQ_SCHEMA, COMMERCIAL_SPEC);
    expect(map.entries.some((e) => e.rawPath === 'Submission.insured.hq.name')).toBe(false);
    expect(map.unmapped.map((u) => u.rawPath)).toContain('Submission.insured.hq.name');
    expect(map.entries.filter((e) => e.canonicalPath === 'insured.name').map((e) => e.rawPath)).toEqual([
      'Submission.insured.name',
    ]);
    expect(entryFor(map.entries, 'Submission.insured.hq.state').canonicalPath).toBe('insured.headquartersState');
  });

  it('R5-5: NAICS and SIC are different code systems; only NAICS feeds insured.industry', () => {
    const bundle: RawBundle = {
      ...NO_POLICY_BUNDLE,
      records: {
        Insured: [record('Insured', { id: 1, name: 'Coastal Freight', naics_code: '484121', sic_code: '4213' })],
      },
    };
    const map = discover(bundle, undefined, COMMERCIAL_SPEC);
    expect(entryFor(map.entries, 'Insured.naics_code').canonicalPath).toBe('insured.industry');
    expect(map.entries.filter((e) => e.canonicalPath === 'insured.industry').map((e) => e.rawPath)).toEqual([
      'Insured.naics_code',
    ]);
    expect(map.unmapped.map((u) => u.rawPath)).toContain('Insured.sic_code');
  });

  it('accepts a schema-assist match at 0.8 and above, and only then', () => {
    const rejected = discover(FLAT_BUNDLE, undefined, COMMERCIAL_SPEC, [
      { rawPath: 'Building.square_footage', canonicalPath: 'exposure.squareFeet', confidence: 0.62 },
    ]);
    expect(rejected.entries.some((e) => e.rawPath === 'Building.square_footage')).toBe(false);
    const still = rejected.unmapped.find((u) => u.rawPath === 'Building.square_footage');
    expect(still?.reason).toContain('below 0.8');
    expect(still?.bestGuess).toEqual({ canonicalPath: 'exposure.squareFeet', confidence: 0.62 });

    const accepted = discover(FLAT_BUNDLE, undefined, COMMERCIAL_SPEC, [
      { rawPath: 'Building.square_footage', canonicalPath: 'exposure.squareFeet', confidence: 0.91 },
    ]);
    const entry = entryFor(accepted.entries, 'Building.square_footage');
    expect(entry.canonicalPath).toBe('exposure.squareFeet');
    expect(entry.method).toBe('llm');
    expect(entry.confidence).toBe(0.91);
    expect(accepted.unmapped.some((u) => u.rawPath === 'Building.square_footage')).toBe(false);
  });

  it('refuses a schema-assist match onto a canonical path that does not exist', () => {
    const bogus = discover(FLAT_BUNDLE, undefined, COMMERCIAL_SPEC, [
      { rawPath: 'Policy.status', canonicalPath: 'pricing.magicNumber', confidence: 0.99 },
    ]);
    expect(bogus.entries.some((e) => e.rawPath === 'Policy.status')).toBe(false);
    expect(bogus.unmapped.find((u) => u.rawPath === 'Policy.status')?.reason).toContain('unknown');
  });

  it('never proposes two canonical paths for one raw path, and is deterministic', () => {
    const seen = new Set<string>();
    for (const entry of map.entries) {
      expect(seen.has(entry.rawPath)).toBe(false);
      seen.add(entry.rawPath);
      expect(entry.confidence).toBeGreaterThanOrEqual(0.8);
    }
    expect(discover(FLAT_BUNDLE, undefined, COMMERCIAL_SPEC)).toEqual(map);
  });
});

export { COMMERCIAL_SPEC };
