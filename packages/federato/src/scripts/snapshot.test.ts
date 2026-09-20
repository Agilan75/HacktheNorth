import { describe, expect, it } from 'vitest';
import {
  MINI_COUNTS,
  MINI_HYDRATED_POLICIES,
  MINI_POLICIES,
  MINI_RECORDS,
  MINI_SCHEMA,
} from '../../fixtures/mini-snapshot';
import type { FederatoAdapter, FederatoRecord, QueryPayload, QueryResult } from '../types';
import { HYDRATED_POLICY_QUERY, buildSnapshot } from './snapshot';

interface FakeOptions {
  /** Server-side cap on page size, like a handler that ignores a large limit. */
  readonly cap?: number;
  readonly ignoreOffset?: boolean;
  readonly hydrated?: readonly FederatoRecord[];
  readonly records?: typeof MINI_RECORDS;
}

/** Serves the mini fixture with real limit/offset semantics. No network. */
function fakeAdapter(opts: FakeOptions = {}): FederatoAdapter & { calls: QueryPayload[] } {
  const calls: QueryPayload[] = [];
  const records = opts.records ?? MINI_RECORDS;
  return {
    kind: 'mock',
    calls,
    getSchema: () => Promise.resolve(MINI_SCHEMA),
    query: <T,>(payload: QueryPayload): Promise<QueryResult<T>> => {
      calls.push(payload);
      if (payload.expand) {
        const rows = opts.hydrated ?? MINI_HYDRATED_POLICIES;
        return Promise.resolve({ resource: 'Policy', total: rows.length, results: rows as T[] });
      }
      const all = records[payload.resource];
      const limit = Math.min(payload.pagination?.limit ?? all.length, opts.cap ?? Infinity);
      const offset = opts.ignoreOffset ? 0 : (payload.pagination?.offset ?? 0);
      return Promise.resolve({
        resource: payload.resource,
        total: all.length,
        results: all.slice(offset, offset + limit) as T[],
      });
    },
    getGuidelines: () => Promise.reject(new Error('unused')),
    getGlossary: () => Promise.reject(new Error('unused')),
  };
}

const NOW = () => '2026-09-19T12:00:00.000Z';

describe('HYDRATED_POLICY_QUERY', () => {
  it('is the verified one-call deep pass from LIVE_DATA_FACTS, rooted at Policy', () => {
    expect(HYDRATED_POLICY_QUERY).toEqual({
      resource: 'Policy',
      where: { line_of_business: 'property' },
      expand: {
        insured: true,
        submission: true,
        claims: true,
        exposure_units: { location: { buildings: true } },
      },
      pagination: { limit: 200 },
    });
    expect(HYDRATED_POLICY_QUERY).not.toHaveProperty('over');
  });
});

describe('buildSnapshot', () => {
  it('pulls all 12 resources plus the deep query and returns them unmodified', async () => {
    const adapter = fakeAdapter();
    const { snapshot, hydrated } = await buildSnapshot({
      adapter,
      now: NOW,
      expectedCounts: MINI_COUNTS,
      expectedHydrated: MINI_HYDRATED_POLICIES.length,
    });
    expect(snapshot.fetchedAt).toBe('2026-09-19T12:00:00.000Z');
    expect(snapshot.counts).toEqual(MINI_COUNTS);
    expect(snapshot.records.Policy).toEqual([...MINI_POLICIES].sort((a, b) => (a.id as number) - (b.id as number)));
    expect(hydrated.results).toHaveLength(3);
    expect(hydrated.payload).toBe(HYDRATED_POLICY_QUERY);
    // 12 flat pulls (each fits one page) + 1 deep query.
    expect(adapter.calls).toHaveLength(13);
    expect(new Set(adapter.calls.map((c) => c.resource)).size).toBe(12);
  });

  it('pages past a server-side cap until every record is in', async () => {
    const adapter = fakeAdapter({ cap: 2 });
    const { snapshot } = await buildSnapshot({
      adapter,
      now: NOW,
      expectedCounts: MINI_COUNTS,
      expectedHydrated: 3,
    });
    expect(snapshot.counts).toEqual(MINI_COUNTS);
    const policyOffsets = adapter.calls
      .filter((c) => c.resource === 'Policy' && !c.expand)
      .map((c) => c.pagination?.offset);
    expect(policyOffsets).toEqual([0, 2]);
  });

  it('fails loudly when the handler ignores offset', async () => {
    await expect(
      buildSnapshot({ adapter: fakeAdapter({ cap: 2, ignoreOffset: true }), now: NOW, expectedCounts: MINI_COUNTS, expectedHydrated: 3 }),
    ).rejects.toThrow(/ignore offset/);
  });

  it('refuses a pull that does not match the real counts, listing every mismatch', async () => {
    const err = await buildSnapshot({ adapter: fakeAdapter(), now: NOW }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    expect(msg).toMatch(/nothing written/);
    expect(msg).toContain(`Submission: expected 158, got ${MINI_COUNTS.Submission}`);
    expect(msg).toContain(`Policy: expected 113, got ${MINI_COUNTS.Policy}`);
    expect(msg).toContain(`Building: expected 129, got ${MINI_COUNTS.Building}`);
    expect(msg).toContain(`Claim: expected 179, got ${MINI_COUNTS.Claim}`);
    expect(msg).toContain('expected 27 property policies, got 3');
  });

  it('refuses a deep pass that returned ids instead of hydrated objects', async () => {
    const flat = MINI_POLICIES.filter((p) => p.line_of_business === 'property');
    const err = await buildSnapshot({
      adapter: fakeAdapter({ hydrated: flat }),
      now: NOW,
      expectedCounts: MINI_COUNTS,
      expectedHydrated: flat.length,
    }).catch((e: unknown) => e as Error);
    expect((err as Error).message).toMatch(/policy 9001: insured not hydrated/);
    expect((err as Error).message).toMatch(/policy 9001: no hydrated building/);
  });
});
