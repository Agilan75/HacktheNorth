import type { GeneratedCase, StratifiedCase, Stratum } from '../types.js';
import { generateSubmission, rollupGenerated } from './submissions.js';

/**
 * Layer-C stratifier (V03): over-samples every threshold and every §6.6
 * ambiguity so that ~2,000 LLM calls say something, instead of 2,000 easy
 * cases agreeing.
 *
 * Stubs frozen by W0-4; unit V03 replaces these bodies only.
 *
 * Every stratified case is a real multi-building submission from
 * `generateSubmission`, found by deterministic rejection search, so it can be
 * replayed from its own `seed` + `index` (docs/decisions/V03.md D4). The one
 * exception is `contradiction_open`, whose flag is overlaid after rollup
 * because a generated submission carries no contradictions.
 */

/** The nominal layer-C size the target counts are written against (PRD §12). */
const NOMINAL_TOTAL = 2000;
/** Bucket name for the unstratified remainder. Never returned by classifyStratum. */
const ORDINARY = 'ordinary';
const MAX_ATTEMPTS = 20_000;

const ACCEPTABLE_STATE_SET = new Set(['NC', 'SC', 'GA', 'VA', 'UT']);

type Pred = (c: GeneratedCase) => boolean;

interface StratumDef {
  readonly key: string;
  readonly description: string;
  readonly targetCount: number;
  readonly test: Pred;
}

const inRange = (v: number | null, lo: number, hi: number, loOpen: boolean, hiOpen: boolean): boolean =>
  v !== null &&
  (loOpen ? v > lo : v >= lo) &&
  (hiOpen ? v < hi : v <= hi);

/**
 * Priority order: the first matching predicate wins in `classifyStratum`, so
 * the narrow thresholds and ambiguities come before the broad buckets.
 */
