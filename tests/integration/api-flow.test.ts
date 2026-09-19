/**
 * I3 — the API flow, fully in-process (AGENTS.md §6).
 *
 * POST /ingest/federato over the committed real snapshot (mock adapter), then
 * GET /submissions, then GET /submissions/:id for every queued account, with
 * every response parsed by the zod schemas in `@retrofit/contracts`.
 *
 * Asserts: the queue is ranked (PRD 6.8 / INTERPRETATIONS P-6: knockouts below
 * every non-knockout, ordered by distance then index), ingest is idempotent by
 * externalId, and GET /health reports the active adapter.
 *
 * `it.fails` cases pin real defects found by this run (see the I3 findings).
 * Each one flips to a failure — i.e. tells you to promote it to `it` — the
 * moment the defect is fixed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  HealthDto,
  IngestResponseDto,
  QueueResponseDto,
  QueueRowDto,
  SubmissionDetailDto,
} from '@retrofit/contracts';
import {
  errorSchema,
  healthResponseSchema,
  ingestResponseSchema,
  queueResponseSchema,
  submissionDetailSchema,
} from '@retrofit/contracts';
import type { FederatoAdapter, FederatoSnapshot } from '@retrofit/federato';
import { createMockAdapter, loadSnapshot } from '@retrofit/federato';
import { createApp } from '../../apps/api/src/app';
import { createDb } from '../../apps/api/src/db/client';
import type { DbHandle } from '../../apps/api/src/db/client';
import { migrate } from '../../apps/api/src/db/migrate';
import { createFakeLlm } from '../../apps/api/src/llm/fake-provider';
import { fixedClock } from '../../apps/api/src/services/types';
import type { Deps } from '../../apps/api/src/services/types';

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

const NOW = '2026-09-19T12:00:00.000Z';

/** Measured facts (LIVE_DATA_FACTS.md / PRD §7.2). */
const TOTAL_SUBMISSIONS = 158;
const PROPERTY_SUBMISSIONS = 38;
const PROPERTY_WITH_POLICY = 27;
const PROPERTY_NO_POLICY = 11;
const TRIAGE_KNOCKOUTS = 120;

type App = ReturnType<typeof createApp>;

interface Harness {
  readonly app: App;
  readonly deps: Deps;
  readonly handle: DbHandle;
}

let snapshot: FederatoSnapshot;
const opened: DbHandle[] = [];

function harness(adapter?: FederatoAdapter): Harness {
  const handle = createDb({ url: ':memory:' });
  migrate(handle);
  opened.push(handle);
  const deps: Deps = {
    db: handle.db,
    adapter: adapter ?? createMockAdapter({ snapshot }),
    llm: createFakeLlm(),
    clock: fixedClock(NOW),
  };
  return { app: createApp({ deps }), deps, handle };
}

