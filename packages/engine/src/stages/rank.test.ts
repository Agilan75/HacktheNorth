/**
 * Stage 13 tests (unit E10). The quality formula and the null rule are
 * INTERPRETATIONS P-5; the ordering is P-6.
 */
import { describe, expect, it } from 'vitest';
import type { EngineResult } from '../types.js';
import { QUALITY_WEIGHTS, SCORE_TOLERANCE } from '../constants.js';
import { qualityIndex, rank } from './rank.js';

interface Opts {
  id?: string;
  appetite?: number;
  completeness?: number;
  confidence?: number;
  knockout?: boolean;
  distance?: 0 | 1 | 2 | null;
  quoted?: number | null;
  predicted?: number | null;
  loss?: number | null;
  qualityIndex?: number;
}

function result(o: Opts = {}): EngineResult {
  return {
    id: o.id ?? 'r',
    evaluate: {
      appetiteScore: o.appetite ?? 80,
      knockout: o.knockout ?? false,
      completeness: o.completeness ?? 90,
      confidence: o.confidence ?? 0.8,
    },
    price: {
      quotedPremium: o.quoted === undefined ? 50_000 : o.quoted,
      predictedPremium: o.predicted === undefined ? 40_000 : o.predicted,
      expectedAnnualLoss: o.loss === undefined ? 20_000 : o.loss,
    },
    verdict: {
      verdict: o.knockout ? 'DECLINE' : 'FIT',
      distanceToAppetite: o.distance === undefined ? 0 : o.distance,
    },
    qualityIndex: o.qualityIndex ?? 0,
    qualityComponents: { appetite: 0, adequacy: 0, lossRatio: 0, completeness: 0, confidence: 0 },
  } as unknown as EngineResult;
}

const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(SCORE_TOLERANCE);

describe('qualityIndex (P-5)', () => {
  it('computes the weighted formula with every term present', () => {
    // adequacy 1.25 -> 62.5; lossRatio 0.4 -> 60; confidence 0.8 -> 80.
    const q = qualityIndex(result(), QUALITY_WEIGHTS);
    close(q.components.appetite, 80);
    close(q.components.adequacy, 62.5);
    close(q.components.lossRatio, 60);
    close(q.components.completeness, 90);
    close(q.components.confidence, 80);
    close(q.index, 0.5 * 80 + 0.2 * 62.5 + 0.15 * 60 + 0.1 * 90 + 0.05 * 80); // 74.5
    close(q.index, 74.5);
  });

  it('clamps adequacy at 2 and lossRatio term at 0..1', () => {
    const q = qualityIndex(result({ quoted: 100_000, predicted: 10_000, loss: 150_000 }), QUALITY_WEIGHTS);
    close(q.components.adequacy, 100);
    close(q.components.lossRatio, 0);
    const neg = qualityIndex(result({ loss: 0 }), QUALITY_WEIGHTS);
    close(neg.components.lossRatio, 100);
  });

  it('drops a null term and renormalizes the remaining weights', () => {
    // No prediction: adequacy dropped, remaining weights sum to 0.8.
    const q = qualityIndex(result({ predicted: null }), QUALITY_WEIGHTS);
    close(q.components.adequacy, 0);
    close(q.index, (0.5 * 80 + 0.15 * 60 + 0.1 * 90 + 0.05 * 80) / 0.8); // 77.5
  });

  it('no quoted premium drops both adequacy and loss ratio', () => {
    const q = qualityIndex(result({ quoted: null }), QUALITY_WEIGHTS);
    close(q.index, (0.5 * 80 + 0.1 * 90 + 0.05 * 80) / 0.65); // 81.538...
  });

  it('a zero predicted premium is a missing input, not an infinite adequacy', () => {
    const q = qualityIndex(result({ predicted: 0 }), QUALITY_WEIGHTS);
    close(q.index, 77.5);
  });

  it('stays within 0..100', () => {
    const top = qualityIndex(
      result({ appetite: 100, completeness: 100, confidence: 1, quoted: 80_000, predicted: 40_000, loss: 0 }),
      QUALITY_WEIGHTS,
    );
    close(top.index, 100);
    const bottom = qualityIndex(
      result({ appetite: 0, completeness: 0, confidence: 0, quoted: 1, predicted: 1e9, loss: 1e9 }),
      QUALITY_WEIGHTS,
    );
    expect(bottom.index).toBeGreaterThanOrEqual(0);
    expect(bottom.index).toBeLessThan(1e-3);
  });
});

describe('rank (P-6)', () => {
  it('orders non-knockouts by index desc, then id; knockouts after all of them', () => {
    const results = [
      result({ id: 'ko-far', knockout: true, distance: 2, qualityIndex: 99 }),
      result({ id: 'low', qualityIndex: 40 }),
      result({ id: 'ko-none', knockout: true, distance: null, qualityIndex: 95 }),
      result({ id: 'b-high', qualityIndex: 70 }),
      result({ id: 'a-high', qualityIndex: 70 }),
      result({ id: 'ko-near-lo', knockout: true, distance: 1, qualityIndex: 10 }),
      result({ id: 'ko-near-hi', knockout: true, distance: 1, qualityIndex: 20 }),
    ];
    const ranked = rank(results);
    expect(ranked.map((r) => r.id)).toEqual([
      'a-high',
      'b-high',
      'low',
      'ko-near-hi',
      'ko-near-lo',
      'ko-far',
      'ko-none',
    ]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(ranked[3]!.knockout).toBe(true);
    expect(ranked[0]!.verdict).toBe('FIT');
  });

  it('recomputes the index when weights are passed', () => {
    const ranked = rank([result({ id: 'x', qualityIndex: 1 })], QUALITY_WEIGHTS);
    close(ranked[0]!.qualityIndex, 74.5);
    close(ranked[0]!.adequacy!, 1.25);
    expect(ranked[0]!.completeness).toBe(90);
    expect(ranked[0]!.confidence).toBe(0.8);
  });

  it('uses the carried index when no weights are passed', () => {
    const ranked = rank([result({ id: 'x', qualityIndex: 12.5 })]);
    expect(ranked[0]!.qualityIndex).toBe(12.5);
  });

  it('reports null adequacy when there is no prediction', () => {
    expect(rank([result({ predicted: null })])[0]!.adequacy).toBeNull();
  });

  it('empty input ranks nothing', () => {
    expect(rank([])).toEqual([]);
  });
});
