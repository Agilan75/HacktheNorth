/**
 * `useWorldPose` from DeviceMotion and the compass. The Expo Go path: both are
 * bundled into Expo Go for SDK 57, so this needs no native build.
 *
 * Yaw is a complementary filter. DeviceMotion supplies the fast part at 60 Hz,
 * integrated from the CHANGE in `rotation.alpha` rather than its value, because
 * alpha's absolute reference frame is not the same on the two platforms: iOS
 * hands back a `CMAttitude` that can silently fall back to an arbitrary
 * reference, and Android hands back a sign-normalised azimuth. A delta is the
 * same on both. `expo-location`'s compass supplies the slow part, pulling the
 * accumulated yaw back toward magnetic north a little on every reading, which
 * is what stops the drift that integration alone would accumulate.
 *
 * `rotation.{alpha,beta,gamma}` are radians on both platforms and Android
 * already normalises their signs, so nothing here branches on platform.
 * `rotationRate` is deliberately not used: its axis mapping DOES differ per
 * platform (iOS alpha=z,beta=y,gamma=x; Android alpha=x,beta=y,gamma=z).
 *
 * Rotation-locked only. The app is portrait-locked (`app.json`), so screen
 * rotation never enters the frame.
 */
import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { DeviceMotion } from 'expo-sensors';

// Relative, not the `@/` alias: this module is pulled into the node test run,
// where only the bundler resolves that alias.
import { angularDistance, headingFromReading, normalizeDeg, signedDelta } from '../lib/heading';
import type { WorldPose } from './pose';

/** 60 Hz. DeviceMotion takes milliseconds. */
export const POSE_INTERVAL_MS = 1000 / 60;

/**
 * Share of the compass correction applied per reading. `watchHeadingAsync`
 * delivers a few readings a second, so 0.08 pulls the integrated yaw onto the
 * compass over about a second without the needle's jitter showing as shake.
 */
export const COMPASS_GAIN = 0.08;

/**
 * A single sample further than this from the running yaw is a compass
 * glitch, not a turn, and is snapped to rather than blended in.
 */
const COMPASS_SNAP_DEG = 90;

/** Below this change in radians a new sample is not worth a re-render. */
const EPSILON = 0.002;

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const TWO_PI = Math.PI * 2;

function wrap(rad: number): number {
  if (!Number.isFinite(rad)) return 0;
  const r = rad % TWO_PI;
  return r < 0 ? r + TWO_PI : r;
}

function clampPitch(rad: number): number {
  if (!Number.isFinite(rad)) return 0;
  return Math.min(Math.PI / 2, Math.max(-Math.PI / 2, rad));
}

function changed(a: WorldPose, b: WorldPose): boolean {
  if (a.ready !== b.ready) return true;
  return (
    Math.abs(signedDelta(a.yaw * DEG, b.yaw * DEG)) * RAD > EPSILON ||
    Math.abs(a.pitch - b.pitch) > EPSILON ||
    Math.abs(a.roll - b.roll) > EPSILON
  );
}

const IDLE: WorldPose = { yaw: 0, pitch: 0, roll: 0, ready: false };

/**
 * The gyro pose. `enabled` false unsubscribes from both sensors, so the sweep
 * screen can stop them the moment it stops sweeping.
 */
export function useGyroPose(enabled = true): WorldPose {
  const [pose, setPose] = useState<WorldPose>(IDLE);

  /** Everything the two callbacks share. A ref, so neither resubscribes. */
  const state = useRef({
    /** Absolute yaw in degrees, the frame the compass speaks. */
    yawDeg: null as number | null,
    /** Yaw at the first reading, so the pose is relative to the sweep start. */
    startDeg: null as number | null,
    /** Previous `rotation.alpha` in degrees, for the delta. */
    lastAlphaDeg: null as number | null,
    pitch: 0,
    roll: 0,
    published: IDLE,
  });

  useEffect(() => {
    if (!enabled) {
      setPose(IDLE);
      state.current = { yawDeg: null, startDeg: null, lastAlphaDeg: null, pitch: 0, roll: 0, published: IDLE };
      return undefined;
    }

    let cancelled = false;

    const publish = (): void => {
      const s = state.current;
      if (cancelled || s.yawDeg === null || s.startDeg === null) return;
      const next: WorldPose = {
        yaw: wrap(normalizeDeg(s.yawDeg - s.startDeg) * RAD),
        pitch: s.pitch,
        roll: s.roll,
        ready: true,
      };
      if (!changed(s.published, next)) return;
      s.published = next;
      setPose(next);
    };

    /* ----------------------------- DeviceMotion ---------------------------- */

    let motion: { remove(): void } | null = null;
    try {
      DeviceMotion.setUpdateInterval(POSE_INTERVAL_MS);
      motion = DeviceMotion.addListener((m) => {
        const r = m.rotation;
        if (!r) return;
        const s = state.current;

        if (typeof r.beta === 'number' && Number.isFinite(r.beta)) {
          // beta is PI/2 with the phone held upright, 0 flat on its back.
          s.pitch = clampPitch(r.beta - Math.PI / 2);
        }
        if (typeof r.gamma === 'number' && Number.isFinite(r.gamma)) s.roll = r.gamma;

        if (typeof r.alpha === 'number' && Number.isFinite(r.alpha)) {
          const alphaDeg = normalizeDeg(r.alpha * DEG);
          if (s.lastAlphaDeg !== null && s.yawDeg !== null) {
            // The fast half: integrate the turn, never alpha's own zero.
            s.yawDeg = normalizeDeg(s.yawDeg + signedDelta(s.lastAlphaDeg, alphaDeg));
          }
          s.lastAlphaDeg = alphaDeg;
        }
        publish();
      });
    } catch {
      motion = null;
    }

    /* -------------------------------- compass ------------------------------ */

    let heading: Location.LocationSubscription | null = null;
    Location.watchHeadingAsync((reading) => {
      if (cancelled) return;
      // Magnetic first, then true: bearings are relative to the sweep's start,
      // so declination does not matter, and mixing the two mid-sweep would jump.
      const compassDeg = headingFromReading(reading);
      if (compassDeg === null) return;
      const s = state.current;

      if (s.yawDeg === null) {
        // First fix: it seeds both the absolute yaw and the sweep's own zero.
        s.yawDeg = compassDeg;
        s.startDeg = compassDeg;
      } else if (angularDistance(s.yawDeg, compassDeg) > COMPASS_SNAP_DEG) {
        s.yawDeg = compassDeg;
      } else {
        // The slow half: a small pull toward north, which is what kills drift.
        s.yawDeg = normalizeDeg(s.yawDeg + COMPASS_GAIN * signedDelta(s.yawDeg, compassDeg));
      }
      publish();
    })
      .then((sub) => {
        if (cancelled) sub.remove();
        else heading = sub;
      })
      .catch(() => {
        // No compass: DeviceMotion alone still gives a usable relative yaw, so
        // seed the frame from the first motion sample instead of stalling.
        const s = state.current;
        if (s.yawDeg === null) {
          s.yawDeg = 0;
          s.startDeg = 0;
        }
        publish();
      });

    return () => {
      cancelled = true;
      motion?.remove();
      heading?.remove();
    };
  }, [enabled]);

  return pose;
}
