/**
 * The deterministic explanation template (PRD §7.7). Never LLM output: all 158
 * explanations exist instantly and can never contradict the numbers.
 * Body owned by Run 1 unit F12.
 */
import type {
  AppetiteFactorId,
  Citation,
  EngineResult,
  FactorOutcome,
  FlipMove,
} from '@retrofit/engine';
import { formatMoney, formatPercent, formatScore, formatTiv } from '@retrofit/contracts';
import type { Explanation, ExplanationFactorNote, Recommendation } from '../types';
import { extractNumbers } from './narrate-guard';

export interface ExplainInput {
  readonly result: EngineResult;
  readonly insuredName?: string | null;
  /** 1-based queue position, when known. */
  readonly rank?: number | null;
}

/* -------------------------------------------------------------------------- */
/* Private wording tables                                                      */
/* -------------------------------------------------------------------------- */

/** Short factor names, as the mixed-case sentence uses them (PRD 7.7). */
const FACTOR_LABEL: Readonly<Record<AppetiteFactorId, string>> = {
  submission_type: 'submission type',
  line_of_business: 'line of business',
  primary_risk_state: 'state',
  tiv: 'TIV',
  total_premium: 'premium',
  building_age: 'building age',
  construction_type: 'construction',
  loss_value: 'loss history',
};

/** Vector component key -> plain label, for missing-data and flip wording. */
const COMPONENT_LABEL: Readonly<Record<string, string>> = {
  isNewBusiness: 'submission type',
  isPropertyLine: 'line of business',
  stateTier: 'primary state',
  totalTiv: 'TIV',
  quotedPremium: 'premium',
  pctTivPre1990: 'building age',
  pctTivPost2010: 'building age',
  pctTivAcceptableConstruction: 'construction',
  fiveYearLoss: 'loss history',
  pctTivSprinklered: 'sprinklered share of TIV',
  tivWeightedProtectionClass: 'protection class',
};

const MONEY_COMPONENTS = new Set(['quotedPremium', 'fiveYearLoss']);
const SHARE_COMPONENTS = new Set([
  'pctTivPre1990',
  'pctTivPost2010',
  'pctTivAcceptableConstruction',
  'pctTivSprinklered',
]);

function factorLabel(factor: string): string {
  return (FACTOR_LABEL as Readonly<Record<string, string>>)[factor] ?? humanize(factor);
}

function componentLabel(key: string): string {
  return COMPONENT_LABEL[key] ?? humanize(key);
}

