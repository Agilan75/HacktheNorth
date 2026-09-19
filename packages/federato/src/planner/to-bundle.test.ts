import { describe, expect, it } from 'vitest';
import {
  MINI_FETCHED_AT,
  MINI_HYDRATED_POLICIES,
  MINI_NO_POLICY_SUBMISSIONS,
  MINI_POLICIES,
  MINI_SCHEMA,
  MINI_SUBMISSIONS,
} from '../../fixtures/mini-snapshot';
import type { TriageSurvivor } from '../types';
import { triageRows } from './plan';
import { externalIdOf, toBundles } from './to-bundle';

const INPUT = {
  locate: { located: [], unmapped: [], fieldMap: { entries: [], unmapped: [] }, assistUsed: false },
  lineOfBusiness: 'commercial_property',
} as const;

const { survivors } = triageRows(MINI_SUBMISSIONS, INPUT);

const FOLLOW_UP_9001 = {
  id: 9001,
  submission: MINI_SUBMISSIONS[0]!,
  coverages: [{ id: 101, code: 'PROP-BLDG', limit_aggregate: 65000000 }],
  producer: { broker: { id: 601, name: 'Harbor Point Brokerage' }, contact: { id: 701 } },
};

const bundles = toBundles({
  policies: MINI_HYDRATED_POLICIES,
  noPolicySubmissions: MINI_NO_POLICY_SUBMISSIONS,
  followUps: [FOLLOW_UP_9001],
  survivors,
  schema: MINI_SCHEMA,
  fetchedAt: MINI_FETCHED_AT,
  queryTraceIds: ['q0', 'q1', 'q2'],
});

const bundle = (id: string) => {
  const b = bundles.find((x) => x.externalId === id);
  if (b === undefined) throw new Error(`no bundle ${id}`);
  return b;
};

describe('externalIdOf', () => {
  it('uses the submission number, never the policy id', () => {
    expect(externalIdOf(MINI_SUBMISSIONS[0]!)).toBe('SUB-1001');
    expect(externalIdOf(MINI_HYDRATED_POLICIES[0]!)).toBe('SUB-1001');
    expect(MINI_HYDRATED_POLICIES.map(externalIdOf)).toEqual(['SUB-1001', 'SUB-1002', 'SUB-1005']);
  });

  it('falls back to the numeric submission id when the number is absent', () => {
    // An un-hydrated policy row only has the submission id.
    expect(externalIdOf(MINI_POLICIES[0]!)).toBe('submission:1001');
    expect(externalIdOf({ id: 1001, submission_number: null })).toBe('submission:1001');
  });

  it('throws on a record with no identity at all', () => {
    expect(() => externalIdOf({ name: 'x' })).toThrow();
    expect(() => externalIdOf({ id: 5, submission: null })).toThrow();
  });
});

