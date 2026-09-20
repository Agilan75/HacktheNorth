/**
 * Monotonic least-squares fitting for the commercial rating table.
 * Body owned by Run 1 unit E15. Pure: no I/O, no Date.now, no Math.random.
 *
 * PRD 6.7 — factors are fitted once against `technical_premium`, constrained so
 * that a worse class is never cheaper, then frozen into `rating/commercial.json`.
 * The engine only ever reads the frozen file; nothing calls this at runtime.
 *
 * Model (log space, per building row):
 *   log(technicalPremium / (tiv / 100)) =
 *     log baseRate + log construction + log age + log protectionClass
 *     + log sprinkler + log lossHistory + noise
 * An unknown input (construction class not in the order, non-finite year,
 * null protection class, null sprinkler, non-finite five-year loss) takes the
 * neutral factor 1, exactly as `priceCommercial` does at runtime.
 *
 * Solved by block coordinate descent: each family's block is a separable
 * weighted quadratic (the data plus a ridge pull toward the family's prior,
 * docs/decisions/E15.md D-3), so its exact constrained minimizer is the
 * weighted isotonic regression of the per-level unconstrained minimizers.
 */
import type { CommercialRatingTable, FitError, RatingBand } from '../types.js';
import { CREDIBILITY_K } from '../constants.js';
import { isFiniteNumber, poolAdjacentViolators } from '../util/math.js';
import { priorFactors } from './priors.js';

/** One fitted observation: the raw feature row plus the premium to fit against. */
export interface FitRow {
  readonly tiv: number;
  readonly constructionClass: string;
  readonly yearBuilt: number;
  readonly protectionClass: number | null;
  readonly sprinklered: boolean | null;
  readonly fiveYearLoss: number;
  readonly technicalPremium: number;
}

export interface FitOptions {
  /** Ordered worst-to-best; the fit forces factors to be non-increasing along it. */
  readonly monotonicOrder: Readonly<Record<string, readonly string[]>>;
  readonly maxIterations: number;
  readonly tolerance: number;
}

/* -------------------------------------------------------------------------- */
/* Private structure of the commercial table                                  */
/* -------------------------------------------------------------------------- */

/** The version stamped on a fitted table. */
const FITTED_VERSION = '1.0.0-fit';
/** PRD 6.7: median real rate is $0.40 per $100 of TIV. Used when nothing is fitted. */
const PRIOR_BASE_RATE = 0.4;
/**
 * Ridge pseudo-weight toward the prior, in units of "average rows" (row weights
 * are normalized to mean 1). A level with no rows sits exactly on its prior.
 */
const PRIOR_PSEUDO_ROWS = 2;
/** Factors are rounded to this many decimals in the frozen table. */
const FACTOR_DIGITS = 4;

/**
 * The flood load. **Not fitted, and deliberately not a family above.**
 *
 * Only three of the 27 real policies have a location inside a Special Flood
 * Hazard Area, which is far too few to fit a factor from; a number fitted on
 * three observations would carry a precision it has not earned. So these are a
 * stated judgement, written here so `rating:fit` still reproduces the packaged
 * table byte for byte, and `minimal` is pinned at exactly 1 — an account
 * outside the mapped hazard, or one whose flood enrichment never ran, prices
 * precisely as it did before flood existed, and the fitted MAPE still
 * describes it.
 */
const FLOOD_LOAD = { minimal: 1, sfha: 1.15, coastal: 1.35 } as const;

type FamilyName = 'construction' | 'age' | 'protectionClass' | 'sprinkler' | 'lossHistory';
const FAMILIES: readonly FamilyName[] = [
  'construction',
  'age',
  'protectionClass',
  'sprinkler',
  'lossHistory',
];

/**
 * Band upper bounds (inclusive, `null` = open band) keyed by the level keys
 * that `commercialPriors()` orders. Kept private here; the test asserts the two
 * agree.
 */