function humanize(key: string): string {
  return key
    .replace(/[_.-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
}

/** "a", "a and b", "a, b and c" — no Oxford comma, matching PRD 7.7's example. */
function joinList(items: readonly string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0] as string;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] as string}`;
}

function uniq(items: readonly string[]): string[] {
  return [...new Set(items)];
}

function capitalize(text: string): string {
  return text.length === 0 ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function formatComponentValue(key: string, value: number): string {
  if (key === 'totalTiv') return formatTiv(value);
  if (MONEY_COMPONENTS.has(key)) return formatMoney(value);
  if (SHARE_COMPONENTS.has(key)) return formatPercent(value);
  if (Number.isInteger(value)) return String(value);
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/* -------------------------------------------------------------------------- */
/* Factor partitions                                                           */
/* -------------------------------------------------------------------------- */

/** Known factors with tier value > 0 (a refer flag keeps 0.6, so it is in). */
function inFactors(result: EngineResult): FactorOutcome[] {
  return result.evaluate.factors.filter(
    (f) => f.known && !f.knockout && f.tierValue !== null && f.tierValue > 0,
  );
}

/** Known factors at tier value 0: the knockouts. */
function outFactors(result: EngineResult): FactorOutcome[] {
  return result.evaluate.factors.filter(
    (f) => f.known && (f.knockout || f.tierValue === 0),
  );
}

function missingLabels(result: EngineResult): string[] {
  const keys = result.verdict.missingComponentKeys;
  if (keys.length > 0) return uniq(keys.map(componentLabel));
  return uniq(
    result.evaluate.missingFields.filter((m) => m.required).map((m) => componentLabel(m.componentKey)),
  );
}

function hasMissing(result: EngineResult): boolean {
  return (
    result.verdict.missingComponentKeys.length > 0 ||
    result.evaluate.missingFields.some((m) => m.required)
  );
}

function openHighContradictionPaths(result: EngineResult): string[] {
  const ids = new Set(result.verdict.openHighContradictionIds);
  const fromIds = result.contradictions
    .filter((c) => ids.has(c.id))
    .map((c) => humanize(c.canonicalPath));
  if (fromIds.length > 0) return uniq(fromIds);
  return uniq(
    result.contradictions
      .filter((c) => c.status === 'open' && c.severity === 'HIGH')
      .map((c) => humanize(c.canonicalPath)),
  );
}

/* -------------------------------------------------------------------------- */
/* Public: recommendation                                                      */
/* -------------------------------------------------------------------------- */

/**
 * accept / review / decline / investigate, from the verdict and the flip.
 *
 * - FIT → accept.
 * - DOES_NOT_FIT with a flip (one or two movable changes reach FIT) → review.
 * - DOES_NOT_FIT with no flip → decline.
 * - REFER for missing data or an open HIGH contradiction → investigate.
 * - REFER on a refer rule alone (e.g. R-AGE-REFER) → review.
 */
export function recommendationFor(result: EngineResult): Recommendation {
  const { verdict } = result.verdict;
  if (verdict === 'FIT') return 'accept';
  if (verdict === 'DOES_NOT_FIT') {
    const flip = result.flip.flip;
    return flip !== null && flip.moves.length > 0 && flip.verdictAfter === 'FIT'
      ? 'review'
      : 'decline';
  }
  if (hasMissing(result) || openHighContradictionPaths(result).length > 0) return 'investigate';
  return 'review';
}

/* -------------------------------------------------------------------------- */
/* Public: mixed-case sentence                                                 */
/* -------------------------------------------------------------------------- */

/** "In appetite on TIV and state, out on premium." */
export function mixedCaseSentence(result: EngineResult): string | null {
  const ins = inFactors(result);
  const outs = outFactors(result);
  if (ins.length === 0 || outs.length === 0) return null;
  const inText = joinList(ins.map((f) => factorLabel(f.factor)));
  const outText = joinList(outs.map((f) => factorLabel(f.factor)));
  return `In appetite on ${inText}, out on ${outText}.`;
}

/* -------------------------------------------------------------------------- */
/* Public: explain                                                             */
/* -------------------------------------------------------------------------- */

function factorValueText(result: EngineResult, factor: AppetiteFactorId): string {
  const r = result.rollup;
  switch (factor) {
    case 'submission_type': {
      const v = result.canonical.submissionType?.[0]?.value;
      return v === undefined ? '—' : humanize(v);
    }
    case 'line_of_business':
      return humanize(result.canonical.lineOfBusiness);
    case 'primary_risk_state':
      return r.primaryState ?? '—';
    case 'tiv':
      return formatTiv(r.totalTiv);
    case 'total_premium':
      return formatMoney(result.price.quotedPremium);
    case 'building_age':
      return r.pctTivPre1990 === null ? '—' : `${formatPercent(r.pctTivPre1990)} of TIV pre-1990`;
    case 'construction_type':
      return r.pctTivAcceptableConstruction === null
        ? '—'
        : `${formatPercent(r.pctTivAcceptableConstruction)} of TIV acceptable construction`;
    case 'loss_value':
      return formatMoney(r.fiveYearLoss);
    default:
      return '—';
  }
}

function note(result: EngineResult, f: FactorOutcome, inAppetite: boolean): ExplanationFactorNote {
  return {
    factor: f.factor,
    label: factorLabel(f.factor),
    inAppetite,
    tier: f.tier,
    valueText: factorValueText(result, f.factor),
  };
}

function subjectOf(input: ExplainInput): string {
  const given = input.insuredName?.trim();
  if (given) return given;
  const canonical = input.result.canonical.insured.name?.[0]?.value?.trim();
  if (canonical) return canonical;
  return `Submission ${input.result.id}`;
}

function verdictClause(result: EngineResult): string {
  switch (result.verdict.verdict) {
    case 'FIT':
      return 'fits appetite';
    case 'REFER':
      return 'is referred';
    case 'DOES_NOT_FIT':
      return 'does not fit appetite';
  }
}

function moveText(move: FlipMove): string {
  const label = move.label?.trim() ? move.label.trim() : componentLabel(move.componentKey);
  return `${label} to ${formatComponentValue(move.componentKey, move.to)}`;
}

/** Sentence 1 — appetite match and the key numbers. */
function headline(input: ExplainInput): string {
  const { result } = input;
  const score = formatScore(result.evaluate.appetiteScore);
  const rank =
    typeof input.rank === 'number' && Number.isFinite(input.rank) && input.rank >= 1
      ? `, ranked #${Math.floor(input.rank)} in the queue`
      : '';
  const parts: string[] = [];
  const price = result.price;
  if (result.rollup.totalTiv !== null) parts.push(`TIV ${formatTiv(result.rollup.totalTiv)}`);
  if (price.quotedPremium !== null) {
    const predicted =
      price.lineOfBusiness === 'commercial_property' && price.predictedPremium !== null
        ? ` against a predicted ${formatMoney(price.predictedPremium)}`
        : '';
    parts.push(`quoted premium ${formatMoney(price.quotedPremium)}${predicted}`);
  } else if (price.lineOfBusiness === 'tenant' && price.predictedMonthlyPremium !== null) {
    parts.push(`estimated premium ${formatMoney(price.predictedMonthlyPremium, { decimals: 2 })} a month`);
  } else if (price.predictedPremium !== null) {
    parts.push(`predicted premium ${formatMoney(price.predictedPremium)}`);
  }
  if (result.lineOfBusiness === 'commercial_property' && result.rollup.fiveYearLoss !== null) {
    parts.push(`5-year losses ${formatMoney(result.rollup.fiveYearLoss)}`);
  }
  const numbers = parts.length > 0 ? `: ${parts.join(', ')}` : '';
  return `${subjectOf(input)} ${verdictClause(result)} with an appetite score of ${score}/100${rank}${numbers}.`;
}

