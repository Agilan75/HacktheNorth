import type { BoundaryPosition, GeneratedCase, NaiveInput, Prng } from '../types.js';
import { createPrng, deriveSeed } from './prng.js';

/**
 * Vector-level case generator (V02): each component sampled just under, at and
 * just over every threshold in docs/contracts/INTERPRETATIONS.md §3, with
 * random presence masks and extreme values (0, negatives, huge numbers, NaN
 * through `null`).
 *
 * Layout of the stream for any seed:
 *  - indices 0..11 are the worked cases B1..B12 of INTERPRETATIONS §8, verbatim;
 *  - every later index draws from its own child PRNG,
 *    `createPrng(deriveSeed(seed, 'vec:' + index))`, so any single case is
 *    replayable from (seed, index) alone, independent of chunking.
 */

/* ------------------------------------------------------------ thresholds */

type NumericComponent =
  | 'totalTiv'
  | 'quotedPremium'
  | 'fiveYearLoss'
  | 'pctTivPre1990'
  | 'pctTivPost2010'
  | 'pctTivAcceptableConstruction';

/** INTERPRETATIONS §3 bold rows, plus the R-AGE-REFER `pctTivPre1990 == 0` edge. */
const THRESHOLDS: Readonly<Record<NumericComponent, readonly number[]>> = {
  totalTiv: [50_000_000, 100_000_000, 150_000_000],
  quotedPremium: [50_000, 75_000, 100_000, 175_000],
  fiveYearLoss: [100_000],
  pctTivPre1990: [0, 0.5],
  pctTivPost2010: [0.5],
  pctTivAcceptableConstruction: [0.5],
};

const COMPONENT_ORDER: readonly NumericComponent[] = [
  'totalTiv',
  'quotedPremium',
  'fiveYearLoss',
  'pctTivPre1990',
  'pctTivPost2010',
  'pctTivAcceptableConstruction',
];

const SHARE_COMPONENTS: ReadonlySet<NumericComponent> = new Set([
  'pctTivPre1990',
  'pctTivPost2010',
  'pctTivAcceptableConstruction',
]);

/** Within this relative distance of a threshold a value counts as "just" under/over. */
const NEAR = 1e-2;

const TARGET_STATES = ['OH', 'PA', 'MD', 'CO', 'CA', 'FL'] as const;
const ACCEPTABLE_STATES = ['NC', 'SC', 'GA', 'VA', 'UT'] as const;
const OTHER_STATES = ['TX', 'NY', 'IL', 'WA', 'NJ', 'MA', 'AZ', 'MI', 'NV', 'OR'] as const;
const HOSTILE_STATES = ['', '  ', 'oh', ' ca ', 'Fl', 'XX', 'Ohio', 'O', 'OHX', 'nc'] as const;

const OTHER_LINES = ['general_liability', 'commercial_auto', 'workers_comp', 'inland_marine', 'umbrella'] as const;
const HOSTILE_STRINGS = ['', '  ', 'NEW_BUSINESS', 'New Business', ' new_business ', 'Commercial Property', 'property', 'rewrite'] as const;

const HOSTILE_MONEY: readonly (number | null)[] = [
  0,
  -0,
  -1,
  -150_000_000,
  1e18,
  Number.MAX_VALUE,
  -Number.MAX_VALUE,
  Number.MIN_VALUE,
  Number.EPSILON,
  0.01,
  null,
];

const HOSTILE_SHARES: readonly (number | null)[] = [
  -1e-9,
  -0.5,
  1.0000001,
  2,
  0,
  1,
  Number.MIN_VALUE,
  1e18,
  -Number.MAX_VALUE,
  null,
];

/* ------------------------------------------------------ float neighbours */

const f64 = new Float64Array(1);
const i64 = new BigInt64Array(f64.buffer);

/** The next representable double above `x` (finite `x` only). */
function nextUp(x: number): number {
  if (x === 0) return Number.MIN_VALUE;
  f64[0] = x;
  i64[0] = (i64[0] ?? 0n) + (x > 0 ? 1n : -1n);
  return f64[0] ?? x;
}

