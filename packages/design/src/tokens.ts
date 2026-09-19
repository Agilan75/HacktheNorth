/**
 * FROZEN (W0-4) — the Retrofit design tokens, PRD §13, verbatim.
 *
 * Plain TypeScript constants with no runtime dependency, so both consumers can
 * read them: the console (via the generated CSS custom properties) and the
 * Expo app (via plain numbers and strings in StyleSheet objects).
 *
 * Nothing here is a stub. Unit D01 adds `css.ts` (the CSS export and its
 * contrast test) and `rn.ts` (React Native helpers) on top of this file.
 */

/* ---------------------------------------------------------------- colour */

export const COLORS = {
  paper: '#FAF8F2',
  ink: '#1F1E1B',
  red: '#E4002B',
  redDeep: '#B80022',
  redTint: '#FBE3E6',
  muted: '#7C8073',
  mutedDeep: '#5E6357',
  mutedTint: '#EDEFE8',
  /**
   * Accent family, added on top of the frozen Paper/Ink/Red/Muted system.
   * Red stays reserved for the verdict pills (PRD §13: "red never means bad");
   * blue is the informational/primary-action accent (charts, primary buttons,
   * chips) and green marks a positive completion (sent, available, moved up).
   * Neither ever stands alone: every use still carries a word or a mark.
   */
  blue: '#2C6E9E',
  blueDeep: '#1D3557',
  blueTint: '#E4EAF1',
  green: '#2E7050',
  greenDeep: '#265C42',
  greenTint: '#E3EFE7',
} as const;

export type ColorToken = keyof typeof COLORS;

/**
 * `red` is a placeholder for Intact's brand red and is the only token expected
 * to be swapped. Swap it in this file; every consumer follows.
 */
export const BRAND_RED_IS_PLACEHOLDER = true;

/* ------------------------------------------------------------ typography */

export const FONT_FAMILIES = {
  /** Display and verdict text. */
  display: 'Fraunces',
  /** Body text, tables, labels. */
  body: 'Inter',
} as const;

/** Web font stacks (console). The Expo app registers the same two families. */
export const FONT_STACKS = {
  display: "'Fraunces Variable', Fraunces, Georgia, 'Times New Roman', serif",
  body: "'Inter Variable', Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
} as const;

/** The six sizes of PRD §13, in points on mobile and px on the web. */
export const FONT_SIZES = {
  display: 34,
  title: 28,
  heading: 22,
  body: 17,
  small: 15,
  micro: 13,
} as const;

export type FontSizeToken = keyof typeof FONT_SIZES;

/** Line heights on the 4pt grid, one per size. */
export const LINE_HEIGHTS = {
  display: 40,
  title: 32,
  heading: 28,
  body: 24,
  small: 20,
  micro: 16,
} as const;

export const FONT_WEIGHTS = {
  regular: 400,
  medium: 500,
  semibold: 600,
} as const;

/* ---------------------------------------------------------------- layout */

/** The 4pt grid. Every margin, padding and gap is a multiple of this. */
export const GRID_UNIT = 4;

/** Named steps on the grid: 4, 8, 12, 16, 24, 32, 48, 64. */
export const SPACE = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  huge: 64,
} as const;

export type SpaceToken = keyof typeof SPACE;

export const RADIUS = {
  /** Cards, panels, inputs. */
  card: 16,
  /** Pills and chips. */
  pill: 999,
} as const;

export const BORDER = {
  width: 1,
  color: COLORS.mutedTint,
} as const;

/** PRD §13: no shadows anywhere. Elevation is a border, never a shadow. */
export const SHADOWS = {
  none: 'none',
} as const;

/** PRD §11 and §13: 44pt minimum touch target on every interactive element. */
export const MIN_TOUCH_TARGET = 44;

/* --------------------------------------------------------------- meaning */

/**
 * PRD §13: "Red never means bad" and "Colour never carries meaning alone."
 *
 * Every verdict style therefore ships with the words a consumer must render
 * next to the colour. A component that renders `fill`/`border` without `label`
 * is a bug; the C02 and M3 tests assert the label is present.
 */
