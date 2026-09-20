import { describe, expect, it } from 'vitest';
import type {
  BuildingFacts,
  CanonicalSubmission,
  ClaimFacts,
  LocationFacts,
  Sourced,
} from '../types.js';
import { rollup } from './rollup.js';

function self<T>(value: T): Sourced<T> {
  return [{ value, provenance: { source: 'self_reported' } }];
}

function building(
  externalId: string,
  b: {
    tiv?: number;
    yearBuilt?: number;
    constructionType?: string;
    sprinklered?: boolean;
    protectionClass?: number;
    locationExternalId?: string;
  },
): BuildingFacts {
  return {
    externalId,
    ...(b.locationExternalId === undefined ? {} : { locationExternalId: b.locationExternalId }),
    ...(b.tiv === undefined ? {} : { tiv: self(b.tiv) }),
    ...(b.yearBuilt === undefined ? {} : { yearBuilt: self(b.yearBuilt) }),
    ...(b.constructionType === undefined ? {} : { constructionType: self(b.constructionType) }),
    ...(b.sprinklered === undefined ? {} : { sprinklered: self(b.sprinklered) }),
    ...(b.protectionClass === undefined ? {} : { protectionClass: self(b.protectionClass) }),
  };
}

function location(externalId: string, state?: string, protectionClass?: number): LocationFacts {
  return {
    externalId,
    ...(state === undefined ? {} : { state: self(state) }),
    ...(protectionClass === undefined ? {} : { protectionClass: self(protectionClass) }),
  };
}

function claim(
  externalId: string,
  c: { dateOfLoss?: string; paidIndemnity?: number; paidExpense?: number; reserves?: number },
): ClaimFacts {
  return {
    externalId,
    ...(c.dateOfLoss === undefined ? {} : { dateOfLoss: self(c.dateOfLoss) }),
    ...(c.paidIndemnity === undefined ? {} : { paidIndemnity: self(c.paidIndemnity) }),
    ...(c.paidExpense === undefined ? {} : { paidExpense: self(c.paidExpense) }),
    ...(c.reserves === undefined ? {} : { reserves: self(c.reserves) }),
  };
}

function submission(over: Partial<CanonicalSubmission> = {}): CanonicalSubmission {
  return {
    id: 'S1',
    lineOfBusiness: 'commercial_property',
    insured: {},
    locations: [],
    buildings: [],
    hazards: { present: {} },
    exposure: {},
    coverage: { lines: [] },
    history: [],
    pricing: {},
    ...over,
  };
}

const ASOF = '2025-06-15';

describe('rollup — TIV and counts', () => {
  it('sums known TIV and counts buildings with and without it', () => {
    const r = rollup(
      submission({
        buildings: [
          building('B1', { tiv: 60_000_000 }),
          building('B2', { tiv: 40_000_000 }),
          building('B3', {}),
        ],
      }),
      ASOF,
    );
    expect(r.totalTiv).toBe(100_000_000);
    expect(r.buildingCount).toBe(3);
    expect(r.tivKnownBuildingCount).toBe(2);
  });

  it('returns null TIV when no building states one', () => {
    const r = rollup(submission({ buildings: [building('B1', { yearBuilt: 1980 })] }), ASOF);
    expect(r.totalTiv).toBeNull();
    expect(r.pctTivPre1990).toBeNull();
    expect(r.pctTivAcceptableConstruction).toBeNull();
  });
});