/** Sentence 2 — which factors are in and out, plus what must be named (I-1, I-3). */
function factorSentence(result: EngineResult): string | null {
  const clauses: string[] = [];
  const mixed = mixedCaseSentence(result);
  const ins = inFactors(result);
  const outs = outFactors(result);
  if (mixed !== null) {
    clauses.push(mixed.slice(0, -1));
  } else if (outs.length > 0) {
    clauses.push(`out of appetite on ${joinList(outs.map((f) => factorLabel(f.factor)))}`);
  } else if (ins.length > 0) {
    clauses.push(
      ins.length === result.evaluate.factors.length
        ? 'in appetite on every factor'
        : 'in appetite on every known factor',
    );
  } else if (result.evaluate.factors.length > 0) {
    clauses.push('no appetite factor could be assessed');
  }

  if (hasMissing(result)) clauses.push(`missing ${joinList(missingLabels(result))}`);

  const contradictions = openHighContradictionPaths(result);
  if (contradictions.length > 0) clauses.push(`conflicting values on ${joinList(contradictions)}`);

  const referPre1990 =
    result.evaluate.referFactors.includes('building_age') && result.rollup.pre1990BuildingIds.length > 0;
  if (referPre1990) {
    const ids = result.rollup.pre1990BuildingIds;
    clauses.push(
      `${ids.length === 1 ? 'building' : 'buildings'} ${joinList([...ids])} ${ids.length === 1 ? 'predates' : 'predate'} 1990`,
    );
  }

  // I-1: the primary state is the largest TIV share; every other state is named.
  const shares = result.rollup.stateShares;
  if (result.rollup.primaryState !== null && shares.length > 1) {
    const primary = shares.find((s) => s.state === result.rollup.primaryState) ?? shares[0];
    const others = shares.filter((s) => s !== primary);
    if (primary) {
      clauses.push(
        `primary state ${primary.state} carries ${formatPercent(primary.share)} of TIV, with ${joinList(
          others.map((s) => `${s.state} ${formatPercent(s.share)}`),
        )}`,
      );
    }
  }

  // I-3: named only when the engine surfaced it (the tier depended on it).
  if (result.interpretations.some((i) => i.id === 'I-3')) {
    clauses.push('fire-resistive construction is treated as acceptable, an assumption');
  }

  if (clauses.length === 0) {
    const reason = result.verdict.reasons[0];
    return reason ? (/[.!?]$/.test(reason.trim()) ? reason.trim() : `${reason.trim()}.`) : null;
  }
  return `${capitalize(clauses.join('; '))}.`;
}

/** Sentence 3 — the recommendation and its one-line reason. */
function recommendationSentence(result: EngineResult, rec: Recommendation): string {
  let why: string;
  switch (rec) {
    case 'accept':
      why = 'every appetite factor is met and nothing is missing';
      break;
    case 'decline': {
      const outs = uniq(outFactors(result).map((f) => factorLabel(f.factor)));
      const immovable = result.flip.blockedByImmovable.length > 0;
      why =
        outs.length > 0
          ? `it is knocked out on ${joinList(outs)}${immovable ? ', which the insured cannot change' : ''}`
          : 'no change of one or two factors reaches appetite';
      break;
    }
    case 'review': {
      const flip = result.flip.flip;
      if (result.verdict.verdict === 'DOES_NOT_FIT' && flip !== null && flip.moves.length > 0) {
        const count = flip.moves.length === 1 ? 'one change reaches' : 'two changes reach';
        why = `${count} appetite: ${joinList(flip.moves.map(moveText))}, lifting the score to ${formatScore(
          flip.scoreAfter,
        )}`;
      } else {
        const refers = uniq(result.evaluate.referFactors.map((f) => factorLabel(f)));
        why =
          refers.length > 0
            ? `a referral rule fired on ${joinList(refers)}`
            : 'the account needs an underwriter decision';
      }
      break;
    }
    case 'investigate': {
      const needs: string[] = [];
      if (hasMissing(result)) needs.push(`the missing ${joinList(missingLabels(result))}`);
      const contradictions = openHighContradictionPaths(result);
      if (contradictions.length > 0) needs.push(`the conflict on ${joinList(contradictions)}`);
      why = needs.length > 0 ? `the broker must supply ${joinList(needs)}` : 'data is incomplete';
      break;
    }
  }
  return `Recommendation: ${rec}, because ${why}.`;
}

