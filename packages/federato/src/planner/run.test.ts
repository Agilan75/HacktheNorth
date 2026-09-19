import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Rulebook, VectorSpec } from '@retrofit/engine';
import { MINI_SNAPSHOT } from '../../fixtures/mini-snapshot';
import { createMockAdapter } from '../mock/adapter';
import type { FederatoAdapter, QueryPayload, QueryResult } from '../types';
import { OVER_DECLINED_NOTE } from './adapt';
import { runFollowUps, runPlanner } from './run';
import type { RunPlannerInput } from './run';

const engineDir = fileURLToPath(new URL('../../../engine/', import.meta.url));
const json = <T>(rel: string): T => JSON.parse(readFileSync(`${engineDir}${rel}`, 'utf8')) as T;

const SPEC = json<VectorSpec>('vectors/commercial.json');
const RULES = json<Rulebook>('rules/commercial.json');
const EXTENSIONS = json<Rulebook>('rules/extensions.json');
const NOW = '2026-09-19T12:00:00.000Z';

/** A clock that advances 5 ms every read, so durations are deterministic. */
function steppingClock(): () => number {
  let t = 0;
  return () => (t += 5);
}

function inputWith(adapter: FederatoAdapter, extra: Partial<RunPlannerInput['options']> = {}): RunPlannerInput {
  return {
    adapter,
    spec: SPEC,
    rulebook: RULES,
    extensions: EXTENSIONS,
    options: { clock: steppingClock(), now: NOW, ...extra },
  };
}

/** Wraps the mock and records every payload sent. */
function spy(inner: FederatoAdapter, override?: (p: QueryPayload, n: number) => QueryResult | Error | null) {
  const sent: QueryPayload[] = [];
  const adapter: FederatoAdapter = {
    ...inner,
    query: <T,>(payload: QueryPayload) => {
      sent.push(payload);
      const o = override?.(payload, sent.length - 1) ?? null;
      if (o instanceof Error) return Promise.reject(o);
      if (o !== null) return Promise.resolve(o as QueryResult<T>);
      return inner.query<T>(payload);
    },
  };
  return { adapter, sent };
}

describe('runPlanner — mini snapshot end to end', async () => {
  const { adapter, sent } = spy(createMockAdapter({ snapshot: MINI_SNAPSHOT }));
  const result = await runPlanner(inputWith(adapter));

  it('triages 5 submissions: SUB-1003 (cyber) knocked out, 4 survive', () => {
    expect(result.counts.submissionsSeen).toBe(5);
    expect(result.counts.knockedOut).toBe(1);
    expect(result.counts.survivors).toBe(4);
    expect(result.plan.knockedOut.map((k) => k.externalId)).toEqual(['SUB-1003']);
    expect(result.plan.knockedOut[0]!.ruleId).toBe('AG-LOB-NA');
    expect(result.plan.survivors.map((s) => s.externalId).sort()).toEqual([
      'SUB-1001',
      'SUB-1002',
      'SUB-1004',
      'SUB-1005',
    ]);
  });

  it('carries the Federato facts for every triaged submission, knocked out or not', () => {
    const all = [...result.plan.knockedOut, ...result.plan.survivors];
    expect(all).toHaveLength(5);
    for (const t of all) {
      expect(t.facts.submissionNumber).toBe(t.externalId);
      expect(t.facts.insuredName).not.toBeNull();
      expect(t.facts.brokerName).not.toBeNull();
      expect(t.facts.requestedLimit).not.toBeNull();
      expect(t.facts.receivedDate).not.toBeNull();
    }
    expect(result.plan.knockedOut[0]!.facts.lineOfBusiness).toBe('cyber');
    const triage = result.trace[0]!;
    expect(triage.requiredBy.some((r) => r.ruleId === 'PRD-10-ACCOUNT-FACTS')).toBe(true);
  });

  it('runs exactly three queries in order: triage, deep Policy, no-policy Submission', () => {
    expect(result.trace.map((e) => e.pass)).toEqual(['triage', 'deep', 'no_policy_followup']);
    expect(sent.map((p) => p.resource)).toEqual(['Submission', 'Policy', 'Submission']);
    expect(result.counts.queries).toBe(3);
    expect(result.trace.map((e) => e.id)).toEqual(['q-000', 'q-001', 'q-002']);
    expect(result.trace.map((e) => e.seq)).toEqual([0, 1, 2]);
  });

  it('the deep pass is rooted at Policy, never Submission, and carries no `over`', () => {
    const deep = result.trace[1]!;
    expect(deep.payload.resource).toBe('Policy');
    expect(deep.pathChosen.rootResource).toBe('Policy');
    for (const p of sent) expect(p.over).toBeUndefined();
    expect(deep.notes).toContain(OVER_DECLINED_NOTE);
    expect(deep.rowCount).toBe(3);
  });

  it('hydrates 3 policies and sends 1 no-policy submission down insured -> hq', () => {
    expect(result.counts.deepHydrated).toBe(3);
    expect(result.counts.noPolicy).toBe(1);
    expect(result.plan.noPolicy?.expectedExternalIds).toEqual(['SUB-1004']);
    expect(result.trace[2]!.rowCount).toBe(1);
  });

  it('builds one bundle per survivor, never one for the knockout', () => {
    const ids = result.bundles.map((b) => b.externalId).sort();
    expect(ids).toEqual(['SUB-1001', 'SUB-1002', 'SUB-1004', 'SUB-1005']);
    const b1001 = result.bundles.find((b) => b.externalId === 'SUB-1001')!;
    expect(b1001.records['Policy']).toHaveLength(1);
    expect(b1001.lineOfBusiness).toBe('commercial_property');
    const b1004 = result.bundles.find((b) => b.externalId === 'SUB-1004')!;
    expect(b1004.records['Policy']).toBeUndefined();
    expect(b1004.records['Submission']).toHaveLength(1);
    expect(b1004.fetchedAt).toBe(NOW);
    expect(b1004.queryTraceIds).toEqual(['q-000', 'q-001', 'q-002']);
  });

  it('records deterministic timing from the injected clock', () => {
    // Each query reads the clock twice (begin, finish): 5 ms apart.
    expect(result.trace.map((e) => e.durationMs)).toEqual([5, 5, 5]);
    expect(result.counts.totalDurationMs).toBe(15);
    expect(result.trace[0]!.startedAt.startsWith('2026-09-19T12:00:00')).toBe(true);
    expect(result.adapterKind).toBe('mock');
    expect(result.trace.every((e) => e.adapterKind === 'mock')).toBe(true);
  });

  it('keeps plan follow-ups empty until runFollowUps runs', () => {
    expect(result.plan.followUps).toEqual([]);
    expect(result.counts.followUps).toBe(0);
    expect(result.needed.length).toBeGreaterThan(0);
  });
});

