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
 * Every foreground/background pair the design system actually uses.
 *
 * Surfaces are Paper (page), Muted tint (table header, chip) and Red tint
 * (highlighted row). Verdict pills are derived from VERDICT_STYLES; an
 * outlined (transparent) pill sits on Paper. `muted` on Paper is listed
 * because it is used, and it is AA-large only: it is for 22px+ or decorative
 * text, and small secondary text must use `mutedDeep`.
 */
export function contrastMatrix(): readonly ContrastCheck[] {
  const pairs: Array<readonly [string, string]> = [
    [COLORS.ink, COLORS.paper],
    [COLORS.mutedDeep, COLORS.paper],
    [COLORS.muted, COLORS.paper],
    [COLORS.red, COLORS.paper],
    [COLORS.redDeep, COLORS.paper],
    [COLORS.ink, COLORS.mutedTint],
    [COLORS.mutedDeep, COLORS.mutedTint],
    [COLORS.ink, COLORS.redTint],
    [COLORS.redDeep, COLORS.redTint],
  ];
  for (const style of Object.values(VERDICT_STYLES)) {
    const background = style.fill === 'transparent' ? COLORS.paper : style.fill;
    pairs.push([style.text, background]);
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
