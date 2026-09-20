/**
 * Compass heading helpers for the room sweep (PRD §11, §16 "compass noise").
 *
 * Pure: no React Native, no Expo import. Runs in node under vitest.
 *
 * The smoothing that used to live here is now the complementary filter in
 * `src/ar/pose.gyro.ts`, which blends the compass with the motion sensor.
 *
 * Angles are degrees clockwise in [0, 360). Every subtraction goes through
 * `signedDelta`, so 359° -> 1° is a +2° step, never a -358° one.
 */

export const FULL_CIRCLE = 360;

/** Wraps any finite angle into [0, 360). */
export function normalizeDeg(deg: number): number {
  const r = deg % FULL_CIRCLE;
  const n = r < 0 ? r + FULL_CIRCLE : r;
  // -0 and floating 360 both collapse to 0.
  return n >= FULL_CIRCLE || Object.is(n, -0) ? 0 : n;
}

/** Shortest signed rotation from `fromDeg` to `toDeg`, in (-180, 180]. Positive = clockwise. */
export function signedDelta(fromDeg: number, toDeg: number): number {
  const d = normalizeDeg(toDeg - fromDeg);
  return d > 180 ? d - FULL_CIRCLE : d;
}

/** Unsigned shortest angular distance, in [0, 180]. */
export function angularDistance(aDeg: number, bDeg: number): number {
  return Math.abs(signedDelta(aDeg, bDeg));
}

/**
 * Structural copy of expo-location's `LocationHeadingObject`, so this module
 * stays free of Expo imports.
 */
export interface HeadingReading {
  readonly trueHeading: number;
  readonly magHeading: number;
  readonly accuracy?: number;
}

function isValidHeading(v: number): boolean {
  return Number.isFinite(v) && v >= 0;
}

/**
 * The one heading value used from a `watchHeadingAsync` reading.
 *
 * Magnetic heading first: bearings are relative to the sweep start, so
 * declination does not matter, and `trueHeading` is -1 whenever location
 * permission is missing. Mixing the two mid-sweep would jump by the local
 * declination, so the choice is fixed: mag, then true, else null.
 */
export function headingFromReading(reading: HeadingReading): number | null {
  if (isValidHeading(reading.magHeading)) return normalizeDeg(reading.magHeading);
  if (isValidHeading(reading.trueHeading)) return normalizeDeg(reading.trueHeading);
  return null;
}
