/**
 * The two validators that keep Gemini out of the numbers:
 *  - draft validator: every requested field appears, nothing else is asked for;
 *  - extraction validator: type, range, quote-exists and the 0.8 gate.
 * Body owned by Run 1 unit F13.
 */
import type { VectorComponentSpec, VectorSpec } from '@retrofit/engine';
import { MIN_EXTRACTION_CONFIDENCE, math } from '@retrofit/engine';
import type {
  DraftValidation,
  ExtractedFieldValue,
  ExtractionRejection,
  RequestSelection,
  RequestedField,
  ValidatedFieldValue,
} from '../types';

/* -------------------------------------------------------------------------- */
/* Private vocabulary: canonical leaf -> value kind, range, and the phrases   */
/* a message uses to name it. Private to this file (HELPERS.md).              */
/* -------------------------------------------------------------------------- */

type ValueKind = 'money' | 'year' | 'ratio' | 'number' | 'boolean' | 'string' | 'date';

interface LeafRule {
  readonly kind: ValueKind;
  readonly min?: number;
  readonly max?: number;
  /** Allowed values after normalisation, for enumerated strings. */
  readonly options?: readonly string[];
  /** Phrases (lower case, space-separated) that name this field in prose. */
  readonly phrases: readonly string[];
}

/** No clock in this module: the year ceiling is a fixed, generous bound. */
const YEAR_MIN = 1800;
const YEAR_MAX = 2100;

const LOSS_PHRASES = ['loss run', 'loss runs', 'loss history', 'claims history', 'losses', 'claims'];

