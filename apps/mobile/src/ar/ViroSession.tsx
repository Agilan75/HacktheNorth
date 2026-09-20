/**
 * The AR session, on a development build only.
 *
 * It renders the camera the way `expo-camera` does on the Expo Go path, and it
 * additionally reports two things into `pose.viro.ts`: the camera transform on
 * every frame, and the vertical planes ARCore/ARKit finds. Nothing else in the
 * app knows this file exists except `app/index.tsx`, which renders it in place
 * of `CameraView` when `hasViro()` is true.
 *
 * Every reference to `@reactvision/react-viro` is a guarded `require` inside a
 * function, so Expo Go never evaluates the package. If anything here throws,
 * `onUnavailable` fires and the screen goes back to `expo-camera` and the gyro.
 */
import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { hasViro, pushCameraTransform, pushPlanes, resetViroPose } from './pose.viro';
import type { ViroCameraTransform, ViroPlane } from './pose.viro';

/** What a screenshot hands back, so the capture path is the same on both paths. */
export interface ViroShot {
  readonly uri: string;
  readonly width: number;
  readonly height: number;
}

export interface ViroSessionHandle {
  /** One frame of the camera, as a file URI. Rejects if the session is not up. */
  takePicture(): Promise<ViroShot>;
}

export interface ViroSessionProps {
  /** Handed the screenshot function once the session is up. */
  readonly onReady?: (handle: ViroSessionHandle) => void;
  /** Fired when the AR session cannot run. The screen falls back to the camera. */
  readonly onUnavailable?: (reason: string) => void;
  readonly style?: StyleProp<ViewStyle>;
}

/* -------------------------------------------------------------------------- */
/* Anchors                                                                    */
/* -------------------------------------------------------------------------- */

/** Viro's anchor shape, narrowed to the fields the wash needs. */
interface ViroAnchor {
  readonly anchorId?: string;
  readonly position?: readonly number[];
  readonly rotation?: readonly number[];
  readonly width?: number;
  readonly height?: number;
  readonly alignment?: string;
}

/** A plane, or null when the anchor is not a usable vertical surface. */
export function planeOf(anchor: ViroAnchor): ViroPlane | null {
  const id = anchor.anchorId;
  const p = anchor.position;
  const r = anchor.rotation;
  if (typeof id !== 'string' || !Array.isArray(p) || p.length < 3 || !Array.isArray(r) || r.length < 3) {
    return null;
  }
  const width = typeof anchor.width === 'number' && anchor.width > 0 ? anchor.width : 0;
  const height = typeof anchor.height === 'number' && anchor.height > 0 ? anchor.height : 0;
  if (width === 0 || height === 0) return null;
  return {
    id,
    center: [p[0] as number, p[1] as number, p[2] as number],
    width,
    height,
    rotation: [r[0] as number, r[1] as number, r[2] as number],
  };
}

/* -------------------------------------------------------------------------- */
/* Session                                                                    */
/* -------------------------------------------------------------------------- */

export function ViroSession({ onReady, onUnavailable, style }: ViroSessionProps) {
  const navigatorRef = useRef<{ _takeScreenshot?: (name: string, save: boolean) => Promise<unknown> } | null>(null);
  const planes = useRef(new Map<string, ViroPlane>());

  /** Loaded once, guarded. Null means: use the camera and the gyro instead. */
  const viro = useMemo(() => {
    if (!hasViro()) return null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('@reactvision/react-viro') as {
        ViroARSceneNavigator: React.ComponentType<Record<string, unknown>>;
        ViroARScene: React.ComponentType<Record<string, unknown>>;
        ViroARPlaneSelector?: React.ComponentType<Record<string, unknown>>;
        ViroTrackingStateConstants?: Record<string, unknown>;
      };
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (viro === null) {
      onUnavailable?.('ViroReact is not in this build');
      return undefined;
    }
    resetViroPose();
    return () => {
      resetViroPose();
      planes.current.clear();
    };
  }, [viro, onUnavailable]);

  useEffect(() => {
    if (viro === null) return;
    onReady?.({
      async takePicture(): Promise<ViroShot> {
        const nav = navigatorRef.current;
        if (nav?._takeScreenshot === undefined) throw new Error('no AR session');
        const out = (await nav._takeScreenshot(`sweep-${String(Date.now())}`, false)) as {
          success?: boolean;
          url?: string;
          width?: number;
          height?: number;
        };
        if (out.success !== true || typeof out.url !== 'string') throw new Error('screenshot failed');
        return {
          uri: out.url,
          width: typeof out.width === 'number' ? out.width : 0,
          height: typeof out.height === 'number' ? out.height : 0,
        };
      },
    });
  }, [viro, onReady]);

  if (viro === null) return null;

  const { ViroARSceneNavigator, ViroARScene } = viro;

  const setPlane = (anchor: ViroAnchor): void => {
    const plane = planeOf(anchor);
    if (plane === null) return;
    planes.current.set(plane.id, plane);
    pushPlanes([...planes.current.values()]);
  };

  const dropPlane = (anchor: ViroAnchor): void => {
    if (typeof anchor.anchorId !== 'string') return;
    planes.current.delete(anchor.anchorId);
    pushPlanes([...planes.current.values()]);
  };

  /**
   * The scene has no geometry of its own: every mark the renter sees is drawn
   * by the React Native overlay on top, which keeps one drawing path for both
   * the Expo Go and the development-build cases.
   */
  const Scene = () => (
    <ViroARScene
      anchorDetectionTypes="PlanesVertical"
      onCameraTransformUpdate={(t: ViroCameraTransform) => pushCameraTransform(t, Date.now())}
      onAnchorFound={setPlane}
      onAnchorUpdated={setPlane}
      onAnchorRemoved={dropPlane}
      onTrackingUpdated={(state: unknown) => {
        // Tracking lost stops the transforms; `pose.ts` notices within a second
        // and falls back to the sensors, so nothing here has to do anything.
        void state;
      }}
    />
  );

  return (
    <View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      <ViroARSceneNavigator
        ref={(r: unknown) => {
          navigatorRef.current = r as { _takeScreenshot?: (name: string, save: boolean) => Promise<unknown> } | null;
        }}
        autofocus
        initialScene={{ scene: Scene }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}
