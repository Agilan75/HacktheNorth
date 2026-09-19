import type {
  BoundaryPosition,
  GeneratedBuilding,
  GeneratedCase,
  GeneratedSubmission,
  NaiveInput,
} from '../types.js';

/**
 * Multi-building submission generator (V03): the smaller share of cases that
 * exercise rollup and vectorize as well as scoring. Policies hold up to 129
 * buildings, so the generator goes that wide.
 *
 * Stubs frozen by W0-4; unit V03 replaces these bodies only.
 *
 * Everything here is deterministic in `(seed, index)`: the PRNG below is a
 * private mulberry32 seeded from an FNV-1a hash of `seed|index`, so a case is
 * replayable from its `caseId` alone (docs/decisions/V03.md D1). The rollup is
 * an independent restatement of INTERPRETATIONS 3.4, 3.5, I-1 and I-3 — it
 * imports nothing from the engine.
 */

/* ------------------------------------------------------------ private PRNG */

interface Rng {
  next(): number;
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
}

function hashSeed(parts: readonly (string | number)[]): number {
  let h = 0x811c9dc5;
  const text = parts.join('|');
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T,
    chance: (p) => next() < p,
  };
}

/* ------------------------------------------------------------- vocabulary */

/** The eight `Building.construction_type` values measured in LIVE_DATA_FACTS. */
const LISTED_ACCEPTABLE = [
  'Joisted Masonry',
  'Non-Combustible',
  'Masonry Non-Combustible',
  'Steel Frame',
] as const;
const FIRE_RESISTIVE = ['Fire Resistive', 'Modified Fire Resistive'] as const;
const NOT_ACCEPTABLE = ['Frame', 'Wood Frame'] as const;
const ALL_CONSTRUCTION = [...LISTED_ACCEPTABLE, ...FIRE_RESISTIVE, ...NOT_ACCEPTABLE] as const;

const TARGET_STATES = ['OH', 'PA', 'MD', 'CO', 'CA', 'FL'] as const;
const ACCEPTABLE_STATES = ['NC', 'SC', 'GA', 'VA', 'UT'] as const;
const OTHER_STATES = ['TX', 'TN', 'IL', 'AZ', 'WA', 'NJ', 'MO', 'MA'] as const;
const ALL_STATES = [...TARGET_STATES, ...ACCEPTABLE_STATES, ...OTHER_STATES] as const;

const TIV_EDGES = [50_000_000, 100_000_000, 150_000_000, 150_000_000.01, 49_999_999, 100_000_001];
const PREMIUM_EDGES = [49_999.99, 50_000, 75_000, 100_000, 175_000, 175_000.01];
const LOSS_EDGES = [100_000, 100_000.01, 0];

const MAX_BUILDINGS = 129;

/* ------------------------------------------------------------- generation */

type Focus =
  | 'none'
  | 'age_half_pre1990'
  | 'age_over_half_pre1990'
  | 'age_half_post2010'
  | 'age_minority_pre1990'
  | 'age_unknown_tiv_pre1990'
  | 'cons_half'
  | 'cons_just_under_half'
  | 'cons_fire_resistive'
  | 'state_tie'
  | 'state_multi';

const FOCI: readonly Focus[] = [
  'age_half_pre1990',
  'age_over_half_pre1990',
  'age_half_post2010',
  'age_minority_pre1990',
  'age_unknown_tiv_pre1990',
  'cons_half',
  'cons_just_under_half',
  'cons_fire_resistive',
  'state_tie',
  'state_multi',
];

function drawBuildingCount(rng: Rng): number {
  const r = rng.next();
  if (r < 0.35) return 1;
  if (r < 0.7) return rng.int(2, 5);
  if (r < 0.9) return rng.int(6, 20);
  return rng.int(21, MAX_BUILDINGS);
}