describe('runPlanner — tenant line', () => {
  it('knocks every Federato submission out and never runs a deep query', async () => {
    const { adapter, sent } = spy(createMockAdapter({ snapshot: MINI_SNAPSHOT }));
    const result = await runPlanner(inputWith(adapter, { lineOfBusiness: 'tenant' }));
    expect(result.counts.knockedOut).toBe(5);
    expect(result.counts.survivors).toBe(0);
    expect(result.plan.deep).toBeNull();
    expect(result.bundles).toEqual([]);
    expect(sent).toHaveLength(1);
  });
});

describe('runPlanner — adaptation and errors', () => {
  it('lets an empty single-condition deep pass stand, and says why, instead of widening it', async () => {
    const mock = createMockAdapter({ snapshot: MINI_SNAPSHOT });
    const { adapter } = spy(mock, (p) =>
      p.resource === 'Policy' ? { resource: 'Policy', total: 0, results: [] } : null,
    );
    const result = await runPlanner(inputWith(adapter));
    expect(result.trace.map((e) => e.pass)).toEqual(['triage', 'deep', 'no_policy_followup']);
    expect(result.trace[1]!.outcome).toBe('empty');
    expect(result.trace[1]!.notes.some((n) => n.includes('no adaptation left'))).toBe(true);
    expect(result.counts.deepHydrated).toBe(0);
    expect(result.counts.noPolicy).toBe(4);
  });

  it('retries an empty follow-up with the next adaptation, links it back, and keeps only asked-for ids', async () => {
    const mock = createMockAdapter({ snapshot: MINI_SNAPSHOT });
    let followUpCalls = 0;
    const { adapter, sent } = spy(mock, (p) => {
      if (p.resource === 'Policy' && p.filter !== undefined && followUpCalls++ === 0) {
        return { resource: 'Policy', total: 0, results: [] };
      }
      return null;
    });
    const input = inputWith(adapter);
    const base = await runPlanner(input);
    const after = await runFollowUps(input, base, ['SUB-1001']);
    expect(after.trace.map((e) => e.pass).slice(3)).toEqual(['high_scorer_followup', 'adapt_retry']);
    const retry = after.trace[4]!;
    expect(retry.id).toBe('q-004');
    expect(retry.adaptedFrom).toBe('q-003');
    expect(retry.adaptation).toBe('drop_narrowest_filter');
    expect(retry.notes.length).toBeGreaterThan(0);
    expect(sent).toHaveLength(5);
    const b1001 = after.bundles.find((b) => b.externalId === 'SUB-1001')!;
    expect(b1001.records['Policy']).toHaveLength(2);
    for (const id of ['SUB-1002', 'SUB-1005']) {
      expect(after.bundles.find((b) => b.externalId === id)!.records['Policy']).toHaveLength(1);
    }
  });

  it('records a failed query in the trace and as a warning instead of throwing', async () => {
    const mock = createMockAdapter({ snapshot: MINI_SNAPSHOT });
    const { adapter } = spy(mock, (p) =>
      p.resource === 'Policy' ? new Error('[RATE_LIMITED] slow down') : null,
    );
    const result = await runPlanner(inputWith(adapter));
    const deep = result.trace.find((e) => e.pass === 'deep')!;
    expect(deep.outcome).toBe('error');
    expect(deep.error?.code).toBe('RATE_LIMITED');
    expect(deep.totalAvailable).toBeNull();
    expect(result.warnings.some((w) => w.includes('RATE_LIMITED'))).toBe(true);
    // Every property survivor falls through to the no-policy pass instead of vanishing.
    expect(result.counts.noPolicy).toBe(4);
    expect(result.bundles).toHaveLength(4);
  });

  it('falls back to the minimal triage projection when the full one is rejected, and says so', async () => {
    const mock = createMockAdapter({ snapshot: MINI_SNAPSHOT });
    const { adapter, sent } = spy(mock, (p, n) =>
      n === 0 && p.resource === 'Submission' ? new Error('[INVALID_SELECT] $expand not allowed here') : null,
    );
    const result = await runPlanner(inputWith(adapter));
    expect(result.trace.map((e) => e.pass).slice(0, 2)).toEqual(['triage', 'adapt_retry']);
    const retry = result.trace[1]!;
    expect(retry.adaptation).toBe('minimal_select');
    expect(retry.adaptedFrom).toBe(result.trace[0]!.id);
    expect(retry.notes.some((n) => n.includes('display facts'))).toBe(true);
    expect(sent[1]!.select).toEqual(['id', 'submission_number', 'status', 'line_of_business']);
    // Knockouts still work; the facts are absent, not guessed.
    expect(result.plan.knockedOut.map((k) => k.externalId)).toEqual(['SUB-1003']);
    expect(result.plan.knockedOut[0]!.facts.insuredName).toBeNull();
    expect(result.plan.knockedOut[0]!.facts.lineOfBusiness).toBe('cyber');
    expect(result.warnings.some((w) => w.includes('minimal projection'))).toBe(true);
    expect(result.plan.triage.requiredBy.map((r) => r.ruleId)).toEqual(['AG-LOB-NA']);
  });

  it('warns when the page limit truncates the triage', async () => {
    const mock = createMockAdapter({ snapshot: MINI_SNAPSHOT });
    const { adapter } = spy(mock, (p, n) =>
      n === 0 ? { resource: 'Submission', total: 999, results: [] } : null,
    );
    const result = await runPlanner(inputWith(adapter));
    expect(result.warnings.some((w) => w.includes('0 of 999'))).toBe(true);
  });
});

