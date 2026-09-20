/**
 * React Native helpers. Unit D01.
 *
 * This file must stay free of `react-native` imports: `@retrofit/design` is
 * consumed by the console too and has no RN dependency. The style objects
 * below are structurally compatible with RN's TextStyle and ViewStyle.
 */
import {
  BORDER,
  COLORS,
  FONT_FAMILIES,
  FONT_SIZES,
  GRID_UNIT,
  LINE_HEIGHTS,
  MIN_TOUCH_TARGET,
  RADIUS,
  SPACE,
  VERDICT_MARKS,
  VERDICT_STYLES,
} from './tokens.js';
import type { FontSizeToken, SpaceToken, VerdictToken } from './tokens.js';

export interface RnTextStyle {
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly lineHeight?: number;
  readonly fontWeight?: '400' | '500' | '600';
  readonly color?: string;
}

export interface RnViewStyle {
  readonly backgroundColor?: string;
  readonly borderWidth?: number;
  readonly borderColor?: string;
  readonly borderRadius?: number;
  readonly padding?: number;
  readonly paddingHorizontal?: number;
  readonly paddingVertical?: number;
  readonly minHeight?: number;
  readonly minWidth?: number;
}

/** OS font-scale bounds honoured (iOS xSmall ≈ 0.82 … AX5 ≈ 3.1). */
const MIN_FONT_SCALE = 0.8;
const MAX_FONT_SCALE = 3.2;

function normaliseScale(fontScale: number | undefined): number {
  if (fontScale === undefined || !Number.isFinite(fontScale) || fontScale <= 0) return 1;
  return Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, fontScale));
}

const TEXT_FAMILY: Readonly<Record<FontSizeToken, string>> = {
  display: FONT_FAMILIES.display,
  title: FONT_FAMILIES.display,
  heading: FONT_FAMILIES.display,
  body: FONT_FAMILIES.body,
  small: FONT_FAMILIES.body,
  micro: FONT_FAMILIES.body,
};

const TEXT_WEIGHT: Readonly<Record<FontSizeToken, '400' | '500' | '600'>> = {
  display: '600',
  title: '600',
  heading: '600',
  body: '400',
  small: '400',
  micro: '500',
};

/** One of the six PRD §13 type steps, with dynamic-type scaling applied. */
export function textStyle(token: FontSizeToken, fontScale?: number): RnTextStyle {
  const scale = normaliseScale(fontScale);
  const fontSize = Math.round(FONT_SIZES[token] * scale);
  // Line height stays on the 4pt grid and never drops below the glyph size.
  const scaledLeading = Math.ceil((LINE_HEIGHTS[token] * scale) / GRID_UNIT) * GRID_UNIT;
  const lineHeight = Math.max(scaledLeading, Math.ceil(fontSize / GRID_UNIT) * GRID_UNIT);
  return {
    fontFamily: TEXT_FAMILY[token],
    fontSize,
    lineHeight,
    fontWeight: TEXT_WEIGHT[token],
    color: COLORS.ink,
  };
}

/** A card surface: radius 16, 1px Muted-tint border, no shadow. */
export function cardStyle(padding: SpaceToken = 'lg'): RnViewStyle {
  return {
    backgroundColor: COLORS.bone,
    borderWidth: BORDER.width,
    borderColor: BORDER.color,
    borderRadius: RADIUS.card,
    padding: SPACE[padding],
  };
}

/** A pill surface for a verdict, never used without its label text. */
export function verdictPillStyle(verdict: VerdictToken): {
  readonly container: RnViewStyle;
  readonly text: RnTextStyle;
  readonly label: string;
  readonly mark: string;
} {
  const style = VERDICT_STYLES[verdict];
  return {
    container: {
      backgroundColor: style.fill,
      borderWidth: BORDER.width,
      borderColor: style.border,
      borderRadius: RADIUS.pill,
      paddingHorizontal: SPACE.md,
      paddingVertical: SPACE.xs,
    },
    text: {
      ...textStyle('small'),
      fontFamily: FONT_FAMILIES.display,
      fontWeight: '600',
      color: style.text,
    },
    label: style.label,
    mark: VERDICT_MARKS[verdict],
  };
}

/** Enforces the 44pt minimum target on any pressable. */
export function touchTargetStyle(minSize?: number): RnViewStyle {
  const requested = minSize !== undefined && Number.isFinite(minSize) ? minSize : MIN_TOUCH_TARGET;
  const size = Math.max(MIN_TOUCH_TARGET, requested);
  return { minHeight: size, minWidth: size };
}