function drawTotalTiv(rng: Rng): number {
  if (rng.chance(0.3)) return rng.pick(TIV_EDGES);
  // log-uniform $1M..$500M, whole thousands
  const v = Math.exp(Math.log(1e6) + rng.next() * (Math.log(5e8) - Math.log(1e6)));
  return Math.round(v / 1000) * 1000;
}

/** Splits an integer dollar total into `count` positive integer parts. */
function splitTotal(rng: Rng, total: number, count: number): number[] {
  if (count <= 0) return [];
  const whole = Math.floor(total);
  const frac = total - whole;
  const weights = Array.from({ length: count }, () => rng.int(1, 100));
  const w = weights.reduce((a, b) => a + b, 0);
  const parts = weights.map((x) => Math.floor((whole * x) / w));
  const used = parts.reduce((a, b) => a + b, 0);
  parts[count - 1] = (parts[count - 1] as number) + (whole - used);
  if (frac > 0) parts[count - 1] = (parts[count - 1] as number) + frac;
  return parts;
}

/**
 * Two groups whose TIV totals are exactly equal (`extra = 0`) or where group A
 * carries `extra` dollars more. The total is kept an even whole number so the
 * shares come out exactly 0.5 in double arithmetic.
 */
function splitHalves(
  rng: Rng,
  total: number,
  count: number,
  extra: number,
): { tivs: number[]; inA: boolean[] } {
  const even = Math.max(2, Math.floor(total / 2) * 2);
  const half = even / 2;
  const nA = rng.int(1, count - 1);
  const a = splitTotal(rng, half + extra, nA);
  const b = splitTotal(rng, half - extra, count - nA);
  return {
    tivs: [...a, ...b],
    inA: [...a.map(() => true), ...b.map(() => false)],
  };
}

function randomYear(rng: Rng): number {
  if (rng.chance(0.25)) return rng.pick([1989, 1990, 2009, 2010]);
  return rng.int(1948, 2024);
}
const yearPre1990 = (rng: Rng): number => (rng.chance(0.3) ? 1989 : rng.int(1948, 1989));
const yearMid = (rng: Rng): number => (rng.chance(0.3) ? rng.pick([1990, 2009]) : rng.int(1990, 2009));
const yearPost2010 = (rng: Rng): number => (rng.chance(0.3) ? 2010 : rng.int(2010, 2024));
const yearNotPre = (rng: Rng): number => (rng.chance(0.2) ? 1990 : rng.int(1990, 2024));

function randomConstruction(rng: Rng): string {
  if (rng.chance(0.02)) return rng.pick(['Heavy Timber', 'Mixed', 'steel frame', 'JM']);
  return rng.pick(ALL_CONSTRUCTION);
}

function randomState(rng: Rng): string {
  if (rng.chance(0.03)) return rng.pick([' ca ', 'fl', 'Tx ']);
  return rng.pick(ALL_STATES);
}

