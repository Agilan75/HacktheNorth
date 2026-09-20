/**
 * The projection maths behind the camera overlay. Pure, so it runs in node.
 *
 * `pose.ts` pulls in `pose.gyro.ts` for the live hook, which imports two Expo
 * native modules; neither is touched by anything tested here, so both are
 * stubbed at the module boundary.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-sensors', () => ({
  DeviceMotion: { setUpdateInterval: () => undefined, addListener: () => ({ remove: () => undefined }) },
}));
vi.mock('expo-location', () => ({
  watchHeadingAsync: () => Promise.resolve({ remove: () => undefined }),
}));

import {
  H_FOV,
  RAD,
  bearingOf,
  coverageBands,
  directionOfObservation,
  screenOf,
  screenXOf,
  signedRad,
  toDegrees,
  verticalFov,
  wrapRad,
} from './pose';

const VIEW = { width: 390, height: 844 };
const LEVEL = { yaw: 0, pitch: 0 };

const deg = (d: number): number => d * RAD;
const panels = (...covered: number[]): boolean[] =>
  Array.from({ length: 36 }, (_, i) => covered.includes(i));

describe('wrapRad / signedRad', () => {
  it('wraps into [0, 2PI) and collapses the non-finite to zero', () => {
    expect(wrapRad(0)).toBe(0);
    expect(wrapRad(Math.PI * 2)).toBeCloseTo(0, 12);
    expect(wrapRad(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2, 12);
    expect(wrapRad(Number.NaN)).toBe(0);
    expect(wrapRad(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('takes the short way round, so 359 degrees to 1 is a +2 degree turn', () => {
    expect(signedRad(deg(2))).toBeCloseTo(deg(2), 12);
    expect(signedRad(deg(358))).toBeCloseTo(deg(-2), 12);
    expect(signedRad(Math.PI)).toBeCloseTo(Math.PI, 12);
  });

  it('converts back to the degrees the capture machine and the API speak', () => {
    expect(toDegrees(deg(270))).toBeCloseTo(270, 9);
    expect(toDegrees(deg(-90))).toBeCloseTo(270, 9);
  });
});

describe('verticalFov', () => {
  it('is taller than the horizontal field on a portrait phone', () => {
    expect(verticalFov(VIEW)).toBeGreaterThan(H_FOV);
  });

  it('equals the horizontal field on a square viewport, and degrades safely', () => {
    expect(verticalFov({ width: 100, height: 100 })).toBeCloseTo(H_FOV, 12);
    expect(verticalFov({ width: 0, height: 0 })).toBe(H_FOV);
  });
});

describe('bearingOf', () => {
  it('maps the centre of the screen to where the phone points', () => {
    const d = bearingOf(VIEW.width / 2, VIEW.height / 2, VIEW, { yaw: deg(140), pitch: deg(-8) });
    expect(toDegrees(d.bearing)).toBeCloseTo(140, 9);
    expect(d.elevation).toBeCloseTo(deg(-8), 12);
  });

  it('puts the right edge half a field of view to the right, through the tangent', () => {
    const d = bearingOf(VIEW.width, VIEW.height / 2, VIEW, LEVEL);
    expect(toDegrees(d.bearing)).toBeCloseTo(30, 9);
  });

  it('reads a point below the centre as below the horizon', () => {
    expect(bearingOf(VIEW.width / 2, VIEW.height, VIEW, LEVEL).elevation).toBeLessThan(0);
    expect(bearingOf(VIEW.width / 2, 0, VIEW, LEVEL).elevation).toBeGreaterThan(0);
  });

  it('survives a viewport with no size', () => {
    const d = bearingOf(10, 10, { width: 0, height: 0 }, { yaw: deg(90), pitch: 0 });
    expect(toDegrees(d.bearing)).toBeCloseTo(90, 9);
  });
});

describe('screenOf', () => {
  it('is the exact inverse of bearingOf', () => {
    for (const [x, y] of [
      [VIEW.width / 2, VIEW.height / 2],
      [40, 120],
      [VIEW.width - 20, VIEW.height - 90],
    ] as const) {
      const pose = { yaw: deg(37), pitch: deg(5) };
      const back = screenOf(bearingOf(x, y, VIEW, pose), VIEW, pose);
      expect(back.visible).toBe(true);
      expect(back.x).toBeCloseTo(x, 6);
      expect(back.y).toBeCloseTo(y, 6);
    }
  });

  it('never draws anything behind the phone', () => {
    expect(screenOf({ bearing: deg(180), elevation: 0 }, VIEW, LEVEL).visible).toBe(false);
    expect(screenOf({ bearing: deg(90), elevation: 0 }, VIEW, LEVEL).visible).toBe(false);
    expect(screenOf({ bearing: 0, elevation: deg(-91) }, VIEW, LEVEL).visible).toBe(false);
  });

  it('wraps across zero without jumping to the far wall', () => {
    const at = screenOf({ bearing: deg(1), elevation: 0 }, VIEW, { yaw: deg(359), pitch: 0 });
    expect(at.visible).toBe(true);
    expect(at.x).toBeGreaterThan(VIEW.width / 2);
  });
});

describe('screenXOf', () => {
  it('centres the bearing the phone is pointing at', () => {
    expect(screenXOf(deg(200), VIEW, deg(200))).toBeCloseTo(VIEW.width / 2, 9);
  });

  it('is null off to the side, so a band is never painted behind you', () => {
    expect(screenXOf(deg(120), VIEW, 0)).toBeNull();
    expect(screenXOf(deg(240), VIEW, 0)).toBeNull();
  });
});

describe('directionOfObservation', () => {
  it('keeps the bearing the API already computed', () => {
    const d = directionOfObservation(345, null, VIEW);
    expect(toDegrees(d.bearing)).toBeCloseTo(345, 9);
    expect(d.elevation).toBe(0);
  });

  it('reads elevation off the vertical centre of box_2d', () => {
    // [y0, x0, y1, x1] in 0..1000. A box in the top third looks up.
    const high = directionOfObservation(0, [100, 400, 300, 600], VIEW);
    const low = directionOfObservation(0, [700, 400, 900, 600], VIEW);
    expect(high.elevation).toBeGreaterThan(0);
    expect(low.elevation).toBeLessThan(0);
    // A box centred vertically is on the frame's own horizon.
    expect(directionOfObservation(0, [400, 0, 600, 1000], VIEW).elevation).toBeCloseTo(0, 12);
  });

  it('adds the pitch the frame was taken at', () => {
    const level = directionOfObservation(0, [400, 0, 600, 1000], VIEW, 0);
    const tilted = directionOfObservation(0, [400, 0, 600, 1000], VIEW, deg(20));
    expect(tilted.elevation - level.elevation).toBeCloseTo(deg(20), 12);
  });
});

describe('coverageBands', () => {
  it('draws only the covered panels that are in front of you', () => {
    // Panel 0 is [0, 10) degrees, panel 18 is the wall behind.
    const bands = coverageBands(panels(0, 1, 18), VIEW, 0);
    expect(bands.map((b) => b.key)).toEqual([0, 1]);
    for (const b of bands) expect(b.width).toBeGreaterThan(0);
  });

  it('widens a band toward the edge of the frame, as the wall does', () => {
    const [centre] = coverageBands(panels(0), VIEW, deg(5));
    const [edge] = coverageBands(panels(0), VIEW, deg(25));
    expect(centre).toBeDefined();
    expect(edge).toBeDefined();
    expect(edge!.width).toBeGreaterThan(centre!.width);
  });

  it('paints nothing on an empty sweep or a viewport with no width', () => {
    expect(coverageBands(panels(), VIEW, 0)).toEqual([]);
    expect(coverageBands(panels(0), { width: 0, height: 0 }, 0)).toEqual([]);
  });

  it('follows the phone round, so a band stays on its own wall', () => {
    const ahead = coverageBands(panels(9), VIEW, deg(95));
    expect(ahead).toHaveLength(1);
    expect(coverageBands(panels(9), VIEW, deg(275))).toHaveLength(0);
  });
});
