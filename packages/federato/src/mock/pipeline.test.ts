import { describe, expect, it } from 'vitest';
import {
  MINI_BUILDINGS,
  MINI_HYDRATED_POLICIES,
  MINI_NO_POLICY_SUBMISSIONS,
  MINI_RECORDS,
} from '../../fixtures/mini-snapshot';
import type { FederatoRecord } from '../types';
import {
  applyOver,
  applyPagination,
  applySelect,
  applySort,
  applyUnwind,
  buildReferenceIndex,
  runPipeline,
} from './pipeline';

const store = MINI_RECORDS;
const refs = buildReferenceIndex(store);

describe('buildReferenceIndex', () => {
  it('transcribes live-schema references, including nested ones', () => {
    expect(refs.resolve('Policy', 'exposure_units')).toEqual({ target: 'ExposureUnit', many: true });
    expect(refs.resolve('Policy', 'producer.broker')).toEqual({ target: 'Broker', many: false });
    expect(refs.resolve('ExposureUnit', 'underlying_layer.policy')).toEqual({ target: 'Policy', many: false });
    expect(refs.resolve('Insured', 'hq')).toEqual({ target: 'Location', many: false });
    expect(refs.resolve('Policy', 'premium')).toBeNull();
    expect(refs.resolve('Broker', 'name')).toBeNull();
  });
});

describe('expand stage', () => {
  it('reproduces the verified deep property pass exactly', () => {
    const res = runPipeline(
      {
        resource: 'Policy',
        where: { line_of_business: 'property' },
        expand: {
          insured: true,
          submission: true,
          claims: true,
          exposure_units: { location: { buildings: true } },
        },
        pagination: { limit: 200 },
      },
      store,
    );
    expect(res.total).toBe(3);
    expect(res.results).toEqual(MINI_HYDRATED_POLICIES);
    expect(res.groups).toBeUndefined();
  });

  it('reproduces the no-policy follow-up with a string expand shorthand', () => {
    const res = runPipeline(
      {
        resource: 'Submission',
        where: {
          line_of_business: 'property',
          status: { $in: ['lost', 'cleared', 'quoted', 'declined', 'received'] },
        },
        expand: { insured: 'hq', broker: true },
      },
      store,
    );
    expect(res.results).toEqual(MINI_NO_POLICY_SUBMISSIONS);
  });

  it('treats the three nested-reference expand spellings as equivalent', () => {
    const base = { resource: 'Policy' as const, where: { id: 9001 } };
    const a = runPipeline({ ...base, expand: { producer: 'broker' } }, store);
    const b = runPipeline({ ...base, expand: { producer: { broker: true } } }, store);
    const c = runPipeline({ ...base, expand: { producer: { broker: {} } } }, store);
    const producer = (a.results[0] as FederatoRecord)['producer'] as FederatoRecord;
    expect((producer['broker'] as FederatoRecord)['name']).toBe('Harbor Point Brokerage');
    expect(producer['contact']).toBe(701);
    expect(b.results).toEqual(a.results);
    expect(c.results).toEqual(a.results);
  });

  it('lets filter reach through an expanded reference; where cannot', () => {
    const withExpand = runPipeline(
      { resource: 'Policy', expand: { insured: true }, filter: { 'insured.naics_code': '541714' } },
      store,
    );
    expect(withExpand.results.map((r) => r['id'])).toEqual([9001]);
    const withoutExpand = runPipeline(
      { resource: 'Policy', filter: { 'insured.naics_code': '541714' } },
      store,
    );
    expect(withoutExpand.total).toBe(0);
  });
});

