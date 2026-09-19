/**
 * Gemini call 7 of 8: `draft-request`. Body owned by Run 1 unit A06.
 *
 * Gemini writes the prose of the information request to the broker. Code then
 * checks it (PRD §9.2): every requested field is named, nothing else is asked
 * for, no dollar figure or placeholder slips in. A draft that fails any check,
 * or a call that fails, falls back to a deterministic template that passes the
 * same checks. The model never decides which fields are asked for.
 */
import { z } from 'zod';
import type { DraftRequestInput, DraftRequestOutput } from '@retrofit/contracts';
import { generateJson } from '../generate-json';
import { LlmUnavailableError } from '../types';
import type { LlmProvider, LlmSchema, ResponseSchemaNode } from '../types';

const MAX_SUBJECT_CHARS = 120;
const MAX_BODY_CHARS = 2000;
const MAX_OUTPUT_TOKENS = 4096;

type DraftField = DraftRequestInput['fields'][number];

const RESPONSE: ResponseSchemaNode = {
  type: 'OBJECT',
  properties: {
    subject: { type: 'STRING', description: 'Email subject line, under 80 characters.' },
    body: {
      type: 'STRING',
      description:
        'Plain-text email body. One bullet line per requested field, starting with "- " and the field label exactly as given.',
    },
  },
  required: ['subject', 'body'],
  propertyOrdering: ['subject', 'body'],
};

const ZOD = z.object({ subject: z.string(), body: z.string() });

const SCHEMA: LlmSchema<z.infer<typeof ZOD>> = { zod: ZOD, response: RESPONSE };

const SYSTEM_INSTRUCTION =
  'You write short, specific emails from a commercial property underwriter to an insurance broker, ' +
  'asking only for the missing information listed. You never mention a price, premium, score, ' +
  'verdict or decision, never invent names, and never use placeholders such as [Your Name].';

/* -------------------------------------------------------------------------- */
/* Text helpers (private)                                                     */
/* -------------------------------------------------------------------------- */

