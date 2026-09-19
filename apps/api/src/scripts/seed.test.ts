/**
 * A20 — `npm run seed` over the mini snapshot: in-memory SQLite, mock adapter,
 * fake LLM, fake enrichment plugins. No network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnrichmentCardDto } from '@retrofit/contracts';
import { createMockAdapter } from '@retrofit/federato';
import type { FederatoSnapshot } from '@retrofit/federato';
import { createDb } from '../db/client';
import type { DbHandle } from '../db/client';
import { migrate } from '../db/migrate';
import { createRepos } from '../db/repos';
import type { EnrichContext, EnrichOutcome, EnrichPlugin } from '../enrich/types';
import { createFakeLlm } from '../llm/fake-provider';
import type { FakeLlmOptions } from '../llm/fake-provider';
import { fixedClock } from '../services/types';
import type { Deps } from '../services/types';
import { seededObservations } from './seed-data';
import { SEEDED_SWEEP_ID, runSeed } from './seed';

/** Same loader shim as services/ingest.test.ts: read the committed engine data files. */
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

const FLOOD_DETAIL = 'fake-flood: FEMA NFHL (test)';

/** Writes zone AE on every location. */
function fakeFlood(calls: string[]): EnrichPlugin {
  return {
    source: 'openfema_flood',
    title: 'Flood zone',
    attribution: 'test',
    writes: ['locations[].floodZone'],
    run: async (ctx: EnrichContext): Promise<EnrichOutcome> => {
      calls.push(ctx.submissionId);
      const card: EnrichmentCardDto = {
        source: 'openfema_flood',
        title: 'Flood zone',
        available: true,
        unavailableReason: null,
        fetchedAt: ctx.nowIso,
        fields: [],
        attribution: 'test',
      };
      return {
        source: 'openfema_flood',
        available: true,
        unavailableReason: null,
        values: ctx.locations.map((l) => ({
          canonicalPath: `locations.${l.externalId}.floodZone`,
          value: 'AE',
          provenance: { source: 'enrichment', sourceDetail: FLOOD_DETAIL, observedAt: ctx.nowIso },
        })),
        card,
        raw: { ok: true },
        durationMs: 1,
      };
    },
  };
}

/** Always fails, so the runner turns it into an "unavailable" card. */
function brokenFireStation(calls: string[]): EnrichPlugin {
  return {
    source: 'overpass_fire_station',
    title: 'Fire station',
    attribution: 'test',
    writes: ['locations[].fireStationDistanceKm'],
    run: async (ctx: EnrichContext): Promise<EnrichOutcome> => {
      calls.push(ctx.submissionId);
      throw new Error('overpass 504');
    },
  };
}

let handle: DbHandle;

function depsWith(llm: FakeLlmOptions = {}): Deps {
  return {
    db: handle.db,
    adapter: createMockAdapter({ snapshot: MINI_SNAPSHOT }),
    llm: createFakeLlm(llm),
    clock: fixedClock('2026-09-19T12:00:00.000Z'),
  };
}

const quiet = (): void => undefined;

beforeEach(() => {
  handle = createDb({ url: ':memory:' });
  migrate(handle);
});
afterEach(() => handle.close());

