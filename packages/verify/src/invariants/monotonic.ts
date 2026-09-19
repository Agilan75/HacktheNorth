import type {
  EngineResultView,
  GeneratedCase,
  Invariant,
  InvariantSuite,
  InvariantViolation,
  NaiveFactorId,
  NaiveInput,
} from '../types.js';
import { getInvariantProbe } from './core.js';
import type { ProbedResult } from './core.js';

/**
 * Monotonicity invariants (V04): improving any factor never lowers the
 * appetite score, and the premium moves monotonically in every factor.
 *
 * Both re-run the engine on perturbed inputs through the probe installed with
 * `setInvariantProbe` (core.ts). Without a probe, the score invariant still
 * proves the single-result half of monotonicity: the score is exactly the dot
 * product `100 × Σ w·t` with the non-negative W-1 weights, so it can never fall
 * when a tier value rises. The premium invariant needs a probe and a priced
 * result; without them it has nothing to compare and reports nothing.
 */

/* ------------------------------------------------------ private helpers */

/** INTERPRETATIONS §2 (W-1), in factor order. */
const WEIGHTS: Readonly<Record<NaiveFactorId, number>> = {
  submission_type: 0.1,
  line_of_business: 0.15,
  primary_risk_state: 0.15,
  tiv: 0.15,
  total_premium: 0.15,
  building_age: 0.1,
  construction_type: 0.1,
  loss_value: 0.1,
};
const FACTOR_IDS = Object.keys(WEIGHTS) as NaiveFactorId[];

/** INTERPRETATIONS §7. */
const SCORE_TOLERANCE = 1e-6;
const MONEY_TOLERANCE = 1e-6;

/** The middle of each unimodal target band (§3.1, §3.2); moving toward it never lowers a tier. */
const TIV_TARGET_MID = 75_000_000;
const PREMIUM_TARGET_MID = 87_500;
/** A Target state (§3.6). */
const TARGET_STATE = 'OH';

function violation(
  invariant: string,
  testCase: GeneratedCase,
  message: string,
  observed: unknown,
  expected: unknown,
): InvariantViolation {
  return { invariant, caseId: testCase.caseId, seed: testCase.seed, message, observed, expected };
}

function known(n: number | null): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

interface Move {
  readonly factor: string;
  readonly label: string;
  readonly input: NaiveInput;
}

function move(factor: string, label: string, base: NaiveInput, patch: Partial<NaiveInput>): Move {
  return { factor, label, input: { ...base, ...patch } };
}

/** Moves a unimodal-band value toward its target mid: halfway, then all the way. */
function towardMid(
  factor: string,
  field: 'totalTiv' | 'quotedPremium',
  base: NaiveInput,
  mid: number,
): Move[] {
  const v = base[field];
  if (!known(v)) return [move(factor, `${field}: missing → ${mid}`, base, { [field]: mid })];
  if (v === mid) return [];
  return [
    move(factor, `${field}: ${v} → halfway to ${mid}`, base, { [field]: v + (mid - v) / 2 }),
    move(factor, `${field}: ${v} → ${mid}`, base, { [field]: mid }),
  ];
}

/**
 * Every single-factor improvement of `base` (PRD §12 "improving any factor").
 * Filling a missing factor with its best value is an improvement too: missing
 * scores 0 points (G-2), a known best value scores its full weight.
 */
