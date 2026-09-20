import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  glossaryResponseSchema,
  healthResponseSchema,
  rulesResponseSchema,
  shareResponseSchema,
} from '@retrofit/contracts';
import type { EngineResult, Rulebook } from '@retrofit/engine';
import type { FederatoAdapter } from '@retrofit/federato';
import { readGlossary } from '@retrofit/federato';
import { createApp } from '../app';
import { createDb } from '../db/client';
import type { DbHandle } from '../db/client';
import { migrate } from '../db/migrate';
import { createRepos } from '../db/repos';
import { createFakeLlm } from '../llm/fake-provider';
import { fixedClock } from '../services/types';
import type { Deps } from '../services/types';
import { registerStaticRoutes } from './static';

/**
 * `readRulebook` (E13) is built in parallel with this unit, so the test reads
 * the packaged JSON itself. The route is what is under test, not the loader.
 */
const readRulebookMock = vi.hoisted(() => vi.fn());
vi.mock('@retrofit/engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@retrofit/engine')>()),
  readRulebook: readRulebookMock,
}));

const rulesDir = fileURLToPath(new URL('../../../../packages/engine/rules/', import.meta.url));
const loadJson = (name: string): Rulebook =>
  JSON.parse(readFileSync(`${rulesDir}${name}.json`, 'utf8')) as Rulebook;

const NOW = '2026-09-19T12:00:00.000Z';

const adapter: FederatoAdapter = {
  kind: 'mock',
  getSchema: () => Promise.reject(new Error('unused')),
  query: () => Promise.reject(new Error('unused')),
  getGuidelines: () => Promise.reject(new Error('unused')),
  getGlossary: () => Promise.resolve(readGlossary()),
};

/** Only the fields the share route reads; the rest is irrelevant here. */
function fakeResult(): EngineResult {
  return {
    id: 'sub-1',
    lineOfBusiness: 'commercial_property',
    explanation: 'Refer: building age.',
    evaluate: { appetiteScore: 72.5 },
    verdict: {
      verdict: 'REFER',
      decidingRule: {
        ruleId: 'AG-BA-R',
        factor: 'building_age',
        tier: 'refer',
        citation: { doc: 'APPETITE_GUIDELINES.pdf', section: 'p2 "Building age"', quote: 'Newer than 1990' },
      },
    },
    price: {
      lineOfBusiness: 'commercial_property',
      currency: 'USD',
      predictedPremium: 81234,
      predictedMonthlyPremium: null,
      termMonths: 12,
      perBuilding: [],
      factors: [],
      lossHistoryFactor: null,
      expectedAnnualLoss: null,
      expectedLossDetail: null,
      quotedPremium: null,
      adequacy: null,
      ratePer100: null,
      basis: 'table',
      fitError: null,
      estimate: true,
    },
    flip: { flip: null, reason: 'no single move', blockedByImmovable: ['isNewBusiness'] },
    canonical: { secret: 'broker@example.com' },
  } as unknown as EngineResult;
}

let handle: DbHandle;
let deps: Deps;

beforeEach(() => {
  readRulebookMock.mockReset();
  readRulebookMock.mockImplementation((name: string) => Promise.resolve(loadJson(name)));
  handle = createDb({ url: ':memory:' });
  migrate(handle);
  deps = { db: handle.db, adapter, llm: createFakeLlm(), clock: fixedClock(NOW) };
});

afterEach(() => handle.close());

const makeApp = () =>
  createApp({ deps, version: '9.9.9', registrars: [registerStaticRoutes] });

function insertSubmission(externalId: string, shareSlug: string | null, result: EngineResult | null) {
  return createRepos(deps.db).submissions.upsertByExternalId({
    id: `id-${externalId}`,
    source: 'federato',
    lineOfBusiness: 'commercial_property',
    externalId,
    insuredName: 'Acme Holdings',
    raw: null,
    canonical: null,
    result,
    shareSlug,
    createdAt: '2026-09-18T10:00:00.000Z',
    updatedAt: '2026-09-18T10:00:00.000Z',
  });
}

describe('GET /health', () => {
  it('reports version, adapter, llm flag, start time and the live submission count', async () => {
    const app = makeApp();
    const first = await app.request('/health');
    expect(first.status).toBe(200);
    const body = healthResponseSchema.parse(await first.json());
    expect(body).toEqual({
      ok: true,
      version: '9.9.9',
      adapter: 'mock',
      llmConfigured: deps.llm.configured,
      submissionCount: 0,
      startedAt: NOW,
    });

    insertSubmission('SUB-1', null, null);
    insertSubmission('SUB-2', null, null);
    const second = healthResponseSchema.parse(await (await app.request('/health')).json());
    expect(second.submissionCount).toBe(2);
  });
});