describe('rollup — building age (INTERPRETATIONS 3.4)', () => {
  it('puts 1990 on the newer side and 2010 on the post-2010 side', () => {
    const r = rollup(
      submission({
        buildings: [
          building('B1', { tiv: 100, yearBuilt: 1989 }),
          building('B2', { tiv: 100, yearBuilt: 1990 }),
          building('B3', { tiv: 100, yearBuilt: 2010 }),
          building('B4', { tiv: 100, yearBuilt: 2009 }),
        ],
      }),
      ASOF,
    );
    expect(r.pctTivPre1990).toBeCloseTo(0.25, 12);
    expect(r.pctTivPost2010).toBeCloseTo(0.25, 12);
    expect(r.pre1990BuildingIds).toEqual(['B1']);
    expect(r.oldestYearBuilt).toBe(1989);
    expect(r.newestYearBuilt).toBe(2010);
  });

  it('B6: an exact 50% pre-1990 split is reported as 0.5, not rounded away', () => {
    const r = rollup(
      submission({
        buildings: [
          building('B1', { tiv: 75_000_000, yearBuilt: 1989 }),
          building('B2', { tiv: 75_000_000, yearBuilt: 1995 }),
        ],
      }),
      ASOF,
    );
    expect(r.pctTivPre1990).toBe(0.5);
    expect(r.pre1990BuildingIds).toEqual(['B1']);
  });

  it('R-AGE-REFER: a pre-1990 building with unknown TIV is listed although the share is 0', () => {
    const r = rollup(
      submission({
        buildings: [
          building('B1', { yearBuilt: 1975 }),
          building('B2', { tiv: 10_000_000, yearBuilt: 2015 }),
        ],
      }),
      ASOF,
    );
    expect(r.pctTivPre1990).toBe(0);
    expect(r.pctTivPost2010).toBe(1);
    expect(r.pre1990BuildingIds).toEqual(['B1']);
  });

  it('shares are computed over known-TIV known-year buildings only', () => {
    const r = rollup(
      submission({
        buildings: [
          building('B1', { tiv: 100, yearBuilt: 1980 }),
          building('B2', { tiv: 300 }), // unknown year: out of the denominator
        ],
      }),
      ASOF,
    );
    expect(r.pctTivPre1990).toBe(1);
    expect(r.totalTiv).toBe(400);
  });

  it('components 5 and 6 are jointly missing when no year is known', () => {
    const r = rollup(submission({ buildings: [building('B1', { tiv: 100 })] }), ASOF);
    expect(r.pctTivPre1990).toBeNull();
    expect(r.pctTivPost2010).toBeNull();
    expect(r.pre1990BuildingIds).toEqual([]);
  });
});

describe('rollup — construction (INTERPRETATIONS 3.5, I-3)', () => {
  it('normalizes class names, flags fire resistive, and counts unknown as other', () => {
    const r = rollup(
      submission({
        buildings: [
          building('B1', { tiv: 100, constructionType: 'Masonry Non-Combustible' }),
          building('B2', { tiv: 100, constructionType: 'Fire Resistive' }),
          building('B3', { tiv: 100, constructionType: 'Wood Frame' }),
          building('B4', { tiv: 100 }), // unknown class, known TIV -> "other"
        ],
      }),
      ASOF,
    );
    expect(r.pctTivAcceptableConstruction).toBe(0.5);
    const byClass = new Map(r.pctTivByConstruction.map((c) => [c.constructionType, c]));
    expect(byClass.get('masonry_non_combustible')?.acceptable).toBe(true);
    expect(byClass.get('masonry_non_combustible')?.assumedAcceptable).toBe(false);
    expect(byClass.get('fire_resistive')?.acceptable).toBe(true);
    expect(byClass.get('fire_resistive')?.assumedAcceptable).toBe(true);
    expect(byClass.get('wood_frame')?.acceptable).toBe(false);
    expect(byClass.get('unknown')?.acceptable).toBe(false);
    expect(byClass.get('unknown')?.tiv).toBe(100);
    expect(r.pctTivByConstruction.every((c) => c.share === 0.25)).toBe(true);
  });

  it('treats "Steel Frame" as the listed steel class', () => {
    const r = rollup(
      submission({
        buildings: [
          building('B1', { tiv: 100, constructionType: 'Steel Frame' }),
          building('B2', { tiv: 100, constructionType: 'Frame' }),
        ],
      }),
      ASOF,
    );
    expect(r.pctTivAcceptableConstruction).toBe(0.5);
  });

  it('excludes unknown-TIV buildings from both numerator and denominator', () => {
    const r = rollup(
      submission({
        buildings: [
          building('B1', { tiv: 100, constructionType: 'Joisted Masonry' }),
          building('B2', { constructionType: 'Frame' }),
        ],
      }),
      ASOF,
    );
    expect(r.pctTivAcceptableConstruction).toBe(1);
    expect(r.pctTivByConstruction).toHaveLength(1);
  });
});

describe('rollup — sprinklers and protection class', () => {
  it('weights sprinklered share by TIV, unknown counting as not sprinklered', () => {
    const r = rollup(
      submission({
        buildings: [
          building('B1', { tiv: 300, sprinklered: true }),
          building('B2', { tiv: 100, sprinklered: false }),
          building('B3', { tiv: 100 }),
        ],
      }),
      ASOF,
    );
    expect(r.pctTivSprinklered).toBe(0.6);
  });

  it('is null when no known-TIV building states sprinklers', () => {
    const r = rollup(submission({ buildings: [building('B1', { tiv: 100 })] }), ASOF);
    expect(r.pctTivSprinklered).toBeNull();
  });

  it('TIV-weights protection class and falls back to the location value', () => {
    const r = rollup(
      submission({
        locations: [location('L1', 'CA', 8)],
        buildings: [
          building('B1', { tiv: 300, protectionClass: 2, locationExternalId: 'L1' }),
          building('B2', { tiv: 100, locationExternalId: 'L1' }),
        ],
      }),
      ASOF,
    );
    // (300*2 + 100*8) / 400 = 3.5
    expect(r.tivWeightedProtectionClass).toBe(3.5);
  });
});

