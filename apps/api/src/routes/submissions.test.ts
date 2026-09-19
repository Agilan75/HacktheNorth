import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { queueResponseSchema, submissionDetailSchema } from '@retrofit/contracts';
import type {
  ErrorDto,
  QueueResponseDto,
  RoutingDecisionDto,
  SubmissionDetailDto,
} from '@retrofit/contracts';
import type {
  AppetiteFactorId,
  CanonicalSubmission,
  Contradiction,
  EngineResult,
  FactorOutcome,
  Flip,
  RawBundle,
  Tier,
  Verdict,
} from '@retrofit/engine';
import type { FederatoAdapter } from '@retrofit/federato';
import { explain } from '@retrofit/federato';
import { readVectorSpec, rollup } from '@retrofit/engine';
import { createApp } from '../app';
import { createDb } from '../db/client';
import type { DbHandle } from '../db/client';
import { migrate } from '../db/migrate';
import { createRepos } from '../db/repos';
import type { Repos } from '../db/repos';
import { createFakeLlm } from '../llm/fake-provider';
import type { FakeLlmProvider } from '../llm/fake-provider';
import { fixedClock } from '../services/types';
import type { Deps } from '../services/types';
import { registerSubmissionRoutes } from './submissions';

/* -------------------------------------------------------------------------- */
/* Fixtures: weights and tier values from INTERPRETATIONS.md §1–2             */
/* -------------------------------------------------------------------------- */

const WEIGHTS: Record<AppetiteFactorId, number> = {
  submission_type: 0.1,
  line_of_business: 0.15,
  primary_risk_state: 0.15,
  tiv: 0.15,
  total_premium: 0.15,
  building_age: 0.1,
  construction_type: 0.1,
  loss_value: 0.1,
};
const TIER_VALUE: Record<Tier, number> = { target: 1, acceptable: 0.6, not_acceptable: 0, refer: 0.6 };
const ORDER = Object.keys(WEIGHTS) as AppetiteFactorId[];

function factors(tiers: Partial<Record<AppetiteFactorId, Tier>>): FactorOutcome[] {
  return ORDER.map((factor) => {
    const tier = tiers[factor] ?? 'target';
    const tierValue = TIER_VALUE[tier];
    return {
      factor,
      componentKeys: [factor],
      tier,
      tierValue,
      weight: WEIGHTS[factor],
      points: 100 * WEIGHTS[factor] * tierValue,
      known: true,
      knockout: tierValue === 0,
      refer: tier === 'refer',
      ruleId: `R-${factor}`,
      citation: { doc: 'APPETITE_GUIDELINES.pdf', section: `p2 ${factor}`, quote: `quote ${factor}` },
    };
  });
}

const sr = <T>(value: T) => [{ value, provenance: { source: 'self_reported' as const } }];

const CANONICAL: CanonicalSubmission = {
  id: 'SUB-1001',
  lineOfBusiness: 'commercial_property',
  submissionType: sr('new_business' as const),
  insured: { name: sr('Acme Holdings') },
  locations: [
    { externalId: 'L1', state: sr('CA'), city: sr('Fresno'), protectionClass: sr(3) },
    { externalId: 'L2', state: sr('TX'), city: sr('Austin') },
  ],
  buildings: [
    {
      externalId: 'B1',
      label: 'Warehouse',
      locationExternalId: 'L1',
      tiv: sr(40_000_000),
      yearBuilt: sr(1978),
      constructionType: sr('Joisted Masonry'),
      sprinklered: sr(true),
      stories: sr(2),
    },
    {
      externalId: 'B2',
      locationExternalId: 'L2',
      tiv: sr(25_000_000),
      yearBuilt: sr(2012),
      constructionType: sr('Fire Resistive'),
      sprinklered: sr(false),
      stories: sr(5),
      protectionClass: sr(2),
    },
  ],
  hazards: { present: {} },
  exposure: {},
  coverage: { lines: [] },
  history: [],
  pricing: { quotedPremium: sr(88_000) },
  fieldMap: { entries: [], unmapped: [] } as unknown as CanonicalSubmission['fieldMap'],
};

const premiumFlip: Flip = {
  moves: [
    { componentIndex: 4, componentKey: 'quotedPremium', from: 240_000, to: 175_000, deltaScaled: 0.1, label: 'premium' },
  ],
  scoreBefore: 85,
  scoreAfter: 100,
  premiumBefore: 240_000,
  premiumAfter: 175_000,
  verdictAfter: 'FIT',
  distanceScaled: 0.1,
};

