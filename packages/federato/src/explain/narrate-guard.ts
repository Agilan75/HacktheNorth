/**
 * Checks Gemini's `narrate` output polished the wording only: every number and
 * the recommendation must survive unchanged, or the template text is kept.
 * Body owned by Run 1 unit F12.
 */
import type { Explanation, NarrateGuardResult, Recommendation } from '../types';

/**
 * Word stems per recommendation, so "accepting" or "declined" still count.
 * `investigat` also catches "investigation".
 */
const RECOMMENDATION_PATTERN: Readonly<Record<Recommendation, RegExp>> = {
  accept: /\baccept(?:s|ed|ing|ance)?\b/i,
  review: /\breview(?:s|ed|ing)?\b/i,
  decline: /\bdeclin(?:e|es|ed|ing)\b/i,
  investigate: /\binvestigat(?:e|es|ed|ing|ion)\b/i,
};

const RECOMMENDATIONS: readonly Recommendation[] = ['accept', 'review', 'decline', 'investigate'];

const MULTIPLIER: Readonly<Record<string, number>> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  million: 1e6,
  b: 1e9,
  billion: 1e9,
};

/**
 * One number: optional sign (only when not glued to a word, so `SUB-1001` and
 * `5-year` stay positive), optional `$`, grouped or plain digits, optional
 * decimals, then an optional K/M/B (glued) or thousand/million/billion suffix.
 */
const NUMBER_RE =
  /(?<![\w.])(-(?=\$?\d))?\$?(\d{1,3}(?:,\d{3})+(?!\d)|\d+)(\.\d+)?(?:\s?(thousand|million|billion)\b|([kmb])(?![a-z]))?/gi;

/** Pulls every number out of prose, normalized ($1.2M and 1200000 match). */
export function extractNumbers(text: string): readonly number[] {
  if (typeof text !== 'string' || text.length === 0) return [];
  const out: number[] = [];
  for (const match of text.matchAll(NUMBER_RE)) {
    const [, sign, digits, decimals, word, letter] = match;
    if (digits === undefined) continue;
    let value = Number(`${digits.replace(/,/g, '')}${decimals ?? ''}`);
    const suffix = (word ?? letter)?.toLowerCase();
    if (suffix !== undefined) value *= MULTIPLIER[suffix] ?? 1;
    if (sign === '-') value = -value;
    if (Number.isFinite(value)) out.push(value);
  }
  return out;
}

function sameNumber(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

function display(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(12)));
}

export function narrateGuard(explanation: Explanation, polished: string): NarrateGuardResult {
  const template = explanation.template;
  const problems: string[] = [];
  const changedNumbers: string[] = [];
  const text = typeof polished === 'string' ? polished.trim() : '';

  if (text.length === 0) {
    return {
      ok: false,
      text: template,
      changedNumbers: [],
      recommendationChanged: true,
      problems: ['narration is empty'],
    };
  }

  const found = extractNumbers(text);

  // Every number the template carries must survive.
  const expected = new Map<string, number>(Object.entries(explanation.numbers));
  let extra = 0;
  for (const n of extractNumbers(template)) {
    if ([...expected.values()].some((v) => sameNumber(v, n))) continue;
    expected.set(`template.${extra}`, n);
    extra += 1;
  }
  for (const [key, value] of expected) {
    if (!found.some((n) => sameNumber(n, value))) {
      changedNumbers.push(key);
      problems.push(`number ${key} = ${display(value)} is missing or changed`);
    }
  }

  // No number may appear that the template did not have.
  const expectedValues = [...expected.values()];
  for (const n of found) {
    if (expectedValues.some((v) => sameNumber(v, n))) continue;
    changedNumbers.push(`unexpected:${display(n)}`);
    problems.push(`number ${display(n)} does not appear in the template`);
  }

  // The recommendation must still be stated, and no other one introduced.
  const rec = explanation.recommendation;
  let recommendationChanged = false;
  if (!RECOMMENDATION_PATTERN[rec].test(text)) {
    recommendationChanged = true;
    problems.push(`recommendation "${rec}" is no longer stated`);
  }
  for (const other of RECOMMENDATIONS) {
    if (other === rec) continue;
    const pattern = RECOMMENDATION_PATTERN[other];
    if (pattern.test(text) && !pattern.test(template)) {
      recommendationChanged = true;
      problems.push(`narration introduces recommendation "${other}"`);
    }
  }

  const ok = problems.length === 0;
  return {
    ok,
    text: ok ? text : template,
    changedNumbers,
    recommendationChanged,
    problems,
  };
}
