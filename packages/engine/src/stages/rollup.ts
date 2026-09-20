/** Stage 3 — rollup. Body owned by Run 1 unit E03. */
import type {
  BuildingFacts,
  CanonicalSubmission,
  ConstructionShare,
  Field,
  LocationFacts,
  Rollup,
  Sourced,
  StateShare,
} from '../types.js';
import {
  ACCEPTABLE_CONSTRUCTION,
  ASSUMED_ACCEPTABLE_CONSTRUCTION,
  LOSS_WINDOW_YEARS,
  YEAR_POST_CUTOFF,
  YEAR_PRE_CUTOFF,
} from '../constants.js';
import { bestValue } from '../util/fields.js';
import { isFiniteNumber, safeDiv, sum } from '../util/math.js';

/* -------------------------------------------------------------------------- */
/* Private helpers (HELPERS.md: no new shared helpers)                        */
/* -------------------------------------------------------------------------- */

/**
 * `bestValue` (E01) with a local fallback for the window in which E01 is still
 * a stub. The fallback implements the ordering documented on `bestValue`:
 * highest confidence, then enrichment > answer > sweep > self_reported, then
 * the latest `observedAt`, then insertion order.
 * TODO(contract): drop the fallback once E01 lands.
 */
const SOURCE_RANK: Readonly<Record<string, number>> = {
  enrichment: 3,
  answer: 2,
  sweep: 1,
  self_reported: 0,
};

const TABLE_CONFIDENCE: Readonly<Record<string, number>> = {
  self_reported: 0.7,
  enrichment: 0.9,
  answer: 0.8,
  sweep: 0.5,
};

function fallbackBest<T>(field: Sourced<T> | undefined): Field<T> | null {
  if (field === undefined || field.length === 0) return null;
  let best: Field<T> | null = null;
  for (const candidate of field) {
    if (best === null) {
      best = candidate;
      continue;
    }
    const cc = candidate.provenance.confidence ?? TABLE_CONFIDENCE[candidate.provenance.source] ?? 0;
    const bc = best.provenance.confidence ?? TABLE_CONFIDENCE[best.provenance.source] ?? 0;
    if (cc !== bc) {
      if (cc > bc) best = candidate;
      continue;
    }
    const cr = SOURCE_RANK[candidate.provenance.source] ?? -1;
    const br = SOURCE_RANK[best.provenance.source] ?? -1;
    if (cr !== br) {
      if (cr > br) best = candidate;
      continue;
    }
    const co = candidate.provenance.observedAt ?? '';
    const bo = best.provenance.observedAt ?? '';
    if (co > bo) best = candidate;
  }
  return best;
}

function pick<T>(field: Sourced<T> | undefined): T | null {
  let chosen: Field<T> | null;
  try {
    chosen = bestValue(field);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('NOT_IMPLEMENTED')) {
      chosen = fallbackBest(field);
    } else {
      throw err;
    }
  }
  return chosen === null ? null : chosen.value;
}

function pickNumber(field: Sourced<number> | undefined): number | null {
  const v = pick(field);
  return isFiniteNumber(v) ? v : null;
}

/** Whole positive integer years only; anything else is "unknown". */
function pickYear(field: Sourced<number> | undefined): number | null {
  const v = pickNumber(field);
  if (v === null) return null;
  if (!Number.isInteger(v) || v <= 0) return null;
  return v;
}

/** G-8: lower snake_case, every run of non-alphanumerics becoming one `_`. */
function normalizeClass(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s;
}

/**
 * The live data spells the steel class "Steel Frame" (LIVE_DATA_FACTS: 9
 * buildings, appetite "acceptable"), which normalizes to `steel_frame` and
 * would otherwise miss `ACCEPTABLE_CONSTRUCTION`'s `steel`. Alias table is
 * private to this file; see docs/decisions/E03.md.
 */
const CLASS_ALIASES: Readonly<Record<string, string>> = {
  steel_frame: 'steel',
  jm: 'joisted_masonry',
  noncombustible: 'non_combustible',
  masonry_noncombustible: 'masonry_non_combustible',
};

