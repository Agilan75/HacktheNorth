/**
 * V06 — the extraction scorer, PRD §12 "Extraction check".
 *
 * Reported: field accuracy, and how often a wrong value got through the 0.8
 * gate. Pure: the extractor is injected, so tests use a scripted one and the
 * LLM CLI passes the real `extract-reply` call.
 *
 * Per requested field (docs/decisions/V06.md):
 * - expected value, extracted value equal after normalization → correct
 *   (at any confidence: accuracy measures the reading, the gate is separate);
 * - expected value, extracted value different → wrong;
 * - expected value, nothing extracted (or null) → missed;
 * - expected `null`: correct unless a non-null value clears the gate, which
 *   is spurious.
 * `wrongThroughGate` counts wrong + spurious values at confidence >= 0.8.
 *
 * Imports nothing from `@retrofit/engine` (see ../types.ts).
 */
import type { ExtractReplyInput, ExtractReplyOutput, ExtractReplyValue } from '@retrofit/contracts';
import type { BrokerReplyFixture, ExtractionScore } from '../types.js';
import { BROKER_REPLIES, requestedFieldsFor } from './fixtures.js';

/** PRD §7.6 "Ingest reply": accepted at >= 0.8. */
export const EXTRACTION_GATE = 0.8;

export type ExpectedValue = string | number | boolean | null;

export type FieldOutcomeKind = 'correct' | 'wrong' | 'missed' | 'spurious';

export interface FieldOutcome {
  readonly fixtureId: string;
  readonly style: BrokerReplyFixture['style'];
  readonly canonicalPath: string;
  readonly expected: ExpectedValue;
  /** The value the scorer judged (highest confidence for the path), or null. */
  readonly actual: ExtractReplyValue['value'];
  readonly confidence: number | null;
  readonly outcome: FieldOutcomeKind;
  readonly throughGate: boolean;
}

export interface ExtractionReport {
  readonly score: ExtractionScore;
  readonly fields: readonly FieldOutcome[];
  readonly byStyle: readonly {
    readonly style: BrokerReplyFixture['style'];
    readonly fieldsExpected: number;
    readonly fieldsCorrect: number;
    readonly wrongThroughGate: number;
  }[];
  /** Fixtures whose extractor threw; every field of such a fixture is `missed`. */
  readonly errors: readonly { readonly fixtureId: string; readonly message: string }[];
}

export type ReplyExtractor = (input: ExtractReplyInput) => Promise<ExtractReplyOutput>;

/* ----------------------------------------------------------- normalization */

const RELATIVE_TOLERANCE = 1e-6;
const ABSOLUTE_TOLERANCE = 1e-9;

function snake(text: string): string {
  return text
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const MULTIPLIERS: Readonly<Record<string, number>> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  mm: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
};

/** G-4 money / G-6 percent parsing of a raw string; null when not a number. */
function parseNumber(raw: string): number | null {
  const text = raw.normalize('NFKC').trim().toLowerCase().replace(/[$,\s]/g, '').replace(/^usd/, '');
  const match = /^(-?\d+(?:\.\d+)?)(%|k|thousand|mm|m|million|bn|b|billion)?$/.exec(text);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  const suffix = match[2];
  if (suffix === undefined) return base;
  if (suffix === '%') return base / 100;
  return base * (MULTIPLIERS[suffix] ?? 1);
}

function parseBoolean(raw: string): boolean | null {
  const text = snake(raw);
  if (['true', 'yes', 'y', 'sprinklered', 'fully_sprinklered'].includes(text)) return true;
  if (['false', 'no', 'n', 'none', 'not_sprinklered', 'unsprinklered'].includes(text)) return false;
  return null;
}

/** True when `actual` is the same value as `expected` after normalization. */
export function valuesMatch(expected: ExpectedValue, actual: ExtractReplyValue['value']): boolean {
  if (expected === null || actual === null) return expected === actual;
  if (typeof expected === 'number') {
    const value = typeof actual === 'number' ? actual : typeof actual === 'string' ? parseNumber(actual) : null;
    if (value === null || !Number.isFinite(value)) return false;
    return Math.abs(value - expected) <= Math.max(ABSOLUTE_TOLERANCE, RELATIVE_TOLERANCE * Math.abs(expected));
  }
  if (typeof expected === 'boolean') {
    const value = typeof actual === 'boolean' ? actual : typeof actual === 'string' ? parseBoolean(actual) : null;
    return value === expected;
  }
  if (typeof actual !== 'string') return false;
  return snake(actual) === snake(expected);
}

