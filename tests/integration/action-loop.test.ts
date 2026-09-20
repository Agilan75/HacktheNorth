/**
 * I4 — the Rox action loop and the seeded sweep, end to end, in process.
 *
 * Real committed Federato snapshot (all 38 property submissions) behind the
 * mock adapter, `:memory:` SQLite, the real engine data files, the real Hono
 * app driven through `app.request()`, and the deterministic fake LLM. No
 * network, no listener.
 *
 * PRD 7.6 / 15: plan -> a draft request for a REFER account naming exactly the
 * missing fields -> approve -> POST the seeded messy broker reply -> fields
 * extracted with quotes that literally appear in the source -> re-scored ->
 * rank change and before/after logged. PRD 15 (phase 2, and the seeded-sweep
 * fallback of PRD 8/9.1): seeded sweep -> verdict -> verify-fix -> the price
 * drops. PRD 3 / 15 invariant: no LLM output reaches a score, verdict or
 * dollar amount without passing through the engine.
 *
 * Every assertion is on real numbers. A red test here is a real defect in the
 * product, not in this file: each one states the PRD clause it enforces.
 */
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ActionDto, ReplyResponseDto, SweepDto, VerifyFixResponseDto } from '@retrofit/contracts';
import {
  actionsPlanResponseSchema,
  actionsResponseSchema,
  approveActionResponseSchema,
  replyResponseSchema,
  sweepSchema,
  verifyFixResponseSchema,
} from '@retrofit/contracts';
import { readRatingTable } from '@retrofit/engine';
import { createMockAdapter, loadSnapshot } from '@retrofit/federato';
import type { FederatoSnapshot } from '@retrofit/federato';
import { createApp } from '../../apps/api/src/app';
import { createDb } from '../../apps/api/src/db/client';
import type { DbHandle } from '../../apps/api/src/db/client';
import { migrate } from '../../apps/api/src/db/migrate';
import { createRepos } from '../../apps/api/src/db/repos';
import { createFakeLlm } from '../../apps/api/src/llm/fake-provider';
import type { FakeLlmOptions, FakeLlmProvider } from '../../apps/api/src/llm/fake-provider';
import type { AnyGenerateJsonRequest } from '../../apps/api/src/llm/types';
import { SEEDED_SWEEP_ID, runSeed } from '../../apps/api/src/scripts/seed';
import { seededBrokerReply } from '../../apps/api/src/scripts/seed-data';
import { fixedClock } from '../../apps/api/src/services/types';
import type { Deps } from '../../apps/api/src/services/types';

/* -------------------------------------------------------------------------- */
/* Fixture                                                                    */
/* -------------------------------------------------------------------------- */

const NOW = '2026-09-19T12:00:00.000Z';
const REPLY = seededBrokerReply();
const SNAPSHOT: FederatoSnapshot = loadSnapshot();

/** A no-policy property submission: REFER with 7 required fields missing (LIVE_DATA_FACTS). */
const REFER_ACCOUNT = 'SUB-2025-00115';

let handle: DbHandle;

async function seeded(llm: FakeLlmOptions = {}): Promise<{
  deps: Deps;
  llm: FakeLlmProvider;
  app: ReturnType<typeof createApp>;
}> {
  const provider = createFakeLlm(llm);
  const deps: Deps = {
    db: handle.db,
    adapter: createMockAdapter({ snapshot: SNAPSHOT }),
    llm: provider,
    clock: fixedClock(NOW),
  };
  await runSeed(deps, { skipEnrichment: true, log: () => undefined });
  return { deps, llm: provider, app: createApp({ deps }) };
}

function post(app: ReturnType<typeof createApp>, path: string, body: unknown): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

