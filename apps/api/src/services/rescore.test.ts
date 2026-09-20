/**
 * G1 (R2b) — rescore places the 11 no-policy property accounts among the
 * policy book as a coarse match (PRD 6.4; findings R1-3 / I3-4), over the real
 * committed snapshot, in-memory SQLite, mock adapter. No network.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EngineResult } from '@retrofit/engine';
import { createMockAdapter, loadSnapshot } from '@retrofit/federato';
import { createDb } from '../db/client';
import type { DbHandle } from '../db/client';
import { migrate } from '../db/migrate';
import { createRepos } from '../db/repos';
import { createFakeLlm } from '../llm/fake-provider';
import { ingestFederato } from './ingest';
import { rescoreBook, rescoreOne } from './rescore';
import { fixedClock } from './types';
import type { Deps } from './types';

let handle: DbHandle;
let deps: Deps;

const TIV = 3;
const PREMIUM = 4;
const STATE = 2;

const propertyResults = (): EngineResult[] =>
  createRepos(deps.db)
    .submissions.all()
    .filter((r) => r.lineOfBusiness === 'commercial_property' && r.result)
    .map((r) => r.result as EngineResult)
    // Triage knockouts are stored on the property queue but carry Federato's
    // raw line on the canonical (R2-fixer-1 F1-1); they take no peers.
    .filter((r) => r.lineOfBusiness === 'commercial_property');

const noPolicy = (): EngineResult[] => propertyResults().filter((r) => r.vector.m[PREMIUM] !== 1);

beforeAll(async () => {
  handle = createDb({ url: ':memory:' });
  migrate(handle);
  deps = {
    db: handle.db,
    adapter: createMockAdapter({ snapshot: loadSnapshot() }),
    llm: createFakeLlm(),
    clock: fixedClock('2026-09-19T12:00:00.000Z'),
  };
  await ingestFederato(deps, {});
}, 60_000);

afterAll(() => handle.close());

describe('rescore — coarse peers for the accounts with no policy (PRD 6.4)', () => {
  it('the real book has 11 property accounts with no policy', () => {
    expect(noPolicy()).toHaveLength(11);
  });

  it('every one of them is placed among peers, labelled coarse, against policy accounts only', () => {
    for (const r of noPolicy()) {
      expect(r.peers, r.id).not.toBeNull();
      expect(r.peers!.coarse, r.id).toBe(true);
      expect(r.peers!.peers.length, r.id).toBeGreaterThan(0);
      for (const p of r.peers!.peers) {
        expect(p.coarse).toBe(true);
        expect(p.quotedPremium, `${r.id} -> ${p.id}`).not.toBeNull();
        expect(p.id).not.toBe(r.id);
      }
    }
  });

  it('the coarse inputs never enter the scored vector', () => {
    for (const r of noPolicy()) {
      expect(r.vector.m[TIV], r.id).toBe(0);
      expect(r.vector.m[STATE], r.id).toBe(0);
      expect(r.vector.x[TIV], r.id).toBeNull();
    }
  });

  it('policy accounts keep full, non-coarse peers', () => {
    const policy = propertyResults().filter((r) => r.vector.m[PREMIUM] === 1);
    expect(policy.length).toBeGreaterThan(0);
    for (const r of policy) {
      expect(r.peers!.coarse, r.id).toBe(false);
      expect(r.peers!.peers).toHaveLength(5);
    }
  });

  it('rescoreBook and rescoreOne agree on a no-policy account', async () => {
    await rescoreBook(deps);
    const id = noPolicy()[0]!.id;
    const before = createRepos(deps.db).submissions.byId(id)!.result!.peers;
    const one = await rescoreOne(deps, { submissionId: id });
    expect(one.result.peers).toEqual(before);
  });
});