describe('runFollowUps', async () => {
  const { adapter } = spy(createMockAdapter({ snapshot: MINI_SNAPSHOT }));
  const input = inputWith(adapter);
  const base = await runPlanner(input);
  const after = await runFollowUps(input, base, ['SUB-1001', 'SUB-1004', 'SUB-9999']);

  it('adds one high-scorer Policy query, continuing the trace sequence', () => {
    expect(after.trace).toHaveLength(4);
    const f = after.trace[3]!;
    expect(f.pass).toBe('high_scorer_followup');
    expect(f.id).toBe('q-003');
    expect(f.seq).toBe(3);
    expect(f.payload.resource).toBe('Policy');
    expect(f.rowCount).toBe(1);
    expect(after.counts.queries).toBe(4);
    expect(after.counts.followUps).toBe(1);
    expect(after.plan.followUps).toHaveLength(1);
    expect(after.plan.followUps[0]!.forExternalIds).toEqual(['SUB-1001']);
  });

  it('appends the follow-up row to the high scorer bundle only', () => {
    const b1001 = after.bundles.find((b) => b.externalId === 'SUB-1001')!;
    expect(b1001.records['Policy']).toHaveLength(2);
    const extra = b1001.records['Policy']![1]!.data;
    expect(extra).toHaveProperty('coverages');
    const b1002 = after.bundles.find((b) => b.externalId === 'SUB-1002')!;
    expect(b1002.records['Policy']).toHaveLength(1);
    expect(b1002.queryTraceIds).toContain('q-003');
  });

  it('skips accounts with no policy or unknown ids, and says so', () => {
    expect(after.warnings.some((w) => w.includes('SUB-1004') && w.includes('SUB-9999'))).toBe(true);
    // Base result is untouched.
    expect(base.trace).toHaveLength(3);
  });

  it('does nothing when skipFollowUps is set or nothing qualifies', async () => {
    const skip = await runFollowUps({ ...input, options: { ...input.options, skipFollowUps: true } }, base, ['SUB-1001']);
    expect(skip).toBe(base);
    const none = await runFollowUps(input, base, []);
    expect(none).toBe(base);
  });
});