export function generateSubmission(seed: number, index: number): GeneratedSubmission {
  const rng = makeRng(hashSeed(['V03-submission', seed, index]));
  const caseId = `V03:${seed}:${index}`;

  const focus: Focus = rng.chance(0.5) ? 'none' : rng.pick(FOCI);
  let n = drawBuildingCount(rng);
  if (focus !== 'none' && n < 2) n = rng.int(2, 6);

  let total = drawTotalTiv(rng);
  const grouped =
    focus === 'age_half_pre1990' ||
    focus === 'age_over_half_pre1990' ||
    focus === 'age_half_post2010' ||
    focus === 'cons_half' ||
    focus === 'cons_just_under_half' ||
    focus === 'state_tie';
  if (grouped) total = Math.max(2, Math.floor(total / 2) * 2);
  if (total < n) total = n;

  let tivs: (number | null)[];
  let inA: boolean[];
  if (grouped) {
    const extra = focus === 'age_over_half_pre1990' || focus === 'cons_just_under_half' ? 1 : 0;
    const h = splitHalves(rng, total, n, extra);
    tivs = h.tivs;
    inA = h.inA;
  } else {
    tivs = splitTotal(rng, total, n);
    inA = tivs.map(() => false);
  }

  // years
  let years: (number | null)[] = tivs.map(() => randomYear(rng));
  if (focus === 'age_half_pre1990' || focus === 'age_over_half_pre1990') {
    years = inA.map((a) => (a ? yearPre1990(rng) : yearMid(rng)));
  } else if (focus === 'age_half_post2010') {
    years = inA.map((a) => (a ? yearPost2010(rng) : yearMid(rng)));
  } else if (focus === 'age_minority_pre1990') {
    let minAt = 0;
    tivs.forEach((t, i) => {
      if ((t as number) < (tivs[minAt] as number)) minAt = i;
    });
    years = tivs.map((_, i) => (i === minAt ? yearPre1990(rng) : yearNotPre(rng)));
  } else if (focus === 'age_unknown_tiv_pre1990') {
    const at = rng.int(0, n - 1);
    years = tivs.map((_, i) => (i === at ? yearPre1990(rng) : yearNotPre(rng)));
    tivs[at] = null;
  }

  // construction
  let cons: (string | null)[] = tivs.map(() => randomConstruction(rng));
  if (focus === 'cons_half') {
    const aAcceptable = rng.chance(0.5);
    cons = inA.map((a) =>
      a === aAcceptable ? rng.pick(LISTED_ACCEPTABLE) : rng.pick(NOT_ACCEPTABLE),
    );
  } else if (focus === 'cons_just_under_half') {
    // A carries half + $1 and is "other", so the acceptable share is just under 0.5
    cons = inA.map((a) => (a ? rng.pick(NOT_ACCEPTABLE) : rng.pick(LISTED_ACCEPTABLE)));
  } else if (focus === 'cons_fire_resistive') {
    let minAt = 0;
    tivs.forEach((t, i) => {
      if ((t as number) < (tivs[minAt] as number)) minAt = i;
    });
    cons = tivs.map((_, i) =>
      i === minAt && rng.chance(0.5) ? rng.pick(LISTED_ACCEPTABLE) : rng.pick(FIRE_RESISTIVE),
    );
  }

  // states
  let states: (string | null)[];
  if (focus === 'state_tie') {
    const s1 = rng.pick(ALL_STATES);
    let s2 = rng.pick(ALL_STATES);
    while (s2 === s1) s2 = rng.pick(ALL_STATES);
    states = inA.map((a) => (a ? s1 : s2));
  } else if (focus === 'state_multi' || (n >= 2 && rng.chance(0.25))) {
    const k = rng.int(2, 4);
    const pool: string[] = [];
    while (pool.length < k) {
      const s = rng.pick(ALL_STATES);
      if (!pool.includes(s)) pool.push(s);
    }
    states = tivs.map((_, i) => (i < k ? (pool[i] as string) : rng.pick(pool)));
  } else {
    const s = randomState(rng);
    states = tivs.map(() => s);
  }

  // random unknowns, only where no exact share is being constructed
  if (focus === 'none' || focus === 'state_multi') {
    for (let i = 0; i < n; i += 1) {
      if (rng.chance(0.03)) tivs[i] = null;
      if (rng.chance(0.03)) years[i] = null;
      if (rng.chance(0.03)) cons[i] = null;
      if (rng.chance(0.03)) states[i] = null;
    }
  }

  const buildings: GeneratedBuilding[] = tivs.map((tiv, i) => ({
    id: `${caseId}:b${i + 1}`,
    state: states[i] ?? null,
    yearBuilt: years[i] ?? null,
    constructionType: cons[i] ?? null,
    tiv,
    sprinklered: rng.chance(0.05) ? null : rng.chance(0.7),
    protectionClass: rng.chance(0.05) ? null : rng.int(1, 10),
  }));

  const r1 = rng.next();
  const submissionType =
    r1 < 0.85 ? 'new_business' : r1 < 0.95 ? 'renewal' : r1 < 0.98 ? null : rng.pick(['transfer', 'New_Business']);
  const r2 = rng.next();
  const lineOfBusiness =
    r2 < 0.88 ? 'commercial_property' : r2 < 0.96 ? rng.pick(['general_liability', 'commercial_auto']) : null;

  let quotedPremium: number | null;
  if (rng.chance(0.04)) quotedPremium = null;
  else if (rng.chance(0.3)) quotedPremium = rng.pick(PREMIUM_EDGES);
  else quotedPremium = rng.int(30_000, 700_000);

  let fiveYearLoss: number | null;
  if (rng.chance(0.04)) fiveYearLoss = null;
  else if (rng.chance(0.3)) fiveYearLoss = rng.pick(LOSS_EDGES);
  else if (rng.chance(0.15)) fiveYearLoss = 0;
  else fiveYearLoss = rng.int(1, 400_000);

  return { caseId, seed, submissionType, lineOfBusiness, quotedPremium, fiveYearLoss, buildings };
}

