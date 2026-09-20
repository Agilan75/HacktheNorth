/**
 * Coverage, painted on the room instead of on a dial.
 *
 * Every 10 degree panel the sweep has captured is drawn as a translucent band
 * at its own world bearing, so it sits on the wall and stays there as the phone
 * turns. What is left unpainted is what is left to scan, which is the only
 * thing the person holding the phone needs to know.
 *
 * Skia, which Expo Go for SDK 57 bundles at the version this app pins, so this
 * renders with no development build. The band's vertical centre follows the
 * horizon, so it tips with the phone. C2 replaces the fixed band with the
 * detected wall planes; nothing else about this file changes.
 *
 * The geometry itself is in `../pose`, where it is tested in node.
 */
import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { Canvas, Group, Rect } from '@shopify/react-native-skia';
import { COLORS } from '@retrofit/design';

import { coverageBands, screenOf } from '../pose';
import type { Viewport, WorldPose } from '../pose';

/** The one accent, at the one opacity the wash is allowed. */
const WASH_OPACITY = 0.35;

/** Share of the viewport height the band covers. */
const BAND_HEIGHT_RATIO = 0.42;

export interface CoverageWashProps {
  /** 36 booleans from the capture machine, true where the sweep has been. */
  readonly panels: readonly boolean[];
  readonly pose: WorldPose;
  readonly view: Viewport;
}

export function CoverageWash({ panels, pose, view }: CoverageWashProps) {
  const bands = useMemo(
    () => (pose.ready ? coverageBands(panels, view, pose.yaw) : []),
    [panels, view, pose.ready, pose.yaw],
  );

  if (bands.length === 0) return null;

  // The horizon, so the band tips with the phone rather than floating.
  const horizon = screenOf({ bearing: pose.yaw, elevation: 0 }, view, pose);
  const height = view.height * BAND_HEIGHT_RATIO;
  const top = horizon.y - height / 2;

  return (
    <Canvas
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Group opacity={WASH_OPACITY}>
        {bands.map((b) => (
          <Rect key={b.key} x={b.x} y={top} width={b.width} height={height} color={COLORS.red} />
        ))}
      </Group>
    </Canvas>
  );
}
