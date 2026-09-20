/**
 * The two numbers that change while you turn: how much of the room is scanned,
 * and what the camera has priced so far. Top corner, live, over the camera.
 *
 * Finish enables at 75% coverage. A locked Finish says why when it is tapped
 * rather than swallowing the tap, and its reason is spoken as well as printed,
 * so the lock never rests on a grey fill alone.
 */
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Pressable, View } from 'react-native';
import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { COLORS, MIN_TOUCH_TARGET, RADIUS, SPACE } from '@retrofit/design';

import { Button, Text } from '@/ui';

/** Coverage at which Finish unlocks. The engine's MIN_COVERAGE_PCT. */
export const FINISH_COVERAGE_PCT = 75;

/** Ink at 72%, so bone text reads over any camera image. Not a second dark. */
const SCRIM = 'rgba(25, 25, 25, 0.72)';

export interface HudProps {
  /** 0..100, floored, so 74.9 never reads as 75. */
  readonly coveragePct: number;
  /** Replacement value priced so far, USD. */
  readonly totalUsd: number;
  readonly itemCount: number;
  /** True while frames or online lookups are still in flight. */
  readonly working?: boolean;
  readonly canFinish: boolean;
  readonly onFinish: () => void;
  /** Shown under Finish: the upload-photos link. */
  readonly footer?: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
}

const usd = (n: number): string => `$${Math.round(Math.max(0, n)).toLocaleString('en-US')}`;

export function Hud({
  coveragePct,
  totalUsd,
  itemCount,
  working = false,
  canFinish,
  onFinish,
  footer,
  style,
}: HudProps) {
  const pct = Math.max(0, Math.min(100, Math.floor(coveragePct)));
  const reason = `Finish at ${String(FINISH_COVERAGE_PCT)}%. Now ${String(pct)}%.`;

  useUnlockAnnouncement(canFinish, pct);

  return (
    <View pointerEvents="box-none" style={[{ flex: 1, justifyContent: 'space-between', padding: SPACE.lg }, style]}>
      {/* Top corner: the two live numbers, as one spoken element. */}
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: pct, text: `${String(pct)}% scanned. ${String(itemCount)} items, ${usd(totalUsd)}.` }}
        style={{
          alignSelf: 'flex-start',
          gap: 2,
          paddingHorizontal: SPACE.md,
          paddingVertical: SPACE.sm,
          borderRadius: RADIUS.card,
          backgroundColor: SCRIM,
        }}
      >
        <Text variant="heading" weight="semibold" tone="inverse" style={{ fontVariant: ['tabular-nums'] }}>
          {`${String(pct)}%`}
        </Text>
        <Text variant="micro" tone="inverse">
          scanned
        </Text>
        <Text variant="small" weight="semibold" tone="inverse" style={{ fontVariant: ['tabular-nums'] }}>
          {usd(totalUsd)}
        </Text>
        <Text variant="micro" tone="inverse">
          {`${String(itemCount)} ${itemCount === 1 ? 'item' : 'items'}${working ? ' · pricing' : ''}`}
        </Text>
      </View>

      {/* Bottom: Finish, then the photo alternative. */}
      <View pointerEvents="box-none" style={{ gap: SPACE.md }}>
        {canFinish ? (
          <Button label="Finish" fullWidth accessibilityHint="Ends the scan and prices the room." onPress={onFinish} />
        ) : (
          <LockedFinish reason={reason} />
        )}
        {footer}
      </View>
    </View>
  );
}

/**
 * Not the kit Button: a disabled Pressable swallows taps silently, and a locked
 * Finish has to say why when someone taps it.
 */
function LockedFinish({ reason }: { readonly reason: string }) {
  return (
    <View style={{ gap: SPACE.xs }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Finish, locked"
        accessibilityHint={reason}
        accessibilityState={{ disabled: true }}
        hitSlop={4}
        onPress={() => {
          AccessibilityInfo.announceForAccessibility(reason);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
        }}
        style={{
          minHeight: MIN_TOUCH_TARGET,
          alignSelf: 'stretch',
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: SPACE.xl,
          paddingVertical: SPACE.md,
          borderRadius: RADIUS.pill,
          borderWidth: 2,
          borderStyle: 'dashed',
          borderColor: COLORS.bone,
          backgroundColor: SCRIM,
        }}
      >
        <Text variant="body" weight="semibold" tone="inverse" align="center">
          {`Finish, locked to ${String(FINISH_COVERAGE_PCT)}%`}
        </Text>
      </Pressable>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          backgroundColor: SCRIM,
          borderRadius: RADIUS.card,
          paddingHorizontal: SPACE.md,
          paddingVertical: SPACE.xs,
        }}
      >
        <Text variant="small" tone="inverse" align="center">
          {reason}
        </Text>
      </View>
    </View>
  );
}

/** Speaks once, when Finish unlocks. Never on every compass tick. */
function useUnlockAnnouncement(canFinish: boolean, pct: number): void {
  const was = useRef(false);
  useEffect(() => {
    if (canFinish && !was.current) {
      AccessibilityInfo.announceForAccessibility(`${String(pct)}% scanned. You can finish.`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    }
    was.current = canFinish;
  }, [canFinish, pct]);
}
