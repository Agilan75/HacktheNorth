import { describe, expect, it } from 'vitest';

import { SWEEP_FALLBACK_CONFIDENCE } from '../constants.js';
import type { Field, Provenance, Sourced } from '../types.js';
import {
  addValue,
  bestValue,
  combinedConfidence,
  hasCompetingValues,
  readPath,
  sourceConfidence,
  tableConfidence,
} from './fields.js';

const prov = (p: Provenance): Provenance => p;
const field = <T>(value: T, p: Provenance): Field<T> => ({ value, provenance: p });

describe('sourceConfidence / tableConfidence (PRD 6.5, V-7)', () => {
  it('uses the fixed table when no confidence is stated', () => {
    expect(sourceConfidence(prov({ source: 'self_reported' }))).toBe(0.7);
    expect(sourceConfidence(prov({ source: 'answer' }))).toBe(0.8);
    expect(sourceConfidence(prov({ source: 'enrichment' }))).toBe(0.9);
  });

  it('a sweep carries its own stated confidence, and falls back to 0.5', () => {
    expect(sourceConfidence(prov({ source: 'sweep', confidence: 0.72 }))).toBe(0.72);
    expect(sourceConfidence(prov({ source: 'sweep' }))).toBe(SWEEP_FALLBACK_CONFIDENCE);
    expect(SWEEP_FALLBACK_CONFIDENCE).toBe(0.5);
  });

  it('a stated confidence overrides the table and is clamped to [0, 1]', () => {
    expect(sourceConfidence(prov({ source: 'self_reported', confidence: 0.95 }))).toBe(0.95);
    expect(sourceConfidence(prov({ source: 'answer', confidence: 1.4 }))).toBe(1);
    expect(sourceConfidence(prov({ source: 'answer', confidence: -3 }))).toBe(0);
    expect(sourceConfidence(prov({ source: 'answer', confidence: Number.NaN }))).toBe(0.8);
  });

  it('tableConfidence ignores the stated number', () => {
    expect(tableConfidence('self_reported')).toBe(0.7);
    expect(tableConfidence('enrichment')).toBe(0.9);
    expect(tableConfidence('answer')).toBe(0.8);
    expect(tableConfidence('sweep')).toBe(SWEEP_FALLBACK_CONFIDENCE);
  });
});

describe('bestValue', () => {
  it('returns null for an empty or absent slot', () => {
    expect(bestValue(undefined)).toBeNull();
    expect(bestValue([])).toBeNull();
  });

  it('takes the highest confidence: public record beats broker-typed', () => {
    const slot: Sourced<number> = [
      field(1985, prov({ source: 'self_reported' })),
      field(1951, prov({ source: 'enrichment' })),
    ];
    expect(bestValue(slot)?.value).toBe(1951);
  });

  it('a high-confidence sweep beats an enrichment value', () => {
    const slot: Sourced<number> = [
      field(1, prov({ source: 'enrichment' })),
      field(2, prov({ source: 'sweep', confidence: 0.95 })),
    ];
    expect(bestValue(slot)?.value).toBe(2);
  });

  it('ties break by enrichment > answer > sweep > self_reported', () => {
    const slot: Sourced<string> = [
      field('sweep', prov({ source: 'sweep', confidence: 0.8 })),
      field('answer', prov({ source: 'answer' })),
    ];
    expect(bestValue(slot)?.value).toBe('answer');

    const slot2: Sourced<string> = [
      field('self', prov({ source: 'self_reported', confidence: 0.9 })),
      field('enrich', prov({ source: 'enrichment' })),
    ];
    expect(bestValue(slot2)?.value).toBe('enrich');
  });

  it('after source order, the latest observedAt wins', () => {
    const slot: Sourced<string> = [
      field('old', prov({ source: 'answer', observedAt: '2025-01-01' })),
      field('new', prov({ source: 'answer', observedAt: '2025-06-01' })),
    ];
    expect(bestValue(slot)?.value).toBe('new');

    const reversed: Sourced<string> = [
      field('new', prov({ source: 'answer', observedAt: '2025-06-01' })),
      field('old', prov({ source: 'answer', observedAt: '2025-01-01' })),
    ];
    expect(bestValue(reversed)?.value).toBe('new');
  });

  it('a stamped value beats an unstamped one, and a full tie keeps insertion order', () => {
    const stamped: Sourced<string> = [
      field('none', prov({ source: 'answer' })),
      field('stamped', prov({ source: 'answer', observedAt: '2025-06-01' })),
    ];
    expect(bestValue(stamped)?.value).toBe('stamped');

    const tied: Sourced<string> = [
      field('first', prov({ source: 'answer' })),
      field('second', prov({ source: 'answer' })),
    ];
    expect(bestValue(tied)?.value).toBe('first');
  });
});

