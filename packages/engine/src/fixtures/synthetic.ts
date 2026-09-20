/**
 * Hand-built submissions with their expected vectors. Body owned by Run 1 unit E16.
 *
 * These are the engine's own unit fixtures: small, fully specified, and paired
 * with the exact `x`, `t` and `m` arrays INTERPRETATIONS.md says they must
 * produce. They are what stages 3-11 are tested against before any real data.
 */
import type { CanonicalSubmission, FeatureVector } from '../types.js';

export interface SyntheticCase {
  readonly id: string;
  readonly why: string;
  readonly submission: CanonicalSubmission;
  readonly expectedVector: FeatureVector;
  readonly expectedAppetite: number;
  readonly expectedVerdict: 'FIT' | 'REFER' | 'DOES_NOT_FIT';
}

/* -------------------------------------------------------------------------- */
/* Private builders                                                           */
/* -------------------------------------------------------------------------- */

/** Every synthetic value is broker-typed, so there is never a competing source. */
const BROKER = { source: 'self_reported', sourceDetail: 'synthetic' } as const;

function one<T>(value: T): readonly { value: T; provenance: typeof BROKER }[] {
  return [{ value, provenance: BROKER }];
}

/** Received date fixes the loss window at [2020-06-01, 2025-06-01] regardless of asOf. */
const RECEIVED = '2025-06-01';
const WINDOW_FROM = '2020-06-01';

interface BuildingSpec {
  readonly tiv: number;
  readonly year?: number;
  readonly construction?: string;
  readonly sprinklered?: boolean;
}

interface ClaimSpec {
  readonly date: string;
  readonly amount: number;
}

interface CaseSpec {
  readonly id: string;
  readonly submissionType?: 'new_business' | 'renewal';
  readonly state?: string;
  readonly protectionClass?: number;
  readonly buildings: readonly BuildingSpec[];
  readonly premium?: number;
  readonly claims: readonly ClaimSpec[];
  /** False models "claims never fetched" (I-4): the raw bundle has no Claim key. */
  readonly claimsFetched?: boolean;
}

function build(spec: CaseSpec): CanonicalSubmission {
  const locationId = `${spec.id}-L1`;
  return {
    id: spec.id,
    externalId: spec.id,
    lineOfBusiness: 'commercial_property',
    ...(spec.submissionType === undefined ? {} : { submissionType: one(spec.submissionType) }),
    receivedDate: one(RECEIVED),
    insured: { name: one(`Synthetic ${spec.id}`) },
    locations: [
      {
        externalId: locationId,
        ...(spec.state === undefined ? {} : { state: one(spec.state) }),
        ...(spec.protectionClass === undefined
          ? {}
          : { protectionClass: one(spec.protectionClass) }),
      },
    ],
    buildings: spec.buildings.map((b, i) => ({
      externalId: `${spec.id}-B${String(i + 1)}`,
      locationExternalId: locationId,
      tiv: one(b.tiv),
      ...(b.year === undefined ? {} : { yearBuilt: one(b.year) }),
      ...(b.construction === undefined ? {} : { constructionType: one(b.construction) }),
      ...(b.sprinklered === undefined ? {} : { sprinklered: one(b.sprinklered) }),
    })),
    hazards: { present: {} },
    exposure: {},
    coverage: { lines: [] },
    history: spec.claims.map((c, i) => ({
      externalId: `${spec.id}-C${String(i + 1)}`,
      dateOfLoss: one(c.date),
      paidIndemnity: one(c.amount),
    })),
    pricing: spec.premium === undefined ? {} : { quotedPremium: one(spec.premium) },
    ...(spec.claimsFetched === false
      ? { raw: { externalId: spec.id, records: {} } }
      : {}),
  };
}

type Num = number | null;

/**
 * The expected vector, written out component by component in the order of
 * `vectors/commercial.json` (0 isNewBusiness .. 10 tivWeightedProtectionClass).
 * `m` is derived: 1 exactly where `x` is known. Tiers are given for the nine
 * appetite components; 9, 10 and 11 are extension-only and always carry
 * `t = null`.
 *
 * Component 11, `worstFloodZoneTier`, is appended here rather than written into
 * every case: it is fed only by the OpenFEMA enrichment, and no synthetic case
 * has a flood zone, so it is missing on all of them. That is the point — these
 * cases pin the guideline boundaries, and adding flood must not move a single
 * one of them.
 */
