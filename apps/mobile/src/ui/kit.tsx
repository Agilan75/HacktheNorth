/**
 * The Retrofit phone UI kit — unit M3. PRD §11 (inclusivity) and §13 (design).
 *
 * Every component here is built from `@retrofit/design` tokens and follows the
 * same four rules, so a screen that uses the kit cannot forget them:
 *
 * 1. Every interactive element has an accessibilityRole and an
 *    accessibilityLabel (defaulting to its visible words, overridable).
 * 2. Every pressable is at least 44 x 44 pt and grows with its text.
 * 3. Text honours the OS text-size setting. React Native already multiplies
 *    `fontSize` and `lineHeight` by the user's font scale, so the kit passes the
 *    unscaled §13 steps and never sets a fixed height on anything holding text.
 *    Only display and title steps are capped (at 2x) so a heading cannot push
 *    the whole screen off at AX5; body text is never capped.
 * 4. Colour never carries meaning alone: verdicts carry their words and a
 *    glyph, selected choices carry a check mark, notices carry a word prefix.
 */
import { useEffect, useRef, useState } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  Text as RNText,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import type {
  AccessibilityRole,
  PressableProps,
  StyleProp,
  TextInputProps,
  TextProps as RNTextProps,
  TextStyle,
  ViewProps,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Edge } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  BORDER,
  COLORS,
  FONT_FAMILIES,
  FONT_WEIGHTS,
  LINE_HEIGHTS,
  MIN_TOUCH_TARGET,
  RADIUS,
  SPACE,
  VERDICT_STYLES,
  cardStyle,
  textStyle,
  touchTargetStyle,
  verdictPillStyle,
} from '@retrofit/design';
import type { FontSizeToken, SpaceToken, VerdictToken } from '@retrofit/design';

/* -------------------------------------------------------------------------- */
/* Type                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Fraunces and Inter are registered in `app/_layout.tsx`, one name per face,
 * and every family below comes from the tokens. There is no platform fallback
 * and no platform branch: both phones get the same two typefaces.
 */
const DISPLAY_STEPS: ReadonlySet<FontSizeToken> = new Set(['display', 'title', 'heading']);
const CAPPED_STEPS: ReadonlySet<FontSizeToken> = new Set(['display', 'title']);

export type TextTone = 'ink' | 'muted' | 'accent' | 'inverse';

/**
 * `accent` is the one tone that does not read at body size: 2.73:1 on bone. It
 * is for the price on the verdict screen, at the display step, and nothing
 * else. `muted` is 3.24:1, AA-large, so it is for secondary lines beside
 * something ink already says. Body text is always ink.
 */
const TONE_COLOR: Readonly<Record<TextTone, string>> = {
  ink: COLORS.ink,
  muted: COLORS.mute,
  accent: COLORS.accent,
  inverse: COLORS.bone,
};

/**
 * One step of the type scale as an RN style, unscaled — RN applies the user's
 * font scale itself. Size and leading come from the tokens; the family is the
 * face that carries that step's weight, because a phone cannot make a semibold
 * out of a regular.
 */
export function typeStyle(variant: FontSizeToken, tone: TextTone = 'ink', strong = false): TextStyle {
  const base = textStyle(variant);
  const display = DISPLAY_STEPS.has(variant);
  return {
    fontFamily: display ? FONT_FAMILIES.display : strong ? FONT_FAMILIES.bodyStrong : FONT_FAMILIES.body,
    fontSize: base.fontSize,
    lineHeight: base.lineHeight,
    fontWeight: display || strong ? FONT_WEIGHTS.semibold : base.fontWeight,
    color: TONE_COLOR[tone],
  };
}

/** The OS font scale (1 = default). For sizing non-text things beside text. */
export function useFontScale(): number {
  const { fontScale } = useWindowDimensions();
  return Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
}

export interface TextProps extends RNTextProps {
  /** One of the six §13 steps. Default `body`. */
  readonly variant?: FontSizeToken;
  readonly tone?: TextTone;
  readonly align?: 'left' | 'center' | 'right';
  readonly weight?: 'regular' | 'semibold';
  readonly children?: ReactNode;
}

