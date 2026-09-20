/**
 * A price tag on a thing in the room.
 *
 * The renter is never asked what their belongings are worth. Instead each item
 * the sweep recognises gets its replacement value shown on it, and the sum of
 * these is what becomes the contents limit on the quote.
 *
 * Anchored to a world bearing, so the tag stays on the sofa while the phone
 * turns. A tag whose price is still being looked up online reads `~$1,200`,
 * because a tilde is the difference between a table price and a sourced one.
 */
import { View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { COLORS, RADIUS, SPACE } from '@retrofit/design';

import { Text } from '@/ui';
import { screenOf } from '../pose';
import type { Viewport, WorldDirection, WorldPose } from '../pose';

/** Whole dollars. Cents on a sofa are noise. */
export function tagPrice(usd: number, approximate: boolean): string {
  const whole = Math.round(Math.max(0, usd)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${approximate ? '~' : ''}$${whole}`;
}

export interface ValueTagProps {
  readonly direction: WorldDirection;
  readonly pose: WorldPose;
  readonly view: Viewport;
  /** What the item is, e.g. "Sofa". */
  readonly name: string;
  readonly usd: number;
  /** True while an online price is still being looked up. */
  readonly approximate?: boolean;
  readonly style?: StyleProp<ViewStyle>;
}

export function ValueTag({
  direction,
  pose,
  view,
  name,
  usd,
  approximate = false,
  style,
}: ValueTagProps) {
  if (!pose.ready) return null;
  const at = screenOf(direction, view, pose);
  if (!at.visible) return null;

  const price = tagPrice(usd, approximate);
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${name}, ${price}`}
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: at.x,
          top: at.y,
          transform: [{ translateX: -8 }, { translateY: -12 }],
          flexDirection: 'row',
          alignItems: 'center',
          gap: SPACE.xs,
          paddingHorizontal: SPACE.sm,
          paddingVertical: 2,
          borderRadius: RADIUS.pill,
          backgroundColor: COLORS.bone,
        },
        style,
      ]}
    >
      <Text variant="micro" weight="semibold" numberOfLines={1}>
        {price}
      </Text>
    </View>
  );
}