describe('rollup — primary state (I-1)', () => {
  it('picks the state with the greatest TIV and lists shares descending', () => {
    const r = rollup(
      submission({
        locations: [location('L1', 'CA'), location('L2', 'TX'), location('L3', 'oh')],
        buildings: [
          building('B1', { tiv: 100, locationExternalId: 'L1' }),
          building('B2', { tiv: 250, locationExternalId: 'L2' }),
          building('B3', { tiv: 150, locationExternalId: 'L3' }),
        ],
      }),
      ASOF,
    );
    expect(r.primaryState).toBe('TX');
    expect(r.stateShares.map((s) => s.state)).toEqual(['TX', 'OH', 'CA']);
    expect(r.stateShares[0]?.share).toBe(0.5);
    expect(r.stateShares[2]?.share).toBe(0.2);
  });

  it('breaks an exact tie alphabetically', () => {
    const r = rollup(
      submission({
        locations: [location('L1', 'OH'), location('L2', 'CA')],
        buildings: [
          building('B1', { tiv: 100, locationExternalId: 'L1' }),
          building('B2', { tiv: 100, locationExternalId: 'L2' }),
        ],
      }),
      ASOF,
    );
    expect(r.primaryState).toBe('CA');
  });

  it('excludes unknown-state buildings and unknown-TIV buildings', () => {
    const r = rollup(
      submission({
        locations: [location('L1', 'FL'), location('L2', 'TX')],
        buildings: [
          building('B1', { tiv: 100, locationExternalId: 'L1' }),
          building('B2', { locationExternalId: 'L2' }), // unknown TIV, never wins
          building('B3', { tiv: 500 }), // unknown state, excluded
        ],
      }),
      ASOF,
    );
    expect(r.primaryState).toBe('FL');
    expect(r.stateShares).toEqual([{ state: 'FL', tiv: 100, share: 1 }]);
  });

  it('is null when no building has both a state and a TIV', () => {
    const r = rollup(submission({ buildings: [building('B1', {})] }), ASOF);
    expect(r.primaryState).toBeNull();
    expect(r.stateShares).toEqual([]);
  });
});

describe('rollup — five-year loss (I-4)', () => {
  const claims: ClaimFacts[] = [
    claim('C1', { dateOfLoss: '2020-06-15', paidIndemnity: 1000 }), // exactly windowFrom: in
    claim('C2', { dateOfLoss: '2025-06-15', paidExpense: 2000 }), // exactly windowTo: in
    claim('C3', { dateOfLoss: '2020-06-14', paidIndemnity: 999_999 }), // one day early: out
    claim('C4', { dateOfLoss: '2022-01-01', paidIndemnity: 100, paidExpense: 50, reserves: 25 }),
    claim('C5', { paidIndemnity: 777 }), // undated: counted, not summed
  ];

  it('uses both endpoints inclusively and sums indemnity + expense + reserves', () => {
    const r = rollup(submission({ history: claims }), ASOF);
    expect(r.lossWindow).toEqual({ from: '2020-06-15', to: '2025-06-15' });
    expect(r.fiveYearLoss).toBe(1000 + 2000 + 175);
    expect(r.fiveYearClaimCount).toBe(3);
    expect(r.claimCount).toBe(5);
  });

  it('measures the window from receivedDate when it is known', () => {
    const r = rollup(
      submission({ receivedDate: self('2024-02-29'), history: claims }),
      ASOF,
    );
    // Feb 29 -> Feb 28 in the non-leap year 2019.
    expect(r.lossWindow).toEqual({ from: '2019-02-28', to: '2024-02-29' });
    expect(r.fiveYearLoss).toBe(1000 + 999_999 + 175);
  });

  it('zero claims in the window is a known 0', () => {
    const r = rollup(
      submission({ history: [claim('C1', { dateOfLoss: '2001-01-01', paidIndemnity: 5 })] }),
      ASOF,
    );
    expect(r.fiveYearLoss).toBe(0);
    expect(r.fiveYearClaimCount).toBe(0);
    expect(r.claimCount).toBe(1);
  });

  it('is null when the raw bundle shows claims were never fetched', () => {
    const r = rollup(
      submission({
        raw: { externalId: 'P1', records: { Policy: [] } },
      }),
      ASOF,
    );
    expect(r.fiveYearLoss).toBeNull();
    expect(r.claimCount).toBe(0);
  });

  // R1-1 / R1-2 / R2-2 / R3-6: the deep pass embeds claims in the Policy row
  // (`claims: []` when the account has none) and never emits a records.Claim key.
  it('is a known 0 when a raw Policy row carries an expanded, empty claims list', () => {
    const r = rollup(
      submission({
        raw: {
          externalId: 'SUB-2026-00038',
          records: { Policy: [{ resource: 'Policy', id: 1038, data: { id: 1038, claims: [] } }] },
        },
      }),
      ASOF,
    );
    expect(r.fiveYearLoss).toBe(0);
    expect(r.claimCount).toBe(0);
  });

  it('stays null when the Policy row holds only unexpanded claim ids', () => {
    const r = rollup(
      submission({
        raw: {
          externalId: 'P1',
          records: { Policy: [{ resource: 'Policy', id: 1, data: { id: 1, claims: [11, 12] } }] },
        },
      }),
      ASOF,
    );
    expect(r.fiveYearLoss).toBeNull();
  });

  it('stays null when the Policy row has no claims key at all', () => {
    const r = rollup(
      submission({
        raw: { externalId: 'P1', records: { Policy: [{ resource: 'Policy', id: 1, data: { id: 1 } }] } },
      }),
      ASOF,
    );
    expect(r.fiveYearLoss).toBeNull();
  });

  it('is a known 0 when the bundle did fetch claims and found none', () => {
    const r = rollup(
      submission({ raw: { externalId: 'P1', records: { Claim: [] } } }),
      ASOF,
    );
    expect(r.fiveYearLoss).toBe(0);
  });
});