describe('unwind stage', () => {
  const rows: FederatoRecord[] = [
    { id: 1, items: [{ v: 1 }, { v: 2 }] },
    { id: 2, items: [] },
    { id: 3, items: null },
  ];

  it('inner drops empty parents (k <= N), left keeps them (N rows)', () => {
    const inner = applyUnwind(rows, [{ path: 'items', type: 'inner' }]);
    expect(inner).toEqual([
      { id: 1, items: { v: 1 } },
      { id: 1, items: { v: 2 } },
    ]);
    const left = applyUnwind(rows, [{ path: 'items', type: 'left' }]);
    expect(left).toEqual([
      { id: 1, items: { v: 1 } },
      { id: 1, items: { v: 2 } },
      { id: 2, items: null },
      { id: 3, items: null },
    ]);
    expect(applyUnwind(rows, ['items'])).toEqual(inner);
    expect(applyUnwind(rows, undefined)).toBe(rows);
  });

  it('chains nested unwinds down to one row per building', () => {
    const res = runPipeline(
      {
        resource: 'Policy',
        where: { line_of_business: 'property' },
        expand: { exposure_units: { location: { buildings: true } } },
        unwind: ['exposure_units', 'exposure_units.location.buildings'],
        filter: { 'exposure_units.location.buildings.year_built': { $lte: 1990 } },
        select: ['id', 'exposure_units.location.buildings.id'],
      },
      store,
    );
    expect(res.total).toBe(2);
    expect(res.results).toEqual([
      { id: 9002, exposure_units: { location: { buildings: { id: 503 } } } },
      { id: 9005, exposure_units: { location: { buildings: { id: 505 } } } },
    ]);
  });
});

describe('select stage', () => {
  it('array and object projection forms are equivalent', () => {
    const a = runPipeline(
      { resource: 'Policy', where: { id: 9001 }, select: ['id', 'status', 'dates.effective'] },
      store,
    );
    const b = runPipeline(
      {
        resource: 'Policy',
        where: { id: 9001 },
        select: { id: true, status: true, dates: { effective: true } },
      },
      store,
    );
    expect(a.results).toEqual([{ id: 9001, status: 'active', dates: { effective: '2026-01-01' } }]);
    expect(b.results).toEqual(a.results);
  });

  it('$expand leaf resolves in the output only, with a nested select', () => {
    const res = runPipeline(
      {
        resource: 'Policy',
        where: { id: 9002 },
        select: {
          policy_number: true,
          producer: { broker: { $expand: { select: ['name'] } } },
          exposure_units: { $expand: { select: { kind: true, location: { $expand: { select: ['state'] } } } } },
        },
      },
      store,
    );
    expect(res.results).toEqual([
      {
        policy_number: 'POL-9002',
        producer: { broker: { name: 'Lakeside Risk Partners' } },
        exposure_units: [{ kind: 'location', location: { state: 'FL' } }],
      },
    ]);
  });

  it('applySelect without a resource infers unambiguous references', () => {
    const out = applySelect(
      [{ id: 1, insured: 301 }],
      { insured: { $expand: { select: ['name'] } } },
      store,
      refs,
    );
    expect(out).toEqual([{ insured: { name: 'Northgate Biotech Holdings' } }]);
  });

  it('reductions without over group by id (default), so unwound fleets fold back', () => {
    const res = runPipeline(
      {
        resource: 'Policy',
        where: { line_of_business: 'property' },
        expand: { exposure_units: { location: { buildings: true } } },
        unwind: ['exposure_units', 'exposure_units.location.buildings'],
        select: {
          id: true,
          buildings: { $count: true },
          tiv: { $sum: 'exposure_units.location.buildings.tiv' },
          oldest: { $min: 'exposure_units.location.buildings.year_built' },
          newest: { $max: 'exposure_units.location.buildings.year_built' },
          avgTiv: { $avg: 'exposure_units.location.buildings.tiv' },
        },
        sort: [{ field: 'tiv', direction: 'desc' }],
      },
      store,
    );
    expect(res.total).toBe(3);
    expect(res.results).toEqual([
      { id: 9001, buildings: 2, tiv: 65000000, oldest: 2012, newest: 2015, avgTiv: 32500000 },
      { id: 9002, buildings: 2, tiv: 50000000, oldest: 1978, newest: 2005, avgTiv: 25000000 },
      { id: 9005, buildings: 1, tiv: 18000000, oldest: 1968, newest: 1968, avgTiv: 18000000 },
    ]);
  });

  it('reductions follow the PDF edge rules', () => {
    const rows: FederatoRecord[] = [
      { id: 1, x: null, s: 'a' },
      { id: 1, x: 'n/a', s: 'a' },
      { id: 1, s: null },
    ];
    const grouped = applyOver(rows, undefined, { c: { $count: true } });
    expect(grouped).toHaveLength(1);
    const [out] = applySelect(
      grouped,
      {
        count: { $count: true },
        sum: { $sum: 'x' },
        avg: { $avg: 'x' },
        min: { $min: 'missing' },
        distinct: { $countDistinct: 's' },
      },
      store,
      refs,
    );
    // $count counts every row, nulls included; $sum of nothing = 0; $avg / $min of nothing = null.
    expect(out).toEqual({ count: 3, sum: 0, avg: null, min: null, distinct: 1 });
  });

  it('a reduction path crossing an array sums every element', () => {
    const res = runPipeline(
      {
        resource: 'Policy',
        where: { id: 9002 },
        expand: { exposure_units: { location: { buildings: true } } },
        select: { totalTiv: { $sum: 'exposure_units.location.buildings.tiv' } },
      },
      store,
    );
    expect(res.results).toEqual([{ totalTiv: 50000000 }]);
  });
});

