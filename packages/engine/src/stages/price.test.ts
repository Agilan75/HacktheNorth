import { describe, expect, it } from 'vitest';
import type {
  BookStats,
  BuildingFacts,
  CanonicalSubmission,
  CommercialRatingTable,
  FeatureVector,
  LocationFacts,
  PeerResult,
  Rollup,
  Sourced,
  TenantRatingTable,
  VectorComponentSpec,
  VectorSpec,
} from '../types.js';
import { expectedAnnualLoss, price, priceCommercial, priceTenant } from './price.js';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

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

function location(externalId: string, protectionClass?: number): LocationFacts {
  return {
    externalId,
    ...(protectionClass === undefined ? {} : { protectionClass: self(protectionClass) }),
  };
}

function rollupOf(over: Partial<Rollup>): Rollup {
  return {
    totalTiv: null,
    buildingCount: 0,
    tivKnownBuildingCount: 0,
    pctTivPre1990: null,
    pctTivPost2010: null,
    pctTivByConstruction: [],
    pctTivAcceptableConstruction: null,
    pctTivSprinklered: null,
    tivWeightedProtectionClass: null,
    worstFloodZoneTier: null,
    primaryState: null,
    stateShares: [],
    fiveYearLoss: null,
    fiveYearClaimCount: 0,
    claimCount: 0,
    pre1990BuildingIds: [],
    oldestYearBuilt: null,
    newestYearBuilt: null,
    lossWindow: null,
    ...over,
  };
}

function submissionOf(over: {
  buildings?: readonly BuildingFacts[];
  locations?: readonly LocationFacts[];
  quotedPremium?: number;
  rollup?: Rollup;
}): CanonicalSubmission {
  return {
    id: 'S1',
    lineOfBusiness: 'commercial_property',
    insured: {},
    locations: over.locations ?? [],
    buildings: over.buildings ?? [],
    hazards: { present: {} },
    exposure: {},
    coverage: { lines: [] },
    history: [],
    pricing: over.quotedPremium === undefined ? {} : { quotedPremium: self(over.quotedPremium) },
    ...(over.rollup === undefined ? {} : { rollup: over.rollup }),
  };
}

/**
 * Bands are keyed by `yearBuilt`, not by age in years: the engine is pure and
 * has no clock (docs/decisions/E07.md).
 */
const COMMERCIAL: CommercialRatingTable = {
  lineOfBusiness: 'commercial_property',
  version: 'test-1',
  baseRate: 0.4,
  construction: { fire_resistive: 0.9, masonry: 1.0, 'Steel Frame': 1.1, frame: 1.4 },
  age: [
    { key: 'pre_1990', upTo: 1989, factor: 1.25 },
    { key: '1990_2009', upTo: 2009, factor: 1.0 },
    { key: 'post_2010', upTo: null, factor: 0.9 },
  ],
  protectionClass: [
    { key: 'pc_1_4', upTo: 4, factor: 0.9 },
    { key: 'pc_5_7', upTo: 7, factor: 1.0 },
    { key: 'pc_8_10', upTo: null, factor: 1.2 },
  ],
  sprinkler: { sprinklered: 0.85, unsprinklered: 1.15 },
  lossHistory: [
    { key: 'none', upTo: 0, factor: 0.95 },
    { key: 'under_100k', upTo: 100_000, factor: 1.0 },
    { key: 'over_100k', upTo: null, factor: 1.3 },
  ],
  credibilityK: 5,
};

const TENANT: TenantRatingTable = {
  lineOfBusiness: 'tenant',
  version: 'test-1',
  baseMonthlyRate: 12,
  contents: [
    { key: 'under_10k', upTo: 10_000, factor: 1.0 },
    { key: 'under_25k', upTo: 25_000, factor: 1.3 },
    { key: 'over_25k', upTo: null, factor: 1.6 },
  ],
  buildingAge: [
    { key: 'pre_1990', upTo: 1989, factor: 1.2 },
    { key: 'modern', upTo: null, factor: 1.0 },
  ],
  hazards: { portableHeater: 1.15, candle: 1.1, blockedExit: 1.25 },
  term: { '4': 1.1, '8': 1.05, '12': 1.0 },
  smokeDetector: { present: 0.9, absent: 1.2 },
};

