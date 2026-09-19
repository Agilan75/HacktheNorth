/**
 * ScanOverlay — the overlay drawn over the camera on /sweep (unit M4; PRD §11).
 *
 * The 3D coverage dome was cut (DECISIONS R3-2, cut ladder rung (c)); this is
 * what the sweep screen uses instead. It wraps M3's 2D Skia `ScanRing` and adds:
 *
 *   - the coverage percentage, in the middle of the ring;
 *   - a "Turn left / Turn right" hint that points at the LARGEST uncovered arc,
 *     taken from M2's capture machine (`summarize(state).turn`), shown as an
 *     arrow shape plus words;
 *   - a photo counter ("Photos: 7 of 15");
 *   - a Finish control that stays locked below 75% (and with no photo yet),
 *     with the reason printed under it and spoken by VoiceOver;
 *   - optionally, "Use photos instead" — the upload path as an equal choice.
 *
 * Nothing here decides a number that counts. The percentage is M2's progress
 * readout for the person holding the phone; the API computes the coverage
 * that matters from the frames it receives.
 *
 * Accessibility:
 *   - The ring itself is hidden from the screen reader (its own sentence uses
 *     the nearest-gap rule, which would contradict this hint). One progressbar
 *     element carries the percentage, the hint and the photo count instead.
 *   - VoiceOver hears a short update at each 25% step, when Finish unlocks,
 *     when the photo cap is reached, and when the turn direction flips (at
 *     most once every 4 s) — never on every compass tick.
 *   - Direction is an arrow shape and the word "left"/"right"; locked Finish
 *     says "locked" in its words and hint, not only through a grey colour.
 *   - All text scales with the user's text size; every pressable is >= 44 pt.
 *   - Tapping the locked Finish button explains why instead of doing nothing.
 */
import { useEffect, useMemo, useRef } from 'react';
import { AccessibilityInfo, Pressable, View, useWindowDimensions } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { COLORS, MIN_TOUCH_TARGET, RADIUS, SPACE } from '@retrofit/design';
import { FINISH_COVERAGE_PCT, MAX_FRAMES, PANEL_COUNT, summarize } from '@/lib/capture';
import type { CaptureState, CaptureSummary } from '@/lib/capture';
import { Button, Text, useFontScale } from './kit';
import { ScanRing } from './ScanRing';

/** Dark translucent panel so paper-coloured text reads over any camera image. */
const SCRIM = 'rgba(31,30,27,0.78)';
const DIRECTION_ANNOUNCE_GAP_MS = 4000;

export interface ScanOverlayProps {
  /** M2's capture machine state (`useReducer(captureReducer, initialCaptureState)`). */
  readonly state: CaptureState;
  /** Called when the person taps Finish and Finish is allowed. */
  readonly onFinish: () => void;
  /** When given, shows "Use photos instead" (the upload path) as an equal choice. */
  readonly onUsePhotos?: () => void;
  /** Shows a spinner on Finish while the screen submits the sweep. */
  readonly finishing?: boolean;
  /** Speak milestone updates through VoiceOver/TalkBack. Default true. */
  readonly announce?: boolean;
  /** Ring diameter in points. Default: fits the screen, smaller at large text sizes. */
  readonly ringSize?: number;
  readonly style?: StyleProp<ViewStyle>;
}

