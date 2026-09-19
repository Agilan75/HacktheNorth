import { describe, expect, it } from 'vitest';
import { DISTANCE_BAND_RADIUS, MIN_COVERAGE_PCT, PANEL_COUNT } from '../constants.js';
import type { Observation } from '../types.js';
import {
  arcUnion,
  bearingDelta,
  coverage,
  coverageArcs,
  coveredFraction,
  dedupeByBearing,
  largestGap,
  largestUncoveredGap,
  normalizeBearing,
  panelForBearing,
  panelsForFrame,
  placeObject,
  placeObjects,
  withinTolerance,
} from './geometry.js';

const mask = (on: number[]): boolean[] => {
  const m = Array.from({ length: PANEL_COUNT }, () => false);
  for (const p of on) m[p] = true;
  return m;
};
const range = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);

describe('bearing helpers', () => {
  it('normalizes and computes signed deltas', () => {
    expect(normalizeBearing(-10)).toBe(350);
    expect(normalizeBearing(720)).toBe(0);
    expect(bearingDelta(350, 10)).toBe(20);
    expect(bearingDelta(10, 350)).toBe(-20);
    expect(bearingDelta(0, 180)).toBe(180);
  });
  it('withinTolerance is inclusive and wraps', () => {
    expect(withinTolerance(355, 10, 15)).toBe(true);
    expect(withinTolerance(355, 11, 15)).toBe(false);
  });
  it('dedupeByBearing keeps the first in each cluster per group', () => {
    const items = [
      { id: 'a', bearingDeg: 0, g: 'x' },
      { id: 'b', bearingDeg: 350, g: 'x' },
      { id: 'c', bearingDeg: 5, g: 'y' },
      { id: 'd', bearingDeg: 40, g: 'x' },
    ];
    const out = dedupeByBearing(items, 15, (p, q) => p.g === q.g);
    expect(out.map((i) => i.id)).toEqual(['a', 'c', 'd']);
  });
});