describe('GET /rules', () => {
  it('serves the three rulebooks in order, extensions labelled as ours', async () => {
    const res = await makeApp().request('/rules');
    expect(res.status).toBe(200);
    const body = rulesResponseSchema.parse(await res.json());

    expect(body.rulebooks.map((b) => b.id)).toEqual(['commercial', 'extensions', 'tenant']);
    expect(body.rulebooks.map((b) => b.isExtension)).toEqual([false, true, false]);
    expect(body.rulebooks.map((b) => b.rules.length)).toEqual([
      loadJson('commercial').rules.length,
      loadJson('extensions').rules.length,
      loadJson('tenant').rules.length,
    ]);
    expect(body.rulebooks[1]?.label).toMatch(/ours/i);
    for (const book of body.rulebooks) expect(book.version).toBe('1.0.0');

    // Every rule keeps its citation (doc, section, quote).
    for (const rule of body.rulebooks.flatMap((b) => b.rules)) {
      expect(rule.citation.doc.length).toBeGreaterThan(0);
      expect(rule.citation.quote.length).toBeGreaterThan(0);
    }
  });

  it('returns the eight appetite weights (INTERPRETATIONS W-1) summing to 1', async () => {
    const body = rulesResponseSchema.parse(await (await makeApp().request('/rules')).json());
    expect(body.weights).toEqual({
      submission_type: 0.1,
      line_of_business: 0.15,
      primary_risk_state: 0.15,
      tiv: 0.15,
      total_premium: 0.15,
      building_age: 0.1,
      construction_type: 0.1,
      loss_value: 0.1,
    });
    const sum = Object.values(body.weights).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });

  it('lists every interpretation once, including I-1..I-4', async () => {
    const body = rulesResponseSchema.parse(await (await makeApp().request('/rules')).json());
    const ids = body.interpretations.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['I-1', 'I-2', 'I-3', 'I-4', 'X-OURS']));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('loads the rulebooks once and retries after a failed read', async () => {
    const app = makeApp();
    readRulebookMock.mockImplementationOnce(() => Promise.reject(new Error('disk gone')));
    const failed = await app.request('/rules');
    expect(failed.status).toBe(500);

    await app.request('/rules');
    await app.request('/rules');
    // 3 calls for the failed attempt (Promise.all starts all three) + 3 for the one cached load.
    expect(readRulebookMock).toHaveBeenCalledTimes(6);
  });
});

describe('GET /glossary', () => {
  it('serves the transcribed GLOSSARY.pdf through the adapter', async () => {
    const res = await makeApp().request('/glossary');
    expect(res.status).toBe(200);
    const body = glossaryResponseSchema.parse(await res.json());
    expect(body.doc).toBe('GLOSSARY.pdf');
    expect(body.entries.length).toBe(readGlossary().entries.length);
    const premium = body.entries.find((e) => e.term === 'Premium');
    expect(premium).toEqual({
      term: 'Premium',
      definition: 'The amount a customer pays (monthly, quarterly, annually) for insurance coverage.',
      page: 1,
      aliases: ['Total premium'],
    });
  });
});

describe('GET /s/:shareSlug', () => {
  it('returns only the public fields of a stored result', async () => {
    insertSubmission('SUB-9', 'abc123', fakeResult());
    const res = await makeApp().request('/s/abc123');
    expect(res.status).toBe(200);
    const raw = (await res.json()) as Record<string, unknown>;
    const body = shareResponseSchema.parse(raw);

    expect(body.slug).toBe('abc123');
    expect(body.verdict).toBe('REFER');
    expect(body.appetiteScore).toBe(72.5);
    expect(body.price.predictedPremium).toBe(81234);
    expect(body.flip.reason).toBe('no single move');
    expect(body.decidingRule).toEqual({
      ruleId: 'AG-BA-R',
      factor: 'building_age',
      citation: { doc: 'APPETITE_GUIDELINES.pdf', section: 'p2 "Building age"', quote: 'Newer than 1990' },
    });
    expect(body.createdAt).toBe('2026-09-18T10:00:00.000Z');

    expect(Object.keys(raw).sort()).toEqual(
      ['appetiteScore', 'createdAt', 'decidingRule', 'explanation', 'flip', 'lineOfBusiness', 'price', 'slug', 'verdict'],
    );
    const text = JSON.stringify(raw);
    expect(text).not.toContain('broker@example.com');
    expect(text).not.toContain('Acme Holdings');
  });

  it('a triage knockout (engine line = Federato raw "cyber") still returns a valid DTO', async () => {
    const knocked = { ...fakeResult(), lineOfBusiness: 'cyber' } as unknown as EngineResult;
    insertSubmission('SUB-11', 'cyber1', knocked);
    const res = await makeApp().request('/s/cyber1');
    expect(res.status).toBe(200);
    const parsed = shareResponseSchema.safeParse(await res.json());
    expect(parsed.success).toBe(true);
    expect(parsed.data?.lineOfBusiness).toBe('commercial_property');
  });

  it('404s an unknown slug and 409s a shared submission with no result', async () => {
    const app = makeApp();
    const missing = await app.request('/s/nope');
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');

    insertSubmission('SUB-10', 'unscored', null);
    const unscored = await app.request('/s/unscored');
    expect(unscored.status).toBe(409);
    expect(((await unscored.json()) as { error: { code: string } }).error.code).toBe('NOT_SCORED');
  });
});