/** Keyed by the last path segment (or the vector component key for `rollup.*`). */
const LEAF_RULES: Readonly<Record<string, LeafRule>> = {
  // Buildings
  tiv: {
    kind: 'money',
    min: 0,
    phrases: ['tiv', 'total insured value', 'insured value', 'insured values', 'replacement cost', 'building value', 'schedule of values'],
  },
  totalTiv: {
    kind: 'money',
    min: 0,
    phrases: ['tiv', 'total insured value', 'insured value', 'insured values', 'schedule of values'],
  },
  yearBuilt: {
    kind: 'year',
    min: YEAR_MIN,
    max: YEAR_MAX,
    phrases: ['year built', 'built in', 'year of construction', 'construction year', 'when was', 'was built', 'were built'],
  },
  pctTivPre1990: {
    kind: 'ratio',
    min: 0,
    max: 1,
    phrases: ['year built', 'built in', 'year of construction', 'construction year', 'was built', 'were built'],
  },
  pctTivPost2010: {
    kind: 'ratio',
    min: 0,
    max: 1,
    phrases: ['year built', 'built in', 'year of construction', 'construction year', 'was built', 'were built'],
  },
  constructionType: {
    kind: 'string',
    phrases: ['construction type', 'construction class', 'type of construction', 'construction'],
  },
  pctTivAcceptableConstruction: {
    kind: 'ratio',
    min: 0,
    max: 1,
    phrases: ['construction type', 'construction class', 'type of construction', 'construction'],
  },
  sprinklered: {
    kind: 'boolean',
    phrases: ['sprinkler', 'sprinklers', 'sprinklered', 'sprinkler system'],
  },
  pctTivSprinklered: {
    kind: 'ratio',
    min: 0,
    max: 1,
    phrases: ['sprinkler', 'sprinklers', 'sprinklered', 'sprinkler system'],
  },
  stories: { kind: 'number', min: 1, max: 200, phrases: ['stories', 'storeys', 'floors', 'number of stories'] },
  roofYear: { kind: 'year', min: YEAR_MIN, max: YEAR_MAX, phrases: ['roof year', 'roof was', 'roof replaced', 'roof age'] },
  occupancy: { kind: 'string', phrases: ['occupancy', 'occupied by'] },
  protectionClass: {
    kind: 'number',
    min: 1,
    max: 10,
    phrases: ['protection class', 'ppc', 'fire protection class', 'public protection'],
  },
  tivWeightedProtectionClass: {
    kind: 'number',
    min: 1,
    max: 10,
    phrases: ['protection class', 'ppc', 'fire protection class', 'public protection'],
  },
  // Locations
  state: { kind: 'string', phrases: ['state', 'which state', 'state code', 'located in'] },
  primaryState: { kind: 'string', phrases: ['primary state', 'which state', 'state code', 'located in'] },
  stateTier: { kind: 'string', phrases: ['primary state', 'which state', 'state code', 'located in'] },
  city: { kind: 'string', phrases: ['city'] },
  postalCode: { kind: 'string', phrases: ['postal code', 'zip', 'zip code'] },
  // Pricing, submission
  quotedPremium: { kind: 'money', min: 0, phrases: ['premium', 'quoted premium'] },
  technicalPremium: { kind: 'money', min: 0, phrases: ['technical premium'] },
  targetPremium: { kind: 'money', min: 0, phrases: ['target premium'] },
  submissionType: {
    kind: 'string',
    options: ['new_business', 'renewal'],
    phrases: ['new business', 'renewal', 'submission type'],
  },
  isNewBusiness: {
    kind: 'string',
    options: ['new_business', 'renewal'],
    phrases: ['new business', 'renewal', 'submission type'],
  },
  receivedDate: { kind: 'date', phrases: ['received date', 'date received'] },
  effectiveDate: { kind: 'date', phrases: ['effective date', 'inception'] },
  // Claims
  fiveYearLoss: { kind: 'money', min: 0, phrases: LOSS_PHRASES },
  paidIndemnity: { kind: 'money', min: 0, phrases: LOSS_PHRASES },
  paidExpense: { kind: 'money', min: 0, phrases: LOSS_PHRASES },
  // Reserves may be negative (recoveries, INTERPRETATIONS I-4).
  reserves: { kind: 'money', phrases: ['reserve', 'reserves', ...LOSS_PHRASES] },
  dateOfLoss: { kind: 'date', phrases: ['date of loss', 'loss date', ...LOSS_PHRASES] },
  causeOfLoss: { kind: 'string', phrases: ['cause of loss', ...LOSS_PHRASES] },
  // Exposure / insured
  requestedLimit: { kind: 'money', min: 0, phrases: ['requested limit', 'limit requested'] },
  contentsLimit: { kind: 'money', min: 0, phrases: ['contents limit', 'contents coverage', 'contents'] },
  termMonths: { kind: 'number', min: 4, max: 12, phrases: ['policy term', 'term length'] },
  revenue: { kind: 'money', min: 0, phrases: ['revenue', 'annual revenue'] },
  employeeCount: { kind: 'number', min: 0, phrases: ['employees', 'employee count', 'headcount'] },
  headquartersState: { kind: 'string', phrases: ['headquarters', 'hq'] },
  // Tenant hazards
  smokeDetectorCount: { kind: 'number', min: 0, phrases: ['smoke detector', 'smoke detectors', 'smoke alarm', 'smoke alarms'] },
  sprinklerHeadCount: { kind: 'number', min: 0, phrases: ['sprinkler head', 'sprinkler heads'] },
};

const COMPONENT_TYPE_KIND: Readonly<Record<VectorComponentSpec['type'], ValueKind>> = {
  binary: 'boolean',
  tier: 'number',
  currency: 'money',
  ratio: 'ratio',
  count: 'number',
  ordinal: 'number',
  year: 'year',
};

/** Words that make a sentence a request rather than context. */
const REQUEST_CUES = [
  'please',
  'could you',
  'can you',
  'would you',
  'send',
  'provide',
  'share',
  'confirm',
  'let us know',
  'let me know',
  'need',
  'we require',
  'advise',
];

/* -------------------------------------------------------------------------- */
/* Text normalisation                                                         */
/* -------------------------------------------------------------------------- */