/** Body copy and labels. Scales with the user's text size. */
export function Text({
  variant = 'body',
  tone = 'ink',
  align,
  weight,
  style,
  maxFontSizeMultiplier,
  ...rest
}: TextProps) {
  return (
    <RNText
      allowFontScaling
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? (CAPPED_STEPS.has(variant) ? 2 : 0)}
      // `weight` picks the face, not just the numeric weight: asking for a
      // heavier number on a regular face gets a fake bold, or nothing at all.
      style={[typeStyle(variant, tone, weight === 'semibold'), align ? { textAlign: align } : null, style]}
      {...rest}
    />
  );
}

/** A screen or section heading, announced as a heading by VoiceOver. */
export function Heading({ variant = 'title', ...rest }: TextProps) {
  return <Text accessibilityRole="header" variant={variant} {...rest} />;
}

/* -------------------------------------------------------------------------- */
/* Icon                                                                       */
/* -------------------------------------------------------------------------- */

export type IconName = ComponentProps<typeof Ionicons>['name'];

export interface IconProps {
  readonly name: IconName;
  /** Points. Default 20, matching the `body` line height. */
  readonly size?: number;
  readonly color?: string;
  /**
   * Icons here are always decoration next to real text (PRD §13: colour, and
   * by extension a glyph, never carries meaning alone) — hidden from screen
   * readers by default. Set true only for the rare icon-only control that
   * supplies its own accessibilityLabel on the wrapping Pressable.
   */
  readonly accessible?: boolean;
  readonly style?: StyleProp<TextStyle>;
}

