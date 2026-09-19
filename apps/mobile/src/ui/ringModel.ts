/**
 * ScanRing model — pure, no React Native. Unit M3.
 *
 * Everything the 2D coverage ring needs that can be tested in node: which
 * 10-degree segment a heading falls in, the covered percentage, which way to
 * turn next, the sentence a screen reader hears, and the SVG path strings the
 * Skia canvas draws. `ScanRing.tsx` only renders what this file returns.
 *
 * Geometry convention (same as the engine's sweep geometry): bearings are
 * degrees clockwise, segment `i` covers `[10i, 10i + 10)`, and bearing 0 is
 * drawn at the top of the ring. On screen, x = cx + r·sin(θ), y = cy − r·cos(θ).
 *
 * The coverage percentage shown during a sweep is a progress readout for the
 * person holding the phone, not an underwriting number. When the API has
 * returned a `CoverageResult`, callers pass its `coveragePct` and it wins.
 */

export const SEGMENT_COUNT = 36;
export const SEGMENT_DEG = 360 / SEGMENT_COUNT;
/** PRD §11: Finish is offered at 75% coverage. */
export const DEFAULT_FINISH_PCT = 75;

export type TurnDirection = 'left' | 'right' | 'none';

export interface RingSummary {
  /** Whole percent, floored so 74.9 never reads as 75. */
  readonly percent: number;
  readonly coveredCount: number;
  readonly complete: boolean;
  readonly canFinish: boolean;
  /** Which way to turn to reach the nearest unscanned segment. */
  readonly direction: TurnDirection;
  /** Rough turn, rounded to 10 degrees; 0 when `direction` is 'none'. */
  readonly turnDeg: number;
  /** True when the phone already points at an unscanned segment. */
  readonly onUncovered: boolean;
  /** The plain-language sentence for screen readers and the on-screen hint. */
  readonly text: string;
  /** The short on-screen hint (the second half of `text`). */
  readonly hint: string;
}

export interface RingSummaryInput {
  readonly panels: readonly boolean[];
  /** Current heading in the same frame as `panels`; null when unknown. */
  readonly headingDeg: number | null;
  /** Authoritative percentage from the API, when there is one. */
  readonly coveragePct?: number | null;
  /** Coverage at which Finish is allowed. */
  readonly finishPct?: number;
  /** Optional plain name for the unscanned part, e.g. "the window side". */
  readonly gapName?: string | null;
}

/* -------------------------------------------------------------------------- */
/* Segments                                                                   */
/* -------------------------------------------------------------------------- */

/** Any angle to [0, 360). Non-finite returns 0. */
export function normalizeDegrees(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const r = deg % 360;
  return (r < 0 ? r + 360 : r) + 0;
}

/** The segment a heading falls in, 0..35. */
export function segmentForHeading(headingDeg: number): number {
  const s = Math.floor(normalizeDegrees(headingDeg) / SEGMENT_DEG);
  return s >= SEGMENT_COUNT ? SEGMENT_COUNT - 1 : s;
}

/** Coerce any panel list to exactly 36 booleans (missing entries = not scanned). */
export function normalizePanels(panels: readonly boolean[] | null | undefined): boolean[] {
  return Array.from({ length: SEGMENT_COUNT }, (_, i) => panels?.[i] === true);
}

/** A copy of `panels` with the heading's segment marked covered. */
export function markCovered(panels: readonly boolean[], headingDeg: number): boolean[] {
  const next = normalizePanels(panels);
  if (Number.isFinite(headingDeg)) next[segmentForHeading(headingDeg)] = true;
  return next;
}

/** Whole percent of segments covered, floored; or the API value when given. */
export function coveredPercent(panels: readonly boolean[], coveragePct?: number | null): number {
  if (coveragePct !== undefined && coveragePct !== null && Number.isFinite(coveragePct)) {
    return clampPct(Math.floor(coveragePct + 1e-9));
  }
  const n = normalizePanels(panels).filter(Boolean).length;
  return clampPct(Math.floor((n * 100) / SEGMENT_COUNT + 1e-9));
}

function clampPct(p: number): number {
  return Math.min(100, Math.max(0, p));
}

/**
 * Signed shortest turn from the heading to the nearest unscanned segment's
 * centre: positive = clockwise (turn right), negative = anticlockwise (left).
 * Ties go clockwise, the natural direction of a sweep. Null when all covered.
 */
