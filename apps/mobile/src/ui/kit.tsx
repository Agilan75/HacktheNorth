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
import type { ReactNode } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Platform,
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
import {
  BORDER,
  COLORS,
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
 * Fraunces and Inter are not bundled (no font assets, no custom native code in
 * Expo Go), and an unregistered family logs an error on iOS. So the display
 * steps use the platform serif and body steps the system font. Decision M3-2.
 */
const DISPLAY_FAMILY = Platform.select({ ios: 'Georgia', android: 'serif', default: undefined });
const DISPLAY_STEPS: ReadonlySet<FontSizeToken> = new Set(['display', 'title', 'heading']);
const CAPPED_STEPS: ReadonlySet<FontSizeToken> = new Set(['display', 'title']);

export type TextTone = 'ink' | 'muted' | 'accent' | 'inverse';

/** `muted` text uses Muted deep: plain Muted fails AA at body sizes (D01-1). */
const TONE_COLOR: Readonly<Record<TextTone, string>> = {
  ink: COLORS.ink,
  muted: COLORS.mutedDeep,
  accent: COLORS.redDeep,
  inverse: COLORS.paper,
};

/** The §13 step as an RN style, unscaled — RN applies the user's font scale. */
export function typeStyle(variant: FontSizeToken, tone: TextTone = 'ink'): TextStyle {
  const base = textStyle(variant);
  return {
    fontSize: base.fontSize,
    lineHeight: base.lineHeight,
    fontWeight: base.fontWeight,
    color: TONE_COLOR[tone],
    ...(DISPLAY_STEPS.has(variant) && DISPLAY_FAMILY ? { fontFamily: DISPLAY_FAMILY } : {}),
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
      style={[
        typeStyle(variant, tone),
        align ? { textAlign: align } : null,
        weight === 'semibold' ? { fontWeight: '600' } : weight === 'regular' ? { fontWeight: '400' } : null,
        style,
      ]}
      {...rest}
    />
  );
}

/** A screen or section heading, announced as a heading by VoiceOver. */
export function Heading({ variant = 'title', ...rest }: TextProps) {
  return <Text accessibilityRole="header" variant={variant} {...rest} />;
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
  readonly accessibilityLabel?: string;
  readonly accessibilityHint?: string;
  readonly style?: StyleProp<ViewStyle>;
}

const BUTTON_COLORS: Readonly<
  Record<ButtonVariant, { bg: string; bgPressed: string; border: string; text: string }>
> = {
  primary: { bg: COLORS.red, bgPressed: COLORS.redDeep, border: COLORS.red, text: COLORS.paper },
  secondary: { bg: COLORS.paper, bgPressed: COLORS.mutedTint, border: COLORS.ink, text: COLORS.ink },
  quiet: { bg: 'transparent', bgPressed: COLORS.mutedTint, border: 'transparent', text: COLORS.ink },
};

/** A 44pt-minimum button whose height grows with the user's text size. */
export function Button({
  label,
  variant = 'primary',
  loading = false,
  fullWidth,
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
          borderColor: inactive ? COLORS.mutedTint : c.border,
          backgroundColor: inactive
            ? variant === 'quiet'
              ? 'transparent'
              : COLORS.mutedTint
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
          color={variant === 'primary' ? COLORS.mutedDeep : COLORS.ink}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      ) : null}
      <Text
        variant="body"
        weight="semibold"
        align="center"
        style={{
          color: inactive ? COLORS.mutedDeep : c.text,
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

const CARD_BG: Readonly<Record<CardTone, string>> = {
  plain: COLORS.paper,
  muted: COLORS.mutedTint,
  accent: COLORS.redTint,
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
  const base: ViewStyle = { ...cardStyle(padding), backgroundColor: CARD_BG[tone], gap: SPACE.sm };
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
      <RNText
        allowFontScaling
        importantForAccessibility="no"
        accessibilityElementsHidden
        style={{ color: pill.text.color, fontSize: large ? 17 : 15, lineHeight: large ? 24 : 20 }}
      >
        {pill.mark}
      </RNText>
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

  const lineHeight = textStyle(variant, fontScale).lineHeight ?? 24;
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
            backgroundColor: COLORS.mutedTint,
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

const NOTICE: Readonly<Record<NoticeTone, { word: string; bg: string; border: string }>> = {
  info: { word: 'Note', bg: COLORS.mutedTint, border: COLORS.mutedTint },
  error: { word: 'Problem', bg: COLORS.redTint, border: COLORS.redDeep },
  success: { word: 'Done', bg: COLORS.paper, border: COLORS.ink },
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
          borderWidth: BORDER.width,
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
        placeholderTextColor={COLORS.mutedDeep}
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
            borderColor: error ? COLORS.redDeep : focused ? COLORS.ink : COLORS.muted,
            backgroundColor: COLORS.paper,
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
                  borderColor: selected ? COLORS.ink : COLORS.muted,
                  backgroundColor: selected ? COLORS.ink : pressed ? COLORS.mutedTint : COLORS.paper,
                  flexGrow: direction === 'row' ? 1 : 0,
                },
              ]}
            >
              <Text
                variant="body"
                weight="semibold"
                importantForAccessibility="no"
                accessibilityElementsHidden
                style={{ color: selected ? COLORS.paper : COLORS.mutedDeep, minWidth: 16 }}
              >
                {selected ? '✓' : '○'}
              </Text>
              <Text variant="body" style={{ color: selected ? COLORS.paper : COLORS.ink, flexShrink: 1 }}>
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
      style={{ flex: 1, backgroundColor: COLORS.paper }}
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
            backgroundColor: COLORS.paper,
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
