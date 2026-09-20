/**
 * `useWorldPose` from an AR session's camera transform, plus the wall planes
 * ARCore/ARKit finds. The development-build path.
 *
 * `@reactvision/react-viro` is a native module: 85 MB of iOS and Android code
 * behind an Expo config plugin. Expo Go cannot load it, so NOTHING here is
 * imported at module scope. Every touch of that package goes through a guarded
 * `require` inside a function, and `hasViro()` answers false before any of them
 * runs in Expo Go. Importing this file is therefore safe everywhere, including
 * the node test run.
 *
 * The pose itself is a store rather than a hook subscription, because Viro
 * reports the camera transform through a scene callback, not a hook. The scene
 * writes into the store; `useViroPose` reads it. When the store has heard
 * nothing recently, `pose.ts` uses the gyro instead, which is what makes a
 * failed AR session degrade rather than hang.
 */
import { useEffect, useState } from 'react';

import type { WorldPose } from './pose';

const RAD = Math.PI / 180;
const TWO_PI = Math.PI * 2;

/** A transform older than this means the AR session is not running. */
export const VIRO_STALE_MS = 1_000;

function wrap(rad: number): number {
  if (!Number.isFinite(rad)) return 0;
  const r = rad % TWO_PI;
  return r < 0 ? r + TWO_PI : r;
}

/* -------------------------------------------------------------------------- */
/* Availability                                                               */
/* -------------------------------------------------------------------------- */

let availability: boolean | null = null;

/**
 * True only on a build that actually contains the native module.
 *
 * Expo Go is ruled out first and by name: `expo-constants` reports
 * `executionEnvironment === 'storeClient'` there, and asking the question that
 * way means the `require` below never runs inside Expo Go at all.
 */
export function hasViro(): boolean {
  if (availability !== null) return availability;
  availability = false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Constants = require('expo-constants') as {
      default?: { executionEnvironment?: string; appOwnership?: string | null };
    };
    const env = Constants.default?.executionEnvironment;
    const owner = Constants.default?.appOwnership;
    if (env === 'storeClient' || owner === 'expo') return availability;
  } catch {
    // No expo-constants is not a reason to assume a development build.
    return availability;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const viro = require('@reactvision/react-viro') as Record<string, unknown>;
    availability = typeof viro.ViroARSceneNavigator === 'function';
  } catch {
    availability = false;
  }
  return availability;
}

/* -------------------------------------------------------------------------- */
/* The camera transform store                                                 */
/* -------------------------------------------------------------------------- */

/** What `onCameraTransformUpdate` hands back. Rotation is DEGREES, [pitch, yaw, roll]. */
export interface ViroCameraTransform {
  readonly position?: readonly number[];
  readonly rotation?: readonly number[];
  readonly forward?: readonly number[];
  readonly up?: readonly number[];
}

/**
 * A vertical plane the AR session found, in the session's world frame.
 * `CoverageWash` paints on these instead of at a fixed radius.
 */
export interface ViroPlane {
  readonly id: string;
  /** Metres, [x, y, z], session origin. */
  readonly center: readonly [number, number, number];
  /** Metres, width and height of the detected extent. */
  readonly width: number;
  readonly height: number;
  /** Degrees, [pitch, yaw, roll] of the plane. */
  readonly rotation: readonly [number, number, number];
}

interface Store {
  pose: WorldPose;
  /** Yaw of the first transform, so the pose is relative to the sweep start. */
  startYaw: number | null;
  /** Metres, [x, y, z] in the session's frame. Needed to project a plane. */
  position: readonly [number, number, number];
  atMs: number;
  planes: readonly ViroPlane[];
}

const store: Store = {
  pose: { yaw: 0, pitch: 0, roll: 0, ready: false },
  startYaw: null,
  position: [0, 0, 0],
  atMs: 0,
  planes: [],
};
const listeners = new Set<() => void>();

function announce(): void {
  for (const l of [...listeners]) l();
}

/** Called by the AR scene on every camera transform. `nowMs` is injected for tests. */
export function pushCameraTransform(t: ViroCameraTransform, nowMs: number): void {
  const r = t.rotation;
  if (!Array.isArray(r) || r.length < 3) return;
  const [pitchDeg, yawDeg, rollDeg] = r as [number, number, number];
  if (!Number.isFinite(pitchDeg) || !Number.isFinite(yawDeg) || !Number.isFinite(rollDeg)) return;

  // Viro's yaw grows counter-clockwise; every bearing in this app is clockwise
  // from the sweep start, which is also where the AR session starts.
  const absolute = wrap(-yawDeg * RAD);
  store.startYaw ??= absolute;
  store.pose = {
    yaw: wrap(absolute - store.startYaw),
    pitch: Math.min(Math.PI / 2, Math.max(-Math.PI / 2, pitchDeg * RAD)),
    roll: rollDeg * RAD,
    ready: true,
  };
  const p = t.position;
  if (Array.isArray(p) && p.length >= 3 && p.every((v) => Number.isFinite(v))) {
    store.position = [p[0] as number, p[1] as number, p[2] as number];
  }
  store.atMs = nowMs;
  announce();
}

/** Called by the AR scene when the set of detected planes changes. */
export function pushPlanes(planes: readonly ViroPlane[]): void {
  store.planes = planes;
  announce();
}

/** Drops everything, so a new sweep starts a new frame of reference. */
export function resetViroPose(): void {
  store.pose = { yaw: 0, pitch: 0, roll: 0, ready: false };
  store.startYaw = null;
  store.position = [0, 0, 0];
  store.atMs = 0;
  store.planes = [];
  announce();
}

/** Where the camera is, in the session's frame. [0, 0, 0] on the gyro path. */
export function viroCameraPosition(): readonly [number, number, number] {
  return store.position;
}

/** True while the AR session is producing transforms. */
export function viroPoseIsLive(nowMs: number): boolean {
  return store.pose.ready && nowMs - store.atMs < VIRO_STALE_MS;
}

export function viroPoseSnapshot(): WorldPose {
  return store.pose;
}

export function viroPlanesSnapshot(): readonly ViroPlane[] {
  return store.planes;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/* -------------------------------------------------------------------------- */
/* Hooks                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The AR pose, or a not-ready pose when no AR session is running. Safe to call
 * in Expo Go: with nothing writing to the store it simply never becomes ready,
 * and `pose.ts` falls through to the gyro.
 */
export function useViroPose(): WorldPose {
  const [pose, setPose] = useState<WorldPose>(store.pose);
  useEffect(() => subscribe(() => setPose(store.pose)), []);
  return pose;
}

/** The detected wall planes. Empty on the gyro path. */
export function useViroPlanes(): readonly ViroPlane[] {
  const [planes, setPlanes] = useState<readonly ViroPlane[]>(store.planes);
  useEffect(() => subscribe(() => setPlanes(store.planes)), []);
  return planes;
}
