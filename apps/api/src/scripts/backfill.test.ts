import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SYNTHETIC_DETAIL, parseBackfill, readBackfillDir, toExternalValues } from './backfill';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '../../data/backfill');

describe('backfill files', () => {
  it('every shipped file parses and stays inside the path whitelist', () => {
    const files = readBackfillDir(DIR);
    expect(files.length).toBe(11);
    for (const f of files) expect(f.values.length).toBeGreaterThan(0);
  });

  it('rejects a path outside the whitelist and a mistyped value, naming both', () => {
    expect(() =>
      parseBackfill({
        externalId: 'SUB-2025-00001',
        values: [
          { canonicalPath: 'rollup.appetiteScore', value: 99 },
          { canonicalPath: 'buildings.*.yearBuilt', value: '2012' },
        ],
      }),
    ).toThrow(/rollup\.appetiteScore: not a backfill path.*buildings\.\*\.yearBuilt/);
  });

  it('tags every value synthetic with answer provenance', () => {
    const file = parseBackfill({
      externalId: 'SUB-2025-00001',
      values: [{ canonicalPath: 'pricing.quotedPremium', value: 80000 }],
    });
    expect(toExternalValues(file, '2026-09-19')).toEqual([
      {
        canonicalPath: 'pricing.quotedPremium',
        value: 80000,
        provenance: { source: 'answer', sourceDetail: SYNTHETIC_DETAIL, observedAt: '2026-09-19' },
      },
    ]);
  });
});
