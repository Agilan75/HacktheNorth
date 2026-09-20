import { describe, expect, it } from 'vitest';
import { OBJECT_CATEGORY } from '../constants.js';
import type { CoverageResult, DistanceBand, ObjectLabel, Observation } from '../types.js';
import {
  applySelfConsistency,
  dedupeObservations,
  negativeEvidence,
  pairRules,
  toHazardValues,
  unknownHazards,
} from './observations.js';

let seq = 0;
function obs(
  label: ObjectLabel,
  bearingDeg: number,
  confidence: number,
  extra: Partial<Observation> = {},
): Observation {
  seq += 1;
  return {
    id: extra.id ?? `o${String(seq)}`,
    label,
    category: OBJECT_CATEGORY[label],
    bearingDeg,
    distanceBand: (extra.distanceBand ?? 'mid') as DistanceBand,
    confidence,
    frameIndex: extra.frameIndex ?? 0,
    ...extra,
  };
}

function cov(coveragePct: number, frameCount: number): CoverageResult {
  return {
    coveragePct,
    panels: [],
    coveredArcs: [],
    largestGap: null,
    frameCount,
    bearingsDeg: [],
    sufficient: coveragePct >= 75,
  };
}

const valueAt = (vals: ReturnType<typeof toHazardValues>, path: string) =>
  vals.find((v) => v.canonicalPath === path);

describe('dedupeObservations (PRD 9.3 step 3, ±15°)', () => {
  it('merges same label within 15° keeping max confidence', () => {
    const a = obs('candle', 10, 0.6, { id: 'a' });
    const b = obs('candle', 24, 0.9, { id: 'b' });
    const out = dedupeObservations([a, b]);
    expect(out.map((o) => o.id)).toEqual(['b']);
    expect(out[0]!.confidence).toBe(0.9);
  });

  it('merges at exactly 15° and across north, keeps 16° apart', () => {
    expect(dedupeObservations([obs('tv', 0, 0.5), obs('tv', 15, 0.4)])).toHaveLength(1);
    expect(dedupeObservations([obs('tv', 355, 0.5), obs('tv', 8, 0.7, { id: 'n' })]).map((o) => o.id)).toEqual(['n']);
    expect(dedupeObservations([obs('tv', 0, 0.5), obs('tv', 16, 0.4)])).toHaveLength(2);
  });

  it('never merges different labels and is idempotent', () => {
    const list = [obs('candle', 10, 0.5), obs('curtain', 12, 0.5), obs('candle', 20, 0.7), obs('candle', 40, 0.3)];
    const once = dedupeObservations(list);
    expect(once.map((o) => o.label)).toEqual(['curtain', 'candle', 'candle']);
    expect(dedupeObservations(once)).toEqual(once);
  });
});

describe('applySelfConsistency (PRD 9.3 step 4)', () => {
  it('keeps confidence for objects in both runs, halves single-run objects', () => {
    const runA = [obs('stove', 90, 0.8, { id: 'sA' }), obs('candle', 200, 0.6, { id: 'cA' })];
    const runB = [obs('stove', 100, 0.7, { id: 'sB' }), obs('bike', 300, 0.9, { id: 'bB' })];
    const out = applySelfConsistency(runA, runB);
    const byId = new Map(out.map((o) => [o.id, o]));
    expect(out).toHaveLength(3);
    expect(byId.get('sA')!.confidence).toBe(0.8);
    expect(byId.get('sA')!.runsSeen).toBe(2);
    expect(byId.get('cA')!.confidence).toBe(0.3);
    expect(byId.get('cA')!.runsSeen).toBe(1);
    expect(byId.get('bB')!.confidence).toBe(0.45);
  });

  it('keeps the higher confidence of a matched pair', () => {
    const out = applySelfConsistency([obs('tv', 0, 0.4, { id: 'x' })], [obs('tv', 5, 0.9, { id: 'y' })]);
    expect(out).toEqual([expect.objectContaining({ id: 'y', confidence: 0.9, runsSeen: 2 })]);
  });

  it('matches one-to-one: two A objects cannot share one B object', () => {
    const out = applySelfConsistency(
      [obs('candle', 0, 0.8, { id: 'a1' }), obs('candle', 20, 0.6, { id: 'a2' })],
      [obs('candle', 10, 0.7, { id: 'b1' })],
    );
    expect(out.map((o) => [o.runsSeen, o.confidence])).toEqual([
      [2, 0.8],
      [1, 0.3],
    ]);
  });

  it('halves everything when the second run is empty', () => {
    expect(applySelfConsistency([obs('stove', 0, 0.8)], []).map((o) => o.confidence)).toEqual([0.4]);
  });
});

