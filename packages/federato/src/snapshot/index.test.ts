import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MINI_SNAPSHOT } from '../../fixtures/mini-snapshot';
import type { FederatoResource, FederatoSnapshot } from '../types';
import {
  EXPECTED_COUNTS,
  SNAPSHOT_DIR,
  loadSnapshot,
  saveSnapshot,
  snapshotPath,
  verifySnapshotCounts,
} from './index';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
// Scratch space inside the owned snapshot dir (never /tmp; see AGENTS.md §0.4).
const TMP = join(REPO_ROOT, SNAPSHOT_DIR, `.test-tmp-${process.pid}`);

beforeAll(() => mkdirSync(TMP, { recursive: true }));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

/** A snapshot whose record arrays have exactly `EXPECTED_COUNTS` rows. */
function fullSizeSnapshot(): FederatoSnapshot {
  const records = {} as Record<FederatoResource, { id: number }[]>;
  const counts = {} as Record<FederatoResource, number>;
  for (const [r, n] of Object.entries(EXPECTED_COUNTS) as [FederatoResource, number][]) {
    records[r] = Array.from({ length: n }, (_, i) => ({ id: i + 1 }));
    counts[r] = n;
  }
  return { fetchedAt: '2026-09-19T00:00:00.000Z', schema: MINI_SNAPSHOT.schema, records, counts };
}

describe('EXPECTED_COUNTS', () => {
  it('pins the LIVE_DATA_FACTS record counts', () => {
    expect(EXPECTED_COUNTS).toEqual({
      Submission: 158,
      Policy: 113,
      Claim: 179,
      Building: 129,
      Location: 70,
      ExposureUnit: 938,
      Coverage: 366,
      Endorsement: 253,
      Insured: 30,
      Contact: 14,
      Underwriter: 8,
      Broker: 6,
    });
    const total = Object.values(EXPECTED_COUNTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(2264);
  });
});

describe('snapshotPath', () => {
  it('defaults to packages/federato/snapshot/snapshot.json under the repo root', () => {
    expect(snapshotPath()).toBe(resolve(REPO_ROOT, 'packages/federato/snapshot/snapshot.json'));
  });
  it('resolves relative dirs against the repo root and keeps absolute ones', () => {
    expect(snapshotPath('some/dir')).toBe(resolve(REPO_ROOT, 'some/dir/snapshot.json'));
    expect(snapshotPath(TMP)).toBe(join(TMP, 'snapshot.json'));
  });
});

describe('verifySnapshotCounts', () => {
  it('reports every one of the 12 resources for the 5-account mini fixture', () => {
    const bad = verifySnapshotCounts(MINI_SNAPSHOT);
    expect(bad).toHaveLength(12);
    expect(bad.find((m) => m.resource === 'Submission')).toEqual({
      resource: 'Submission',
      expected: 158,
      actual: MINI_SNAPSHOT.records.Submission.length,
    });
  });

  it('passes a snapshot with exactly the expected counts', () => {
    expect(verifySnapshotCounts(fullSizeSnapshot())).toEqual([]);
  });

  it('counts records, not the declared counts field', () => {
    const s = fullSizeSnapshot();
    const short: FederatoSnapshot = {
      ...s,
      records: { ...s.records, Building: s.records.Building.slice(0, 128) },
    };
    expect(verifySnapshotCounts(short)).toEqual([{ resource: 'Building', expected: 129, actual: 128 }]);
  });
});

describe('saveSnapshot / loadSnapshot', () => {
  it('round-trips the mini snapshot byte-for-byte in content', () => {
    const dir = join(TMP, 'roundtrip');
    saveSnapshot(MINI_SNAPSHOT, dir);
    const loaded = loadSnapshot(dir);
    expect(loaded.fetchedAt).toBe(MINI_SNAPSHOT.fetchedAt);
    expect(loaded.records).toEqual(MINI_SNAPSHOT.records);
    expect(loaded.counts).toEqual(MINI_SNAPSHOT.counts);
    expect(loaded.schema).toEqual(MINI_SNAPSHOT.schema);
    expect(existsSync(`${snapshotPath(dir)}.tmp`)).toBe(false);
  });

  it('writes one record per line', () => {
    const dir = join(TMP, 'lines');
    saveSnapshot(MINI_SNAPSHOT, dir);
    const text = readFileSync(snapshotPath(dir), 'utf8');
    const policyLines = text.split('\n').filter((l) => l.startsWith('      {"id":900'));
    expect(policyLines).toHaveLength(MINI_SNAPSHOT.records.Policy.length);
  });

  it('fails loudly, naming the command, when no snapshot exists', () => {
    expect(() => loadSnapshot(join(TMP, 'absent'))).toThrow(/federato:snapshot/);
  });

  it('rejects a file missing a resource', () => {
    const dir = join(TMP, 'missing');
    mkdirSync(dir, { recursive: true });
    const { Broker: _dropped, ...rest } = MINI_SNAPSHOT.records;
    writeFileSync(snapshotPath(dir), JSON.stringify({ ...MINI_SNAPSHOT, records: rest }));
    expect(() => loadSnapshot(dir)).toThrow(/records\.Broker is missing/);
  });

  it('rejects a counts field that disagrees with the records', () => {
    const dir = join(TMP, 'counts');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      snapshotPath(dir),
      JSON.stringify({ ...MINI_SNAPSHOT, counts: { ...MINI_SNAPSHOT.counts, Policy: 113 } }),
    );
    expect(() => loadSnapshot(dir)).toThrow(/counts\.Policy says 113/);
  });
});

describe.skipIf(!existsSync(snapshotPath()))('the committed real snapshot', () => {
  it('matches every LIVE_DATA_FACTS count', () => {
    const snap = loadSnapshot();
    expect(verifySnapshotCounts(snap)).toEqual([]);
    expect(snap.records.Submission).toHaveLength(158);
    expect(snap.records.Policy).toHaveLength(113);
    expect(snap.records.Building).toHaveLength(129);
    expect(snap.records.Claim).toHaveLength(179);
    expect(snap.schema.resources.map((r) => r.name).sort()).toEqual(Object.keys(EXPECTED_COUNTS).sort());
  });

  it('matches the measured line-of-business and status splits', () => {
    const snap = loadSnapshot();
    const tally = (rows: readonly Record<string, unknown>[], key: string) => {
      const out: Record<string, number> = {};
      for (const r of rows) out[String(r[key])] = (out[String(r[key])] ?? 0) + 1;
      return out;
    };
    expect(tally(snap.records.Submission, 'line_of_business')).toEqual({
      property: 38, health: 36, cgl: 21, auto: 20, cyber: 18, excess: 15, lpl: 10,
    });
    expect(tally(snap.records.Policy, 'status')).toEqual({
      active: 76, expired: 26, non_renewed: 6, cancelled: 5,
    });
    const years = snap.records.Building.map((b) => b.year_built as number);
    expect(Math.min(...years)).toBe(1948);
    expect(years.filter((y) => y < 1990)).toHaveLength(71);
  });

  it('carries the 27 hydrated property policies beside it, premium subtotal 6,690,900', () => {
    const file = join(REPO_ROOT, SNAPSHOT_DIR, 'policy-property-hydrated.json');
    const deep = JSON.parse(readFileSync(file, 'utf8')) as { results: Record<string, unknown>[] };
    expect(deep.results).toHaveLength(27);
    const premium = deep.results.reduce((a, p) => a + (p.premium as number), 0);
    expect(premium).toBe(6_690_900);
    for (const p of deep.results) {
      expect(typeof p.insured).toBe('object');
      expect(typeof p.submission).toBe('object');
    }
  });
});