/** The next representable double below `x` (finite `x` only). */
function nextDown(x: number): number {
  return -nextUp(-x);
}

/* ------------------------------------------------------------- sampling */

const RELATIVE_STEPS = [1e-12, 1e-9, 1e-6, 1e-4, 1e-3] as const;

/** A strictly positive offset that keeps `threshold ± offset` "just" across. */
function nearOffset(prng: Prng, threshold: number): number {
  const scale = Math.max(Math.abs(threshold), 1);
  const kind = prng.int(0, 2);
  if (kind === 0) return 0; // caller turns 0 into a one-ulp step
  if (kind === 1 && scale >= 1_000) return 0.01; // one cent
  return scale * prng.pick(RELATIVE_STEPS);
}

/** Samples one numeric component at a named position around a threshold. */
export function sampleAroundThreshold(
  prng: Prng,
  threshold: number,
  position: BoundaryPosition,
): number {
  const scale = Math.max(Math.abs(threshold), 1);
  switch (position) {
    case 'at':
      return threshold;
    case 'under': {
      const off = nearOffset(prng, threshold);
      const v = off === 0 ? nextDown(threshold) : threshold - off;
      return v < threshold ? v : nextDown(threshold);
    }
    case 'over': {
      const off = nearOffset(prng, threshold);
      const v = off === 0 ? nextUp(threshold) : threshold + off;
      return v > threshold ? v : nextUp(threshold);
    }
    case 'far_under':
      return threshold - scale * (0.1 + 0.9 * prng.next());
    case 'far_over':
      return threshold + scale * (0.1 + 1.9 * prng.next());
    case 'random':
      return 2 * scale * prng.next();
  }
}

/** Every boundary value INTERPRETATIONS §3 and §8 require the run to hit. */
export function boundaryCatalogue(): readonly {
  readonly component: string;
  readonly threshold: number;
}[] {
  const out: { component: string; threshold: number }[] = [];
  for (const component of COMPONENT_ORDER) {
    for (const threshold of THRESHOLDS[component]) out.push({ component, threshold });
  }
  return out;
}

/** Where `value` sits relative to the nearest threshold of `component`. */
function classify(component: NumericComponent, value: number): BoundaryPosition {
  let best: number | null = null;
  for (const t of THRESHOLDS[component]) {
    if (best === null || Math.abs(value - t) < Math.abs(value - best)) best = t;
  }
  const t = best ?? 0;
  if (value === t) return 'at';
  const near = Math.abs(value - t) <= Math.max(Math.abs(t), 1) * NEAR;
  if (value < t) return near ? 'under' : 'far_under';
  return near ? 'over' : 'far_over';
}

