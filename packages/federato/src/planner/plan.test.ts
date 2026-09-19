import { describe, expect, it } from 'vitest';
import {
  MINI_BROKERS,
  MINI_HYDRATED_POLICIES,
  MINI_INSUREDS,
  MINI_SNAPSHOT,
  MINI_SUBMISSIONS,
  MINI_UNDERWRITERS,
} from '../../fixtures/mini-snapshot';
import { createMockAdapter } from '../mock/adapter';
import type { LocateResult, QueryPayload } from '../types';
import {
  buildPlan,
  factsOf,
  planDeep,
  planFollowUps,
  planNoPolicy,
  planTriage,
  planTriageMinimal,
  triageRows,
  type PlanInput,
} from './plan';
import { externalIdOf } from './to-bundle';

const LOCATE: LocateResult = {
  located: [
    {
      canonicalPath: 'pricing.quotedPremium',
      rootResource: 'Policy',
      schemaPath: 'premium',
      referenceHops: [],
      confidence: 1,
      method: 'synonym',
      crossesArray: false,
      why: 'synonym table',
    },
  ],
  unmapped: [],
  fieldMap: { entries: [], unmapped: [] },
  assistUsed: false,
};

const INPUT: PlanInput = { locate: LOCATE, lineOfBusiness: 'commercial_property' };

/** The exact verified deep query from LIVE_DATA_FACTS.md. */
const VERIFIED_DEEP_EXPAND = {
  insured: true,
  submission: true,
  claims: true,
  exposure_units: { location: { buildings: true } },
};

function hasKeyDeep(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((v) => hasKeyDeep(v, key));
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).some(([k, v]) => k === key || hasKeyDeep(v, key));
  }
  return false;
}

/** Triage projection: what the cheap Submission select returns. */
const TRIAGE_ROWS = MINI_SUBMISSIONS.map((s) => ({
  id: s['id'],
  submission_number: s['submission_number'],
  status: s['status'],
  line_of_business: s['line_of_business'],
}));

describe('planTriage', () => {
  it('is one un-expanded Submission query: the knockout fields plus the display facts, references as $expand leaves', () => {
    const plan = planTriage(INPUT);
    expect(plan.payload.resource).toBe('Submission');
    // No expand STAGE: the names are wanted in the reply only (PRD 7.3).
    expect(plan.payload.expand).toBeUndefined();
    expect(plan.payload.select).toEqual({
      id: true,
      submission_number: true,
      status: true,
      line_of_business: true,
      requested_limit: true,
      received_date: true,
      target_effective_date: true,
      decline_reason: true,
      competitor: true,
      insured: { $expand: { select: ['name'] } },
      broker: { $expand: { select: ['name'] } },
      underwriter: { $expand: { select: ['name'] } },
    });
    // 158 submissions must fit in one page.
    expect(plan.payload.pagination?.limit).toBeGreaterThanOrEqual(158);
    expect(plan.requiredBy.map((r) => r.ruleId)).toEqual(['AG-LOB-NA', 'PRD-10-ACCOUNT-FACTS']);
    expect(plan.pathChosen.rootResource).toBe('Submission');
  });

  it('records in the trace step why the display facts are fetched', () => {
    const plan = planTriage(INPUT);
    const facts = plan.requiredBy.find((r) => r.ruleId === 'PRD-10-ACCOUNT-FACTS')!;
    expect(facts.factor).toBeNull();
    expect(facts.why).toMatch(/knocked out/);
    expect(facts.why).toMatch(/insured, broker and underwriter names/);
    expect(plan.goal).toMatch(/knocked out or not/);
  });

  it('has a minimal fallback that selects only the four knockout fields', () => {
    const plan = planTriageMinimal(INPUT);
    expect(plan.payload.select).toEqual(['id', 'submission_number', 'status', 'line_of_business']);
    expect(plan.requiredBy.map((r) => r.ruleId)).toEqual(['AG-LOB-NA']);
  });

  it('returns every fact through the mock adapter, with references resolved to names', async () => {
    const adapter = createMockAdapter({ snapshot: MINI_SNAPSHOT });
    const result = await adapter.query(planTriage(INPUT).payload);
    expect(result.results).toHaveLength(MINI_SUBMISSIONS.length);
    const row = result.results.find((r) => r['id'] === 1002)!;
    const source = MINI_SUBMISSIONS.find((s) => s['id'] === 1002)!;
    const name = (rows: readonly Record<string, unknown>[], id: unknown): unknown =>
      rows.find((r) => r['id'] === id)?.['name'];
    expect(row['insured']).toEqual({ name: name(MINI_INSUREDS, source['insured']) });
    expect(row['broker']).toEqual({ name: name(MINI_BROKERS, source['broker']) });
    expect(row['underwriter']).toEqual({ name: name(MINI_UNDERWRITERS, source['underwriter']) });
    expect(row['requested_limit']).toBe(source['requested_limit']);
    expect(row['competitor']).toBe('Meridian Mutual');
  });
});