/** A Ionicons glyph, sized off the type scale so call sites never guess a number. */
export function Icon({ name, size = 20, color = COLORS.ink, accessible = false, style }: IconProps) {
  return (
    <Ionicons
      name={name}
      size={size}
      color={color}
      style={style}
      accessibilityElementsHidden={!accessible}
      importantForAccessibility={accessible ? 'yes' : 'no-hide-descendants'}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Button                                                                     */
/* -------------------------------------------------------------------------- */

export type ButtonVariant = 'primary' | 'secondary' | 'quiet';

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  /** The visible words. Also the default accessibilityLabel. */
  readonly label: string;
  readonly variant?: ButtonVariant;
  /** Shows a spinner, announces busy, and blocks presses. */
  readonly loading?: boolean;
  /** Stretch to the container width (the default for primary actions). */
  readonly fullWidth?: boolean;
  /** Decorative leading glyph — the label always carries the meaning on its own. */
  readonly icon?: IconName;
  readonly accessibilityLabel?: string;
  readonly accessibilityHint?: string;
  readonly style?: StyleProp<ViewStyle>;
}

/**
 * Accent fills the primary button and ink sits on it, which is 5.63:1. A press
 * keeps the fill and takes an ink border rather than darkening: with seven
 * colours there is no darker accent, and a border is a shape, not a shade.
 */
const BUTTON_COLORS: Readonly<
  Record<ButtonVariant, { bg: string; bgPressed: string; border: string; borderPressed: string; text: string }>
> = {
  primary: {
    bg: COLORS.accent,
    bgPressed: COLORS.accent,
    border: COLORS.accent,
    borderPressed: COLORS.ink,
    text: COLORS.ink,
  },
  secondary: {
    bg: COLORS.bone,
    bgPressed: COLORS.muteTint,
    border: COLORS.ink,
    borderPressed: COLORS.ink,
    text: COLORS.ink,
  },
  quiet: {
    bg: 'transparent',
    bgPressed: COLORS.muteTint,
    border: 'transparent',
    borderPressed: 'transparent',
    text: COLORS.ink,
  },
};

/** A 44pt-minimum button whose height grows with the user's text size. */
export function Button({
  label,
  variant = 'primary',
  loading = false,
  fullWidth,
  icon,
  disabled,
  accessibilityLabel,
  accessibilityHint,
  accessibilityState,
  style,
  hitSlop,
  ...rest
}: ButtonProps) {
  const inactive = disabled === true || loading;
  const c = BUTTON_COLORS[variant];
  const stretch = fullWidth ?? variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ ...accessibilityState, disabled: inactive, busy: loading }}
      disabled={inactive}
      hitSlop={hitSlop ?? 4}
      style={({ pressed }) => [
        touchTargetStyle(),
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: SPACE.sm,
          paddingHorizontal: SPACE.xl,
          paddingVertical: SPACE.md,
          borderRadius: RADIUS.pill,
          borderWidth: 2,
          borderColor: inactive ? COLORS.muteTint : pressed ? c.borderPressed : c.border,
          backgroundColor: inactive
            ? variant === 'quiet'
              ? 'transparent'
              : COLORS.muteTint
            : pressed
              ? c.bgPressed
              : c.bg,
          alignSelf: stretch ? 'stretch' : 'flex-start',
        },
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator
          color={COLORS.ink}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      ) : icon ? (
        <Icon name={icon} size={18} color={inactive ? COLORS.mute : c.text} />
      ) : null}
      <Text
        variant="body"
        weight="semibold"
        align="center"
        style={{
          color: inactive ? COLORS.mute : c.text,
          textDecorationLine: variant === 'quiet' ? 'underline' : 'none',
          flexShrink: 1,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/* -------------------------------------------------------------------------- */
/* Card                                                                       */
/* -------------------------------------------------------------------------- */

export type CardTone = 'plain' | 'muted' | 'accent';

/**
 * Three surfaces, two fills. `accent` keeps the bone fill and takes an accent
 * border instead: with one accent there is no accent tint to fill with, and a
 * border separates the card without putting body text on a low-contrast ground.
 */
const CARD_BG: Readonly<Record<CardTone, string>> = {
  plain: COLORS.bone,
  muted: COLORS.muteTint,
  accent: COLORS.bone,
};

const CARD_BORDER: Readonly<Record<CardTone, { color: string; width: number }>> = {
  plain: { color: COLORS.muteTint, width: BORDER.width },
  muted: { color: COLORS.muteTint, width: BORDER.width },
  accent: { color: COLORS.accent, width: 2 },
};

export interface CardProps extends ViewProps {
  readonly children?: ReactNode;
  readonly padding?: SpaceToken;
  readonly tone?: CardTone;
  /** Makes the whole card one button. Requires `accessibilityLabel`. */
  readonly onPress?: () => void;
  readonly accessibilityLabel?: string;
  readonly accessibilityHint?: string;
  readonly style?: StyleProp<ViewStyle>;
}

/** Radius 16, 1px Muted-tint border, no shadow. Pressable when given onPress. */
export function Card({
  children,
  padding = 'lg',
  tone = 'plain',
  onPress,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole,
  style,
  ...rest
}: CardProps) {
  const edge = CARD_BORDER[tone];
  const base: ViewStyle = {
    ...cardStyle(padding),
    backgroundColor: CARD_BG[tone],
    borderColor: edge.color,
    borderWidth: edge.width,
    gap: SPACE.sm,
  };
  if (onPress) {
    return (
      <Pressable
        accessibilityRole={accessibilityRole ?? 'button'}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        onPress={onPress}
        style={({ pressed }) => [
          base,
          touchTargetStyle(),
          pressed ? { borderColor: COLORS.ink } : null,
          style,
        ]}
        {...rest}
      >
        {children}
      </Pressable>
    );
  }
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityRole={accessibilityRole}
      accessible={accessibilityLabel !== undefined ? true : rest.accessible}
      style={[base, style]}
      {...rest}
    >
      {children}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Brand                                                                      */
/* -------------------------------------------------------------------------- */

export interface BrandProps {
  /** Mark diameter in points. Default 40. */
  readonly size?: number;
  readonly showWordmark?: boolean;
  readonly style?: StyleProp<ViewStyle>;
}

/**
 * The Retrofit lockup: a flat accent mark and, optionally, the wordmark. One
 * colour, no gradient. Always decorative — every screen that shows it has its
 * own real Heading, so this never carries the app's name on its own.
 */
export function Brand({ size = 40, showWordmark = true, style }: BrandProps) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }, style]}
    >
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: COLORS.accent,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name="home" size={Math.round(size * 0.5)} color={COLORS.ink} />
      </View>
      {showWordmark ? (
        <Text variant="heading" weight="semibold">
          Retrofit
        </Text>
      ) : null}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* VerdictPill                                                                */
/* -------------------------------------------------------------------------- */

