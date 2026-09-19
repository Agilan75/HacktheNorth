import { describe, expect, it } from 'vitest';
import {
  MINI_HYDRATED_POLICIES,
  MINI_SUBMISSIONS,
} from '../../fixtures/mini-snapshot';
import type { LocateResult, QueryPayload } from '../types';
import {
  buildPlan,
  planDeep,
  planFollowUps,
  planNoPolicy,
  planTriage,
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
  it('is one cheap, un-expanded Submission query selecting id, number, status and line', () => {
    const plan = planTriage(INPUT);
    expect(plan.payload.resource).toBe('Submission');
    expect(plan.payload.expand).toBeUndefined();
    expect(plan.payload.select).toEqual(['id', 'submission_number', 'status', 'line_of_business']);
    // 158 submissions must fit in one page.
    expect(plan.payload.pagination?.limit).toBeGreaterThanOrEqual(158);
    expect(plan.requiredBy.map((r) => r.ruleId)).toEqual(['AG-LOB-NA']);
    expect(plan.pathChosen.rootResource).toBe('Submission');
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
  });

  it('keeps the four property submissions in input order', () => {
    expect(survivors.map((s) => s.externalId)).toEqual([
      'SUB-1001',
      'SUB-1002',
      'SUB-1004',
      'SUB-1005',
    ]);
    expect(survivors.find((s) => s.externalId === 'SUB-1004')).toEqual({
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
      { externalId: 'SUB-77', submissionId: 77, lineOfBusiness: '', status: 'received' },
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