export function nearestGapTurn(panels: readonly boolean[], headingDeg: number): number | null {
  const p = normalizePanels(panels);
  const h = normalizeDegrees(headingDeg);
  let best: number | null = null;
  for (let i = 0; i < SEGMENT_COUNT; i++) {
    if (p[i]) continue;
    const centre = i * SEGMENT_DEG + SEGMENT_DEG / 2;
    let d = normalizeDegrees(centre - h);
    if (d > 180) d -= 360;
    if (best === null || Math.abs(d) < Math.abs(best) || (Math.abs(d) === Math.abs(best) && d > 0)) {
      best = d;
    }
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/* The sentence                                                               */
/* -------------------------------------------------------------------------- */

export function ringSummary(input: RingSummaryInput): RingSummary {
  const panels = normalizePanels(input.panels);
  const coveredCount = panels.filter(Boolean).length;
  const percent = coveredPercent(panels, input.coveragePct);
  const finishPct = input.finishPct ?? DEFAULT_FINISH_PCT;
  const complete = coveredCount === SEGMENT_COUNT || percent >= 100;
  const canFinish = percent >= finishPct;
  const target = input.gapName ? input.gapName.trim() : '';
  const toCover = target.length > 0 ? `to cover ${target}` : 'to cover the part you have not scanned yet';

  let direction: TurnDirection = 'none';
  let turnDeg = 0;
  let onUncovered = false;
  let hint: string;

  const heading = input.headingDeg;
  if (complete) {
    hint = 'The whole room is scanned.';
  } else if (heading === null || !Number.isFinite(heading)) {
    hint = 'Turn slowly on the spot to scan the rest of the room.';
  } else if (!panels[segmentForHeading(heading)]) {
    onUncovered = true;
    hint = 'Hold steady and keep turning slowly. This part is being scanned now.';
  } else {
    const turn = nearestGapTurn(panels, heading) ?? 0;
    direction = turn > 0 ? 'right' : 'left';
    turnDeg = Math.max(SEGMENT_DEG, Math.round(Math.abs(turn) / SEGMENT_DEG) * SEGMENT_DEG);
    hint = `Turn ${direction} about ${turnDeg} degrees ${toCover}.`;
  }

  if (canFinish && !complete) hint += ' You have scanned enough to finish.';

  const text = `${percent} percent of the room scanned. ${hint}`;
  return { percent, coveredCount, complete, canFinish, direction, turnDeg, onUncovered, text, hint };
}

/* -------------------------------------------------------------------------- */
/* Drawing geometry (SVG path strings; Skia's <Path> accepts them)            */
/* -------------------------------------------------------------------------- */

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A point on the ring at a bearing, in screen coordinates (y grows down). */
export function polarPoint(cx: number, cy: number, r: number, bearingDeg: number): Point {
  const rad = (normalizeDegrees(bearingDeg) * Math.PI) / 180;
  return { x: round3(cx + r * Math.sin(rad)), y: round3(cy - r * Math.cos(rad)) };
}

function round3(n: number): number {
  const v = Math.round(n * 1000) / 1000;
  return v === 0 ? 0 : v;
}

/**
 * SVG path for segment `index` as an annular sector between `innerR` and
 * `outerR`, with `gapDeg` of empty space split across its two edges so the 36
 * segments read as separate tiles.
 */
export function segmentPath(
  index: number,
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  gapDeg = 1.5,
): string {
  const i = ((Math.trunc(index) % SEGMENT_COUNT) + SEGMENT_COUNT) % SEGMENT_COUNT;
  const half = Math.min(Math.max(gapDeg, 0), SEGMENT_DEG - 0.5) / 2;
  const a0 = i * SEGMENT_DEG + half;
  const a1 = (i + 1) * SEGMENT_DEG - half;
  const o0 = polarPoint(cx, cy, outerR, a0);
  const o1 = polarPoint(cx, cy, outerR, a1);
  const i1 = polarPoint(cx, cy, innerR, a1);
  const i0 = polarPoint(cx, cy, innerR, a0);
  return [
    `M ${o0.x} ${o0.y}`,
    `A ${outerR} ${outerR} 0 0 1 ${o1.x} ${o1.y}`,
    `L ${i1.x} ${i1.y}`,
    `A ${innerR} ${innerR} 0 0 0 ${i0.x} ${i0.y}`,
    'Z',
  ].join(' ');
}

/**
 * SVG path for the heading marker: a triangle outside the ring pointing in at
 * the heading, so the marker is a shape, not a colour.
 */
export function headingMarkerPath(
  cx: number,
  cy: number,
  ringOuterR: number,
  headingDeg: number,
  size = 12,
): string {
  const tip = polarPoint(cx, cy, ringOuterR + 2, headingDeg);
  const spread = (size / 2 / (ringOuterR + size)) * (180 / Math.PI);
  const left = polarPoint(cx, cy, ringOuterR + 2 + size, headingDeg - spread);
  const right = polarPoint(cx, cy, ringOuterR + 2 + size, headingDeg + spread);
  return `M ${tip.x} ${tip.y} L ${left.x} ${left.y} L ${right.x} ${right.y} Z`;
}

/**
 * Where a radar marker sits inside the ring. `radius` is 0..1 of `innerR`
 * (the engine's `DISTANCE_BAND_RADIUS` values fit directly).
 */
export function markerPoint(cx: number, cy: number, innerR: number, bearingDeg: number, radius: number): Point {
  const r = Number.isFinite(radius) ? Math.min(1, Math.max(0, radius)) : 0.65;
  return polarPoint(cx, cy, innerR * r, bearingDeg);
}

/** "on your right, about 90 degrees from where you started" style bearing words. */
export function bearingWords(bearingDeg: number): string {
  const b = Math.round(normalizeDegrees(bearingDeg) / SEGMENT_DEG) * SEGMENT_DEG;
  const deg = b === 360 ? 0 : b;
  if (deg === 0) return 'straight ahead of where you started';
  if (deg === 180) return 'behind where you started';
  return deg < 180
    ? `${deg} degrees to the right of where you started`
    : `${360 - deg} degrees to the left of where you started`;
}
