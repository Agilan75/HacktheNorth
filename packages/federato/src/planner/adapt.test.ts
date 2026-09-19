import { describe, expect, it } from 'vitest';
import type { FederatoRecord, QueryClause, QueryPayload } from '../types';
import { applyWhere } from '../mock/where';
import {
  OVER_DECLINED_NOTE,
  declineServerAggregation,
  dropNarrowestFilter,
  nextAdaptation,
  swapToElemMatch,
} from './adapt';

const ARRAYS = ['exposure_units', 'exposure_units.location.buildings', 'claims'];

/** Hydrated policies shaped like the verified deep pass (LIVE_DATA_FACTS). */
const POLICIES: FederatoRecord[] = [
  {
    id: 'p1',
    line_of_business: 'property',
    exposure_units: [
      { location: { state: 'CA', buildings: [{ construction_type: 'Frame', tiv: 1 }] } },
      { location: { state: 'NV', buildings: [] } },
    ],
  },
  {
    id: 'p2',
    line_of_business: 'property',
    exposure_units: [
      { location: { state: 'TX', buildings: [{ construction_type: 'Non-Combustible', tiv: 2 }] } },
    ],
  },
  {
    id: 'p3',
    line_of_business: 'auto',
    exposure_units: [
      { location: { state: 'CA', buildings: [{ construction_type: 'Non-Combustible', tiv: 3 }] } },
    ],
  },
] as unknown as FederatoRecord[];

describe('swapToElemMatch', () => {
  it('rewrites the measured live case exactly', () => {
    const clause: QueryClause = { 'exposure_units.location.state': 'CA' };
    expect(swapToElemMatch(clause, ARRAYS)).toEqual({
      exposure_units: { $elemMatch: { location: { state: 'CA' } } },
    });
  });

  it('turns a zero-row dot-path into the rows the $elemMatch form finds', () => {
    const clause: QueryClause = { 'exposure_units.location.state': 'CA' };
    expect(applyWhere(POLICIES, clause)).toHaveLength(0);
    const swapped = swapToElemMatch(clause, ARRAYS);
    expect(swapped).not.toBeNull();
    expect(applyWhere(POLICIES, swapped ?? {}).map((r) => r.id)).toEqual(['p1', 'p3']);
  });

  it('nests a second $elemMatch at a deeper array boundary and keeps operator bags', () => {
    const clause: QueryClause = {
      'exposure_units.location.buildings.construction_type': { $in: ['Frame'] },
      line_of_business: 'property',
    };
    const swapped = swapToElemMatch(clause, ARRAYS);
    expect(swapped).toEqual({
      exposure_units: {
        $elemMatch: {
          location: { buildings: { $elemMatch: { construction_type: { $in: ['Frame'] } } } },
        },
      },
      line_of_business: 'property',
    });
    expect(applyWhere(POLICIES, swapped ?? {}).map((r) => r.id)).toEqual(['p1']);
  });

  it('recurses into $and / $or / $not', () => {
    const clause: QueryClause = {
      $or: [{ 'exposure_units.location.state': 'TX' }, { id: 'p3' }],
    };
    const swapped = swapToElemMatch(clause, ARRAYS);
    expect(swapped).toEqual({
      $or: [{ exposure_units: { $elemMatch: { location: { state: 'TX' } } } }, { id: 'p3' }],
    });
    expect(applyWhere(POLICIES, swapped ?? {}).map((r) => r.id)).toEqual(['p2', 'p3']);
  });

  it('puts two conditions on the same array into $and instead of overwriting one', () => {
    const swapped = swapToElemMatch(
      { 'exposure_units.location.state': 'CA', 'exposure_units.location.city': 'LA' },
      ARRAYS,
    );
    expect(swapped).toEqual({
      exposure_units: { $elemMatch: { location: { state: 'CA' } } },
      $and: [{ exposure_units: { $elemMatch: { location: { city: 'LA' } } } }],
    });
  });

  it('returns null when nothing crosses an array', () => {
    expect(swapToElemMatch({ 'insured.hq.state': 'CA' }, ARRAYS)).toBeNull();
    expect(swapToElemMatch({ exposure_units: { $exists: true } }, ARRAYS)).toBeNull();
    expect(swapToElemMatch({ 'exposure_units.location.state': 'CA' }, [])).toBeNull();
  });
});

