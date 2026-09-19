/**
 * Sweep geometry — pure, no I/O. Body owned by Run 1 unit E11.
 *
 * Bearings are degrees clockwise, normalized to [0, 360) by
 * `util/math.normalizeDeg`. The circle is divided into PANEL_COUNT (36) panels
 * of PANEL_WIDTH_DEG (10): panel p covers [10p, 10p + 10).
 */
import type { CoverageArc, CoverageResult, DistanceBand, Observation, PlacedObject } from '../types.js';

/** The panel index a bearing falls in, 0..35. */
export function panelForBearing(_bearingDeg: number): number {
  throw new Error('NOT_IMPLEMENTED:E11');
}

/** Panels touched by a frame shot at `bearingDeg` with the given field of view. */
export function panelsForFrame(_bearingDeg: number, _fovDeg: number): number[] {
  throw new Error('NOT_IMPLEMENTED:E11');
}

/** Merge a panel mask into contiguous arcs, wrapping across 0 degrees. */
export function coverageArcs(_panels: readonly boolean[]): CoverageArc[] {
  throw new Error('NOT_IMPLEMENTED:E11');
}

/** The widest contiguous unscanned arc, or null when coverage is complete. */
export function largestUncoveredGap(_panels: readonly boolean[]): CoverageArc | null {
  throw new Error('NOT_IMPLEMENTED:E11');
}

/** Coverage over a set of frame bearings. */
export function coverage(_bearingsDeg: readonly number[], _fovDeg: number): CoverageResult {
  throw new Error('NOT_IMPLEMENTED:E11');
}

/** Unit-circle placement for the 2D radar ring; radius from DISTANCE_BAND_RADIUS. */
export function placeObject(
  _observationId: string,
  _bearingDeg: number,
  _band: DistanceBand,
): PlacedObject {
  throw new Error('NOT_IMPLEMENTED:E11');
}

export function placeObjects(_observations: readonly Observation[]): PlacedObject[] {
  throw new Error('NOT_IMPLEMENTED:E11');
}
