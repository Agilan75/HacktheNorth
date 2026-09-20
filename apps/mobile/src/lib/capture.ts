/**
 * The /sweep capture loop as a pure reducer (PRD §11).
 *
 *   - Auto-capture once BOTH gates pass: ~1.2 s since the last capture and the
 *     heading has moved >= 10° from where the last frame was taken.
 *   - At most 15 frames.
 *   - Coverage: 36 panels of 10°. A panel fills when the (filtered) heading
 *     passes through it, not only where a frame was shot, so the ring keeps
 *     filling after the 15-frame cap.
 *   - Finish is allowed at >= 25% coverage (9 of 36 panels) and >= 1 frame.
 *   - The largest uncovered arc and the shorter way to turn toward it.
 *
 * All bearings are RELATIVE to the heading at sweep start (0° = where the
 * user started), which is what `SweepCreateRequestDto.frames[].bearingDeg`
 * means. Absolute compass headings stay inside this module.
 *
 * Pure: no React Native, no Expo import. Use it with `useReducer(captureReducer, initialCaptureState)`.
 * The coverage here only gates the Finish button and drives the ring; the API
 * computes the coverage that counts from the frames it receives.
 */

import { angularDistance, normalizeDeg, signedDelta } from './heading';

export const CAPTURE_INTERVAL_MS = 1200;
export const MIN_ADVANCE_DEG = 10;
export const MAX_FRAMES = 15;
export const PANEL_COUNT = 36;
export const PANEL_WIDTH_DEG = 10;
export const FINISH_COVERAGE_PCT = 25;
/**
 * A heading step larger than this between two samples is treated as a compass
 * glitch, not a turn: only the landing panel fills, nothing in between.
 */
export const MAX_FILL_STEP_DEG = 60;

export type CapturePhase = 'idle' | 'sweeping' | 'finished';

export interface PendingCapture {
  /** 0-based index the frame will get. */
  readonly index: number;
  /** Relative bearing at the moment the capture was requested. */
  readonly bearingDeg: number;
  readonly requestedAtMs: number;
}

export interface CapturedFrame {
  readonly index: number;
  readonly bearingDeg: number;
  readonly requestedAtMs: number;
  readonly capturedAtMs: number;
  /** Local file URI (or any handle the screen chose). Optional. */
  readonly ref: string | null;
}

export interface CaptureState {
  readonly phase: CapturePhase;
  /** Absolute filtered heading at the first sample of the sweep. */
  readonly startHeadingDeg: number | null;
  /** Current relative bearing, 0..360. */
  readonly bearingDeg: number | null;
  /** 36 panels, relative to the start heading; panel p covers [10p, 10p + 10). */
  readonly panels: readonly boolean[];
  readonly frames: readonly CapturedFrame[];
  /** Non-null while the screen is taking a picture the machine asked for. */
  readonly pending: PendingCapture | null;
  readonly lastCaptureAtMs: number | null;
  readonly lastCaptureBearingDeg: number | null;
}

export type CaptureEvent =
  | { readonly type: 'start' }
  /** A filtered ABSOLUTE compass heading and the time it was read. */
  | { readonly type: 'heading'; readonly headingDeg: number; readonly atMs: number }
  /** The picture requested in `pending` was taken. */
  | { readonly type: 'captured'; readonly atMs: number; readonly ref?: string | null }
  /** The picture requested in `pending` failed; the next heading sample retries. */
  | { readonly type: 'captureFailed' }
  | { readonly type: 'finish' }
  | { readonly type: 'reset' };

const emptyPanels = (): boolean[] => Array.from({ length: PANEL_COUNT }, () => false);

export const initialCaptureState: CaptureState = Object.freeze({
  phase: 'idle',
  startHeadingDeg: null,
  bearingDeg: null,
  panels: Object.freeze(emptyPanels()),
  frames: Object.freeze([]) as readonly CapturedFrame[],
  pending: null,
  lastCaptureAtMs: null,
  lastCaptureBearingDeg: null,
}) as CaptureState;

/** The panel index a relative bearing falls in, 0..35. */
export function panelForBearing(bearingDeg: number): number {
  const p = Math.floor(normalizeDeg(bearingDeg) / PANEL_WIDTH_DEG);
  return Math.min(Math.max(p, 0), PANEL_COUNT - 1);
}

/** Marks every panel the heading passed through going from `fromDeg` to `toDeg` the short way. */
function fillPath(panels: readonly boolean[], fromDeg: number | null, toDeg: number): boolean[] {
  const next = panels.slice();
  next[panelForBearing(toDeg)] = true;
  if (fromDeg === null) return next;
  const d = signedDelta(fromDeg, toDeg);
  if (Math.abs(d) > MAX_FILL_STEP_DEG) return next;
  const steps = Math.ceil(Math.abs(d));
  for (let i = 0; i <= steps; i++) {
    next[panelForBearing(fromDeg + (steps === 0 ? 0 : (d * i) / steps))] = true;
  }
  return next;
}

