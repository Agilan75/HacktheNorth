/**
 * Gemini call 8 of 8: `extract-reply`. Values are type- and range-checked by
 * code and the quote must appear in the source. Body owned by Run 1 unit A06.
 *
 * Gemini only reads: it returns, per requested field, the raw value as a
 * string plus the sentence it came from. Code then:
 *
 * - drops anything for a field that was not requested;
 * - rejects a value whose quote is not in the pasted text (whitespace, case and
 *   typographic quotes normalised); a year must also appear in its quote;
 * - parses the string by the field's type (G-4 money is plain USD, `$150M` →
 *   150000000; G-5 years are integers, floored; G-6 percents are shares in
 *   [0, 1], `50%` → 0.5) and range-checks it against the vector spec;
 * - clamps confidence to [0, 1]. The 0.8 acceptance gate is the route's job.
 *
 * A quote that is not in the pasted text is rejected — unless a PDF came with
 * the reply: code cannot read the PDF (there is no PDF text extractor in the
 * tree), so such a value is kept but capped at 0.79 — below the gate — and
 * goes to the underwriter to confirm.
 *
 * Every requested field ends up in exactly one of `values` or `notFound`.
 */
import { z } from 'zod';
import type {
  ExtractReplyFieldSpec,
  ExtractReplyInput,
  ExtractReplyOutput,
  ExtractReplyValue,
} from '@retrofit/contracts';
import { math } from '@retrofit/engine';
import { generateJson } from '../generate-json';
import { LlmUnavailableError } from '../types';
import type { LlmPdfPart, LlmProvider, LlmSchema, ResponseSchemaNode } from '../types';

/** Just under the PRD's 0.8 acceptance gate. */
export const UNVERIFIED_QUOTE_CONFIDENCE_CAP = 0.79;
/** Two different values for one field: neither is trusted past the gate. */
export const CONFLICT_CONFIDENCE_CAP = 0.5;

const MAX_SOURCE_CHARS = 60_000;
const MAX_QUOTE_CHARS = 400;
const MIN_QUOTE_CHARS = 3;
const MAX_STRING_VALUE_CHARS = 200;
const MAX_OUTPUT_TOKENS = 8192;
const DEFAULT_YEAR_RANGE = { min: 1700, max: 2100 } as const;

/* -------------------------------------------------------------------------- */
/* Schema                                                                     */
/* -------------------------------------------------------------------------- */

function responseSchema(paths: readonly string[]): ResponseSchemaNode {
  return {
    type: 'OBJECT',
    properties: {
      values: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            canonicalPath: { type: 'STRING', enum: paths },
            value: {
              type: 'STRING',
              nullable: true,
              description: 'The value exactly as the reply states it, e.g. "1978", "$2.5M", "40%", "yes".',
            },
            confidence: { type: 'NUMBER', minimum: 0, maximum: 1 },
            quote: {
              type: 'STRING',
              description: 'The shortest sentence or phrase, copied character for character from the reply, that states the value.',
            },
          },
          required: ['canonicalPath', 'value', 'confidence', 'quote'],
          propertyOrdering: ['canonicalPath', 'value', 'confidence', 'quote'],
        },
      },
      notFound: { type: 'ARRAY', items: { type: 'STRING', enum: paths } },
    },
    required: ['values', 'notFound'],
    propertyOrdering: ['values', 'notFound'],
  };
}

const RAW_VALUE = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const ZOD = z.object({
  values: z.array(
    z.object({
      canonicalPath: z.string(),
      value: RAW_VALUE,
      confidence: z.number(),
      quote: z.string(),
    }),
  ),
  notFound: z.array(z.string()),
});

type RawReply = z.infer<typeof ZOD>;

const SYSTEM_INSTRUCTION =
  "You read a broker's reply to an underwriter's information request and pull out the requested " +
  'values. You only transcribe what the reply states: never infer, estimate, convert or compute a value, ' +
  'and never decide a verdict, a score or a price. Every quote is copied exactly from the reply.';

/* -------------------------------------------------------------------------- */
/* Text helpers (private)                                                     */
/* -------------------------------------------------------------------------- */