const DEFS: readonly StratumDef[] = [
  {
    key: 'contradiction_open',
    description: 'An open HIGH contradiction forces REFER (V-3) on an otherwise scoreable account.',
    targetCount: 40,
    test: (c) => c.input.hasOpenHighContradiction,
  },
  {
    key: 'state_tie_break',
    description: 'I-1: two states carry exactly equal TIV; the alphabetically first code is primary.',
    targetCount: 60,
    test: (c) => c.boundaries['I-1:state_tie'] === 'at',
  },
  {
    key: 'construction_fire_resistive_decides',
    description: 'I-3: Fire Resistive / Modified Fire Resistive TIV is what keeps construction Acceptable.',
    targetCount: 80,
    test: (c) => c.boundaries['I-3:fire_resistive_decides'] === 'at',
  },
  {
    key: 'age_refer_unknown_tiv_pre1990',
    description: 'R-AGE-REFER: a pre-1990 building with unknown TIV, so pctTivPre1990 = 0 yet REFER fires.',
    targetCount: 60,
    test: (c) => c.input.anyBuildingPre1990 === true && c.input.pctTivPre1990 === 0,
  },
  {
    key: 'age_pre1990_exact_half',
    description: '3.4 / B6: exactly 50% of TIV pre-1990 — Acceptable plus refer, never a knockout.',
    targetCount: 80,
    test: (c) => c.input.pctTivPre1990 === 0.5,
  },
  {
    key: 'age_pre1990_just_over_half',
    description: '3.4 / B7: pre-1990 TIV share just over 0.5 — Not Acceptable, knockout.',
    targetCount: 60,
    test: (c) => inRange(c.input.pctTivPre1990, 0.5, 0.51, true, false),
  },
  {
    key: 'age_post2010_exact_half',
    description: '3.4: exactly 50% of TIV post-2010 — Acceptable, not Target.',
    targetCount: 60,
    test: (c) =>
      c.input.pctTivPost2010 === 0.5 && c.input.pctTivPre1990 !== null && c.input.pctTivPre1990 <= 0.5,
  },
  {
    key: 'construction_exact_half',
    description: '3.5 / B1: exactly 50% acceptable construction — Acceptable.',
    targetCount: 80,
    test: (c) => c.input.pctTivAcceptableConstruction === 0.5,
  },
  {
    key: 'construction_just_under_half',
    description: '3.5 / B5: acceptable construction share just under 0.5 — Not Acceptable.',
    targetCount: 60,
    test: (c) => inRange(c.input.pctTivAcceptableConstruction, 0.49, 0.5, false, true),
  },
  {
    key: 'tiv_at_150m',
    description: '3.1 / B1: TIV exactly $150M — Acceptable ("Over $150M" is strict).',
    targetCount: 70,
    test: (c) => c.input.totalTiv === 150_000_000,
  },
  {
    key: 'tiv_just_over_150m',
    description: '3.1 / B2: TIV just over $150M — Not Acceptable.',
    targetCount: 60,
    test: (c) => inRange(c.input.totalTiv, 150_000_000, 150_000_001, true, false),
  },
  {
    key: 'tiv_at_100m',
    description: '3.1: TIV exactly $100M — Target (inclusive).',
    targetCount: 50,
    test: (c) => c.input.totalTiv === 100_000_000,
  },
  {
    key: 'tiv_at_50m',
    description: '3.1 / B9: TIV exactly $50M — Target (inclusive).',
    targetCount: 50,
    test: (c) => c.input.totalTiv === 50_000_000,
  },
  {
    key: 'premium_just_under_50k',
    description: '3.2 / B3: premium just under $50K — Not Acceptable.',
    targetCount: 60,
    test: (c) => inRange(c.input.quotedPremium, 49_999, 50_000, false, true),
  },
  {
    key: 'premium_at_50k',
    description: '3.2: premium exactly $50K — Acceptable.',
    targetCount: 60,
    test: (c) => c.input.quotedPremium === 50_000,
  },
  {
    key: 'premium_at_75k',
    description: '3.2 / B9: premium exactly $75K — Target.',
    targetCount: 50,
    test: (c) => c.input.quotedPremium === 75_000,
  },
  {
    key: 'premium_at_100k',
    description: '3.2: premium exactly $100K — Target.',
    targetCount: 50,
    test: (c) => c.input.quotedPremium === 100_000,
  },
  {
    key: 'premium_at_175k',
    description: '3.2 / B1: premium exactly $175K — Acceptable.',
    targetCount: 60,
    test: (c) => c.input.quotedPremium === 175_000,
  },
  {
    key: 'premium_just_over_175k',
    description: '3.2: premium just over $175K — Not Acceptable.',
    targetCount: 60,
    test: (c) => inRange(c.input.quotedPremium, 175_000, 175_001, true, false),
  },
  {
    key: 'loss_at_100k',
    description: '3.3 / B1: five-year loss exactly $100,000 — Acceptable (not "over").',
    targetCount: 70,
    test: (c) => c.input.fiveYearLoss === 100_000,
  },
  {
    key: 'loss_just_over_100k',
    description: '3.3 / B4: five-year loss just over $100,000 — Not Acceptable.',
    targetCount: 60,
    test: (c) => inRange(c.input.fiveYearLoss, 100_000, 100_001, true, false),
  },
  {
    key: 'loss_zero_known',
    description: 'I-4: zero claims is a KNOWN loss of 0, not missing.',
    targetCount: 40,
    test: (c) => c.input.fiveYearLoss === 0,
  },
  {
    key: 'age_refer_minority_pre1990',
    description: 'R-AGE-REFER: some but under half of TIV pre-1990 — REFER naming the buildings, no knockout.',
    targetCount: 100,
    test: (c) =>
      c.input.anyBuildingPre1990 === true && inRange(c.input.pctTivPre1990, 0, 0.5, true, true),
  },
  {
    key: 'state_multi',
    description: 'I-1: the account spans several states; primary is the largest TIV share.',
    targetCount: 80,
    test: (c) => c.boundaries['I-1:multi_state'] !== undefined,
  },
  {
    key: 'state_acceptable_tier',
    description: '3.6: primary state on the Acceptable-only list (NC, SC, GA, VA, UT).',
    targetCount: 60,
    test: (c) => c.input.primaryState !== null && ACCEPTABLE_STATE_SET.has(c.input.primaryState),
  },
  {
    key: 'submission_not_new',
    description: '3.7 / B12: renewal or any non-new-business submission type — knockout.',
    targetCount: 40,
    test: (c) => c.input.submissionType !== null && c.input.submissionType !== 'new_business',
  },
  {
    key: 'line_not_property',
    description: '3.8: a non-property line of business — knockout.',
    targetCount: 40,
    test: (c) => c.input.lineOfBusiness !== null && c.input.lineOfBusiness !== 'commercial_property',
  },
  {
    key: 'missing_component',
    description: 'G-2 / B11: at least one appetite component missing — completeness < 100, REFER.',
    targetCount: 80,
    test: (c) => {
      const i = c.input;
      return (
        i.submissionType === null ||
        i.lineOfBusiness === null ||
        i.primaryState === null ||
        i.totalTiv === null ||
        i.quotedPremium === null ||
        i.pctTivPre1990 === null ||
        i.pctTivPost2010 === null ||
        i.pctTivAcceptableConstruction === null ||
        i.fiveYearLoss === null
      );
    },
  },
];


