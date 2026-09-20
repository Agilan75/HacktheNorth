import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from './client';
import type { DbHandle } from './client';
import { migrate } from './migrate';
import { createRepos } from './repos';
import type { Repos } from './repos';
import type { NewActionRow, NewSubmissionRow } from './schema';

const T0 = '2026-09-19T00:00:00.000Z';
const T1 = '2026-09-19T01:00:00.000Z';

function sub(n: number, over: Partial<NewSubmissionRow> = {}): NewSubmissionRow {
  return {
    id: `s${n}`,
    source: 'federato',
    lineOfBusiness: n % 2 === 0 ? 'tenant' : 'commercial_property',
    externalId: `SUB-${String(n).padStart(3, '0')}`,
    insuredName: `Insured ${n}`,
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

function act(n: number, over: Partial<NewActionRow> = {}): NewActionRow {
  return {
    id: `a${n}`,
    submissionId: 's1',
    type: 'request',
    status: 'draft',
    payload: { draft: null, fields: [] },
    createdAt: `2026-09-19T00:00:0${n}.000Z`,
    ...over,
  };
}

let handle: DbHandle;
let repos: Repos;

beforeEach(() => {
  handle = createDb({ url: ':memory:' });
  migrate(handle);
  repos = createRepos(handle.db);
});

describe('submissions', () => {
  it('upsertByExternalId is idempotent: same externalId keeps one row, the original id and createdAt', () => {
    const first = repos.submissions.upsertByExternalId(sub(1, { shareSlug: 'abc123', rank: 4 }));
    expect(first.queryTrace).toEqual([]);
    const second = repos.submissions.upsertByExternalId(
      sub(1, {
        id: 'different-id',
        insuredName: 'Renamed',
        createdAt: T1,
        updatedAt: T1,
        shareSlug: null,
        rank: null,
        result: { decision: 'x' } as never,
      }),
    );
    expect(second.id).toBe('s1');
    expect(second.createdAt).toBe(T0);
    expect(second.updatedAt).toBe(T1);
    expect(second.insuredName).toBe('Renamed');
    expect(second.shareSlug).toBe('abc123');
    expect(second.rank).toBe(4);
    expect(second.result).toEqual({ decision: 'x' });
    expect(repos.submissions.all()).toHaveLength(1);
    expect(repos.submissions.byId('different-id')).toBeNull();
  });

  it('round-trips JSON columns unchanged', () => {
    const raw = { submission: { submission_number: 'SUB-001', tiv: 1234567.89 }, nested: [1, null, 'x'] };
    repos.submissions.upsertByExternalId(sub(1, { raw: raw as never, queryTrace: [{ q: 1 } as never] }));
    const got = repos.submissions.byExternalId('SUB-001');
    expect(got?.raw).toEqual(raw);
    expect(got?.queryTrace).toEqual([{ q: 1 }]);
    expect(got?.canonical).toBeNull();
  });

  it('looks up by share slug', () => {
    repos.submissions.upsertByExternalId(sub(1));
    repos.submissions.update('s1', { shareSlug: 'k9x' });
    expect(repos.submissions.byShareSlug('k9x')?.id).toBe('s1');
    expect(repos.submissions.byShareSlug('nope')).toBeNull();
  });

  it('lists in rank order, unranked last, with filter, paging and total', () => {
    for (let n = 1; n <= 6; n += 1) repos.submissions.upsertByExternalId(sub(n));
    repos.submissions.setRanks([
      { id: 's4', rank: 1 },
      { id: 's2', rank: 2 },
      { id: 's5', rank: 3 },
    ]);
    expect(repos.submissions.all().map((r) => r.id)).toEqual(['s4', 's2', 's5', 's1', 's3', 's6']);

    const page = repos.submissions.list({ limit: 2, offset: 1 });
    expect(page.total).toBe(6);
    expect(page.rows.map((r) => r.id)).toEqual(['s2', 's5']);

    const tenants = repos.submissions.list({ lineOfBusiness: 'tenant' });
    expect(tenants.total).toBe(3);
    expect(tenants.rows.map((r) => r.id)).toEqual(['s4', 's2', 's6']);

    expect(repos.submissions.list({ offset: 5 }).rows.map((r) => r.id)).toEqual(['s6']);
  });

  it('update patches only the given fields and throws on an unknown id', () => {
    repos.submissions.upsertByExternalId(sub(1));
    const updated = repos.submissions.update('s1', { rank: 7, updatedAt: T1, insuredName: undefined });
    expect(updated.rank).toBe(7);
    expect(updated.insuredName).toBe('Insured 1');
    expect(repos.submissions.update('s1', {}).rank).toBe(7);
    expect(() => repos.submissions.update('missing', { rank: 1 })).toThrow(/missing/);
    expect(() => repos.submissions.update('missing', {})).toThrow(/missing/);
  });

  it('rejects a duplicate share slug', () => {
    repos.submissions.upsertByExternalId(sub(1, { shareSlug: 'dup' }));
    expect(() => repos.submissions.upsertByExternalId(sub(2, { shareSlug: 'dup' }))).toThrow();
  });
});

describe('sweeps', () => {
  it('inserts with defaults, updates stage, lists by submission in creation order', () => {
    const s = repos.sweeps.insert({
      id: 'w2',
      submissionId: 's1',
      roomLabel: 'Kitchen',
      term: 8,
      stage: 'received',
      createdAt: T1,
      updatedAt: T1,
    });
    expect(s.frames).toEqual([]);
    expect(s.frameQuality).toEqual([]);
    expect(s.observations).toEqual([]);
    expect(s.coverage).toBeNull();
    repos.sweeps.insert({ id: 'w1', submissionId: 's1', roomLabel: 'Hall', term: 4, stage: 'received', createdAt: T0, updatedAt: T0 });
    repos.sweeps.insert({ id: 'w3', submissionId: null, roomLabel: 'Renter', term: 12, stage: 'received', createdAt: T0, updatedAt: T0 });

    const next = repos.sweeps.update('w2', { stage: 'observing', frameQuality: [0.9, null, 0.42] });
    expect(next.stage).toBe('observing');
    expect(next.frameQuality).toEqual([0.9, null, 0.42]);
    expect(next.roomLabel).toBe('Kitchen');

    expect(repos.sweeps.bySubmissionId('s1').map((r) => r.id)).toEqual(['w1', 'w2']);
    expect(repos.sweeps.byId('w3')?.submissionId).toBeNull();
    expect(repos.sweeps.byId('zz')).toBeNull();
    expect(() => repos.sweeps.update('zz', { stage: 'observing' })).toThrow();
  });
});

describe('enrichments', () => {
  it('upserts one row per (submission, source), keeping the first id', () => {
    const a = repos.enrichments.upsert({ id: 'e1', submissionId: 's1', source: 'openfema_flood', payload: { zone: 'X' }, createdAt: T0 });
    expect(a.available).toBe(true);
    const b = repos.enrichments.upsert({
      id: 'e9',
      submissionId: 's1',
      source: 'openfema_flood',
      payload: { zone: 'AE' },
      available: false,
      createdAt: T1,
    });
    expect(b.id).toBe('e1');
    expect(b.payload).toEqual({ zone: 'AE' });
    expect(b.available).toBe(false);
    repos.enrichments.upsert({ id: 'e2', submissionId: 's1', source: 'nominatim_geocode', payload: {}, createdAt: T0 });
    repos.enrichments.upsert({ id: 'e3', submissionId: 's2', source: 'openfema_flood', payload: {}, createdAt: T0 });
    expect(repos.enrichments.bySubmissionId('s1').map((r) => r.source)).toEqual(['nominatim_geocode', 'openfema_flood']);
  });
});

describe('actions', () => {
  it('inserts with actor default, updates, and lists newest first with filters and total', () => {
    const first = repos.actions.insert(act(1));
    expect(first.actor).toBe('code');
    expect(first.before).toBeNull();
    repos.actions.insert(act(2, { type: 'route', status: 'applied' }));
    repos.actions.insert(act(3, { submissionId: 's2' }));
    repos.actions.insert(act(4, { status: 'sent', actor: 'underwriter' }));

    const approved = repos.actions.update('a1', {
      status: 'approved',
      before: { rank: 12 } as never,
      payload: { draft: 'Please send the roof year.', rankBefore: 12 },
    });
    expect(approved.status).toBe('approved');
    expect(approved.before).toEqual({ rank: 12 });
    expect(approved.payload.draft).toBe('Please send the roof year.');
    expect(approved.type).toBe('request');

    const all = repos.actions.list({});
    expect(all.total).toBe(4);
    expect(all.rows.map((r) => r.id)).toEqual(['a4', 'a3', 'a2', 'a1']);
    expect(repos.actions.list({ type: 'request', submissionId: 's1' }).rows.map((r) => r.id)).toEqual(['a4', 'a1']);
    expect(repos.actions.list({ status: 'approved' }).total).toBe(1);
    const paged = repos.actions.list({ limit: 1, offset: 1 });
    expect(paged.rows.map((r) => r.id)).toEqual(['a3']);
    expect(paged.total).toBe(4);
    expect(repos.actions.byId('nope')).toBeNull();
    expect(() => repos.actions.update('nope', { status: 'sent' })).toThrow();
  });
});