const TENANT_KEYS = [
  'hazardPortableHeater',
  'hazardCandle',
  'hazardBlockedExit',
  'smokeDetectorCount',
  'buildingYearBuilt',
  'contentsLimit',
  'termMonths',
] as const;

function tenantComponent(index: number, key: string): VectorComponentSpec {
  return {
    index,
    key,
    label: key,
    source: key,
    type: key.startsWith('hazard') ? 'binary' : 'count',
    scaling: { rule: 'none' },
    direction: 'lower_better',
    appetiteFactor: key.startsWith('hazard'),
    factor: null,
    extensionOnly: false,
    immovable: false,
    required: true,
  };
}

const TENANT_SPEC: VectorSpec = {
  lineOfBusiness: 'tenant',
  version: 'test-1',
  components: TENANT_KEYS.map((key, i) => tenantComponent(i, key)),
};

function tenantVector(values: Partial<Record<(typeof TENANT_KEYS)[number], number>>): FeatureVector {
  const x: (number | null)[] = [];
  const m: (0 | 1)[] = [];
  for (const key of TENANT_KEYS) {
    const v = values[key];
    x.push(v === undefined ? null : v);
    m.push(v === undefined ? 0 : 1);
  }
  return { lineOfBusiness: 'tenant', specVersion: 'test-1', x, t: x.map(() => null), m };
}

const EMPTY_SPEC: VectorSpec = {
  lineOfBusiness: 'commercial_property',
  version: 'test-1',
  components: [],
};
const EMPTY_VECTOR: FeatureVector = {
  lineOfBusiness: 'commercial_property',
  specVersion: 'test-1',
  x: [],
  t: [],
  m: [],
};

const TWO_BUILDINGS = submissionOf({
  locations: [location('L1', 8)],
  buildings: [
    building('B1', {
      tiv: 2_000_000,
      yearBuilt: 1985,
      constructionType: 'Masonry',
      protectionClass: 3,
      sprinklered: true,
    }),
    building('B2', {
      tiv: 1_000_000,
      yearBuilt: 2015,
      constructionType: 'Steel Frame',
      locationExternalId: 'L1',
      sprinklered: false,
    }),
  ],
  quotedPremium: 12_000,
  rollup: rollupOf({ totalTiv: 3_000_000, fiveYearLoss: 50_000, fiveYearClaimCount: 2 }),
});

// 2,000,000/100 * 0.40 = 8000, x1.00 masonry x1.25 pre-1990 x0.90 pc3 x0.85 sprinklered
const B1_PREMIUM = 7650;
// 1,000,000/100 * 0.40 = 4000, x1.10 steel x0.90 post-2010 x1.20 pc8 x1.15 unsprinklered
const B2_PREMIUM = 5464.8;

/* -------------------------------------------------------------------------- */
/* Commercial                                                                 */
/* -------------------------------------------------------------------------- */

