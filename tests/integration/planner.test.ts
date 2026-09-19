/**
 * Integration (Run 2, unit I2): the Federato query planner end to end over the
 * MockFederatoAdapter and the committed real snapshot, plus adapter selection.
 *
 * Oracles are independent of the planner: expected counts are recomputed here
 * from the raw snapshot JSON, and the deep pass is compared against the live
 * API's own response to the verified hydrated query
 * (`snapshot/policy-property-hydrated.json`).
 *
 * Never reads `process.env`: vitest loads the repo `.env`, so every env the
 * adapter sees is built explicitly here.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { readRatingTable, readRulebook, readVectorSpec } from '@retrofit/engine';
import {
  adapterBanner,
  createAdapter,
  deepEqual,
  loadSnapshot,
  runFollowUps,
  runPlanner,
  selectAdapterKind,
} from '@retrofit/federato';
import type {
  FederatoAdapter,
  FederatoRecord,
  QueryPayload,
  QueryResult,
  QueryTraceEntry,
  RunPlannerInput,
} from '@retrofit/federato';
import { startupBanner } from '../../apps/api/src/banners';
import { federatoEnv, loadEnv, setEnv } from '../../apps/api/src/env';
import { createFakeLlm } from '../../apps/api/src/llm/fake-provider';
import type { Deps } from '../../apps/api/src/services/types';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SNAP_DIR = `${ROOT}packages/federato/snapshot/`;
const NOW = '2026-09-19T12:00:00.000Z';

type Row = Readonly<Record<string, unknown>>;

const rawSnapshot = JSON.parse(readFileSync(`${SNAP_DIR}snapshot.json`, 'utf8')) as {
  records: Record<string, Row[]>;
};
const hydrated = JSON.parse(readFileSync(`${SNAP_DIR}policy-property-hydrated.json`, 'utf8')) as {
  payload: QueryPayload;
  total: number;
  results: Row[];
};

/* Independent oracle, straight from the raw snapshot file. */
const SUBMISSIONS = rawSnapshot.records['Submission']!;
const PROPERTY_SUBS = SUBMISSIONS.filter((s) => s['line_of_business'] === 'property');
const OTHER_SUBS = SUBMISSIONS.filter((s) => s['line_of_business'] !== 'property');
const PROPERTY_POLICIES = rawSnapshot.records['Policy']!.filter((p) => p['line_of_business'] === 'property');
const SUB_IDS_WITH_PROPERTY_POLICY = new Set(PROPERTY_POLICIES.map((p) => p['submission']));
const NO_POLICY_SUB_IDS = PROPERTY_SUBS.map((s) => s['id'] as number)
  .filter((id) => !SUB_IDS_WITH_PROPERTY_POLICY.has(id))
  .sort((a, b) => a - b);

/** Steps 5 ms per read so every duration is deterministic and non-zero. */
function steppingClock(): () => number {
  let t = 0;
  return () => (t += 5);
}

/** The mock, wrapped to record exactly what went over the adapter boundary. */
function recording(inner: FederatoAdapter): { adapter: FederatoAdapter; sent: QueryPayload[] } {
  const sent: QueryPayload[] = [];
  return {
    sent,
    adapter: {
      ...inner,
      query: <T = FederatoRecord>(payload: QueryPayload): Promise<QueryResult<T>> => {
        sent.push(structuredClone(payload));
        return inner.query<T>(payload);
      },
    },
  };
}

/** Every key anywhere inside a value, so a nested `over` cannot hide. */
function allKeys(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) for (const v of value) allKeys(v, out);
  else if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      allKeys(v, out);
    }
  }
  return out;
}

const isObj = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);

/* -------------------------------------------------------------------------- */