export interface VerdictPillProps {
  readonly verdict: VerdictToken;
  /** `label` = "Fits appetite" (default), `short` = "FIT". */
  readonly wording?: 'label' | 'short';
  /** Replace the words entirely (plain-language copy for tenants). */
  readonly text?: string;
  readonly size?: 'regular' | 'large';
  readonly accessibilityLabel?: string;
  readonly style?: StyleProp<ViewStyle>;
}

/**
 * FIT = red filled, REFER = red outlined, DOES_NOT_FIT = ink filled (PRD §13).
 * Always shows its words and a shape glyph; colour is never the only signal.
 */
export function VerdictPill({
  verdict,
  wording = 'label',
  text,
  size = 'regular',
  accessibilityLabel,
  style,
}: VerdictPillProps) {
  const pill = verdictPillStyle(verdict);
  const words =
    text !== undefined && text.trim().length > 0
      ? text
      : wording === 'short'
        ? VERDICT_STYLES[verdict].short
        : pill.label;
  const large = size === 'large';
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel ?? `Result: ${words}`}
      style={[
        {
          ...pill.container,
          borderWidth: 2,
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'flex-start',
          gap: SPACE.sm,
          paddingHorizontal: large ? SPACE.lg : SPACE.md,
          paddingVertical: large ? SPACE.sm : SPACE.xs,
        },
        style,
      ]}
    >
      {/* The shape that carries the verdict when colour cannot: a type step,
          on the scale, so it grows with the words beside it. */}
      <Text
        variant={large ? 'body' : 'small'}
        importantForAccessibility="no"
        accessibilityElementsHidden
        style={{ color: pill.text.color }}
      >
        {pill.mark}
      </Text>
      <Text
        variant={large ? 'heading' : 'small'}
        weight="semibold"
        style={{ color: pill.text.color, flexShrink: 1 }}
      >
        {words}
      </Text>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Skeleton                                                                   */
/* -------------------------------------------------------------------------- */

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (alive) setReduce(v);
      })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

export interface SkeletonProps {
  /** Number of text-line placeholders. Default 3. */
  readonly lines?: number;
  /** The text step the lines stand in for, so they grow with text size. */
  readonly variant?: FontSizeToken;
  /** Announced to screen readers. Default "Loading". */
  readonly accessibilityLabel?: string;
  readonly style?: StyleProp<ViewStyle>;
}

/** Pulsing placeholder lines. Still (no pulse) when Reduce Motion is on. */
export function Skeleton({ lines = 3, variant = 'body', accessibilityLabel = 'Loading', style }: SkeletonProps) {
  const reduce = useReduceMotion();
  const fontScale = useFontScale();
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reduce) {
      pulse.setValue(1);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.45, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduce]);

  const lineHeight = textStyle(variant, fontScale).lineHeight ?? LINE_HEIGHTS[variant];
  const count = Math.max(1, Math.floor(lines));
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy: true }}
      style={[{ gap: SPACE.sm }, style]}
    >
      {Array.from({ length: count }, (_, i) => (
        <Animated.View
          key={i}
          style={{
            height: Math.round(lineHeight * 0.75),
            width: i === count - 1 && count > 1 ? '60%' : '100%',
            borderRadius: SPACE.xs,
            backgroundColor: COLORS.muteTint,
            opacity: pulse,
          }}
        />
      ))}
    </View>
  );
}

