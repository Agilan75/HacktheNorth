/**
 * The compass ring: 36 ten-degree ticks that fill as the heading passes through
 * them, a needle at the current bearing, and the percentage in the middle.
 *
 * Plain views, no Skia, so it draws the same on iOS, Android and web, and it
 * needs nothing loaded before the first frame. Each tick is a bar rotated to
 * its panel's bearing and pushed out to the ring's radius; the needle is the
 * same trick with the live bearing. Panels and bearing are both relative to
 * the sweep start, straight from the capture machine.
 *
 * One accessible element: role progressbar, value = the percentage, text = the
 * turn hint. Covered ticks are filled and unscanned ones are outlined, so the
 * difference is shape as well as colour.
 */
import { View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { COLORS, SPACE } from '@retrofit/design';

import { Text } from '@/ui';

const TICK_COUNT = 36;
const TICK_WIDTH = 4;
const TICK_HEIGHT = 14;
const NEEDLE = 10;

export interface CoverageRingProps {
  /** 36 booleans, true where scanned. Shorter lists read as unscanned. */
  readonly panels: readonly boolean[];
  /** Current bearing relative to the sweep start, degrees. Null hides the needle. */
  readonly bearingDeg: number | null;
  /** 0..100, already floored. */
  readonly coveragePct: number;
  /** Plain-language turn advice, spoken and shown under the ring. */
  readonly hint?: string;
  /** Diameter in points. */
  readonly size?: number;
  readonly style?: StyleProp<ViewStyle>;
}

export function CoverageRing({ panels, bearingDeg, coveragePct, hint, size = 152, style }: CoverageRingProps) {
  const pct = Math.max(0, Math.min(100, Math.floor(coveragePct)));
  const radius = size / 2 - TICK_HEIGHT / 2 - 2;
  const needleRadius = size / 2 + NEEDLE;
  const hasBearing = bearingDeg !== null && Number.isFinite(bearingDeg);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Room scan coverage"
      accessibilityValue={{ min: 0, max: 100, now: pct, text: hint ?? `${String(pct)} percent scanned.` }}
      style={[{ alignItems: 'center', gap: SPACE.sm }, style]}
    >
      <View style={{ width: size + NEEDLE * 2, height: size + NEEDLE * 2, alignItems: 'center', justifyContent: 'center' }}>
        {Array.from({ length: TICK_COUNT }, (_, i) => {
          const covered = panels[i] === true;
          return (
            <View
              key={i}
              style={{
                position: 'absolute',
                width: TICK_WIDTH,
                height: TICK_HEIGHT,
                borderRadius: TICK_WIDTH / 2,
                backgroundColor: covered ? COLORS.accent : 'transparent',
                borderWidth: covered ? 0 : 1,
                borderColor: COLORS.bone,
                transform: [{ rotate: `${String(i * 10 + 5)}deg` }, { translateY: -radius }],
              }}
            />
          );
        })}

        {hasBearing ? (
          <View
            style={{
              position: 'absolute',
              width: 0,
              height: 0,
              borderLeftWidth: 6,
              borderRightWidth: 6,
              borderBottomWidth: NEEDLE,
              borderLeftColor: 'transparent',
              borderRightColor: 'transparent',
              borderBottomColor: COLORS.bone,
              transform: [{ rotate: `${String(bearingDeg)}deg` }, { translateY: -needleRadius }, { rotate: '180deg' }],
            }}
          />
        ) : null}

        <View style={{ alignItems: 'center' }}>
          <Text variant="title" weight="semibold" tone="inverse" style={{ fontVariant: ['tabular-nums'] }}>
            {`${String(pct)}%`}
          </Text>
          <Text variant="micro" tone="inverse">
            scanned
          </Text>
        </View>
      </View>

      {hint ? (
        <View
          style={{
            paddingHorizontal: SPACE.md,
            paddingVertical: SPACE.xs,
            borderRadius: 999,
            backgroundColor: 'rgba(25, 25, 25, 0.72)',
          }}
        >
          <Text variant="small" tone="inverse" align="center">
            {hint}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
