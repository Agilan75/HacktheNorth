/** Stage 11 — voi. Body owned by Run 1 unit E09. */
import type {
  EvaluateResult,
  FeatureVector,
  Question,
  QuestionCandidate,
  Rulebook,
  SkippedField,
  VectorComponentSpec,
  VectorSpec,
  VoiResult,
} from '../types.js';
import { FACTOR_WEIGHTS } from '../constants.js';
import { isFiniteNumber, roundTo } from '../util/math.js';

/* -------------------------------------------------------------------------- */
/* Private helpers (HELPERS.md: private to this file, never exported)          */
/* -------------------------------------------------------------------------- */

/** Skip reasons, fixed strings so the console and the tests agree. */
const SKIP_ALREADY_ASKED = 'Already asked earlier in this sweep.';
const SKIP_ALREADY_KNOWN = 'Already known — no answer needed.';
const SKIP_UNSCORED = 'Not a scored field for this line of business.';
const SKIP_NO_VALUE = 'Cannot change the appetite score or resolve a rule.';
const SKIP_DUPLICATE = 'Duplicate question id — the first one is kept.';
const SKIP_NO_QUESTION = 'No question covers this field — ask the broker directly.';

/**
 * A field name in a question or a rule condition addresses a component either
 * by its stable `key` or by its canonical `source` path. Both are indexed here;
 * `key` wins on a collision because rules address components by key.
 */
function fieldIndex(spec: VectorSpec): ReadonlyMap<string, VectorComponentSpec> {
  const byField = new Map<string, VectorComponentSpec>();
  for (const c of spec.components) {
    if (!byField.has(c.source)) byField.set(c.source, c);
  }
  for (const c of spec.components) byField.set(c.key, c);
  return byField;
}

/** Weight of an appetite factor: rulebook first, then the evaluation, then W-1. */
function weightOf(
  factor: string | null,
  rulebook: Rulebook,
  evaluated: EvaluateResult,
): number {
  if (factor === null) return 0;
  const fromBook = rulebook.weights[factor];
  if (isFiniteNumber(fromBook)) return fromBook;
  const outcome = evaluated.factors.find((f) => f.factor === factor);
  if (outcome !== undefined && isFiniteNumber(outcome.weight)) return outcome.weight;
  const fromConstants = (FACTOR_WEIGHTS as Readonly<Record<string, number>>)[factor];
  return isFiniteNumber(fromConstants) ? fromConstants : 0;
}

/**
 * Rules still undetermined while component `index` is missing: the rule has not
 * fired and one of its conditions tests that component with a value comparison.
 * `exists` / `missing` conditions are excluded — absence already decides those.
 */
function undeterminedRulesFor(
  index: number,
  rulebook: Rulebook,
  firedRuleIds: ReadonlySet<string>,
  byField: ReadonlyMap<string, VectorComponentSpec>,
): string[] {
  const out: string[] = [];
  for (const rule of rulebook.rules) {
    if (firedRuleIds.has(rule.id)) continue;
    for (const cond of rule.when) {
      if (cond.op === 'exists' || cond.op === 'missing') continue;
      const comp = byField.get(cond.field);
      if (comp !== undefined && comp.index === index) {
        out.push(rule.id);
        break;
      }
    }
  }
  return out;
}

function reasonFor(
  comp: VectorComponentSpec,
  swing: number,
  weight: number,
  ruleCount: number,
): string {
  const rules =
    ruleCount > 0
      ? ` and leaves ${ruleCount} rule${ruleCount === 1 ? '' : 's'} undetermined`
      : '';
  if (swing > 0) {
    return `${comp.label} is unknown: it decides the ${String(
      comp.factor,
    )} factor (weight ${String(weight)}), worth up to ${swing.toFixed(
      1,
    )} appetite points${rules}.`;
  }
  return `${comp.label} is unknown: it cannot move the appetite score but${
    rules === '' ? ' resolves nothing' : rules
  }.`;
}

/* -------------------------------------------------------------------------- */
/* Stage                                                                      */
/* -------------------------------------------------------------------------- */

