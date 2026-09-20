/*
 * The layer A+B field, without React: decoding the one-byte-per-case files
 * `packages/verify/src/scripts/record-field.ts` wrote, ordering the cases, and
 * painting them one pixel each. Kept apart from the component so it can be
 * tested without a canvas.
 */

/** GET /verification/field. Counts are per verdict, in `verdicts` order. */
export interface FieldSummary {
  readonly seed: number;
  readonly total: number;
  readonly generatedAt: string;
  readonly verdicts: readonly string[];
  readonly factors: readonly string[];
  readonly strata: readonly { readonly key: string; readonly description: string }[];
  readonly byVerdict: readonly number[];
  /** Row 0 is "no deciding factor", then one row per factor. */
  readonly byFactor: readonly (readonly number[])[];
  /** Row 0 is "ordinary case", then one row per stratum. */
  readonly byStratum: readonly (readonly number[])[];
  readonly scoreHistogram: readonly (readonly number[])[];
  readonly fromSubmission: number;
  readonly onThreshold: number;
}

export const COLOR_BY = ['verdict', 'factor', 'score'] as const;
export type ColorBy = (typeof COLOR_BY)[number];

/** What is kept at full strength; everything else is washed toward the surface. */
export type Highlight =
  | { readonly kind: 'none' }
  | { readonly kind: 'threshold' }
  | { readonly kind: 'submission' }
  | { readonly kind: 'stratum'; readonly index: number };

export const verdictOf = (byte: number): number => byte & 3;
export const factorOf = (byte: number): number => (byte >> 2) & 15;
export const isFromSubmission = (byte: number): boolean => (byte & 64) !== 0;
export const isOnThreshold = (byte: number): boolean => (byte & 128) !== 0;

export const SURFACE = '#FAF8F2';

/** PRD 13 verdict colours: FIT red, REFER amber, DOES_NOT_FIT ink. Always shown with the word and the count. */
export const VERDICT_COLORS = ['#E4002B', '#EDA100', '#1F1E1B'] as const;

/** "No deciding factor" in neutral grey, then the eight factors in fixed categorical order. */
export const FACTOR_COLORS = [
  '#B9B8B0',
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#4a3aa7',
  '#e34948',
] as const;

/** One hue, light to dark, for the 0..100 appetite score. */
const SCORE_FROM = [0x86, 0xb6, 0xef] as const;
const SCORE_TO = [0x0d, 0x36, 0x6b] as const;