async function planAndApprove(app: ReturnType<typeof createApp>, externalId: string): Promise<ActionDto> {
  const res = await post(app, '/actions/plan', {});
  expect(res.status).toBe(200);
  const plan = actionsPlanResponseSchema.parse(await res.json());
  const draft = plan.actions.find((a) => a.type === 'request' && a.externalId === externalId);
  expect(draft, `a request draft for ${externalId}`).toBeDefined();
  const ok = await post(app, `/actions/${draft!.id}/approve`, {});
  expect(ok.status).toBe(200);
  const approved = approveActionResponseSchema.parse(await ok.json()).action;
  expect(approved.status).toBe('sent');
  return approved;
}

/** Component order of vectors/commercial.json (frozen spec). */
const COMMERCIAL_KEYS = [
  'isNewBusiness',
  'isPropertyLine',
  'stateTier',
  'totalTiv',
  'quotedPremium',
  'pctTivPre1990',
  'pctTivPost2010',
  'pctTivAcceptableConstruction',
  'fiveYearLoss',
  'pctTivSprinklered',
  'tivWeightedProtectionClass',
] as const;

function componentIndex(key: (typeof COMMERCIAL_KEYS)[number]): number {
  return COMMERCIAL_KEYS.indexOf(key);
}

/** A sharp, mid-exposure, textured JPEG that passes the PRD 9.3 quality gate. */
async function goodPhoto(seed: number): Promise<string> {
  const w = 640;
  const h = 480;
  const buf = Buffer.alloc(w * h * 3);
  let s = (seed * 7919 + 17) >>> 0;
  const cell = 40 + (seed % 5) * 24;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const noise = (s >>> 24) - 128;
      const checker = ((Math.floor(x / cell) + Math.floor(y / cell)) % 2) * 50;
      const v = Math.max(20, Math.min(235, 100 + Math.round(((x - w / 2) / w) * 90) + checker + Math.round(noise * 0.3)));
      const i = (y * w + x) * 3;
      buf[i] = v;
      buf[i + 1] = Math.max(20, v - 10);
      buf[i + 2] = Math.min(235, v + 10);
    }
  }
  const jpeg = await sharp(buf, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
  return jpeg.toString('base64');
}

beforeEach(() => {
  handle = createDb({ url: ':memory:' });
  migrate(handle);
});
afterEach(() => handle.close());

/* -------------------------------------------------------------------------- */
/* 1. Plan: routing and a draft naming exactly the missing fields             */
/* -------------------------------------------------------------------------- */

