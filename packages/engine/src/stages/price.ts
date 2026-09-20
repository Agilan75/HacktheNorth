/** Stage 8 — price. Body owned by Run 1 unit E07. */
import type {
  AppliedFactor,
  BookStats,
  BuildingFacts,
  BuildingPremium,
  CanonicalSubmission,
  CommercialRatingTable,
  ExpectedLossDetail,
  FeatureVector,
  PeerResult,
  PriceBreakdown,
  RatingBand,
  RatingTable,
  Sourced,
  TenantRatingTable,
  VectorSpec,
} from '../types.js';
import { CREDIBILITY_K, LOSS_WINDOW_YEARS } from '../constants.js';
import { bestValue } from '../util/fields.js';
import { isFiniteNumber, safeDiv, sum } from '../util/math.js';

/* -------------------------------------------------------------------------- */
/* Private helpers (HELPERS.md: no new shared helpers, nothing exported)      */
/* -------------------------------------------------------------------------- */

const NEUTRAL_FACTOR = 1;
const UNKNOWN_INPUT = 'unknown';
const MONTHS_PER_YEAR = 12;

function pick<T>(field: Sourced<T> | undefined): T | null {
  const best = bestValue(field);
  return best === null ? null : best.value;
}

function pickNumber(field: Sourced<number> | undefined): number | null {
  const v = pick(field);
  return isFiniteNumber(v) ? v : null;
}

/** Lower snake_case, every run of non-alphanumerics becoming one `_`. */
function normalizeKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * `RatingBand` lookup: the first band whose inclusive `upTo` is >= x, or the
 * open-ended band (`upTo === null`). Null `x`, or no band matching, yields the
 * neutral factor so a missing input never invents a surcharge or a discount.
 */
function band(
  bands: readonly RatingBand[] | undefined,
  x: number | null,
): { key: string; factor: number } | null {
  if (bands === undefined || bands.length === 0 || x === null || !isFiniteNumber(x)) return null;
  for (const b of bands) {
    if (b.upTo === null || x <= b.upTo) {
      return isFiniteNumber(b.factor) ? { key: b.key, factor: b.factor } : null;
    }
  }
  return null;
}

function applied(name: string, input: string, factor: number | null): AppliedFactor {
  return { name, input, factor: factor === null ? NEUTRAL_FACTOR : factor };
}

/** Exact key first, then the normalized spelling (`Steel Frame` → `steel_frame`). */
function lookupClass(
  map: Readonly<Record<string, number>> | undefined,
  raw: string | null,
): number | null {
  if (map === undefined || raw === null) return null;
  const direct = map[raw];
  if (isFiniteNumber(direct)) return direct;
  const wanted = normalizeKey(raw);
  for (const [key, value] of Object.entries(map)) {
    if (normalizeKey(key) === wanted && isFiniteNumber(value)) return value;
  }
  return null;
}

function componentIndex(spec: VectorSpec, key: string): number {
  return spec.components.findIndex((c) => c.key === key);
}

function componentValue(vector: FeatureVector, spec: VectorSpec, key: string): number | null {
  const i = componentIndex(spec, key);
  if (i < 0 || vector.m[i] !== 1) return null;
  const v = vector.x[i];
  return isFiniteNumber(v) ? v : null;
}

/** `hazardPortableHeater` (vector component) → `portableHeater` (rating key). */
function hazardKeyOf(componentKey: string): string | null {
  if (!componentKey.startsWith('hazard') || componentKey.length <= 'hazard'.length) return null;
  const rest = componentKey.slice('hazard'.length);
  return rest.charAt(0).toLowerCase() + rest.slice(1);
}

/** The protection class the building rates on: its own, else its location's. */
function protectionClassOf(
  submission: CanonicalSubmission,
  building: BuildingFacts,
): number | null {
  const own = pickNumber(building.protectionClass);
  if (own !== null) return own;
  const locationId = building.locationExternalId;
  if (locationId === undefined) return null;
  const location = submission.locations.find((l) => l.externalId === locationId);
  if (location === undefined) return null;
  return pickNumber(location.protectionClass);
}

function money(v: number | null): number | null {
  return v === null || !isFiniteNumber(v) ? null : v;
}

/* -------------------------------------------------------------------------- */
/* Commercial (PRD 6.7)                                                       */
/* -------------------------------------------------------------------------- */

export function price(
  _vector: FeatureVector,
  _spec: VectorSpec,
  _table: RatingTable,
  _submission: CanonicalSubmission,
  _bookStats: BookStats | null,
  _peers: PeerResult | null,
): PriceBreakdown {
  if (_table.lineOfBusiness === 'tenant') {
    return priceTenant(_vector, _spec, _table);
  }

  const base = priceCommercial(_vector, _spec, _table, _submission);
  const k = isFiniteNumber(_table.credibilityK) ? _table.credibilityK : CREDIBILITY_K;
  const detail = expectedAnnualLoss(_submission, _peers, _bookStats, k);
  if (detail === null) return base;

  const complement = detail.peerMeanAnnualLoss ?? detail.bookMeanAnnualLoss;
  const blended =
    complement === null
      ? detail.ownExpectedLoss
      : detail.credibility * detail.ownExpectedLoss + (1 - detail.credibility) * complement;

  return { ...base, expectedAnnualLoss: blended, expectedLossDetail: detail };
}

