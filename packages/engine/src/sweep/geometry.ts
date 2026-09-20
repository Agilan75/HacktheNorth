/**
 * Sweep geometry — pure, no I/O. Body owned by Run 1 unit E11.
 *
 * Bearings are degrees clockwise, normalized to [0, 360) by
 * `util/math.normalizeDeg`. The circle is divided into PANEL_COUNT (36) panels
 * of PANEL_WIDTH_DEG (10): panel p covers [10p, 10p + 10).
 *
 * Arc conventions (decision log: docs/decisions/E11.md):
 * - An arc is half-open `[startDeg, startDeg + widthDeg)` going clockwise.
 * - `startDeg` is in [0, 360). `endDeg` is `startDeg + widthDeg` when that does
 *   not pass 360 (so a run ending at north reports `endDeg = 360`), and the
 *   normalized end otherwise, which is the wrapping case `startDeg > endDeg`.
 * - The full circle is `{ startDeg: 0, endDeg: 360, widthDeg: 360 }`.
 * - Arc lists are ordered by `startDeg` ascending.
 */
import {
  ANGLE_TOLERANCE,
  DISTANCE_BAND_RADIUS,
  MIN_COVERAGE_PCT,
  PANEL_COUNT,
  PANEL_WIDTH_DEG,
} from '../constants.js';
import type { CoverageArc, CoverageResult, DistanceBand, Observation, PlacedObject } from '../types.js';
import { angularSeparationDeg, isFiniteNumber, normalizeDeg } from '../util/math.js';

const FULL_CIRCLE = 360;
/** Tolerance used when snapping arc edges and panel boundaries (float noise only). */
const EDGE_EPS = 1e-9;

/* -------------------------------------------------------------------------- */
/* Shared helpers (HELPERS.md)                                                */
/* -------------------------------------------------------------------------- */

/** Normalize any bearing to [0, 360). Non-finite returns 0. */
export function normalizeBearing(deg: number): number {
  // `+ 0` turns the -0 that `normalizeDeg(-360)` yields into +0.
  return normalizeDeg(deg) + 0;
}

/**
 * Signed clockwise delta from `fromDeg` to `toDeg`, in (-180, 180].
 * Positive means `toDeg` is clockwise of `fromDeg`.
 */
export function bearingDelta(fromDeg: number, toDeg: number): number {
  const d = normalizeBearing(toDeg - fromDeg);
  return d > 180 ? d - FULL_CIRCLE : d;
}

/** True when two bearings are within `toleranceDeg` of each other (inclusive). */
export function withinTolerance(aDeg: number, bDeg: number, toleranceDeg: number): boolean {
  return angularSeparationDeg(aDeg, bDeg) <= toleranceDeg + ANGLE_TOLERANCE;
}

/**
 * Keep the first item of every bearing cluster: an item is dropped when it lies
 * within `toleranceDeg` of an already kept item that `sameGroup` accepts.
 * Order-preserving; callers sort first (e.g. by confidence descending) to
 * choose which member of a cluster survives.
 */
export function dedupeByBearing<T extends { readonly bearingDeg: number }>(
  items: readonly T[],
  toleranceDeg: number,
  sameGroup: (a: T, b: T) => boolean = () => true,
): T[] {
  const kept: T[] = [];
  for (const item of items) {
    const dup = kept.some(
      (k) => sameGroup(k, item) && withinTolerance(k.bearingDeg, item.bearingDeg, toleranceDeg),
    );
    if (!dup) kept.push(item);
  }
  return kept;
}

type Interval = { s: number; e: number };

/** Split arcs into linear intervals within [0, 360] and merge them. */
function linearUnion(arcs: readonly Pick<CoverageArc, 'startDeg' | 'widthDeg'>[]): Interval[] {
  const raw: Interval[] = [];
  for (const arc of arcs) {
    if (!isFiniteNumber(arc.startDeg) || !isFiniteNumber(arc.widthDeg)) continue;
    const w = Math.min(arc.widthDeg, FULL_CIRCLE);
    if (w <= EDGE_EPS) continue;
    if (w >= FULL_CIRCLE - EDGE_EPS) return [{ s: 0, e: FULL_CIRCLE }];
    const s = normalizeBearing(arc.startDeg);
    const e = s + w;
    if (e <= FULL_CIRCLE + EDGE_EPS) {
      raw.push({ s, e: Math.min(e, FULL_CIRCLE) });
    } else {
      raw.push({ s, e: FULL_CIRCLE });
      raw.push({ s: 0, e: e - FULL_CIRCLE });
    }
  }
  raw.sort((a, b) => a.s - b.s || a.e - b.e);
  const merged: Interval[] = [];
  for (const iv of raw) {
    const last = merged[merged.length - 1];
    if (last && iv.s <= last.e + EDGE_EPS) {
      if (iv.e > last.e) last.e = iv.e;
    } else {
      merged.push({ s: iv.s, e: iv.e });
    }
  }
  return merged;
}