async function ingest(app: App, body?: unknown): Promise<IngestResponseDto> {
  const res = await app.request('/ingest/federato', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  expect(res.status).toBe(200);
  return ingestResponseSchema.parse(await res.json());
}

async function queue(app: App, query = 'limit=500'): Promise<QueueResponseDto> {
  const res = await app.request(`/submissions?${query}`);
  expect(res.status).toBe(200);
  return queueResponseSchema.parse(await res.json());
}

async function detail(app: App, id: string): Promise<SubmissionDetailDto> {
  const res = await app.request(`/submissions/${encodeURIComponent(id)}`);
  expect(res.status).toBe(200);
  return submissionDetailSchema.parse(await res.json());
}

async function health(app: App): Promise<HealthDto> {
  const res = await app.request('/health');
  expect(res.status).toBe(200);
  return healthResponseSchema.parse(await res.json());
}

beforeAll(() => {
  snapshot = loadSnapshot();
});

afterAll(() => {
  for (const handle of opened) handle.close();
});

/* -------------------------------------------------------------------------- */
/* The flow                                                                   */
/* -------------------------------------------------------------------------- */

describe('I3 API flow: ingest -> queue -> detail (mock adapter, real snapshot)', () => {
  let h: Harness;
  let first: IngestResponseDto;
  let q: QueueResponseDto;
  const details = new Map<string, SubmissionDetailDto>();

  beforeAll(async () => {
    h = harness();
    first = await ingest(h.app);
    q = await queue(h.app);
    for (const row of q.rows) details.set(row.id, await detail(h.app, row.id));
  }, 60_000);

  it('GET /health before any ingest: mock adapter, empty book', async () => {
    const fresh = harness();
    const body = await health(fresh.app);
    expect(body.adapter).toBe('mock');
    expect(body.submissionCount).toBe(0);
    expect(body.startedAt).toBe(NOW);
  });

  it('POST /ingest/federato reports the book the snapshot actually holds', () => {
    expect(first.adapter).toBe('mock');
    expect(first.knockedOutAtTriage).toBe(TRIAGE_KNOCKOUTS);
    expect(first.noPolicy).toBe(PROPERTY_NO_POLICY);
    // Every submission is stored (I3-1 fix): the 38 scored property accounts
    // plus the 120 triage knockouts, which keep their knockout reason and trace.
    expect(first.ingested).toBe(TOTAL_SUBMISSIONS);
    expect(first.updated).toBe(0);
    expect(first.skipped).toBe(0);
    expect(new Set(first.externalIds).size).toBe(first.externalIds.length);
    expect(first.externalIds).toHaveLength(TOTAL_SUBMISSIONS);
    expect(first.queryCount).toBeGreaterThan(0);
  });

  it('GET /health after ingest names the same adapter and counts the stored book', async () => {
    const body = await health(h.app);
    expect(body.adapter).toBe(h.deps.adapter.kind);
    expect(body.adapter).toBe(first.adapter);
    expect(body.adapter).toBe(q.adapter);
    expect(body.submissionCount).toBe(q.page.total);
  });

  it('GET /submissions: every scored account, one page, ranks 1..n in response order', () => {
    expect(q.page.total).toBe(first.externalIds.length);
    expect(q.rows).toHaveLength(q.page.total);
    expect(q.rows.map((r) => r.rank)).toEqual(q.rows.map((_, i) => i + 1));
    expect(new Set(q.rows.map((r) => r.externalId))).toEqual(new Set(first.externalIds));
  });

  it('queue rows agree with their detail (rank, verdict, index, line)', () => {
    expect(details.size).toBe(q.rows.length);
    for (const row of q.rows) {
      const d = details.get(row.id);
      expect(d, row.id).toBeDefined();
      if (d === undefined) continue;
      expect(d.externalId).toBe(row.externalId);
      expect(d.rank).toBe(row.rank);
      expect(d.result.verdict.verdict).toBe(row.verdict);
      expect(d.result.qualityIndex).toBe(row.qualityIndex);
      expect(d.result.verdict.distanceToAppetite).toBe(row.distanceToAppetite);
      expect(d.lineOfBusiness).toBe('commercial_property');
      expect(d.queryTrace.length, `${row.externalId} has no query trace`).toBeGreaterThan(0);
    }
  });

  it('PRD 6.8 / P-6: knockouts rank below every non-knockout, ordered by distance then index', () => {
    const knockout = (row: QueueRowDto): boolean => details.get(row.id)?.result.evaluate.knockout === true;
    // V-1: a knockout is exactly a DOES_NOT_FIT.
    for (const row of q.rows) expect(knockout(row), row.externalId).toBe(row.verdict === 'DOES_NOT_FIT');

    const nonKo = q.rows.filter((r) => !knockout(r));
    const ko = q.rows.filter(knockout);
    expect(nonKo.length).toBeGreaterThan(0);
    expect(ko.length).toBeGreaterThan(0);
    const worstNonKo = Math.max(...nonKo.map((r) => r.rank));
    const bestKo = Math.min(...ko.map((r) => r.rank));
    expect(worstNonKo).toBeLessThan(bestKo);

    // Non-knockouts: quality index descending.
    for (let i = 1; i < nonKo.length; i += 1) {
      expect(nonKo[i - 1]!.qualityIndex).toBeGreaterThanOrEqual(nonKo[i]!.qualityIndex);
    }
    // Knockouts: distance ascending (null last), then index descending.
    const d = (r: QueueRowDto): number => r.distanceToAppetite ?? Number.POSITIVE_INFINITY;
    for (let i = 1; i < ko.length; i += 1) {
      const a = ko[i - 1]!;
      const b = ko[i]!;
      expect(d(a)).toBeLessThanOrEqual(d(b));
      if (d(a) === d(b)) expect(a.qualityIndex).toBeGreaterThanOrEqual(b.qualityIndex);
    }

    // A knockout with the highest index still sits below the weakest non-knockout.
    const maxKoIndex = Math.max(...ko.map((r) => r.qualityIndex));
    const minNonKoIndex = Math.min(...nonKo.map((r) => r.qualityIndex));
    expect(maxKoIndex).toBeGreaterThan(minNonKoIndex); // the rule actually bites on this book
  });

  it('GET /submissions/:id for a FIT-ish account (best non-knockout, in appetite on every factor)', () => {
    const top = q.rows[0]!;
    expect(top.externalId).toBe('SUB-2026-00081');
    const d = details.get(top.id)!;
    expect(d.result.evaluate.knockout).toBe(false);
    expect(d.result.evaluate.appetiteScore).toBeGreaterThanOrEqual(80);
    expect(d.buildings.length).toBeGreaterThan(0);
    expect(d.price.quotedPremium).toBe(58_800);
    expect(d.price.predictedPremium).not.toBeNull();
    expect(d.explanation).not.toBeNull();
    expect(d.insuredName).toBe('Coastal Freight Systems LLC');
    expect(d.vectorSpec).toBeDefined();
  });

  it('GET /submissions/:id for a REFER account (no policy -> missing data, PRD §7.2)', () => {
    const row = q.rows.find((r) => r.externalId === 'SUB-2025-00115')!;
    expect(row).toBeDefined();
    const d = details.get(row.id)!;
    expect(d.result.verdict.verdict).toBe('REFER');
    expect(d.result.evaluate.knockout).toBe(false);
    expect(d.result.evaluate.completeness).toBeLessThan(100); // 0-100 scale
    expect(d.price.quotedPremium).toBeNull();
    expect(d.buildings).toEqual([]);
    expect(d.explanation?.recommendation).toBe('investigate');
  });

  it('GET /submissions/:id for a DOES_NOT_FIT account names its deciding knockout rule', () => {
    const row = q.rows.find((r) => r.externalId === 'SUB-2025-00070')!;
    expect(row).toBeDefined();
    const d = details.get(row.id)!;
    expect(d.result.verdict.verdict).toBe('DOES_NOT_FIT');
    expect(d.result.evaluate.knockoutFactors).toEqual(['total_premium']);
    expect(d.result.verdict.decidingRule?.ruleId).toBe('AG-PREM-NA-HIGH');
    expect(d.result.verdict.decidingRule?.citation.quote.length ?? 0).toBeGreaterThan(0);
    expect(d.price.quotedPremium).toBe(321_300);
    expect(d.explanation?.recommendation).toBe('decline');
  });

  it('the detail route also answers to the external submission number', async () => {
    const row = q.rows[0]!;
    const byExternal = await detail(h.app, row.externalId);
    expect(byExternal.id).toBe(row.id);
  });

  it('unknown id is a 404 that parses as ErrorDto', async () => {
    const res = await h.app.request('/submissions/SUB-DOES-NOT-EXIST');
    expect(res.status).toBe(404);
    expect(errorSchema.parse(await res.json()).error.code).toBe('NOT_FOUND');
  });

  /* ---------------------------- pinned defects ---------------------------- */

  it('FIXED I3-1 (PRD §11, §15): the 120 non-property submissions are stored and present in the queue', async () => {
    const body = await health(h.app);
    expect(body.submissionCount).toBe(TOTAL_SUBMISSIONS);
    expect(q.rows.filter((r) => r.outOfAppetiteLine)).toHaveLength(TRIAGE_KNOCKOUTS);
  });

  it('FIXED I3-2: a no-policy account shows its insured, not its HQ location name', () => {
    const row = q.rows.find((r) => r.externalId === 'SUB-2025-00115')!;
    // Submission 115 -> Insured 5 "Halcyon Metalworks Corp"; hq Location 12 is "Regional Branch 1".
    expect(row.insuredName).toBe('Halcyon Metalworks Corp');
  });

  it('FIXED I3-3: the real book has at least one FIT (no spurious received-date HIGH contradiction)', () => {
    expect(q.rows.some((r) => r.verdict === 'FIT')).toBe(true);
    const d = details.get(q.rows[0]!.id)!;
    expect(d.contradictions.filter((c) => c.canonicalPath === 'receivedDate' && c.severity === 'HIGH')).toEqual([]);
  });

  it('FIXED I3-4 (PRD §6.4 coarse match): a no-policy account gets coarse peers', () => {
    const row = q.rows.find((r) => r.externalId === 'SUB-2025-00115')!;
    const d = details.get(row.id)!;
    expect(d.peers?.coarse).toBe(true);
    expect(d.peers?.peers.length ?? 0).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Idempotency                                                                */
/* -------------------------------------------------------------------------- */

describe('I3 ingest is idempotent by externalId', () => {
  it('ingesting twice stores the same accounts once, and leaves ranks untouched', async () => {
    const h = harness();
    const a = await ingest(h.app);
    const qa = await queue(h.app);
    const ha = await health(h.app);

    const b = await ingest(h.app, {});
    const qb = await queue(h.app);
    const hb = await health(h.app);

    expect(b.ingested).toBe(0);
    expect(b.updated).toBe(0);
    expect(b.skipped).toBe(a.ingested);
    expect([...b.externalIds].sort()).toEqual([...a.externalIds].sort());
    expect(hb.submissionCount).toBe(ha.submissionCount);
    expect(qb.page.total).toBe(qa.page.total);
    expect(qb.rows.map((r) => [r.externalId, r.rank, r.verdict])).toEqual(
      qa.rows.map((r) => [r.externalId, r.rank, r.verdict]),
    );
  }, 60_000);

  it('force re-ingests in place: every account updated, none added, same ids', async () => {
    const h = harness();
    const a = await ingest(h.app);
    const qa = await queue(h.app);
    const b = await ingest(h.app, { force: true });
    const qb = await queue(h.app);
    expect(b.ingested).toBe(0);
    expect(b.updated).toBe(a.ingested);
    expect(qb.page.total).toBe(qa.page.total);
    expect(qb.rows.map((r) => r.id).sort()).toEqual(qa.rows.map((r) => r.id).sort());
  }, 60_000);

  it('a targeted re-ingest of one known id is a skip, not a duplicate', async () => {
    const h = harness();
    await ingest(h.app);
    const before = await health(h.app);
    const again = await ingest(h.app, { externalIds: ['SUB-2026-00081'] });
    expect(again.ingested).toBe(0);
    expect(again.skipped).toBe(1);
    expect(again.externalIds).toEqual(['SUB-2026-00081']);
    expect((await health(h.app)).submissionCount).toBe(before.submissionCount);
  }, 60_000);
});

/* -------------------------------------------------------------------------- */
/* Health reports the adapter it was given, not a constant                    */
/* -------------------------------------------------------------------------- */

describe('I3 GET /health reports the active adapter', () => {
  it('a live-kind adapter is reported as live', async () => {
    const mock = createMockAdapter({ snapshot: loadSnapshot() });
    const live: FederatoAdapter = { ...mock, kind: 'live' };
    const h = harness(live);
    const body = await health(h.app);
    expect(body.adapter).toBe('live');
    const q = await queue(h.app);
    expect(q.adapter).toBe('live');
  });

  it('with the snapshot data, counts line up with LIVE_DATA_FACTS', () => {
    expect(snapshot.records.Submission).toHaveLength(TOTAL_SUBMISSIONS);
    const property = snapshot.records.Submission.filter(
      (s) => (s as Record<string, unknown>)['line_of_business'] === 'property',
    );
    expect(property).toHaveLength(PROPERTY_SUBMISSIONS);
    expect(PROPERTY_WITH_POLICY + PROPERTY_NO_POLICY).toBe(PROPERTY_SUBMISSIONS);
  });
});