describe('hasCompetingValues', () => {
  it('is false for zero or one value', () => {
    expect(hasCompetingValues(undefined)).toBe(false);
    expect(hasCompetingValues([field(1, prov({ source: 'answer' }))])).toBe(false);
  });

  it('is true when two sources disagree', () => {
    const slot: Sourced<number> = [
      field(1985, prov({ source: 'self_reported' })),
      field(1951, prov({ source: 'enrichment' })),
    ];
    expect(hasCompetingValues(slot)).toBe(true);
  });

  it('agreeing values within SCORE_TOLERANCE are not competing', () => {
    const slot: Sourced<number> = [
      field(50_000_000, prov({ source: 'self_reported' })),
      field(50_000_000.0000001, prov({ source: 'enrichment' })),
    ];
    expect(hasCompetingValues(slot)).toBe(false);
  });

  it('strings agree after trimming and case folding', () => {
    const slot: Sourced<string> = [
      field('OH', prov({ source: 'self_reported' })),
      field(' oh ', prov({ source: 'enrichment' })),
    ];
    expect(hasCompetingValues(slot)).toBe(false);
  });
});

describe('addValue', () => {
  it('appends without reordering or mutating (PRD 6.2)', () => {
    const first = addValue<number>(undefined, 100, prov({ source: 'self_reported' }));
    const second = addValue(first, 200, prov({ source: 'enrichment' }));
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(2);
    expect(second[0]?.value).toBe(100);
    expect(second[1]?.value).toBe(200);
    expect(second[1]?.provenance.source).toBe('enrichment');
  });
});

describe('combinedConfidence (V-7)', () => {
  it('is 1 with no deciding fields', () => {
    expect(combinedConfidence([])).toBe(1);
  });

  it('multiplies the source confidences', () => {
    const fields: Field<unknown>[] = [
      field(1, prov({ source: 'self_reported' })),
      field(2, prov({ source: 'enrichment' })),
    ];
    expect(combinedConfidence(fields)).toBeCloseTo(0.63, 12);
  });

  it('a sweep contributes its stated confidence', () => {
    const fields: Field<unknown>[] = [
      field(1, prov({ source: 'answer' })),
      field(2, prov({ source: 'sweep', confidence: 0.5 })),
    ];
    expect(combinedConfidence(fields)).toBeCloseTo(0.4, 12);
  });
});

describe('readPath', () => {
  const submission = {
    id: 'S1',
    lineOfBusiness: 'commercial_property',
    pricing: {
      quotedPremium: [field(82_500, prov({ source: 'self_reported' }))],
    },
    buildings: [
      { externalId: 'B1', yearBuilt: [field(1974, prov({ source: 'self_reported' }))] },
      {
        externalId: 'B3',
        yearBuilt: [
          field(1985, prov({ source: 'self_reported' })),
          field(1951, prov({ source: 'enrichment' })),
        ],
      },
    ],
    hazards: {
      present: { candle: [field(true, prov({ source: 'sweep', confidence: 0.8 }))] },
    },
    rollup: { totalTiv: 60_000_000, primaryState: 'OH' },
  };

  it('unwraps a Sourced slot to its best value', () => {
    expect(readPath(submission, 'pricing.quotedPremium')).toBe(82_500);
  });

  it('addresses a building by externalId and resolves its best value', () => {
    expect(readPath(submission, 'buildings.B1.yearBuilt')).toBe(1974);
    expect(readPath(submission, 'buildings.B3.yearBuilt')).toBe(1951);
  });

  it('addresses an array entry by index too', () => {
    expect(readPath(submission, 'buildings.0.yearBuilt')).toBe(1974);
  });

  it('falls back into hazards.present', () => {
    expect(readPath(submission, 'hazards.candle')).toBe(true);
    expect(readPath(submission, 'hazards.present.candle')).toBe(true);
  });

  it('reads plain rollup numbers unchanged', () => {
    expect(readPath(submission, 'rollup.totalTiv')).toBe(60_000_000);
    expect(readPath(submission, 'rollup.primaryState')).toBe('OH');
  });

  it('returns undefined for an absent path, not 0 (G-1)', () => {
    expect(readPath(submission, 'rollup.fiveYearLoss')).toBeUndefined();
    expect(readPath(submission, 'buildings.B9.yearBuilt')).toBeUndefined();
    expect(readPath(submission, '')).toBeUndefined();
    expect(readPath(undefined, 'rollup.totalTiv')).toBeUndefined();
  });
});