/** Why the machine is or is not asking for a frame right now. */
export type CaptureGate = 'ready' | 'not-sweeping' | 'pending' | 'cap-reached' | 'too-soon' | 'not-turned';

export function captureGate(state: CaptureState, atMs: number): CaptureGate {
  if (state.phase !== 'sweeping' || state.bearingDeg === null) return 'not-sweeping';
  if (state.pending) return 'pending';
  if (state.frames.length >= MAX_FRAMES) return 'cap-reached';
  if (state.lastCaptureAtMs !== null && atMs - state.lastCaptureAtMs < CAPTURE_INTERVAL_MS) return 'too-soon';
  if (
    state.lastCaptureBearingDeg !== null &&
    angularDistance(state.lastCaptureBearingDeg, state.bearingDeg) < MIN_ADVANCE_DEG
  ) {
    return 'not-turned';
  }
  return 'ready';
}

export function captureReducer(state: CaptureState, event: CaptureEvent): CaptureState {
  switch (event.type) {
    case 'reset':
      return initialCaptureState;

    case 'start':
      return { ...initialCaptureState, phase: 'sweeping' };

    case 'heading': {
      if (state.phase !== 'sweeping' || !Number.isFinite(event.headingDeg) || !Number.isFinite(event.atMs)) {
        return state;
      }
      const heading = normalizeDeg(event.headingDeg);
      const startHeadingDeg = state.startHeadingDeg ?? heading;
      const bearingDeg = normalizeDeg(heading - startHeadingDeg);
      const moved: CaptureState = {
        ...state,
        startHeadingDeg,
        bearingDeg,
        panels: fillPath(state.panels, state.bearingDeg, bearingDeg),
      };
      if (captureGate(moved, event.atMs) !== 'ready') return moved;
      return {
        ...moved,
        pending: { index: moved.frames.length, bearingDeg, requestedAtMs: event.atMs },
      };
    }

    case 'captured': {
      const p = state.pending;
      if (!p || state.frames.length >= MAX_FRAMES) return { ...state, pending: null };
      const frame: CapturedFrame = {
        index: p.index,
        bearingDeg: p.bearingDeg,
        requestedAtMs: p.requestedAtMs,
        capturedAtMs: event.atMs,
        ref: event.ref ?? null,
      };
      return {
        ...state,
        frames: [...state.frames, frame],
        pending: null,
        lastCaptureAtMs: p.requestedAtMs,
        lastCaptureBearingDeg: p.bearingDeg,
      };
    }

    case 'captureFailed':
      return state.pending ? { ...state, pending: null } : state;

    case 'finish':
      return state.phase === 'sweeping' && canFinish(state) ? { ...state, phase: 'finished' } : state;
  }
}

/* -------------------------------------------------------------------------- */
/* Coverage                                                                   */
/* -------------------------------------------------------------------------- */

export function coveredPanelCount(panels: readonly boolean[]): number {
  return panels.reduce((n, p) => (p ? n + 1 : n), 0);
}

/** Exact percentage 0..100. */
export function coveragePct(panels: readonly boolean[]): number {
  return (coveredPanelCount(panels) * 100) / PANEL_COUNT;
}

/** Integer comparison, so 27/36 is exactly 75% with no float drift. */
export function meetsFinishCoverage(panels: readonly boolean[]): boolean {
  return coveredPanelCount(panels) * 100 >= FINISH_COVERAGE_PCT * PANEL_COUNT;
}

export function canFinish(state: CaptureState): boolean {
  return state.frames.length >= 1 && meetsFinishCoverage(state.panels);
}

export interface UncoveredArc {
  /** Relative bearing where the arc starts (a panel edge). */
  readonly startDeg: number;
  /** Multiple of 10, 10..360. */
  readonly widthDeg: number;
  readonly centerDeg: number;
  readonly panelCount: number;
}

/**
 * The widest run of uncovered panels, wrapping across 350°→0°.
 * Null when every panel is covered. Ties go to the run starting at the lowest panel.
 */