export function strata(): readonly Stratum[] {
  return DEFS.map(({ key, description, targetCount }) => ({ key, description, targetCount }));
}

/** Which stratum a case belongs to, or null when it is an ordinary case. */
export function classifyStratum(testCase: GeneratedCase): string | null {
  for (const d of DEFS) if (d.test(testCase)) return d.key;
  return null;
}

/** FNV-1a of the joined parts — a private, stable child-seed derivation. */
function childSeed(parts: readonly (string | number)[]): number {
  let h = 0x811c9dc5;
  const text = parts.join('|');
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Largest-remainder allocation of `total` over the nominal counts. */
function allocate(total: number): Map<string, number> {
  const buckets = [
    ...DEFS.map((d) => ({ key: d.key, weight: d.targetCount })),
    {
      key: ORDINARY,
      weight: Math.max(0, NOMINAL_TOTAL - DEFS.reduce((a, d) => a + d.targetCount, 0)),
    },
  ];
  const weightSum = buckets.reduce((a, b) => a + b.weight, 0);
  const raw = buckets.map((b) => (b.weight * total) / weightSum);
  const counts = raw.map((r) => Math.floor(r));
  let left = total - counts.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, rem: r - Math.floor(r) }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left -= 1) {
    const at = (order[k] as { i: number }).i;
    counts[at] = (counts[at] as number) + 1;
  }
  // every real stratum gets at least one case when the budget allows it
  if (total >= DEFS.length) {
    for (let i = 0; i < DEFS.length; i += 1) {
      if ((counts[i] as number) > 0) continue;
      let donor = 0;
      counts.forEach((c, j) => {
        if (c > (counts[donor] as number)) donor = j;
      });
      counts[donor] = (counts[donor] as number) - 1;
      counts[i] = 1;
    }
  }
  const out = new Map<string, number>();
  buckets.forEach((b, i) => out.set(b.key, counts[i] as number));
  return out;
}

function findCase(seed: number, key: string, slot: number, test: (c: GeneratedCase) => boolean): GeneratedCase {
  const sub = childSeed(['V03-stratum', seed, key, slot]);
  for (let j = 0; j < MAX_ATTEMPTS; j += 1) {
    const c = rollupGenerated(generateSubmission(sub, j));
    if (test(c)) return c;
  }
  throw new Error(`V03: no case found for stratum ${key} (seed ${seed}, slot ${slot})`);
}

export function stratifiedSample(seed: number, totalCases: number): readonly StratifiedCase[] {
  const total = Number.isFinite(totalCases) ? Math.max(0, Math.floor(totalCases)) : 0;
  if (total === 0) return [];
  const counts = allocate(total);
  const out: StratifiedCase[] = [];

  for (const d of DEFS) {
    const n = counts.get(d.key) ?? 0;
    for (let slot = 0; slot < n; slot += 1) {
      if (d.key === 'contradiction_open') {
        // overlay V-3 on an otherwise ordinary submission
        const base = findCase(seed, d.key, slot, (c) => classifyStratum(c) === null);
        const c: GeneratedCase = {
          ...base,
          caseId: `${base.caseId}:contradiction`,
          input: { ...base.input, hasOpenHighContradiction: true },
          boundaries: { ...base.boundaries, 'V-3:open_high_contradiction': 'at' },
        };
        out.push({ stratum: d.key, case: c });
        continue;
      }
      const c = findCase(seed, d.key, slot, (x) => classifyStratum(x) === d.key);
      out.push({ stratum: d.key, case: c });
    }
  }
  const nOrdinary = counts.get(ORDINARY) ?? 0;
  for (let slot = 0; slot < nOrdinary; slot += 1) {
    out.push({
      stratum: ORDINARY,
      case: findCase(seed, ORDINARY, slot, (c) => classifyStratum(c) === null),
    });
  }
  return out;
}
