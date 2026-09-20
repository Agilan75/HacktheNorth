/**
 * CSS export for the console, plus the WCAG contrast arithmetic the design
 * system is tested against. Unit D01. The token values live in `tokens.ts`.
 */
import { COLORS, VERDICT_STYLES, cssVariableBlock } from './tokens.js';

export interface CssExportOptions {
  /** Selector for the custom-property block. Default `:root`. */
  readonly selector?: string;
  /** Header comment written at the top of the generated file. */
  readonly banner?: string;
}

const DEFAULT_BANNER = [
  'Retrofit design tokens (PRD 13). GENERATED from @retrofit/design renderTokenStylesheet().',
  'Do not hand-edit values; change packages/design/src/tokens.ts and regenerate.',
].join('\n');

/** A star-slash inside a banner would close the comment early; neutralise it. */
function commentBody(text: string): string {
  return text
    .replace(/\*\//g, '* /')
    .split('\n')
    .map((line) => (line.length > 0 ? ` * ${line}` : ' *'))
    .join('\n');
}

/** The full contents of `apps/console/src/styles/tokens.css`. */
export function renderTokenStylesheet(options?: CssExportOptions): string {
  const selector = options?.selector ?? ':root';
  const banner = options?.banner ?? DEFAULT_BANNER;
  const header = banner.trim().length > 0 ? `/*\n${commentBody(banner.trim())}\n */\n` : '';
  return `${header}${cssVariableBlock(selector)}`;
}

/** Parses `#rrggbb` (or `#rgb`) into 0–255 channels; throws on anything else. */
function parseHex(hex: string): readonly [number, number, number] {
  const raw = hex.trim().replace(/^#/, '');
  const full = /^[0-9a-fA-F]{3}$/.test(raw)
    ? raw
        .split('')
        .map((c) => c + c)
        .join('')
    : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`Not a #rrggbb colour: ${JSON.stringify(hex)}`);
  }
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function linearise(channel: number): number {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance of a `#rrggbb` colour. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b);
}

/** Contrast ratio between two `#rrggbb` colours, 1–21. */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

export interface ContrastCheck {
  readonly foreground: string;
  readonly background: string;
  readonly ratio: number;
  readonly passesAA: boolean;
  readonly passesAALarge: boolean;
}

/** WCAG 2.x SC 1.4.3 thresholds. */
const AA_NORMAL = 4.5;
const AA_LARGE = 3;

function check(foreground: string, background: string): ContrastCheck {
  const ratio = contrastRatio(foreground, background);
  return {
    foreground,
    background,
    ratio,
    passesAA: ratio >= AA_NORMAL,
    passesAALarge: ratio >= AA_LARGE,
  };
}

/**
 * Every foreground/background pair the phone app actually uses.
 *
 * Bone is every background and muteTint is what a card is filled with. Ink is
 * all text; `mute` is secondary text and is AA-large only, so it belongs at
 * 22px and up or beside something ink already says. Accent is never text on
 * bone except at display size, where it carries the price and nothing else,
 * and it is listed here so that fact is measured rather than assumed. Amber and
 * red are never text at all: they are verdict fills, and both carry ink or bone
 * on top.
 *
 * The console's legacy aliases are not listed. They point at these same seven
 * colours, so every pair they can form is already here.
 */
export function contrastMatrix(): readonly ContrastCheck[] {
  const pairs: Array<readonly [string, string]> = [
    [COLORS.ink, COLORS.bone],
    [COLORS.mute, COLORS.bone],
    [COLORS.red, COLORS.bone],
    [COLORS.accent, COLORS.bone],
    [COLORS.ink, COLORS.muteTint],
    [COLORS.ink, COLORS.accent],
    [COLORS.ink, COLORS.amber],
    [COLORS.bone, COLORS.ink],
    [COLORS.bone, COLORS.red],
  ];
  // Every verdict is a filled pill now, but the check stays: an outlined one
  // would sit on bone, and its text has to be measured against that.
  for (const style of Object.values(VERDICT_STYLES)) {
    pairs.push([style.text, style.fill === 'transparent' ? COLORS.bone : style.fill]);
  }

  const seen = new Set<string>();
  const out: ContrastCheck[] = [];
  for (const [fg, bg] of pairs) {
    const key = `${fg.toUpperCase()}|${bg.toUpperCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(check(fg, bg));
  }
  return out;
}

/**
 * The pairs that are allowed to fall short of AA, and why. Everything else in
 * the matrix must pass, and the contrast test asserts exactly that.
 *
 * `accent` on `bone` is 2.73:1. It is the price on the verdict screen: one
 * number, at the 34pt display step, with the same figure repeated in ink
 * underneath and read out in full to a screen reader. `mute` on `bone` is
 * 3.24:1, AA-large: secondary lines only, never a label that has to be read on
 * its own.
 */
export const CONTRAST_EXEMPTIONS: readonly (readonly [string, string])[] = [
  [COLORS.accent, COLORS.bone],
  [COLORS.mute, COLORS.bone],
];