/* ----------------------------------------------------------------- scoring */

/** The value the scorer judges for one path: the highest confidence, first on a tie. */
function pick(values: readonly ExtractReplyValue[], canonicalPath: string): ExtractReplyValue | null {
  let best: ExtractReplyValue | null = null;
  for (const value of values) {
    if (value.canonicalPath !== canonicalPath) continue;
    if (best === null || value.confidence > best.confidence) best = value;
  }
  return best;
}

function clampConfidence(confidence: number): number {
  return Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0;
}

/** Score one fixture's extractor output, one outcome per expected field. */
export function scoreFixture(fixture: BrokerReplyFixture, output: ExtractReplyOutput | null): FieldOutcome[] {
  const values = output?.values ?? [];
  return Object.entries(fixture.expected).map(([canonicalPath, expected]): FieldOutcome => {
    const chosen = pick(values, canonicalPath);
    const actual = chosen?.value ?? null;
    const confidence = chosen === null ? null : clampConfidence(chosen.confidence);
    const throughGate = actual !== null && confidence !== null && confidence >= EXTRACTION_GATE;
    let outcome: FieldOutcomeKind;
    if (expected === null) outcome = throughGate ? 'spurious' : 'correct';
    else if (actual === null) outcome = 'missed';
    else outcome = valuesMatch(expected, actual) ? 'correct' : 'wrong';
    return {
      fixtureId: fixture.id,
      style: fixture.style,
      canonicalPath,
      expected,
      actual,
      confidence,
      outcome,
      throughGate,
    };
  });
}

function isWrongThroughGate(field: FieldOutcome): boolean {
  return field.throughGate && (field.outcome === 'wrong' || field.outcome === 'spurious');
}

function summarize(fixtureCount: number, fields: readonly FieldOutcome[]): ExtractionScore {
  const fieldsCorrect = fields.filter((field) => field.outcome === 'correct').length;
  return {
    fixtures: fixtureCount,
    fieldsExpected: fields.length,
    fieldsCorrect,
    fieldAccuracy: fields.length === 0 ? 0 : fieldsCorrect / fields.length,
    wrongThroughGate: fields.filter(isWrongThroughGate).length,
  };
}

/**
 * Score extractor outputs against the fixtures. `outputs` is keyed by fixture
 * id; a fixture with no output scores every expected value as missed.
 */
export function scoreExtraction(
  fixtures: readonly BrokerReplyFixture[],
  outputs: Readonly<Record<string, ExtractReplyOutput | null | undefined>>,
): ExtractionScore {
  const fields = fixtures.flatMap((fixture) => scoreFixture(fixture, outputs[fixture.id] ?? null));
  return summarize(fixtures.length, fields);
}

const STYLES: readonly BrokerReplyFixture['style'][] = ['clean', 'partial', 'vague', 'self_contradicting', 'loss_run'];

/** The extract-reply input for one fixture: its text and its requested fields. */
export function extractionInputFor(fixture: BrokerReplyFixture): ExtractReplyInput {
  return { sourceText: fixture.text, requestedFields: requestedFieldsFor(fixture), insuredName: null };
}

/**
 * Run an extractor over every fixture, sequentially (the Gemini quota is the
 * constraint, not wall time), and report per field and per style. A fixture
 * whose extractor throws is recorded in `errors` and scored with no output.
 */
export async function runExtractionCheck(
  extract: ReplyExtractor,
  fixtures: readonly BrokerReplyFixture[] = BROKER_REPLIES,
): Promise<ExtractionReport> {
  const fields: FieldOutcome[] = [];
  const errors: { fixtureId: string; message: string }[] = [];
  for (const fixture of fixtures) {
    let output: ExtractReplyOutput | null = null;
    try {
      output = await extract(extractionInputFor(fixture));
    } catch (error) {
      errors.push({ fixtureId: fixture.id, message: error instanceof Error ? error.message : String(error) });
    }
    fields.push(...scoreFixture(fixture, output));
  }
  const byStyle = STYLES.map((style) => {
    const ofStyle = fields.filter((field) => field.style === style);
    return {
      style,
      fieldsExpected: ofStyle.length,
      fieldsCorrect: ofStyle.filter((field) => field.outcome === 'correct').length,
      wrongThroughGate: ofStyle.filter(isWrongThroughGate).length,
    };
  });
  return { score: summarize(fixtures.length, fields), fields, byStyle, errors };
}