describe('I2 planner over the MockFederatoAdapter and the real snapshot', async () => {
  const [spec, rulebook, extensions, ratingTable] = await Promise.all([
    readVectorSpec('commercial_property'),
    readRulebook('commercial'),
    readRulebook('extensions'),
    readRatingTable('commercial_property'),
  ]);
  const ruleIds = new Set([...rulebook.rules, ...extensions.rules].map((r) => r.id));

  // FEDERATO_BASE_URL unset -> the mock over the committed snapshot on disk.
  const base = createAdapter({ env: {} });
  const { adapter, sent } = recording(base);
  const input: RunPlannerInput = {
    adapter,
    spec,
    rulebook,
    extensions,
    ratingTable,
    options: { clock: steppingClock(), now: NOW, lineOfBusiness: 'commercial_property' },
  };
  const result = await runPlanner(input);
  const sentByPlanner = sent.length;
  const byPass = (pass: QueryTraceEntry['pass']) => result.trace.filter((e) => e.pass === pass);

  it('the oracle agrees with LIVE_DATA_FACTS before anything is asserted against it', () => {
    expect(SUBMISSIONS).toHaveLength(158);
    expect(PROPERTY_SUBS).toHaveLength(38);
    expect(OTHER_SUBS).toHaveLength(120);
    expect(PROPERTY_POLICIES).toHaveLength(27);
    expect(NO_POLICY_SUB_IDS).toHaveLength(11);
    expect(hydrated.results).toHaveLength(27);
  });

  it('runs on the mock adapter, fully offline', () => {
    expect(base.kind).toBe('mock');
    expect(result.adapterKind).toBe('mock');
    expect(result.trace.every((e) => e.adapterKind === 'mock')).toBe(true);
  });

  it('trace order: triage first, then the deep pass, then the no-policy follow-up', () => {
    expect(result.trace.map((e) => e.pass)).toEqual(['triage', 'deep', 'no_policy_followup']);
    expect(result.trace.map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(sent.map((p) => p.resource)).toEqual(['Submission', 'Policy', 'Submission']);
    // The trace payload is what was actually sent, not a paraphrase of it.
    result.trace.forEach((e, i) => expect(e.payload).toEqual(sent[i]));
    expect(result.counts.queries).toBe(result.trace.length);
    expect(result.warnings.some((w) => /Triage saw|Deep pass hydrated|failed/.test(w))).toBe(false);
  });

  it('triage is one cheap Submission query: id, status and line of business, no expand', () => {
    const [triage] = byPass('triage');
    expect(byPass('triage')).toHaveLength(1);
    const p = triage!.payload;
    expect(p.resource).toBe('Submission');
    expect(p.expand).toBeUndefined();
    expect(p.where).toBeUndefined();
    expect(p.filter).toBeUndefined();
    expect(p.select).toEqual(expect.arrayContaining(['id', 'status', 'line_of_business']));
    expect(triage!.rowCount).toBe(158);
    expect(triage!.totalAvailable).toBe(158);
    expect(triage!.outcome).toBe('ok');
  });

  it('120 of 158 are knocked out on line of business, each with its reason recorded', () => {
    expect(result.counts.submissionsSeen).toBe(158);
    expect(result.counts.knockedOut).toBe(120);
    expect(result.counts.survivors).toBe(38);

    const expected = new Map(OTHER_SUBS.map((s) => [s['id'], s['line_of_business']]));
    const knocked = result.plan.knockedOut;
    expect(knocked).toHaveLength(120);
    expect(new Set(knocked.map((k) => k.submissionId))).toEqual(new Set(expected.keys()));
    for (const k of knocked) {
      expect(k.factor).toBe('line_of_business');
      expect(k.ruleId).toBe('AG-LOB-NA');
      expect(ruleIds.has(k.ruleId)).toBe(true);
      expect(k.lineOfBusiness).toBe(expected.get(k.submissionId));
      expect(k.reason).toContain(`"${k.lineOfBusiness}"`);
      expect(k.reason).toContain('APPETITE_GUIDELINES.pdf');
    }
    const byLine: Record<string, number> = {};
    for (const k of knocked) byLine[k.lineOfBusiness] = (byLine[k.lineOfBusiness] ?? 0) + 1;
    expect(byLine).toEqual({ health: 36, cgl: 21, auto: 20, cyber: 18, excess: 15, lpl: 10 });

    expect(new Set(result.plan.survivors.map((s) => s.submissionId))).toEqual(
      new Set(PROPERTY_SUBS.map((s) => s['id'])),
    );
  });

  it('deep pass is ONE Policy query (not Submission) expanding insured, submission, claims and exposure_units.location.buildings', () => {
    const deeps = byPass('deep');
    expect(deeps).toHaveLength(1);
    const deep = deeps[0]!;
    expect(deep.payload.resource).toBe('Policy');
    expect(deep.payload.resource).not.toBe('Submission');
    expect(deep.payload.expand).toEqual({
      insured: true,
      submission: true,
      claims: true,
      exposure_units: { location: { buildings: true } },
    });
    expect(deep.pathChosen.rootResource).toBe('Policy');
    expect(deep.pathChosen.path).toEqual(['exposure_units', 'location', 'buildings']);
    expect(deep.pathChosen.alternativesRejected.map((a) => a.rootResource)).toContain('Submission');
    expect(deep.rowCount).toBe(27);
    expect(deep.adaptation).toBe('none');
    expect(result.counts.deepHydrated).toBe(27);
  });

  it('deep pass rows come back hydrated: objects, not ids, down to buildings', async () => {
    const rows = (await base.query<Row>(byPass('deep')[0]!.payload)).results;
    expect(rows).toHaveLength(27);
    for (const policy of rows) {
      expect(isObj(policy['insured'])).toBe(true);
      expect(isObj(policy['submission'])).toBe(true);
      expect(Array.isArray(policy['claims'])).toBe(true);
      for (const c of policy['claims'] as unknown[]) expect(isObj(c)).toBe(true);
      expect(typeof policy['premium']).toBe('number');
      const buildings = (policy['exposure_units'] as Row[]).flatMap((eu) => {
        const loc = eu['location'];
        if (loc === null || loc === undefined) return [];
        expect(isObj(loc)).toBe(true);
        return (loc as Row)['buildings'] as unknown[];
      });
      expect(buildings.length).toBeGreaterThan(0);
      for (const b of buildings) expect(isObj(b)).toBe(true);
    }
  });

  it('mock deep pass equals the live API response to the same query, record for record', async () => {
    const deepPayload = byPass('deep')[0]!.payload;
    const { sort: _sort, ...unsorted } = deepPayload;
    expect(unsorted).toEqual(hydrated.payload);
    const mock = (await base.query<Row>(deepPayload)).results;
    const live = new Map(hydrated.results.map((r) => [r['id'], r]));
    expect(mock).toHaveLength(hydrated.total);
    for (const m of mock) expect(deepEqual(m, live.get(m['id']))).toBe(true);
  });

  it('the 11 property submissions with no policy get the Submission -> insured -> hq follow-up', () => {
    const np = byPass('no_policy_followup');
    expect(np).toHaveLength(1);
    expect(np[0]!.payload.resource).toBe('Submission');
    expect(np[0]!.payload.expand).toMatchObject({ insured: { hq: true } });
    expect(np[0]!.pathChosen.path).toEqual(['insured', 'hq']);
    expect(np[0]!.rowCount).toBe(11);
    expect(result.plan.noPolicy?.expectedExternalIds).toHaveLength(11);
    expect(result.counts.noPolicy).toBe(11);
    const ids = (np[0]!.payload.where as { id: { $in: number[] } }).id.$in;
    expect([...ids].sort((a, b) => a - b)).toEqual(NO_POLICY_SUB_IDS);
    expect(result.bundles).toHaveLength(38);
  });

  it('no query ever emits an `over` clause (LIVE_DATA_FACTS, DECISIONS P11)', async () => {
    const followed = await runFollowUps(input, result, result.bundles.slice(0, 3).map((b) => b.externalId));
    expect(followed.trace.length).toBeGreaterThan(result.trace.length);
    expect(sent.length).toBeGreaterThan(sentByPlanner);
    for (const p of sent) expect(allKeys(p).has('over')).toBe(false);
    for (const e of followed.trace) expect(allKeys(e.payload).has('over')).toBe(false);
    for (const plan of [result.plan.triage, result.plan.deep, result.plan.noPolicy, ...followed.plan.followUps]) {
      expect(allKeys(plan?.payload).has('over')).toBe(false);
    }
    // The decline is explained on the deep query, not silently skipped.
    expect(byPass('deep')[0]!.notes.some((n) => /aggregation declined/i.test(n))).toBe(true);
  });

  it('every trace entry carries goal, the rule that needed it, path and why, payload, row count, duration (PRD 7.5 step 6)', async () => {
    const followed = await runFollowUps(input, result, [result.bundles[0]!.externalId]);
    expect(followed.trace.map((e) => e.pass)).toContain('high_scorer_followup');
    const ids = new Set<string>();
    for (const e of followed.trace) {
      expect(ids.has(e.id)).toBe(false);
      ids.add(e.id);
      expect(e.goal.trim().length).toBeGreaterThan(20);
      expect(e.requiredBy.length).toBeGreaterThan(0);
      for (const need of e.requiredBy) {
        expect(need.ruleId.trim()).not.toBe('');
        expect(need.why.trim()).not.toBe('');
        expect(need.canonicalPath.trim()).not.toBe('');
        // Rulebook rules must be real ids, never invented ones.
        if (/^(AG|X)-/.test(need.ruleId)) expect(ruleIds.has(need.ruleId)).toBe(true);
      }
      expect(e.pathChosen.rootResource).toBe(e.payload.resource);
      expect(e.pathChosen.why.trim().length).toBeGreaterThan(20);
      expect(Array.isArray(e.pathChosen.path)).toBe(true);
      expect(e.payload.resource).toBeTruthy();
      expect(Number.isInteger(e.rowCount)).toBe(true);
      expect(e.rowCount).toBeGreaterThan(0);
      expect(e.outcome).toBe('ok');
      expect(e.error).toBeNull();
      expect(Number.isFinite(e.durationMs)).toBe(true);
      expect(e.durationMs).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(e.startedAt))).toBe(false);
    }
    // The run's durations add up to what counts reports.
    expect(followed.counts.totalDurationMs).toBe(followed.trace.reduce((s, e) => s + e.durationMs, 0));
    // Every stored bundle points at trace entries that exist.
    for (const b of followed.bundles) for (const id of b.queryTraceIds ?? []) expect(ids.has(id)).toBe(true);
  });

  it('is deterministic: a second run over the same snapshot produces the same plan and trace', async () => {
    const again = await runPlanner({
      ...input,
      adapter: createAdapter({ env: {}, snapshot: loadSnapshot() }),
      options: { ...input.options, clock: steppingClock() },
    });
    expect(again.trace).toEqual(result.trace);
    expect(again.plan).toEqual(result.plan);
    expect(again.counts).toEqual(result.counts);
  });
});