function oneLine(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** For the quote-in-source check: typographic characters, whitespace and case. */
function normQuote(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Strips wrapping quote marks and a trailing ellipsis the model sometimes adds. */
function trimQuote(quote: string): string {
  return oneLine(quote)
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/(?:\.\.\.|…)$/, '')
    .trim();
}

export function quoteInSource(quote: string, source: string): boolean {
  const q = normQuote(trimQuote(quote));
  if (q.length < MIN_QUOTE_CHARS) return false;
  return normQuote(source).includes(q);
}

/* -------------------------------------------------------------------------- */
/* Typed parsing (private logic, exported for the tests)                      */
/* -------------------------------------------------------------------------- */

const SUFFIX: Readonly<Record<string, number>> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  mm: 1e6,
  mil: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
};

/** `"$1,250,000"`, `"2.5M"`, `"$50K"`, `"3 million"`, `"-4"` → number; otherwise null. */
function parseNumberish(raw: string | number): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const text = raw.trim().toLowerCase().replace(/^(?:usd|us\$)\s*/, '').replace(/\s*(?:usd|dollars)$/, '');
  const match = /^\(?(-)?\s*\$?\s*(-)?\s*(\d{1,3}(?:,\d{3})+|\d+)?(\.\d+)?\s*([a-z]+)?\)?$/.exec(text);
  if (match === null) return null;
  const [, neg1, neg2, whole, frac, suffix] = match;
  if (whole === undefined && frac === undefined) return null;
  let value = Number(`${(whole ?? '0').replace(/,/g, '')}${frac ?? ''}`);
  if (suffix !== undefined) {
    const mult = SUFFIX[suffix];
    if (mult === undefined) return null;
    value *= mult;
  }
  if (neg1 !== undefined || neg2 !== undefined) value = -value;
  return Number.isFinite(value) ? value : null;
}

function inRange(value: number, min: number | undefined, max: number | undefined): boolean {
  if (min !== undefined && value < min) return false;
  if (max !== undefined && value > max) return false;
  return true;
}

/**
 * Parses and range-checks one raw value against its field spec. Returns
 * `undefined` when the value is unusable (wrong type, out of range) and `null`
 * when the reply gave no value.
 */
export function coerceValue(
  raw: string | number | boolean | null,
  spec: ExtractReplyFieldSpec,
): string | number | boolean | null | undefined {
  if (raw === null) return null;
  if (typeof raw === 'string' && raw.trim().length === 0) return null;
  if (typeof raw === 'string' && /^(?:null|n\/a|na|none|unknown)$/i.test(raw.trim())) return null;

  switch (spec.type) {
    case 'boolean': {
      if (typeof raw === 'boolean') return raw;
      const text = String(raw).trim().toLowerCase();
      if (['true', 'yes', 'y'].includes(text)) return true;
      if (['false', 'no', 'n'].includes(text)) return false;
      return undefined;
    }
    case 'string': {
      if (typeof raw === 'boolean') return undefined;
      const text = oneLine(String(raw));
      if (text.length === 0 || text.length > MAX_STRING_VALUE_CHARS) return undefined;
      if (spec.options !== undefined && spec.options.length > 0) {
        const hit = spec.options.find((option) => option.toLowerCase() === text.toLowerCase());
        return hit ?? undefined;
      }
      return text;
    }
    case 'year': {
      if (typeof raw === 'boolean') return undefined;
      const n = parseNumberish(raw);
      if (n === null) return undefined;
      const year = Math.floor(n); // G-5
      const min = spec.min ?? DEFAULT_YEAR_RANGE.min;
      const max = spec.max ?? DEFAULT_YEAR_RANGE.max;
      return inRange(year, min, max) ? year : undefined;
    }
    case 'percent': {
      if (typeof raw === 'boolean') return undefined;
      const isPercentString = typeof raw === 'string' && /%\s*$/.test(raw.trim());
      const n = parseNumberish(typeof raw === 'string' ? raw.replace(/\s*%\s*$/, '') : raw);
      if (n === null) return undefined;
      // G-6: shares live in [0, 1]. "40%" and a bare 40 are percentage points.
      const share = isPercentString || n > 1 ? n / 100 : n;
      return inRange(share, spec.min ?? 0, spec.max ?? 1) ? share : undefined;
    }
    case 'money': {
      if (typeof raw === 'boolean') return undefined;
      const n = parseNumberish(raw); // G-4: plain USD
      if (n === null) return undefined;
      return inRange(n, spec.min ?? 0, spec.max) ? n : undefined;
    }
    case 'number': {
      if (typeof raw === 'boolean') return undefined;
      const n = parseNumberish(raw);
      if (n === null) return undefined;
      return inRange(n, spec.min, spec.max) ? n : undefined;
    }
    default:
      return undefined;
  }
}

