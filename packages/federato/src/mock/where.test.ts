import { describe, expect, it } from 'vitest';
import type { FederatoRecord, QueryClause } from '../types';
import {
  applyWhere,
  deepEqual,
  matchClause,
  matchContains,
  matchElemMatch,
  matchOperators,
  readDotPath,
} from './where';

// fixtures/ sits outside this package's tsconfig rootDir (see
// docs/contracts/requests/F03.md), so the fixture is loaded through a
// non-literal specifier that tsc does not resolve. Vitest resolves it normally.
const FIXTURE_PATH: string = '../../fixtures/mini-snapshot';
const mini = (await import(FIXTURE_PATH)) as {
  readonly MINI_HYDRATED_POLICIES: readonly FederatoRecord[];
  readonly MINI_LOCATIONS: readonly FederatoRecord[];
  readonly MINI_POLICIES: readonly FederatoRecord[];
};
const { MINI_HYDRATED_POLICIES, MINI_LOCATIONS, MINI_POLICIES } = mini;

const ids = (rows: readonly FederatoRecord[]): unknown[] => rows.map((r) => r['id']);

describe('readDotPath', () => {
  const rec = { a: { b: { c: 3 } }, arr: [{ x: 1 }], n: null };
  it('walks nested objects', () => {
    expect(readDotPath(rec, 'a.b.c')).toBe(3);
    expect(readDotPath(rec, 'a.b')).toEqual({ c: 3 });
  });
  it('returns undefined for missing paths and keeps null', () => {
    expect(readDotPath(rec, 'a.z')).toBeUndefined();
    expect(readDotPath(rec, 'n')).toBeNull();
    expect(readDotPath(rec, 'n.deeper')).toBeUndefined();
  });
  it('does not cross arrays', () => {
    expect(readDotPath(rec, 'arr')).toEqual([{ x: 1 }]);
    expect(readDotPath(rec, 'arr.x')).toBeUndefined();
    expect(readDotPath(rec, 'arr.0.x')).toBeUndefined();
  });
});