interface Opts {
  id: string;
  verdict: Verdict;
  tiers?: Partial<Record<AppetiteFactorId, Tier>>;
  primaryState?: string;
  flip?: Flip | null;
  contradictions?: Contradiction[];
  qualityIndex?: number;
}

function makeResult(o: Opts): EngineResult {
  const fs = factors(o.tiers ?? {});
  const score = fs.reduce((s, f) => s + f.points, 0);
  const knockoutFactors = fs.filter((f) => f.knockout).map((f) => f.factor);
  const result = {
    id: o.id,
    lineOfBusiness: 'commercial_property',
    asOf: '2026-09-19',
    specVersion: '1',
    rulebookVersion: '1',
    ratingVersion: '1',
    canonical: { ...CANONICAL, id: o.id },
    rollup: {
      totalTiv: 65_000_000,
      buildingCount: 2,
      tivKnownBuildingCount: 2,
      pctTivPre1990: 40 / 65,
      pctTivPost2010: 25 / 65,
      pctTivByConstruction: [
        // Engine rollup keys are canonical classes (rollup.ts canonicalClass), never raw spellings.
        { constructionType: 'joisted_masonry', tiv: 40_000_000, share: 40 / 65, acceptable: false, assumedAcceptable: false },
        { constructionType: 'fire_resistive', tiv: 25_000_000, share: 25 / 65, acceptable: true, assumedAcceptable: true },
      ],
      pctTivAcceptableConstruction: 25 / 65,
      pctTivSprinklered: 40 / 65,
      tivWeightedProtectionClass: 2.6,
      primaryState: o.primaryState ?? 'CA',
      stateShares: [{ state: o.primaryState ?? 'CA', tiv: 65_000_000, share: 1 }],
      fiveYearLoss: 32_000,
      fiveYearClaimCount: 1,
      claimCount: 1,
      pre1990BuildingIds: ['B1'],
      oldestYearBuilt: 1978,
      newestYearBuilt: 2012,
      lossWindow: null,
    },
    vector: { lineOfBusiness: 'commercial_property', specVersion: '1', x: [1], t: [1], m: [1] },
    contradictions: o.contradictions ?? [],
    evaluate: {
      appetiteScore: score,
      factors: fs,
      firedRules: fs.map((f) => ({
        ruleId: f.ruleId,
        factor: f.factor,
        tier: f.tier,
        tierValue: f.tierValue,
        weight: f.weight,
        points: f.points,
        citation: f.citation,
        conditions: [],
        extension: false,
      })),
      knockout: knockoutFactors.length > 0,
      knockoutFactors,
      referFactors: fs.filter((f) => f.refer).map((f) => f.factor),
      missingFields: [],
      completeness: 90,
      confidence: 0.72,
      interpretationsApplied: [],
    },
    price: {
      lineOfBusiness: 'commercial_property',
      currency: 'USD',
      predictedPremium: 84_120,
      predictedMonthlyPremium: null,
      termMonths: 12,
      perBuilding: [],
      factors: [],
      lossHistoryFactor: null,
      expectedAnnualLoss: null,
      expectedLossDetail: null,
      quotedPremium: 88_000,
      adequacy: 88_000 / 84_120,
      ratePer100: 0.13,
      basis: 'table',
      fitError: null,
      estimate: false,
    },
    verdict: {
      verdict: o.verdict,
      decidingRule: null,
      reasons: [],
      distanceToAppetite: o.verdict === 'FIT' ? 0 : o.flip ? (o.flip.moves.length as 1 | 2) : null,
      openHighContradictionIds: (o.contradictions ?? []).filter((c) => c.severity === 'HIGH').map((c) => c.id),
      missingComponentKeys: [],
    },
    flip: { flip: o.flip ?? null, reason: o.flip ? null : 'no flip', blockedByImmovable: [] },
    voi: { nextQuestion: null, ranked: [], skipped: [], askedCount: 0 },
    peers: null,
    qualityIndex: o.qualityIndex ?? 70,
    qualityComponents: { appetite: score, adequacy: 90, lossRatio: 80, completeness: 90, confidence: 72 },
    interpretations: [],
    explanation: `Template explanation for ${o.id}.`,
  };
  return result as unknown as EngineResult;
}

const contradiction = (id: string, severity: 'HIGH' | 'LOW', status: 'open' | 'resolved'): Contradiction => ({
  id,
  canonicalPath: 'buildings.B1.yearBuilt',
  values: [],
  severity,
  affectedRules: [],
  status,
});

