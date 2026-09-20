import { describe, expect, it } from 'vitest';

import {
  CAPTURE_INTERVAL_MS,
  MAX_FRAMES,
  PANEL_COUNT,
  canFinish,
  captureGate,
  captureReducer,
  coveragePct,
  initialCaptureState,
  largestUncoveredArc,
  meetsFinishCoverage,
  panelForBearing,
  summarize,
  turnAdvice,
  uploadBearings,
  type CaptureEvent,
  type CaptureState,
} from './capture';

const run = (state: CaptureState, events: CaptureEvent[]): CaptureState => events.reduce(captureReducer, state);

const started = () => captureReducer(initialCaptureState, { type: 'start' });

/** Feeds one heading sample and, if the machine asked for a frame, acknowledges it. */
function sample(state: CaptureState, headingDeg: number, atMs: number): CaptureState {
  const s = captureReducer(state, { type: 'heading', headingDeg, atMs });
  return s.pending ? captureReducer(s, { type: 'captured', atMs: atMs + 50, ref: `f${s.pending.index}` }) : s;
}

/** Panels array with the given indices covered. */
function panelsWith(indices: number[]): boolean[] {
  const p = Array.from({ length: PANEL_COUNT }, () => false);
  for (const i of indices) p[i] = true;
  return p;
}
const range = (from: number, count: number) => Array.from({ length: count }, (_, i) => (from + i) % PANEL_COUNT);

describe('lifecycle', () => {
  it('ignores headings before start', () => {
    const s = captureReducer(initialCaptureState, { type: 'heading', headingDeg: 10, atMs: 0 });
    expect(s).toBe(initialCaptureState);
    expect(captureGate(s, 0)).toBe('not-sweeping');
  });

  it('captures the first frame on the first heading sample, at bearing 0', () => {
    const s = captureReducer(started(), { type: 'heading', headingDeg: 200, atMs: 1000 });
    expect(s.startHeadingDeg).toBe(200);
    expect(s.bearingDeg).toBe(0);
    expect(s.pending).toEqual({ index: 0, bearingDeg: 0, requestedAtMs: 1000 });
    const t = captureReducer(s, { type: 'captured', atMs: 1100, ref: 'file://a.jpg' });
    expect(t.frames).toEqual([{ index: 0, bearingDeg: 0, requestedAtMs: 1000, capturedAtMs: 1100, ref: 'file://a.jpg' }]);
    expect(t.pending).toBeNull();
  });

  it('does not request a second frame while one is pending', () => {
    let s = captureReducer(started(), { type: 'heading', headingDeg: 0, atMs: 0 });
    s = captureReducer(s, { type: 'heading', headingDeg: 40, atMs: 5000 });
    expect(s.pending?.index).toBe(0);
    expect(captureGate(s, 5000)).toBe('pending');
  });

  it('a failed capture clears pending and the next sample retries', () => {
    let s = captureReducer(started(), { type: 'heading', headingDeg: 0, atMs: 0 });
    s = captureReducer(s, { type: 'captureFailed' });
    expect(s.pending).toBeNull();
    expect(s.frames).toHaveLength(0);
    s = captureReducer(s, { type: 'heading', headingDeg: 1, atMs: 10 });
    expect(s.pending?.index).toBe(0);
  });

  it('a stray captured with nothing pending adds no frame', () => {
    const s = captureReducer(started(), { type: 'captured', atMs: 0 });
    expect(s.frames).toHaveLength(0);
  });

  it('reset returns to idle', () => {
    const s = sample(started(), 10, 0);
    expect(captureReducer(s, { type: 'reset' })).toBe(initialCaptureState);
  });
});

describe('bearings are relative to the sweep start', () => {
  it('handles a start near north and a sweep across 359 -> 0', () => {
    let s = sample(started(), 350, 0);
    s = sample(s, 5, 2000); // +15° across north
    expect(s.bearingDeg).toBe(15);
    expect(s.frames.map((f) => f.bearingDeg)).toEqual([0, 15]);
    s = sample(s, 340, 4000); // -10° from start, i.e. 350 relative
    expect(s.bearingDeg).toBe(350);
    expect(s.frames.at(-1)?.bearingDeg).toBe(350);
  });
});

describe('the 10° gate', () => {
  it('9.9° is not enough, 10° is', () => {
    let s = sample(started(), 100, 0);
    s = sample(s, 109.9, 5000);
    expect(s.frames).toHaveLength(1);
    expect(captureGate(s, 5000)).toBe('not-turned');
    s = sample(s, 110, 6000);
    expect(s.frames).toHaveLength(2);
    expect(s.frames[1]?.bearingDeg).toBe(10);
  });

  it('measures the advance across the wrap (355 -> 5 is 10°)', () => {
    let s = sample(started(), 0, 0);
    s = sample(s, 355, 2000); // bearing 355, 5° from the last frame at 0
    expect(s.frames).toHaveLength(1);
    s = sample(s, 350, 4000); // 10° from 0 the other way
    expect(s.frames).toHaveLength(2);
    expect(s.frames[1]?.bearingDeg).toBe(350);
  });

  it('measures from the last CAPTURED bearing, not the last sample', () => {
    let s = sample(started(), 0, 0);
    for (let h = 1; h <= 9; h++) s = sample(s, h, h * 2000); // creeping 1° at a time
    expect(s.frames).toHaveLength(1);
    s = sample(s, 10, 30_000);
    expect(s.frames).toHaveLength(2);
  });
});