function vec(x: readonly Num[], t: readonly Num[]): FeatureVector {
  const full = [...x, null];
  return {
    lineOfBusiness: 'commercial_property',
    specVersion: '1.0.0',
    x: full,
    t: [...t, null, null, null],
    m: full.map((v) => (v === null ? 0 : 1)),
  };
}

/* -------------------------------------------------------------------------- */
/* The B1 family (INTERPRETATIONS §8)                                         */
/* -------------------------------------------------------------------------- */

const OK_CLASS = 'Joisted Masonry';
const OTHER_CLASS = 'Frame';
const PC = 3;

/** B1: $150M split 50/50 acceptable/frame, all built 2000, $100,000 of loss. */
const B1: CaseSpec = {
  id: 'SYN-B1',
  submissionType: 'new_business',
  state: 'OH',
  protectionClass: PC,
  buildings: [
    { tiv: 75_000_000, year: 2000, construction: OK_CLASS, sprinklered: true },
    { tiv: 75_000_000, year: 2000, construction: OTHER_CLASS, sprinklered: true },
  ],
  premium: 175_000,
  claims: [{ date: '2023-03-15', amount: 100_000 }],
};

/** B9: B1 moved to TIV $50M and premium $75,000 (both Target edges). */
const B9: CaseSpec = {
  ...B1,
  id: 'SYN-B9',
  buildings: [
    { tiv: 25_000_000, year: 2000, construction: OK_CLASS, sprinklered: true },
    { tiv: 25_000_000, year: 2000, construction: OTHER_CLASS, sprinklered: true },
  ],
  premium: 75_000,
};

/* -------------------------------------------------------------------------- */
/* Cases                                                                      */
/* -------------------------------------------------------------------------- */