const rawWithLine = (externalId: string, line: string): RawBundle => ({
  externalId,
  records: { Submission: [{ resource: 'Submission', id: 1, data: { submission_number: externalId, line_of_business: line } }] },
});

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

const NOW = '2026-09-19T12:00:00.000Z';
const unused = () => Promise.reject(new Error('unused'));
const adapter: FederatoAdapter = {
  kind: 'mock',
  getSchema: unused,
  query: unused,
  getGuidelines: unused,
  getGlossary: unused,
};

let handle: DbHandle;
let llm: FakeLlmProvider;
let deps: Deps;
let repos: Repos;

function setup(llmProvider: FakeLlmProvider = createFakeLlm()) {
  handle = createDb({ url: ':memory:' });
  migrate(handle);
  llm = llmProvider;
  deps = { db: handle.db, adapter, llm, clock: fixedClock(NOW) };
  repos = createRepos(deps.db);
}

afterEach(() => handle.close());

const makeApp = () => createApp({ deps, registrars: [registerSubmissionRoutes] });

function insert(
  externalId: string,
  result: EngineResult | null,
  rank: number | null,
  raw: RawBundle | null = null,
) {
  return repos.submissions.upsertByExternalId({
    id: `id-${externalId}`,
    source: 'federato',
    lineOfBusiness: 'commercial_property',
    externalId,
    insuredName: `Insured ${externalId}`,
    raw,
    canonical: result?.canonical ?? null,
    result,
    queryTrace: [],
    rank,
    createdAt: '2026-09-18T10:00:00.000Z',
    updatedAt: '2026-09-18T10:00:00.000Z',
  });
}

const ROUTING: RoutingDecisionDto = {
  submissionId: 'id-SUB-A',
  primaryState: 'CA',
  requestedLimit: 65_000_000,
  assigned: { id: 7, name: 'Dana Reyes', email: 'dana@example.com', team: 'West', region: 'West', authorityLimit: 100_000_000 },
  needsSeniorReferral: false,
  reason: 'West region, authority covers the limit',
  candidates: [],
};

function seedBook() {
  insert('SUB-A', makeResult({ id: 'SUB-A', verdict: 'FIT', qualityIndex: 91 }), 1);
  insert(
    'SUB-B',
    makeResult({ id: 'SUB-B', verdict: 'DOES_NOT_FIT', tiers: { total_premium: 'not_acceptable' }, primaryState: 'TX', flip: premiumFlip }),
    3,
  );
  insert(
    'SUB-C',
    makeResult({
      id: 'SUB-C',
      verdict: 'REFER',
      tiers: { building_age: 'refer' },
      contradictions: [contradiction('C1', 'HIGH', 'open'), contradiction('C2', 'HIGH', 'resolved'), contradiction('C3', 'LOW', 'open')],
    }),
    2,
  );
  insert(
    'SUB-D',
    makeResult({ id: 'SUB-D', verdict: 'DOES_NOT_FIT', tiers: { line_of_business: 'not_acceptable' } }),
    null,
    rawWithLine('SUB-D', 'health'),
  );
  insert('SUB-E', null, null);

  repos.actions.insert({
    id: 'act-route-A',
    submissionId: 'id-SUB-A',
    type: 'route',
    status: 'applied',
    actor: 'code',
    payload: { routing: ROUTING },
    createdAt: '2026-09-18T11:00:00.000Z',
  });
  repos.actions.insert({
    id: 'act-req-B',
    submissionId: 'id-SUB-B',
    type: 'request',
    status: 'draft',
    actor: 'gemini:draft-request',
    payload: { triggers: ['one_flip_from_fit'], draft: 'Please confirm the premium.', rankBefore: 3 },
    createdAt: '2026-09-18T11:05:00.000Z',
  });
}

async function queue(query = ''): Promise<QueueResponseDto> {
  const res = await makeApp().request(`/submissions${query}`);
  expect(res.status).toBe(200);
  return queueResponseSchema.parse(await res.json());
}

/* -------------------------------------------------------------------------- */
/* GET /submissions                                                           */
/* -------------------------------------------------------------------------- */

