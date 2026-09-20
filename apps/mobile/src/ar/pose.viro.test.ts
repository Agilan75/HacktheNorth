/**
 * The AR store and the plane geometry. Pure, so it runs in node — which is
 * also the point: nothing in `pose.viro.ts` touches the native module until
 * `hasViro()` says a build carries one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-sensors', () => ({
  DeviceMotion: { setUpdateInterval: () => undefined, addListener: () => ({ remove: () => undefined }) },
}));
vi.mock('expo-location', () => ({
  watchHeadingAsync: () => Promise.resolve({ remove: () => undefined }),
}));

import { RAD, bandSpan, planeForBearing, toDegrees } from './pose';
import type { WallPlane } from './pose';
import {
  VIRO_STALE_MS,
  hasViro,
  pushCameraTransform,
  pushPlanes,
  resetViroPose,
  viroCameraPosition,
  viroPlanesSnapshot,
  viroPoseIsLive,
  viroPoseSnapshot,
} from './pose.viro';

const VIEW = { width: 390, height: 844 };
const LEVEL = { yaw: 0, pitch: 0 };
const deg = (d: number): number => d * RAD;

beforeEach(() => {
  resetViroPose();
});

describe('hasViro', () => {
  it('is false where the native module cannot be, and never throws asking', () => {
    expect(() => hasViro()).not.toThrow();
    expect(hasViro()).toBe(false);
  });
});

describe('the camera transform store', () => {
  it('starts not ready, so the gyro is what pose.ts uses', () => {
    expect(viroPoseSnapshot().ready).toBe(false);
    expect(viroPoseIsLive(1000)).toBe(false);
  });

  it('makes the first transform the sweep’s own zero', () => {
    pushCameraTransform({ rotation: [0, -140, 0], position: [1, 1.5, -2] }, 1000);
    expect(viroPoseSnapshot().ready).toBe(true);
    expect(toDegrees(viroPoseSnapshot().yaw)).toBeCloseTo(0, 6);
    expect(viroCameraPosition()).toEqual([1, 1.5, -2]);
  });

  it('turns Viro’s counter-clockwise yaw into the clockwise bearing the app uses', () => {
    pushCameraTransform({ rotation: [0, 0, 0] }, 1000);
    // Viro yaw -90 is a quarter turn clockwise in this app's frame.
    pushCameraTransform({ rotation: [0, -90, 0] }, 1010);
    expect(toDegrees(viroPoseSnapshot().yaw)).toBeCloseTo(90, 6);
    pushCameraTransform({ rotation: [0, 90, 0] }, 1020);
    expect(toDegrees(viroPoseSnapshot().yaw)).toBeCloseTo(270, 6);
  });

  it('carries pitch and roll through in radians, clamping pitch to straight up', () => {
    pushCameraTransform({ rotation: [30, 0, -15] }, 1000);
    expect(viroPoseSnapshot().pitch).toBeCloseTo(deg(30), 9);
    expect(viroPoseSnapshot().roll).toBeCloseTo(deg(-15), 9);
    pushCameraTransform({ rotation: [140, 0, 0] }, 1010);
    expect(viroPoseSnapshot().pitch).toBeCloseTo(Math.PI / 2, 9);
  });

  it('ignores a transform with no usable rotation', () => {
    pushCameraTransform({ rotation: [Number.NaN, 0, 0] }, 1000);
    pushCameraTransform({}, 1000);
    pushCameraTransform({ rotation: [0, 0] }, 1000);
    expect(viroPoseSnapshot().ready).toBe(false);
  });

  it('goes stale a second after the last transform, which is the fallback trigger', () => {
    pushCameraTransform({ rotation: [0, 0, 0] }, 5_000);
    expect(viroPoseIsLive(5_000 + VIRO_STALE_MS - 1)).toBe(true);
    expect(viroPoseIsLive(5_000 + VIRO_STALE_MS)).toBe(false);
  });

  it('forgets everything on reset, so a second sweep starts a new frame', () => {
    pushCameraTransform({ rotation: [0, -140, 0], position: [1, 1, 1] }, 1000);
    pushPlanes([{ id: 'a', center: [0, 0, -2], width: 3, height: 2, rotation: [0, 0, 0] }]);
    resetViroPose();
    expect(viroPoseSnapshot().ready).toBe(false);
    expect(viroPlanesSnapshot()).toEqual([]);
    expect(viroCameraPosition()).toEqual([0, 0, 0]);
    // The next transform becomes the new zero, whatever its absolute yaw.
    pushCameraTransform({ rotation: [0, 77, 0] }, 2000);
    expect(toDegrees(viroPoseSnapshot().yaw)).toBeCloseTo(0, 6);
  });
});

describe('planeForBearing', () => {
  const camera: readonly [number, number, number] = [0, 1.5, 0];
  // Session frame: -z is forward, +x is right.
  const ahead: WallPlane = { id: 'ahead', center: [0, 1.2, -3], height: 2.4 };
  const right: WallPlane = { id: 'right', center: [3, 1.2, 0], height: 2.4 };
  const behind: WallPlane = { id: 'behind', center: [0, 1.2, 3], height: 2.4 };

  it('picks the wall the phone is pointing at, not the nearest one', () => {
    expect(planeForBearing([ahead, right, behind], deg(0), camera)?.id).toBe('ahead');
    expect(planeForBearing([ahead, right, behind], deg(90), camera)?.id).toBe('right');
    expect(planeForBearing([ahead, right, behind], deg(180), camera)?.id).toBe('behind');
  });

  it('is null when no wall is anywhere near the bearing', () => {
    expect(planeForBearing([ahead], deg(180), camera)).toBeNull();
    expect(planeForBearing([], deg(0), camera)).toBeNull();
  });

  it('skips a wall the camera is standing inside', () => {
    expect(planeForBearing([{ id: 'x', center: [0, 1.5, 0], height: 2 }], deg(0), camera)).toBeNull();
  });
});

describe('bandSpan', () => {
  const camera: readonly [number, number, number] = [0, 1.5, 0];

  it('falls back to a fixed band centred on the horizon with no wall', () => {
    const span = bandSpan(VIEW, LEVEL, null, camera, 0.42);
    expect(span.height).toBeCloseTo(VIEW.height * 0.42, 9);
    expect(span.top + span.height / 2).toBeCloseTo(VIEW.height / 2, 6);
  });

  it('paints the wall itself once one is found', () => {
    const wall: WallPlane = { id: 'w', center: [0, 1.2, -3], height: 2.4 };
    const span = bandSpan(VIEW, LEVEL, wall, camera, 0.42);
    expect(span.height).toBeGreaterThan(0);
    expect(span.height).not.toBeCloseTo(VIEW.height * 0.42, 3);
  });

  it('draws a nearer wall taller than a far one, as it looks', () => {
    const near = bandSpan(VIEW, LEVEL, { id: 'n', center: [0, 1.2, -1.5], height: 2.4 }, camera, 0.42);
    const far = bandSpan(VIEW, LEVEL, { id: 'f', center: [0, 1.2, -6], height: 2.4 }, camera, 0.42);
    expect(near.height).toBeGreaterThan(far.height);
  });

  it('falls back rather than drawing nonsense for a wall with no size or on top of you', () => {
    expect(bandSpan(VIEW, LEVEL, { id: 'z', center: [0, 1.2, -3], height: 0 }, camera, 0.42).height).toBeCloseTo(
      VIEW.height * 0.42,
      9,
    );
    expect(bandSpan(VIEW, LEVEL, { id: 'z', center: [0, 1.2, -0.05], height: 2 }, camera, 0.42).height).toBeCloseTo(
      VIEW.height * 0.42,
      9,
    );
  });
});
