import { describe, expect, it } from 'vitest';
import { discover } from './discover.js';
import {
  canonicalConstructionType,
  canonicalLineOfBusiness,
  canonicalStateCode,
  canonicalSubmissionType,
  normalize,
} from './normalize.js';
import { COMMERCIAL_SPEC, FLAT_BUNDLE, HQ_SCHEMA, NO_POLICY_BUNDLE } from './discover.test.js';
import type { RawBundle, Sourced } from '../types.js';

/** The single value in a slot. Never reads through E01, which may still be a stub. */
const one = <T,>(slot: Sourced<T> | undefined): T => {
  if (slot === undefined || slot.length !== 1) {
    throw new Error(`expected exactly one value, got ${slot === undefined ? 'none' : slot.length}`);
  }
  return (slot[0] as { value: T }).value;
};

const record = (resource: string, data: Record<string, unknown>) => ({
  resource,
  id: data['id'] as number,
  data,
});

/** SUB-1005 / policy 9005, hydrated exactly as the deep Policy query returns it. */
const HYDRATED_BUNDLE: RawBundle = {
  externalId: 'SUB-1005',
  lineOfBusiness: 'commercial_property',
  fetchedAt: '2026-09-19T00:00:00.000Z',
  records: {
    Policy: [
      record('Policy', {
        id: 9005,
        dates: { effective: '2026-01-01', expiration: '2027-01-01' },
        premium: 240000,
        business_type: 'renewal',
        target_premium: 235000,
        technical_premium: 228000,
        line_of_business: 'property',
        submission: {
          id: 1005,
          status: 'bound',
          received_date: '2025-08-19',
          requested_limit: 18000000,
          submission_number: 'SUB-1005',
        },
        insured: { id: 305, name: 'Congress Avenue Manufacturing', annual_revenue: 54000000 },
        claims: [
          {
            id: 1103,
            status: 'open',
            date_of_loss: '2025-03-22',
            paid_expense: 18000,
            cause_of_loss: 'fire',
            paid_indemnity: 120000,
            reserve_expense: 12000,
            reserve_indemnity: 90000,
          },
        ],
        exposure_units: [
          {
            id: 204,
            kind: 'location',
            location: {
              id: 403,
              zip: '78701',
              city: 'Austin',
              state: 'tx ',
              hazard_tags: ['hail', 'tornado'],
              protection_class: 7,
              buildings: [
                {
                  id: 505,
                  tiv: 18000000,
                  name: 'Building E',
                  stories: 3,
                  year_built: 1968,
                  sprinklered: false,
                  construction_type: 'Wood Frame',
                },
              ],
            },
          },
        ],
      }),
    ],
  },
};

