/**
 * ScanRing — the 2D coverage overlay (unit M3; PRD §11). Skia.
 *
 * 36 ten-degree segments that fill as the heading passes through them, with
 * the current heading marked by a triangle outside the ring. It replaces the
 * 3D dome, which was cut (DECISIONS: cut ladder rung (c)), and doubles as the
 * radar ring on `/confirm` via `markers`.
 *
 * The ring never computes coverage from frames itself: the caller passes the
 * 36-panel mask (from the capture machine during a sweep, or from the API's
 * `CoverageResult.panels` afterwards) and, when it has one, the API's
 * `coveragePct`. All wording and geometry come from `./ringModel`.
 *
 * Inclusivity:
 * - Covered segments are solid; unscanned ones are outlined only — the
 *   difference is fill versus outline, not just red versus grey.
 * - The whole ring is one accessible element (role progressbar) whose label is
 *   the plain sentence from `ringSummary`, e.g. "61 percent of the room
 *   scanned. Turn left about 30 degrees to cover the window side." The same
 *   sentence is shown as text under the ring, so it scales with dynamic type.
 * - With `announce`, VoiceOver hears a short update at each 25% step and when
 *   Finish becomes available, without being flooded on every heading tick.
 */
import { useEffect, useMemo, useRef } from 'react';
import { AccessibilityInfo, View, useWindowDimensions } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { Canvas, Circle, Group, Path } from '@shopify/react-native-skia';
import { COLORS, SPACE } from '@retrofit/design';
import { Text } from './kit';
import {
  DEFAULT_FINISH_PCT,
  SEGMENT_COUNT,
  bearingWords,
  headingMarkerPath,
  markerPoint,
  normalizePanels,
  ringSummary,
  segmentPath,
} from './ringModel';

export interface ScanRingMarker {
  readonly id: string;
  /** Degrees clockwise in the same frame as the panels. */
  readonly bearingDeg: number;
  /** 0..1 of the inner radius (the engine's distance-band radius fits). */
  readonly radius: number;
  /** Plain name, read out, e.g. "space heater". */
  readonly label: string;
  /** Drawn larger with an ink ring, e.g. the item being confirmed. */
  readonly highlighted?: boolean;
}

export interface ScanRingProps {
  /** 36 booleans, true where scanned. Shorter lists are padded with false. */
  readonly panels: readonly boolean[];
  /** Current heading in the panels' frame; null hides the marker. */
  readonly headingDeg: number | null;
  /** The API's coverage percentage, when known; overrides the panel count. */
  readonly coveragePct?: number | null;
  /** Coverage at which Finish is offered. Default 75. */
  readonly finishPct?: number;
  /** Plain name for the unscanned part, e.g. "the window side". */
  readonly gapName?: string | null;
  /** Radar markers for /confirm. */
  readonly markers?: readonly ScanRingMarker[];
  /** Diameter in points. Default: screen width minus gutters, capped at 320. */
  readonly size?: number;
  /** Show the percentage in the middle and the sentence under the ring. */
  readonly showText?: boolean;
  /** Speak milestone updates through VoiceOver/TalkBack. */
  readonly announce?: boolean;
  /** Overrides the default "Room scan coverage" label. */
  readonly accessibilityLabel?: string;
  /** Dark variant for drawing over the camera preview. */
  readonly onCamera?: boolean;
  readonly style?: StyleProp<ViewStyle>;
}

const RING_WIDTH_RATIO = 0.16;
const MARKER_SPACE = 18;