function logUniform(prng: Prng, lo: number, hi: number): number {
  return Math.exp(Math.log(lo) + (Math.log(hi) - Math.log(lo)) * prng.next());
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** A realistic value for a component, not aimed at any boundary. */
function realistic(prng: Prng, component: NumericComponent, pre: number | null): number {
  switch (component) {
    case 'totalTiv':
      return prng.chance(0.03) ? 0 : logUniform(prng, 1e5, 1e9);
    case 'quotedPremium':
      return logUniform(prng, 1e3, 1e6);
    case 'fiveYearLoss':
      return prng.chance(0.3) ? 0 : logUniform(prng, 1, 1e7);
    case 'pctTivPre1990': {
      const r = prng.next();
      return r < 0.35 ? 0 : r < 0.45 ? 1 : prng.next();
    }
    case 'pctTivPost2010': {
      const room = pre === null ? 1 : clamp01(1 - pre);
      const r = prng.next();
      return r < 0.3 ? 0 : r < 0.4 ? room : room * prng.next();
    }
    case 'pctTivAcceptableConstruction': {
      const r = prng.next();
      return r < 0.15 ? 1 : r < 0.25 ? 0 : prng.next();
    }
  }
}

const POSITIONS: readonly BoundaryPosition[] = [
  'at', 'at', 'at', 'at', 'at', 'at', 'at',
  'under', 'under', 'under', 'under', 'under',
  'over', 'over', 'over', 'over', 'over',
  'far_under', 'far_over',
];

/* --------------------------------------------------- §8 worked cases */

const B1: NaiveInput = {
  submissionType: 'new_business',
  lineOfBusiness: 'commercial_property',
  primaryState: 'OH',
  totalTiv: 150_000_000,
  quotedPremium: 175_000,
  pctTivPre1990: 0,
  pctTivPost2010: 0,
  pctTivAcceptableConstruction: 0.5,
  fiveYearLoss: 100_000,
  anyBuildingPre1990: false,
  hasOpenHighContradiction: false,
};
const B9: NaiveInput = { ...B1, totalTiv: 50_000_000, quotedPremium: 75_000 };

/** INTERPRETATIONS §8 B1..B12, in order. */
const WORKED: readonly NaiveInput[] = [
  B1,
  { ...B1, totalTiv: 150_000_000.01 },
  { ...B1, quotedPremium: 49_999.99 },
  { ...B1, fiveYearLoss: 100_000.01 },
  { ...B1, pctTivAcceptableConstruction: 0.4999 },
  { ...B1, pctTivPre1990: 0.5, anyBuildingPre1990: true },
  { ...B1, pctTivPre1990: 0.500001, anyBuildingPre1990: true },
  { ...B1, pctTivPre1990: 0, pctTivPost2010: 1 },
  B9,
  { ...B9, primaryState: 'NC' },
  { ...B9, quotedPremium: null },
  { ...B9, submissionType: 'renewal' },
];

/** Number of leading indices reserved for the §8 worked cases. */
const WORKED_COUNT = WORKED.length;

/* ------------------------------------------------------------ the case */

function boundariesOf(
  input: NaiveInput,
  randomOnes: ReadonlySet<NumericComponent>,
): Record<string, BoundaryPosition> {
  const out: Record<string, BoundaryPosition> = {};
  for (const c of COMPONENT_ORDER) {
    const v = input[c];
    if (v === null || !Number.isFinite(v)) continue;
    out[c] = randomOnes.has(c) ? 'random' : classify(c, v);
  }
  return out;
}

function caseIdFor(seed: number, index: number): string {
  return `vec:${seed}:${index}`;
}

function pickState(prng: Prng): string {
  const r = prng.next();
  if (r < 0.45) return prng.pick(TARGET_STATES);
  if (r < 0.75) return prng.pick(ACCEPTABLE_STATES);
  return prng.pick(OTHER_STATES);
}

function randomCase(prng: Prng): { input: NaiveInput; randomOnes: Set<NumericComponent> } {
  const extreme = prng.chance(0.1);
  const boundaryRate = prng.pick([0.2, 0.5, 0.8, 1] as const);
  const allMissing = prng.chance(0.01);
  const missingRate = allMissing ? 1 : prng.pick([0, 0, 0, 0.05, 0.15, 0.4] as const);
  const missing = (): boolean => prng.chance(missingRate);

  const randomOnes = new Set<NumericComponent>();
  const values: Record<NumericComponent, number | null> = {
    totalTiv: null,
    quotedPremium: null,
    fiveYearLoss: null,
    pctTivPre1990: null,
    pctTivPost2010: null,
    pctTivAcceptableConstruction: null,
  };

  for (const c of COMPONENT_ORDER) {
    if (prng.chance(boundaryRate)) {
      const t = prng.pick(THRESHOLDS[c]);
      let v = sampleAroundThreshold(prng, t, prng.pick(POSITIONS));
      if (SHARE_COMPONENTS.has(c)) v = clamp01(v);
      else if (v < 0) v = 0; // far_under of a money threshold stays a real amount
      values[c] = v;
    } else {
      values[c] = realistic(prng, c, values.pctTivPre1990);
      randomOnes.add(c);
    }
  }

  // Presence mask. building_age's two components are jointly known or missing (V-6).
  const tivMissing = missing();
  const premiumMissing = missing();
  const lossMissing = missing();
  const ageMissing = missing();
  const constructionMissing = missing();
  const typeMissing = missing();
  const lineMissing = missing();
  const stateMissing = missing();

  let submissionType: string | null =
    prng.chance(0.75) ? 'new_business' : prng.chance(0.8) ? 'renewal' : 'rewrite';
  let lineOfBusiness: string | null =
    prng.chance(0.8) ? 'commercial_property' : prng.pick(OTHER_LINES);
  let primaryState: string | null = pickState(prng);
  const hasOpenHighContradiction = prng.chance(0.1);
  const zeroSharePre1990Building = prng.chance(0.25);
  const unknownAgePre1990 = prng.pick([null, false, true] as const);

  if (tivMissing) values.totalTiv = null;
  if (premiumMissing) values.quotedPremium = null;
  if (lossMissing) values.fiveYearLoss = null;
  if (constructionMissing) values.pctTivAcceptableConstruction = null;
  if (ageMissing) {
    values.pctTivPre1990 = null;
    values.pctTivPost2010 = null;
  }
  if (typeMissing) submissionType = null;
  if (lineMissing) lineOfBusiness = null;
  if (stateMissing) primaryState = null;

  if (extreme) {
    const hostile = (c: NumericComponent): void => {
      if (!prng.chance(0.35)) return;
      values[c] = prng.pick(SHARE_COMPONENTS.has(c) ? HOSTILE_SHARES : HOSTILE_MONEY);
      randomOnes.delete(c);
    };
    for (const c of COMPONENT_ORDER) hostile(c);
    // Keep building_age jointly known / jointly missing even when hostile.
    if (values.pctTivPre1990 === null || values.pctTivPost2010 === null) {
      values.pctTivPre1990 = null;
      values.pctTivPost2010 = null;
    }
    if (prng.chance(0.35)) submissionType = prng.pick(HOSTILE_STRINGS);
    if (prng.chance(0.35)) lineOfBusiness = prng.pick(HOSTILE_STRINGS);
    if (prng.chance(0.35)) primaryState = prng.pick(HOSTILE_STATES);
  }

  // anyBuildingPre1990 follows the shares (R-AGE-REFER): a positive pre-1990
  // share implies a pre-1990 building; a zero share may still hide one with an
  // unknown TIV; with no known ages it may be anything, including unknown.
  const pre = values.pctTivPre1990;
  let anyBuildingPre1990: boolean | null;
  if (pre === null) anyBuildingPre1990 = unknownAgePre1990;
  else if (pre > 0) anyBuildingPre1990 = true;
  else anyBuildingPre1990 = zeroSharePre1990Building;

  const input: NaiveInput = {
    submissionType,
    lineOfBusiness,
    primaryState,
    totalTiv: values.totalTiv,
    quotedPremium: values.quotedPremium,
    pctTivPre1990: values.pctTivPre1990,
    pctTivPost2010: values.pctTivPost2010,
    pctTivAcceptableConstruction: values.pctTivAcceptableConstruction,
    fiveYearLoss: values.fiveYearLoss,
    anyBuildingPre1990,
    hasOpenHighContradiction,
  };
  return { input, randomOnes };
}

export function generateCase(seed: number, index: number): GeneratedCase {
  const worked = index >= 0 && index < WORKED_COUNT ? WORKED[index] : undefined;
  if (worked !== undefined) {
    return {
      caseId: caseIdFor(seed, index),
      seed,
      index,
      input: worked,
      boundaries: boundariesOf(worked, new Set()),
      fromSubmission: false,
    };
  }
  const prng = createPrng(deriveSeed(seed, `vec:${index}`));
  const { input, randomOnes } = randomCase(prng);
  return {
    caseId: caseIdFor(seed, index),
    seed,
    index,
    input,
    boundaries: boundariesOf(input, randomOnes),
    fromSubmission: false,
  };
}

export function generateCases(
  seed: number,
  startIndex: number,
  count: number,
): readonly GeneratedCase[] {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const out: GeneratedCase[] = new Array<GeneratedCase>(n);
  for (let i = 0; i < n; i++) out[i] = generateCase(seed, startIndex + i);
  return out;
}