describe('factsOf', () => {
  it('reads every display fact from one triage row', () => {
    const facts = factsOf(
      {
        id: 7,
        submission_number: 'SUB-7',
        status: 'declined',
        line_of_business: 'cyber',
        requested_limit: 5000000,
        received_date: '2025-01-02',
        target_effective_date: '2025-02-01',
        decline_reason: 'Outside appetite',
        competitor: 'Meridian Mutual',
        insured: { name: 'Acme LLC' },
        broker: { name: 'Highland Risk Partners' },
        underwriter: { name: 'F. Adeyemi' },
      },
      'SUB-7',
      7,
    );
    expect(facts).toEqual({
      submissionId: 7,
      submissionNumber: 'SUB-7',
      insuredName: 'Acme LLC',
      brokerName: 'Highland Risk Partners',
      underwriterName: 'F. Adeyemi',
      lineOfBusiness: 'cyber',
      status: 'declined',
      requestedLimit: 5000000,
      receivedDate: '2025-01-02',
      targetEffectiveDate: '2025-02-01',
      declineReason: 'Outside appetite',
      competitor: 'Meridian Mutual',
    });
  });

  it('never invents a value: an unexpanded reference id, a null and a missing key are all absent', () => {
    const facts = factsOf({ id: 8, insured: 301, broker: null, requested_limit: 'lots' }, 'SUB-8', 8);
    expect(facts.insuredName).toBeNull();
    expect(facts.brokerName).toBeNull();
    expect(facts.underwriterName).toBeNull();
    expect(facts.requestedLimit).toBeNull();
    expect(facts.receivedDate).toBeNull();
    expect(facts.submissionNumber).toBe('SUB-8');
  });
});

describe('triageRows', () => {
  const { knockedOut, survivors } = triageRows(TRIAGE_ROWS, INPUT);

  it('knocks out exactly the cyber submission on line of business, with the rule recorded', () => {
    expect(knockedOut).toHaveLength(1);
    const k = knockedOut[0]!;
    expect(k.externalId).toBe('SUB-1003');
    expect(k.submissionId).toBe(1003);
    expect(k.lineOfBusiness).toBe('cyber');
    expect(k.status).toBe('bound');
    expect(k.ruleId).toBe('AG-LOB-NA');
    expect(k.factor).toBe('line_of_business');
    expect(k.reason).toContain('cyber');
    expect(k.reason).toContain('All other lines');
    // The knockout carries its own facts, Federato's line included.
    expect(k.facts).toMatchObject({ submissionNumber: 'SUB-1003', lineOfBusiness: 'cyber', status: 'bound' });
  });

  it('keeps the four property submissions in input order', () => {
    expect(survivors.map((s) => s.externalId)).toEqual([
      'SUB-1001',
      'SUB-1002',
      'SUB-1004',
      'SUB-1005',
    ]);
    expect(survivors.find((s) => s.externalId === 'SUB-1004')).toMatchObject({
      externalId: 'SUB-1004',
      submissionId: 1004,
      lineOfBusiness: 'property',
      status: 'lost',
    });
  });

  it('reproduces the real 120-of-158 split from the measured line-of-business counts', () => {
    const counts: Record<string, number> = {
      property: 38, health: 36, cgl: 21, auto: 20, cyber: 18, excess: 15, lpl: 10,
    };
    const rows: Record<string, unknown>[] = [];
    let id = 1;
    for (const [line, n] of Object.entries(counts)) {
      for (let i = 0; i < n; i += 1) {
        rows.push({ id, submission_number: `SUB-${id}`, status: 'bound', line_of_business: line });
        id += 1;
      }
    }
    const result = triageRows(rows, INPUT);
    expect(rows).toHaveLength(158);
    expect(result.knockedOut).toHaveLength(120);
    expect(result.survivors).toHaveLength(38);
  });

  it('treats a missing line of business as missing data, not a knockout (G-2/G-3)', () => {
    const r = triageRows([{ id: 77, submission_number: 'SUB-77', status: 'received', line_of_business: null }], INPUT);
    expect(r.knockedOut).toHaveLength(0);
    expect(r.survivors).toEqual([
      {
        externalId: 'SUB-77',
        submissionId: 77,
        lineOfBusiness: '',
        status: 'received',
        facts: expect.objectContaining({ submissionNumber: 'SUB-77', lineOfBusiness: null, status: 'received' }),
      },
    ]);
  });

  it('matches line of business case-insensitively and drops duplicate rows', () => {
    const r = triageRows(
      [
        { id: 1, submission_number: 'SUB-1', status: 'bound', line_of_business: 'Property' },
        { id: 1, submission_number: 'SUB-1', status: 'bound', line_of_business: 'Property' },
      ],
      INPUT,
    );
    expect(r.survivors).toHaveLength(1);
  });

  it('knocks out every Federato row for the tenant line', () => {
    const r = triageRows(TRIAGE_ROWS, { ...INPUT, lineOfBusiness: 'tenant' });
    expect(r.survivors).toHaveLength(0);
    expect(r.knockedOut).toHaveLength(5);
  });
});