describe('normalize', () => {
  const flat = normalize(
    FLAT_BUNDLE,
    discover(FLAT_BUNDLE, undefined, COMMERCIAL_SPEC),
    'commercial_property',
  );

  it('carries the identity and the line of business through unchanged', () => {
    expect(flat.id).toBe('SUB-1001');
    expect(flat.externalId).toBe('SUB-1001');
    expect(flat.lineOfBusiness).toBe('commercial_property');
    expect(flat.raw).toBe(FLAT_BUNDLE);
    expect(flat.fieldMap?.entries.length ?? 0).toBeGreaterThan(0);
  });

  it('produces one building per raw building, with its measured numbers', () => {
    expect(flat.buildings.map((b) => b.externalId)).toEqual(['501', '502']);
    const [a, b] = flat.buildings;
    expect(one(a?.tiv)).toBe(40_000_000);
    expect(one(a?.yearBuilt)).toBe(2015);
    expect(one(a?.sprinklered)).toBe(true);
    expect(one(a?.stories)).toBe(6);
    expect(one(a?.roofYear)).toBe(2018);
    expect(a?.label).toBe('Building A');
    expect(one(b?.tiv)).toBe(25_000_000);
    expect(one(b?.yearBuilt)).toBe(2012);
  });

  it('normalizes construction types to lower snake_case (INTERPRETATIONS G-8)', () => {
    expect(flat.buildings.map((b) => one(b.constructionType))).toEqual([
      'non_combustible',
      'steel_frame',
    ]);
  });

  it('links each building to its location and inherits the protection class', () => {
    expect(flat.locations.map((l) => l.externalId)).toEqual(['401']);
    expect(one(flat.locations[0]?.state)).toBe('CA');
    expect(one(flat.locations[0]?.postalCode)).toBe('94107');
    expect(one(flat.locations[0]?.protectionClass)).toBe(2);
    expect(one(flat.locations[0]?.hazardTags)).toEqual(['earthquake', 'flood']);
    expect(flat.buildings.map((b) => b.locationExternalId)).toEqual(['401', '401']);
    expect(flat.buildings.map((b) => one(b.protectionClass))).toEqual([2, 2]);
  });

  it('reads pricing, dates and submission type off the policy', () => {
    expect(one(flat.pricing.quotedPremium)).toBe(88_000);
    expect(one(flat.pricing.technicalPremium)).toBe(84_000);
    expect(one(flat.pricing.targetPremium)).toBe(90_000);
    expect(one(flat.submissionType)).toBe('new_business');
    expect(one(flat.receivedDate)).toBe('2025-11-03');
    expect(one(flat.effectiveDate)).toBe('2026-01-01');
    expect(one(flat.status)).toBe('bound');
    expect(one(flat.exposure.requestedLimit)).toBe(65_000_000);
  });

  it('keeps provenance on every value: self_reported, naming the raw path', () => {
    const premium = flat.pricing.quotedPremium?.[0];
    expect(premium?.provenance.source).toBe('self_reported');
    expect(premium?.provenance.sourceDetail).toBe('Policy.premium');
    expect(premium?.provenance.observedAt).toBe('2026-09-19T00:00:00.000Z');
    expect(premium?.provenance.confidence).toBeUndefined();
  });

  it('collapses two raw paths that agree into one value, not a contradiction', () => {
    // Submission.received_date and Policy.dates.submission_received are both
    // 2025-11-03; the slot holds one field, sourced from the exact match.
    expect(flat.receivedDate?.length).toBe(1);
    expect(flat.receivedDate?.[0]?.provenance.sourceDetail).toBe('Submission.received_date');
    expect(flat.effectiveDate?.length).toBe(1);
  });

  it('sums indemnity and expense reserves into one reserves value', () => {
    expect(flat.history.map((c) => c.externalId)).toEqual(['1101']);
    const claim = flat.history[0];
    expect(one(claim?.paidIndemnity)).toBe(28_000);
    expect(one(claim?.paidExpense)).toBe(4_000);
    expect(one(claim?.reserves)).toBe(0);
    expect(one(claim?.dateOfLoss)).toBe('2023-11-04');
    expect(one(claim?.causeOfLoss)).toBe('water_damage');
  });

  it('reads coverage lines, insured, broker and contact', () => {
    expect(flat.coverage.lines.map((l) => l.code)).toEqual(['PROP-BLDG']);
    expect(one(flat.coverage.lines[0]?.limit)).toBe(65_000_000);
    expect(one(flat.coverage.lines[0]?.deductible)).toBe(100_000);
    expect(one(flat.insured.name)).toBe('Northgate Biotech Holdings');
    expect(one(flat.insured.revenue)).toBe(240_000_000);
    expect(one(flat.insured.employeeCount)).toBe(610);
    expect(one(flat.insured.brokerName)).toBe('Harbor Point Brokerage');
    expect(one(flat.insured.contactEmail)).toBe('dana.reyes@harborpoint.example');
  });

  it('leaves a slot absent rather than inventing a value', () => {
    expect(flat.locations[0]?.floodZone).toBeUndefined();
    expect(flat.exposure.contentsLimit).toBeUndefined();
    expect(flat.hazards.present).toEqual({});
  });

  it('reads a hydrated policy exactly as it reads the flat records', () => {
    const hydrated = normalize(
      HYDRATED_BUNDLE,
      discover(HYDRATED_BUNDLE, undefined, COMMERCIAL_SPEC),
      'commercial_property',
    );
    expect(hydrated.buildings.map((b) => b.externalId)).toEqual(['505']);
    expect(one(hydrated.buildings[0]?.tiv)).toBe(18_000_000);
    expect(one(hydrated.buildings[0]?.yearBuilt)).toBe(1968);
    expect(one(hydrated.buildings[0]?.constructionType)).toBe('wood_frame');
    expect(hydrated.buildings[0]?.locationExternalId).toBe('403');
    // G-7: state codes are upper-cased and trimmed.
    expect(one(hydrated.locations[0]?.state)).toBe('TX');
    expect(one(hydrated.pricing.quotedPremium)).toBe(240_000);
    expect(one(hydrated.submissionType)).toBe('renewal');
    expect(one(hydrated.status)).toBe('bound');
    expect(one(hydrated.receivedDate)).toBe('2025-08-19');
    expect(hydrated.externalId).toBe('SUB-1005');
    // 12,000 expense + 90,000 indemnity reserves.
    expect(one(hydrated.history[0]?.reserves)).toBe(102_000);
    expect(one(hydrated.history[0]?.paidIndemnity)).toBe(120_000);
  });

  it('keeps an insured HQ as headquarters, never as a risk location', () => {
    const noPolicy = normalize(
      NO_POLICY_BUNDLE,
      discover(NO_POLICY_BUNDLE, HQ_SCHEMA, COMMERCIAL_SPEC),
      'commercial_property',
    );
    expect(one(noPolicy.insured.headquartersState)).toBe('CA');
    expect(noPolicy.locations).toEqual([]);
    expect(noPolicy.buildings).toEqual([]);
    expect(noPolicy.pricing.quotedPremium).toBeUndefined();
    expect(one(noPolicy.status)).toBe('lost');
    expect(noPolicy.externalId).toBe('SUB-1004');
  });

  it('is deterministic', () => {
    const map = discover(FLAT_BUNDLE, undefined, COMMERCIAL_SPEC);
    expect(normalize(FLAT_BUNDLE, map, 'commercial_property')).toEqual(
      normalize(FLAT_BUNDLE, map, 'commercial_property'),
    );
  });
});

