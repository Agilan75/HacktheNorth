/**
 * React Native helpers. Stub frozen by W0-4; unit D01 replaces these bodies
 * only.
 *
 * This file must stay free of `react-native` imports: `@retrofit/design` is
 * consumed by the console too and has no RN dependency. The style objects
 * below are structurally compatible with RN's TextStyle and ViewStyle.
 */
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

/** One of the six PRD §13 type steps, with dynamic-type scaling applied. */
export function textStyle(_token: FontSizeToken, _fontScale?: number): RnTextStyle {
  throw new Error('NOT_IMPLEMENTED:D01');
}

/** A card surface: radius 16, 1px Muted-tint border, no shadow. */
export function cardStyle(_padding?: SpaceToken): RnViewStyle {
  throw new Error('NOT_IMPLEMENTED:D01');
}

/** A pill surface for a verdict, never used without its label text. */
export function verdictPillStyle(_verdict: VerdictToken): {
  readonly container: RnViewStyle;
  readonly text: RnTextStyle;
  readonly label: string;
  readonly mark: string;
} {
  throw new Error('NOT_IMPLEMENTED:D01');
}

/** Enforces the 44pt minimum target on any pressable. */
export function touchTargetStyle(_minSize?: number): RnViewStyle {
  throw new Error('NOT_IMPLEMENTED:D01');
}