describe('GET /submissions', () => {
  beforeEach(() => {
    setup();
    seedBook();
  });

  it('returns only scored rows, in rank order, with unranked rows last', async () => {
    const body = await queue();
    expect(body.rows.map((r) => r.externalId)).toEqual(['SUB-A', 'SUB-C', 'SUB-B', 'SUB-D']);
    // Stored ranks are served unchanged; the unranked row takes its queue position.
    expect(body.rows.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    expect(body.page).toEqual({ total: 4, limit: 200, offset: 0 });
    expect(body.adapter).toBe('mock');
    expect(body.filters).toEqual({});
  });

  it('serves the stored engine numbers unchanged (score = 100 · w·t)', async () => {
    const byId = new Map((await queue()).rows.map((r) => [r.externalId, r]));
    // All eight factors Target -> 100.
    expect(byId.get('SUB-A')?.appetiteScore).toBeCloseTo(100, 9);
    // Premium Not Acceptable (w 0.15, t 0) -> 85.
    expect(byId.get('SUB-B')?.appetiteScore).toBeCloseTo(85, 9);
    // Building age REFER (w 0.10, t 0.6) -> 96.
    expect(byId.get('SUB-C')?.appetiteScore).toBeCloseTo(96, 9);
    const a = byId.get('SUB-A');
    expect(a).toMatchObject({
      verdict: 'FIT',
      qualityIndex: 91,
      primaryState: 'CA',
      totalTiv: 65_000_000,
      quotedPremium: 88_000,
      predictedPremium: 84_120,
      completeness: 90,
      confidence: 0.72,
      insuredName: 'Insured SUB-A',
      explanation: 'Template explanation for SUB-A.',
      updatedAt: '2026-09-18T10:00:00.000Z',
    });
    expect(a?.adequacy).toBeCloseTo(88_000 / 84_120, 12);
  });

  it('flags the 1-flip-from-FIT badge and counts open HIGH contradictions', async () => {
    const byId = new Map((await queue()).rows.map((r) => [r.externalId, r]));
    expect(byId.get('SUB-B')).toMatchObject({ oneFlipFromFit: true, distanceToAppetite: 1 });
    expect(byId.get('SUB-A')?.oneFlipFromFit).toBe(false);
    expect(byId.get('SUB-D')?.oneFlipFromFit).toBe(false);
    expect(byId.get('SUB-C')).toMatchObject({ contradictionCount: 3, openHighContradictionCount: 1 });
  });

  it('collapses the non-property row under its Federato line', async () => {
    const byId = new Map((await queue()).rows.map((r) => [r.externalId, r]));
    expect(byId.get('SUB-D')).toMatchObject({ outOfAppetiteLine: true, lineOfBusiness: 'health' });
    expect(byId.get('SUB-A')).toMatchObject({ outOfAppetiteLine: false, lineOfBusiness: 'commercial_property' });
  });

  it('carries the assigned underwriter and the pending action', async () => {
    const byId = new Map((await queue()).rows.map((r) => [r.externalId, r]));
    expect(byId.get('SUB-A')?.assignedUnderwriter?.id).toBe(7);
    // An applied route is not pending.
    expect(byId.get('SUB-A')?.pendingAction).toBeNull();
    expect(byId.get('SUB-B')?.pendingAction).toEqual({ id: 'act-req-B', type: 'request', status: 'draft' });
    expect(byId.get('SUB-B')?.assignedUnderwriter).toBeNull();
  });

  it('filters by verdict, line, state and underwriter', async () => {
    expect((await queue('?verdict=DOES_NOT_FIT')).rows.map((r) => r.externalId)).toEqual(['SUB-B', 'SUB-D']);
    expect((await queue('?line=health')).rows.map((r) => r.externalId)).toEqual(['SUB-D']);
    expect((await queue('?line=commercial_property')).rows.map((r) => r.externalId)).toEqual(['SUB-A', 'SUB-C', 'SUB-B']);
    expect((await queue('?state=tx')).rows.map((r) => r.externalId)).toEqual(['SUB-B']);
    const byUw = await queue('?underwriterId=7');
    expect(byUw.rows.map((r) => r.externalId)).toEqual(['SUB-A']);
    expect(byUw.filters).toEqual({ underwriterId: 7 });
  });

  it('pages after filtering; total counts the filtered set', async () => {
    const body = await queue('?limit=2&offset=1');
    expect(body.rows.map((r) => r.externalId)).toEqual(['SUB-C', 'SUB-B']);
    expect(body.page).toEqual({ total: 4, limit: 2, offset: 1 });
  });

  it('a bad query is a 422 with issues', async () => {
    const res = await makeApp().request('/submissions?verdict=MAYBE&limit=0');
    expect(res.status).toBe(422);
    const body = (await res.json()) as ErrorDto;
    expect(body.error.code).toBe('INVALID_REQUEST');
    expect((body.error.issues ?? []).map((i) => i.path).sort()).toEqual(['limit', 'verdict']);
  });
});

/* -------------------------------------------------------------------------- */
/* GET /submissions/:id                                                       */
/* -------------------------------------------------------------------------- */

async function detail(id: string): Promise<SubmissionDetailDto> {
  const res = await makeApp().request(`/submissions/${id}`);
  expect(res.status).toBe(200);
  return submissionDetailSchema.parse(await res.json());
}

describe('GET /submissions/:id', () => {
  it('404 for an unknown id, 409 for an unscored submission', async () => {
    setup();
    seedBook();
    const missing = await makeApp().request('/submissions/nope');
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as ErrorDto).error.code).toBe('NOT_FOUND');
    const unscored = await makeApp().request('/submissions/id-SUB-E');
    expect(unscored.status).toBe(409);
    expect(((await unscored.json()) as ErrorDto).error.code).toBe('NOT_SCORED');
  });

  it('returns the stored result unchanged, with its parts, actions and routing', async () => {
    setup();
    seedBook();
    const stored = repos.submissions.byId('id-SUB-B')?.result;
    const body = await detail('id-SUB-B');
    expect(body.result).toEqual(stored);
    expect(body.rollup).toEqual(stored?.rollup);
    expect(body.price.predictedPremium).toBe(84_120);
    expect(body.flip.flip?.verdictAfter).toBe('FIT');
    expect(body.rank).toBe(3);
    expect(body.source).toBe('federato');
    expect(body.fieldMap).toEqual(CANONICAL.fieldMap);
    expect(body.actions).toHaveLength(1);
    expect(body.actions[0]).toMatchObject({
      id: 'act-req-B',
      externalId: 'SUB-B',
      insuredName: 'Insured SUB-B',
      triggers: ['one_flip_from_fit'],
      draft: 'Please confirm the premium.',
      rankBefore: 3,
      rankAfter: null,
      extracted: [],
    });
    expect(body.routing).toBeNull();
    expect(body.attachedSweep).toBeNull();
    expect((await detail('id-SUB-A')).routing?.assigned?.id).toBe(7);
  });

  it('carries the active vector spec for the line, so the console keeps no private copy (C01)', async () => {
    setup();
    seedBook();
    const body = await detail('id-SUB-B');
    const spec = await readVectorSpec('commercial_property');
    expect(body.vectorSpec).toEqual(spec);
    expect(body.vectorSpec?.components.map((c) => c.key)).toContain('totalTiv');
    const tiv = body.vectorSpec?.components.find((c) => c.key === 'totalTiv');
    expect(tiv).toMatchObject({ label: expect.any(String), immovable: false, appetiteFactor: true });
  });

  it('accepts the external submission number as well as the id', async () => {
    setup();
    seedBook();
    expect((await detail('SUB-C')).id).toBe('id-SUB-C');
  });

  it('builds the buildings table with the INTERPRETATIONS 3.4 age boundaries', async () => {
    setup();
    seedBook();
    const { buildings } = await detail('id-SUB-A');
    expect(buildings).toEqual([
      {
        externalId: 'B1',
        name: 'Warehouse',
        tiv: 40_000_000,
        yearBuilt: 1978,
        constructionType: 'Joisted Masonry',
        sprinklered: true,
        stories: 2,
        protectionClass: 3, // from the location
        state: 'CA',
        city: 'Fresno',
        pre1990: true,
        post2010: false,
        acceptableConstruction: false,
        assumedAcceptableConstruction: false,
      },
      {
        externalId: 'B2',
        name: null,
        tiv: 25_000_000,
        yearBuilt: 2012,
        constructionType: 'Fire Resistive',
        sprinklered: false,
        stories: 5,
        protectionClass: 2, // the building's own wins
        state: 'TX',
        city: 'Austin',
        pre1990: false,
        post2010: true,
        acceptableConstruction: true,
        assumedAcceptableConstruction: true,
      },
    ]);
  });

  it('flags construction from the engine rollup key, so a Steel Frame building is acceptable (R4-9 / R5-3)', async () => {
    setup();
    // Ingest stores the G-8 snake_case class ("Steel Frame" -> steel_frame); the
    // engine rollup aliases it to its canonical `steel`, which is acceptable
    // (docs/decisions/E03.md D1). The rollup here is the real engine stage.
    const canonical: CanonicalSubmission = {
      ...CANONICAL,
      id: 'SUB-STEEL',
      buildings: [
        { ...CANONICAL.buildings[0]!, constructionType: sr('steel_frame') },
        { ...CANONICAL.buildings[1]!, constructionType: sr('joisted_masonry') },
      ],
    };
    const base = makeResult({ id: 'SUB-STEEL', verdict: 'FIT' });
    const result = { ...base, canonical, rollup: rollup(canonical, '2026-09-19') } as EngineResult;
    expect(result.rollup.pctTivByConstruction.map((c) => [c.constructionType, c.acceptable])).toEqual([
      ['steel', true],
      ['joisted_masonry', true],
    ]);
    insert('SUB-STEEL', result, 1);
    const { buildings } = await detail('SUB-STEEL');
    expect(buildings.map((b) => [b.constructionType, b.acceptableConstruction])).toEqual([
      ['steel_frame', true],
      ['joisted_masonry', true],
    ]);
  });

  it('serves the deterministic template when narration fails its number check', async () => {
    setup(); // the canned narrate text carries numbers this account does not have
    seedBook();
    const body = await detail('id-SUB-A');
    const row = repos.submissions.byId('id-SUB-A');
    const expected = explain({ result: row!.result!, insuredName: 'Insured SUB-A', rank: 1 });
    expect(body.explanation?.narrated).toBe(false);
    expect(body.explanation?.text).toBe(expected.template);
    expect(body.explanation?.recommendation).toBe('accept');
    expect(llm.callsFor('narrate').length).toBeGreaterThan(0);
  });

  it('uses a narration that keeps every number, and narrates once per version', async () => {
    const result = makeResult({ id: 'SUB-A', verdict: 'FIT', qualityIndex: 91 });
    const template = explain({ result, insuredName: 'Insured SUB-A', rank: 1 }).template;
    const polished = `In short: ${template}`;
    setup(createFakeLlm({ overrides: { narrate: { text: polished } } }));
    seedBook();
    const app = makeApp();
    const first = submissionDetailSchema.parse(await (await app.request('/submissions/id-SUB-A')).json());
    expect(first.explanation?.narrated).toBe(true);
    expect(first.explanation?.text).toBe(polished);
    expect(first.explanation?.template).toBe(template);
    const calls = llm.callsFor('narrate').length;
    await app.request('/submissions/id-SUB-A');
    expect(llm.callsFor('narrate').length).toBe(calls);
  });

  it('turns enrichment rows into cards, including the unavailable case', async () => {
    setup();
    seedBook();
    repos.enrichments.upsert({
      id: 'en-1',
      submissionId: 'id-SUB-A',
      source: 'openfema_flood',
      available: true,
      payload: {
        raw: { zone: 'X' },
        card: {
          source: 'openfema_flood',
          title: 'Flood zone',
          available: true,
          unavailableReason: null,
          fetchedAt: NOW,
          fields: [{ canonicalPath: 'locations.L1.floodZone', label: 'Flood zone', valueText: 'X', value: 'X' }],
          attribution: 'OpenFEMA',
        },
      },
      createdAt: NOW,
    });
    repos.enrichments.upsert({
      id: 'en-2',
      submissionId: 'id-SUB-A',
      source: 'overpass_fire_station',
      available: false,
      payload: { error: 'timed out after 6000 ms' },
      createdAt: NOW,
    });
    const { enrichment } = await detail('id-SUB-A');
    expect(enrichment.map((c) => c.source)).toEqual(['openfema_flood', 'overpass_fire_station']);
    expect(enrichment[0]?.fields[0]?.valueText).toBe('X');
    expect(enrichment[1]).toMatchObject({
      available: false,
      unavailableReason: 'timed out after 6000 ms',
      fields: [],
    });
  });

  it('attaches the newest sweep, with low-confidence observations awaiting confirmation', async () => {
    setup();
    seedBook();
    const obs = (id: string, confidence: number) => ({
      id,
      label: 'candle' as const,
      category: 'ignition' as const,
      bearingDeg: 90,
      distanceBand: 'near' as const,
      confidence,
      frameIndex: 0,
    });
    repos.sweeps.insert({
      id: 'sw-1',
      submissionId: 'id-SUB-A',
      roomLabel: 'Kitchen',
      term: 8,
      stage: 'done',
      observations: [obs('o1', 0.9), obs('o2', 0.55)] as never,
      createdAt: '2026-09-18T12:00:00.000Z',
      updatedAt: '2026-09-18T12:00:00.000Z',
    });
    const { attachedSweep } = await detail('id-SUB-A');
    expect(attachedSweep).toMatchObject({ id: 'sw-1', roomLabel: 'Kitchen', termMonths: 8, stage: 'done' });
    expect(attachedSweep?.needsConfirmation.map((o) => o.id)).toEqual(['o2']);
  });
});

