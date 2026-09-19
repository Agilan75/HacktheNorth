/**
 * A17 — actions plan (routing + request drafts) and approve, over the mini
 * snapshot: in-memory SQLite, mock adapter, fake LLM. No network.
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
import { LlmUnavailableError } from '../llm/types';
import type { LlmProvider } from '../llm/types';
import { approveAction, planActions } from './actions';
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

const actionRows = () => createRepos(handle.db).actions.list({}).rows;
const byType = (res: { actions: readonly ActionDto[] }, type: string) => res.actions.filter((a) => a.type === type);

describe('planActions', () => {
  it('routes every non-knocked-out account by region and inclusive authority, and drafts the one REFER request', async () => {
    const res = await planActions(depsWith(), {});
    // SUB-1001 and SUB-1002 routed; SUB-1004 (no state) to senior authority;
    // SUB-1005 is knocked out, so it is never routed.
    expect(res.routed).toBe(2);
    expect(res.needsSeniorReferral).toBe(1);
    expect(res.drafted).toBe(1);
    // SUB-1001 (FIT), SUB-1002 (REFER, nothing missing) and SUB-1005 get no request.
    expect(res.skipped).toBe(3);

    const routes = byType(res, 'route');
    expect(routes.map((a) => a.submissionId)).toEqual(['SUB-1001', 'SUB-1002', 'SUB-1004']);
    const r1 = routes[0]!.routing!;
    expect(r1.primaryState).toBe('CA');
    expect(r1.requestedLimit).toBe(65_000_000);
    expect(r1.assigned?.id).toBe(801); // West, $100M covers $65M
    // $50M authority covers a $50M request (inclusive).
    const r2 = routes[1]!.routing!;
    expect(r2.assigned?.name).toBe('Tom Okafor');
    expect(r2.assigned?.authorityLimit).toBe(50_000_000);
    expect(r2.requestedLimit).toBe(50_000_000);
    const r4 = routes[2]!;
    expect(r4.routing!.assigned).toBeNull();
    expect(r4.routing!.needsSeniorReferral).toBe(true);
    expect(r4.note).toContain('senior authority');
    for (const a of routes) {
      expect(a.status).toBe('applied');
      expect(a.actor).toBe('code');
      expect(a.before).toEqual(a.after);
    }

    const [req] = byType(res, 'request');
    expect(req!.submissionId).toBe('SUB-1004');
    expect(req!.externalId).toBe('SUB-1004');
    expect(req!.status).toBe('draft');
    expect(req!.triggers).toEqual(['missing_data']);
    expect(req!.fields.map((f) => f.canonicalPath)).toEqual([
      'submissionType',
      'locations.*.state',
      'buildings.*.tiv',
      'pricing.quotedPremium',
      'buildings.*.yearBuilt',
      'buildings.*.constructionType',
      'rollup.fiveYearLoss',
    ]);
    expect(req!.recipient).toEqual({
      name: 'Dana Reyes',
      email: 'dana.reyes@harborpoint.example',
      brokerName: 'Harbor Point Brokerage',
    });
    // The canned Gemini draft names only Building C: it fails A06's field
    // check, so the deterministic template is stored and code is the actor.
    expect(req!.actor).toBe('code');
    for (const f of req!.fields) expect(req!.draft).toContain(f.label);
    expect(req!.draft).not.toMatch(/\$\d/);
    expect(req!.before?.verdict).toBe('REFER');
    expect(req!.after).toBeNull();
    expect(actionRows()).toHaveLength(4);
  });

  it('is idempotent: a second plan updates the same rows instead of adding new ones', async () => {
    const first = await planActions(depsWith(), {});
    const second = await planActions(depsWith({}, '2026-09-20T08:00:00.000Z'), {});
    expect(second.actions.map((a) => a.id)).toEqual(first.actions.map((a) => a.id));
    expect(actionRows()).toHaveLength(4);
  });

  it('with draftsOff stores the field list and no draft', async () => {
    const llm = createFakeLlm();
    const deps = { ...depsWith(), llm };
    const res = await planActions(deps, { draftsOff: true });
    const [req] = byType(res, 'request');
    expect(req!.draft).toBeNull();
    expect(req!.actor).toBe('code');
    expect(req!.fields).toHaveLength(7);
    expect(llm.callsFor('draft-request')).toHaveLength(0);
  });

  it('narrows to externalIds', async () => {
    const res = await planActions(depsWith(), { externalIds: ['SUB-1001'] });
    expect(res).toMatchObject({ routed: 1, needsSeniorReferral: 0, drafted: 0, skipped: 1 });
    expect(res.actions.map((a) => [a.submissionId, a.type])).toEqual([['SUB-1001', 'route']]);
  });

  it('falls back to the template when no LLM provider is configured', async () => {
    const unavailable: LlmProvider = {
      name: 'none',
      configured: false,
      generateJson: () => Promise.reject(new LlmUnavailableError('draft-request')),
    };
    const res = await planActions({ ...depsWith(), llm: unavailable }, {});
    const [req] = byType(res, 'request');
    expect(req!.actor).toBe('code');
    expect(req!.draft).toContain('year built for each building');
    expect(req!.note).toContain('template used');
  });

  it('flags senior referral for everyone when the underwriter directory cannot be read', async () => {
    const base = depsWith();
    const adapter = { ...base.adapter, query: () => Promise.reject(new Error('[NETWORK] offline')) };
    const res = await planActions({ ...base, adapter }, {});
    expect(res.routed).toBe(0);
    expect(res.needsSeniorReferral).toBe(3);
    expect(byType(res, 'route')[0]!.note).toContain('directory unavailable');
    // No contact, no names: the request is still drafted.
    const [req] = byType(res, 'request');
    expect(req!.recipient).toBeNull();
    expect(req!.draft).toContain('Hello,');
  });
});

describe('approveAction', () => {
  it('marks a draft sent, never emails, and is not re-drafted on the next plan', async () => {
    const res = await planActions(depsWith(), {});
    const [req] = byType(res, 'request');
    const approved = await approveAction(depsWith({}, '2026-09-19T13:00:00.000Z'), req!.id);
    expect(approved.status).toBe('sent');
    expect(approved.note).toContain('Nothing is emailed');
    expect(approved.note).toContain('2026-09-19T13:00:00.000Z');
    expect(approved.draft).toBe(req!.draft);

    await expect(approveAction(depsWith(), req!.id)).rejects.toThrow(/only a draft/);
    await expect(approveAction(depsWith(), 'act_missing')).rejects.toThrow(/no action/);

    const again = await planActions(depsWith(), {});
    expect(again.drafted).toBe(0);
    expect(byType(again, 'request')[0]!.id).toBe(req!.id);
    expect(actionRows()).toHaveLength(4);
  });
});