describe('panels', () => {
  it('maps bearings to 10-degree panels', () => {
    expect(panelForBearing(0)).toBe(0);
    expect(panelForBearing(9.999)).toBe(0);
    expect(panelForBearing(10)).toBe(1);
    expect(panelForBearing(359.99)).toBe(35);
    expect(panelForBearing(-5)).toBe(35);
    expect(panelForBearing(365)).toBe(0);
  });
  it('panelsForFrame spans the FOV half-open, wrapping', () => {
    expect(panelsForFrame(15, 10)).toEqual([1]);
    expect(panelsForFrame(5, 10)).toEqual([0]);
    expect(panelsForFrame(0, 60)).toEqual([0, 1, 2, 33, 34, 35]);
    expect(panelsForFrame(45, 60)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(panelsForFrame(47, 0)).toEqual([4]);
    expect(panelsForFrame(0, 360)).toHaveLength(36);
  });
});

describe('arcs', () => {
  it('merges panel runs and wraps across north', () => {
    expect(coverageArcs(mask([34, 35, 0, 1, 10]))).toEqual([
      { startDeg: 100, endDeg: 110, widthDeg: 10 },
      { startDeg: 340, endDeg: 20, widthDeg: 40 },
    ]);
    expect(coverageArcs(mask(range(30, 35)))).toEqual([{ startDeg: 300, endDeg: 360, widthDeg: 60 }]);
    expect(coverageArcs(mask(range(0, 35)))).toEqual([{ startDeg: 0, endDeg: 360, widthDeg: 360 }]);
    expect(coverageArcs(mask([]))).toEqual([]);
  });
  it('largest uncovered gap', () => {
    // covered 0..90 and 180..200 -> gaps 90..180 (90) and 200..360 (160)
    expect(largestUncoveredGap(mask([...range(0, 8), 18, 19]))).toEqual({
      startDeg: 200,
      endDeg: 360,
      widthDeg: 160,
    });
    // gap wrapping across north: covered 30..330
    expect(largestUncoveredGap(mask(range(3, 32)))).toEqual({ startDeg: 330, endDeg: 30, widthDeg: 60 });
    expect(largestUncoveredGap(mask(range(0, 35)))).toBeNull();
    expect(largestUncoveredGap(mask([]))).toEqual({ startDeg: 0, endDeg: 360, widthDeg: 360 });
  });
  it('continuous arc union, fraction and gap', () => {
    const arcs = [
      { startDeg: 350, widthDeg: 30 },
      { startDeg: 10, widthDeg: 20 },
      { startDeg: 90, widthDeg: 45 },
    ];
    expect(arcUnion(arcs)).toEqual([
      { startDeg: 90, endDeg: 135, widthDeg: 45 },
      { startDeg: 350, endDeg: 30, widthDeg: 40 },
    ]);
    expect(coveredFraction(arcs)).toBeCloseTo(85 / 360, 12);
    expect(largestGap(arcs)).toEqual({ startDeg: 135, endDeg: 350, widthDeg: 215 });
    expect(coveredFraction([{ startDeg: 5, widthDeg: 400 }])).toBe(1);
    expect(largestGap([{ startDeg: 0, widthDeg: 360 }])).toBeNull();
  });
});

describe('coverage', () => {
  it('75% threshold is exactly 27 of 36 panels', () => {
    // 27 frames, one per panel 0..26, FOV 10 centred mid-panel
    const bearings = range(0, 26).map((p) => p * 10 + 5);
    const c = coverage(bearings, 10);
    expect(c.coveragePct).toBe(75);
    expect(c.sufficient).toBe(true);
    expect(MIN_COVERAGE_PCT).toBe(75);
    expect(c.coveredArcs).toEqual([{ startDeg: 0, endDeg: 270, widthDeg: 270 }]);
    expect(c.largestGap).toEqual({ startDeg: 270, endDeg: 360, widthDeg: 90 });
    expect(c.frameCount).toBe(27);

    const short = coverage(bearings.slice(0, 26), 10);
    expect(short.coveragePct).toBeCloseTo((26 * 100) / 36, 12);
    expect(short.sufficient).toBe(false);
  });
  it('wide FOV frames, normalization and non-finite bearings', () => {
    const c = coverage([0, 120, 240, Number.NaN, -360], 60);
    expect(c.frameCount).toBe(4);
    expect(c.bearingsDeg).toEqual([0, 120, 240, 0]);
    expect(c.coveragePct).toBe(50);
    expect(c.coveredArcs).toHaveLength(3);
    expect(c.largestGap?.widthDeg).toBe(60);
    expect(c.largestGap?.startDeg).toBe(30);
    const empty = coverage([], 60);
    expect(empty.coveragePct).toBe(0);
    expect(empty.largestGap).toEqual({ startDeg: 0, endDeg: 360, widthDeg: 360 });
  });
});

describe('placement', () => {
  it('places by bearing and band radius', () => {
    const n = placeObject('o1', 0, 'near');
    expect(n.x).toBe(0);
    expect(n.y).toBeCloseTo(DISTANCE_BAND_RADIUS.near, 12);
    const e = placeObject('o2', 90, 'far');
    expect(e.x).toBeCloseTo(0.95, 12);
    expect(e.y).toBe(0);
    const s = placeObject('o3', -180, 'mid');
    expect(s.bearingDeg).toBe(180);
    expect(s.y).toBeCloseTo(-0.65, 12);
  });
  it('placeObjects carries label and confidence', () => {
    const obs: Observation[] = [
      {
        id: 'h1',
        label: 'portable_heater',
        category: 'other' as Observation['category'],
        bearingDeg: 270,
        distanceBand: 'mid',
        confidence: 0.8,
        frameIndex: 3,
      },
    ];
    const [p] = placeObjects(obs);
    expect(p).toMatchObject({ observationId: 'h1', label: 'portable_heater', confidence: 0.8, bearingDeg: 270 });
    expect(p!.x).toBeCloseTo(-0.65, 12);
    expect(p!.y).toBe(0);
  });
});
