/**
 * Where the phone is pointing, and how to put a world direction on the screen.
 *
 * This is the only interface the overlay layer knows. `pose.gyro.ts` implements
 * it from `expo-sensors` DeviceMotion and the compass, which works in Expo Go
 * with no native build. `pose.viro.ts` implements the same thing from an AR
 * session's camera transform when that native module is present, and
 * `useWorldPose` below picks between them. Nothing in `overlay/` imports either
 * implementation directly.
 *
 * Angles are RADIANS. Yaw is clockwise from where the sweep started, the same
 * frame as `SweepFrameDto.bearingDeg` and `Observation.bearingDeg` once
 * converted. Pitch is 0 at the horizon and positive looking up. Roll is
 * positive rolling clockwise.
 *
 * Everything but the hook is pure and runs in node under vitest.
 */
import { useGyroPose } from './pose.gyro';
import { useViroPose, viroPoseIsLive } from './pose.viro';

export interface WorldPose {
  /** Clockwise from the sweep's start bearing, 0..2PI. */
  readonly yaw: number;
  /** 0 at the horizon, positive looking up, clamped to +/- PI/2. */
  readonly pitch: number;
  readonly roll: number;
  /** False until a real reading has arrived. Overlays draw nothing before it. */
  readonly ready: boolean;
}

export const IDLE_POSE: WorldPose = Object.freeze({ yaw: 0, pitch: 0, roll: 0, ready: false });

export const RAD = Math.PI / 180;
export const DEG = 180 / Math.PI;
const TWO_PI = Math.PI * 2;

/** Any angle into [0, 2PI). Non-finite becomes 0. */
export function wrapRad(rad: number): number {
  if (!Number.isFinite(rad)) return 0;
  const r = rad % TWO_PI;
  return r < 0 ? r + TWO_PI : r;
}

/** The shortest signed turn, in (-PI, PI]. */
export function signedRad(rad: number): number {
  const r = wrapRad(rad);
  return r > Math.PI ? r - TWO_PI : r;
}

/**
 * Horizontal field of view of one phone frame, radians. 60 degrees is the same
 * assumption the API makes when it turns a `box_2d` into a bearing
 * (`FRAME_FOV_DEG` in apps/api/src/services/sweep.ts), so a pin drawn here lands
 * where the server said the object was.
 */
export const H_FOV = 60 * RAD;

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/** Vertical field of view for a viewport, from the horizontal one and its shape. */
export function verticalFov(view: Viewport): number {
  if (!(view.width > 0) || !(view.height > 0)) return H_FOV;
  return 2 * Math.atan(Math.tan(H_FOV / 2) * (view.height / view.width));
}

export interface WorldDirection {
  /** Clockwise from the sweep start, 0..2PI. */
  readonly bearing: number;
  /** 0 at the horizon, positive up. */
  readonly elevation: number;
}

/**
 * The world direction a point on the screen is pointing at.
 *
 * A rectilinear camera is a tangent projection, so the offset from the centre
 * of the frame is `atan(offset * tan(fov / 2))` over the half-width, not a
 * linear share of the field of view. At 60 degrees the difference at the edge
 * is about 2 degrees, which is visible on a pin.
 */
export function bearingOf(
  x: number,
  y: number,
  view: Viewport,
  pose: Pick<WorldPose, 'yaw' | 'pitch'>,
): WorldDirection {
  if (!(view.width > 0) || !(view.height > 0)) {
    return { bearing: wrapRad(pose.yaw), elevation: pose.pitch };
  }
  const dx = (x - view.width / 2) / (view.width / 2);
  const dy = (y - view.height / 2) / (view.height / 2);
  const yawOffset = Math.atan(dx * Math.tan(H_FOV / 2));
  const pitchOffset = Math.atan(dy * Math.tan(verticalFov(view) / 2));
  return {
    bearing: wrapRad(pose.yaw + yawOffset),
    // Screen y grows downward, so a point below centre is below the horizon.
    elevation: pose.pitch - pitchOffset,
  };
}

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
  /** False when the direction is behind the camera or well outside the frame. */
  readonly visible: boolean;
}