describe('deepEqual', () => {
  it('compares arrays element-wise and in order', () => {
    expect(deepEqual(['hail', 'wildfire'], ['hail', 'wildfire'])).toBe(true);
    expect(deepEqual(['wildfire', 'hail'], ['hail', 'wildfire'])).toBe(false);
    expect(deepEqual(['hail'], ['hail', 'wildfire'])).toBe(false);
  });
  it('compares objects by keys', () => {
    expect(deepEqual({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
  it('distinguishes null from missing and from scalars in arrays', () => {
    expect(deepEqual(null, undefined)).toBe(false);
    expect(deepEqual('a', ['a'])).toBe(false);
    expect(deepEqual(1, '1')).toBe(false);
  });
});

describe('matchOperators', () => {
  it('ranges are an implicit $and (5000 <= premium < 20000)', () => {
    const ops = { $gte: 5000, $lt: 20000 };
    expect(matchOperators(5000, ops)).toBe(true);
    expect(matchOperators(19999, ops)).toBe(true);
    expect(matchOperators(20000, ops)).toBe(false);
    expect(matchOperators(4999, ops)).toBe(false);
  });
  it('comparisons need same-typed scalars', () => {
    expect(matchOperators('2026-02-01', { $gt: '2026-01-01' })).toBe(true);
    expect(matchOperators('5', { $gt: 1 })).toBe(false);
    expect(matchOperators(null, { $lte: 10 })).toBe(false);
    expect(matchOperators(undefined, { $gte: 0 })).toBe(false);
  });
  it('$eq / $ne use deep equality; $ne matches missing', () => {
    expect(matchOperators(['a', 'b'], { $eq: ['a', 'b'] })).toBe(true);
    expect(matchOperators('expired', { $ne: 'expired' })).toBe(false);
    expect(matchOperators('active', { $ne: 'expired' })).toBe(true);
    expect(matchOperators(undefined, { $ne: 'expired' })).toBe(true);
  });
  it('$exists treats null as present', () => {
    expect(matchOperators(null, { $exists: true })).toBe(true);
    expect(matchOperators(undefined, { $exists: true })).toBe(false);
    expect(matchOperators(undefined, { $exists: false })).toBe(true);
    expect(matchOperators(0, { $exists: false })).toBe(false);
  });
  it('$in / $nin on scalars and arrays', () => {
    expect(matchOperators('lost', { $in: ['lost', 'cleared'] })).toBe(true);
    expect(matchOperators('bound', { $in: ['lost', 'cleared'] })).toBe(false);
    expect(matchOperators(['hail', 'tornado'], { $in: ['earthquake', 'tornado'] })).toBe(true);
    expect(matchOperators(['hail'], { $in: ['earthquake'] })).toBe(false);
    expect(matchOperators(null, { $in: [null] })).toBe(true);
    expect(matchOperators(undefined, { $in: [null] })).toBe(false);
    expect(matchOperators('bound', { $nin: ['lost'] })).toBe(true);
    expect(matchOperators(['hail'], { $nin: ['hail'] })).toBe(false);
    expect(matchOperators(undefined, { $nin: ['lost'] })).toBe(true);
  });
  it('rejects an unknown operator', () => {
    expect(() => matchOperators(1, { $regex: 'x' } as never)).toThrow(/unsupported operator/);
  });
});

describe('matchContains', () => {
  it('substring on strings, case-sensitive', () => {
    expect(matchContains('Harbor Point Brokerage', 'Point')).toBe(true);
    expect(matchContains('Harbor Point Brokerage', 'point')).toBe(false);
  });
  it('element membership on arrays', () => {
    expect(matchContains(['earthquake', 'flood'], 'flood')).toBe(true);
    expect(matchContains(['earthquake', 'flood'], 'flo')).toBe(false);
    expect(matchContains([1, 2, 3], 2)).toBe(true);
  });
  it('missing and null never contain', () => {
    expect(matchContains(undefined, 'x')).toBe(false);
    expect(matchContains(null, 'x')).toBe(false);
  });
});

describe('matchElemMatch', () => {
  it('passes when one element satisfies the whole sub-clause', () => {
    const units = [
      { kind: 'digital_asset', location: { hazard_tags: ['earthquake'] } },
      { kind: 'location', location: { hazard_tags: ['flood'] } },
    ];
    const clause: QueryClause = {
      kind: 'location',
      location: { hazard_tags: { $in: ['earthquake', 'wildfire'] } },
    };
    // Each element matches half the clause; none matches both.
    expect(matchElemMatch(units, clause)).toBe(false);
    expect(matchElemMatch(units, { kind: 'location' })).toBe(true);
  });
  it('supports operator bags against scalar elements', () => {
    expect(matchElemMatch([1, 7, 3], { $gt: 5 } as QueryClause)).toBe(true);
    expect(matchElemMatch([1, 3], { $gt: 5 } as QueryClause)).toBe(false);
  });
  it('is arrays only', () => {
    expect(matchElemMatch({ kind: 'location' }, { kind: 'location' })).toBe(false);
    expect(matchElemMatch(undefined, { kind: 'location' })).toBe(false);
    expect(matchElemMatch([], { kind: 'location' })).toBe(false);
  });
});

describe('matchClause', () => {
  const policy: FederatoRecord = {
    id: 1,
    status: 'active',
    business_type: 'new',
    premium: 150000,
    dates: { effective: '2026-01-01' },
    producer: { broker: 601 },
    hazard_tags: ['hail', 'wildfire'],
    deductible: null,
  };
  it('nesting and dot-paths are equivalent', () => {
    expect(matchClause(policy, { dates: { effective: '2026-01-01' } })).toBe(true);
    expect(matchClause(policy, { 'dates.effective': '2026-01-01' })).toBe(true);
    expect(matchClause(policy, { dates: { effective: '2026-01-02' } })).toBe(false);
  });
  it('an array literal is whole-array equality, not membership', () => {
    expect(matchClause(policy, { hazard_tags: ['hail', 'wildfire'] })).toBe(true);
    expect(matchClause(policy, { hazard_tags: 'hail' })).toBe(false);
  });
  it('null literal matches null but not missing', () => {
    expect(matchClause(policy, { deductible: null })).toBe(true);
    expect(matchClause(policy, { missing_field: null })).toBe(false);
  });
  it('the PDF combinator example', () => {
    const clause: QueryClause = {
      status: 'active',
      $or: [{ business_type: 'renewal' }, { premium: { $gte: 100000 } }],
      $not: { 'producer.broker': 2 },
    };
    expect(matchClause(policy, clause)).toBe(true);
    expect(matchClause({ ...policy, producer: { broker: 2 } }, clause)).toBe(false);
    expect(matchClause({ ...policy, premium: 5000 }, clause)).toBe(false);
    expect(matchClause({ ...policy, premium: 5000, business_type: 'renewal' }, clause)).toBe(true);
    expect(matchClause({ ...policy, status: 'expired' }, clause)).toBe(false);
  });
  it('$and, empty $and, empty $or', () => {
    expect(matchClause(policy, { $and: [{ status: 'active' }, { premium: { $gt: 1 } }] })).toBe(
      true,
    );
    expect(matchClause(policy, { $and: [{ status: 'active' }, { premium: { $gt: 1e9 } }] })).toBe(
      false,
    );
    expect(matchClause(policy, { $and: [] })).toBe(true);
    expect(matchClause(policy, { $or: [] })).toBe(false);
  });
  it('field-level $not wraps an operator bag', () => {
    expect(matchClause(policy, { premium: { $not: { $gt: 100000 } } } as QueryClause)).toBe(false);
    expect(matchClause(policy, { premium: { $not: { $gt: 200000 } } } as QueryClause)).toBe(true);
  });
  it('empty clause matches everything', () => {
    expect(matchClause(policy, {})).toBe(true);
  });
});

describe('applyWhere on the mini snapshot', () => {
  it('undefined clause is a no-op', () => {
    expect(applyWhere(MINI_POLICIES, undefined)).toBe(MINI_POLICIES);
  });
  it('filters flat policies by line of business', () => {
    expect(ids(applyWhere(MINI_POLICIES, { line_of_business: 'property' }))).toEqual([
      9001, 9002, 9005,
    ]);
    expect(ids(applyWhere(MINI_POLICIES, { line_of_business: { $ne: 'property' } }))).toEqual([
      9003,
    ]);
    expect(ids(applyWhere(MINI_POLICIES, { business_type: 'renewal' }))).toEqual([9005]);
    expect(ids(applyWhere(MINI_POLICIES, { premium: { $gte: 200000 } }))).toEqual([9005]);
    expect(ids(applyWhere(MINI_POLICIES, { 'producer.broker': 602 }))).toContain(9005);
  });
  it('reproduces the array pitfall: dot-path through an array returns 0 rows', () => {
    expect(
      applyWhere(MINI_HYDRATED_POLICIES, { 'exposure_units.location.state': 'CA' }),
    ).toHaveLength(0);
  });
  it('$elemMatch crosses the array boundary', () => {
    const ca = applyWhere(MINI_HYDRATED_POLICIES, {
      exposure_units: { $elemMatch: { location: { state: 'CA' } } },
    });
    expect(ids(ca)).toEqual([9001]);
    const targetStates = applyWhere(MINI_HYDRATED_POLICIES, {
      exposure_units: { $elemMatch: { location: { state: { $in: ['CA', 'FL', 'CO'] } } } },
    });
    expect(ids(targetStates)).toEqual([9001, 9002]);
  });
  it('hazard_tags array filters on locations', () => {
    expect(ids(applyWhere(MINI_LOCATIONS, { hazard_tags: { $contains: 'flood' } }))).toEqual([
      401, 402,
    ]);
    expect(ids(applyWhere(MINI_LOCATIONS, { hazard_tags: ['earthquake'] }))).toEqual([404]);
  });
});