/** Lower case, typographic quotes and dashes folded, whitespace collapsed. */
function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/ /g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Words only: punctuation, hyphens and underscores become spaces. */
function wordsOf(text: string): string {
  return ` ${normalizeText(text)
    .replace(/[_\-/]/g, ' ')
    .replace(/[^a-z0-9$%.' ]/g, ' ')
    .replace(/[.']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;
}

function hasPhrase(haystackWords: string, phrase: string): boolean {
  const needle = wordsOf(phrase);
  if (needle.trim() === '') return false;
  return haystackWords.includes(needle);
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.?!])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/* -------------------------------------------------------------------------- */
/* Path helpers                                                               */
/* -------------------------------------------------------------------------- */

function segmentsOf(path: string): string[] {
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((s) => s.length > 0);
}

function leafOf(path: string): string {
  const seg = segmentsOf(path);
  return seg[seg.length - 1] ?? path;
}

/** The entity id a list path addresses, e.g. `buildings.B3.yearBuilt` -> `B3`. */
function entityOf(path: string): { readonly list: string; readonly id: string } | null {
  const seg = segmentsOf(path);
  if (seg.length !== 3) return null;
  const list = seg[0] ?? '';
  const id = seg[1] ?? '';
  if (!['buildings', 'locations', 'history'].includes(list)) return null;
  if (id === '*' || /^\d+$/.test(id)) return null;
  return { list, id };
}

function ruleForLeaf(leaf: string): LeafRule | null {
  if (Object.prototype.hasOwnProperty.call(LEAF_RULES, leaf)) {
    return LEAF_RULES[leaf] ?? null;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Draft validator                                                            */
/* -------------------------------------------------------------------------- */

/** Every phrase that names this field: its label, then the leaf vocabulary. */
function phrasesFor(field: RequestedField): string[] {
  const out = new Set<string>();
  const label = field.label.replace(/\s+for\s+.*$/i, '').trim();
  if (label.length > 0) out.add(label.toLowerCase());
  const leaf = leafOf(field.canonicalPath);
  for (const p of ruleForLeaf(leaf)?.phrases ?? []) out.add(p);
  if (field.componentKey !== null) {
    for (const p of ruleForLeaf(field.componentKey)?.phrases ?? []) out.add(p);
  }
  // Hazards: `hazards.portableHeater` -> "portable heater".
  if (segmentsOf(field.canonicalPath)[0] === 'hazards') {
    out.add(leaf.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
  }
  return [...out];
}

/** The entity names a field is addressed by: the label tail and the raw id. */
function entityNamesFor(field: RequestedField): string[] {
  const entity = entityOf(field.canonicalPath);
  if (entity === null) return [];
  const names = new Set<string>([entity.id]);
  const tail = /\s+for\s+(.+)$/i.exec(field.label);
  if (tail?.[1] !== undefined) names.add(tail[1].trim());
  return [...names];
}

function mentionsField(textWords: string, field: RequestedField): boolean {
  const named = phrasesFor(field).some((p) => hasPhrase(textWords, p));
  if (!named) return false;
  const entities = entityNamesFor(field);
  if (entities.length === 0) return true;
  return entities.some((e) => hasPhrase(textWords, e));
}

function isRequestSentence(sentence: string): boolean {
  if (sentence.includes('?')) return true;
  const w = wordsOf(sentence);
  return REQUEST_CUES.some((cue) => hasPhrase(w, cue));
}

export function validateDraft(
  selection: RequestSelection,
  draft: string,
): DraftValidation {
  const problems: string[] = [];
  const text = typeof draft === 'string' ? draft : '';

  if (!selection.qualifies || selection.fields.length === 0) {
    problems.push('The selection does not qualify for a request; no draft should exist.');
  }
  if (text.trim().length === 0) {
    problems.push('The draft is empty.');
  }

  const textWords = wordsOf(text);
  const missingFields = selection.fields
    .filter((f) => !mentionsField(textWords, f))
    .map((f) => f.canonicalPath);

  // Extraneous: a request sentence that names a known field which was not
  // selected, and names none of the selected fields (a sentence explaining a
  // selected field may mention the factor it feeds).
  const selectedLeaves = new Set<string>();
  for (const f of selection.fields) {
    selectedLeaves.add(leafOf(f.canonicalPath));
    if (f.componentKey !== null) selectedLeaves.add(f.componentKey);
  }
  const selectedPhrases = new Set<string>(selection.fields.flatMap((f) => phrasesFor(f)));

  const extraneous = new Set<string>();
  for (const sentence of splitSentences(text)) {
    if (!isRequestSentence(sentence)) continue;
    const w = wordsOf(sentence);
    if (selection.fields.some((f) => mentionsField(w, f))) continue;
    for (const [leaf, rule] of Object.entries(LEAF_RULES)) {
      if (selectedLeaves.has(leaf)) continue;
      const hit = rule.phrases.some((p) => !selectedPhrases.has(p) && hasPhrase(w, p));
      if (hit) extraneous.add(leaf);
    }
  }
  const extraneousFields = [...extraneous].sort();

  if (missingFields.length > 0) {
    problems.push(`The draft does not ask for: ${missingFields.join(', ')}.`);
  }
  if (extraneousFields.length > 0) {
    problems.push(`The draft asks for fields that were not selected: ${extraneousFields.join(', ')}.`);
  }

  return {
    ok: problems.length === 0,
    missingFields,
    extraneousFields,
    problems,
  };
}

/* -------------------------------------------------------------------------- */
/* Extraction validator                                                       */
/* -------------------------------------------------------------------------- */

interface Expectation {
  readonly kind: ValueKind;
  readonly min: number | null;
  readonly max: number | null;
  readonly options: readonly string[] | null;
}

function componentFor(
  path: string,
  field: RequestedField | undefined,
  spec: VectorSpec,
): VectorComponentSpec | null {
  const seg = segmentsOf(path);
  const normalized = seg.join('.');
  for (const c of spec.components) {
    if (segmentsOf(c.source).join('.') === normalized) return c;
  }
  // `buildings[0].yearBuilt` in the tenant spec covers `buildings.<id>.yearBuilt`.
  if (seg.length === 3) {
    for (const c of spec.components) {
      const cs = segmentsOf(c.source);
      if (cs.length === 3 && cs[0] === seg[0] && /^\d+$/.test(cs[1] ?? '') && cs[2] === seg[2]) return c;
    }
  }
  if (path.startsWith('rollup.') && field?.componentKey != null) {
    for (const c of spec.components) {
      if (c.key === field.componentKey) return c;
    }
  }
  return null;
}

function finiteOrNull(v: number | undefined): number | null {
  return v !== undefined && math.isFiniteNumber(v) ? v : null;
}

function expectationFor(
  path: string,
  field: RequestedField | undefined,
  spec: VectorSpec,
): Expectation {
  const leaf = leafOf(path);
  const leafRule = ruleForLeaf(leaf);
  // A categorical or date leaf is never a number, whatever the component that
  // derives from it (`rollup.primaryState` feeds the numeric `stateTier`).
  const component =
    leafRule !== null && (leafRule.kind === 'string' || leafRule.kind === 'date')
      ? null
      : componentFor(path, field, spec);

  if (component !== null) {
    const kind = COMPONENT_TYPE_KIND[component.type];
    // The spec's range wins, falling back to the leaf's own bound.
    return {
      kind,
      min: finiteOrNull(component.min) ?? finiteOrNull(leafRule?.min),
      max: finiteOrNull(component.max) ?? finiteOrNull(leafRule?.max),
      options: leafRule?.options ?? null,
    };
  }
  if (leafRule !== null) {
    return {
      kind: leafRule.kind,
      min: finiteOrNull(leafRule.min),
      max: finiteOrNull(leafRule.max),
      options: leafRule.options ?? null,
    };
  }
  // Hazards not in the spec are presence flags.
  if (segmentsOf(path)[0] === 'hazards') {
    return { kind: 'boolean', min: null, max: null, options: null };
  }
  return { kind: 'string', min: null, max: null, options: null };
}

type Parsed =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: 'wrong_type' | 'unparseable' };

const MULTIPLIER: Readonly<Record<string, number>> = {
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

/** `$2.5M` -> 2500000, `150K` -> 150000, `1,234,567` -> 1234567 (G-4). */
function parseMoney(text: string): number | null {
  const t = normalizeText(text).replace(/usd|us\$|\$|,/g, '').trim();
  const m = /^(-?\d+(?:\.\d+)?)\s*([a-z]+)?$/.exec(t);
  if (m === null) return null;
  const base = Number(m[1]);
  const unit = m[2];
  if (unit === undefined) return base;
  const mult = MULTIPLIER[unit];
  return mult === undefined ? null : base * mult;
}

function parsePlainNumber(text: string): number | null {
  const t = normalizeText(text).replace(/,/g, '');
  if (!/^-?\d+(?:\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/** `40%` -> 0.4; a bare number must already be a share in [0, 1] (G-6). */
function parseRatio(text: string): number | null {
  const t = normalizeText(text).replace(/,/g, '');
  const pct = /^(-?\d+(?:\.\d+)?)\s*(%|percent|pct)$/.exec(t);
  if (pct !== null) return Number(pct[1]) / 100;
  return parsePlainNumber(t);
}

const TRUE_WORDS = new Set(['true', 'yes', 'y', 'present', 'sprinklered', 'fully sprinklered']);
const FALSE_WORDS = new Set(['false', 'no', 'n', 'none', 'absent', 'not sprinklered', 'unsprinklered']);

function parseBoolean(value: unknown): Parsed {
  if (typeof value === 'boolean') return { ok: true, value };
  if (typeof value === 'number') {
    if (value === 1) return { ok: true, value: true };
    if (value === 0) return { ok: true, value: false };
    return { ok: false, reason: 'wrong_type' };
  }
  if (typeof value === 'string') {
    const t = normalizeText(value);
    if (TRUE_WORDS.has(t)) return { ok: true, value: true };
    if (FALSE_WORDS.has(t)) return { ok: true, value: false };
    return { ok: false, reason: 'unparseable' };
  }
  return { ok: false, reason: 'wrong_type' };
}

function parseNumeric(value: unknown, kind: 'money' | 'year' | 'ratio' | 'number'): Parsed {
  let n: number | null = null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { ok: false, reason: 'unparseable' };
    n = value;
  } else if (typeof value === 'string') {
    if (kind === 'money') n = parseMoney(value);
    else if (kind === 'ratio') n = parseRatio(value);
    else n = parsePlainNumber(value);
    if (n === null || !Number.isFinite(n)) return { ok: false, reason: 'unparseable' };
  } else {
    return { ok: false, reason: 'wrong_type' };
  }
  // G-5: years are integers, floored before comparison.
  if (kind === 'year') n = Math.floor(n);
  return { ok: true, value: n };
}

/** `Masonry Non-Combustible` -> `masonry_non_combustible` (G-8). */
function snake(text: string): string {
  return normalizeText(text)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const SUBMISSION_TYPE_ALIASES: Readonly<Record<string, string>> = {
  new: 'new_business',
  new_business: 'new_business',
  newbusiness: 'new_business',
  renewal: 'renewal',
  renewal_business: 'renewal',
  renew: 'renewal',
};

function parseString(value: unknown, leaf: string, exp: Expectation): Parsed {
  if (typeof value !== 'string') {
    return { ok: false, reason: 'wrong_type' };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'unparseable' };

  if (leaf === 'state' || leaf === 'primaryState' || leaf === 'stateTier' || leaf === 'headquartersState') {
    // G-7: two-letter upper-case codes.
    const code = trimmed.toUpperCase();
    return /^[A-Z]{2}$/.test(code) ? { ok: true, value: code } : { ok: false, reason: 'unparseable' };
  }
  if (exp.options !== null) {
    const key = snake(trimmed);
    const mapped = SUBMISSION_TYPE_ALIASES[key] ?? key;
    return exp.options.includes(mapped)
      ? { ok: true, value: mapped }
      : { ok: false, reason: 'unparseable' };
  }
  return { ok: true, value: trimmed };
}

function parseDate(value: unknown): Parsed {
  if (typeof value !== 'string') return { ok: false, reason: 'wrong_type' };
  const t = value.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m === null) return { ok: false, reason: 'unparseable' };
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return { ok: false, reason: 'unparseable' };
  return { ok: true, value: t };
}

function parseValue(value: unknown, leaf: string, exp: Expectation): Parsed {
  if (value === null || value === undefined) return { ok: false, reason: 'unparseable' };
  switch (exp.kind) {
    case 'boolean':
      return parseBoolean(value);
    case 'string':
      return parseString(value, leaf, exp);
    case 'date':
      return parseDate(value);
    default:
      return parseNumeric(value, exp.kind);
  }
}

function inRange(value: unknown, exp: Expectation): boolean {
  if (typeof value !== 'number') return true;
  if (exp.min !== null && value < exp.min) return false;
  if (exp.max !== null && value > exp.max) return false;
  return true;
}

function quoteFoundIn(quote: unknown, sourceNormalized: string): boolean {
  if (typeof quote !== 'string') return false;
  const q = normalizeText(quote).replace(/^["']+|["']+$/g, '').trim();
  if (q.length === 0) return false;
  return sourceNormalized.includes(q);
}

function clampConfidence(c: unknown): number {
  return typeof c === 'number' && Number.isFinite(c) ? math.clamp01(c) : 0;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return math.approxEqual(a, b);
  return a === b;
}

export interface ValidateExtractionInput {
  readonly extracted: readonly ExtractedFieldValue[];
  readonly requested: RequestSelection;
  readonly spec: VectorSpec;
  readonly sourceText: string;
}

export function validateExtraction(
  input: ValidateExtractionInput,
): readonly ValidatedFieldValue[] {
  const requestedByPath = new Map<string, RequestedField>();
  for (const f of input.requested.fields) requestedByPath.set(f.canonicalPath, f);
  const sourceNormalized = normalizeText(typeof input.sourceText === 'string' ? input.sourceText : '');

  const validated: ValidatedFieldValue[] = input.extracted.map((raw) => {
    const confidence = clampConfidence(raw.confidence);
    const quote = typeof raw.quote === 'string' ? raw.quote : '';
    const quoteFound = quoteFoundIn(quote, sourceNormalized);
    const base = { canonicalPath: raw.canonicalPath, confidence, quote };

    const field = requestedByPath.get(raw.canonicalPath);
    if (field === undefined) {
      return {
        ...base,
        value: raw.value,
        accepted: false,
        quoteFound,
        typeOk: false,
        rangeOk: false,
        rejection: 'not_requested',
        needsConfirmation: false,
      };
    }

    const exp = expectationFor(raw.canonicalPath, field, input.spec);
    const parsed = parseValue(raw.value, leafOf(raw.canonicalPath), exp);
    const typeOk = parsed.ok;
    const value = parsed.ok ? parsed.value : raw.value;
    const rangeOk = typeOk && inRange(value, exp);

    let rejection: ExtractionRejection | null = null;
    if (!parsed.ok) rejection = parsed.reason;
    else if (!rangeOk) rejection = 'out_of_range';
    else if (!quoteFound) rejection = 'quote_not_found';
    else if (confidence < MIN_EXTRACTION_CONFIDENCE) rejection = 'low_confidence';

    const accepted = rejection === null;
    return {
      ...base,
      value,
      accepted,
      quoteFound,
      typeOk,
      rangeOk,
      rejection,
      // Below 0.8 but otherwise clean: the underwriter confirms it by hand.
      needsConfirmation: rejection === 'low_confidence',
    };
  });

  // Two clean values for one path that disagree: neither is trusted past the
  // gate; both go to the underwriter (docs/decisions/F13.md D-4).
  const acceptedByPath = new Map<string, number[]>();
  validated.forEach((v, i) => {
    if (!v.accepted) return;
    const list = acceptedByPath.get(v.canonicalPath) ?? [];
    list.push(i);
    acceptedByPath.set(v.canonicalPath, list);
  });
  for (const indices of acceptedByPath.values()) {
    if (indices.length < 2) continue;
    const first = validated[indices[0] ?? 0];
    const disagree = indices.some((i) => !sameValue(validated[i]?.value, first?.value));
    if (!disagree) continue;
    for (const i of indices) {
      const v = validated[i];
      if (v === undefined) continue;
      validated[i] = { ...v, accepted: false, rejection: 'low_confidence', needsConfirmation: true };
    }
  }

  return validated;
}
