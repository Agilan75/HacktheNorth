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

import { bandSpan, coverageBands, planeForBearing } from '../pose';
import type { Viewport, WallPlane, WorldPose } from '../pose';

/** The one accent, at the one opacity the wash is allowed. */
const WASH_OPACITY = 0.35;

/** Share of the viewport height the band covers when no wall has been found. */
const BAND_HEIGHT_RATIO = 0.42;

export interface CoverageWashProps {
  /** 36 booleans from the capture machine, true where the sweep has been. */
  readonly panels: readonly boolean[];
  readonly pose: WorldPose;
  readonly view: Viewport;
  /** Walls the AR session found. Empty on the gyro path, where the band is fixed. */
  readonly planes?: readonly WallPlane[];
  /** Camera position in the session's frame, metres. */
  readonly camera?: readonly [number, number, number];
}

const ORIGIN: readonly [number, number, number] = [0, 0, 0];

export function CoverageWash({ panels, pose, view, planes = [], camera = ORIGIN }: CoverageWashProps) {
  const bands = useMemo(
    () => (pose.ready ? coverageBands(panels, view, pose.yaw) : []),
    [panels, view, pose.ready, pose.yaw],
  );

  if (bands.length === 0) return null;

  // On a development build the band is the wall the phone is looking at; on
  // the Expo Go path it is a fixed band centred on the horizon.
  const wall = planes.length > 0 ? planeForBearing(planes, pose.yaw, camera) : null;
  const { top, height } = bandSpan(view, pose, wall, camera, BAND_HEIGHT_RATIO);

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