function collectCitations(result: EngineResult): Citation[] {
  const out: Citation[] = [];
  const seen = new Set<string>();
  const add = (c: Citation | null | undefined): void => {
    if (!c) return;
    const key = `${c.doc}\u0000${c.section}\u0000${c.quote}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(c);
  };
  add(result.verdict.decidingRule?.citation);
  for (const f of outFactors(result)) add(f.citation);
  for (const f of result.evaluate.factors) if (f.refer) add(f.citation);
  const multiState = result.rollup.stateShares.length > 1;
  for (const i of result.interpretations) {
    if (i.id === 'I-3' || (i.id === 'I-1' && multiState)) add(i.citation);
  }
  return out;
}

/** Tolerant equality for numbers read back out of prose. */
function sameNumber(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

function numberOf(formatted: string): number | null {
  const found = extractNumbers(formatted);
  return found.length > 0 ? (found[0] as number) : null;
}

/**
 * Every number in `text`, keyed. Named keys carry the value exactly as it is
 * displayed (so `$65.0M` is 65000000); anything else found is keyed `n<i>`.
 */
function collectNumbers(result: EngineResult, rank: number | null | undefined, text: string): Record<string, number> {
  const numbers: Record<string, number> = {};
  const put = (key: string, formatted: string | null): void => {
    if (formatted === null) return;
    const n = numberOf(formatted);
    if (n !== null) numbers[key] = n;
  };
  put('appetiteScore', formatScore(result.evaluate.appetiteScore));
  if (typeof rank === 'number' && Number.isFinite(rank) && rank >= 1) numbers.rank = Math.floor(rank);
  if (result.rollup.totalTiv !== null) put('totalTiv', formatTiv(result.rollup.totalTiv));
  const price = result.price;
  if (price.quotedPremium !== null) put('quotedPremium', formatMoney(price.quotedPremium));
  if (price.predictedPremium !== null) put('predictedPremium', formatMoney(price.predictedPremium));
  if (price.predictedMonthlyPremium !== null) {
    put('predictedMonthlyPremium', formatMoney(price.predictedMonthlyPremium, { decimals: 2 }));
  }
  if (result.rollup.fiveYearLoss !== null) put('fiveYearLoss', formatMoney(result.rollup.fiveYearLoss));
  const flip = result.flip.flip;
  if (flip !== null) {
    put('flipScoreAfter', formatScore(flip.scoreAfter));
    for (const m of flip.moves) put(`flip.${m.componentKey}`, formatComponentValue(m.componentKey, m.to));
  }
  for (const s of result.rollup.stateShares) put(`stateShare.${s.state}`, formatPercent(s.share));

  // Keep only named numbers that actually appear, then key the rest.
  const inText = [...extractNumbers(text)];
  const kept: Record<string, number> = {};
  for (const [key, value] of Object.entries(numbers)) {
    if (inText.some((n) => sameNumber(n, value))) kept[key] = value;
  }
  const keptValues = Object.values(kept);
  let i = 0;
  for (const n of inText) {
    if (keptValues.some((v) => sameNumber(v, n))) continue;
    kept[`n${i}`] = n;
    keptValues.push(n);
    i += 1;
  }
  return kept;
}

export function explain(input: ExplainInput): Explanation {
  const { result } = input;
  const recommendation = recommendationFor(result);
  const sentences = [
    headline(input),
    factorSentence(result),
    recommendationSentence(result, recommendation),
  ].filter((s): s is string => s !== null && s.length > 0);
  const text = sentences.join(' ');

  const ins = inFactors(result);
  const outs = outFactors(result);

  return {
    submissionId: result.id,
    text,
    sentences,
    recommendation,
    mixed: ins.length > 0 && outs.length > 0,
    inAppetite: ins.map((f) => note(result, f, true)),
    outOfAppetite: outs.map((f) => note(result, f, false)),
    numbers: collectNumbers(result, input.rank, text),
    citations: collectCitations(result),
    template: text,
    narrated: false,
  };
}
