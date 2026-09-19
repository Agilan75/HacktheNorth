import { describe, expect, it } from 'vitest';
import {
  MINI_BUILDINGS,
  MINI_HYDRATED_POLICIES,
  MINI_NO_POLICY_SUBMISSIONS,
  MINI_SCHEMA,
  MINI_SNAPSHOT,
} from '../../fixtures/mini-snapshot';
import { readGlossary } from '../reference/glossary';
import { readGuidelines } from '../reference/guidelines';
import type { FederatoRecord, GlossaryDocument, QueryPayload } from '../types';
import { createMockAdapter } from './adapter';
import { runPipeline } from './pipeline';

const adapter = createMockAdapter({ snapshot: MINI_SNAPSHOT });

const DEEP: QueryPayload = {
  resource: 'Policy',
  where: { line_of_business: 'property' },
  expand: {
    insured: true,
    submission: true,
    claims: true,
    exposure_units: { location: { buildings: true } },
  },
  pagination: { limit: 200 },
};

describe('createMockAdapter', () => {
  it('is the mock kind', () => {
    expect(adapter.kind).toBe('mock');
  });

  it('answers the planner deep pass exactly like the pipeline: 3 property policies, fully hydrated', async () => {
    const res = await adapter.query(DEEP);
    expect(res.resource).toBe('Policy');
    expect(res.total).toBe(3);
    expect(res.results).toEqual(MINI_HYDRATED_POLICIES);
    expect(res).toEqual(runPipeline(DEEP, MINI_SNAPSHOT.records));
  });

  it('answers the no-policy follow-up', async () => {
    const res = await adapter.query({
      resource: 'Submission',
      where: {
        line_of_business: 'property',
        status: { $in: ['lost', 'cleared', 'quoted', 'declined', 'received'] },
      },
      expand: { insured: 'hq', broker: true },
    });
    expect(res.results).toEqual(MINI_NO_POLICY_SUBMISSIONS);
    expect(res.total).toBe(MINI_NO_POLICY_SUBMISSIONS.length);
  });

  it('total counts before pagination', async () => {
    const res = await adapter.query({
      resource: 'Building',
      sort: [{ field: 'tiv', direction: 'desc' }],
      pagination: { limit: 2, offset: 1 },
    });
    expect(res.total).toBe(MINI_BUILDINGS.length);
    expect(res.results.map((r) => r['id'])).toEqual([504, 502]);
  });

  it('never lets a caller mutate the snapshot through a result', async () => {
    const first = await adapter.query({ resource: 'Policy', where: { id: 9001 } });
    (first.results[0] as Record<string, unknown>)['premium'] = -1;
    const again = await adapter.query({ resource: 'Policy', where: { id: 9001 } });
    expect((again.results[0] as FederatoRecord)['premium']).not.toBe(-1);
    const original = MINI_SNAPSHOT.records.Policy.find((p) => p['id'] === 9001);
    expect(original?.['premium']).not.toBe(-1);
  });

  it('rejects (does not throw synchronously) on an unknown resource with a coded message', async () => {
    const bad = { resource: 'Policies' } as unknown as QueryPayload;
    const p = adapter.query(bad);
    await expect(p).rejects.toThrow(/^\[VALIDATION_ERROR\] Unknown resource "Policies"/);
  });

  it('serves the snapshot schema, or the override', async () => {
    expect(await adapter.getSchema()).toEqual(MINI_SCHEMA);
    const override = { ...MINI_SCHEMA, fetchedAt: 'override' };
    const withSchema = createMockAdapter({ snapshot: MINI_SNAPSHOT, schema: override });
    expect(await withSchema.getSchema()).toEqual(override);
  });

  it('serves the transcribed guidelines and glossary by default, overrides when given', async () => {
    expect(await adapter.getGuidelines()).toBe(readGuidelines());
    expect(await adapter.getGlossary()).toBe(readGlossary());
    const glossary: GlossaryDocument = { doc: 'X.pdf', version: '1', entries: [] };
    const custom = createMockAdapter({ snapshot: MINI_SNAPSHOT, glossary });
    expect(await custom.getGlossary()).toBe(glossary);
  });
});