export function ScanRing({
  panels,
  headingDeg,
  coveragePct,
  finishPct = DEFAULT_FINISH_PCT,
  gapName,
  markers,
  size,
  showText = true,
  announce = false,
  accessibilityLabel,
  onCamera = false,
  style,
}: ScanRingProps) {
  const { width } = useWindowDimensions();
  const diameter = Math.max(120, Math.round(size ?? Math.min(320, width - SPACE.lg * 2)));
  const c = diameter / 2;
  const outerR = c - MARKER_SPACE;
  const innerR = outerR * (1 - RING_WIDTH_RATIO * 2);

  const mask = useMemo(() => normalizePanels(panels), [panels]);
  const summary = ringSummary({ panels: mask, headingDeg, coveragePct, finishPct, gapName });

  // Segment outlines only depend on size; the fill state is a prop per path.
  const segments = useMemo(
    () => Array.from({ length: SEGMENT_COUNT }, (_, i) => segmentPath(i, c, c, innerR, outerR)),
    [c, innerR, outerR],
  );

  const ink = onCamera ? COLORS.paper : COLORS.ink;
  const emptyStroke = onCamera ? COLORS.paper : COLORS.muted;
  const hasHeading = headingDeg !== null && Number.isFinite(headingDeg);

  useMilestoneAnnouncements(announce, summary.percent, summary.canFinish, summary.text);

  const markerText =
    markers && markers.length > 0
      ? ` ${markers.length === 1 ? 'One item' : `${markers.length} items`} marked: ${markers
          .map((m) => `${m.label}, ${bearingWords(m.bearingDeg)}`)
          .join('; ')}.`
      : '';

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel ?? 'Room scan coverage'}
      accessibilityValue={{ min: 0, max: 100, now: summary.percent, text: summary.text + markerText }}
      style={[{ alignItems: 'center', gap: SPACE.md }, style]}
    >
      <View style={{ width: diameter, height: diameter }}>
        <Canvas style={{ width: diameter, height: diameter }}>
          <Group>
            {segments.map((d, i) =>
              mask[i] ? (
                <Path key={i} path={d} color={COLORS.red} style="fill" />
              ) : (
                <Group key={i}>
                  <Path path={d} color={onCamera ? 'rgba(31,30,27,0.35)' : COLORS.mutedTint} style="fill" />
                  <Path path={d} color={emptyStroke} style="stroke" strokeWidth={1} />
                </Group>
              ),
            )}
          </Group>
          {markers?.map((m) => {
            const p = markerPoint(c, c, innerR, m.bearingDeg, m.radius);
            const r = m.highlighted ? 9 : 6;
            return (
              <Group key={m.id}>
                <Circle cx={p.x} cy={p.y} r={r} color={COLORS.redDeep} />
                {m.highlighted ? (
                  <Circle cx={p.x} cy={p.y} r={r + 4} color={ink} style="stroke" strokeWidth={2} />
                ) : null}
              </Group>
            );
          })}
          {hasHeading ? (
            <Path path={headingMarkerPath(c, c, outerR, headingDeg, 14)} color={ink} style="fill" />
          ) : null}
        </Canvas>
        {showText ? (
          <View
            pointerEvents="none"
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
            style={{
              position: 'absolute',
              left: c - innerR * 0.8,
              width: innerR * 1.6,
              top: 0,
              bottom: 0,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text
              variant="title"
              align="center"
              maxFontSizeMultiplier={1.5}
              style={{ color: ink }}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {`${summary.percent}%`}
            </Text>
            <Text variant="micro" align="center" maxFontSizeMultiplier={1.5} style={{ color: ink }}>
              scanned
            </Text>
          </View>
        ) : null}
      </View>
      {showText ? (
        <Text
          align="center"
          importantForAccessibility="no"
          accessibilityElementsHidden
          style={{ color: ink, maxWidth: Math.max(diameter, 280) }}
        >
          {summary.hint}
        </Text>
      ) : null}
    </View>
  );
}

/** Speak at 25/50/75/100% and when Finish unlocks; never on every heading tick. */
function useMilestoneAnnouncements(enabled: boolean, percent: number, canFinish: boolean, text: string): void {
  const lastStep = useRef<number>(-1);
  const lastFinish = useRef<boolean>(false);
  useEffect(() => {
    if (!enabled) return;
    const step = Math.floor(percent / 25);
    const finishUnlocked = canFinish && !lastFinish.current;
    if (lastStep.current === -1) {
      lastStep.current = step;
      lastFinish.current = canFinish;
      return;
    }
    if (step > lastStep.current || finishUnlocked) {
      AccessibilityInfo.announceForAccessibility(text);
    }
    lastStep.current = Math.max(lastStep.current, step);
    lastFinish.current = canFinish;
  }, [enabled, percent, canFinish, text]);
}
