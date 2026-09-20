/**
 * FROZEN (W0-4), with one authorised exception: the `feat/ar-sweep` mobile
 * rework replaced the colour palette and added a third registered font face.
 * Everything else here is still PRD §13 verbatim, and still frozen.
 * The reasoning, and what it cost the console, is in
 * `docs/decisions/mobile-rework.md` (Phase E).
 *
 * Plain TypeScript constants with no runtime dependency, so both consumers can
 * read them: the console (via the generated CSS custom properties) and the
 * Expo app (via plain numbers and strings in StyleSheet objects).
 */

/* ---------------------------------------------------------------- colour */

/**
 * Seven colours. Bone is every background and ink is all text; accent is the
 * only accent and carries the price, the buttons and the coverage wash; amber
 * and red each mean exactly one verdict and nothing else; mute is secondary
 * text and dividers, and muteTint is what a card is filled with.
 *
 * Measured against bone: ink 15.35:1, red 4.76:1, mute 3.24:1, accent 2.73:1,
 * amber 2.11:1. So body text is always ink, never accent and never amber, and
 * anything filled with accent or amber carries ink on top (5.63:1 and 7.27:1).
 */
export const COLORS = {
  /** Every background. */
  bone: '#F4EFE6',
  /** All text. */
  ink: '#191919',
  /** The price, buttons, the AR wash, active states. The only accent. */
  accent: '#D97757',
  /** REFER only. */
  amber: '#C9A227',
  /** DOES_NOT_FIT only. */
  red: '#B5443A',
  /** Secondary text, dividers. */
  mute: '#8A8478',
  /** Card fills, hairlines. */
  muteTint: '#E9E4DA',

  /* ---------------------------------------------- console compatibility */
  /**
   * Below this line are aliases, not colours.
   *
   * The console was built against the previous palette and is a separate
   * product that this rework was told not to restyle. Keeping its token names
   * and pointing them at the nearest new colour lets it compile, and lets the
   * generated stylesheet keep every `--rf-*` its CSS already references, with
   * no change to a single console component. It does change the console's
   * colours; that was the trade, and it is recorded in
   * `docs/decisions/mobile-rework.md`.
   *
   * Nothing in `apps/mobile` may name any of these. The phone app uses the
   * seven above and nothing else.
   */
  paper: '#F4EFE6',
  muted: '#8A8478',
  mutedDeep: '#8A8478',
  mutedTint: '#E9E4DA',
  redDeep: '#B5443A',
  redTint: '#E9E4DA',
  blue: '#D97757',
  blueDeep: '#191919',
  blueTint: '#E9E4DA',
  green: '#8A8478',
  greenDeep: '#191919',
  greenTint: '#E9E4DA',
} as const;

export type ColorToken = keyof typeof COLORS;

/** The seven the phone app is allowed to name. The rest of `COLORS` is legacy. */
export const MOBILE_COLOR_TOKENS: readonly ColorToken[] = [
  'bone',
  'ink',
  'accent',
  'amber',
  'red',
  'mute',
  'muteTint',
];

/**
 * `accent` stands in for Intact's brand colour and is the one token expected to
 * be swapped. Swap it here; every consumer follows.
 */
export const BRAND_ACCENT_IS_PLACEHOLDER = true;

/* ------------------------------------------------------------ typography */

/**
 * The registered font families.
 *
 * One name per FACE, not per family: a phone cannot synthesise a weight for a
 * custom font the way a browser can, so every weight the app uses has to be
 * loaded and named in its own right. The Expo app registers exactly these three
 * with `useFonts`; the console maps them through `FONT_STACKS` instead.
 *
 * Display text is always semibold in this system, so `display` is that face.
 */
export const FONT_FAMILIES = {
  /** Display and verdict text: Fraunces SemiBold. */
  display: 'Fraunces',
  /** Body text, tables, labels: Inter Regular. */
  body: 'Inter',
  /** Body text at semibold: Inter SemiBold, a separate face. */
  bodyStrong: 'Inter-SemiBold',
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
  color: COLORS.muteTint,
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
export interface VerdictStyle {
  readonly label: string;
  readonly short: string;
  /** A colour, or `transparent` for an outlined pill. */
  readonly fill: string;
  readonly text: string;
  readonly border: string;
  readonly variant: 'filled' | 'outlined';
}

/**
 * Typed rather than `as const`, so `fill` stays `string`: consumers compare it
 * against `'transparent'` to tell an outlined pill from a filled one, and a
 * literal union would make every one of those comparisons a type error the
 * moment all three verdicts happen to be filled.
 */
export const VERDICT_STYLES: Readonly<Record<'FIT' | 'REFER' | 'DOES_NOT_FIT', VerdictStyle>> = {
  FIT: {
    label: 'Fits appetite',
    short: 'FIT',
    fill: COLORS.accent,
    text: COLORS.ink,
    border: COLORS.accent,
    variant: 'filled',
  },
  REFER: {
    label: 'Refer to underwriter',
    short: 'REFER',
    fill: COLORS.amber,
    text: COLORS.ink,
    border: COLORS.amber,
    variant: 'filled',
  },
  DOES_NOT_FIT: {
    label: 'Outside appetite',
    short: 'DOES NOT FIT',
    fill: COLORS.red,
    text: COLORS.bone,
    border: COLORS.red,
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
