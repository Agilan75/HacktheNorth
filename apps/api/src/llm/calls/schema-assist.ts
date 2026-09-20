/**
 * Gemini call 5 of 8: `schema-assist`. Body owned by Run 1 unit A05.
 *
 * The planner's last resort for schema keys the synonym table cannot resolve
 * (PRD §7.5 step 3). The model proposes `rawPath → canonicalPath` with a
 * confidence; code then throws away anything it was not asked about, any
 * canonical path outside the supplied list, duplicates, and self-invented
 * keys. The 0.8 acceptance gate is the planner's, not this call's: every
 * surviving mapping is returned, so a sub-threshold guess stays visible in the
 * trace as "unmapped, best guess X at 0.6".
 *
 * Degrade: any failure other than "no provider configured" returns
 * `{ mappings: [] }` — every key stays visibly unmapped. Never an invented map.
 */
import { z } from 'zod';
import { math } from '@retrofit/engine';
import type {
  SchemaAssistInput,
  SchemaAssistMappingOut,
  SchemaAssistOutput,
} from '@retrofit/contracts';
import { generateJson } from '../generate-json';
import { LlmUnavailableError } from '../types';
import type { LlmProvider, LlmSchema, ResponseSchemaNode } from '../types';

/** Sample values shown per key; enough to see a type and a format. */
const MAX_SAMPLES_PER_KEY = 5;
/** Longest rendering of one sample value. */
const MAX_SAMPLE_CHARS = 80;
/** Longest `reason` kept; anything longer is cut on a word boundary. */
const MAX_REASON_CHARS = 300;
const MAX_OUTPUT_TOKENS = 4096;

const SYSTEM_INSTRUCTION =
  'You map field names from an insurance data schema onto a fixed list of canonical fields. ' +
  'You only match names and sample values to field meanings. You never compute a value, ' +
  'a price, a score or a verdict. Map a key only when its meaning plainly matches one canonical ' +
  'field; leave a key out entirely when nothing fits. Confidence is 0 to 1 and must be below 0.8 ' +
  'whenever the name or the samples leave real doubt.';

/** Collapses whitespace and control characters into one line. */
function oneLine(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function cap(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** A sample value as a short, JSON-ish, single-line string. */
export function renderSample(value: unknown): string {
  let text: string;
  if (value === undefined) text = 'undefined';
  else if (typeof value === 'string') text = JSON.stringify(oneLine(value));
  else if (typeof value === 'bigint') text = value.toString();
  else {
    try {
      text = JSON.stringify(value) ?? String(value);
    } catch {
      text = String(value);
    }
  }
  return cap(oneLine(text), MAX_SAMPLE_CHARS);
}

function buildResponse(canonicalPaths: readonly string[]): ResponseSchemaNode {
  return {
    type: 'OBJECT',
    properties: {
      mappings: {
        type: 'ARRAY',
        description: 'One entry per key you could map. Omit keys that match nothing.',
        items: {
          type: 'OBJECT',
          properties: {
            rawPath: { type: 'STRING', description: 'The unmapped key, copied exactly.' },
            canonicalPath: {
              type: 'STRING',
              description: 'The canonical field it means.',
              enum: canonicalPaths,
            },
            confidence: { type: 'NUMBER', minimum: 0, maximum: 1 },
            reason: { type: 'STRING', description: 'One short sentence.' },
          },
          required: ['rawPath', 'canonicalPath', 'confidence', 'reason'],
          propertyOrdering: ['rawPath', 'canonicalPath', 'confidence', 'reason'],
        },
      },
    },
    required: ['mappings'],
  };
}

const ZOD = z.object({
  mappings: z.array(
    z.object({
      rawPath: z.string(),
      canonicalPath: z.string(),
      confidence: z.number().finite(),
      reason: z.string(),
    }),
  ),
});
type Raw = z.infer<typeof ZOD>;

export function buildSchemaAssistPrompt(input: SchemaAssistInput): string {
  const lines: string[] = ['Canonical fields (map onto these only):'];
  for (const field of input.canonicalFields) {
    lines.push(`- ${oneLine(field.canonicalPath)}: ${oneLine(field.description)}`);
  }
  lines.push('', 'Unmapped keys, with sample values:');
  for (const key of input.unmappedKeys) {
    const samples = key.sampleValues.slice(0, MAX_SAMPLES_PER_KEY).map(renderSample);
    lines.push(
      `- ${oneLine(key.rawPath)}: ${samples.length > 0 ? samples.join(', ') : '(no samples)'}`,
    );
  }
  lines.push(
    '',
    'For each unmapped key that means one of the canonical fields, return rawPath (copied exactly),',
    'canonicalPath, confidence 0 to 1, and a one-sentence reason naming the evidence (the name, the',
    'samples, or both). Leave out keys that match nothing.',
  );
  return lines.join('\n');
}

/**
 * Keeps only mappings for keys that were asked about onto canonical paths that
 * were offered; one mapping per raw key (highest confidence, first on ties);
 * output in input key order.
 */
export function sanitizeMappings(input: SchemaAssistInput, raw: Raw): SchemaAssistMappingOut[] {
  const keyOrder = new Map<string, number>();
  input.unmappedKeys.forEach((key, i) => {
    if (!keyOrder.has(key.rawPath)) keyOrder.set(key.rawPath, i);
  });
  const canonical = new Set(input.canonicalFields.map((f) => f.canonicalPath));

  const best = new Map<string, SchemaAssistMappingOut>();
  for (const m of raw.mappings) {
    const rawPath = m.rawPath.trim();
    const canonicalPath = m.canonicalPath.trim();
    if (!keyOrder.has(rawPath) || !canonical.has(canonicalPath)) continue;
    const confidence = math.clamp01(m.confidence);
    const prior = best.get(rawPath);
    if (prior !== undefined && prior.confidence >= confidence) continue;
    const reason = cap(oneLine(m.reason), MAX_REASON_CHARS);
    best.set(rawPath, {
      rawPath,
      canonicalPath,
      confidence,
      reason: reason.length > 0 ? reason : 'No reason given.',
    });
  }
  return [...best.values()].sort(
    (a, b) => (keyOrder.get(a.rawPath) ?? 0) - (keyOrder.get(b.rawPath) ?? 0),
  );
}

export async function schemaAssistCall(
  provider: LlmProvider,
  input: SchemaAssistInput,
): Promise<SchemaAssistOutput> {
  if (input.unmappedKeys.length === 0 || input.canonicalFields.length === 0) {
    return { mappings: [] };
  }
  const canonicalPaths = [...new Set(input.canonicalFields.map((f) => f.canonicalPath))];
  const schema: LlmSchema<Raw> = { zod: ZOD, response: buildResponse(canonicalPaths) };

  let result;
  try {
    result = await generateJson(provider, {
      callName: 'schema-assist',
      prompt: buildSchemaAssistPrompt(input),
      schema,
      systemInstruction: SYSTEM_INSTRUCTION,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      temperature: 0,
    });
  } catch (error) {
    // Configuration problems are the caller's to report; everything else leaves keys unmapped.
    if (error instanceof LlmUnavailableError) throw error;
    return { mappings: [] };
  }
  if (result.degraded) return { mappings: [] };
  return { mappings: sanitizeMappings(input, result.data) };
}