describe('priceCommercial', () => {
  it('multiplies TIV/100 x baseRate by each building factor', () => {
    const out = priceCommercial(EMPTY_VECTOR, EMPTY_SPEC, COMMERCIAL, TWO_BUILDINGS);

    expect(out.perBuilding).toHaveLength(2);
    expect(out.perBuilding[0]?.premium).toBeCloseTo(B1_PREMIUM, 6);
    expect(out.perBuilding[1]?.premium).toBeCloseTo(B2_PREMIUM, 6);
    expect(out.perBuilding[0]?.factors.map((f) => f.factor)).toEqual([1.0, 1.25, 0.9, 0.85]);
    // `Steel Frame` resolves through the normalized spelling.
    expect(out.perBuilding[1]?.factors[0]?.factor).toBe(1.1);
    // Protection class falls back to the building's location (PC 8 -> 1.2).
    expect(out.perBuilding[1]?.factors[2]).toEqual({
      name: 'protectionClass',
      input: 'class 8',
      factor: 1.2,
    });
  });

  /*
   * Flood is the one rating input fed from outside the submission (the OpenFEMA
   * hazard layer), so these pin the thing the bonus criterion turns on: an
   * enriched account is repriced, and an un-enriched or dry one is not.
   */
  describe('flood load', () => {
    const FLOODED: CommercialRatingTable = {
      ...COMMERCIAL,
      flood: { minimal: 1, sfha: 1.15, coastal: 1.35 },
    };
    const withTier = (worstFloodZoneTier: number | null): CanonicalSubmission => ({
      ...TWO_BUILDINGS,
      rollup: rollupOf({ ...TWO_BUILDINGS.rollup, worstFloodZoneTier }),
    });
    const dry = priceCommercial(EMPTY_VECTOR, EMPTY_SPEC, FLOODED, withTier(0));

    it('charges nothing for flood outside the mapped hazard, to the cent', () => {
      // Pinned, not approximated: a dry account must price EXACTLY as it did
      // before flood existed, or the fitted error no longer describes it.
      const noFlood = priceCommercial(EMPTY_VECTOR, EMPTY_SPEC, COMMERCIAL, TWO_BUILDINGS);
      expect(dry.predictedPremium).toBe(noFlood.predictedPremium);
      expect(dry.factors.find((f) => f.name === 'flood')).toEqual({
        name: 'flood',
        input: 'outside the mapped flood hazard',
        factor: 1,
      });
    });

    it('loads an inland flood zone by 15% and a coastal one by 35%', () => {
      const sfha = priceCommercial(EMPTY_VECTOR, EMPTY_SPEC, FLOODED, withTier(1));
      const coastal = priceCommercial(EMPTY_VECTOR, EMPTY_SPEC, FLOODED, withTier(2));
      const base = dry.predictedPremium as number;

      expect(sfha.predictedPremium).toBeCloseTo(base * 1.15, 6);
      expect(coastal.predictedPremium).toBeCloseTo(base * 1.35, 6);
      expect(sfha.factors.find((f) => f.name === 'flood')).toEqual({
        name: 'flood',
        input: 'FEMA special flood hazard area',
        factor: 1.15,
      });
      expect(coastal.factors.find((f) => f.name === 'flood')?.input).toBe('coastal V zone');
      // A dearer premium against the same quote is a worse adequacy, which is
      // how the enrichment reaches the ranked order.
      expect(sfha.adequacy as number).toBeLessThan(dry.adequacy as number);
    });

    it('charges nothing when FEMA has not answered, rather than assuming the worst', () => {
      const unknown = priceCommercial(EMPTY_VECTOR, EMPTY_SPEC, FLOODED, withTier(null));
      expect(unknown.predictedPremium).toBe(dry.predictedPremium);
      expect(unknown.factors.find((f) => f.name === 'flood')?.factor).toBe(1);
    });

    it('charges nothing from a rating table written before flood existed', () => {
      const old = priceCommercial(EMPTY_VECTOR, EMPTY_SPEC, COMMERCIAL, withTier(2));
      expect(old.predictedPremium).toBe(dry.predictedPremium);
      expect(old.factors.find((f) => f.name === 'flood')?.factor).toBe(1);
    });
  });

  it('applies the loss-history factor and reports rate, adequacy and basis', () => {
    const out = priceCommercial(EMPTY_VECTOR, EMPTY_SPEC, COMMERCIAL, TWO_BUILDINGS);

    expect(out.lossHistoryFactor).toBe(1.0);
    expect(out.predictedPremium).toBeCloseTo(13_114.8, 6);
    // 13,114.80 / (3,000,000 / 100) — inside the $0.23-$0.66 live band.
    expect(out.ratePer100).toBeCloseTo(0.437_16, 9);
    expect(out.quotedPremium).toBe(12_000);
    expect(out.adequacy).toBeCloseTo(12_000 / 13_114.8, 9);
    // Under 0.9 is underpriced; 0.915 is not.
    expect(out.adequacy).toBeGreaterThan(0.9);
    expect(out.basis).toBe('table');
    expect(out.estimate).toBe(true);
    expect(out.predictedMonthlyPremium).toBeNull();
  });

  it('reports a fitted basis with the table fit error', () => {
    const fitted: CommercialRatingTable = {
      ...COMMERCIAL,
      fitError: { mape: 0.12, r2: 0.72, n: 27 },
    };
    const out = priceCommercial(EMPTY_VECTOR, EMPTY_SPEC, fitted, TWO_BUILDINGS);
    expect(out.basis).toBe('fitted');
    expect(out.estimate).toBe(false);
    expect(out.fitError).toEqual({ mape: 0.12, r2: 0.72, n: 27 });
  });

  it('uses a neutral factor for every unknown input, never a surcharge', () => {
    const bare = submissionOf({
      buildings: [building('B1', { tiv: 1_000_000 })],
      rollup: rollupOf({ totalTiv: 1_000_000 }),
    });
    const out = priceCommercial(EMPTY_VECTOR, EMPTY_SPEC, COMMERCIAL, bare);

    expect(out.perBuilding[0]?.factors.map((f) => f.factor)).toEqual([1, 1, 1, 1]);
    expect(out.perBuilding[0]?.factors.map((f) => f.input)).toEqual([
      'unknown',
      'unknown',
      'unknown',
      'unknown',
    ]);
    expect(out.lossHistoryFactor).toBeNull();
    // 1,000,000/100 * 0.40, nothing else applied.
    expect(out.predictedPremium).toBeCloseTo(4000, 6);
    expect(out.ratePer100).toBeCloseTo(0.4, 9);
    expect(out.adequacy).toBeNull();
  });

  it('returns a null premium when no building has a known TIV', () => {
    const out = priceCommercial(
      EMPTY_VECTOR,
      EMPTY_SPEC,
      COMMERCIAL,
      submissionOf({ buildings: [building('B1', { yearBuilt: 1980 })] }),
    );
    expect(out.perBuilding).toEqual([]);
    expect(out.predictedPremium).toBeNull();
    expect(out.ratePer100).toBeNull();
    expect(out.adequacy).toBeNull();
  });

  it('surcharges a heavy loss history through the open-ended band', () => {
    const heavy = submissionOf({
      buildings: [building('B1', { tiv: 1_000_000 })],
      rollup: rollupOf({ fiveYearLoss: 250_000, fiveYearClaimCount: 4 }),
    });
    const out = priceCommercial(EMPTY_VECTOR, EMPTY_SPEC, COMMERCIAL, heavy);
    expect(out.lossHistoryFactor).toBe(1.3);
    expect(out.predictedPremium).toBeCloseTo(5200, 6);
  });

  it('credits a clean loss history at the inclusive zero boundary', () => {
    const clean = submissionOf({
      buildings: [building('B1', { tiv: 1_000_000 })],
      rollup: rollupOf({ fiveYearLoss: 0, fiveYearClaimCount: 0 }),
    });
    const out = priceCommercial(EMPTY_VECTOR, EMPTY_SPEC, COMMERCIAL, clean);
    expect(out.lossHistoryFactor).toBe(0.95);
    expect(out.predictedPremium).toBeCloseTo(3800, 6);
  });
});