describe('the 1.2 s gate', () => {
  it('waits CAPTURE_INTERVAL_MS from the previous request even after a big turn', () => {
    let s = sample(started(), 0, 1000);
    s = sample(s, 45, 1000 + CAPTURE_INTERVAL_MS - 1);
    expect(s.frames).toHaveLength(1);
    expect(captureGate(s, 1000 + CAPTURE_INTERVAL_MS - 1)).toBe('too-soon');
    s = sample(s, 45, 1000 + CAPTURE_INTERVAL_MS);
    expect(s.frames).toHaveLength(2);
  });
});

describe('the 15-frame cap', () => {
  it('stops at MAX_FRAMES and keeps filling coverage from the heading', () => {
    let s = started();
    let t = 0;
    for (let h = 0; h <= 20 * 12; h += 12) {
      s = sample(s, h, t);
      t += 1300;
    }
    expect(s.frames).toHaveLength(MAX_FRAMES);
    expect(captureGate(s, t)).toBe('cap-reached');
    const before = summarize(s).coveredPanels;
    for (let h = 250; h <= 350; h += 5) {
      s = sample(s, h, t);
      t += 1300;
    }
    expect(s.frames).toHaveLength(MAX_FRAMES);
    expect(s.pending).toBeNull();
    expect(summarize(s).coveredPanels).toBeGreaterThan(before);
    expect(summarize(s).capReached).toBe(true);
    expect(summarize(s).framesLeft).toBe(0);
    expect(s.frames.map((f) => f.index)).toEqual(Array.from({ length: MAX_FRAMES }, (_, i) => i));
  });
});

describe('coverage fill', () => {
  it('fills every panel the heading passes through, across the wrap', () => {
    let s = sample(started(), 0, 0); // panel 0
    s = captureReducer(s, { type: 'heading', headingDeg: 35, atMs: 100 }); // 0..35 -> panels 0..3
    expect(s.panels.slice(0, 4)).toEqual([true, true, true, true]);
    s = captureReducer(s, { type: 'heading', headingDeg: 0, atMs: 200 });
    s = captureReducer(s, { type: 'heading', headingDeg: 335, atMs: 300 }); // 0 -> 335 the short way
    expect(s.panels[33]).toBe(true);
    expect(s.panels[34]).toBe(true);
    expect(s.panels[35]).toBe(true);
    expect(s.panels[20]).toBe(false);
  });

  it('does not interpolate a glitch jump larger than 60°', () => {
    let s = sample(started(), 0, 0);
    s = captureReducer(s, { type: 'heading', headingDeg: 90, atMs: 100 });
    expect(s.panels[9]).toBe(true);
    expect(s.panels.slice(1, 9).every((p) => !p)).toBe(true);
  });

  it('panelForBearing maps edges into 0..35', () => {
    expect(panelForBearing(0)).toBe(0);
    expect(panelForBearing(9.999)).toBe(0);
    expect(panelForBearing(10)).toBe(1);
    expect(panelForBearing(359.9)).toBe(35);
    expect(panelForBearing(360)).toBe(0);
    expect(panelForBearing(-5)).toBe(35);
  });
});

describe('the 25% threshold', () => {
  it('8 panels is not enough, 9 is exactly 25%', () => {
    expect(meetsFinishCoverage(panelsWith(range(0, 8)))).toBe(false);
    expect(meetsFinishCoverage(panelsWith(range(0, 9)))).toBe(true);
    expect(coveragePct(panelsWith(range(0, 9)))).toBe(25);
    expect(coveragePct(panelsWith(range(0, 8)))).toBeCloseTo(22.22, 2);
  });

  it('finish only works at >= 25% with at least one frame', () => {
    const base = { ...started(), bearingDeg: 0, startHeadingDeg: 0 };
    const frame = { index: 0, bearingDeg: 0, requestedAtMs: 0, capturedAtMs: 0, ref: null };
    const at8: CaptureState = { ...base, panels: panelsWith(range(0, 8)), frames: [frame] };
    const at9: CaptureState = { ...base, panels: panelsWith(range(0, 9)), frames: [frame] };
    const noFrames: CaptureState = { ...at9, frames: [] };

    expect(canFinish(at8)).toBe(false);
    expect(captureReducer(at8, { type: 'finish' }).phase).toBe('sweeping');
    expect(canFinish(noFrames)).toBe(false);
    expect(canFinish(at9)).toBe(true);
    expect(captureReducer(at9, { type: 'finish' }).phase).toBe('finished');
    expect(summarize(at9).coveragePctDisplay).toBe(25);
    expect(summarize(at8).coveragePctDisplay).toBe(22);
  });

  it('a real sweep of 80° reaches Finish; 70° does not', () => {
    const sweep = (degrees: number) => {
      let s = started();
      let t = 0;
      for (let h = 0; h <= degrees; h += 5) {
        s = sample(s, h, t);
        t += 700;
      }
      return s;
    };
    // 0..70 touches panels 0..7 = 8 panels.
    expect(summarize(sweep(70)).canFinish).toBe(false);
    // 0..80 touches panels 0..8 = 9 panels = 25%.
    const done = sweep(80);
    expect(summarize(done).coveredPanels).toBe(9);
    expect(summarize(done).canFinish).toBe(true);
  });
});