describe('rollup — flood zone (component 11, fed by enrichment)', () => {
  /** A location carrying only a FEMA zone, as the OpenFEMA enrichment writes it. */
  const at = (externalId: string, zone: string): LocationFacts => ({
    externalId,
    floodZone: [{ value: zone, provenance: { source: 'enrichment' } }],
  });

  it('is null when no location states a zone, so an un-enriched account is unchanged', () => {
    expect(rollup(submission({ locations: [location('L1', 'CA')] }), ASOF).worstFloodZoneTier).toBeNull();
    expect(rollup(submission(), ASOF).worstFloodZoneTier).toBeNull();
  });

  it('maps every FEMA zone code to its tier, and an unreadable code to 0', () => {
    const tierOf = (zone: string): number | null =>
      rollup(submission({ locations: [at('L1', zone)] }), ASOF).worstFloodZoneTier;

    // Outside the mapped hazard.
    for (const zone of ['X', 'X500', 'D', 'x']) expect(tierOf(zone)).toBe(0);
    // Special Flood Hazard Area, no wave action.
    for (const zone of ['A', 'AE', 'AO', 'AH', 'AR', 'A99', 'ae']) expect(tierOf(zone)).toBe(1);
    // Coastal, with wave action.
    for (const zone of ['V', 'VE', 've']) expect(tierOf(zone)).toBe(2);
    // A code we cannot read is never allowed to penalise the account.
    for (const zone of ['ZONE-42', '?']) expect(tierOf(zone)).toBe(0);
    // A blank zone is "no zone stated", which is not the same as "dry".
    expect(tierOf('  ')).toBeNull();
  });

  it('takes the worst zone across locations, never an average', () => {
    // One building in a V zone is the exposure; averaging it against three dry
    // locations would report the account as safer than it is.
    const many = submission({
      locations: [at('L1', 'X'), at('L2', 'X'), at('L3', 'AE'), at('L4', 'X')],
    });
    expect(rollup(many, ASOF).worstFloodZoneTier).toBe(1);

    const coastal = submission({ locations: [at('L1', 'X'), at('L2', 'AE'), at('L3', 'VE')] });
    expect(rollup(coastal, ASOF).worstFloodZoneTier).toBe(2);
  });

  it('ignores locations with no zone rather than reading them as dry', () => {
    const mixed = submission({ locations: [location('L1', 'CA'), at('L2', 'AE')] });
    expect(rollup(mixed, ASOF).worstFloodZoneTier).toBe(1);
  });

  it('needs no building, because the zone is a property of the location', () => {
    const noBuildings = submission({ locations: [at('L1', 'AE')], buildings: [] });
    expect(rollup(noBuildings, ASOF).worstFloodZoneTier).toBe(1);
    expect(rollup(noBuildings, ASOF).totalTiv).toBeNull();
  });
});