describe('planDeep', () => {
  const { survivors } = triageRows(TRIAGE_ROWS, INPUT);
  const deep = planDeep(survivors, INPUT);

  it('is rooted at Policy with exactly the verified expand, never at Submission', () => {
    expect(deep).not.toBeNull();
    expect(deep!.payload.resource).toBe('Policy');
    expect(deep!.payload.expand).toEqual(VERIFIED_DEEP_EXPAND);
    expect(deep!.payload.where).toEqual({ line_of_business: 'property' });
    expect(deep!.payload.pagination).toEqual({ limit: 200 });
    expect(deep!.pathChosen.rootResource).toBe('Policy');
    expect(deep!.pathChosen.path).toEqual(['exposure_units', 'location', 'buildings']);
    expect(deep!.pathChosen.alternativesRejected.map((a) => a.rootResource)).toContain('Submission');
  });

  it('expects every survivor, sorted', () => {
    expect(deep!.expectedExternalIds).toEqual(['SUB-1001', 'SUB-1002', 'SUB-1004', 'SUB-1005']);
  });

  it('names the appetite rules that need it', () => {
    const rules = deep!.requiredBy.map((r) => r.ruleId);
    for (const id of ['AG-ST-NA', 'AG-TIV-NA', 'AG-PREM-NA-HIGH', 'AG-AGE-NA', 'AG-AGE-REFER', 'AG-CON-NA', 'AG-LOSS-NA']) {
      expect(rules).toContain(id);
    }
  });

  it('honours pageLimit', () => {
    expect(planDeep(survivors, { ...INPUT, pageLimit: 50 })!.payload.pagination).toEqual({ limit: 50 });
  });

  it('returns null with no survivors or for the tenant line', () => {
    expect(planDeep([], INPUT)).toBeNull();
    expect(planDeep(survivors, { ...INPUT, lineOfBusiness: 'tenant' })).toBeNull();
  });
});

describe('planNoPolicy', () => {
  const { survivors } = triageRows(TRIAGE_ROWS, INPUT);
  const hydrated = MINI_HYDRATED_POLICIES.map(externalIdOf);

  it('targets exactly the survivors the deep pass did not hydrate', () => {
    expect(hydrated).toEqual(['SUB-1001', 'SUB-1002', 'SUB-1005']);
    const plan = planNoPolicy(survivors, hydrated, INPUT);
    expect(plan).not.toBeNull();
    expect(plan!.expectedExternalIds).toEqual(['SUB-1004']);
    expect(plan!.payload.resource).toBe('Submission');
    expect(plan!.payload.where).toEqual({ id: { $in: [1004] } });
    expect(plan!.payload.expand).toEqual({ insured: { hq: true }, broker: true });
    expect(plan!.pathChosen.path).toEqual(['insured', 'hq']);
  });

  it('is null when every survivor was hydrated', () => {
    expect(planNoPolicy(survivors, survivors.map((s) => s.externalId), INPUT)).toBeNull();
  });
});

describe('planFollowUps', () => {
  it('builds one Policy query for broker and coverage detail on the high scorers', () => {
    const plans = planFollowUps(['SUB-1002', 'SUB-1001', 'SUB-1001'], INPUT);
    expect(plans).toHaveLength(1);
    const p = plans[0]!;
    expect(p.payload.resource).toBe('Policy');
    expect(p.forExternalIds).toEqual(['SUB-1001', 'SUB-1002']);
    expect(p.payload.expand).toMatchObject({ submission: true, coverages: true, producer: { broker: true } });
    expect(p.payload.filter).toEqual({ 'submission.submission_number': { $in: ['SUB-1001', 'SUB-1002'] } });
  });

  it('is empty with no high scorers', () => {
    expect(planFollowUps([], INPUT)).toEqual([]);
  });
});

describe('buildPlan', () => {
  it('holds the triage and deep queries before any result exists', () => {
    const plan = buildPlan(INPUT);
    expect(plan.triage.payload.resource).toBe('Submission');
    expect(plan.deep?.payload.resource).toBe('Policy');
    expect(plan.deep?.payload.expand).toEqual(VERIFIED_DEEP_EXPAND);
    expect(plan.noPolicy).toBeNull();
    expect(plan.followUps).toEqual([]);
    expect(plan.knockedOut).toEqual([]);
    expect(plan.survivors).toEqual([]);
  });
});

describe('no plan ever emits server-side aggregation', () => {
  it('has no `over` clause and no reduction in any payload', () => {
    const { survivors } = triageRows(TRIAGE_ROWS, INPUT);
    const payloads: QueryPayload[] = [
      planTriage(INPUT).payload,
      planDeep(survivors, INPUT)!.payload,
      planNoPolicy(survivors, ['SUB-1001'], INPUT)!.payload,
      ...planFollowUps(['SUB-1001'], INPUT).map((p) => p.payload),
      buildPlan(INPUT).deep!.payload,
    ];
    for (const payload of payloads) {
      expect(payload.over).toBeUndefined();
      for (const key of ['over', '$sum', '$count', '$avg', '$min', '$max', '$countDistinct']) {
        expect(hasKeyDeep(payload, key)).toBe(false);
      }
    }
  });
});