describe('largest uncovered arc and turn advice', () => {
  it('is the whole circle with nothing covered, null with everything covered', () => {
    expect(largestUncoveredArc(panelsWith([]))).toEqual({ startDeg: 0, widthDeg: 360, centerDeg: 180, panelCount: 36 });
    expect(largestUncoveredArc(panelsWith(range(0, 36)))).toBeNull();
  });

  it('finds the widest run', () => {
    // covered 0..9 and 20..24 -> gaps 10..19 (10 panels) and 25..35 (11 panels)
    const g = largestUncoveredArc(panelsWith([...range(0, 10), ...range(20, 5)]));
    expect(g).toEqual({ startDeg: 250, widthDeg: 110, centerDeg: 305, panelCount: 11 });
  });

  it('joins a gap that wraps across 350 -> 0', () => {
    // covered 5..30 -> gap 31..35 + 0..4 = 10 panels starting at 310°
    const g = largestUncoveredArc(panelsWith(range(5, 26)));
    expect(g).toEqual({ startDeg: 310, widthDeg: 100, centerDeg: 0, panelCount: 10 });
  });

  it('breaks ties toward the lowest starting panel', () => {
    // covered 0 and 18 -> two gaps of 17
    const g = largestUncoveredArc(panelsWith([0, 18]));
    expect(g?.startDeg).toBe(10);
  });

  it('says turn right when the gap is clockwise-nearer', () => {
    const panels = panelsWith(range(0, 27)); // gap 270..360
    const a = turnAdvice(panels, 260);
    expect(a).toMatchObject({ direction: 'right', degrees: 10 });
  });

  it('says turn left when the gap is counter-clockwise-nearer, across the wrap', () => {
    const panels = panelsWith(range(0, 27)); // gap 270..360
    const a = turnAdvice(panels, 5);
    expect(a).toMatchObject({ direction: 'left', degrees: 5 });
  });

  it('returns null with no bearing yet', () => {
    expect(turnAdvice(panelsWith([]), null)).toBeNull();
  });

  it('writes a plain-language hint with no colour words', () => {
    let s = sample(started(), 0, 0);
    s = captureReducer(s, { type: 'heading', headingDeg: 40, atMs: 100 });
    const { hint } = summarize(s);
    expect(hint).toMatch(/^13% of the room scanned\. Turn right about \d+ degrees to keep scanning\.$/);
    expect(hint).not.toMatch(/red|green|colou?r/i);
    expect(summarize(initialCaptureState).hint).toMatch(/turn in a circle/);
  });

  it('tells the user they can finish once past 75%', () => {
    let s = started();
    let t = 0;
    for (let h = 0; h <= 300; h += 5) {
      s = sample(s, h, t);
      t += 700;
    }
    expect(summarize(s).hint).toMatch(/You can finish now/);
  });

  it('says the whole room is done at 100%', () => {
    let s = started();
    let t = 0;
    for (let h = 0; h <= 360; h += 5) {
      s = sample(s, h, t);
      t += 700;
    }
    expect(summarize(s).coveredPanels).toBe(36);
    expect(summarize(s).largestGap).toBeNull();
    expect(summarize(s).hint).toMatch(/whole room/);
  });
});

describe('uploadBearings', () => {
  it('spreads picked photos evenly: 3 -> 0, 120, 240', () => {
    expect(uploadBearings(3)).toEqual([0, 120, 240]);
    expect(uploadBearings(1)).toEqual([0]);
    expect(uploadBearings(0)).toEqual([]);
    expect(uploadBearings(40)).toHaveLength(MAX_FRAMES);
    expect(Math.max(...uploadBearings(15))).toBeLessThan(360);
  });
});

describe('events are never mutating', () => {
  it('leaves the previous state untouched', () => {
    const s0 = sample(started(), 0, 0);
    const snapshot = JSON.stringify(s0);
    run(s0, [
      { type: 'heading', headingDeg: 30, atMs: 5000 },
      { type: 'captured', atMs: 5100 },
      { type: 'finish' },
    ]);
    expect(JSON.stringify(s0)).toBe(snapshot);
  });
});