const AGE_UPTO: Readonly<Record<string, number | null>> = {
  built_pre_1950: 1949,
  built_1950_1969: 1969,
  built_1970_1989: 1989,
  built_1990_2009: 2009,
  built_2010_plus: null,
};
const PROTECTION_UPTO: Readonly<Record<string, number | null>> = {
  pc_1_3: 3,
  pc_4_6: 6,
  pc_7_8: 8,
  pc_9: 9,
  pc_10: null,
};
const LOSS_UPTO: Readonly<Record<string, number | null>> = {
  loss_none: 0,
  loss_to_25k: 25_000,
  loss_to_100k: 100_000,
  loss_to_250k: 250_000,
  loss_over_250k: null,
};

function normalizeKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** The levels of a family in ascending band order (the order the table stores). */
function bandsAscending(
  upTo: Readonly<Record<string, number | null>>,
  levels: readonly string[],
): string[] {
  return levels
    .filter((k) => k in upTo)
    .sort((a, b) => {
      const ua = upTo[a];
      const ub = upTo[b];
      if (ua === null || ua === undefined) return 1;
      if (ub === null || ub === undefined) return -1;
      return ua - ub;
    });
}

function bandIndex(
  upTo: Readonly<Record<string, number | null>>,
  ascending: readonly string[],
  x: number | null,
): string | null {
  if (x === null || !isFiniteNumber(x)) return null;
  for (const key of ascending) {
    const u = upTo[key];
    if (u === null || u === undefined || x <= u) return key;
  }
  return null;
}

function upToFor(family: FamilyName): Readonly<Record<string, number | null>> | null {
  if (family === 'age') return AGE_UPTO;
  if (family === 'protectionClass') return PROTECTION_UPTO;
  if (family === 'lossHistory') return LOSS_UPTO;
  return null;
}

/** The level key a row falls in for one family, or null for "unknown → neutral". */
function levelOf(
  family: FamilyName,
  row: FitRow,
  order: readonly string[],
  ascending: readonly string[],
): string | null {
  switch (family) {
    case 'construction': {
      if (typeof row.constructionClass !== 'string') return null;
      const direct = order.find((k) => k === row.constructionClass);
      if (direct !== undefined) return direct;
      const wanted = normalizeKey(row.constructionClass);
      return order.find((k) => normalizeKey(k) === wanted) ?? null;
    }
    case 'age':
      return bandIndex(AGE_UPTO, ascending, row.yearBuilt);
    case 'protectionClass':
      return bandIndex(PROTECTION_UPTO, ascending, row.protectionClass);
    case 'sprinkler':
      if (row.sprinklered === null || typeof row.sprinklered !== 'boolean') return null;
      return row.sprinklered ? 'sprinklered' : 'unsprinklered';
    case 'lossHistory':
      return bandIndex(LOSS_UPTO, ascending, row.fiveYearLoss);
  }
}

function round(v: number): number {
  const p = 10 ** FACTOR_DIGITS;
  return Math.round(v * p) / p;
}

/* -------------------------------------------------------------------------- */
/* Fit                                                                        */
/* -------------------------------------------------------------------------- */

interface Family {
  readonly name: FamilyName;
  /** Worst-to-best. */
  readonly order: readonly string[];
  /** Ascending band order for banded families, `order` otherwise. */
  readonly ascending: readonly string[];
  /** log prior factor per level. */
  readonly prior: Map<string, number>;
  /** current log factor per level. */
  readonly theta: Map<string, number>;
  /** per row: level index into `order`, or -1 for neutral. */
  readonly rowLevel: number[];
}

/**
 * Fit multiplicative rating factors by iteratively reweighted least squares in
 * log space, projecting onto the monotonic cone after each pass.
 */
