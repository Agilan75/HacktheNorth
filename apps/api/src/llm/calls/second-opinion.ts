/**
 * Gemini call 6 of 8: `second-opinion`. VERIFICATION ONLY (PRD §12 layer C).
 * It never sees engine output and is never called from a request path.
 * Body owned by Run 1 unit A05.
 *
 * The model reads the guideline text and the rolled-up facts and predicts a
 * verdict and a deciding factor. It is the one call that returns a verdict,
 * and that verdict is only ever compared against the engine's, never used.
 *
 * No degrade: a verdict cannot be defaulted without inventing one, so any
 * failure (including an unconfigured provider or a degraded result) throws and
 * the layer-C runner records the case as unanswered.
 */
import { z } from 'zod';
import { APPETITE_FACTORS } from '@retrofit/engine';
import type { SecondOpinionInput, SecondOpinionOutput } from '@retrofit/contracts';
import { generateJson } from '../generate-json';
import { LlmError } from '../types';
import type { LlmProvider, LlmSchema, ResponseSchemaNode } from '../types';

export const SECOND_OPINION_VERDICTS = ['FIT', 'REFER', 'DOES_NOT_FIT'] as const;

/** `none` mirrors the engine's `decidingFactorId: null` (every factor missing). */
export const NO_DECIDING_FACTOR = 'none';
export const SECOND_OPINION_FACTORS: readonly string[] = [...APPETITE_FACTORS, NO_DECIDING_FACTOR];

const MAX_REASONING_CHARS = 1200;
/** Guideline text is long; the verdict needs room to think before it answers. */
const MAX_OUTPUT_TOKENS = 8192;

const SYSTEM_INSTRUCTION =
  'You are a careful commercial property underwriter reading an appetite guideline for the first ' +
  'time. Apply the guideline text exactly as written to the facts given. Use only the guideline ' +
  'and the facts; do not assume any fact that is not listed. A fact marked unknown is missing, ' +
  'not zero.';

const RESPONSE: ResponseSchemaNode = {
  type: 'OBJECT',
  properties: {
    verdict: {
      type: 'STRING',
      enum: SECOND_OPINION_VERDICTS,
      description:
        'FIT if in appetite, REFER if the guideline sends it for referral, DOES_NOT_FIT if out of appetite.',
    },
    decidingFactor: {
      type: 'STRING',
      enum: SECOND_OPINION_FACTORS,
      description:
        'The appetite factor that decided the verdict: the factor that knocked it out, or else the ' +
        'weakest factor. "none" only if no factor could be assessed.',
    },
    reasoning: {
      type: 'STRING',
      description: 'Two or three sentences quoting the guideline line that decided it.',
    },
  },
  required: ['verdict', 'decidingFactor', 'reasoning'],
  propertyOrdering: ['verdict', 'decidingFactor', 'reasoning'],
};

const normalizeToken = (v: unknown): unknown =>
  typeof v === 'string' ? v.trim().replace(/[\s-]+/g, '_') : v;

const ZOD = z.object({
  verdict: z.preprocess(
    (v) => (typeof v === 'string' ? (normalizeToken(v) as string).toUpperCase() : v),
    z.enum(SECOND_OPINION_VERDICTS),
  ),
  decidingFactor: z.preprocess(
    (v) => (typeof v === 'string' ? (normalizeToken(v) as string).toLowerCase() : v),
    z.string().refine((s) => SECOND_OPINION_FACTORS.includes(s), 'unknown deciding factor'),
  ),
  reasoning: z.string(),
});
type Raw = z.infer<typeof ZOD>;

const SCHEMA: LlmSchema<Raw> = { zod: ZOD, response: RESPONSE };

function oneLine(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function cap(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function renderFact(value: string | number | boolean | null): string {
  if (value === null) return 'unknown';
  if (typeof value === 'string') return oneLine(value) || 'unknown';
  if (typeof value === 'number' && !Number.isFinite(value)) return 'unknown';
  return String(value);
}

/** Facts sorted by key so the same case always produces the same prompt (cacheable). */
export function buildSecondOpinionPrompt(input: SecondOpinionInput): string {
  const keys = Object.keys(input.facts).sort();
  const facts = keys.map((k) => `- ${oneLine(k)}: ${renderFact(input.facts[k] ?? null)}`);
  return [
    '=== GUIDELINE TEXT ===',
    input.guidelineText.trim(),
    '=== END GUIDELINE TEXT ===',
    '',
    'Facts about this submission:',
    ...(facts.length > 0 ? facts : ['- (none)']),
    '',
    `Decide the verdict (${SECOND_OPINION_VERDICTS.join(', ')}) the guideline gives this submission,`,
    `name the deciding factor from: ${SECOND_OPINION_FACTORS.join(', ')},`,
    'and explain in two or three sentences, quoting the guideline line that decided it.',
  ].join('\n');
}

export async function secondOpinionCall(
  provider: LlmProvider,
  input: SecondOpinionInput,
): Promise<SecondOpinionOutput> {
  const result = await generateJson(provider, {
    callName: 'second-opinion',
    prompt: buildSecondOpinionPrompt(input),
    schema: SCHEMA,
    systemInstruction: SYSTEM_INSTRUCTION,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    temperature: 0,
  });
  if (result.degraded) {
    // Unreachable today (a verdict has no safe empty answer), guarded anyway.
    throw new LlmError('second-opinion degraded; no verdict is invented', {
      callName: 'second-opinion',
      retryable: false,
    });
  }
  const reasoning = cap(oneLine(result.data.reasoning), MAX_REASONING_CHARS);
  return {
    verdict: result.data.verdict,
    decidingFactor: result.data.decidingFactor,
    reasoning: reasoning.length > 0 ? reasoning : 'No reasoning given.',
  };
}
