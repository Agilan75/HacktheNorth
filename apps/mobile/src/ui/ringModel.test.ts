import { describe, expect, it } from 'vitest';
import {
  SEGMENT_COUNT,
  bearingWords,
  coveredPercent,
  headingMarkerPath,
  markCovered,
  markerPoint,
  nearestGapTurn,
  normalizeDegrees,
  normalizePanels,
  polarPoint,
  ringSummary,
  segmentForHeading,
  segmentPath,
} from './ringModel';

const none = (): boolean[] => Array.from({ length: SEGMENT_COUNT }, () => false);
const firstN = (n: number): boolean[] => Array.from({ length: SEGMENT_COUNT }, (_, i) => i < n);

describe('segments', () => {
  it('normalizes angles', () => {
    expect(normalizeDegrees(-10)).toBe(350);
    expect(normalizeDegrees(720)).toBe(0);
    expect(Object.is(normalizeDegrees(-360), 0)).toBe(true);
    expect(normalizeDegrees(Number.NaN)).toBe(0);
  });

  it('maps headings to 36 ten-degree segments', () => {
    expect(segmentForHeading(0)).toBe(0);
    expect(segmentForHeading(9.99)).toBe(0);
    expect(segmentForHeading(10)).toBe(1);
    expect(segmentForHeading(359.999)).toBe(35);
    expect(segmentForHeading(-5)).toBe(35);
    expect(segmentForHeading(365)).toBe(0);
  });

  it('pads or trims panels to 36', () => {
    expect(normalizePanels(undefined)).toHaveLength(36);
    expect(normalizePanels([true]).filter(Boolean)).toHaveLength(1);
    expect(normalizePanels(Array.from({ length: 40 }, () => true))).toHaveLength(36);
  });

  it('marks the heading segment covered without mutating input', () => {
    const p = none();
    const q = markCovered(p, 95);
    expect(q[9]).toBe(true);
    expect(p[9]).toBe(false);
    expect(markCovered(p, Number.NaN).some(Boolean)).toBe(false);
  });
});

describe('coveredPercent', () => {
  it('floors so the finish threshold is never overstated', () => {
    expect(coveredPercent(none())).toBe(0);
    expect(coveredPercent(firstN(22))).toBe(61);
    expect(coveredPercent(firstN(27))).toBe(75);
    expect(coveredPercent(firstN(26))).toBe(72);
    expect(coveredPercent(firstN(36))).toBe(100);
  });

  it('prefers the API value when given', () => {
    expect(coveredPercent(none(), 62.5)).toBe(62);
    expect(coveredPercent(none(), 140)).toBe(100);
    expect(coveredPercent(firstN(10), null)).toBe(27);
    expect(coveredPercent(firstN(10), Number.NaN)).toBe(27);
  });
});

describe('nearestGapTurn', () => {
  it('points at the closest unscanned segment centre', () => {
    // Covered 0..179, heading 170: nearest gap is segment 18 (185) → +15.
    expect(nearestGapTurn(firstN(18), 170)).toBe(15);
    // Covered 0..179, heading 10: nearest gap is segment 35 (355) → -15.
    expect(nearestGapTurn(firstN(18), 10)).toBe(-15);
  });

  it('breaks ties clockwise and returns null when complete', () => {
    const p = firstN(36);
    p[0] = false; // centre 5
    p[18] = false; // centre 185
    expect(nearestGapTurn(p, 95)).toBe(90);
    expect(nearestGapTurn(firstN(36), 0)).toBeNull();
  });
});

describe('ringSummary', () => {
  it('tells the person which way to turn, in words', () => {
    const s = ringSummary({ panels: firstN(18), headingDeg: 20 });
    expect(s.percent).toBe(50);
    expect(s.direction).toBe('left');
    expect(s.turnDeg).toBe(30);
    expect(s.text).toBe(
      '50 percent of the room scanned. Turn left about 30 degrees to cover the part you have not scanned yet.',
    );
  });

  it('names the gap when the caller can', () => {
    const s = ringSummary({ panels: firstN(22), headingDeg: 200, gapName: 'the window side' });
    expect(s.text).toContain('61 percent of the room scanned.');
    expect(s.text).toContain('Turn right about 30 degrees to cover the window side.');
  });

  it('never gives a zero-degree turn', () => {
    const p = firstN(36);
    p[1] = false;
    const s = ringSummary({ panels: p, headingDeg: 9.9 });
    expect(s.direction).toBe('right');
    expect(s.turnDeg).toBe(10);
  });

  it('says hold steady when already pointing at a gap', () => {
    const s = ringSummary({ panels: firstN(5), headingDeg: 100 });
    expect(s.onUncovered).toBe(true);
    expect(s.direction).toBe('none');
    expect(s.hint).toMatch(/Hold steady/);
  });

  it('copes with no compass', () => {
    const s = ringSummary({ panels: firstN(5), headingDeg: null });
    expect(s.direction).toBe('none');
    expect(s.text).toMatch(/^13 percent of the room scanned\. Turn slowly/);
  });

  it('offers finish at 75 and says complete at 100', () => {
    const f = ringSummary({ panels: firstN(27), headingDeg: 5 });
    expect(f.canFinish).toBe(true);
    expect(f.text).toMatch(/You have scanned enough to finish\.$/);
    const c = ringSummary({ panels: firstN(36), headingDeg: 5 });
    expect(c.complete).toBe(true);
    expect(c.text).toBe('100 percent of the room scanned. The whole room is scanned.');
    expect(ringSummary({ panels: firstN(26), headingDeg: 5 }).canFinish).toBe(false);
    expect(ringSummary({ panels: firstN(20), headingDeg: 5, finishPct: 50 }).canFinish).toBe(true);
  });
});

describe('geometry', () => {
  it('puts bearing 0 at the top and 90 on the right', () => {
    expect(polarPoint(100, 100, 50, 0)).toEqual({ x: 100, y: 50 });
    expect(polarPoint(100, 100, 50, 90)).toEqual({ x: 150, y: 100 });
    expect(polarPoint(100, 100, 50, 180)).toEqual({ x: 100, y: 150 });
  });

  it('draws a closed annular sector per segment', () => {
    const d = segmentPath(0, 100, 100, 60, 90, 0);
    expect(d.startsWith('M 100 10 A 90 90 0 0 1 ')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(d).toContain('A 60 60 0 0 0 100 40');
    expect(segmentPath(36, 100, 100, 60, 90, 0)).toBe(d);
    expect(segmentPath(-1, 100, 100, 60, 90, 0)).toBe(segmentPath(35, 100, 100, 60, 90, 0));
  });

  it('draws the heading marker pointing inward at the heading', () => {
    const d = headingMarkerPath(100, 100, 80, 0);
    expect(d.startsWith('M 100 18 L ')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
  });

  it('places radar markers inside the ring and clamps radius', () => {
    expect(markerPoint(100, 100, 50, 90, 0.5)).toEqual({ x: 125, y: 100 });
    expect(markerPoint(100, 100, 50, 0, 3)).toEqual({ x: 100, y: 50 });
  });

  it('describes bearings in words', () => {
    expect(bearingWords(0)).toBe('straight ahead of where you started');
    expect(bearingWords(92)).toBe('90 degrees to the right of where you started');
    expect(bearingWords(270)).toBe('90 degrees to the left of where you started');
    expect(bearingWords(181)).toBe('behind where you started');
    expect(bearingWords(357)).toBe('straight ahead of where you started');
  });
});
