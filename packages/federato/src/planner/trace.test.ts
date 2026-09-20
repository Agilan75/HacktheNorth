import { describe, expect, it } from 'vitest';
import type { TracePathChoice } from '../types';
import { OVER_DECLINED_NOTE } from './adapt';
import { createTraceRecorder } from './trace';

const PATH: TracePathChoice = {
  rootResource: 'Policy',
  path: ['exposure_units', 'location', 'buildings'],
  why: 'Submission has no premium or TIV and no reverse reference to Policy.',
  alternativesRejected: [],
};

function fakeClock(start: number) {
  let t = start;
  return { clock: () => t, advance: (ms: number) => { t += ms; } };
}

describe('createTraceRecorder', () => {
  it('stamps ids, seq, startedAt and duration from the injected clock', () => {
    const c = fakeClock(1000);
    const rec = createTraceRecorder({
      adapterKind: 'mock',
      clock: c.clock,
      now: '2026-09-19T12:00:00.000Z',
      idPrefix: 'run1',
    });
    c.advance(5);
    const a = rec.begin({
      pass: 'triage',
      goal: 'Knock out non-property submissions',
      requiredBy: [{ ruleId: 'lob', factor: null, canonicalPath: 'lineOfBusiness', why: 'appetite' }],
      pathChosen: PATH,
      payload: { resource: 'Submission', select: ['id', 'status', 'line_of_business'] },
    });
    c.advance(120);
    rec.finish(a, { rowCount: 158, totalAvailable: 158 });
    c.advance(10);
    const b = rec.begin({
      pass: 'deep',
      goal: 'Hydrate property policies',
      requiredBy: [],
      pathChosen: PATH,
      payload: { resource: 'Policy', filter: { 'exposure_units.location.state': 'CA' } },
    });
    c.advance(1400);
    rec.finish(b, { rowCount: 0, totalAvailable: 0 });

    const [e0, e1] = rec.entries();
    expect(a).toBe('run1-000');
    expect(b).toBe('run1-001');
    expect(e0).toMatchObject({
      seq: 0,
      pass: 'triage',
      rowCount: 158,
      totalAvailable: 158,
      durationMs: 120,
      startedAt: '2026-09-19T12:00:00.005Z',
      outcome: 'ok',
      adapterKind: 'mock',
      adaptedFrom: null,
      adaptation: 'none',
      error: null,
      notes: [],
    });
    expect(e0?.requiredBy).toHaveLength(1);
    expect(e1).toMatchObject({
      seq: 1,
      durationMs: 1400,
      startedAt: '2026-09-19T12:00:00.135Z',
      outcome: 'empty',
    });
  });

  it('links an adapt retry to the query it replaced and keeps notes in order, de-duplicated', () => {
    const c = fakeClock(0);
    const rec = createTraceRecorder({ adapterKind: 'live', clock: c.clock, now: '2026-09-19T00:00:00.000Z' });
    const first = rec.begin({ pass: 'deep', goal: 'g', requiredBy: [], pathChosen: PATH, payload: { resource: 'Policy' } });
    rec.finish(first, { rowCount: 0, totalAvailable: 0 });
    const retry = rec.begin({
      pass: 'adapt_retry',
      goal: 'g',
      requiredBy: [],
      pathChosen: PATH,
      payload: { resource: 'Policy' },
      adaptedFrom: first,
      adaptation: 'elem_match_swap',
    });
    rec.note(retry, 'swapped to $elemMatch');
    rec.note(retry, 'swapped to $elemMatch');
    rec.finish(retry, { rowCount: 47, totalAvailable: 47, notes: ['47 rows'] });
    const e = rec.entries()[1];
    expect(e?.adaptedFrom).toBe('q-000');
    expect(e?.adaptation).toBe('elem_match_swap');
    expect(e?.notes).toEqual(['swapped to $elemMatch', '47 rows']);
    expect(e?.outcome).toBe('ok');
  });

  it('records errors with a null total and marks unfinished queries honestly', () => {
    const rec = createTraceRecorder({ adapterKind: 'live', clock: () => 0, now: '2026-09-19T00:00:00.000Z' });
    const a = rec.begin({ pass: 'deep', goal: 'g', requiredBy: [], pathChosen: PATH, payload: { resource: 'Policy' } });
    const err = { code: 'BAD_REQUEST', message: 'bad', httpStatus: 400, raw: '[BAD_REQUEST] bad' };
    rec.finish(a, { rowCount: 0, totalAvailable: 12, error: err });
    rec.begin({ pass: 'deep', goal: 'g2', requiredBy: [], pathChosen: PATH, payload: { resource: 'Policy' } });
    const [e0, e1] = rec.entries();
    expect(e0).toMatchObject({ outcome: 'error', totalAvailable: null, error: err });
    expect(e1?.outcome).toBe('error');
    expect(e1?.error?.code).toBe('UNFINISHED');
  });

  it('adds the declined-aggregation note whenever a payload carries over', () => {
    const rec = createTraceRecorder({ adapterKind: 'mock', clock: () => 0, now: '2026-09-19T00:00:00.000Z' });
    const id = rec.begin({
      pass: 'deep',
      goal: 'Premium by line',
      requiredBy: [],
      pathChosen: PATH,
      payload: { resource: 'Policy', over: ['line_of_business'] },
    });
    expect(rec.entries()[0]?.notes).toEqual([OVER_DECLINED_NOTE]);
    rec.note(id, OVER_DECLINED_NOTE);
    expect(rec.entries()[0]?.notes).toHaveLength(1);
  });

  it('snapshots the payload so later mutation cannot rewrite history', () => {
    const rec = createTraceRecorder({ adapterKind: 'mock', clock: () => 0, now: '2026-09-19T00:00:00.000Z' });
    const where: { id: string } = { id: 'a' };
    rec.begin({ pass: 'deep', goal: 'g', requiredBy: [], pathChosen: PATH, payload: { resource: 'Policy', where } });
    where.id = 'b';
    expect(rec.entries()[0]?.payload.where).toEqual({ id: 'a' });
  });

  it('rejects unknown ids, double finishes and a bad base stamp', () => {
    const rec = createTraceRecorder({ adapterKind: 'mock', clock: () => 0, now: '2026-09-19T00:00:00.000Z' });
    expect(() => rec.finish('nope', { rowCount: 0, totalAvailable: 0 })).toThrow(/unknown trace id/);
    expect(() => rec.note('nope', 'x')).toThrow(/unknown trace id/);
    const id = rec.begin({ pass: 'deep', goal: 'g', requiredBy: [], pathChosen: PATH, payload: { resource: 'Policy' } });
    rec.finish(id, { rowCount: 1, totalAvailable: 1 });
    expect(() => rec.finish(id, { rowCount: 1, totalAvailable: 1 })).toThrow(/already finished/);
    expect(() => createTraceRecorder({ adapterKind: 'mock', now: 'yesterday' })).toThrow(/ISO-8601/);
  });
});
