/**
 * Gemini call 4 of 8: `narrate`. Polished wording only — every number and the
 * recommendation are checked to survive. Body owned by Run 1 unit A04.
 *
 * The survival check is built into the zod schema for this one request, so a
 * rewrite that drops, changes or invents a number fails validation, costs the
 * one retry in `generateJson`, and then falls back to the template. The call
 * never throws: narration is polish, and the template is always a valid answer.
 * `narrate-guard` (F12) runs again downstream over the stored explanation.
 */
import { z } from 'zod';
import type { NarrateInput, NarrateOutput } from '@retrofit/contracts';
import { generateJson } from '../generate-json';
import type { LlmProvider, LlmSchema, ResponseSchemaNode } from '../types';

/** 2–3 sentences; anything this long has stopped being a polish. */
const MAX_TEXT_CHARS = 900;
const MAX_SENTENCES = 4;
const MAX_OUTPUT_TOKENS = 2048;

const RESPONSE: ResponseSchemaNode = {
  type: 'OBJECT',
  properties: {
    text: {
      type: 'STRING',
      description:
        '2 to 3 sentences. Every number copied exactly as written in the template. Same recommendation.',
    },
  },
  required: ['text'],
  propertyOrdering: ['text'],
};

const SYSTEM_INSTRUCTION =
  'You are an editor for commercial property underwriting notes. You rewrite a short ' +
  'explanation so it reads clearly to an underwriter. You change wording only. You never ' +
  'add, remove, round, reformat or recompute a number, you never change the recommendation ' +
  'or the verdict, and you never add a fact that is not in the template.';

/**
 * Numeric tokens exactly as written: `$88,000`, `84`, `40%`, `$65.0M`, `1978`.
 * A token is compared as text, so `$88,000` rewritten as `$88K` is a change.
 */
const NUMBER_TOKEN = /\$?\d[\d,]*(?:\.\d+)?(?:[KMB]\b|%)?/g;

function numberTokens(text: string): string[] {
  return (text.match(NUMBER_TOKEN) ?? []).map((token) => token.replace(/,$/, ''));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsWord(haystack: string, word: string): boolean {
  const trimmed = word.trim();
  if (trimmed.length === 0) return true;
  return new RegExp(`(^|[^a-z])${escapeRegExp(trimmed.toLowerCase())}([^a-z]|$)`).test(
    haystack.toLowerCase(),
  );
}

function sentenceCount(text: string): number {
  // Split on terminal punctuation followed by whitespace, ignoring decimals like `1.25`.
  return text.split(/(?<=[.!?])\s+(?=[A-Z"'(])/).filter((s) => s.trim().length > 0).length;
}

function tidy(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Every problem with a polished text, or an empty list when it may be used.
 * Private to this call; `narrate-guard` is the shared, downstream check.
 */
function survivalProblems(input: NarrateInput, polished: string): string[] {
  const problems: string[] = [];
  const text = tidy(polished);
  if (text.length === 0) return ['empty text'];
  if (text.length > MAX_TEXT_CHARS) problems.push(`longer than ${MAX_TEXT_CHARS} characters`);
  if (sentenceCount(text) > MAX_SENTENCES) problems.push(`more than ${MAX_SENTENCES} sentences`);

  const expected = new Set(numberTokens(input.template));
  const actual = new Set(numberTokens(text));
  for (const token of expected) {
    if (!actual.has(token)) problems.push(`number ${token} missing`);
  }
  for (const token of actual) {
    if (!expected.has(token)) problems.push(`number ${token} not in the template`);
  }

  if (!containsWord(text, input.recommendation)) {
    problems.push(`recommendation "${input.recommendation}" missing`);
  }
  return problems;
}

function buildSchema(input: NarrateInput): LlmSchema<{ text: string }> {
  const zod = z
    .object({ text: z.string() })
    .superRefine((value, ctx) => {
      for (const problem of survivalProblems(input, value.text)) {
        ctx.addIssue({ code: 'custom', path: ['text'], message: problem });
      }
    })
    .transform((value) => ({ text: tidy(value.text) }));
  return { zod, response: RESPONSE };
}

function buildPrompt(input: NarrateInput): string {
  const lines: string[] = [
    'Rewrite this underwriting explanation in 2 to 3 clear sentences.',
    '',
    `Template: ${input.template}`,
    `Verdict: ${input.verdict}`,
    `Recommendation (must appear, word for word): ${input.recommendation}`,
  ];
  if (input.insuredName !== null && input.insuredName.trim().length > 0) {
    lines.push(`Insured: ${tidy(input.insuredName)}`);
  }
  const numbers = Object.entries(input.numbers);
  if (numbers.length > 0) {
    lines.push('Numbers in the template (context only, do not reformat them):');
    for (const [name, value] of numbers) lines.push(`- ${name}: ${value}`);
  }
  if (input.firedRules.length > 0) {
    lines.push('Rules that fired (context only):');
    for (const rule of input.firedRules) {
      lines.push(`- ${rule.factor} (${rule.tier}, ${rule.ruleId}): "${tidy(rule.quote)}"`);
    }
  }
  if (input.flipSummary !== null && input.flipSummary.trim().length > 0) {
    lines.push(`Smallest change that would flip the verdict: ${tidy(input.flipSummary)}`);
  }
  lines.push(
    '',
    'Rules for your rewrite:',
    '- Copy every number exactly as it is written in the template, including $, commas, %, K, M and decimals.',
    '- Do not add any number, count, date or percentage that is not in the template.',
    '- Keep the recommendation word unchanged.',
    '- If the account is in appetite on some factors and out on others, say so plainly.',
  );
  return lines.join('\n');
}

export async function narrateCall(
  provider: LlmProvider,
  input: NarrateInput,
): Promise<NarrateOutput> {
  const fallback: NarrateOutput = { text: input.template };
  if (!provider.configured) return fallback;
  try {
    const result = await generateJson(provider, {
      callName: 'narrate',
      prompt: buildPrompt(input),
      schema: buildSchema(input),
      systemInstruction: SYSTEM_INSTRUCTION,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      temperature: 0.2,
    });
    if (result.degraded) return fallback;
    // Belt and braces: a provider that skipped validation still cannot leak a changed number.
    if (survivalProblems(input, result.data.text).length > 0) return fallback;
    return { text: tidy(result.data.text) };
  } catch {
    return fallback;
  }
}