export function ScanOverlay({
  state,
  onFinish,
  onUsePhotos,
  finishing = false,
  announce = true,
  ringSize,
  style,
}: ScanOverlayProps) {
  const { width } = useWindowDimensions();
  const fontScale = useFontScale();
  const s = useMemo(() => summarize(state), [state]);
  const words = overlayWords(s, state);

  // At very large text sizes give the words room: shrink the ring, not the text.
  const fit = Math.min(260, width - SPACE.lg * 2);
  const diameter = Math.max(140, Math.round(ringSize ?? (fontScale >= 1.6 ? fit * 0.7 : fit)));

  useOverlayAnnouncements(announce, s, words);

  const locked = !s.canFinish;
  const finishPress = () => {
    if (finishing) return;
    if (locked) {
      // A locked control still explains itself: spoken, and a warning buzz.
      AccessibilityInfo.announceForAccessibility(words.finishReason);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
      return;
    }
    onFinish();
  };

  return (
    <View pointerEvents="box-none" style={[{ flex: 1, justifyContent: 'space-between', padding: SPACE.lg }, style]}>
      {/* Top: the ring, the percentage and the photo count, as one accessible element. */}
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Room scan coverage"
        accessibilityValue={{ min: 0, max: 100, now: s.coveragePctDisplay, text: words.spoken }}
        style={{ alignItems: 'center', gap: SPACE.sm }}
      >
        <View
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          style={{ width: diameter, height: diameter }}
        >
          <ScanRing
            panels={state.panels}
            headingDeg={state.bearingDeg}
            showText={false}
            onCamera
            size={diameter}
          />
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: diameter * 0.25,
              right: diameter * 0.25,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View style={{ backgroundColor: SCRIM, borderRadius: RADIUS.card, paddingHorizontal: SPACE.sm, alignItems: 'center' }}>
              <Text
                variant="title"
                tone="inverse"
                align="center"
                numberOfLines={1}
                adjustsFontSizeToFit
                maxFontSizeMultiplier={1.5}
              >
                {`${s.coveragePctDisplay}%`}
              </Text>
              <Text variant="micro" tone="inverse" align="center" maxFontSizeMultiplier={1.5}>
                scanned
              </Text>
            </View>
          </View>
        </View>
        <View
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          style={{ backgroundColor: SCRIM, borderRadius: RADIUS.pill, paddingHorizontal: SPACE.md, paddingVertical: SPACE.xs }}
        >
          <Text variant="small" tone="inverse" align="center">
            {words.photos}
          </Text>
        </View>
      </View>

      {/* Bottom: the turn hint, then Finish and the photo alternative. */}
      <View pointerEvents="box-none" style={{ gap: SPACE.md }}>
        <View
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: SPACE.md,
            backgroundColor: SCRIM,
            borderRadius: RADIUS.card,
            padding: SPACE.lg,
          }}
        >
          {words.arrow ? (
            <Text variant="display" tone="inverse" maxFontSizeMultiplier={1.5}>
              {words.arrow}
            </Text>
          ) : null}
          <Text variant="body" tone="inverse" weight="semibold" style={{ flexShrink: 1 }}>
            {words.hint}
          </Text>
        </View>

        <FinishControl
          locked={locked}
          finishing={finishing}
          reason={words.finishReason}
          onPress={finishPress}
        />

        {onUsePhotos ? (
          <Button
            label="Use photos instead"
            variant="secondary"
            fullWidth
            accessibilityHint="Pick three or more photos of the room from your library instead of scanning."
            onPress={onUsePhotos}
          />
        ) : null}
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Finish                                                                     */
/* -------------------------------------------------------------------------- */