/**
 * The inverse of `bearingOf`: where a world direction lands on the screen.
 * This is what the overlays draw with. Anything a quarter turn or more off the
 * centre is `visible: false`, so nothing is ever painted behind the phone.
 */
export function screenOf(
  direction: WorldDirection,
  view: Viewport,
  pose: Pick<WorldPose, 'yaw' | 'pitch'>,
): ScreenPoint {
  const dYaw = signedRad(direction.bearing - pose.yaw);
  const dPitch = signedRad(direction.elevation - pose.pitch);
  if (
    Math.abs(dYaw) >= Math.PI / 2 ||
    Math.abs(dPitch) >= Math.PI / 2 ||
    !(view.width > 0) ||
    !(view.height > 0)
  ) {
    return { x: 0, y: 0, visible: false };
  }
  const x = view.width / 2 + (Math.tan(dYaw) / Math.tan(H_FOV / 2)) * (view.width / 2);
  const y = view.height / 2 - (Math.tan(dPitch) / Math.tan(verticalFov(view) / 2)) * (view.height / 2);
  // One frame of slack on each side, so a pin slides off rather than popping.
  return {
    x,
    y,
    visible: x > -view.width && x < view.width * 2 && y > -view.height && y < view.height * 2,
  };
}

/** The x a bearing lands on, ignoring pitch. Null when it is off to the side. */
export function screenXOf(bearing: number, view: Viewport, yaw: number): number | null {
  const dYaw = signedRad(bearing - yaw);
  if (Math.abs(dYaw) >= Math.PI / 2 || !(view.width > 0)) return null;
  return view.width / 2 + (Math.tan(dYaw) / Math.tan(H_FOV / 2)) * (view.width / 2);
}

/**
 * The world direction of an object the API placed, from the bearing it already
 * computed and the vertical centre of its `box_2d`.
 *
 * The API turns `box_2d` into `Observation.bearingDeg` with the same 60 degree
 * assumption (`objectBearing`), so only the elevation is left to recover here:
 * `box_2d` is `[y0, x0, y1, x1]` in 0..1000, and the vertical centre of the box
 * maps back through the same tangent projection.
 */
export function directionOfObservation(
  bearingDeg: number,
  box2d: readonly [number, number, number, number] | null | undefined,
  view: Viewport,
  /** Pitch of the frame the object was seen in, radians. 0 when unknown. */
  framePitch = 0,
): WorldDirection {
  const bearing = wrapRad(bearingDeg * RAD);
  if (box2d === null || box2d === undefined) return { bearing, elevation: framePitch };
  const yCentre = (box2d[0] + box2d[2]) / 2 / 1000;
  const dy = Math.min(1, Math.max(0, yCentre)) * 2 - 1;
  return { bearing, elevation: framePitch - Math.atan(dy * Math.tan(verticalFov(view) / 2)) };
}

/** Radians to the degrees the capture machine and the API speak. */
export function toDegrees(rad: number): number {
  return wrapRad(rad) * DEG;
}

/* -------------------------------------------------------------------------- */
/* Coverage                                                                   */
/* -------------------------------------------------------------------------- */

/** 36 panels of 10 degrees, the same grid the capture machine and the engine use. */
export const PANEL_COUNT = 36;
export const PANEL_RAD = (2 * Math.PI) / PANEL_COUNT;

export interface CoverageBand {
  /** Panel index, 0..35. */
  readonly key: number;
  readonly x: number;
  readonly width: number;
}

/** A detected wall, reduced to what the wash needs. Metres, session frame. */
export interface WallPlane {
  readonly id: string;
  readonly center: readonly [number, number, number];
  readonly height: number;
}

export interface BandSpan {
  readonly top: number;
  readonly height: number;
}

/**
 * How tall the wash should be, in screen points.
 *
 * With no detected wall it is a fixed share of the viewport centred on the
 * horizon: a band at a fixed radius, which is all the gyro path can know. With
 * a wall, the band is the wall: its top and bottom edges are projected from the
 * plane's own height and its distance from the camera, so the paint stops where
 * the wall stops instead of running across the floor.
 *
 * `cameraY` and the plane centres are metres in the AR session's frame; the
 * distance used is the horizontal one, because a wall's height is vertical.
 */
