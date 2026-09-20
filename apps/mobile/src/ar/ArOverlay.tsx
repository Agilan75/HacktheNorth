/**
 * The camera overlay: coverage on the walls, a pin on anything that costs, a
 * price on anything worth insuring, and the two live numbers in the corner.
 *
 * This is the only file that knows where the overlays get their data from. The
 * overlays themselves know nothing but a world direction and the pose, so the
 * pose implementation can change under them (gyro in Expo Go, Viro on a
 * development build) without any of them changing.
 *
 * Two anchoring notes, both honest about what is and is not known:
 *
 * - Coverage comes from the capture machine's 36-panel mask, which is the
 *   same 10 degree grid the engine uses, so a painted band is a panel the API
 *   will also count.
 * - A live-priced item carries the bearing of the frame it was first seen in,
 *   not a `box_2d`: `POST /price/identify` returns no box. So a tag sits at the
 *   centre of that frame rather than on the object's own pixels. Once a sweep
 *   has been scored, `Observation.bearingDeg` and `box_2d` do give the exact
 *   direction, and `directionOfObservation` is what turns them into one.
 */
import { useMemo } from 'react';
import { View, useWindowDimensions } from 'react-native';
import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';

import type { LiveEntry, LiveSnapshot } from '@/lib/livePrice';
import type { IconName } from '@/ui';
import { CoverageWash } from './overlay/CoverageWash';
import { Hud } from './overlay/Hud';
import { HazardPin } from './overlay/HazardPin';
import { ValueTag } from './overlay/ValueTag';
import { RAD, wrapRad } from './pose';
import type { Viewport, WallPlane, WorldPose } from './pose';

/**
 * Live labels that are themselves a hazard, so a pin can go up during the
 * sweep rather than waiting for the sweep to be scored. The keys are the live
 * price table's labels; the values are the engine's hazard keys.
 */
const LIVE_HAZARDS: Readonly<Record<string, { readonly key: string; readonly name: string; readonly icon: IconName }>> = {
  portable_heater: { key: 'portableHeater', name: 'Space heater', icon: 'flame-outline' },
  stove: { key: 'stove', name: 'Stove', icon: 'restaurant-outline' },
  window_ac_unit: { key: 'windowAcUnit', name: 'Window AC', icon: 'snow-outline' },
};

/**
 * Tags sit a little below the horizon and pins a little above it, so a heater
 * and its price never land on the same pixels. Neither elevation is measured:
 * `/price/identify` returns no box to measure one from.
 */
const TAG_ELEVATION = -10 * RAD;
const PIN_ELEVATION = 6 * RAD;

export interface ArOverlayProps {
  readonly pose: WorldPose;
  /** 36 booleans from the capture machine. */
  readonly panels: readonly boolean[];
  /** Walls the AR session found. Empty on the Expo Go path. */
  readonly planes?: readonly WallPlane[];
  /** Camera position in the AR session's frame, metres. */
  readonly camera?: readonly [number, number, number];
  readonly coveragePct: number;
  readonly canFinish: boolean;
  readonly onFinish: () => void;
  readonly live: LiveSnapshot;
  /** Opens `/hazard/[id]`. Omitted while there is no scored sweep to open. */
  readonly onHazard?: (hazardKey: string) => void;
  /** Shown under Finish: the upload-photos link. */
  readonly footer?: ReactNode;
}

interface Anchored {
  readonly entry: LiveEntry;
  readonly bearing: number;
}

/** Only the items the sweep could place. An unplaced item still counts in the total. */
export function anchored(entries: readonly LiveEntry[]): Anchored[] {
  const out: Anchored[] = [];
  for (const entry of entries) {
    if (entry.bearingDeg === null || !Number.isFinite(entry.bearingDeg)) continue;
    out.push({ entry, bearing: wrapRad(entry.bearingDeg * RAD) });
  }
  return out;
}

export function ArOverlay({
  pose,
  panels,
  planes,
  camera,
  coveragePct,
  canFinish,
  onFinish,
  live,
  onHazard,
  footer,
}: ArOverlayProps) {
  const { width, height } = useWindowDimensions();
  const view: Viewport = useMemo(() => ({ width, height }), [width, height]);
  const placed = useMemo(() => anchored(live.entries), [live.entries]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <CoverageWash panels={panels} pose={pose} view={view} planes={planes} camera={camera} />

      {/* Anything that costs money to insure gets a pin on it. */}
      {placed.map(({ entry, bearing }) => {
        const hazard = LIVE_HAZARDS[entry.item.label];
        if (hazard === undefined) return null;
        return (
          <HazardPin
            key={`pin-${entry.item.key}`}
            direction={{ bearing, elevation: PIN_ELEVATION }}
            pose={pose}
            view={view}
            label={hazard.name}
            icon={hazard.icon}
            {...(onHazard !== undefined ? { onPress: () => onHazard(hazard.key) } : {})}
          />
        );
      })}

      {/* Everything worth replacing gets its value on it. */}
      {placed.map(({ entry, bearing }) => (
        <ValueTag
          key={`tag-${entry.item.key}`}
          direction={{ bearing, elevation: TAG_ELEVATION }}
          pose={pose}
          view={view}
          name={entry.item.name}
          usd={entry.price}
          approximate={entry.status !== 'sourced'}
        />
      ))}

      <Hud
        coveragePct={coveragePct}
        totalUsd={live.total}
        itemCount={live.entries.length}
        working={live.identifying > 0 || live.searching > 0}
        canFinish={canFinish}
        onFinish={onFinish}
        footer={footer}
      />
    </View>
  );
}