/** One case per INTERPRETATIONS boundary, plus the all-missing and extreme cases. */
export function syntheticCases(): readonly SyntheticCase[] {
  const cases: SyntheticCase[] = [];
  const add = (
    spec: CaseSpec,
    why: string,
    expectedVector: FeatureVector,
    expectedAppetite: number,
    expectedVerdict: SyntheticCase['expectedVerdict'],
  ): void => {
    cases.push({ id: spec.id, why, submission: build(spec), expectedVector, expectedAppetite, expectedVerdict });
  };

  // B1 — every edge at its friendlier inclusive side: 84.0, FIT.
  add(
    B1,
    'INTERPRETATIONS §8 B1: TIV $150M, premium $175,000, construction exactly 50%, loss exactly $100,000 are all inclusive of the friendlier tier.',
    vec([1, 1, 2, 150_000_000, 175_000, 0, 0, 0.5, 100_000, 1, PC], [1, 1, 1, 0.6, 0.6, 0.6, 0.6, 1, 1]),
    84,
    'FIT',
  );

  // B2 — "Over $150M" is strict.
  {
    const acceptable = 75_000_000.01;
    const total = acceptable + 75_000_000;
    add(
      {
        ...B1,
        id: 'SYN-B2',
        buildings: [
          { tiv: acceptable, year: 2000, construction: OK_CLASS, sprinklered: true },
          { tiv: 75_000_000, year: 2000, construction: OTHER_CLASS, sprinklered: true },
        ],
      },
      'INTERPRETATIONS §8 B2: TIV $150,000,000.01 is over $150M, so tiv is Not Acceptable and knocks out.',
      vec(
        [1, 1, 2, total, 175_000, 0, 0, acceptable / total, 100_000, 1, PC],
        [1, 1, 1, 0, 0.6, 0.6, 0.6, 1, 1],
      ),
      75,
      'DOES_NOT_FIT',
    );
  }

  // B3 — "Under $50K" is strict; 49,999.99 is under.
  add(
    { ...B1, id: 'SYN-B3', premium: 49_999.99 },
    'INTERPRETATIONS §8 B3: premium $49,999.99 is under $50K, so total_premium is Not Acceptable and knocks out.',
    vec([1, 1, 2, 150_000_000, 49_999.99, 0, 0, 0.5, 100_000, 1, PC], [1, 1, 1, 0.6, 0, 0.6, 0.6, 1, 1]),
    75,
    'DOES_NOT_FIT',
  );

  // B4 — loss over $100,000.
  add(
    { ...B1, id: 'SYN-B4', claims: [{ date: '2023-03-15', amount: 100_000.01 }] },
    'INTERPRETATIONS §8 B4: five-year loss $100,000.01 is over $100,000, so loss_value is Not Acceptable and knocks out.',
    vec([1, 1, 2, 150_000_000, 175_000, 0, 0, 0.5, 100_000.01, 1, PC], [1, 1, 1, 0.6, 0.6, 0.6, 0.6, 1, 0]),
    74,
    'DOES_NOT_FIT',
  );

  // B5 — acceptable construction just under half.
  {
    const acceptable = 74_985_000;
    const other = 75_015_000;
    add(
      {
        ...B1,
        id: 'SYN-B5',
        buildings: [
          { tiv: acceptable, year: 2000, construction: OK_CLASS, sprinklered: true },
          { tiv: other, year: 2000, construction: OTHER_CLASS, sprinklered: true },
        ],
      },
      'INTERPRETATIONS §8 B5: 49.99% acceptable construction is under half, so construction_type is Not Acceptable and knocks out.',
      vec(
        [1, 1, 2, 150_000_000, 175_000, 0, 0, acceptable / (acceptable + other), 100_000, 1, PC],
        [1, 1, 1, 0.6, 0.6, 0.6, 0.6, 0, 1],
      ),
      74,
      'DOES_NOT_FIT',
    );
  }

  // B6 — exactly half pre-1990: Acceptable plus the R-AGE-REFER flag.
  add(
    {
      ...B1,
      id: 'SYN-B6',
      buildings: [
        { tiv: 75_000_000, year: 1989, construction: OK_CLASS, sprinklered: true },
        { tiv: 75_000_000, year: 2000, construction: OTHER_CLASS, sprinklered: true },
      ],
    },
    'INTERPRETATIONS §8 B6 + R-AGE-REFER: exactly 50% of TIV pre-1990 stays Acceptable (no knockout) but the 1989 building raises REFER; the score is unchanged at 84.',
    vec([1, 1, 2, 150_000_000, 175_000, 0.5, 0, 0.5, 100_000, 1, PC], [1, 1, 1, 0.6, 0.6, 0.6, 0.6, 1, 1]),
    84,
    'REFER',
  );

  // B7 — just over half pre-1990.
  {
    const old = 75_000_150;
    const newer = 74_999_850;
    const total = old + newer;
    add(
      {
        ...B1,
        id: 'SYN-B7',
        buildings: [
          { tiv: old, year: 1989, construction: OK_CLASS, sprinklered: true },
          { tiv: newer, year: 2000, construction: OTHER_CLASS, sprinklered: true },
        ],
      },
      'INTERPRETATIONS §8 B7: 50.0001% of TIV pre-1990 is strictly over half, so building_age is Not Acceptable and knocks out.',
      vec(
        [1, 1, 2, total, 175_000, old / total, 0, old / total, 100_000, 1, PC],
        [1, 1, 1, 0.6, 0.6, 0, 0, 1, 1],
      ),
      78,
      'DOES_NOT_FIT',
    );
  }

  // B8 — every building built exactly 2010.
  add(
    {
      ...B1,
      id: 'SYN-B8',
      buildings: [
        { tiv: 75_000_000, year: 2010, construction: OK_CLASS, sprinklered: true },
        { tiv: 75_000_000, year: 2010, construction: OTHER_CLASS, sprinklered: true },
      ],
    },
    'INTERPRETATIONS §8 B8 + §3.4: yearBuilt 2010 counts as post-2010, so 100% of TIV is newer than 2010 and building_age is Target.',
    vec([1, 1, 2, 150_000_000, 175_000, 0, 1, 0.5, 100_000, 1, PC], [1, 1, 1, 0.6, 0.6, 1, 1, 1, 1]),
    88,
    'FIT',
  );

  // B9 — both lower Target edges.
  add(
    B9,
    'INTERPRETATIONS §8 B9: TIV exactly $50M and premium exactly $75,000 are inclusive Target edges.',
    vec([1, 1, 2, 50_000_000, 75_000, 0, 0, 0.5, 100_000, 1, PC], [1, 1, 1, 1, 1, 0.6, 0.6, 1, 1]),
    96,
    'FIT',
  );

  // B10 — acceptable-only state.
  add(
    { ...B9, id: 'SYN-B10', state: 'NC' },
    'INTERPRETATIONS §8 B10 + §3.6: NC is on the Acceptable list but not the Target list, so the state tier is 0.6.',
    vec([1, 1, 1, 50_000_000, 75_000, 0, 0, 0.5, 100_000, 1, PC], [1, 1, 0.6, 1, 1, 0.6, 0.6, 1, 1]),
    90,
    'FIT',
  );

  // B11 — premium missing.
  {
    const { premium: _dropped, ...rest } = B9;
    add(
      { ...rest, id: 'SYN-B11' },
      'INTERPRETATIONS §8 B11 + G-2 + V-6: a missing premium contributes 0 points without renormalizing, completeness is 8/9, verdict REFER.',
      vec([1, 1, 2, 50_000_000, null, 0, 0, 0.5, 100_000, 1, PC], [1, 1, 1, 1, null, 0.6, 0.6, 1, 1]),
      81,
      'REFER',
    );
  }

  // B12 — renewal business.
  add(
    { ...B9, id: 'SYN-B12', submissionType: 'renewal' },
    'INTERPRETATIONS §8 B12 + §3.7: renewal business is Not Acceptable; the knockout decides the verdict but does not zero the score.',
    vec([0, 1, 2, 50_000_000, 75_000, 0, 0, 0.5, 100_000, 1, PC], [0, 1, 1, 1, 1, 0.6, 0.6, 1, 1]),
    86,
    'DOES_NOT_FIT',
  );

  // PERFECT — every factor at its best tier; zero claims is a known $0 loss.
  add(
    {
      ...B9,
      id: 'SYN-PERFECT',
      buildings: [
        { tiv: 40_000_000, year: 2015, construction: OK_CLASS, sprinklered: true },
        { tiv: 35_000_000, year: 2012, construction: 'Masonry Non-Combustible', sprinklered: true },
      ],
      premium: 90_000,
      claims: [],
    },
    'T-BLANK + I-4: every factor at its best tier scores exactly 100; zero claims in the window is a KNOWN $0 loss (m = 1), not missing.',
    vec([1, 1, 2, 75_000_000, 90_000, 0, 1, 1, 0, 1, PC], [1, 1, 1, 1, 1, 1, 1, 1, 1]),
    100,
    'FIT',
  );

  // I3 — fire resistive counts as acceptable construction.
  add(
    {
      ...B9,
      id: 'SYN-I3',
      buildings: [
        { tiv: 25_000_000, year: 2000, construction: 'Fire Resistive', sprinklered: true },
        { tiv: 25_000_000, year: 2000, construction: 'Modified Fire Resistive', sprinklered: true },
      ],
    },
    'INTERPRETATIONS I-3: Fire Resistive and Modified Fire Resistive count toward acceptable construction, so the share is 1 and the factor is Acceptable (T-BLANK 1).',
    vec([1, 1, 2, 50_000_000, 75_000, 0, 0, 1, 100_000, 1, PC], [1, 1, 1, 1, 1, 0.6, 0.6, 1, 1]),
    96,
    'FIT',
  );

  // I4 — the loss window's lower edge is inclusive.
  add(
    {
      ...B9,
      id: 'SYN-I4',
      claims: [
        { date: WINDOW_FROM, amount: 60_000 },
        { date: '2020-05-31', amount: 1_000_000 },
        { date: RECEIVED, amount: 40_000 },
      ],
    },
    'INTERPRETATIONS I-4: claims dated exactly on windowFrom and windowTo are in the window; the $1M claim one day earlier is out, so loss is exactly $100,000.',
    vec([1, 1, 2, 50_000_000, 75_000, 0, 0, 0.5, 100_000, 1, PC], [1, 1, 1, 1, 1, 0.6, 0.6, 1, 1]),
    96,
    'FIT',
  );

  // ALL-MISSING — nothing but the line of business is knowable.
  add(
    { id: 'SYN-EMPTY', buildings: [], claims: [], claimsFetched: false },
    'G-2 + V-6: every appetite component except isPropertyLine is missing; only line_of_business (0.15) scores, no knockout, completeness 1/9, REFER.',
    vec([null, 1, null, null, null, null, null, null, null, null, null], [null, 1, null, null, null, null, null, null, null]),
    15,
    'REFER',
  );

  // EXTREME — every movable and immovable factor out of appetite at once.
  add(
    {
      id: 'SYN-EXTREME',
      submissionType: 'renewal',
      state: 'TX',
      protectionClass: 10,
      buildings: [{ tiv: 500_000_000_000, year: 1900, construction: 'Frame', sprinklered: false }],
      premium: 25_000_000,
      claims: [{ date: '2024-01-01', amount: 50_000_000 }],
    },
    'Extreme values: renewal, TX, $500B TIV, $25M premium, all pre-1990 frame, $50M loss. Every factor but line of business is Not Acceptable; the score is 15 and the verdict DOES_NOT_FIT.',
    vec(
      [0, 1, 0, 500_000_000_000, 25_000_000, 1, 0, 0, 50_000_000, 0, 10],
      [0, 1, 0, 0, 0, 0, 0, 0, 0],
    ),
    15,
    'DOES_NOT_FIT',
  );

  return cases;
}