export function priceCommercial(
  _vector: FeatureVector,
  _spec: VectorSpec,
  _table: CommercialRatingTable,
  _submission: CanonicalSubmission,
): PriceBreakdown {
  const baseRate = isFiniteNumber(_table.baseRate) ? _table.baseRate : 0;
  const perBuilding: BuildingPremium[] = [];
  let knownTiv = 0;

  for (const building of _submission.buildings) {
    const tiv = pickNumber(building.tiv);
    if (tiv === null || tiv <= 0) continue;
    knownTiv += tiv;

    const constructionType = pick(building.constructionType);
    const constructionFactor = lookupClass(_table.construction, constructionType);
    const yearBuilt = pickNumber(building.yearBuilt);
    const ageBand = band(_table.age, yearBuilt);
    const protectionClass = protectionClassOf(_submission, building);
    const protectionBand = band(_table.protectionClass, protectionClass);
    const sprinklered = pick(building.sprinklered);
    const sprinklerFactor =
      sprinklered === null
        ? null
        : sprinklered
          ? _table.sprinkler?.sprinklered
          : _table.sprinkler?.unsprinklered;

    const factors: AppliedFactor[] = [
      applied('construction', constructionType ?? UNKNOWN_INPUT, constructionFactor),
      applied(
        'age',
        yearBuilt === null ? UNKNOWN_INPUT : `built ${String(yearBuilt)}`,
        ageBand === null ? null : ageBand.factor,
      ),
      applied(
        'protectionClass',
        protectionClass === null ? UNKNOWN_INPUT : `class ${String(protectionClass)}`,
        protectionBand === null ? null : protectionBand.factor,
      ),
      applied(
        'sprinkler',
        sprinklered === null ? UNKNOWN_INPUT : sprinklered ? 'sprinklered' : 'unsprinklered',
        isFiniteNumber(sprinklerFactor) ? sprinklerFactor : null,
      ),
    ];

    let premium = (tiv / 100) * baseRate;
    for (const f of factors) premium *= f.factor;

    perBuilding.push({
      buildingExternalId: building.externalId,
      tiv,
      baseRate,
      factors,
      premium,
    });
  }

  const fiveYearLoss = _submission.rollup?.fiveYearLoss ?? null;
  const lossBand = band(_table.lossHistory, fiveYearLoss);
  const lossHistoryFactor = lossBand === null ? null : lossBand.factor;
  const lossFactor: AppliedFactor = applied(
    'lossHistory',
    fiveYearLoss === null ? UNKNOWN_INPUT : `$${String(fiveYearLoss)} five-year loss`,
    lossHistoryFactor,
  );

  /*
   * Flood, once per account rather than per building, because the rollup takes
   * the worst zone across the account's locations. This is the one factor fed
   * by external enrichment (the OpenFEMA hazard layer), so an account whose
   * enrichment has not run has a null tier and is charged nothing for flood —
   * it prices exactly as it did before flood existed.
   */
  const floodTier = _submission.rollup?.worstFloodZoneTier ?? null;
  const floodFactor: AppliedFactor = applied(
    'flood',
    floodTier === null
      ? UNKNOWN_INPUT
      : floodTier >= 2
        ? 'coastal V zone'
        : floodTier >= 1
          ? 'FEMA special flood hazard area'
          : 'outside the mapped flood hazard',
    floodTier === null
      ? null
      : floodTier >= 2
        ? (_table.flood?.coastal ?? null)
        : floodTier >= 1
          ? (_table.flood?.sfha ?? null)
          : (_table.flood?.minimal ?? null),
  );

  const subtotal = sum(perBuilding.map((b) => b.premium));
  const predictedPremium =
    perBuilding.length === 0 ? null : money(subtotal * lossFactor.factor * floodFactor.factor);

  const quotedPremium = pickNumber(_submission.pricing.quotedPremium);
  const fitError = _table.fitError ?? null;

  return {
    lineOfBusiness: 'commercial_property',
    currency: 'USD',
    predictedPremium,
    predictedMonthlyPremium: null,
    termMonths: null,
    perBuilding,
    factors: [lossFactor, floodFactor],
    lossHistoryFactor,
    expectedAnnualLoss: null,
    expectedLossDetail: null,
    quotedPremium,
    adequacy: safeDiv(quotedPremium, predictedPremium),
    ratePer100: predictedPremium === null ? null : safeDiv(predictedPremium, knownTiv / 100),
    basis: fitError === null ? 'table' : 'fitted',
    fitError,
    estimate: fitError === null,
  };
}

/* -------------------------------------------------------------------------- */
/* Tenant (PRD 6.7 — a rating table, always labelled "estimate")              */
/* -------------------------------------------------------------------------- */