describe('negativeEvidence (PRD 9.3 step 5)', () => {
  const ceilingFrames = (n: number) =>
    Array.from({ length: n }, (_, i) => obs('unknown', i * 30, 0.7, { frameIndex: i, ceilingVisible: true }));

  it('records no smoke detector when the ceiling was seen in >= 50% of frames', () => {
    const out = negativeEvidence(ceilingFrames(5), cov(100, 10));
    expect(out).toEqual([{ path: 'hazards.smokeDetector', value: false, confidence: 0.5 }]);
  });

  it('stays unknown below 50%', () => {
    expect(negativeEvidence(ceilingFrames(4), cov(100, 10))).toEqual([]);
  });

  it('counts distinct frames, not observations', () => {
    const many = [0, 0, 0, 1].map((f) => obs('unknown', 0, 0.7, { frameIndex: f, ceilingVisible: true }));
    expect(negativeEvidence(many, cov(100, 10))).toEqual([]);
  });

  it('gives nothing when a smoke detector was seen', () => {
    expect(negativeEvidence([...ceilingFrames(10), obs('smoke_detector', 0, 0.9)], cov(100, 10))).toEqual([]);
  });
});

describe('pairRules (PRD 6.3, TN-PAIR)', () => {
  it('fires for a heater within 20° and an adjacent band of a curtain', () => {
    const h = obs('portable_heater', 350, 0.8, { id: 'h', distanceBand: 'near' });
    const c = obs('curtain', 10, 0.5, { id: 'c', distanceBand: 'mid' });
    const hits = pairRules([h, c]);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      hazardKey: 'heaterNearCombustible',
      aObservationId: 'h',
      bObservationId: 'c',
      separationDeg: 20,
    });
    expect(hits[0]!.confidence).toBeCloseTo(0.4, 12);
  });

  it('does not fire beyond 20°, across near/far, or for non-combustibles', () => {
    const h = obs('portable_heater', 0, 0.8, { distanceBand: 'near' });
    expect(pairRules([h, obs('bedding', 21, 0.9, { distanceBand: 'near' })])).toEqual([]);
    expect(pairRules([h, obs('fabric', 5, 0.9, { distanceBand: 'far' })])).toEqual([]);
    expect(pairRules([h, obs('tv', 5, 0.9, { distanceBand: 'near' })])).toEqual([]);
  });
});

describe('toHazardValues / unknownHazards', () => {
  const room = [
    obs('portable_heater', 40, 0.8, { id: 'h', distanceBand: 'near' }),
    obs('bedding', 50, 0.9, { id: 'b', distanceBand: 'near' }),
    obs('laptop', 200, 0.7, { id: 'l' }),
    obs('smoke_detector', 100, 0.6, { id: 's1', ceilingVisible: true }),
    obs('smoke_detector', 250, 0.5, { id: 's2', ceilingVisible: true }),
  ];

  it('emits presence, pair, counts and inferred absences for a sufficient sweep', () => {
    const vals = toHazardValues(room, pairRules(room), cov(80, 12));
    expect(valueAt(vals, 'hazards.portableHeater')).toMatchObject({
      value: true,
      provenance: { source: 'sweep', sourceDetail: 'observation:h', confidence: 0.8 },
    });
    const pair = valueAt(vals, 'hazards.heaterNearCombustible')!;
    expect(pair.value).toBe(true);
    expect(pair.provenance.confidence).toBeCloseTo(0.72, 12);
    expect(valueAt(vals, 'hazards.highValueContents')!.value).toBe(true);
    expect(valueAt(vals, 'hazards.smokeDetectorCount')).toMatchObject({ value: 2, provenance: { confidence: 0.6 } });
    expect(valueAt(vals, 'hazards.candle')).toMatchObject({ value: false, provenance: { confidence: 0.8 } });
    expect(valueAt(vals, 'hazards.powerBarOverload')!.value).toBe(false);
    expect(valueAt(vals, 'hazards.ceilingObserved')!.value).toBe(true);
    expect(unknownHazards(room, cov(80, 12))).toEqual([]);
  });

  it('leaves unseen hazards unknown when coverage is insufficient', () => {
    const vals = toHazardValues(room, pairRules(room), cov(60, 12));
    expect(valueAt(vals, 'hazards.candle')).toBeUndefined();
    expect(unknownHazards(room, cov(60, 12))).toEqual([
      'extensionCord',
      'powerBarOverload',
      'candle',
      'stove',
      'blockedExit',
      'windowAcUnit',
      'waterHeater',
    ]);
  });

  it('smoke count is 0 only with ceiling evidence, otherwise unknown', () => {
    const noCeiling = [obs('tv', 0, 0.9, { frameIndex: 0 })];
    expect(unknownHazards(noCeiling, cov(100, 10))).toEqual(['smokeDetectorCount']);
    expect(valueAt(toHazardValues(noCeiling, [], cov(100, 10)), 'hazards.smokeDetectorCount')).toBeUndefined();

    const ceiling = Array.from({ length: 6 }, (_, i) =>
      obs('unknown', i * 60, 0.7, { frameIndex: i, ceilingVisible: true }),
    );
    const vals = toHazardValues(ceiling, [], cov(100, 10));
    expect(valueAt(vals, 'hazards.smokeDetectorCount')).toMatchObject({ value: 0, provenance: { confidence: 0.6 } });
    expect(unknownHazards(ceiling, cov(100, 10))).toEqual([]);
  });

  it('a seen power bar leaves the overload to the relate call', () => {
    const list = [obs('power_bar', 0, 0.9)];
    expect(unknownHazards(list, cov(100, 10))).toContain('powerBarOverload');
  });
});
