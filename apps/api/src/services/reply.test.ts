/**
 * A17 — broker reply: extract, validate, apply, re-score, log. Mini snapshot,
 * in-memory SQLite, mock adapter, fake LLM (per-test extract-reply answers).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionDto } from '@retrofit/contracts';
import { createMockAdapter } from '@retrofit/federato';
import type { FederatoSnapshot } from '@retrofit/federato';
import { createDb } from '../db/client';
import type { DbHandle } from '../db/client';
import { migrate } from '../db/migrate';
import { createRepos } from '../db/repos';
import { createFakeLlm } from '../llm/fake-provider';
import type { FakeLlmOptions } from '../llm/fake-provider';
import { planActions } from './actions';
import { applyBrokerReply } from './reply';
import { rescoreBook, snapshotOf } from './rescore';
import { ingestFederato } from './ingest';
import { fixedClock } from './types';
import type { Deps } from './types';

vi.mock('@retrofit/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@retrofit/engine')>();
  const { readFileSync: read } = await import('node:fs');
  const { fileURLToPath: toPath } = await import('node:url');
  const json = (rel: string): unknown =>
    JSON.parse(read(toPath(new URL(`../../../../packages/engine/${rel}`, import.meta.url)), 'utf8'));
  const lineFile = (line: string) => (line === 'tenant' ? 'tenant' : 'commercial');
  return {
    ...actual,
    readVectorSpec: (line: string) => Promise.resolve(json(`vectors/${lineFile(line)}.json`)),
    readRulebook: (name: string) => Promise.resolve(json(`rules/${name}.json`)),
    readRatingTable: (line: string) => Promise.resolve(json(`rating/${lineFile(line)}.json`)),
    readQuestions: (line: string) =>
      Promise.resolve((json(`questions/${lineFile(line)}.json`) as { questions: unknown[] }).questions),
  };
});

const MINI_PATH = '../../../../packages/federato/fixtures/mini-snapshot';
const { MINI_SNAPSHOT } = (await import(/* @vite-ignore */ MINI_PATH)) as {
  MINI_SNAPSHOT: FederatoSnapshot;
};

let handle: DbHandle;

function depsWith(llm: FakeLlmOptions = {}, iso = '2026-09-19T12:00:00.000Z'): Deps {
  return {
    db: handle.db,
    adapter: createMockAdapter({ snapshot: MINI_SNAPSHOT }),
    llm: createFakeLlm(llm),
    clock: fixedClock(iso),
  };
}

beforeEach(async () => {
  handle = createDb({ url: ':memory:' });
  migrate(handle);
  await ingestFederato(depsWith(), {});
});
afterEach(() => handle.close());


const repos = () => createRepos(handle.db);
const sub = (id: string) => repos().submissions.byId(id)!;

const REPLY =
  'Hi, this one is a renewal. The quoted premium is $95,000. I think the buildings went up around 1978 but will confirm.';

function extractAnswer(values: readonly unknown[], notFound: readonly string[] = []): FakeLlmOptions {
  return { overrides: { 'extract-reply': { values, notFound } } };
}

const RENEWAL_ANSWER = extractAnswer([
  { canonicalPath: 'submissionType', value: 'renewal', confidence: 0.9, quote: 'this one is a renewal' },
  { canonicalPath: 'pricing.quotedPremium', value: '$95,000', confidence: 0.95, quote: 'The quoted premium is $95,000.' },
  { canonicalPath: 'buildings.*.yearBuilt', value: '1978', confidence: 0.6, quote: 'the buildings went up around 1978' },
  // Not requested: never written anywhere.
  { canonicalPath: 'insured.revenue', value: '$5M', confidence: 0.99, quote: 'this one is a renewal' },
]);

async function requestFor(submissionId: string): Promise<ActionDto> {
  const plan = await planActions(depsWith(), {});
  const req = plan.actions.find((a) => a.type === 'request' && a.submissionId === submissionId);
  if (req === undefined) throw new Error(`no request for ${submissionId}`);
  return req;
}