/* -------------------------------------------------------------------------- */
/* FILL-backend: facts, account kind, display line, peer verdicts, verification */
/* -------------------------------------------------------------------------- */

const FACTS = {
  source: 'federato_triage' as const,
  traceId: 'q-000',
  federatoId: 42,
  submissionNumber: 'SUB-K',
  insuredName: 'Northwind Cyber Ltd',
  brokerName: 'Highland Risk Partners',
  underwriterName: 'F. Adeyemi',
  lineOfBusiness: 'cyber',
  status: 'declined',
  requestedLimit: 5_000_000,
  receivedDate: '2025-03-01',
  targetEffectiveDate: '2025-04-01',
  declineReason: 'Outside appetite',
  competitor: null,
};

const policyRaw = (externalId: string): RawBundle => ({
  externalId,
  records: { Policy: [{ resource: 'Policy', id: 9, data: { line_of_business: 'property' } }] },
});
const noPolicyRaw = (externalId: string): RawBundle => ({
  externalId,
  records: { Submission: [{ resource: 'Submission', id: 9, data: { submission_number: externalId, line_of_business: 'property' } }] },
});

describe('GET /submissions/:id — who and what the account is (FILL-backend)', () => {
  it('shows a triage knockout under its Federato line, never commercial_property, with its facts', async () => {
    setup();
    const ko = insert(
      'SUB-K',
      makeResult({ id: 'SUB-K', verdict: 'DOES_NOT_FIT', tiers: { line_of_business: 'not_acceptable' } }),
      9,
      rawWithLine('SUB-K', 'cyber'),
    );
    repos.submissions.update(ko.id, { facts: FACTS });
    const d = await detail('SUB-K');
    expect(d.accountKind).toBe('triage_knockout');
    expect(d.displayLineOfBusiness).toBe('cyber');
    // `lineOfBusiness` stays the spec it was scored on.
    expect(d.lineOfBusiness).toBe('commercial_property');
    expect(d.facts).toEqual(FACTS);
    expect(d.verification).toBeNull();
    const row = (await queue()).rows.find((r) => r.externalId === 'SUB-K')!;
    expect(row).toMatchObject({ accountKind: 'triage_knockout', lineOfBusiness: 'cyber' });
  });

  it('tells a scored account from a no-policy account', async () => {
    setup();
    insert('SUB-P', makeResult({ id: 'SUB-P', verdict: 'FIT' }), 1, policyRaw('SUB-P'));
    const bare = makeResult({ id: 'SUB-N', verdict: 'REFER' });
    insert('SUB-N', { ...bare, canonical: { ...bare.canonical, buildings: [] } }, 2, noPolicyRaw('SUB-N'));
    const p = await detail('SUB-P');
    const n = await detail('SUB-N');
    expect(p.accountKind).toBe('scored');
    expect(p.displayLineOfBusiness).toBe('commercial_property');
    expect(n.accountKind).toBe('no_policy');
    const kinds = new Map((await queue()).rows.map((r) => [r.externalId, r.accountKind]));
    expect(kinds.get('SUB-P')).toBe('scored');
    expect(kinds.get('SUB-N')).toBe('no_policy');
  });

  it('scores a no-policy account once buildings are supplied, and flags synthetic values', async () => {
    setup();
    const base = makeResult({ id: 'SUB-S', verdict: 'FIT' });
    const tagged = {
      ...base,
      canonical: {
        ...base.canonical,
        submissionType: [{ value: 'new_business', provenance: { source: 'answer', sourceDetail: 'synthetic:backfill-v1' } }],
      },
    } as EngineResult;
    insert('SUB-S', tagged, 1, noPolicyRaw('SUB-S'));
    insert('SUB-P', makeResult({ id: 'SUB-P', verdict: 'FIT' }), 2, policyRaw('SUB-P'));
    const s = await detail('SUB-S');
    expect(s.accountKind).toBe('scored');
    expect(s.synthetic).toBe(true);
    expect((await detail('SUB-P')).synthetic).toBe(false);
    const row = (await queue()).rows.find((r) => r.externalId === 'SUB-S')!;
    expect(row).toMatchObject({ accountKind: 'scored', synthetic: true });
  });

  it('falls back to Federato\'s own underwriter when Retrofit has not routed the account', async () => {
    setup();
    const row = insert('SUB-F', makeResult({ id: 'SUB-F', verdict: 'DOES_NOT_FIT' }), 1, policyRaw('SUB-F'));
    repos.submissions.update(row.id, { facts: { ...FACTS, underwriterName: 'O. Tanaka' } });
    const q = (await queue()).rows.find((r) => r.externalId === 'SUB-F')!;
    expect(q.assignedUnderwriter).toBeNull();
    expect(q.federatoUnderwriter).toBe('O. Tanaka');
  });

  it('says so when a row was stored before facts were read: every fact absent, none guessed', async () => {
    setup();
    insert('SUB-P', makeResult({ id: 'SUB-P', verdict: 'FIT' }), 1, policyRaw('SUB-P'));
    const { facts } = await detail('SUB-P');
    expect(facts.source).toBe('not_fetched');
    expect(facts.submissionNumber).toBe('SUB-P');
    const { source: _s, submissionNumber: _n, ...rest } = facts;
    expect(Object.values(rest).every((v) => v === null)).toBe(true);
  });

  it('gives every peer its verdict from its own stored result, and null for a peer with none', async () => {
    setup();
    insert('SUB-B', makeResult({ id: 'SUB-B', verdict: 'DOES_NOT_FIT', tiers: { tiv: 'not_acceptable' } }), 2, policyRaw('SUB-B'));
    insert('SUB-C', makeResult({ id: 'SUB-C', verdict: 'REFER', tiers: { building_age: 'refer' } }), 3, policyRaw('SUB-C'));
    const peer = (id: string, distance: number) => ({
      id,
      label: id,
      distance,
      comparedComponents: 6,
      ratePer100: 0.12,
      annualLoss: 1000,
      totalTiv: 1,
      quotedPremium: 1,
      coarse: false,
    });
    const result = {
      ...makeResult({ id: 'SUB-A', verdict: 'FIT' }),
      peers: {
        k: 5,
        peers: [peer('id-SUB-B', 0.1), peer('id-SUB-C', 0.2), peer('id-SUB-GONE', 0.3)],
        medianRatePer100: 0.12,
        meanAnnualLoss: 1000,
        coarse: false,
        componentsUsed: [2, 3],
      },
    } as EngineResult;
    insert('SUB-A', result, 1, policyRaw('SUB-A'));
    const d = await detail('SUB-A');
    expect(d.peers!.peers.map((p) => [p.id, p.verdict])).toEqual([
      ['id-SUB-B', 'DOES_NOT_FIT'],
      ['id-SUB-C', 'REFER'],
      ['id-SUB-GONE', null],
    ]);
    // The rest of the benchmark is served unchanged.
    expect(d.peers!.medianRatePer100).toBe(0.12);
    expect(d.result.peers!.peers[0]).not.toHaveProperty('verdict');
  });

  it('attaches the committed verification record to a real property account, and says whether it still matches', async () => {
    setup();
    // SUB-2026-00081 is FIT at 88.0 in packages/verify/out/per-account.json.
    const same = makeResult({
      id: 'SUB-2026-00081',
      verdict: 'FIT',
      tiers: { tiv: 'acceptable', total_premium: 'acceptable' },
    });
    insert('SUB-2026-00081', same, 1, policyRaw('SUB-2026-00081'));
    const d = await detail('SUB-2026-00081');
    expect(d.verification).not.toBeNull();
    const v = d.verification!;
    expect(v.caseId).toBe('SUB-2026-00081');
    expect(v.engine.verdict).toBe('FIT');
    expect(v.matchesCurrentResult).toBe(true);
    expect(v.naive.agrees.all).toBe(true);
    expect(v.secondOpinion?.agreed).toBe(true);
    expect(v.secondOpinion?.reasoning.length).toBeGreaterThan(20);

    // Re-scored to something else since: the record says it no longer matches.
    insert('SUB-2025-00001', makeResult({ id: 'SUB-2025-00001', verdict: 'FIT' }), 2, policyRaw('SUB-2025-00001'));
    const moved = await detail('SUB-2025-00001');
    expect(moved.verification?.matchesCurrentResult).toBe(false);
  });
});