/* -------------------------------------------------------------------------- */

describe('I2 adapter selection: FEDERATO_BASE_URL unset selects the mock, loudly (PRD 7.4, 15)', () => {
  afterAll(() => setEnv(null));

  /** Everything configured except the base URL — the "remove one variable" case. */
  const RAW = {
    FEDERATO_BASE_URL: '',
    FEDERATO_TOKEN_URL: 'https://auth.example.invalid/oauth/token',
    FEDERATO_AUDIENCE: 'https://api.example.invalid',
    FEDERATO_CLIENT_ID: 'client-id-not-a-secret',
    FEDERATO_CLIENT_SECRET: 'client-secret-not-a-secret',
    DATABASE_URL: ':memory:',
  };

  it('the API env with FEDERATO_BASE_URL blank or missing makes createAdapter pick the mock', async () => {
    for (const source of [RAW, (({ FEDERATO_BASE_URL: _b, ...rest }) => rest)(RAW)]) {
      const fenv = federatoEnv(loadEnv(source));
      expect(fenv.baseUrl).toBeUndefined();
      expect(selectAdapterKind(fenv)).toBe('mock');
      const adapter = createAdapter({ env: fenv });
      expect(adapter.kind).toBe('mock');
      // Serves the real snapshot with no network: all 158 submissions.
      const r = await adapter.query({ resource: 'Submission', pagination: { limit: 200 } });
      expect(r.results).toHaveLength(158);
    }
  });

  it('the same env with FEDERATO_BASE_URL set picks live: no code change between them', () => {
    const fenv = federatoEnv(loadEnv({ ...RAW, FEDERATO_BASE_URL: 'https://api.example.invalid' }));
    expect(selectAdapterKind(fenv)).toBe('live');
    expect(createAdapter({ env: fenv }).kind).toBe('live');
  });

  it('the startup banner loudly names the mock and why, and leaks no credential', () => {
    const env = loadEnv(RAW);
    setEnv(env);
    const fenv = federatoEnv(env);
    const direct = adapterBanner(selectAdapterKind(fenv), fenv);
    expect(direct).toMatch(/^\*\*\* .* \*\*\*$/);
    expect(direct).toContain('SNAPSHOT (MockFederatoAdapter)');
    expect(direct).toContain('NOT the live API');
    expect(direct).toContain('FEDERATO_BASE_URL is unset');

    const deps = {
      db: null,
      adapter: createAdapter({ env: fenv }),
      llm: createFakeLlm(),
      clock: { nowMs: () => 0, nowIso: () => NOW, today: () => NOW.slice(0, 10) },
    } as unknown as Deps;
    const lines = startupBanner({ deps, driver: 'better-sqlite3', port: 3000, version: '0.1.0' });
    expect(lines).toContain(direct);
    const all = lines.join('\n');
    expect(all).not.toContain(RAW.FEDERATO_CLIENT_SECRET);
    expect(all).not.toContain(RAW.FEDERATO_CLIENT_ID);
  });
});
