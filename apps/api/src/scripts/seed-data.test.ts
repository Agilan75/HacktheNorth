import { describe, expect, it } from 'vitest';
import {
  COMBUSTIBLE_LABELS,
  DEDUPE_ANGLE_DEG,
  MAX_FRAMES,
  OBJECT_CATEGORY,
  OBJECT_VOCAB,
  PAIR_ANGLE_DEG,
} from '@retrofit/engine';
import { seededBrokerReply, seededObservations } from './seed-data';

const sep = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};
const BANDS = ['near', 'mid', 'far'] as const;

describe('seededObservations', () => {
  const obs = seededObservations();

  it('is 11 valid, uniquely identified observations inside the vocabulary', () => {
    expect(obs).toHaveLength(11);
    expect(new Set(obs.map((o) => o.id)).size).toBe(obs.length);
    for (const o of obs) {
      expect(OBJECT_VOCAB).toContain(o.label);
      expect(o.category).toBe(OBJECT_CATEGORY[o.label]);
      expect(o.bearingDeg).toBeGreaterThanOrEqual(0);
      expect(o.bearingDeg).toBeLessThan(360);
      expect(o.confidence).toBeGreaterThan(0);
      expect(o.confidence).toBeLessThanOrEqual(1);
      expect(o.frameIndex).toBeGreaterThanOrEqual(0);
      expect(o.frameIndex).toBeLessThan(MAX_FRAMES);
      expect(o.box2d).toBeDefined();
      const [y0, x0, y1, x1] = o.box2d!;
      expect(y0).toBeLessThan(y1);
      expect(x0).toBeLessThan(x1);
      for (const v of o.box2d!) expect(v >= 0 && v <= 1000).toBe(true);
    }
  });

  it('puts exactly one combustible within the heater pair rule (heater 48, curtain 60, both near)', () => {
    const heaters = obs.filter((o) => o.label === 'portable_heater');
    expect(heaters).toHaveLength(1);
    const heater = heaters[0]!;
    expect(heater.bearingDeg).toBe(48);
    const paired = obs.filter(
      (o) =>
        COMBUSTIBLE_LABELS.includes(o.label) &&
        sep(o.bearingDeg, heater.bearingDeg) <= PAIR_ANGLE_DEG &&
        Math.abs(BANDS.indexOf(o.distanceBand) - BANDS.indexOf(heater.distanceBand)) <= 1,
    );
    expect(paired.map((o) => o.label)).toEqual(['curtain']);
    expect(sep(paired[0]!.bearingDeg, heater.bearingDeg)).toBe(12);
  });

  it('never has two same-label observations inside the dedupe window', () => {
    for (let i = 0; i < obs.length; i++) {
      for (let j = i + 1; j < obs.length; j++) {
        if (obs[i]!.label !== obs[j]!.label) continue;
        expect(sep(obs[i]!.bearingDeg, obs[j]!.bearingDeg)).toBeGreaterThan(DEDUPE_ANGLE_DEG);
      }
    }
  });

  it('sends exactly the smoke detector (0.52) and candle (0.58) to confirmation', () => {
    const low = obs.filter((o) => o.confidence < 0.6).map((o) => [o.label, o.confidence]);
    expect(low).toEqual([
      ['smoke_detector', 0.52],
      ['candle', 0.58],
    ]);
  });

  it('is deterministic', () => {
    expect(seededObservations()).toEqual(seededObservations());
  });
});

describe('seededBrokerReply', () => {
  const reply = seededBrokerReply();

  it('contradicts itself on year built and TIV, and leaves a loss amount vague', () => {
    expect(reply).toContain('1978');
    expect(reply).toContain('1981');
    expect(reply).toContain('$62M');
    expect(reply).toContain('$64.5M');
    expect(reply).toContain('$42,000');
    expect(reply).toMatch(/cant remember the amount/);
    expect(reply).toMatch(/will have to check/);
  });

  it('is free text, not JSON, and stable', () => {
    expect(() => JSON.parse(reply)).toThrow();
    expect(seededBrokerReply()).toBe(reply);
  });
});
