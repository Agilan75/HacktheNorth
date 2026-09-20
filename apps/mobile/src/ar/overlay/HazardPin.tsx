/**
 * A pin on the thing itself.
 *
 * Anchored to a world bearing and elevation, so it stays on the heater as the
 * phone turns rather than sitting in a list. Where the sweep has been scored,
 * the pin's position is the one the API already worked out: the centre of the
 * model's `box_2d` at the yaw of the frame it came from.
 *
 * Plain views, not Skia: a pin is a 44pt touch target with a label, and touch
 * belongs to React Native rather than to a canvas.
 */
import { Pressable, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { COLORS, MIN_TOUCH_TARGET, RADIUS, SPACE } from '@retrofit/design';

import { Icon, Text } from '@/ui';
import type { IconName } from '@/ui';
import { screenOf } from '../pose';
import type { Viewport, WorldDirection, WorldPose } from '../pose';

/** Diameter of the dot, points. The tappable area around it is 44. */
const DOT = 16;

export interface HazardPinProps {
  /** Where the thing is, in the world. */
  readonly direction: WorldDirection;
  readonly pose: WorldPose;
  readonly view: Viewport;
  /** Plain name, e.g. "Space heater". Always shown; never colour alone. */
  readonly label: string;
  /** Decoration beside the label. */
  readonly icon?: IconName;
  /** What the hazard costs, already formatted. Omitted before a price exists. */
  readonly cost?: string;
  /** Opens `/hazard/[id]`. Omitted while the sweep has no result to open. */
  readonly onPress?: () => void;
  readonly style?: StyleProp<ViewStyle>;
}

export function HazardPin({
  direction,
  pose,
  view,
  label,
  icon,
  cost,
  onPress,
  style,
}: HazardPinProps) {
  if (!pose.ready) return null;
  const at = screenOf(direction, view, pose);
  if (!at.visible) return null;

  const words = cost === undefined ? label : `${label}  ${cost}`;
  const body = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACE.sm,
        paddingHorizontal: SPACE.md,
        paddingVertical: SPACE.xs,
        borderRadius: RADIUS.pill,
        borderWidth: 2,
        borderColor: COLORS.bone,
        backgroundColor: COLORS.ink,
      }}
    >
      <View style={{ width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: COLORS.red }} />
      {icon !== undefined ? <Icon name={icon} size={14} color={COLORS.bone} /> : null}
      <Text variant="small" weight="semibold" tone="inverse" numberOfLines={1}>
        {words}
      </Text>
    </View>
  );

  const placement: ViewStyle = {
    position: 'absolute',
    left: at.x,
    top: at.y,
    // The anchor is the pin's dot, not its corner.
    transform: [{ translateX: -DOT }, { translateY: -MIN_TOUCH_TARGET / 2 }],
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  };

  if (onPress === undefined) {
    return (
      <View accessible accessibilityRole="text" accessibilityLabel={words} style={[placement, style]}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={words}
      accessibilityHint="Shows the photo and what fixing it does."
      onPress={onPress}
      hitSlop={8}
      style={[placement, style]}
    >
      {body}
    </Pressable>
  );
}