function improvements(base: NaiveInput): Move[] {
  const moves: Move[] = [];

  if (base.submissionType !== 'new_business') {
    moves.push(move('submission_type', `submissionType → new_business`, base, { submissionType: 'new_business' }));
  }
  if (base.lineOfBusiness !== 'commercial_property') {
    moves.push(move('line_of_business', `lineOfBusiness → commercial_property`, base, { lineOfBusiness: 'commercial_property' }));
  }
  if (base.primaryState !== TARGET_STATE) {
    moves.push(move('primary_risk_state', `primaryState → ${TARGET_STATE}`, base, { primaryState: TARGET_STATE }));
  }
  moves.push(...towardMid('tiv', 'totalTiv', base, TIV_TARGET_MID));
  moves.push(...towardMid('total_premium', 'quotedPremium', base, PREMIUM_TARGET_MID));

  const pre = base.pctTivPre1990;
  const post = base.pctTivPost2010;
  if (!known(pre) && !known(post)) {
    moves.push(move('building_age', 'building age: missing → all post-2010', base, { pctTivPre1990: 0, pctTivPost2010: 1 }));
  } else {
    if (known(pre) && pre > 0) {
      moves.push(move('building_age', `pctTivPre1990: ${pre} → ${pre / 2}`, base, { pctTivPre1990: pre / 2 }));
      moves.push(move('building_age', `pctTivPre1990: ${pre} → 0`, base, { pctTivPre1990: 0 }));
    }
    const room = Math.min(1, Math.max(0, 1 - (known(pre) ? pre : 0)));
    if (known(post) && room > post) {
      moves.push(move('building_age', `pctTivPost2010: ${post} → ${room}`, base, { pctTivPost2010: room }));
    }
  }

  const ac = base.pctTivAcceptableConstruction;
  if (!known(ac)) {
    moves.push(move('construction_type', 'pctTivAcceptableConstruction: missing → 1', base, { pctTivAcceptableConstruction: 1 }));
  } else if (ac < 1) {
    moves.push(move('construction_type', `pctTivAcceptableConstruction: ${ac} → halfway to 1`, base, { pctTivAcceptableConstruction: ac + (1 - ac) / 2 }));
    moves.push(move('construction_type', `pctTivAcceptableConstruction: ${ac} → 1`, base, { pctTivAcceptableConstruction: 1 }));
  }

  const loss = base.fiveYearLoss;
  if (!known(loss)) {
    moves.push(move('loss_value', 'fiveYearLoss: missing → 0', base, { fiveYearLoss: 0 }));
  } else if (loss > 0) {
    moves.push(move('loss_value', `fiveYearLoss: ${loss} → ${loss / 2}`, base, { fiveYearLoss: loss / 2 }));
    moves.push(move('loss_value', `fiveYearLoss: ${loss} → 0`, base, { fiveYearLoss: 0 }));
  }

  if (base.hasOpenHighContradiction) {
    moves.push(move('contradiction', 'resolve the open HIGH contradiction', base, { hasOpenHighContradiction: false }));
  }
  return moves;
}

/** Direction the predicted premium must move in: +1 never cheaper, −1 never dearer. */
interface PremiumMove extends Move {
  readonly direction: 1 | -1;
}

function premiumMoves(base: NaiveInput): PremiumMove[] {
  const out: PremiumMove[] = [];
  const add = (m: Move, direction: 1 | -1): void => {
    out.push({ ...m, direction });
  };

  const tiv = base.totalTiv;
  if (known(tiv) && tiv > 0) {
    add(move('tiv', `totalTiv: ${tiv} → ${tiv * 1.5}`, base, { totalTiv: tiv * 1.5 }), 1);
    add(move('tiv', `totalTiv: ${tiv} → ${tiv / 2}`, base, { totalTiv: tiv / 2 }), -1);
  }
  const loss = base.fiveYearLoss;
  if (known(loss) && loss >= 0) {
    add(move('loss_value', `fiveYearLoss: ${loss} → ${loss * 2 + 50_000}`, base, { fiveYearLoss: loss * 2 + 50_000 }), 1);
    if (loss > 0) add(move('loss_value', `fiveYearLoss: ${loss} → ${loss / 2}`, base, { fiveYearLoss: loss / 2 }), -1);
  }

  const pre = base.pctTivPre1990;
  const post = base.pctTivPost2010;
  if (known(pre) && known(post) && pre >= 0 && post >= 0 && pre + post <= 1) {
    // Older stock is a worse class: never cheaper. Taking the share from the
    // post-2010 bucket first moves both age components the same (worse) way.
    if (pre < 1) {
      const nextPre = Math.min(1, pre + 0.25);
      const nextPost = Math.min(post, 1 - nextPre);
      add(move('building_age', `pctTivPre1990: ${pre} → ${nextPre}`, base, { pctTivPre1990: nextPre, pctTivPost2010: nextPost, anyBuildingPre1990: true }), 1);
    }
    if (post < 1) {
      const nextPost = Math.min(1, post + 0.25);
      const nextPre = Math.min(pre, 1 - nextPost);
      add(move('building_age', `pctTivPost2010: ${post} → ${nextPost}`, base, { pctTivPost2010: nextPost, pctTivPre1990: nextPre }), -1);
    }
  }

  const ac = base.pctTivAcceptableConstruction;
  if (known(ac) && ac >= 0 && ac <= 1) {
    if (ac < 1) add(move('construction_type', `pctTivAcceptableConstruction: ${ac} → ${Math.min(1, ac + 0.25)}`, base, { pctTivAcceptableConstruction: Math.min(1, ac + 0.25) }), -1);
    if (ac > 0) add(move('construction_type', `pctTivAcceptableConstruction: ${ac} → ${Math.max(0, ac - 0.25)}`, base, { pctTivAcceptableConstruction: Math.max(0, ac - 0.25) }), 1);
  }
  return out;
}