describe('toBundles', () => {
  it('emits one bundle per surviving submission, in triage order', () => {
    expect(bundles.map((b) => b.externalId)).toEqual(['SUB-1001', 'SUB-1002', 'SUB-1004', 'SUB-1005']);
    expect(bundles.every((b) => b.lineOfBusiness === 'commercial_property')).toBe(true);
    expect(bundles.every((b) => b.fetchedAt === MINI_FETCHED_AT && b.schema === MINI_SCHEMA)).toBe(true);
    expect(bundles[0]!.queryTraceIds).toEqual(['q0', 'q1', 'q2']);
  });

  it('never bundles the knocked-out cyber account', () => {
    expect(bundles.some((b) => b.externalId === 'SUB-1003')).toBe(false);
  });

  it('puts the hydrated policy under Policy, with buildings reachable', () => {
    const b = bundle('SUB-1002');
    // The deep pass expanded claims, so the bundle marks the claims list fetched (I-4, W0-2.8).
    expect(Object.keys(b.records)).toEqual(['Policy', 'Claim']);
    expect(b.records['Claim']).toEqual([]);
    const [rec] = b.records['Policy']!;
    expect(rec!.resource).toBe('Policy');
    expect(rec!.id).toBe(9002);
    const data = rec!.data as { premium: number; exposure_units: { location: { buildings: { year_built: number; tiv: number }[] } }[] };
    expect(data.premium).toBe(120000);
    const buildings = data.exposure_units.flatMap((u) => u.location.buildings);
    expect(buildings.map((x) => x.year_built)).toEqual([1978, 2005]);
    // 1978 building at 20M of 50M TIV = 40%: the REFER path, not the >50% knockout.
    const tiv = buildings.reduce((s, x) => s + x.tiv, 0);
    expect(tiv).toBe(50000000);
  });

  it('appends high-scorer follow-up rows to the same account', () => {
    const recs = bundle('SUB-1001').records['Policy']!;
    expect(recs).toHaveLength(2);
    expect(recs.map((r) => r.id)).toEqual([9001, 9001]);
    expect((recs[1]!.data as { coverages: unknown[] }).coverages).toHaveLength(1);
    expect(bundle('SUB-1005').records['Policy']).toHaveLength(1);
  });

  it('puts the no-policy submission under Submission with insured -> hq', () => {
    const b = bundle('SUB-1004');
    expect(Object.keys(b.records)).toEqual(['Submission']);
    const [rec] = b.records['Submission']!;
    expect(rec!.id).toBe(1004);
    const data = rec!.data as { status: string; insured: { hq: { state: string } } };
    expect(data.status).toBe('lost');
    expect(data.insured.hq.state).toBe('CA');
  });

  it('keeps a survivor that no pass returned, carrying its triage row', () => {
    const orphan: TriageSurvivor = { externalId: 'SUB-9999', submissionId: 9999, lineOfBusiness: 'property', status: 'received' };
    const [b] = toBundles({
      policies: [],
      noPolicySubmissions: [],
      followUps: [],
      survivors: [orphan],
      schema: MINI_SCHEMA,
      fetchedAt: MINI_FETCHED_AT,
      queryTraceIds: [],
    });
    expect(b!.externalId).toBe('SUB-9999');
    expect(b!.lineOfBusiness).toBe('commercial_property');
    expect(b!.records['Submission']![0]!.data).toEqual({
      id: 9999,
      submission_number: 'SUB-9999',
      status: 'received',
      line_of_business: 'property',
    });
  });

  it('does not drop a hydrated policy that triage did not list', () => {
    const out = toBundles({
      policies: MINI_HYDRATED_POLICIES,
      noPolicySubmissions: [],
      followUps: [],
      survivors: [],
      schema: MINI_SCHEMA,
      fetchedAt: MINI_FETCHED_AT,
      queryTraceIds: [],
    });
    expect(out.map((b) => b.externalId)).toEqual(['SUB-1001', 'SUB-1002', 'SUB-1005']);
  });

  it('is deterministic', () => {
    const again = toBundles({
      policies: [...MINI_HYDRATED_POLICIES].reverse(),
      noPolicySubmissions: MINI_NO_POLICY_SUBMISSIONS,
      followUps: [FOLLOW_UP_9001],
      survivors,
      schema: MINI_SCHEMA,
      fetchedAt: MINI_FETCHED_AT,
      queryTraceIds: ['q0', 'q1', 'q2'],
    });
    expect(again).toEqual(bundles);
  });

  // R1-1 / R2-2 / R3-6: a hydrated policy with `claims: []` must read as a
  // fetched, empty claims list, not as claims never fetched.
  it('marks the claims list fetched when a hydrated policy has an empty claims array', () => {
    const out = toBundles({
      policies: [{ ...MINI_HYDRATED_POLICIES[0]!, claims: [] }],
      noPolicySubmissions: [],
      followUps: [],
      survivors: [],
      schema: MINI_SCHEMA,
      fetchedAt: MINI_FETCHED_AT,
      queryTraceIds: [],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.records['Claim']).toEqual([]);
  });

  it('does not mark claims fetched when the policy row holds only unexpanded claim ids', () => {
    const out = toBundles({
      policies: [{ ...MINI_HYDRATED_POLICIES[0]!, claims: [1101] }],
      noPolicySubmissions: [],
      followUps: [],
      survivors: [],
      schema: MINI_SCHEMA,
      fetchedAt: MINI_FETCHED_AT,
      queryTraceIds: [],
    });
    expect(Object.keys(out[0]!.records)).toEqual(['Policy']);
  });

  it('never marks claims fetched on a no-policy Submission bundle', () => {
    for (const b of bundles) {
      if (b.records['Submission'] !== undefined) expect(b.records['Claim']).toBeUndefined();
    }
  });
});