export const VERDICT_STYLES = {
  FIT: {
    label: 'Fits appetite',
    short: 'FIT',
    fill: COLORS.red,
    text: COLORS.paper,
    border: COLORS.red,
    variant: 'filled',
  },
  REFER: {
    label: 'Refer to underwriter',
    short: 'REFER',
    fill: 'transparent',
    text: COLORS.redDeep,
    border: COLORS.red,
    variant: 'outlined',
  },
  DOES_NOT_FIT: {
    label: 'Outside appetite',
    short: 'DOES NOT FIT',
    fill: COLORS.ink,
    text: COLORS.paper,
    border: COLORS.ink,
    variant: 'filled',
  },
} as const;

export type VerdictToken = keyof typeof VERDICT_STYLES;

/**
 * The non-colour signal that must accompany each verdict when it appears in a
 * chart, a table cell or any other place with no room for the full label.
 */
export const VERDICT_MARKS = {
  FIT: '●',
  REFER: '◐',
  DOES_NOT_FIT: '○',
} as const;

/** Tier styling shares the same rule: the label is mandatory. */
export const TIER_LABELS = {
  target: 'Target',
  acceptable: 'Acceptable',
  not_acceptable: 'Not acceptable',
  refer: 'Refer',
} as const;

export type TierToken = keyof typeof TIER_LABELS;

/* --------------------------------------------------- CSS variable export */

/** The custom-property name for a token, e.g. `redDeep` → `--rf-red-deep`. */
export function cssVarName(token: string): string {
  return `--rf-${token.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}`;
}

/** `cssVar('redDeep')` → `var(--rf-red-deep)`. */
export function cssVar(token: string): string {
  return `var(${cssVarName(token)})`;
}

/**
 * Every token as `--rf-*: value` declarations, one per line, without a
 * selector. D01's `css.ts` wraps this in `:root { … }` and writes
 * `apps/console/src/styles/tokens.css`.
 */
export function cssVariableDeclarations(): string {
  const lines: string[] = [];
  const push = (name: string, value: string | number): void => {
    lines.push(`${cssVarName(name)}: ${String(value)};`);
  };

  for (const [key, value] of Object.entries(COLORS)) push(key, value);
  for (const [key, value] of Object.entries(FONT_STACKS)) push(`font-${key}`, value);
  for (const [key, value] of Object.entries(FONT_SIZES)) push(`size-${key}`, `${value}px`);
  for (const [key, value] of Object.entries(LINE_HEIGHTS)) push(`leading-${key}`, `${value}px`);
  for (const [key, value] of Object.entries(FONT_WEIGHTS)) push(`weight-${key}`, value);
  for (const [key, value] of Object.entries(SPACE)) push(`space-${key}`, `${value}px`);
  push('grid-unit', `${GRID_UNIT}px`);
  push('radius-card', `${RADIUS.card}px`);
  push('radius-pill', `${RADIUS.pill}px`);
  push('border-width', `${BORDER.width}px`);
  push('border-color', BORDER.color);
  push('shadow-none', SHADOWS.none);
  push('min-touch-target', `${MIN_TOUCH_TARGET}px`);

  return lines.join('\n');
}

/** The same declarations wrapped in a selector (default `:root`). */
export function cssVariableBlock(selector = ':root'): string {
  const body = cssVariableDeclarations()
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
  return `${selector} {\n${body}\n}\n`;
}

/** Every token flattened to `name → value`, for tests and for the RN helpers. */
export function tokenTable(): Readonly<Record<string, string | number>> {
  const table: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(COLORS)) table[key] = value;
  for (const [key, value] of Object.entries(FONT_SIZES)) table[`size-${key}`] = value;
  for (const [key, value] of Object.entries(LINE_HEIGHTS)) table[`leading-${key}`] = value;
  for (const [key, value] of Object.entries(SPACE)) table[`space-${key}`] = value;
  table['grid-unit'] = GRID_UNIT;
  table['radius-card'] = RADIUS.card;
  table['radius-pill'] = RADIUS.pill;
  table['border-width'] = BORDER.width;
  table['min-touch-target'] = MIN_TOUCH_TARGET;
  return table;
}