function FinishControl({
  locked,
  finishing,
  reason,
  onPress,
}: {
  readonly locked: boolean;
  readonly finishing: boolean;
  readonly reason: string;
  readonly onPress: () => void;
}) {
  if (!locked) {
    return (
      <Button
        label="Finish scanning"
        loading={finishing}
        fullWidth
        accessibilityHint="Ends the scan and sends the photos for analysis."
        onPress={onPress}
      />
    );
  }
  // Not the kit Button: a disabled Pressable swallows taps silently, and a
  // locked Finish must say why when someone taps it. It still reports
  // `disabled` so VoiceOver reads it as dimmed.
  return (
    <View style={{ gap: SPACE.xs }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Finish scanning, locked"
        accessibilityHint={reason}
        accessibilityState={{ disabled: true }}
        onPress={onPress}
        hitSlop={4}
        style={{
          minHeight: MIN_TOUCH_TARGET,
          minWidth: MIN_TOUCH_TARGET,
          alignSelf: 'stretch',
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: SPACE.xl,
          paddingVertical: SPACE.md,
          borderRadius: RADIUS.pill,
          borderWidth: 2,
          borderStyle: 'dashed',
          borderColor: COLORS.paper,
          backgroundColor: SCRIM,
        }}
      >
        <Text variant="body" weight="semibold" tone="inverse" align="center">
          {`Finish (locked until ${FINISH_COVERAGE_PCT}%)`}
        </Text>
      </Pressable>
      <View
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={{ backgroundColor: SCRIM, borderRadius: RADIUS.card, paddingHorizontal: SPACE.md, paddingVertical: SPACE.xs }}
      >
        <Text variant="small" tone="inverse" align="center">
          {reason}
        </Text>
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Words                                                                      */
/* -------------------------------------------------------------------------- */

interface OverlayWords {
  /** "→" / "←" / null — a shape, so direction is never colour alone. */
  readonly arrow: string | null;
  /** Short on-screen hint. */
  readonly hint: string;
  readonly photos: string;
  /** Why Finish is locked; empty when it is not. */
  readonly finishReason: string;
  /** The full sentence for the progressbar's accessibility value. */
  readonly spoken: string;
}

/** Degrees rounded to 10, at least 10, so the words do not flicker with compass noise. */
function roughDegrees(deg: number): number {
  return Math.max(10, Math.round(deg / 10) * 10);
}

function overlayWords(s: CaptureSummary, state: CaptureState): OverlayWords {
  let arrow: string | null = null;
  let hint: string;
  if (state.phase === 'idle' || state.bearingDeg === null) {
    hint = 'Hold your phone upright and turn slowly in a circle.';
  } else if (s.coveredPanels === PANEL_COUNT) {
    hint = 'The whole room is scanned.';
  } else if (!s.turn || s.turn.degrees <= 5) {
    hint = 'Keep turning slowly. This part is being scanned now.';
  } else {
    arrow = s.turn.direction === 'right' ? '→' : '←';
    hint = `Turn ${s.turn.direction} about ${roughDegrees(s.turn.degrees)} degrees to the biggest part not scanned yet.`;
  }

  const photos = s.capReached
    ? `Photos: ${s.frameCount} of ${MAX_FRAMES}. That is enough photos; keep turning to fill the ring.`
    : `Photos: ${s.frameCount} of ${MAX_FRAMES}`;

  let finishReason = '';
  if (!s.canFinish) {
    const need = `You can finish at ${FINISH_COVERAGE_PCT} percent. You are at ${s.coveragePctDisplay} percent.`;
    finishReason =
      s.frameCount === 0
        ? `No photo has been taken yet. Turn slowly so the camera can take one. ${need}`
        : `${need} Keep turning to scan more of the room.`;
  }

  const spoken =
    `${s.coveragePctDisplay} percent of the room scanned. ${hint} ${photos}.` +
    (s.canFinish ? ' You can finish now.' : '');
  return { arrow, hint, photos, finishReason, spoken };
}

/* -------------------------------------------------------------------------- */
/* Announcements                                                              */
/* -------------------------------------------------------------------------- */

function useOverlayAnnouncements(enabled: boolean, s: CaptureSummary, words: OverlayWords): void {
  const last = useRef<{ step: number; canFinish: boolean; capReached: boolean; dir: string | null; dirAt: number } | null>(
    null,
  );
  const direction = s.turn && s.turn.degrees > 5 ? s.turn.direction : null;
  const step = Math.floor(s.coveragePctDisplay / 25);

  useEffect(() => {
    const prev = last.current;
    const now = Date.now();
    if (!prev) {
      last.current = { step, canFinish: s.canFinish, capReached: s.capReached, dir: direction, dirAt: now };
      return;
    }
    let say: string | null = null;
    if (s.canFinish && !prev.canFinish) {
      say = `${s.coveragePctDisplay} percent scanned. You can finish now, or keep turning to scan more.`;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } else if (step > prev.step) {
      say = `${s.coveragePctDisplay} percent scanned. ${words.hint}`;
    } else if (s.capReached && !prev.capReached) {
      say = words.photos;
    } else if (direction && direction !== prev.dir && now - prev.dirAt >= DIRECTION_ANNOUNCE_GAP_MS) {
      say = words.hint;
    }
    if (say && enabled) AccessibilityInfo.announceForAccessibility(say);
    last.current = {
      step: Math.max(prev.step, step),
      canFinish: s.canFinish,
      capReached: s.capReached,
      dir: direction ?? prev.dir,
      dirAt: say && direction ? now : prev.dirAt,
    };
  }, [enabled, step, s.canFinish, s.capReached, s.coveragePctDisplay, direction, words.hint, words.photos]);
}