export function bandSpan(
  view: Viewport,
  pose: Pick<WorldPose, 'yaw' | 'pitch'>,
  plane: WallPlane | null,
  camera: readonly [number, number, number],
  fallbackRatio: number,
): BandSpan {
  const fixed = (): BandSpan => {
    const height = view.height * fallbackRatio;
    return { top: screenOf({ bearing: pose.yaw, elevation: 0 }, view, pose).y - height / 2, height };
  };
  if (plane === null || !(plane.height > 0)) return fixed();

  const dx = plane.center[0] - camera[0];
  const dz = plane.center[2] - camera[2];
  const distance = Math.hypot(dx, dz);
  if (!(distance > 0.2)) return fixed();

  const halfHeight = plane.height / 2;
  const topEl = Math.atan((plane.center[1] + halfHeight - camera[1]) / distance);
  const bottomEl = Math.atan((plane.center[1] - halfHeight - camera[1]) / distance);
  const top = screenOf({ bearing: pose.yaw, elevation: topEl }, view, pose);
  const bottom = screenOf({ bearing: pose.yaw, elevation: bottomEl }, view, pose);
  const height = bottom.y - top.y;
  // A wall edge-on or behind the camera projects to nothing usable.
  if (!Number.isFinite(height) || height <= 1) return fixed();
  return { top: top.y, height };
}

/**
 * The plane facing a given bearing, or null. A wall is picked by which one the
 * phone is closest to pointing at, never by which is nearest, because the wash
 * is painted where the camera is looking.
 */
export function planeForBearing(
  planes: readonly WallPlane[],
  bearing: number,
  camera: readonly [number, number, number],
): WallPlane | null {
  let best: WallPlane | null = null;
  let bestOff = Math.PI / 3;
  for (const plane of planes) {
    const dx = plane.center[0] - camera[0];
    const dz = plane.center[2] - camera[2];
    if (dx === 0 && dz === 0) continue;
    // Session frame: -z is forward, +x is right, and bearings run clockwise.
    const planeBearing = wrapRad(Math.atan2(dx, -dz));
    const off = Math.abs(signedRad(planeBearing - bearing));
    if (off < bestOff) {
      bestOff = off;
      best = plane;
    }
  }
  return best;
}

/**
 * The covered panels that are in front of the phone, as screen rectangles.
 *
 * A panel with either edge off to the side is dropped, so nothing is ever
 * painted behind you. The projection is a tangent, so bands widen toward the
 * edge of the frame exactly as the wall does.
 */
export function coverageBands(
  panels: readonly boolean[],
  view: Viewport,
  yaw: number,
): CoverageBand[] {
  const out: CoverageBand[] = [];
  if (!(view.width > 0)) return out;
  for (let i = 0; i < PANEL_COUNT; i += 1) {
    if (panels[i] !== true) continue;
    const left = screenXOf(wrapRad(i * PANEL_RAD), view, yaw);
    const right = screenXOf(wrapRad((i + 1) * PANEL_RAD), view, yaw);
    if (left === null || right === null) continue;
    const x = Math.min(left, right);
    const width = Math.abs(right - left);
    if (width <= 0 || x > view.width || x + width < 0) continue;
    out.push({ key: i, x, width });
  }
  return out;
}

/**
 * The live pose: the AR session's when one is running, the phone's sensors
 * otherwise.
 *
 * Both hooks are always called, in the same order, every render. The choice is
 * made on whether the AR session has produced a camera transform in the last
 * second, not on whether the native module exists, and that is deliberate: a
 * development build whose AR session fails to start, loses tracking, or lands
 * on a device without ARCore falls back to the sensors within a second instead
 * of freezing on a pose that stopped updating. In Expo Go nothing ever writes
 * to the AR store, so this is always the gyro.
 */
export function useWorldPose(): WorldPose {
  const viro = useViroPose();
  const gyro = useGyroPose();
  return viro.ready && viroPoseIsLive(Date.now()) ? viro : gyro;
}
