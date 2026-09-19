/** Stage 9 — verdict. Body owned by Run 1 unit E06. */
import type {
  AppetiteFactorId,
  Contradiction,
  DecidingRule,
  EvaluateResult,
  FactorOutcome,
  FlipResult,
  Verdict,
  VerdictResult,
} from '../types.js';
import { APPETITE_FACTORS } from '../constants.js';
import { isFiniteNumber } from '../util/math.js';

/* -------------------------------------------------------------------------- */
/* Private helpers (HELPERS.md: private to this file, never exported)          */
/* -------------------------------------------------------------------------- */

/** Human labels for the eight appetite factors, used only in `reasons`. */
const FACTOR_LABEL: Readonly<Record<AppetiteFactorId, string>> = {
  submission_type: 'Submission type',
  line_of_business: 'Line of business',
  primary_risk_state: 'Primary risk state',
  tiv: 'TIV',
  total_premium: 'Total premium',
  building_age: 'Building age',
  construction_type: 'Construction type',
  loss_value: 'Loss value',
};

const TIER_LABEL: Readonly<Record<string, string>> = {
  target: 'Target',
  acceptable: 'Acceptable',
  not_acceptable: 'Not Acceptable',
  refer: 'Refer',
};

function labelFor(factor: AppetiteFactorId): string {
  return FACTOR_LABEL[factor] ?? factor;
}

function factorOrder(id: AppetiteFactorId): number {
  const i = APPETITE_FACTORS.indexOf(id);
  return i < 0 ? APPETITE_FACTORS.length : i;
}

/**
 * INTERPRETATIONS V-8, stated literally:
 * (a) any knockout → the knockout factor earliest in the §2 factor order;
 * (b) otherwise, among KNOWN factors, the lowest `tierValue`, ties by highest
 *     weight, further ties by the §2 factor order;
 * (c) `null` when every appetite factor is missing.
 *
 * A fired refer rule never changes it. `evaluate.ts` re-derives the same rule
 * privately, because HELPERS.md forbids inventing a fourth shared helper.
 */
function decidingFactor(factors: readonly FactorOutcome[]): FactorOutcome | null {
  const knockouts = factors.filter((f) => f.knockout);
  if (knockouts.length > 0) {
    let best = knockouts[0] as FactorOutcome;
    for (const candidate of knockouts) {
      if (factorOrder(candidate.factor) < factorOrder(best.factor)) best = candidate;
    }
    return best;
  }

  const known = factors.filter((f) => f.known && isFiniteNumber(f.tierValue));
  if (known.length === 0) return null;

  let best = known[0] as FactorOutcome;
  for (const candidate of known.slice(1)) {
    const a = candidate.tierValue as number;
    const b = best.tierValue as number;
    if (a < b) {
      best = candidate;
      continue;
    }
    if (a > b) continue;
    if (candidate.weight > best.weight) {
      best = candidate;
      continue;
    }
    if (candidate.weight < best.weight) continue;
    if (factorOrder(candidate.factor) < factorOrder(best.factor)) best = candidate;
  }
  return best;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/* -------------------------------------------------------------------------- */
/* Stage                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * knockout -> DOES_NOT_FIT; else completeness < 100 or an open HIGH
 * contradiction or a fired refer rule -> REFER; else FIT.
 * `flip` is optional: when supplied it fills `distanceToAppetite`.
 */
export function verdict(
  evaluated: EvaluateResult,
  contradictions: readonly Contradiction[],
  flip?: FlipResult,
): VerdictResult {
  const openHighContradictionIds = contradictions
    .filter((c) => c !== undefined && c !== null && c.status === 'open' && c.severity === 'HIGH')
    .map((c) => c.id);

  const missingComponentKeys = evaluated.missingFields.map((f) => f.componentKey);
  const missingRequired = evaluated.missingFields.filter((f) => f.required);

  // A refer rule may also come from `rules/extensions.json`, whose factor is not
  // one of the eight appetite factors and so never reaches `referFactors`.
  const referRuleFired =
    evaluated.referFactors.length > 0 || evaluated.firedRules.some((r) => r.tier === 'refer');

  // V-1 .. V-5, in order.
  let decided: Verdict;
  if (evaluated.knockout) decided = 'DOES_NOT_FIT';
  else if (evaluated.completeness < 100) decided = 'REFER';
  else if (openHighContradictionIds.length > 0) decided = 'REFER';
  else if (referRuleFired) decided = 'REFER';
  else decided = 'FIT';

  /* ---- deciding rule (V-8) ---------------------------------------------- */

  const deciding = decidingFactor(evaluated.factors);
  let decidingRule: DecidingRule | null = null;
  if (deciding !== null && deciding.ruleId !== null && deciding.citation !== null) {
    decidingRule = {
      ruleId: deciding.ruleId,
      factor: deciding.factor,
      tier: deciding.tier ?? 'acceptable',
      citation: deciding.citation,
    };
  }

  /* ---- reasons, most-deciding first -------------------------------------- */

  const reasons: string[] = [];

  if (deciding !== null) {
    const tierText = TIER_LABEL[deciding.tier ?? 'acceptable'] ?? 'Acceptable';
    const cite =
      deciding.citation === null
        ? ''
        : ` (${deciding.citation.doc}, ${deciding.citation.section})`;
    reasons.push(
      deciding.knockout
        ? `${labelFor(deciding.factor)} is Not Acceptable, which knocks the submission out of appetite${cite}.`
        : `${labelFor(deciding.factor)} is the lowest-scoring factor at ${tierText}${cite}.`,
    );
  }

  for (const factor of evaluated.knockoutFactors) {
    if (deciding !== null && factor === deciding.factor) continue;
    reasons.push(`${labelFor(factor)} is also Not Acceptable.`);
  }

  if (missingRequired.length > 0) {
    reasons.push(
      `${missingRequired.length} required ${plural(missingRequired.length, 'field is', 'fields are')} missing, so completeness is ${evaluated.completeness.toFixed(1)}%.`,
    );
  }

  if (openHighContradictionIds.length > 0) {
    reasons.push(
      `${openHighContradictionIds.length} open high-severity ${plural(openHighContradictionIds.length, 'contradiction', 'contradictions')} must be resolved first.`,
    );
  }

  for (const factor of evaluated.referFactors) {
    reasons.push(`${labelFor(factor)} raises a referral.`);
  }

  for (const rule of evaluated.firedRules) {
    if (rule.tier !== 'refer') continue;
    if ((evaluated.referFactors as readonly string[]).includes(rule.factor)) continue;
    reasons.push(`Rule ${rule.ruleId} raises a referral (${rule.citation.doc}, ${rule.citation.section}).`);
  }

  if (decided === 'FIT' && reasons.length === 0) {
    reasons.push('Every appetite factor is known and within appetite.');
  }

  /* ---- distance to appetite (V-9) ---------------------------------------- */

  let distanceToAppetite: 0 | 1 | 2 | null;
  if (decided === 'FIT') {
    distanceToAppetite = 0;
  } else if (flip === undefined || flip === null || flip.flip === null) {
    distanceToAppetite = null;
  } else {
    const moves = flip.flip.moves.length;
    distanceToAppetite = moves === 1 ? 1 : moves === 2 ? 2 : moves === 0 ? 0 : null;
  }

  return {
    verdict: decided,
    decidingRule,
    reasons,
    distanceToAppetite,
    openHighContradictionIds,
    missingComponentKeys,
  };
}