function canonicalClass(raw: string): string {
  const n = normalizeClass(raw);
  return CLASS_ALIASES[n] ?? n;
}

const UNKNOWN_CLASS = 'unknown';

function normalizeState(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : null;
}

/** ISO date (YYYY-MM-DD) parts, or null when unparsable. */
function isoParts(raw: string | null): { y: number; m: number; d: number } | null {
  if (raw === null) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim());
  if (m === null) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

function isoOf(y: number, m: number, d: number): string {
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** I-4: same calendar date five years earlier; Feb 29 → Feb 28 in a non-leap year. */
function minusYears(p: { y: number; m: number; d: number }, years: number): string {
  const y = p.y - years;
  const d = p.m === 2 && p.d === 29 && !isLeap(y) ? 28 : p.d;
  return isoOf(y, p.m, d);
}

/** Buildings are attributed to their location's state. */
function stateOf(
  building: BuildingFacts,
  byId: ReadonlyMap<string, LocationFacts>,
  onlyLocation: LocationFacts | null,
): string | null {
  const loc =
    building.locationExternalId !== undefined
      ? (byId.get(building.locationExternalId) ?? null)
      : onlyLocation;
  if (loc === null) return null;
  const raw = pick(loc.state);
  return typeof raw === 'string' ? normalizeState(raw) : null;
}

interface BuildingRow {
  readonly id: string;
  readonly tiv: number | null;
  readonly yearBuilt: number | null;
  readonly constructionType: string | null;
  readonly sprinklered: boolean | null;
  readonly protectionClass: number | null;
  readonly state: string | null;
}

/* -------------------------------------------------------------------------- */
/* Stage 3                                                                    */
/* -------------------------------------------------------------------------- */

/** True when a raw row holds an expanded claims list: an array of claim objects, or empty. */
function claimsListExpanded(data: unknown): boolean {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return false;
  const claims = (data as Readonly<Record<string, unknown>>)['claims'];
  return (
    Array.isArray(claims) &&
    claims.every((c) => typeof c === 'object' && c !== null && !Array.isArray(c))
  );
}

/**
 * A FEMA National Flood Hazard Layer zone code as the ordinal the extension
 * rulebook and the rating table read. Pure string classification: the codes are
 * FEMA's published zone designations, and anything unrecognised is treated as
 * outside the mapped hazard rather than guessed at, because a zone we cannot
 * read must never silently penalise an account.
 *
 *  - 2: V, VE — coastal Special Flood Hazard Area with wave action.
 *  - 1: A, AE, AO, AH, AR, A99 — SFHA without a wave hazard.
 *  - 0: X, X500, D and anything else — outside the mapped hazard.
 */
export function floodZoneTier(zone: string): number {
  const code = zone.trim().toUpperCase();
  if (code === 'V' || code === 'VE') return 2;
  if (code === 'A' || code === 'AE' || code === 'AO' || code === 'AH' || code === 'AR' || code === 'A99') {
    return 1;
  }
  return 0;
}

/**
 * `asOf` is an ISO-8601 date. The five-year loss window is
 * (asOf - 5 years, asOf], inclusive of both endpoints as pinned in
 * INTERPRETATIONS.md I-4. The engine never reads the clock.
 */
export function rollup(submission: CanonicalSubmission, asOf: string): Rollup {
  const byId = new Map<string, LocationFacts>();
  for (const loc of submission.locations) byId.set(loc.externalId, loc);
  const onlyLocation = submission.locations.length === 1 ? (submission.locations[0] ?? null) : null;

  const rows: BuildingRow[] = submission.buildings.map((b): BuildingRow => {
    const construction = pick(b.constructionType);
    const sprinklered = pick(b.sprinklered);
    const locationPc =
      b.locationExternalId !== undefined
        ? (byId.get(b.locationExternalId) ?? onlyLocation)
        : onlyLocation;
    const pc = pickNumber(b.protectionClass) ?? pickNumber(locationPc?.protectionClass);
    const tiv = pickNumber(b.tiv);
    return {
      id: b.externalId,
      tiv: tiv !== null && tiv >= 0 ? tiv : null,
      yearBuilt: pickYear(b.yearBuilt),
      constructionType: typeof construction === 'string' ? construction : null,
      sprinklered: typeof sprinklered === 'boolean' ? sprinklered : null,
      protectionClass: pc,
      state: stateOf(b, byId, onlyLocation),
    };
  });

  const tivKnown = rows.filter((r) => r.tiv !== null);
  const totalTiv = tivKnown.length === 0 ? null : sum(tivKnown.map((r) => r.tiv));

  /* ---- building age (components 5 and 6) -------------------------------- */

  const aged = tivKnown.filter((r) => r.yearBuilt !== null);
  const agedTiv = sum(aged.map((r) => r.tiv));
  const pctTivPre1990 =
    aged.length === 0
      ? null
      : (safeDiv(
          sum(aged.filter((r) => (r.yearBuilt as number) < YEAR_PRE_CUTOFF).map((r) => r.tiv)),
          agedTiv,
        ) ?? 0);
  const pctTivPost2010 =
    aged.length === 0
      ? null
      : (safeDiv(
          sum(aged.filter((r) => (r.yearBuilt as number) >= YEAR_POST_CUTOFF).map((r) => r.tiv)),
          agedTiv,
        ) ?? 0);

  // R-AGE-REFER: every building with a known yearBuilt < 1990, whatever its TIV.
  const pre1990BuildingIds = rows
    .filter((r) => r.yearBuilt !== null && r.yearBuilt < YEAR_PRE_CUTOFF)
    .map((r) => r.id);

  const years = rows.map((r) => r.yearBuilt).filter((y): y is number => y !== null);
  const oldestYearBuilt = years.length === 0 ? null : Math.min(...years);
  const newestYearBuilt = years.length === 0 ? null : Math.max(...years);

  /* ---- construction (component 7) --------------------------------------- */

  const knownTivTotal = totalTiv ?? 0;
  const classTiv = new Map<string, number>();
  for (const r of tivKnown) {
    const key = r.constructionType === null ? UNKNOWN_CLASS : canonicalClass(r.constructionType);
    classTiv.set(key === '' ? UNKNOWN_CLASS : key, (classTiv.get(key) ?? 0) + (r.tiv as number));
  }
  const pctTivByConstruction: ConstructionShare[] = [...classTiv.entries()]
    .map(([constructionType, tiv]): ConstructionShare => {
      const assumedAcceptable = ASSUMED_ACCEPTABLE_CONSTRUCTION.includes(constructionType);
      return {
        constructionType,
        tiv,
        share: safeDiv(tiv, knownTivTotal) ?? 0,
        acceptable: ACCEPTABLE_CONSTRUCTION.includes(constructionType) || assumedAcceptable,
        assumedAcceptable,
      };
    })
    .sort((a, b) =>
      a.share !== b.share
        ? b.share - a.share
        : a.constructionType.localeCompare(b.constructionType),
    );
  const pctTivAcceptableConstruction =
    tivKnown.length === 0
      ? null
      : (safeDiv(
          sum(pctTivByConstruction.filter((c) => c.acceptable).map((c) => c.tiv)),
          knownTivTotal,
        ) ?? 0);

  /* ---- sprinklers (component 9) ----------------------------------------- */

  // Mirrors construction: the denominator is every known-TIV building and an
  // unknown value counts as "not sprinklered" — but the component is missing
  // when no known-TIV building states it at all.
  const pctTivSprinklered =
    tivKnown.length === 0 || tivKnown.every((r) => r.sprinklered === null)
      ? null
      : (safeDiv(
          sum(tivKnown.filter((r) => r.sprinklered === true).map((r) => r.tiv)),
          knownTivTotal,
        ) ?? 0);

  /* ---- protection class (component 10) ---------------------------------- */

  const pcRows = tivKnown.filter((r) => r.protectionClass !== null);
  const pcWeight = sum(pcRows.map((r) => r.tiv));
  const tivWeightedProtectionClass =
    pcRows.length === 0
      ? null
      : pcWeight > 0
        ? safeDiv(
            sum(pcRows.map((r) => (r.tiv as number) * (r.protectionClass as number))),
            pcWeight,
          )
        : (safeDiv(
            sum(pcRows.map((r) => r.protectionClass)),
            pcRows.length,
          ) ?? null);

  /* ---- flood zone (component 11) ---------------------------------------- */

  // The worst zone across every location that states one, not a TIV-weighted
  // mean: one building inside a Special Flood Hazard Area is the exposure, and
  // averaging it against dry buildings would report the account as safer than
  // it is. Locations rather than buildings, because that is where the FEMA
  // enrichment writes and where latitude and longitude live.
  const floodTiers = submission.locations
    .map((loc) => pick(loc.floodZone))
    .filter((zone): zone is string => typeof zone === 'string' && zone.trim() !== '')
    .map((zone) => floodZoneTier(zone));
  const worstFloodZoneTier = floodTiers.length === 0 ? null : Math.max(...floodTiers);

  /* ---- primary state (I-1) ---------------------------------------------- */

  const stateTiv = new Map<string, number>();
  for (const r of tivKnown) {
    if (r.state === null) continue;
    stateTiv.set(r.state, (stateTiv.get(r.state) ?? 0) + (r.tiv as number));
  }
  const statedTotal = sum([...stateTiv.values()]);
  const stateShares: StateShare[] = [...stateTiv.entries()]
    .map(([state, tiv]): StateShare => ({ state, tiv, share: safeDiv(tiv, statedTotal) ?? 0 }))
    .sort((a, b) => (a.tiv !== b.tiv ? b.tiv - a.tiv : a.state.localeCompare(b.state)));
  const primaryState = stateShares.length === 0 ? null : (stateShares[0] as StateShare).state;

  /* ---- five-year loss (I-4) --------------------------------------------- */

  const receivedRaw = pick(submission.receivedDate);
  const windowToParts =
    isoParts(typeof receivedRaw === 'string' ? receivedRaw : null) ?? isoParts(asOf);
  const lossWindow =
    windowToParts === null
      ? null
      : {
          from: minusYears(windowToParts, LOSS_WINDOW_YEARS),
          to: isoOf(windowToParts.y, windowToParts.m, windowToParts.d),
        };

  const claimCount = submission.history.length;
  let fiveYearClaimCount = 0;
  let windowTotal = 0;
  if (lossWindow !== null) {
    for (const claim of submission.history) {
      const dolRaw = pick(claim.dateOfLoss);
      const dol = isoParts(typeof dolRaw === 'string' ? dolRaw : null);
      if (dol === null) continue;
      const iso = isoOf(dol.y, dol.m, dol.d);
      if (iso < lossWindow.from || iso > lossWindow.to) continue;
      fiveYearClaimCount += 1;
      windowTotal +=
        (pickNumber(claim.paidIndemnity) ?? 0) +
        (pickNumber(claim.paidExpense) ?? 0) +
        (pickNumber(claim.reserves) ?? 0);
    }
  }

  // I-4: zero claims in the window is a KNOWN 0, unless the claims list was
  // never fetched — which is only observable through the raw bundle. A
  // records.Claim key marks it fetched (W0-2.8); so does a raw row carrying an
  // expanded claims list (empty, or claim objects), which is how the deep
  // pass returns claims embedded in the Policy row. Bare claim ids do not count.
  const claimsNeverFetched =
    claimCount === 0 &&
    submission.raw !== undefined &&
    !Object.prototype.hasOwnProperty.call(submission.raw.records, 'Claim') &&
    !Object.values(submission.raw.records).some((rows) =>
      rows.some((row) => claimsListExpanded(row.data)),
    );
  const fiveYearLoss = claimsNeverFetched || lossWindow === null ? null : windowTotal;

  return {
    totalTiv,
    buildingCount: rows.length,
    tivKnownBuildingCount: tivKnown.length,
    pctTivPre1990,
    pctTivPost2010,
    pctTivByConstruction,
    pctTivAcceptableConstruction,
    pctTivSprinklered,
    tivWeightedProtectionClass,
    worstFloodZoneTier,
    primaryState,
    stateShares,
    fiveYearLoss,
    fiveYearClaimCount,
    claimCount,
    pre1990BuildingIds,
    oldestYearBuilt,
    newestYearBuilt,
    lossWindow,
  };
}