export function voi(
  vector: FeatureVector,
  spec: VectorSpec,
  rulebook: Rulebook,
  evaluated: EvaluateResult,
  questions: readonly Question[],
  askedQuestionIds?: readonly string[],
): VoiResult {
  const asked = new Set<string>(askedQuestionIds ?? []);
  const byField = fieldIndex(spec);
  const firedRuleIds = new Set<string>(evaluated.firedRules.map((r) => r.ruleId));

  const ranked: QuestionCandidate[] = [];
  const skipped: SkippedField[] = [];
  const seenQuestionIds = new Set<string>();
  const coveredFields = new Set<string>();
  /** Component index -> its ranking tiebreakers, for the sort below. */
  const orderOf = new Map<string, { index: number; required: boolean }>();

  for (const question of questions) {
    if (seenQuestionIds.has(question.id)) {
      skipped.push({ field: question.field, reason: SKIP_DUPLICATE });
      continue;
    }
    seenQuestionIds.add(question.id);

    if (asked.has(question.id)) {
      skipped.push({ field: question.field, reason: SKIP_ALREADY_ASKED });
      continue;
    }

    const comp = byField.get(question.field);
    if (comp === undefined) {
      skipped.push({ field: question.field, reason: SKIP_UNSCORED });
      continue;
    }
    coveredFields.add(comp.key);
    coveredFields.add(comp.source);

    if (vector.m[comp.index] === 1) {
      skipped.push({ field: question.field, reason: SKIP_ALREADY_KNOWN });
      continue;
    }

    const undeterminedRuleIds = undeterminedRulesFor(
      comp.index,
      rulebook,
      firedRuleIds,
      byField,
    );

    // The factor is already decided when a sibling component supplies its tier
    // (T-SPAN), so answering this question cannot move the score.
    const outcome = evaluated.factors.find((f) => f.factor === comp.factor);
    const factorKnown = outcome !== undefined && outcome.known;
    const weight = weightOf(comp.factor, rulebook, evaluated);
    // Tier values run 0..1, so the largest possible swing is 100 × weight.
    const expectedScoreSwing =
      comp.appetiteFactor && !factorKnown ? roundTo(100 * weight, 6) : 0;

    if (expectedScoreSwing === 0 && undeterminedRuleIds.length === 0) {
      skipped.push({ field: question.field, reason: SKIP_NO_VALUE });
      continue;
    }

    orderOf.set(question.id, { index: comp.index, required: comp.required });
    ranked.push({
      question,
      undeterminedRuleIds,
      expectedScoreSwing,
      weight: comp.appetiteFactor ? weight : 0,
      reason: reasonFor(comp, expectedScoreSwing, weight, undeterminedRuleIds.length),
    });
  }

  ranked.sort((a, b) => {
    if (a.expectedScoreSwing !== b.expectedScoreSwing) {
      return b.expectedScoreSwing - a.expectedScoreSwing;
    }
    if (a.undeterminedRuleIds.length !== b.undeterminedRuleIds.length) {
      return b.undeterminedRuleIds.length - a.undeterminedRuleIds.length;
    }
    const oa = orderOf.get(a.question.id);
    const ob = orderOf.get(b.question.id);
    const ra = oa?.required === true ? 0 : 1;
    const rb = ob?.required === true ? 0 : 1;
    if (ra !== rb) return ra - rb;
    const ia = oa?.index ?? Number.MAX_SAFE_INTEGER;
    const ib = ob?.index ?? Number.MAX_SAFE_INTEGER;
    if (ia !== ib) return ia - ib;
    return a.question.id < b.question.id ? -1 : a.question.id > b.question.id ? 1 : 0;
  });

  // Missing fields nobody can ask about still have to be explained.
  for (const missing of evaluated.missingFields) {
    if (coveredFields.has(missing.componentKey) || coveredFields.has(missing.canonicalPath)) {
      continue;
    }
    skipped.push({ field: missing.componentKey, reason: SKIP_NO_QUESTION });
  }

  return {
    nextQuestion: ranked.length > 0 ? ranked[0]!.question : null,
    ranked,
    skipped,
    askedCount: asked.size,
  };
}