describe('over stage (mock-only; the live handler does not partition)', () => {
  it('groups like the PDF: flat projections in first-seen order', () => {
    const res = runPipeline(
      {
        resource: 'Policy',
        over: ['line_of_business'],
        select: {
          line_of_business: true,
          policies: { $count: true },
          premium: { $sum: 'premium' },
        },
      },
      store,
    );
    const expected = [
      { line_of_business: 'property', policies: 3, premium: 448000 },
      { line_of_business: 'cyber', policies: 1, premium: 64000 },
    ];
    expect(res.total).toBe(2);
    expect(res.groups).toEqual(expected);
    expect(res.results).toEqual(expected);
  });

  it('sorts on derived fields and paginates groups; countDistinct over tuples', () => {
    const res = runPipeline(
      {
        resource: 'Policy',
        expand: { producer: { broker: true } },
        over: ['producer.broker.id'],
        select: {
          producer: { broker: { name: true } },
          totalPremium: { $sum: 'premium' },
          pairs: { $countDistinct: ['id', 'insured'] },
        },
        sort: [{ field: 'totalPremium', direction: 'desc' }],
        pagination: { limit: 1 },
      },
      store,
    );
    expect(res.total).toBe(2);
    expect(res.results).toEqual([
      { producer: { broker: { name: 'Lakeside Risk Partners' } }, totalPremium: 360000, pairs: 2 },
    ]);
  });

  it('is a no-op with no over and no reduction; group metadata never serialises', () => {
    const rows: FederatoRecord[] = [{ id: 1 }, { id: 1 }];
    expect(applyOver(rows, undefined, ['id'])).toBe(rows);
    const grouped = applyOver(rows, ['id'], undefined);
    expect(JSON.parse(JSON.stringify(grouped))).toEqual([{ id: 1 }]);
    expect(applySelect(grouped, undefined, store, refs)).toEqual([{ id: 1 }]);
  });
});

describe('sort + pagination', () => {
  const rows: FederatoRecord[] = [
    { id: 1, p: 5, n: 'b' },
    { id: 2, p: null, n: 'a' },
    { id: 3, p: 9, n: 'a' },
    { id: 4, n: 'c' },
    { id: 5, p: 5, n: 'a' },
  ];

  it('applies rules in priority order, asc default, nulls last in both directions', () => {
    expect(applySort(rows, [{ field: 'p' }, { field: 'n' }]).map((r) => r['id'])).toEqual([5, 1, 3, 2, 4]);
    expect(
      applySort(rows, [{ field: 'p', direction: 'desc' }, { field: 'id', direction: 'desc' }]).map((r) => r['id']),
    ).toEqual([3, 5, 1, 4, 2]);
  });

  it('limit/offset slice; total ignores pagination', () => {
    expect(applyPagination(rows, { limit: 2, offset: 1 }).map((r) => r['id'])).toEqual([2, 3]);
    expect(applyPagination(rows, { offset: 4 }).map((r) => r['id'])).toEqual([5]);
    expect(applyPagination(rows, { limit: 0 })).toEqual([]);
    const res = runPipeline(
      { resource: 'Building', sort: [{ field: 'tiv', direction: 'desc' }], pagination: { limit: 2, offset: 1 } },
      store,
    );
    expect(res.total).toBe(MINI_BUILDINGS.length);
    expect(res.results.map((r) => r['id'])).toEqual([504, 502]);
  });
});
