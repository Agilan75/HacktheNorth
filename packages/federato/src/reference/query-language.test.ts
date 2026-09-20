import { describe, expect, it } from 'vitest';
import { QUERY_STAGES } from '../types';
import { queryLanguageNotes } from './query-language';

describe('QUERY_REQUEST_BODY.pdf notes', () => {
  const notes = queryLanguageNotes();

  it('covers every pipeline stage plus operators, combinators and references', () => {
    const stages = new Set(notes.map((n) => n.stage));
    for (const s of QUERY_STAGES) expect(stages).toContain(s);
    expect(stages).toContain('operators');
    expect(stages).toContain('combinators');
    expect(stages).toContain('references');
  });

  it('has unique ids and pages inside the 7-page PDF', () => {
    expect(new Set(notes.map((n) => n.id)).size).toBe(notes.length);
    for (const n of notes) {
      expect(n.page).toBeGreaterThanOrEqual(1);
      expect(n.page).toBeLessThanOrEqual(7);
      expect(n.quote.trim()).not.toBe('');
      expect(n.implementation.trim()).not.toBe('');
    }
  });

  it('states the pipeline in QUERY_STAGES order', () => {
    const pipeline = notes.find((n) => n.id === 'pipeline-order')!;
    const positions = ['where', 'expand', 'unwind', 'filter', 'over', 'select', 'sort', 'paginate'].map((s) =>
      pipeline.quote.indexOf(`${s} (`),
    );
    for (const p of positions) expect(p).toBeGreaterThanOrEqual(0);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('lists all eleven operators on page 2', () => {
    const ops = notes.find((n) => n.stage === 'operators')!;
    expect(ops.page).toBe(2);
    for (const op of ['$eq', '$ne', '$exists', '$gt', '$gte', '$lt', '$lte', '$in', '$nin', '$contains', '$elemMatch']) {
      expect(ops.quote).toContain(op);
    }
  });

  it('records the over deviation from LIVE_DATA_FACTS', () => {
    const over = notes.filter((n) => n.stage === 'over');
    expect(over).toHaveLength(1);
    expect(over[0]!.implementation).toMatch(/never emitted/);
    expect(over[0]!.quote).toContain('Much like SQL GROUP BY');
  });

  it('records the aggregation edge rules', () => {
    const agg = notes.find((n) => n.id === 'aggregations')!;
    expect(agg.quote).toContain('Sum of nothing = 0');
    expect(agg.quote).toContain('Average of nothing = null');
    expect(agg.quote).toContain('Counts every row, nulls included');
  });
});