/** Turn sorted, merged linear intervals into arcs, joining across north. */
function intervalsToArcs(intervals: readonly Interval[]): CoverageArc[] {
  if (intervals.length === 0) return [];
  const first = intervals[0]!;
  if (intervals.length === 1 && first.s <= EDGE_EPS && first.e >= FULL_CIRCLE - EDGE_EPS) {
    return [{ startDeg: 0, endDeg: FULL_CIRCLE, widthDeg: FULL_CIRCLE }];
  }
  const list = intervals.map((iv) => ({ s: iv.s, e: iv.e }));
  let wrap: CoverageArc | null = null;
  const last = list[list.length - 1]!;
  if (list.length > 1 && list[0]!.s <= EDGE_EPS && last.e >= FULL_CIRCLE - EDGE_EPS) {
    const head = list.shift()!;
    const tail = list.pop()!;
    wrap = {
      startDeg: tail.s,
      endDeg: head.e,
      widthDeg: FULL_CIRCLE - tail.s + head.e,
    };
  }
  const arcs: CoverageArc[] = list.map((iv) => ({
    startDeg: iv.s,
    endDeg: iv.e,
    widthDeg: iv.e - iv.s,
  }));
  if (wrap) arcs.push(wrap);
  arcs.sort((a, b) => a.startDeg - b.startDeg);
  return arcs;
}

/** Complement of merged linear intervals within [0, 360]. */
function complement(intervals: readonly Interval[]): Interval[] {
  const gaps: Interval[] = [];
  let cursor = 0;
  for (const iv of intervals) {
    if (iv.s > cursor + EDGE_EPS) gaps.push({ s: cursor, e: iv.s });
    if (iv.e > cursor) cursor = iv.e;
  }
  if (cursor < FULL_CIRCLE - EDGE_EPS) gaps.push({ s: cursor, e: FULL_CIRCLE });
  return gaps;
}

/** Union of arbitrary arcs (read from `startDeg` + `widthDeg`), wrapping across 0. */
export function arcUnion(arcs: readonly Pick<CoverageArc, 'startDeg' | 'widthDeg'>[]): CoverageArc[] {
  return intervalsToArcs(linearUnion(arcs));
}

/** Share of the circle covered by the union of `arcs`, in [0, 1]. */
export function coveredFraction(arcs: readonly Pick<CoverageArc, 'startDeg' | 'widthDeg'>[]): number {
  const total = linearUnion(arcs).reduce((acc, iv) => acc + (iv.e - iv.s), 0);
  return Math.min(1, Math.max(0, total / FULL_CIRCLE));
}

/**
 * The widest arc not covered by `arcs`, or null when the circle is fully
 * covered. Ties go to the lowest `startDeg`.
 */