/* ----------------------------------------------------------------- rollup */

const ACCEPTABLE_CLASSES = new Set([
  'joisted_masonry',
  'non_combustible',
  'steel',
  'masonry_non_combustible',
  'fire_resistive',
  'modified_fire_resistive',
]);
const ASSUMED_CLASSES = new Set(['fire_resistive', 'modified_fire_resistive']);
const CONSTRUCTION_ALIASES: Readonly<Record<string, string>> = {
  steel_frame: 'steel',
  jm: 'joisted_masonry',
  noncombustible: 'non_combustible',
  masonry_noncombustible: 'masonry_non_combustible',
};

function normalizeConstruction(value: string): string {
  const snake = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return CONSTRUCTION_ALIASES[snake] ?? snake;
}

const known = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v);

interface Threshold {
  readonly component: string;
  readonly values: readonly number[];
  readonly window: number;
}

/** INTERPRETATIONS §3 boundary values, with the "just under/over" window. */
const THRESHOLDS: readonly Threshold[] = [
  { component: 'totalTiv', values: [50e6, 100e6, 150e6], window: 1 },
  { component: 'quotedPremium', values: [50_000, 75_000, 100_000, 175_000], window: 1 },
  { component: 'fiveYearLoss', values: [100_000], window: 1 },
  { component: 'pctTivPre1990', values: [0.5], window: 0.01 },
  { component: 'pctTivPost2010', values: [0.5], window: 0.01 },
  { component: 'pctTivAcceptableConstruction', values: [0.5], window: 0.01 },
];

function position(value: number, t: Threshold): BoundaryPosition {
  let best = t.values[0] as number;
  for (const v of t.values) if (Math.abs(value - v) < Math.abs(value - best)) best = v;
  if (value === best) return 'at';
  if (Math.abs(value - best) <= t.window) return value < best ? 'under' : 'over';
  return 'random';
}