describe('plan actions over the real book', () => {
  it('routes every non-knockout account and drafts a request for each REFER-for-missing-data account', async () => {
    const { app, deps } = await seeded();
    const repos = createRepos(deps.db);
    // All 158 rows are stored now (R2-1); a triage knockout keeps the engine's
    // line in the row column, so filter on the canonical Federato line.
    const property = repos.submissions.all().filter((r) => r.canonical?.lineOfBusiness === 'commercial_property');
    expect(property).toHaveLength(38);

    const res = await post(app, '/actions/plan', {});
    expect(res.status).toBe(200);
    const plan = actionsPlanResponseSchema.parse(await res.json());

    const nonKnockout = property.filter((r) => r.result && !r.result.evaluate.knockout);
    expect(plan.routed + plan.needsSeniorReferral).toBe(nonKnockout.length);
    // The 11 no-policy accounts have no state, so none can be matched to a region.
    expect(plan.needsSeniorReferral).toBe(11);

    const missingDataRefers = property.filter(
      (r) => r.result?.verdict.verdict === 'REFER' && r.result.verdict.missingComponentKeys.length > 0,
    );
    expect(missingDataRefers).toHaveLength(11);
    for (const row of missingDataRefers) {
      const req = plan.actions.find((a) => a.type === 'request' && a.submissionId === row.id);
      expect(req?.triggers).toContain('missing_data');
    }

    // A routed account went to an underwriter whose region and authority fit.
    const routedAction = plan.actions.find((a) => a.type === 'route' && a.routing && !a.routing.needsSeniorReferral);
    expect(routedAction).toBeDefined();
    expect(routedAction!.routing!.underwriterId).not.toBeNull();
  });

  it(`the ${REFER_ACCOUNT} draft names exactly the missing fields, each with a reason, and nothing else`, async () => {
    const { app, deps } = await seeded();
    const row = createRepos(deps.db).submissions.byId(REFER_ACCOUNT)!;
    const result = row.result!;
    expect(result.verdict.verdict).toBe('REFER');
    expect(result.evaluate.appetiteScore).toBe(15);
    expect(result.evaluate.completeness).toBeCloseTo(100 / 9, 9);

    const plan = actionsPlanResponseSchema.parse(await (await post(app, '/actions/plan', {})).json());
    const draft = plan.actions.find((a) => a.type === 'request' && a.submissionId === REFER_ACCOUNT)!;
    expect(draft.status).toBe('draft');
    expect(draft.before).toMatchObject({ verdict: 'REFER', appetiteScore: 15, rank: row.rank });

    // Exactly the engine's missing REQUIRED components (V-6: 0-8); pctTivPost2010
    // rides with pctTivPre1990 (both come from year built). The optional
    // sprinkler / protection-class components are not asked for.
    const requiredMissing = result.evaluate.missingFields.filter((m) => m.required).map((m) => m.componentKey);
    expect(requiredMissing).toHaveLength(8);
    const asked = new Set(draft.fields.map((f) => f.componentKey));
    if (asked.has('pctTivPre1990')) asked.add('pctTivPost2010');
    expect([...asked].sort()).toEqual([...requiredMissing].sort());
    expect(draft.fields.map((f) => f.canonicalPath).sort()).toEqual(
      [
        'submissionType',
        'locations.*.state',
        'buildings.*.tiv',
        'pricing.quotedPremium',
        'buildings.*.yearBuilt',
        'buildings.*.constructionType',
        'rollup.fiveYearLoss',
      ].sort(),
    );
    for (const f of draft.fields) {
      expect(f.why.length).toBeGreaterThan(0);
      expect(draft.draft).toContain(f.label);
    }
    // The canned fake draft asks about "Building C", which was never requested:
    // code's validator rejects it and the deterministic template is used.
    expect(draft.actor).toBe('code');
    expect(draft.draft).not.toMatch(/Building C/);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. The loop on the seeded messy reply                                      */
/* -------------------------------------------------------------------------- */

/**
 * What a faithful extractor reads out of the seeded reply for the fields the
 * no-policy account was asked for. Every quote is a verbatim substring of the
 * reply. Hedged or self-contradicting answers carry a low confidence.
 */
const FAITHFUL_EXTRACTION = {
  values: [
    { canonicalPath: 'buildings.*.tiv', value: 64_500_000, confidence: 0.9, quote: 'at $64.5M, so use that one' },
    { canonicalPath: 'buildings.*.yearBuilt', value: 1978, confidence: 0.5, quote: '1978 he thinks' },
    { canonicalPath: 'buildings.*.yearBuilt', value: 1981, confidence: 0.6, quote: 'on file says 1981' },
    { canonicalPath: 'buildings.*.constructionType', value: 'Joisted Masonry', confidence: 0.6, quote: 'mostly joisted masonry' },
    { canonicalPath: 'rollup.fiveYearLoss', value: 42_000, confidence: 0.85, quote: 'paid about $42,000' },
  ],
  notFound: ['submissionType', 'locations.*.state', 'pricing.quotedPremium'],
};

function extractWith(answer: unknown): FakeLlmOptions {
  return {
    handler: (req: AnyGenerateJsonRequest) => (req.callName === 'extract-reply' ? answer : undefined),
  };
}

describe('the action loop on the seeded broker reply (PRD 7.6, 15)', () => {
  it('extracts with verbatim quotes, and every accepted value moves the engine', async () => {
    const { app, deps, llm } = await seeded(extractWith(FAITHFUL_EXTRACTION));
    const approved = await planAndApprove(app, REFER_ACCOUNT);

    const res = await post(app, `/submissions/${REFER_ACCOUNT}/reply`, { text: REPLY, actionId: approved.id });
    expect(res.status).toBe(200);
    const body: ReplyResponseDto = replyResponseSchema.parse(await res.json());

    // The extractor was given the source text and exactly the requested fields.
    const call = llm.callsFor('extract-reply')[0]!;
    expect(call.prompt).toContain('at $64.5M, so use that one');
    for (const f of approved.fields) expect(call.prompt).toContain(f.canonicalPath);

    // Quotes appear literally (not merely after normalisation) in the seeded reply.
    for (const v of body.extracted) {
      expect(REPLY.includes(v.quote), `quote "${v.quote}"`).toBe(true);
      expect(v.quoteFound).toBe(true);
    }
    // The 0.8 gate: TIV and five-year loss pass; the hedged year and construction go to the underwriter.
    expect(body.accepted.map((v) => v.canonicalPath).sort()).toEqual(['buildings.*.tiv', 'rollup.fiveYearLoss']);
    expect(body.accepted.find((v) => v.canonicalPath === 'buildings.*.tiv')?.value).toBe(64_500_000);
    const confirm = body.needsConfirmation.map((v) => v.canonicalPath);
    expect(confirm).toContain('buildings.*.constructionType');
    expect(confirm).toContain('buildings.*.yearBuilt');
    // The reply action logs the source text and every extracted value.
    expect(body.action.sourceText).toBe(REPLY);
    expect(body.action.extracted).toEqual(body.extracted);

    // PRD 7.6: an accepted value is "written with answer provenance" and re-scored.
    // TIV of $64.5M must now be a known totalTiv component.
    const tivIdx = componentIndex('totalTiv');
    expect(body.result.vector.m[tivIdx], 'accepted TIV reaches the vector').toBe(1);
    expect(body.result.vector.x[tivIdx]).toBe(64_500_000);
    const lossIdx = componentIndex('fiveYearLoss');
    expect(body.result.vector.m[lossIdx], 'accepted five-year loss reaches the vector').toBe(1);
    expect(body.after.completeness).toBeGreaterThan(body.before.completeness);
  });

  it('logs the before/after numbers, the rank move and the source text for an answer that applies', async () => {
    // A second, equally messy reply that answers the submission type; quoted verbatim.
    const text =
      'hey, circling back on Regional Branch 1 -- this one is a renewal, same carrier since 2019. ' +
      'rest of the schedule to follow.';
    const { app, deps } = await seeded(
      extractWith({
        values: [
          { canonicalPath: 'submissionType', value: 'renewal', confidence: 0.93, quote: 'this one is a renewal' },
        ],
        notFound: [],
      }),
    );
    const repos = createRepos(deps.db);
    const before = repos.submissions.byId(REFER_ACCOUNT)!;
    const approved = await planAndApprove(app, REFER_ACCOUNT);

    const res = await post(app, `/submissions/${REFER_ACCOUNT}/reply`, { text, actionId: approved.id });
    expect(res.status).toBe(200);
    const body = replyResponseSchema.parse(await res.json());
    expect(text.includes(body.accepted[0]!.quote)).toBe(true);

    // Real numbers: one of nine required components becomes known (11.1% -> 22.2%);
    // renewal is out of appetite (new business only) so the account is knocked out.
    expect(body.before).toMatchObject({ verdict: 'REFER', appetiteScore: 15, rank: before.rank });
    expect(body.before.completeness).toBeCloseTo(100 / 9, 9);
    expect(body.after.completeness).toBeCloseTo(200 / 9, 9);
    expect(body.after.verdict).toBe('DOES_NOT_FIT');
    expect(body.result.evaluate.knockout).toBe(true);
    expect(body.rankBefore).toBe(2);
    expect(body.rankAfter).toBe(38);
    expect(repos.submissions.byId(REFER_ACCOUNT)!.rank).toBe(38);

    // The written value carries `answer` provenance, never the model's own confidence (V-7).
    const typed = body.result.canonical.submissionType ?? [];
    const answer = typed.find((f) => f.provenance.source === 'answer');
    expect(answer?.value).toBe('renewal');
    expect(answer?.provenance.confidence).toBeUndefined();
    expect(body.after.confidence).toBeCloseTo(0.8, 12);

    // The log: reply + rescore actions carry before/after/rank; the request is marked replied.
    const log = actionsResponseSchema.parse(
      await (await app.request(`/actions?submissionId=${REFER_ACCOUNT}`)).json(),
    );
    expect(log.sendingIsSimulated).toBe(true);
    const reply = log.actions.find((a) => a.type === 'reply')!;
    expect(reply.sourceText).toBe(text);
    expect(reply.before).toEqual(body.before);
    expect(reply.after).toEqual(body.after);
    expect([reply.rankBefore, reply.rankAfter]).toEqual([2, 38]);
    const rescore = log.actions.find((a) => a.type === 'rescore')!;
    expect([rescore.rankBefore, rescore.rankAfter]).toEqual([2, 38]);
    expect(log.actions.find((a) => a.id === approved.id)?.status).toBe('replied');
  });
});

/* -------------------------------------------------------------------------- */
/* 3. The invariant: the LLM never reaches a number except through the engine */
/* -------------------------------------------------------------------------- */

describe('no LLM output reaches a score, verdict or dollar amount on its own (PRD 3, 15)', () => {
  it('rejects invented quotes, unrequested paths and engine outputs; nothing is re-scored', async () => {
    const { app, deps } = await seeded(
      extractWith({
        values: [
          // Confident, but the quote is invented.
          { canonicalPath: 'pricing.quotedPremium', value: 95_000, confidence: 0.99, quote: 'premium is $95,000' },
          // Engine outputs are not fields a reply can write.
          { canonicalPath: 'appetiteScore', value: 100, confidence: 0.99, quote: 'use that one' },
          { canonicalPath: 'verdict', value: 'FIT', confidence: 0.99, quote: 'use that one' },
          // Never requested of this account.
          { canonicalPath: 'pricing.technicalPremium', value: 1, confidence: 0.99, quote: 'thanks' },
        ],
        notFound: [],
      }),
    );
    const repos = createRepos(deps.db);
    const stored = repos.submissions.byId(REFER_ACCOUNT)!;
    const approved = await planAndApprove(app, REFER_ACCOUNT);

    const body = replyResponseSchema.parse(
      await (await post(app, `/submissions/${REFER_ACCOUNT}/reply`, { text: REPLY, actionId: approved.id })).json(),
    );
    // Code drops or rejects all four before anything is written.
    expect(body.accepted).toEqual([]);
    const seen = [...body.extracted, ...body.rejected, ...body.needsConfirmation].map((v) => v.canonicalPath);
    for (const path of ['appetiteScore', 'verdict', 'pricing.technicalPremium']) expect(seen).not.toContain(path);
    for (const v of body.extracted) expect(v.accepted).toBe(false);
    expect(body.after).toEqual(body.before);
    expect(body.rankAfter).toBe(body.rankBefore);
    const after = repos.submissions.byId(REFER_ACCOUNT)!;
    expect(after.result!.evaluate.appetiteScore).toBe(stored.result!.evaluate.appetiteScore);
    expect(after.result!.verdict.verdict).toBe(stored.result!.verdict.verdict);
    expect(after.result!.price.predictedPremium).toBe(stored.result!.price.predictedPremium);
    expect(repos.actions.list({ submissionId: REFER_ACCOUNT, type: 'rescore' }).rows).toHaveLength(0);
  });

  it('the canned fake extraction (a quote not in the seeded reply) changes nothing', async () => {
    const { app, deps } = await seeded();
    const approved = await planAndApprove(app, REFER_ACCOUNT);
    const body = replyResponseSchema.parse(
      await (await post(app, `/submissions/${REFER_ACCOUNT}/reply`, { text: REPLY, actionId: approved.id })).json(),
    );
    expect(REPLY.includes('Building C was built in 1978.')).toBe(false);
    expect(body.accepted).toEqual([]);
    expect(body.after).toEqual(body.before);
    expect(createRepos(deps.db).submissions.byId(REFER_ACCOUNT)!.rank).toBe(body.rankBefore);
  });
});

/* -------------------------------------------------------------------------- */
/* 4. The seeded sweep: verdict, then verify-fix drops the price              */
/* -------------------------------------------------------------------------- */

describe('the seeded sweep (PRD 15 phase 2; PRD 8/9.1 seeded fallback)', () => {
  it('the verdict prices the hazards the sweep saw', async () => {
    const { app } = await seeded();
    const sweep: SweepDto = sweepSchema.parse(await (await app.request(`/sweeps/${SEEDED_SWEEP_ID}`)).json());
    expect(sweep.coverage?.coveragePct).toBe(100);
    const result = sweep.result!;
    // The sweep saw the heater (0.88), the heater-curtain pair, the extension cord, the AC and a laptop.
    const present = result.canonical.hazards.present;
    expect(present.portableHeater?.[0]?.value).toBe(true);
    expect(present.heaterNearCombustible?.[0]?.value).toBe(true);

    // PRD 6.7 tenant: premium = base x contents x age x PRODUCT(hazard factors) x term.
    // A hazard the sweep saw must be a known vector component and a price factor.
    expect(result.verdict.missingComponentKeys).not.toContain('hazardPortableHeater');
    expect(result.verdict.missingComponentKeys).not.toContain('hazardHeaterNearCombustible');
    expect(result.vector.m[0], 'hazardPortableHeater known').toBe(1);
    expect(result.vector.m[1], 'hazardHeaterNearCombustible known').toBe(1);
    const table = await readRatingTable('tenant');
    const base12 = table.baseMonthlyRate * 12;
    expect(result.price.predictedPremium!).toBeGreaterThan(base12);
  });

  it('verify-fix on the heater-curtain pair lowers the price by that hazard factor', async () => {
    const { app, llm } = await seeded();
    const res = await post(app, `/sweeps/${SEEDED_SWEEP_ID}/verify-fix`, {
      hazardKey: 'hazards.heaterNearCombustible',
      imageBase64: await goodPhoto(42),
      capturedAt: '2026-09-19T12:05:00.000Z',
    });
    expect(res.status).toBe(200);
    const body: VerifyFixResponseDto = verifyFixResponseSchema.parse(await res.json());
    expect(llm.callsFor('verify-fix')).toHaveLength(1);
    expect(body).toMatchObject({ hazardKey: 'heaterNearCombustible', stillPresent: false, confidence: 0.88 });
    expect(body.result.canonical.hazards.present.heaterNearCombustible?.map((f) => f.value)).toEqual([false]);

    // The model only said "gone, 0.88"; the dollar change is the rating table's factor.
    const table = await readRatingTable('tenant');
    const factor = (table as unknown as { hazards: Record<string, number> }).hazards['heaterNearCombustible']!;
    expect(factor).toBe(1.25);
    const before = body.before.predictedPremium!;
    const after = body.after.predictedPremium!;
    expect(after, `price after fix (${after}) below price before (${before})`).toBeLessThan(before);
    expect(before / after).toBeCloseTo(factor, 1);
  });

  it('a VOI answer for year built reaches the tenant vector', async () => {
    const { app } = await seeded();
    const res = await post(app, `/sweeps/${SEEDED_SWEEP_ID}/answers`, {
      answers: [{ questionId: 'q-year-built', field: 'buildings[0].yearBuilt', value: 1962 }],
    });
    expect(res.status).toBe(200);
    const sweep = sweepSchema.parse(await res.json());
    const result = sweep.result!;
    expect(result.canonical.buildings[0]?.yearBuilt?.map((f) => f.value)).toEqual([1962]);
    // Component 11 of vectors/tenant.json is buildingYearBuilt (source buildings[0].yearBuilt).
    expect(result.vector.m[11], 'buildingYearBuilt known after the answer').toBe(1);
    expect(result.vector.x[11]).toBe(1962);
    expect(result.price.factors.find((f) => f.name === 'buildingAge')?.factor).toBe(1.2);
  });
});