describe('dropNarrowestFilter', () => {
  it('drops the equality before the range and the range before the negation', () => {
    const clause: QueryClause = {
      status: { $ne: 'declined' },
      premium: { $gte: 1000 },
      line_of_business: 'property',
    };
    expect(dropNarrowestFilter(clause)).toEqual({
      status: { $ne: 'declined' },
      premium: { $gte: 1000 },
    });
    expect(dropNarrowestFilter({ status: { $ne: 'declined' }, premium: { $gte: 1000 } })).toEqual({
      status: { $ne: 'declined' },
    });
  });

  it('treats a short $in as narrower than a long one', () => {
    const clause: QueryClause = {
      state: { $in: ['CA', 'NV', 'AZ', 'OR', 'WA'] },
      status: { $in: ['bound'] },
    };
    expect(dropNarrowestFilter(clause)).toEqual({ state: { $in: ['CA', 'NV', 'AZ', 'OR', 'WA'] } });
  });

  it('breaks a tie on the deeper path', () => {
    expect(dropNarrowestFilter({ id: 'p1', 'insured.hq.state': 'CA' })).toEqual({ id: 'p1' });
  });

  it('removes one $and item at a time', () => {
    expect(dropNarrowestFilter({ $and: [{ a: { $exists: true } }, { b: 5 }] })).toEqual({
      $and: [{ a: { $exists: true } }],
    });
  });

  it('refuses to widen a single condition into an unfiltered query', () => {
    expect(dropNarrowestFilter({ line_of_business: 'property' })).toBeNull();
    expect(dropNarrowestFilter({})).toBeNull();
  });
});

describe('nextAdaptation', () => {
  const payload: QueryPayload = {
    resource: 'Policy',
    where: { line_of_business: 'property' },
    filter: { 'exposure_units.location.state': 'CA' },
  };

  it('swaps first, explains the live 0-vs-47 limitation, and loosens nothing', () => {
    const a = nextAdaptation(payload, [], ARRAYS);
    expect(a?.kind).toBe('elem_match_swap');
    expect(a?.payload).toEqual({
      resource: 'Policy',
      where: { line_of_business: 'property' },
      filter: { exposure_units: { $elemMatch: { location: { state: 'CA' } } } },
    });
    expect(a?.why).toContain('`exposure_units.location.state`');
    expect(a?.why).toContain('finds 0');
    expect(a?.why).toContain('finds 47');
    expect(a?.why).toContain('nothing was loosened');
  });

  it('then drops the narrowest condition once, and then gives up', () => {
    const a = nextAdaptation(payload, ['elem_match_swap'], ARRAYS);
    expect(a?.kind).toBe('drop_narrowest_filter');
    // equal score (literal equality): the deeper path loses; filter emptied -> removed
    expect(a?.payload).toEqual({ resource: 'Policy', where: { line_of_business: 'property' } });
    expect(a?.why).toContain('exposure_units.location.state');
    expect(nextAdaptation(payload, ['elem_match_swap', 'drop_narrowest_filter'], ARRAYS)).toBeNull();
  });

  it('skips the swap when no path crosses an array', () => {
    const p: QueryPayload = {
      resource: 'Submission',
      where: { status: { $in: ['lost', 'cleared'] }, line_of_business: 'property' },
    };
    const a = nextAdaptation(p, [], ARRAYS);
    expect(a?.kind).toBe('drop_narrowest_filter');
    expect(a?.payload).toEqual({ resource: 'Submission', where: { status: { $in: ['lost', 'cleared'] } } });
  });

  it('returns null for a payload with one condition and nothing to swap', () => {
    expect(nextAdaptation({ resource: 'Policy', where: { id: 'x' } }, [], ARRAYS)).toBeNull();
    expect(nextAdaptation({ resource: 'Policy' }, [], ARRAYS)).toBeNull();
  });

  it('never carries `over` into a retry and says why', () => {
    const a = nextAdaptation({ ...payload, over: ['line_of_business'] }, [], ARRAYS);
    expect(a?.payload.over).toBeUndefined();
    expect(a?.why).toContain(OVER_DECLINED_NOTE);
  });
});

describe('declineServerAggregation', () => {
  it('strips over and returns the underwriter-facing note with the measured numbers', () => {
    const r = declineServerAggregation({ resource: 'Policy', over: ['line_of_business'] });
    expect(r.payload).toEqual({ resource: 'Policy' });
    expect(r.note).toBe(OVER_DECLINED_NOTE);
    expect(OVER_DECLINED_NOTE).toContain('11,063,900');
    expect(OVER_DECLINED_NOTE).toContain('128,011,000');
    expect(declineServerAggregation({ resource: 'Policy' }).note).toBeNull();
  });
});