/* -------------------------------------------------------------------------- */
/* Validation of the model's answer                                           */
/* -------------------------------------------------------------------------- */

interface Candidate {
  readonly value: string | number | boolean;
  readonly confidence: number;
  readonly quote: string;
  /** Position of the quote in the source; -1 when unknown (PDF). */
  readonly at: number;
}

function sameValue(a: Candidate['value'], b: Candidate['value']): boolean {
  if (typeof a === 'number' && typeof b === 'number') return math.approxEqual(a, b, 1e-6);
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

/**
 * Applies every code check to the model's raw answer. Exported so the route's
 * tests and the extraction check (PRD §12) exercise the same rules.
 */
export function validateReply(
  raw: RawReply,
  input: ExtractReplyInput,
  hasPdf: boolean,
): ExtractReplyOutput {
  const specs = new Map<string, ExtractReplyFieldSpec>();
  for (const spec of input.requestedFields) {
    if (!specs.has(spec.canonicalPath)) specs.set(spec.canonicalPath, spec);
  }
  const source = input.sourceText ?? '';
  const normSource = normQuote(source);
  const hasText = source.trim().length > 0;

  const candidates = new Map<string, Candidate[]>();

  for (const item of raw.values) {
    const spec = specs.get(item.canonicalPath);
    if (spec === undefined) continue; // not requested: never written anywhere

    const quote = trimQuote(item.quote).slice(0, MAX_QUOTE_CHARS);
    const coerced = coerceValue(item.value, spec);
    // null (the reply gave no value) and undefined (unusable) both leave the
    // field unanswered; it lands in notFound below.
    if (coerced === null || coerced === undefined) continue;
    if (quote.length < MIN_QUOTE_CHARS) continue;

    // Verified: the quote is in the pasted text. Unverified: it may be in the
    // PDF, which code cannot read, so it is capped below the gate.
    let verified = false;
    let at = -1;
    if (hasText && quoteInSource(quote, source)) {
      verified = true;
      at = normSource.indexOf(normQuote(quote));
    } else if (!hasPdf) {
      continue;
    }
    // A year must be stated in its own quote, not inferred ("built after the war").
    if (spec.type === 'year' && !normQuote(quote).includes(String(coerced))) continue;

    const confidenceRaw = Number.isFinite(item.confidence) ? math.clamp01(item.confidence) : 0;
    const confidence = verified
      ? confidenceRaw
      : Math.min(confidenceRaw, UNVERIFIED_QUOTE_CONFIDENCE_CAP);

    const list = candidates.get(spec.canonicalPath) ?? [];
    list.push({ value: coerced, confidence, quote, at });
    candidates.set(spec.canonicalPath, list);
  }

  const values: ExtractReplyValue[] = [];
  const notFound: string[] = [];
  for (const path of specs.keys()) {
    const list = candidates.get(path);
    if (list === undefined || list.length === 0) {
      notFound.push(path);
      continue;
    }
    const first = list[0]!;
    const conflict = list.some((c) => !sameValue(c.value, first.value));
    if (!conflict) {
      // Agreeing mentions: the weakest confidence, the earliest quote.
      const confidence = Math.min(...list.map((c) => c.confidence));
      values.push({ canonicalPath: path, value: first.value, confidence, quote: first.quote });
      continue;
    }
    // Self-contradicting reply: the statement latest in the text is kept (a
    // correction usually follows), but it can never pass the gate on its own.
    const latest = list.reduce((best, c) => (c.at > best.at ? c : best), first);
    values.push({
      canonicalPath: path,
      value: latest.value,
      confidence: Math.min(latest.confidence, CONFLICT_CONFIDENCE_CAP),
      quote: latest.quote,
    });
  }
  return { values, notFound };
}

/* -------------------------------------------------------------------------- */
/* The call                                                                   */
/* -------------------------------------------------------------------------- */

function describeSpec(spec: ExtractReplyFieldSpec): string {
  const bits: string[] = [spec.type];
  if (spec.unit !== undefined) bits.push(`unit ${oneLine(spec.unit)}`);
  if (spec.min !== undefined) bits.push(`min ${spec.min}`);
  if (spec.max !== undefined) bits.push(`max ${spec.max}`);
  if (spec.options !== undefined && spec.options.length > 0) {
    bits.push(`one of: ${spec.options.map(oneLine).join(' | ')}`);
  }
  return `- ${spec.canonicalPath} — ${oneLine(spec.label)} (${bits.join(', ')})`;
}

function buildPrompt(
  input: ExtractReplyInput,
  specs: readonly ExtractReplyFieldSpec[],
  hasPdf: boolean,
): string {
  const insured = oneLine(input.insuredName ?? '');
  const lines = [
    insured.length > 0 ? `Insured: ${insured}` : 'Insured: (not named)',
    '',
    'Requested fields (canonicalPath — label (type, constraints)):',
    ...specs.map(describeSpec),
    '',
    'For each requested field the reply answers, return one entry in "values":',
    '- canonicalPath: exactly as listed above.',
    '- value: the value as the reply states it, as a string ("1978", "$2.5M", "40%", "yes"). Do not compute or convert.',
    '- confidence: 0 to 1. Low if the reply is vague, hedged ("about", "we think") or contradicts itself.',
    '- quote: the shortest phrase, copied character for character from the reply, that states the value.',
    'List a field in "notFound" if the reply does not state it. Never guess. Ignore anything that was not requested.',
  ];
  const text = input.sourceText ?? '';
  if (text.trim().length > 0) {
    lines.push('', 'Reply:', '"""', text.slice(0, MAX_SOURCE_CHARS), '"""');
  }
  if (hasPdf) lines.push('', 'The attached PDF is part of the reply.');
  return lines.join('\n');
}

function uniqueSpecs(fields: readonly ExtractReplyFieldSpec[]): ExtractReplyFieldSpec[] {
  const seen = new Set<string>();
  return fields.filter((spec) => {
    if (seen.has(spec.canonicalPath)) return false;
    seen.add(spec.canonicalPath);
    return true;
  });
}

export async function extractReplyCall(
  provider: LlmProvider,
  input: ExtractReplyInput,
  pdf?: LlmPdfPart,
): Promise<ExtractReplyOutput> {
  const specs = uniqueSpecs(input.requestedFields);
  const allNotFound = (): ExtractReplyOutput => ({
    values: [],
    notFound: specs.map((spec) => spec.canonicalPath),
  });
  if (specs.length === 0) return { values: [], notFound: [] };

  const hasText = (input.sourceText ?? '').trim().length > 0;
  if (!hasText && pdf === undefined) return allNotFound();

  const paths = specs.map((spec) => spec.canonicalPath);
  const schema: LlmSchema<RawReply> = { zod: ZOD, response: responseSchema(paths) };

  let result;
  try {
    result = await generateJson(provider, {
      callName: 'extract-reply',
      prompt: buildPrompt(input, specs, pdf !== undefined),
      ...(pdf !== undefined ? { parts: [pdf] } : {}),
      schema,
      systemInstruction: SYSTEM_INSTRUCTION,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      temperature: 0,
    });
  } catch (error) {
    if (error instanceof LlmUnavailableError) throw error;
    return allNotFound();
  }
  if (result.degraded) return allNotFound();

  return validateReply(result.data, { ...input, requestedFields: specs }, pdf !== undefined);
}