function tierOf(result: EngineResultView, id: NaiveFactorId): number | null {
  const t = result.tierValuesByFactor?.[id];
  return typeof t === 'number' && Number.isFinite(t) ? t : null;
}

/* ----------------------------------------------------------- invariants */

export const scoreMonotonicInEveryFactor: Invariant = (testCase, result) => {
  const name = 'scoreMonotonicInEveryFactor';
  const out: InvariantViolation[] = [];

  // Single-result half: score is the W-1 dot product (T-SPAN: over factors).
  const tiers = result.tierValuesByFactor ?? {};
  if (FACTOR_IDS.some((id) => id in tiers)) {
    let expected = 0;
    for (const id of FACTOR_IDS) expected += WEIGHTS[id] * (tierOf(result, id) ?? 0);
    expected *= 100;
    if (!(Math.abs(result.appetiteScore - expected) <= SCORE_TOLERANCE)) {
      out.push(
        violation(name, testCase, 'appetite score is not 100 × Σ w·t over the eight factors', result.appetiteScore, expected),
      );
    }
  }

  const probe = getInvariantProbe();
  if (!probe) return out;
  const base = result.appetiteScore;
  for (const m of improvements(testCase.input)) {
    let after: ProbedResult;
    try {
      after = probe(m.input);
    } catch (error) {
      out.push(violation(name, testCase, `engine threw after improving ${m.factor} (${m.label}): ${String(error)}`, 'throw', 'a result'));
      continue;
    }
    if (!(after.appetiteScore >= base - SCORE_TOLERANCE)) {
      out.push(
        violation(name, testCase, `improving ${m.factor} lowered the appetite score (${m.label})`, after.appetiteScore, `>= ${base}`),
      );
    }
    for (const id of FACTOR_IDS) {
      const before = tierOf(result, id);
      const now = tierOf(after, id);
      if (before !== null && now !== null && now < before - SCORE_TOLERANCE) {
        out.push(
          violation(name, testCase, `improving ${m.factor} lowered the ${id} tier (${m.label})`, now, `>= ${before}`),
        );
      }
    }
  }
  return out;
};

export const premiumMonotonicInEveryFactor: Invariant = (testCase, result) => {
  const name = 'premiumMonotonicInEveryFactor';
  const out: InvariantViolation[] = [];
  const probe = getInvariantProbe();
  if (!probe) return out;

  let base = (result as ProbedResult).predictedPremium;
  if (base === undefined) {
    try {
      base = probe(testCase.input).predictedPremium;
    } catch (error) {
      out.push(violation(name, testCase, `engine threw re-pricing the base input: ${String(error)}`, 'throw', 'a result'));
      return out;
    }
  }
  if (typeof base !== 'number' || !Number.isFinite(base)) return out;

  for (const m of premiumMoves(testCase.input)) {
    let after: number | null | undefined;
    try {
      after = probe(m.input).predictedPremium;
    } catch (error) {
      out.push(violation(name, testCase, `engine threw after moving ${m.factor} (${m.label}): ${String(error)}`, 'throw', 'a result'));
      continue;
    }
    if (typeof after !== 'number' || !Number.isFinite(after)) continue;
    const tol = Math.max(MONEY_TOLERANCE, Math.abs(base) * 1e-9);
    if (m.direction === 1 && after < base - tol) {
      out.push(violation(name, testCase, `worsening ${m.factor} made the premium cheaper (${m.label})`, after, `>= ${base}`));
    }
    if (m.direction === -1 && after > base + tol) {
      out.push(violation(name, testCase, `improving ${m.factor} made the premium dearer (${m.label})`, after, `<= ${base}`));
    }
  }
  return out;
};

export function monotonicSuite(): InvariantSuite {
  return {
    name: 'monotonic',
    invariants: [
      { name: 'scoreMonotonicInEveryFactor', check: scoreMonotonicInEveryFactor },
      { name: 'premiumMonotonicInEveryFactor', check: premiumMonotonicInEveryFactor },
    ],
  };
}