function oneLine(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Keeps line breaks, strips other control characters and trailing spaces. */
function cleanBody(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Lower-case, alphanumerics only, single spaces — for "does the label appear" checks. */
function norm(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function containsLabel(text: string, label: string): boolean {
  const needle = norm(label);
  if (needle.length === 0) return true;
  return ` ${norm(text)} `.includes(` ${needle} `);
}

function uniqueFields(fields: readonly DraftField[]): DraftField[] {
  const seen = new Set<string>();
  const out: DraftField[] = [];
  for (const field of fields) {
    if (seen.has(field.canonicalPath)) continue;
    seen.add(field.canonicalPath);
    out.push({
      canonicalPath: field.canonicalPath,
      label: oneLine(field.label).length > 0 ? oneLine(field.label) : field.canonicalPath,
      why: oneLine(field.why),
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* The code check                                                             */
/* -------------------------------------------------------------------------- */

const BULLET = /^\s*(?:[-*•–]|\d+[.)])\s+/;
const PLACEHOLDER = /\[[^\]\n]{1,40}\]|\{\{|<[a-z ]{2,30}>/i;
const DOLLAR_FIGURE = /\$\s?\d/;

/**
 * Words that make a sentence an ask (R2-fixer-6, R4-7). Matched against the
 * normalized sentence, so "Could you" and "could you" are the same.
 */
const REQUEST_CUE =
  /\b(?:please|kindly|send|provide|share|confirm|forward|attach|upload|submit|include|advise|need|needs|needed|require|requires|required|could you|can you|would you|let us know)\b/;

/** An ask that only asks for a reply, with no object beyond the requested values. */
const REPLY_ONLY =
  /^(?:please )?(?:reply|respond)(?: (?:with|to us|to this email))?(?: (?:this|that|these|those|the) (?:value|values|details|information|answer|answers))?(?: (?:when|as soon as) you can| at your earliest convenience)?$/;

/** The list intro, e.g. "To finish our review of X we need the following:". */
const LIST_INTRO = /(?:we )?(?:need|require|are missing) the following(?: (?:items?|details|information))?$/;

/**
 * Why a draft is not acceptable, or `null` when it is. Exported for the tests
 * and for any route that wants to re-check a human-edited draft.
 */
export function draftProblems(
  draft: DraftRequestOutput,
  fields: readonly DraftField[],
): string | null {
  const subject = draft.subject.trim();
  const body = draft.body.trim();
  if (subject.length === 0) return 'empty subject';
  if (body.length === 0) return 'empty body';
  if (body.length > MAX_BODY_CHARS) return 'body too long';

  const labels = fields.map((field) => field.label);
  const missing = labels.filter((label) => !containsLabel(body, label));
  if (missing.length > 0) return `missing field(s): ${missing.join(', ')}`;

  const namesAny = (text: string): boolean => labels.some((label) => containsLabel(text, label));

  // Nothing else is asked for: every list item and every question names a requested field.
  for (const line of body.split('\n')) {
    if (BULLET.test(line) && !namesAny(line)) return `extra list item: ${oneLine(line)}`;
  }
  const sentences = body.split(/(?<=[.?!])\s+|\n+/);
  for (const sentence of sentences) {
    if (sentence.trim().endsWith('?') && !namesAny(sentence)) {
      return `extra question: ${oneLine(sentence)}`;
    }
  }
  // A plain ("Please also send ...") sentence must name a requested field too,
  // unless it only asks for a reply or introduces the list (whose items are
  // checked above).
  for (const sentence of sentences) {
    if (BULLET.test(sentence) || namesAny(sentence)) continue;
    let text = norm(sentence);
    if (sentence.trim().endsWith(':')) {
      const intro = LIST_INTRO.exec(text);
      if (intro !== null) text = text.slice(0, intro.index).trim();
    }
    if (!REQUEST_CUE.test(text) || REPLY_ONLY.test(text)) continue;
    return `extra request: ${oneLine(sentence)}`;
  }

  const inputText = fields.map((field) => `${field.label} ${field.why}`).join(' ');
  if (DOLLAR_FIGURE.test(`${subject} ${body}`) && !DOLLAR_FIGURE.test(inputText)) {
    return 'mentions a dollar figure';
  }
  if (PLACEHOLDER.test(`${subject}\n${body}`)) return 'contains a placeholder';
  return null;
}

/* -------------------------------------------------------------------------- */
/* Deterministic template (fallback)                                          */
/* -------------------------------------------------------------------------- */

function greetingName(input: DraftRequestInput): string | null {
  const name = oneLine(input.contactName ?? '') || oneLine(input.brokerName ?? '');
  return name.length > 0 ? name : null;
}

function capWords(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** The template draft. Always passes `draftProblems`. */
export function templateDraft(input: DraftRequestInput): DraftRequestOutput {
  const fields = uniqueFields(input.fields);
  const insured = oneLine(input.insuredName ?? '');
  const name = greetingName(input);
  const subject = capWords(
    insured.length > 0
      ? `Information needed: ${insured}`
      : 'Information needed to complete our review',
    MAX_SUBJECT_CHARS,
  );
  const intro =
    insured.length > 0
      ? `To finish our review of ${insured} we need the following:`
      : 'To finish our review we need the following:';
  const bullets = fields.map((field) =>
    field.why.length > 0 ? `- ${field.label}: ${field.why}` : `- ${field.label}`,
  );
  const body = [
    name !== null ? `Hello ${name},` : 'Hello,',
    '',
    intro,
    '',
    ...bullets,
    '',
    fields.length === 1
      ? 'Please reply with this value when you can.'
      : 'Please reply with these values when you can.',
    '',
    'Thank you.',
  ].join('\n');
  return { subject, body };
}

/* -------------------------------------------------------------------------- */
/* The call                                                                   */
/* -------------------------------------------------------------------------- */

function buildPrompt(input: DraftRequestInput, fields: readonly DraftField[]): string {
  const name = greetingName(input);
  const insured = oneLine(input.insuredName ?? '');
  const lines = [
    `Insured: ${insured.length > 0 ? insured : '(not named — do not name one)'}`,
    `Broker firm: ${oneLine(input.brokerName ?? '') || '(unknown)'}`,
    `Greet: ${name ?? '(no name — greet with "Hello,")'}`,
    `Tone: ${input.tone === 'short_and_specific' ? 'short and specific, polite, no filler' : input.tone}`,
    '',
    'Requested fields (label — why it matters):',
    ...fields.map((field) => `- ${field.label} — ${field.why || 'needed to complete the review'}`),
    '',
    'Write the email. Rules:',
    '1. The body has exactly one bullet line per requested field, beginning "- " followed by the label exactly as written above, then a few words on why it matters.',
    '2. Ask for nothing else: no other questions, documents or fields.',
    '3. No price, premium, score, verdict, decision or dollar figure. No placeholders. Do not invent names.',
    '4. Under 120 words. End with "Thank you."',
  ];
  return lines.join('\n');
}

export async function draftRequestCall(
  provider: LlmProvider,
  input: DraftRequestInput,
): Promise<DraftRequestOutput> {
  const fields = uniqueFields(input.fields);
  if (fields.length === 0) {
    throw new Error('draft-request needs at least one requested field');
  }
  const fallback = templateDraft(input);

  let result;
  try {
    result = await generateJson(provider, {
      callName: 'draft-request',
      prompt: buildPrompt(input, fields),
      schema: SCHEMA,
      systemInstruction: SYSTEM_INSTRUCTION,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      temperature: 0.2,
    });
  } catch (error) {
    // Configuration problems are the route's to report; everything else degrades.
    if (error instanceof LlmUnavailableError) throw error;
    return fallback;
  }
  if (result.degraded) return fallback;

  const draft: DraftRequestOutput = {
    subject: capWords(oneLine(result.data.subject), MAX_SUBJECT_CHARS),
    body: cleanBody(result.data.body),
  };
  return draftProblems(draft, fields) === null ? draft : fallback;
}