/** A card-shaped skeleton for lists (PRD §13: skeletons for every list and card). */
export function SkeletonCard({ accessibilityLabel = 'Loading', lines = 2 }: Pick<SkeletonProps, 'accessibilityLabel' | 'lines'>) {
  return (
    <Card>
      <Skeleton variant="heading" lines={1} accessibilityLabel={accessibilityLabel} />
      <Skeleton variant="body" lines={lines} accessibilityLabel={accessibilityLabel} />
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Notice                                                                     */
/* -------------------------------------------------------------------------- */

export type NoticeTone = 'info' | 'error' | 'success';

/**
 * The word is the signal; the border is the emphasis. Red appears on one of
 * the three, because a problem is the only thing here that warrants it, and
 * even then the text says "Problem" before any colour is read.
 */
const NOTICE: Readonly<Record<NoticeTone, { word: string; bg: string; border: string; width: number }>> = {
  info: { word: 'Note', bg: COLORS.muteTint, border: COLORS.muteTint, width: BORDER.width },
  error: { word: 'Problem', bg: COLORS.bone, border: COLORS.red, width: 2 },
  success: { word: 'Done', bg: COLORS.bone, border: COLORS.ink, width: 2 },
};

export interface NoticeProps {
  readonly tone?: NoticeTone;
  readonly children: string;
  /** Optional action (e.g. "Try again"). */
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  readonly style?: StyleProp<ViewStyle>;
}

/** An inline message with a word prefix ("Problem:"), announced when it appears. */
export function Notice({ tone = 'info', children, actionLabel, onAction, style }: NoticeProps) {
  const n = NOTICE[tone];
  const sentence = `${n.word}: ${children}`;
  useEffect(() => {
    if (tone === 'error') AccessibilityInfo.announceForAccessibility(sentence);
  }, [tone, sentence]);
  return (
    <View
      style={[
        {
          backgroundColor: n.bg,
          borderColor: n.border,
          borderWidth: n.width,
          borderRadius: RADIUS.card,
          padding: SPACE.lg,
          gap: SPACE.sm,
        },
        style,
      ]}
    >
      <View
        accessible
        accessibilityRole={tone === 'error' ? 'alert' : 'text'}
        accessibilityLabel={sentence}
        accessibilityLiveRegion={tone === 'error' ? 'assertive' : 'polite'}
      >
        <Text variant="body">
          <Text variant="body" weight="semibold">{`${n.word}: `}</Text>
          {children}
        </Text>
      </View>
      {actionLabel && onAction ? (
        <Button label={actionLabel} variant="secondary" fullWidth={false} onPress={onAction} />
      ) : null}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* TextField                                                                  */
/* -------------------------------------------------------------------------- */

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  /** Visible label above the field; also its accessibilityLabel. */
  readonly label: string;
  /** Plain-language help under the label. */
  readonly help?: string;
  readonly error?: string | null;
  readonly style?: StyleProp<ViewStyle>;
}

/** A labelled text input, 44pt minimum, with help and error text in words. */
export function TextField({ label, help, error, style, accessibilityLabel, accessibilityHint, ...rest }: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[{ gap: SPACE.xs }, style]}>
      <Text variant="small" weight="semibold" importantForAccessibility="no" accessibilityElementsHidden>
        {label}
      </Text>
      {help ? (
        <Text variant="small" tone="muted" importantForAccessibility="no" accessibilityElementsHidden>
          {help}
        </Text>
      ) : null}
      <TextInput
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={[help, error ? `Problem: ${error}` : null, accessibilityHint].filter(Boolean).join('. ') || undefined}
        allowFontScaling
        placeholderTextColor={COLORS.mute}
        {...rest}
        onFocus={(e) => {
          setFocused(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          rest.onBlur?.(e);
        }}
        style={[
          typeStyle('body'),
          {
            minHeight: MIN_TOUCH_TARGET,
            paddingHorizontal: SPACE.md,
            paddingVertical: SPACE.sm,
            borderRadius: RADIUS.card,
            borderWidth: focused || error ? 2 : BORDER.width,
            borderColor: error ? COLORS.red : focused ? COLORS.ink : COLORS.mute,
            backgroundColor: COLORS.bone,
          },
        ]}
      />
      {error ? (
        <Text variant="small" tone="accent" accessibilityRole="alert">{`Problem: ${error}`}</Text>
      ) : null}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* ChoiceGroup                                                                */
/* -------------------------------------------------------------------------- */

export interface Choice<V extends string | number | boolean> {
  readonly value: V;
  readonly label: string;
  /** Extra words for the screen reader, e.g. "4 months". */
  readonly accessibilityLabel?: string;
}

export interface ChoiceGroupProps<V extends string | number | boolean> {
  /** Read aloud before the options, and shown above them. */
  readonly label: string;
  readonly choices: readonly Choice<V>[];
  readonly value: V | null;
  readonly onChange: (value: V) => void;
  /** Lay options side by side (short labels) or stacked (default). */
  readonly direction?: 'row' | 'column';
  readonly style?: StyleProp<ViewStyle>;
}

/**
 * Single-choice options as radio buttons. The selected one gets a check mark
 * and a thicker border as well as the ink fill, so it never relies on colour.
 */
export function ChoiceGroup<V extends string | number | boolean>({
  label,
  choices,
  value,
  onChange,
  direction = 'column',
  style,
}: ChoiceGroupProps<V>) {
  return (
    <View style={[{ gap: SPACE.sm }, style]} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text variant="small" weight="semibold">
        {label}
      </Text>
      <View style={{ flexDirection: direction, flexWrap: 'wrap', gap: SPACE.sm }}>
        {choices.map((choice, i) => {
          const selected = value === choice.value;
          const role: AccessibilityRole = 'radio';
          return (
            <Pressable
              key={String(choice.value)}
              accessibilityRole={role}
              accessibilityLabel={choice.accessibilityLabel ?? choice.label}
              accessibilityHint={`Option ${i + 1} of ${choices.length}`}
              accessibilityState={{ selected, checked: selected }}
              onPress={() => onChange(choice.value)}
              style={({ pressed }) => [
                touchTargetStyle(),
                {
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: SPACE.sm,
                  paddingHorizontal: SPACE.lg,
                  paddingVertical: SPACE.md,
                  borderRadius: RADIUS.card,
                  borderWidth: selected ? 2 : BORDER.width,
                  borderColor: selected ? COLORS.ink : COLORS.mute,
                  backgroundColor: selected ? COLORS.ink : pressed ? COLORS.muteTint : COLORS.bone,
                  flexGrow: direction === 'row' ? 1 : 0,
                },
              ]}
            >
              <Text
                variant="body"
                weight="semibold"
                importantForAccessibility="no"
                accessibilityElementsHidden
                style={{ color: selected ? COLORS.bone : COLORS.mute, minWidth: 16 }}
              >
                {selected ? '✓' : '○'}
              </Text>
              <Text variant="body" style={{ color: selected ? COLORS.bone : COLORS.ink, flexShrink: 1 }}>
                {choice.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

export interface ScreenProps {
  readonly children?: ReactNode;
  /** Optional on-screen heading (the stack header already names the route). */
  readonly title?: string;
  /** Plain-language line under the title. */
  readonly subtitle?: string;
  /** Scroll the body (default). Set false for the camera or fixed layouts. */
  readonly scroll?: boolean;
  /** Pinned actions at the bottom, above the home indicator. */
  readonly footer?: ReactNode;
  /** Safe-area edges to pad. The stack header already covers the top. */
  readonly edges?: readonly Edge[];
  readonly accessibilityLabel?: string;
  readonly contentStyle?: StyleProp<ViewStyle>;
}

/** Paper background, safe-area padding, 4pt-grid gutters, optional pinned footer. */
export function Screen({
  children,
  title,
  subtitle,
  scroll = true,
  footer,
  edges = ['bottom', 'left', 'right'],
  accessibilityLabel,
  contentStyle,
}: ScreenProps) {
  const body: ViewStyle = { padding: SPACE.lg, gap: SPACE.lg };
  const head =
    title || subtitle ? (
      <View style={{ gap: SPACE.xs }}>
        {title ? <Heading>{title}</Heading> : null}
        {subtitle ? <Text tone="muted">{subtitle}</Text> : null}
      </View>
    ) : null;
  return (
    <SafeAreaView
      edges={edges}
      accessibilityLabel={accessibilityLabel}
      style={{ flex: 1, backgroundColor: COLORS.bone }}
    >
      {scroll ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[body, { flexGrow: 1 }, contentStyle]}
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="automatic"
        >
          {head}
          {children}
        </ScrollView>
      ) : (
        <View style={[body, { flex: 1 }, contentStyle]}>
          {head}
          {children}
        </View>
      )}
      {footer ? (
        <View
          style={{
            paddingHorizontal: SPACE.lg,
            paddingTop: SPACE.md,
            paddingBottom: SPACE.md,
            gap: SPACE.sm,
            borderTopWidth: BORDER.width,
            borderTopColor: BORDER.color,
            backgroundColor: COLORS.bone,
          }}
        >
          {footer}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

/** Re-exported so screens can size things on the same grid without a second import. */
export { COLORS, SPACE, RADIUS, MIN_TOUCH_TARGET } from '@retrofit/design';