describe('applyBrokerReply', () => {
  it('accepts at >= 0.8, sends the rest to confirm, writes answer provenance and re-scores', async () => {
    const req = await requestFor('SUB-1004');
    const stored = sub('SUB-1004');
    const before = snapshotOf(stored.result!, stored.rank);
    expect(before.verdict).toBe('REFER');

    const res = await applyBrokerReply(depsWith(RENEWAL_ANSWER, '2026-09-19T14:00:00.000Z'), 'SUB-1004', {
      text: REPLY,
      actionId: req.id,
    });

    expect(res.id).toBe('SUB-1004');
    expect(res.before).toEqual(before);
    expect(res.extracted.map((v) => v.canonicalPath)).toEqual([
      'submissionType',
      'pricing.quotedPremium',
      'buildings.*.yearBuilt',
    ]);
    expect(res.accepted.map((v) => [v.canonicalPath, v.value])).toEqual([
      ['submissionType', 'renewal'],
      ['pricing.quotedPremium', 95_000], // G-4: "$95,000" -> 95000
    ]);
    expect(res.needsConfirmation).toHaveLength(1);
    expect(res.needsConfirmation[0]).toMatchObject({ value: 1978, confidence: 0.6, rejection: 'low_confidence' });
    expect(res.rejected).toEqual([]);

    // The stored record now carries the answers, with answer provenance.
    const after = sub('SUB-1004');
    expect(after.canonical!.pricing.quotedPremium).toEqual([
      expect.objectContaining({ value: 95_000, provenance: expect.objectContaining({ source: 'answer' }) }),
    ]);
    expect(after.canonical!.submissionType?.[0]?.value).toBe('renewal');
    expect(res.result).toEqual(after.result);

    // Renewal is Not Acceptable on submission type: the account is knocked out.
    expect(res.after.verdict).toBe('DOES_NOT_FIT');
    expect(res.result.evaluate.knockout).toBe(true);
    expect(res.after).toEqual(snapshotOf(after.result!, after.rank));
    // Submission type and premium are now known: completeness rises.
    expect(res.after.completeness).toBeGreaterThan(before.completeness);
    // V-7: the deciding field is an answer -> 0.8.
    expect(res.after.confidence).toBeCloseTo(0.8, 12);
    expect(res.rankBefore).toBe(before.rank);
    expect(res.rankAfter).toBe(after.rank);

    // Log: the reply, the re-score, and the answered request marked replied.
    expect(res.action).toMatchObject({
      type: 'reply',
      status: 'applied',
      actor: 'gemini:extract-reply',
      sourceText: REPLY,
      before,
      after: res.after,
      rankBefore: before.rank,
      rankAfter: res.rankAfter,
    });
    expect(res.action.extracted).toHaveLength(3);
    expect(res.action.note).toContain('2 accepted, 1 to confirm, 0 rejected');
    const rescores = repos().actions.list({ type: 'rescore' }).rows;
    expect(rescores).toHaveLength(1);
    expect(rescores[0]!.after).toEqual(res.after);
    expect(repos().actions.byId(req.id)!.status).toBe('replied');

    // A later book re-score keeps the answer (it lives in the canonical record).
    await rescoreBook(depsWith());
    expect(sub('SUB-1004').result!.canonical.pricing.quotedPremium?.[0]?.value).toBe(95_000);
  });

  it('raises a contradiction when the reply disagrees with what the broker submitted', async () => {
    const stored = sub('SUB-1002');
    const submitted = stored.canonical!.pricing.quotedPremium?.[0]?.value as number;
    expect(typeof submitted).toBe('number');
    const asked = submitted + 40_000;
    const now = '2026-09-19T12:30:00.000Z';
    repos().actions.insert({
      id: 'act_request_test',
      submissionId: 'SUB-1002',
      type: 'request',
      status: 'sent',
      actor: 'code',
      payload: {
        fields: [
          {
            canonicalPath: 'pricing.quotedPremium',
            componentKey: 'quotedPremium',
            label: 'quoted premium',
            why: 'it decides the total-premium factor',
            factor: 'total_premium',
            ruleId: null,
            currentValue: null,
            severity: 'MEDIUM',
          },
        ],
      },
      before: null,
      after: null,
      sourceText: null,
      createdAt: now,
    });
    const text = `Correction: the quoted premium is $${asked.toLocaleString('en-US')}.`;
    const res = await applyBrokerReply(
      depsWith(extractAnswer([{ canonicalPath: 'pricing.quotedPremium', value: `$${asked}`, confidence: 0.9, quote: text }])),
      'SUB-1002',
      { text }, // no actionId: the latest sent request is the one answered
    );
    expect(res.accepted.map((v) => v.value)).toEqual([asked]);
    expect(res.newContradictions.map((c) => c.canonicalPath)).toContain('pricing.quotedPremium');
    expect(res.action.note).toContain('disagrees with the submission on pricing.quotedPremium');
    expect(repos().actions.byId('act_request_test')!.status).toBe('replied');
  });

  it('applies nothing and does not re-score when every value is below the gate', async () => {
    const req = await requestFor('SUB-1004');
    const stored = sub('SUB-1004');
    const res = await applyBrokerReply(
      depsWith(extractAnswer([{ canonicalPath: 'pricing.quotedPremium', value: '95000', confidence: 0.79, quote: 'premium is 95000' }])),
      'SUB-1004',
      { text: 'Premium is 95000, roughly.', actionId: req.id },
    );
    expect(res.accepted).toEqual([]);
    expect(res.needsConfirmation).toHaveLength(1);
    expect(res.after).toEqual(res.before);
    expect(res.action.status).toBe('replied');
    expect(repos().actions.list({ type: 'rescore' }).rows).toHaveLength(0);
    expect(sub('SUB-1004').canonical).toEqual(stored.canonical);
    expect(sub('SUB-1004').result).toEqual(stored.result);
  });

  it('rejects a quote that is not in the reply', async () => {
    const req = await requestFor('SUB-1004');
    const res = await applyBrokerReply(
      depsWith(extractAnswer([{ canonicalPath: 'pricing.quotedPremium', value: '$95,000', confidence: 0.95, quote: 'The premium is $95,000.' }])),
      'SUB-1004',
      { text: 'We will send the premium next week.', actionId: req.id },
    );
    expect(res.accepted).toEqual([]);
    expect(res.after).toEqual(res.before);
  });

  it('sends a PDF value code cannot quote-check to the underwriter, never past the gate', async () => {
    const req = await requestFor('SUB-1004');
    const llm = createFakeLlm(
      extractAnswer([{ canonicalPath: 'rollup.fiveYearLoss', value: '$120,000', confidence: 0.95, quote: 'Total incurred 120,000' }]),
    );
    const res = await applyBrokerReply({ ...depsWith(), llm }, 'SUB-1004', {
      pdfBase64: Buffer.from('%PDF-1.4 loss runs').toString('base64'),
      filename: 'loss-runs.pdf',
      actionId: req.id,
    });
    expect(llm.callsFor('extract-reply')[0]!.partKinds).toEqual(['pdf']);
    expect(res.accepted).toEqual([]);
    expect(res.needsConfirmation).toHaveLength(1);
    expect(res.needsConfirmation[0]).toMatchObject({ canonicalPath: 'rollup.fiveYearLoss', value: 120_000 });
    expect(res.needsConfirmation[0]!.confidence).toBeLessThan(0.8);
    expect(res.action.sourceText).toBe('[PDF attached: loss-runs.pdf]');
  });

  it('with no request on file, answers what selectRequest would ask for today', async () => {
    const llm = createFakeLlm(
      extractAnswer([{ canonicalPath: 'pricing.quotedPremium', value: '$95,000', confidence: 0.95, quote: 'The quoted premium is $95,000.' }]),
    );
    const res = await applyBrokerReply({ ...depsWith(), llm }, 'SUB-1004', { text: REPLY });
    expect(res.action.fields.map((f) => f.canonicalPath)).toContain('pricing.quotedPremium');
    expect(res.accepted.map((v) => v.value)).toEqual([95_000]);
  });

  it('R4-4: a prose date the broker wrote is accepted as its ISO date', async () => {
    repos().actions.insert({
      id: 'act_request_date',
      submissionId: 'SUB-1002',
      type: 'request',
      status: 'sent',
      actor: 'code',
      payload: {
        fields: [
          {
            canonicalPath: 'receivedDate',
            componentKey: null,
            label: 'received date',
            why: 'the five-year loss window runs back from it',
            factor: 'loss_value',
            ruleId: null,
            currentValue: null,
            severity: 'LOW',
          },
        ],
      },
      before: null,
      after: null,
      sourceText: null,
      createdAt: '2026-09-19T12:30:00.000Z',
    });
    const text = 'Hi, the submission was received on December 13, 2025.';
    for (const [value, iso] of [
      ['December 13, 2025', '2025-12-13'],
      ['Dec 13, 2025', '2025-12-13'],
      ['13 December 2025', '2025-12-13'],
      ['12/13/2025', '2025-12-13'],
      ['2025-12-13', '2025-12-13'],
    ] as const) {
      const res = await applyBrokerReply(
        depsWith(extractAnswer([{ canonicalPath: 'receivedDate', value, confidence: 0.95, quote: 'received on December 13, 2025' }])),
        'SUB-1002',
        { text, actionId: 'act_request_date' },
      );
      expect(res.accepted.map((v) => [v.canonicalPath, v.value])).toEqual([['receivedDate', iso]]);
      expect(sub('SUB-1002').canonical!.receivedDate?.find((v) => v.provenance.source === 'answer')?.value).toBe(iso);
    }
    // Not a real date: still rejected, never guessed.
    const bad = await applyBrokerReply(
      depsWith(extractAnswer([{ canonicalPath: 'receivedDate', value: 'February 30, 2025', confidence: 0.95, quote: 'received on December 13, 2025' }])),
      'SUB-1002',
      { text, actionId: 'act_request_date' },
    );
    expect(bad.accepted).toEqual([]);
    expect(bad.rejected[0]).toMatchObject({ rejection: 'unparseable' });
  });

  it('R4-6: a verbatim "new business" answers submissionType as new_business (G-11)', async () => {
    const req = await requestFor('SUB-1004');
    const text = 'This is a new business submission.';
    const res = await applyBrokerReply(
      depsWith(extractAnswer([{ canonicalPath: 'submissionType', value: 'new business', confidence: 0.95, quote: text }])),
      'SUB-1004',
      { text, actionId: req.id },
    );
    expect(res.accepted.map((v) => [v.canonicalPath, v.value])).toEqual([['submissionType', 'new_business']]);
    expect(res.action.note).not.toContain('not answered: submissionType');
    expect(sub('SUB-1004').canonical!.submissionType?.[0]?.value).toBe('new_business');
  });

  it('R-I4-2: wildcard and five-year-loss answers for an account with no buildings reach the vector', async () => {
    const req = await requestFor('SUB-1004');
    expect(req.fields.map((f) => f.canonicalPath)).toContain('buildings.*.tiv');
    const text = 'TIV is $12,000,000 for the one building. Losses over five years total $30,000. It is in TX.';
    const res = await applyBrokerReply(
      depsWith(
        extractAnswer([
          { canonicalPath: 'buildings.*.tiv', value: '$12,000,000', confidence: 0.95, quote: 'TIV is $12,000,000' },
          { canonicalPath: 'rollup.fiveYearLoss', value: '$30,000', confidence: 0.95, quote: 'Losses over five years total $30,000.' },
          { canonicalPath: 'locations.*.state', value: 'TX', confidence: 0.95, quote: 'It is in TX.' },
        ]),
      ),
      'SUB-1004',
      { text, actionId: req.id },
    );
    expect(res.accepted.map((v) => v.canonicalPath).sort()).toEqual(['buildings.*.tiv', 'locations.*.state', 'rollup.fiveYearLoss']);
    expect(res.rejected).toEqual([]);
    expect(res.result.rollup.totalTiv).toBe(12_000_000);
    expect(res.result.rollup.fiveYearLoss).toBe(30_000);
    expect(res.result.rollup.primaryState).toBe('TX');
    expect(res.after.completeness).toBeGreaterThan(res.before.completeness);
  });

  it('R-I4-2: a clean value the engine cannot place is reported as not applied and nothing is re-scored', async () => {
    repos().actions.insert({
      id: 'act_request_rollup',
      submissionId: 'SUB-1002',
      type: 'request',
      status: 'sent',
      actor: 'code',
      payload: {
        fields: [
          {
            canonicalPath: 'rollup.pctTivSprinklered',
            componentKey: 'pctTivSprinklered',
            label: 'share of TIV sprinklered',
            why: 'it moves the account to FIT',
            factor: 'sprinkler_protection',
            ruleId: null,
            currentValue: null,
            severity: 'MEDIUM',
          },
        ],
      },
      before: null,
      after: null,
      sourceText: null,
      createdAt: '2026-09-19T12:30:00.000Z',
    });
    const text = 'About 80% of the TIV is sprinklered.';
    const stored = sub('SUB-1002');
    const res = await applyBrokerReply(
      depsWith(extractAnswer([{ canonicalPath: 'rollup.pctTivSprinklered', value: '80%', confidence: 0.95, quote: text }])),
      'SUB-1002',
      { text, actionId: 'act_request_rollup' },
    );
    expect(res.accepted).toEqual([]);
    expect(res.rejected.map((v) => [v.canonicalPath, v.rejection])).toEqual([['rollup.pctTivSprinklered', 'not_applied']]);
    expect(res.after).toEqual(res.before);
    expect(res.action.status).toBe('replied');
    expect(res.action.note).toContain('not applied: rollup.pctTivSprinklered');
    expect(repos().actions.list({ submissionId: 'SUB-1002', type: 'rescore' }).rows).toHaveLength(0);
    expect(sub('SUB-1002').canonical).toEqual(stored.canonical);
  });

  it('throws for an unknown submission or an action of another submission', async () => {
    await expect(applyBrokerReply(depsWith(), 'SUB-9999', { text: 'x' })).rejects.toThrow(/no submission/);
    const req = await requestFor('SUB-1004');
    await expect(applyBrokerReply(depsWith(), 'SUB-1001', { text: 'x', actionId: req.id })).rejects.toThrow(/belongs to/);
  });
});