/** Rolls a generated submission up into the flat facts the oracles compare. */
export function rollupGenerated(submission: GeneratedSubmission): GeneratedCase {
  const buildings = submission.buildings.map((b) => ({
    ...b,
    tiv: known(b.tiv) ? b.tiv : null,
    yearBuilt: known(b.yearBuilt) ? Math.floor(b.yearBuilt) : null,
    state: typeof b.state === 'string' ? b.state.trim().toUpperCase() : null,
    construction:
      typeof b.constructionType === 'string' ? normalizeConstruction(b.constructionType) : null,
  }));

  // totalTiv — sum over known-TIV buildings (E03 D2), null when none is known
  let totalTiv: number | null = null;
  for (const b of buildings) if (b.tiv !== null) totalTiv = (totalTiv ?? 0) + b.tiv;

  // I-1 primary state: largest TIV share, alphabetical tie-break
  const byState = new Map<string, number>();
  for (const b of buildings) {
    if (b.state === null || b.tiv === null) continue;
    byState.set(b.state, (byState.get(b.state) ?? 0) + b.tiv);
  }
  const ranked = [...byState.entries()].sort((x, y) =>
    y[1] !== x[1] ? y[1] - x[1] : x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0,
  );
  const primaryState = ranked.length > 0 ? (ranked[0] as [string, number])[0] : null;
  const stateTie = ranked.length >= 2 && (ranked[0] as [string, number])[1] === (ranked[1] as [string, number])[1];

  // 3.4 building age: shares over known-TIV, known-year buildings
  let ageDen = 0;
  let pre = 0;
  let post = 0;
  let ageCount = 0;
  let anyYear = false;
  let anyPre = false;
  for (const b of buildings) {
    if (b.yearBuilt === null) continue;
    anyYear = true;
    if (b.yearBuilt < 1990) anyPre = true;
    if (b.tiv === null) continue;
    ageCount += 1;
    ageDen += b.tiv;
    if (b.yearBuilt < 1990) pre += b.tiv;
    if (b.yearBuilt >= 2010) post += b.tiv;
  }
  const ageKnown = ageCount > 0 && ageDen > 0;
  const pctTivPre1990 = ageKnown ? pre / ageDen : null;
  const pctTivPost2010 = ageKnown ? post / ageDen : null;
  const anyBuildingPre1990 = anyYear ? anyPre : null;

  // 3.5 construction: over known-TIV buildings; unknown class counts as other
  let consDen = 0;
  let acc = 0;
  let assumed = 0;
  let consCount = 0;
  for (const b of buildings) {
    if (b.tiv === null) continue;
    consCount += 1;
    consDen += b.tiv;
    if (b.construction !== null && ACCEPTABLE_CLASSES.has(b.construction)) {
      acc += b.tiv;
      if (ASSUMED_CLASSES.has(b.construction)) assumed += b.tiv;
    }
  }
  const consKnown = consCount > 0 && consDen > 0;
  const pctTivAcceptableConstruction = consKnown ? acc / consDen : null;
  // I-3: the tier depends on Fire Resistive when removing it flips Acceptable → Not
  const fireResistiveDecides =
    consKnown && acc / consDen >= 0.5 && (acc - assumed) / consDen < 0.5;

  const input: NaiveInput = {
    submissionType: submission.submissionType,
    lineOfBusiness: submission.lineOfBusiness,
    primaryState,
    totalTiv,
    quotedPremium: known(submission.quotedPremium) ? submission.quotedPremium : null,
    pctTivPre1990,
    pctTivPost2010,
    pctTivAcceptableConstruction,
    fiveYearLoss: known(submission.fiveYearLoss) ? submission.fiveYearLoss : null,
    anyBuildingPre1990,
    hasOpenHighContradiction: false,
  };

  const boundaries: Record<string, BoundaryPosition> = {};
  for (const t of THRESHOLDS) {
    const v = input[t.component as keyof NaiveInput];
    if (typeof v === 'number') boundaries[t.component] = position(v, t);
  }
  if (stateTie) boundaries['I-1:state_tie'] = 'at';
  if (ranked.length >= 2) boundaries['I-1:multi_state'] = 'random';
  if (fireResistiveDecides) boundaries['I-3:fire_resistive_decides'] = 'at';
  if (anyBuildingPre1990 === true && buildings.some((b) => b.yearBuilt !== null && b.yearBuilt < 1990 && b.tiv === null)) {
    boundaries['R-AGE-REFER:pre1990_unknown_tiv'] = 'at';
  }

  const m = /:(\d+)$/.exec(submission.caseId);
  const index = m ? Number(m[1]) : 0;

  return {
    caseId: submission.caseId,
    seed: submission.seed,
    index,
    input,
    boundaries,
    fromSubmission: true,
  };
}