describe('runSeed', () => {
  it('ingests, enriches, re-scores and seeds the sweep', async () => {
    const deps = depsWith();
    const floodCalls: string[] = [];
    const fireCalls: string[] = [];
    const summary = await runSeed(deps, {
      plugins: [fakeFlood(floodCalls), brokenFireStation(fireCalls)],
      log: quiet,
    });
    const repos = createRepos(deps.db);
    const rows = repos.submissions.all();

    // Ingest: every stored row came from this run, every normalized row is scored.
    expect(summary.ingest.ingested).toBeGreaterThan(0);
    expect(summary.ingest.ingested).toBe(summary.ingest.externalIds.length);
    expect(summary.submissions).toBe(rows.length);
    const normalized = rows.filter((r) => r.canonical != null);
    expect(normalized.length).toBe(summary.ingest.ingested);
    expect(summary.scored).toBe(normalized.length);
    expect(summary.rescored).toBe(normalized.length);
    expect(summary.withQueryTrace).toBe(normalized.length);
    for (const r of normalized) expect(r.rank).toBeGreaterThanOrEqual(1);

    // Enrichment: one row per (submission, source); the broken source is an unavailable card.
    const candidates = normalized.filter((r) => (r.canonical?.locations.length ?? 0) > 0);
    expect(candidates.length).toBeGreaterThan(0);
    expect(summary.enrichment.attempted).toBe(candidates.length);
    expect(summary.enrichment.skipped).toBe(0);
    expect(summary.enrichment.availableBySource).toEqual({ openfema_flood: candidates.length });
    expect(summary.enrichment.unavailableBySource).toEqual({ overpass_fire_station: candidates.length });
    const locationCount = candidates.reduce((n, r) => n + (r.canonical?.locations.length ?? 0), 0);
    expect(summary.enrichment.valuesWritten).toBe(locationCount);
    expect(new Set(floodCalls)).toEqual(new Set(candidates.map((r) => r.id)));

    for (const r of candidates) {
      const stored = repos.enrichments.bySubmissionId(r.id);
      expect(stored.map((e) => [e.id, e.available]).sort()).toEqual([
        [`${r.id}:openfema_flood`, true],
        [`${r.id}:overpass_fire_station`, false],
      ]);
      const unavailable = stored.find((e) => e.source === 'overpass_fire_station');
      expect((unavailable?.payload as { card: EnrichmentCardDto }).card.unavailableReason).toBe('overpass 504');

      // The re-score merged the flood value into the engine's canonical record.
      const scored = repos.submissions.byId(r.id)?.result;
      for (const loc of scored?.canonical.locations ?? []) {
        const zone = (loc.floodZone ?? []).find((f) => f.provenance.source === 'enrichment');
        expect(zone?.value).toBe('AE');
        expect(zone?.provenance.sourceDetail).toBe(FLOOD_DETAIL);
      }
    }

    // Seeded sweep: A10's 11 observations, 15 frames, full coverage, scored.
    expect(summary.sweep?.id).toBe(SEEDED_SWEEP_ID);
    const sweep = repos.sweeps.byId(SEEDED_SWEEP_ID);
    expect(sweep).not.toBeNull();
    expect(sweep?.frames).toHaveLength(15);
    expect(sweep?.frames.map((f) => f.bearingDeg)).toEqual(Array.from({ length: 15 }, (_, i) => i * 24));
    expect(sweep?.coverage?.coveragePct).toBe(100);
    const seededIds = seededObservations().map((o) => o.id);
    expect(sweep?.observations.filter((o) => seededIds.includes(o.id))).toHaveLength(11);
    expect(sweep?.error).toBeNull();
    expect(sweep?.result).not.toBeNull();
    // Smoke detector (0.52) and candle (0.58) await confirmation: the sweep stops at questions.
    expect(sweep?.stage).toBe('questions');
    expect(summary.sweep?.stage).toBe('questions');
  });

  it('is idempotent: a second run ingests nothing and re-fetches only failed sources', async () => {
    const deps = depsWith();
    const floodCalls: string[] = [];
    const fireCalls: string[] = [];
    const plugins = [fakeFlood(floodCalls), brokenFireStation(fireCalls)];
    const first = await runSeed(deps, { plugins, log: quiet });
    const sweepBefore = createRepos(deps.db).sweeps.byId(SEEDED_SWEEP_ID);

    const second = await runSeed(deps, { plugins, log: quiet });
    expect(second.ingest.ingested).toBe(0);
    expect(second.ingest.skipped).toBe(first.ingest.ingested);
    expect(second.submissions).toBe(first.submissions);
    // Fire station was unavailable, so every account is retried.
    expect(second.enrichment.attempted).toBe(first.enrichment.attempted);
    expect(createRepos(deps.db).sweeps.byId(SEEDED_SWEEP_ID)).toEqual(sweepBefore);

    // With both sources available, a third run fetches nothing.
    const ok: EnrichPlugin[] = [fakeFlood([]), { ...fakeFlood([]), source: 'overpass_fire_station', writes: ['locations[].fireStationDistanceKm'] }];
    await runSeed(deps, { plugins: ok, log: quiet, skipSweep: true });
    const calls: string[] = [];
    const third = await runSeed(deps, {
      plugins: [fakeFlood(calls), { ...fakeFlood(calls), source: 'overpass_fire_station', writes: ['locations[].fireStationDistanceKm'] }],
      log: quiet,
      skipSweep: true,
    });
    expect(third.enrichment.attempted).toBe(0);
    expect(third.enrichment.skipped).toBe(first.enrichment.attempted);
    expect(calls).toEqual([]);
  });

  it('--force re-ingests every account and re-fetches every source', async () => {
    const deps = depsWith();
    const first = await runSeed(deps, { plugins: [fakeFlood([])], log: quiet, skipSweep: true });
    const calls: string[] = [];
    const forced = await runSeed(deps, { plugins: [fakeFlood(calls)], log: quiet, skipSweep: true, force: true });
    expect(forced.ingest.ingested).toBe(0);
    expect(forced.ingest.updated).toBe(first.ingest.ingested);
    expect(forced.enrichment.attempted).toBe(first.enrichment.attempted);
    expect(calls).toHaveLength(first.enrichment.attempted);
  });

  it('scores the seeded sweep on engine pair rules when relate is unavailable', async () => {
    const deps = depsWith({ failFor: ['relate'] });
    const summary = await runSeed(deps, { skipEnrichment: true, log: quiet });
    const sweep = createRepos(deps.db).sweeps.byId(SEEDED_SWEEP_ID);
    expect(summary.sweep?.stage).toBe('questions');
    expect(sweep?.error).toBeNull();
    expect(sweep?.observations.some((o) => o.id.startsWith('relate:'))).toBe(false);
    // Heater at 48 deg and curtain at 60 deg, both near: the engine pair rule still fires.
    const pair = sweep?.result?.canonical.hazards.present.heaterNearCombustible ?? [];
    expect(pair.some((f) => f.value === true)).toBe(true);
    expect(summary.enrichment.attempted).toBe(0);
  });
});