export function largestUncoveredArc(panels: readonly boolean[]): UncoveredArc | null {
  const n = panels.length;
  const covered = coveredPanelCount(panels);
  if (covered === n) return null;
  const arc = (startPanel: number, count: number): UncoveredArc => {
    const startDeg = startPanel * PANEL_WIDTH_DEG;
    const widthDeg = count * PANEL_WIDTH_DEG;
    return { startDeg, widthDeg, centerDeg: normalizeDeg(startDeg + widthDeg / 2), panelCount: count };
  };
  if (covered === 0) return arc(0, n);

  let best: { start: number; count: number } | null = null;
  for (let s = 0; s < n; s++) {
    // A run starts at an uncovered panel whose predecessor (circularly) is covered.
    if (panels[s] || !panels[(s - 1 + n) % n]) continue;
    let count = 0;
    while (!panels[(s + count) % n]) count++;
    if (!best || count > best.count) best = { start: s, count };
  }
  // covered is strictly between 0 and n, so at least one run exists.
  return best ? arc(best.start, best.count) : null;
}

export type TurnDirection = 'left' | 'right';

export interface TurnAdvice {
  readonly direction: TurnDirection;
  /** Degrees to the nearer edge of the largest gap, rounded. */
  readonly degrees: number;
  readonly gap: UncoveredArc;
}

/**
 * Which way to turn to reach the largest uncovered arc: toward whichever of
 * its two edges is closer. Right = clockwise. Null when nothing is left or
 * there is no bearing yet.
 */
export function turnAdvice(panels: readonly boolean[], bearingDeg: number | null): TurnAdvice | null {
  const gap = largestUncoveredArc(panels);
  if (!gap || bearingDeg === null) return null;
  const cur = normalizeDeg(bearingDeg);
  const endDeg = gap.startDeg + gap.widthDeg;
  const clockwise = normalizeDeg(gap.startDeg - cur);
  const counter = normalizeDeg(cur - endDeg);
  // Already inside the gap (the heading marks its own panel, so only a sub-panel edge case).
  if (gap.widthDeg >= 360 || normalizeDeg(cur - gap.startDeg) < gap.widthDeg) {
    return { direction: 'right', degrees: 0, gap };
  }
  return clockwise <= counter
    ? { direction: 'right', degrees: Math.round(clockwise), gap }
    : { direction: 'left', degrees: Math.round(counter), gap };
}

export interface CaptureSummary {
  readonly coveredPanels: number;
  /** Exact 0..100. */
  readonly coveragePct: number;
  /** Rounded down for display, so the UI never shows "75%" while Finish is still locked. */
  readonly coveragePctDisplay: number;
  readonly canFinish: boolean;
  readonly frameCount: number;
  readonly framesLeft: number;
  readonly capReached: boolean;
  readonly largestGap: UncoveredArc | null;
  readonly turn: TurnAdvice | null;
  /** Plain-language status line for the screen and for VoiceOver announcements. */
  readonly hint: string;
}

export function summarize(state: CaptureState): CaptureSummary {
  const coveredPanels = coveredPanelCount(state.panels);
  const pct = coveragePct(state.panels);
  const turn = turnAdvice(state.panels, state.bearingDeg);
  const summary = {
    coveredPanels,
    coveragePct: pct,
    coveragePctDisplay: Math.floor(pct + 1e-9),
    canFinish: canFinish(state),
    frameCount: state.frames.length,
    framesLeft: Math.max(0, MAX_FRAMES - state.frames.length),
    capReached: state.frames.length >= MAX_FRAMES,
    largestGap: largestUncoveredArc(state.panels),
    turn,
  };
  return { ...summary, hint: turnHint(summary, state.phase) };
}

/** Plain-language hint. No colour words, no jargon. */
export function turnHint(
  s: Pick<CaptureSummary, 'coveragePctDisplay' | 'canFinish' | 'turn' | 'coveredPanels'>,
  phase: CapturePhase,
): string {
  if (phase === 'idle') return 'Hold your phone upright and slowly turn in a circle.';
  if (phase === 'finished') return 'Scan finished.';
  if (s.coveredPanels === PANEL_COUNT) return 'You have scanned the whole room. Tap Finish.';
  const pct = `${s.coveragePctDisplay}% of the room scanned.`;
  if (!s.turn) return `${pct} Slowly turn in a circle.`;
  const where = s.turn.degrees <= 5 ? 'Keep turning slowly' : `Turn ${s.turn.direction} about ${s.turn.degrees} degrees`;
  return s.canFinish
    ? `${pct} You can finish now, or ${where.charAt(0).toLowerCase()}${where.slice(1)} to fill the gap.`
    : `${pct} ${where} to keep scanning.`;
}

/* -------------------------------------------------------------------------- */
/* Photo-upload path                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Bearings for photos picked from the library instead of a sweep: evenly
 * spaced around the room in the order picked. 3 photos -> 0, 120, 240 (PRD §11).
 * Returns at most MAX_FRAMES bearings.
 */
export function uploadBearings(count: number): number[] {
  const n = Math.min(Math.max(0, Math.floor(count)), MAX_FRAMES);
  return Array.from({ length: n }, (_, i) => (i * 360) / n);
}