function rgb(hex: string): readonly [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Little-endian RGBA as one uint32, the layout of `ImageData`'s buffer. */
function pack(r: number, g: number, b: number): number {
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

const WASH = 0.86;

function washed(c: readonly [number, number, number]): number {
  const s = rgb(SURFACE);
  return pack(
    Math.round(c[0] + (s[0] - c[0]) * WASH),
    Math.round(c[1] + (s[1] - c[1]) * WASH),
    Math.round(c[2] + (s[2] - c[2]) * WASH),
  );
}

export function scoreColor(score: number): readonly [number, number, number] {
  const t = Math.max(0, Math.min(100, score)) / 100;
  return [
    Math.round(SCORE_FROM[0] + (SCORE_TO[0] - SCORE_FROM[0]) * t),
    Math.round(SCORE_FROM[1] + (SCORE_TO[1] - SCORE_FROM[1]) * t),
    Math.round(SCORE_FROM[2] + (SCORE_TO[2] - SCORE_FROM[2]) * t),
  ];
}

export function cssColor(c: readonly [number, number, number]): string {
  return `rgb(${c[0]} ${c[1]} ${c[2]})`;
}

/** The colour table for a mode: full-strength and washed, indexed by the mode's key. */
function palette(colorBy: ColorBy): { readonly full: Uint32Array; readonly dim: Uint32Array } {
  const colors: readonly (readonly [number, number, number])[] =
    colorBy === 'verdict'
      ? VERDICT_COLORS.map(rgb)
      : colorBy === 'factor'
        ? FACTOR_COLORS.map(rgb)
        : Array.from({ length: 101 }, (_, s) => scoreColor(s));
  return {
    full: Uint32Array.from(colors, (c) => pack(c[0], c[1], c[2])),
    dim: Uint32Array.from(colors, washed),
  };
}

export interface FieldLayers {
  readonly cases: Uint8Array;
  readonly scores: Uint8Array | null;
  readonly strata: Uint8Array | null;
}

/** The byte the current colour mode reads for case `i`. */
function keyAt(layers: FieldLayers, colorBy: ColorBy, i: number): number {
  if (colorBy === 'verdict') return verdictOf(layers.cases[i]!);
  if (colorBy === 'factor') return factorOf(layers.cases[i]!);
  return layers.scores === null ? 0 : layers.scores[i]!;
}

/**
 * Pixel position -> case index with like cases together (a stable counting
 * sort on the colour key, so run order is kept inside each band).
 */
export function groupedOrder(layers: FieldLayers, colorBy: ColorBy): Uint32Array {
  const total = layers.cases.length;
  const buckets = colorBy === 'verdict' ? 3 : colorBy === 'factor' ? 16 : 101;
  const starts = new Uint32Array(buckets + 1);
  for (let i = 0; i < total; i++) starts[keyAt(layers, colorBy, i) + 1]!++;
  for (let b = 0; b < buckets; b++) starts[b + 1]! += starts[b]!;
  const order = new Uint32Array(total);
  for (let i = 0; i < total; i++) order[starts[keyAt(layers, colorBy, i)]!++] = i;
  return order;
}

function highlighted(layers: FieldLayers, highlight: Highlight, i: number): boolean {
  switch (highlight.kind) {
    case 'none':
      return true;
    case 'threshold':
      return isOnThreshold(layers.cases[i]!);
    case 'submission':
      return isFromSubmission(layers.cases[i]!);
    case 'stratum':
      return layers.strata !== null && layers.strata[i] === highlight.index;
  }
}

/** Side of the square that holds `total` pixels. */
export function fieldSide(total: number): number {
  return Math.ceil(Math.sqrt(total));
}

/** Paints every case into `out` (a `side * side` RGBA buffer viewed as uint32), row-major in `order`. */
export function paintField(
  out: Uint32Array,
  layers: FieldLayers,
  order: Uint32Array | null,
  colorBy: ColorBy,
  highlight: Highlight,
): void {
  const { full, dim } = palette(colorBy);
  const total = layers.cases.length;
  const all = highlight.kind === 'none';
  for (let p = 0; p < total; p++) {
    const i = order === null ? p : order[p]!;
    const key = keyAt(layers, colorBy, i);
    out[p] = all || highlighted(layers, highlight, i) ? full[key]! : dim[key]!;
  }
  out.fill(0, total);
}

/** A random case that passes `test`, or null when none turned up. */
export function randomCase(total: number, test: (index: number) => boolean, random: () => number = Math.random): number | null {
  for (let tries = 0; tries < 400_000; tries++) {
    const i = Math.floor(random() * total);
    if (test(i)) return i;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* GET /verification/cases/:index                                              */
/* -------------------------------------------------------------------------- */

export interface CaseCitation {
  readonly doc: string;
  readonly section: string;
  readonly quote: string;
}

export interface ExplainedFactor {
  readonly factor: string;
  readonly tier: string | null;
  readonly tierValue: number | null;
  readonly weight: number;
  readonly points: number;
  readonly knockout: boolean;
  readonly refer: boolean;
  readonly ruleId: string | null;
  readonly citation: CaseCitation | null;
  readonly naiveTier: string | null;
  readonly naiveTierValue: number | null;
  readonly naivePoints: number | null;
}

export interface ExplainedSide {
  readonly verdict: string;
  readonly appetiteScore: number;
  readonly completeness: number;
  readonly decidingFactorId: string | null;
  readonly knockoutFactorIds: readonly string[];
}

export interface ExplainedCase {
  readonly caseId: string;
  readonly seed: number;
  readonly index: number;
  readonly stratum: string | null;
  readonly fromSubmission: boolean;
  readonly buildings:
    | readonly {
        readonly id: string;
        readonly state: string | null;
        readonly yearBuilt: number | null;
        readonly constructionType: string | null;
        readonly tiv: number | null;
      }[]
    | null;
  readonly input: Readonly<Record<string, string | number | boolean | null>>;
  readonly boundaries: Readonly<Record<string, string>>;
  readonly engine: ExplainedSide & {
    readonly decidingRule: { readonly ruleId: string; readonly factor: string; readonly tier: string; readonly citation: CaseCitation } | null;
    readonly reasons: readonly string[];
  };
  readonly naive: ExplainedSide & { readonly referReasons: readonly string[] };
  readonly factors: readonly ExplainedFactor[];
  readonly agreed: boolean;
  readonly disagreements: readonly { readonly field: string; readonly engine: unknown; readonly naive: unknown }[];
  readonly invariants: readonly { readonly suite: string; readonly name: string; readonly violations: readonly string[] }[];
}