export function largestGap(arcs: readonly Pick<CoverageArc, 'startDeg' | 'widthDeg'>[]): CoverageArc | null {
  const gaps = intervalsToArcs(complement(linearUnion(arcs)));
  let best: CoverageArc | null = null;
  for (const g of gaps) {
    if (!best || g.widthDeg > best.widthDeg + EDGE_EPS) best = g;
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/* Panels                                                                     */
/* -------------------------------------------------------------------------- */

/** The panel index a bearing falls in, 0..35. */
export function panelForBearing(bearingDeg: number): number {
  const p = Math.floor(normalizeBearing(bearingDeg) / PANEL_WIDTH_DEG);
  return p >= PANEL_COUNT ? PANEL_COUNT - 1 : p;
}

/**
 * Panels touched by a frame shot at `bearingDeg` with the given field of view.
 * The frame spans the half-open arc `[bearing - fov/2, bearing + fov/2)`; a
 * panel counts when that arc overlaps it by more than float noise. A
 * non-positive or non-finite FOV touches only the bearing's own panel; a FOV of
 * 360 or more touches every panel. Result is ascending and unique.
 */
export function panelsForFrame(bearingDeg: number, fovDeg: number): number[] {
  if (!isFiniteNumber(fovDeg) || fovDeg <= 0) return [panelForBearing(bearingDeg)];
  if (fovDeg >= FULL_CIRCLE) return Array.from({ length: PANEL_COUNT }, (_, i) => i);
  const center = normalizeBearing(bearingDeg);
  const start = center - fovDeg / 2;
  const end = center + fovDeg / 2;
  const firstIdx = Math.floor(start / PANEL_WIDTH_DEG + EDGE_EPS);
  const lastIdx = Math.ceil(end / PANEL_WIDTH_DEG - EDGE_EPS) - 1;
  const seen = new Set<number>();
  for (let i = firstIdx; i <= lastIdx; i++) {
    seen.add(((i % PANEL_COUNT) + PANEL_COUNT) % PANEL_COUNT);
  }
  if (seen.size === 0) seen.add(panelForBearing(center));
  return [...seen].sort((a, b) => a - b);
}

function panelArcs(panels: readonly boolean[], want: boolean): Pick<CoverageArc, 'startDeg' | 'widthDeg'>[] {
  const out: Pick<CoverageArc, 'startDeg' | 'widthDeg'>[] = [];
  for (let p = 0; p < PANEL_COUNT; p++) {
    if ((panels[p] === true) === want) out.push({ startDeg: p * PANEL_WIDTH_DEG, widthDeg: PANEL_WIDTH_DEG });
  }
  return out;
}

/** Merge a panel mask into contiguous arcs, wrapping across 0 degrees. */
export function coverageArcs(panels: readonly boolean[]): CoverageArc[] {
  return arcUnion(panelArcs(panels, true));
}

/** The widest contiguous unscanned arc, or null when coverage is complete. */
export function largestUncoveredGap(panels: readonly boolean[]): CoverageArc | null {
  const gaps = arcUnion(panelArcs(panels, false));
  let best: CoverageArc | null = null;
  for (const g of gaps) {
    if (!best || g.widthDeg > best.widthDeg) best = g;
  }
  return best;
}

/** Coverage over a set of frame bearings. Non-finite bearings are ignored. */
export function coverage(bearingsDeg: readonly number[], fovDeg: number): CoverageResult {
  const kept = bearingsDeg.filter(isFiniteNumber).map(normalizeBearing);
  const panels: boolean[] = Array.from({ length: PANEL_COUNT }, () => false);
  for (const b of kept) {
    for (const p of panelsForFrame(b, fovDeg)) panels[p] = true;
  }
  const covered = panels.reduce((n, v) => n + (v ? 1 : 0), 0);
  const coveragePct = (covered * 100) / PANEL_COUNT;
  return {
    coveragePct,
    panels,
    coveredArcs: coverageArcs(panels),
    largestGap: largestUncoveredGap(panels),
    frameCount: kept.length,
    bearingsDeg: kept,
    sufficient: coveragePct >= MIN_COVERAGE_PCT - EDGE_EPS,
  };
}

/* -------------------------------------------------------------------------- */
/* Radar placement                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Unit-circle placement for the 2D radar ring; radius from DISTANCE_BAND_RADIUS.
 * Math axes, north up: `x = r·sin(θ)`, `y = r·cos(θ)`, so bearing 0 is (0, r)
 * and bearing 90 is (r, 0). A screen renderer flips y. The signature carries no
 * label or confidence, so this returns `label: 'unknown'`, `confidence: 0`;
 * `placeObjects` fills both from the observation.
 */
export function placeObject(
  observationId: string,
  bearingDeg: number,
  band: DistanceBand,
): PlacedObject {
  const b = normalizeBearing(bearingDeg);
  const r = DISTANCE_BAND_RADIUS[band] ?? DISTANCE_BAND_RADIUS.mid;
  const rad = (b * Math.PI) / 180;
  const x = r * Math.sin(rad);
  const y = r * Math.cos(rad);
  return {
    observationId,
    label: 'unknown',
    bearingDeg: b,
    distanceBand: band,
    // Snap float noise (e.g. cos(90°) = 6e-17) to exact zero.
    x: Math.abs(x) < EDGE_EPS ? 0 : x,
    y: Math.abs(y) < EDGE_EPS ? 0 : y,
    confidence: 0,
  };
}

export function placeObjects(observations: readonly Observation[]): PlacedObject[] {
  return observations.map((o) => ({
    ...placeObject(o.id, o.bearingDeg, o.distanceBand),
    label: o.label,
    confidence: o.confidence,
  }));
}