describe('G-11 canonicalizers (exported for stage 6, CP1 FX1)', () => {
  it('submission type: trimmed, case-folded; blank and non-string are missing', () => {
    for (const raw of ['NEW_BUSINESS', ' new ', 'new', 'new_business', 'New Business', 'newbusiness']) {
      expect(canonicalSubmissionType(raw), raw).toBe('new_business');
    }
    for (const raw of ['RENEWAL', ' renewal ', 'Renew']) {
      expect(canonicalSubmissionType(raw), raw).toBe('renewal');
    }
    for (const raw of ['', '   ', null, undefined, 3]) {
      expect(canonicalSubmissionType(raw), String(raw)).toBeNull();
    }
    expect(canonicalSubmissionType('rewrite')).toBeNull();
  });

  it('line of business: lower snake_case; blank is missing', () => {
    expect(canonicalLineOfBusiness('COMMERCIAL_PROPERTY')).toBe('commercial_property');
    expect(canonicalLineOfBusiness(' Commercial Property ')).toBe('commercial_property');
    expect(canonicalLineOfBusiness('Tenant')).toBe('tenant');
    expect(canonicalLineOfBusiness('')).toBeNull();
    expect(canonicalLineOfBusiness('   ')).toBeNull();
    expect(canonicalLineOfBusiness(null)).toBeNull();
  });

  it('state (G-7) and construction (G-8); blank is missing', () => {
    expect(canonicalStateCode(' oh ')).toBe('OH');
    expect(canonicalStateCode('   ')).toBeNull();
    expect(canonicalStateCode('')).toBeNull();
    expect(canonicalConstructionType('Masonry Non-Combustible')).toBe('masonry_non_combustible');
    expect(canonicalConstructionType('  ')).toBeNull();
  });
});