/* -------------------------------------------------------------------------- */
/* Expected loss                                                              */
/* -------------------------------------------------------------------------- */

describe('expectedAnnualLoss', () => {
  const peers = (meanAnnualLoss: number | null): PeerResult => ({
    k: 5,
    peers: [],
    medianRatePer100: null,
    meanAnnualLoss,
    coarse: false,
    componentsUsed: [],
  });

  const book = (meanAnnualLoss: number | null): BookStats => ({
    lineOfBusiness: 'commercial_property',
    specVersion: 'test-1',
    n: 27,
    components: [],
    medianRatePer100: 0.4,
    meanAnnualLoss,
    meanClaimFrequency: null,
    meanClaimSeverity: null,
  });

  it('is frequency x severity over the five-year window', () => {
    const detail = expectedAnnualLoss(TWO_BUILDINGS, peers(20_000), book(30_000), 5);
    expect(detail).not.toBeNull();
    expect(detail?.frequency).toBeCloseTo(0.4, 9); // 2 claims / 5 years
    expect(detail?.severity).toBeCloseTo(25_000, 6); // 50,000 / 2 claims
    expect(detail?.ownExpectedLoss).toBeCloseTo(10_000, 6);
    expect(detail?.n).toBe(2);
    expect(detail?.k).toBe(5);
    expect(detail?.credibility).toBeCloseTo(2 / 7, 9); // n / (n + k)
    expect(detail?.peerMeanAnnualLoss).toBe(20_000);
    expect(detail?.bookMeanAnnualLoss).toBe(30_000);
  });

  it('falls back to the book average when the peers carry no loss', () => {
    const detail = expectedAnnualLoss(TWO_BUILDINGS, peers(null), book(30_000), 5);
    expect(detail?.peerMeanAnnualLoss).toBeNull();
    expect(detail?.bookMeanAnnualLoss).toBe(30_000);
    expect(detail?.credibility).toBeCloseTo(2 / 7, 9);
  });

  it('gives own experience full credibility when nothing can complement it', () => {
    const detail = expectedAnnualLoss(TWO_BUILDINGS, null, null, 5);
    expect(detail?.credibility).toBe(1);
    expect(detail?.ownExpectedLoss).toBeCloseTo(10_000, 6);
  });

  it('treats a zero-claim window as known: zero frequency, zero own loss', () => {
    const clean = submissionOf({
      buildings: [building('B1', { tiv: 1_000_000 })],
      rollup: rollupOf({ fiveYearLoss: 0, fiveYearClaimCount: 0 }),
    });
    const detail = expectedAnnualLoss(clean, peers(20_000), null, 5);
    expect(detail?.frequency).toBe(0);
    expect(detail?.severity).toBe(0);
    expect(detail?.ownExpectedLoss).toBe(0);
    expect(detail?.credibility).toBe(0); // 0 / (0 + 5)
  });

  it('is null when the claims were never retrieved', () => {
    const unknown = submissionOf({
      buildings: [building('B1', { tiv: 1_000_000 })],
      rollup: rollupOf({ fiveYearLoss: null }),
    });
    expect(expectedAnnualLoss(unknown, peers(20_000), null, 5)).toBeNull();
    expect(expectedAnnualLoss(submissionOf({}), peers(20_000), null, 5)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* price() — dispatch and the credibility blend                               */
/* -------------------------------------------------------------------------- */

describe('price', () => {
  it('blends own expected loss with the peer mean by n / (n + k)', () => {
    const peers: PeerResult = {
      k: 5,
      peers: [],
      medianRatePer100: 0.4,
      meanAnnualLoss: 20_000,
      coarse: false,
      componentsUsed: [],
    };
    const out = price(EMPTY_VECTOR, EMPTY_SPEC, COMMERCIAL, TWO_BUILDINGS, null, peers);

    // (2/7) * 10,000 + (5/7) * 20,000 = 120,000 / 7
    expect(out.expectedAnnualLoss).toBeCloseTo(120_000 / 7, 6);
    expect(out.expectedLossDetail?.credibility).toBeCloseTo(2 / 7, 9);
    expect(out.predictedPremium).toBeCloseTo(13_114.8, 6);
  });

  it('falls back to own experience when there is no peer or book complement', () => {
    const out = price(EMPTY_VECTOR, EMPTY_SPEC, COMMERCIAL, TWO_BUILDINGS, null, null);
    expect(out.expectedAnnualLoss).toBeCloseTo(10_000, 6);
  });

  it('dispatches tenant tables to the tenant rating path', () => {
    const out = price(
      tenantVector({ contentsLimit: 15_000, buildingYearBuilt: 1975, termMonths: 12 }),
      TENANT_SPEC,
      TENANT,
      submissionOf({}),
      null,
      null,
    );
    expect(out.lineOfBusiness).toBe('tenant');
    expect(out.estimate).toBe(true);
    expect(out.expectedAnnualLoss).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Tenant                                                                     */
/* -------------------------------------------------------------------------- */

describe('priceTenant', () => {
  const full = tenantVector({
    hazardPortableHeater: 1,
    hazardCandle: 1,
    hazardBlockedExit: 0,
    smokeDetectorCount: 1,
    buildingYearBuilt: 1975,
    contentsLimit: 15_000,
    termMonths: 12,
  });

  // 12 x 1.30 contents x 1.20 pre-1990 x 1.15 heater x 1.10 candle x 0.90 smoke x 1.00 term
  const MONTHLY = 21.31272;

  it('multiplies the monthly base rate by every applied factor', () => {
    const out = priceTenant(full, TENANT_SPEC, TENANT);
    expect(out.predictedMonthlyPremium).toBeCloseTo(MONTHLY, 6);
    expect(out.predictedPremium).toBeCloseTo(MONTHLY * 12, 6);
    expect(out.termMonths).toBe(12);
    expect(out.basis).toBe('table');
    expect(out.estimate).toBe(true);
    expect(out.perBuilding).toEqual([]);
    expect(out.ratePer100).toBeNull();
    expect(out.expectedAnnualLoss).toBeNull();
  });

  it('names each factor so the saving is a subtraction the user can check', () => {
    const out = priceTenant(full, TENANT_SPEC, TENANT);
    expect(out.factors.map((f) => f.name)).toEqual([
      'contents',
      'buildingAge',
      'hazard.portableHeater',
      'hazard.candle',
      'smokeDetector',
      'term',
    ]);

    const withoutHeater = priceTenant(
      tenantVector({
        hazardPortableHeater: 0,
        hazardCandle: 1,
        smokeDetectorCount: 1,
        buildingYearBuilt: 1975,
        contentsLimit: 15_000,
        termMonths: 12,
      }),
      TENANT_SPEC,
      TENANT,
    );
    expect(withoutHeater.predictedMonthlyPremium).toBeCloseTo(MONTHLY / 1.15, 6);
    const saving =
      (out.predictedMonthlyPremium ?? 0) - (withoutHeater.predictedMonthlyPremium ?? 0);
    expect(saving).toBeCloseTo(2.779_92, 6);
  });

  it('charges the absent-smoke-detector factor and the short-term factor', () => {
    const out = priceTenant(
      tenantVector({
        smokeDetectorCount: 0,
        buildingYearBuilt: 2015,
        contentsLimit: 5_000,
        termMonths: 4,
      }),
      TENANT_SPEC,
      TENANT,
    );
    // 12 x 1.00 contents x 1.00 modern x 1.20 no-detector x 1.10 four-month term
    expect(out.predictedMonthlyPremium).toBeCloseTo(15.84, 6);
  });

  it('drops unknown inputs to a neutral factor', () => {
    const out = priceTenant(tenantVector({}), TENANT_SPEC, TENANT);
    expect(out.factors.map((f) => f.factor)).toEqual([1, 1, 1]);
    expect(out.predictedMonthlyPremium).toBeCloseTo(12, 6);
    expect(out.termMonths).toBeNull();
  });
});