export function fitMonotonic(
  _rows: readonly FitRow[],
  _options: FitOptions,
): { table: CommercialRatingTable; error: FitError } {
  const priors = priorFactors();
  const rows = _rows.filter(
    (r) =>
      isFiniteNumber(r.tiv) &&
      r.tiv > 0 &&
      isFiniteNumber(r.technicalPremium) &&
      r.technicalPremium > 0,
  );
  const n = rows.length;

  // Row weights: TIV share, normalized to mean 1 (a big building counts more).
  const totalTiv = rows.reduce((acc, r) => acc + r.tiv, 0);
  const w = rows.map((r) => (n === 0 ? 0 : (r.tiv / totalTiv) * n));
  const y = rows.map((r) => Math.log(r.technicalPremium / (r.tiv / 100)));

  const families: Family[] = FAMILIES.map((name) => {
    const order = [...(_options.monotonicOrder[name] ?? [])];
    const upTo = upToFor(name);
    const ascending = upTo === null ? order : bandsAscending(upTo, order);
    const priorFamily = priors[name] ?? {};
    const prior = new Map<string, number>();
    const theta = new Map<string, number>();
    for (const key of order) {
      const p = priorFamily[key];
      const lp = isFiniteNumber(p) && p > 0 ? Math.log(p) : 0;
      prior.set(key, lp);
      theta.set(key, lp);
    }
    const rowLevel = rows.map((r) => {
      const level = levelOf(name, r, order, ascending);
      return level === null ? -1 : order.indexOf(level);
    });
    return { name, order, ascending, prior, theta, rowLevel };
  });

  const priorBase = priors['base']?.['baseRate'];
  let logBase = Math.log(isFiniteNumber(priorBase) && priorBase > 0 ? priorBase : PRIOR_BASE_RATE);

  const rowFamilyLog = (f: Family, i: number): number => {
    const li = f.rowLevel[i] ?? -1;
    if (li < 0) return 0;
    return f.theta.get(f.order[li] as string) ?? 0;
  };
  const fittedLog = (i: number): number => {
    let s = logBase;
    for (const f of families) s += rowFamilyLog(f, i);
    return s;
  };

  const maxIterations = Math.max(0, Math.floor(_options.maxIterations));
  const tolerance = isFiniteNumber(_options.tolerance) && _options.tolerance > 0 ? _options.tolerance : 1e-9;

  for (let iter = 0; iter < maxIterations && n > 0; iter += 1) {
    let maxChange = 0;

    // Intercept: unpenalized weighted mean of the partial residual.
    {
      let num = 0;
      let den = 0;
      for (let i = 0; i < n; i += 1) {
        const partial = (y[i] as number) - (fittedLog(i) - logBase);
        num += (w[i] as number) * partial;
        den += w[i] as number;
      }
      if (den > 0) {
        const next = num / den;
        maxChange = Math.max(maxChange, Math.abs(next - logBase));
        logBase = next;
      }
    }

    for (const f of families) {
      if (f.order.length === 0) continue;
      const k = f.order.length;
      const num = new Array<number>(k).fill(0);
      const den = new Array<number>(k).fill(0);
      for (let i = 0; i < n; i += 1) {
        const li = f.rowLevel[i] ?? -1;
        if (li < 0) continue;
        const partial = (y[i] as number) - (fittedLog(i) - rowFamilyLog(f, i));
        num[li] = (num[li] as number) + (w[i] as number) * partial;
        den[li] = (den[li] as number) + (w[i] as number);
      }
      // Per-level minimizer of data + ridge toward the prior, and its weight.
      const unconstrained: number[] = [];
      const weights: number[] = [];
      for (let j = 0; j < k; j += 1) {
        const key = f.order[j] as string;
        const lp = f.prior.get(key) ?? 0;
        const totalW = (den[j] as number) + PRIOR_PSEUDO_ROWS;
        unconstrained.push(((num[j] as number) + PRIOR_PSEUDO_ROWS * lp) / totalW);
        weights.push(totalW);
      }
      // worst-to-best must be non-increasing (a worse class is never cheaper).
      const projected = poolAdjacentViolators(unconstrained, weights, 'non_increasing');
      for (let j = 0; j < k; j += 1) {
        const key = f.order[j] as string;
        const next = projected[j] as number;
        maxChange = Math.max(maxChange, Math.abs(next - (f.theta.get(key) ?? 0)));
        f.theta.set(key, next);
      }
    }

    if (maxChange < tolerance) break;
  }

  const factorOf = (f: Family, key: string): number => round(Math.exp(f.theta.get(key) ?? 0));
  const byName = new Map(families.map((f) => [f.name, f] as const));
  const fam = (name: FamilyName): Family => byName.get(name) as Family;

  const construction: Record<string, number> = {};
  for (const key of fam('construction').order) construction[key] = factorOf(fam('construction'), key);

  const bands = (name: FamilyName): RatingBand[] => {
    const f = fam(name);
    const upTo = upToFor(name) ?? {};
    return f.ascending.map((key) => ({ key, upTo: upTo[key] ?? null, factor: factorOf(f, key) }));
  };

  const sprinklerFamily = fam('sprinkler');
  const sprinkler = {
    sprinklered: sprinklerFamily.theta.has('sprinklered') ? factorOf(sprinklerFamily, 'sprinklered') : 1,
    unsprinklered: sprinklerFamily.theta.has('unsprinklered')
      ? factorOf(sprinklerFamily, 'unsprinklered')
      : 1,
  };

  const baseRate = round(Math.exp(logBase));

  // Error is measured on the rounded (frozen) factors, in dollars.
  const tableLog = (i: number): number => {
    let s = Math.log(baseRate);
    for (const f of families) {
      const li = f.rowLevel[i] ?? -1;
      if (li >= 0) s += Math.log(factorOf(f, f.order[li] as string));
    }
    return s;
  };
  const actual = rows.map((r) => r.technicalPremium);
  const predicted = rows.map((r, i) => (r.tiv / 100) * Math.exp(tableLog(i)));
  const error = fitError(actual, predicted);

  const table: CommercialRatingTable = {
    lineOfBusiness: 'commercial_property',
    version: FITTED_VERSION,
    baseRate,
    construction,
    age: bands('age'),
    protectionClass: bands('protectionClass'),
    sprinkler,
    lossHistory: bands('lossHistory'),
    flood: FLOOD_LOAD,
    credibilityK: CREDIBILITY_K,
    fitError: error,
  };
  return { table, error };
}