export function priceTenant(
  _vector: FeatureVector,
  _spec: VectorSpec,
  _table: TenantRatingTable,
): PriceBreakdown {
  const baseMonthlyRate = isFiniteNumber(_table.baseMonthlyRate) ? _table.baseMonthlyRate : 0;
  const factors: AppliedFactor[] = [];

  const contentsLimit = componentValue(_vector, _spec, 'contentsLimit');
  const contentsBand = band(_table.contents, contentsLimit);
  factors.push(
    applied(
      'contents',
      contentsLimit === null ? UNKNOWN_INPUT : `$${String(contentsLimit)} contents`,
      contentsBand === null ? null : contentsBand.factor,
    ),
  );

  const yearBuilt = componentValue(_vector, _spec, 'buildingYearBuilt');
  const ageBand = band(_table.buildingAge, yearBuilt);
  factors.push(
    applied(
      'buildingAge',
      yearBuilt === null ? UNKNOWN_INPUT : `built ${String(yearBuilt)}`,
      ageBand === null ? null : ageBand.factor,
    ),
  );

  // Hazards, in spec component order so the breakdown is deterministic.
  for (const component of _spec.components) {
    const hazardKey = hazardKeyOf(component.key);
    if (hazardKey === null) continue;
    const factor = _table.hazards?.[hazardKey];
    if (!isFiniteNumber(factor)) continue;
    const value = componentValue(_vector, _spec, component.key);
    if (value === null || value < 1) continue;
    factors.push(applied(`hazard.${hazardKey}`, 'present', factor));
  }

  const smokeDetectorCount = componentValue(_vector, _spec, 'smokeDetectorCount');
  if (smokeDetectorCount !== null) {
    const present = smokeDetectorCount >= 1;
    const factor = present ? _table.smokeDetector?.present : _table.smokeDetector?.absent;
    factors.push(
      applied(
        'smokeDetector',
        present ? `${String(smokeDetectorCount)} present` : 'absent',
        isFiniteNumber(factor) ? factor : null,
      ),
    );
  }

  const termMonths = componentValue(_vector, _spec, 'termMonths');
  const termFactor = termMonths === null ? undefined : _table.term?.[String(termMonths)];
  factors.push(
    applied(
      'term',
      termMonths === null ? UNKNOWN_INPUT : `${String(termMonths)} months`,
      isFiniteNumber(termFactor) ? termFactor : null,
    ),
  );

  let monthly = baseMonthlyRate;
  for (const f of factors) monthly *= f.factor;

  return {
    lineOfBusiness: 'tenant',
    currency: 'USD',
    predictedPremium: money(monthly * MONTHS_PER_YEAR),
    predictedMonthlyPremium: money(monthly),
    termMonths,
    perBuilding: [],
    factors,
    lossHistoryFactor: null,
    expectedAnnualLoss: null,
    expectedLossDetail: null,
    quotedPremium: null,
    adequacy: null,
    ratePer100: null,
    basis: 'table',
    fitError: null,
    estimate: true,
  };
}

/* -------------------------------------------------------------------------- */
/* Expected annual loss (PRD 6.7)                                             */
/* -------------------------------------------------------------------------- */

/** Own frequency x severity blended with peers by n / (n + k). */
export function expectedAnnualLoss(
  _submission: CanonicalSubmission,
  _peers: PeerResult | null,
  _bookStats: BookStats | null,
  _credibilityK: number,
): ExpectedLossDetail | null {
  const rollup = _submission.rollup;
  if (rollup === undefined) return null;
  const fiveYearLoss = rollup.fiveYearLoss;
  // A null five-year loss means the claims were never retrieved (I-4): there is
  // no own experience to blend, so there is no expected loss.
  if (fiveYearLoss === null || !isFiniteNumber(fiveYearLoss)) return null;

  const n = isFiniteNumber(rollup.fiveYearClaimCount) ? Math.max(0, rollup.fiveYearClaimCount) : 0;
  const frequency = n / LOSS_WINDOW_YEARS;
  const severity = n === 0 ? 0 : fiveYearLoss / n;
  const ownExpectedLoss = frequency * severity;

  const peerMeanAnnualLoss = isFiniteNumber(_peers?.meanAnnualLoss) ? _peers.meanAnnualLoss : null;
  const bookMeanAnnualLoss = isFiniteNumber(_bookStats?.meanAnnualLoss)
    ? _bookStats.meanAnnualLoss
    : null;
  const complement = peerMeanAnnualLoss ?? bookMeanAnnualLoss;

  const k = isFiniteNumber(_credibilityK) && _credibilityK >= 0 ? _credibilityK : CREDIBILITY_K;
  // With no complement there is nothing to blend toward, so own experience
  // carries full credibility (docs/decisions/E07.md).
  const credibility = complement === null ? 1 : n + k === 0 ? 1 : n / (n + k);

  return {
    frequency,
    severity,
    ownExpectedLoss,
    peerMeanAnnualLoss,
    bookMeanAnnualLoss,
    credibility,
    k,
    n,
  };
}