/**
 * Pool-adjacent-violators: the monotonic projection used after each pass.
 * Returns the weighted least-squares NON-DECREASING fit to `values`
 * (delegates to `util/math.poolAdjacentViolators`, HELPERS.md).
 */
export function isotonic(_values: readonly number[], _weights: readonly number[]): number[] {
  return poolAdjacentViolators(_values, _weights, 'non_decreasing');
}

/**
 * Mean absolute percentage error and R squared, reported on screen per PRD 6.7.
 * `mape` is a fraction (0.12 = 12%), averaged over pairs whose actual is non-zero.
 * Pairs with a non-finite side are dropped; `n` counts the pairs used.
 */
export function fitError(_actual: readonly number[], _predicted: readonly number[]): FitError {
  const len = Math.min(_actual.length, _predicted.length);
  const a: number[] = [];
  const p: number[] = [];
  for (let i = 0; i < len; i += 1) {
    const ai = _actual[i];
    const pi = _predicted[i];
    if (isFiniteNumber(ai) && isFiniteNumber(pi)) {
      a.push(ai);
      p.push(pi);
    }
  }
  const n = a.length;
  if (n === 0) return { mape: 0, r2: 0, n: 0 };

  let apeSum = 0;
  let apeN = 0;
  let ssRes = 0;
  let meanA = 0;
  for (let i = 0; i < n; i += 1) meanA += a[i] as number;
  meanA /= n;
  let ssTot = 0;
  for (let i = 0; i < n; i += 1) {
    const ai = a[i] as number;
    const pi = p[i] as number;
    if (ai !== 0) {
      apeSum += Math.abs(ai - pi) / Math.abs(ai);
      apeN += 1;
    }
    ssRes += (ai - pi) ** 2;
    ssTot += (ai - meanA) ** 2;
  }
  const mape = apeN === 0 ? 0 : apeSum / apeN;
  const r2 = ssTot === 0 ? (ssRes === 0 ? 1 : 0) : 1 - ssRes / ssTot;
  return { mape, r2, n };
}
