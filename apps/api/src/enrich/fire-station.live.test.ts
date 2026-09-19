/**
 * ONE live Overpass call (unit A08's network exception) to confirm the
 * response shape fire-station.ts parses. Runs only with RUN_LIVE=1.
 */
import { describe, expect, it } from 'vitest';
import { createFireStationPlugin } from './fire-station';

describe('fire-station live shape', () => {
  it('Overpass returns a nearest fire station for a downtown point', async () => {
    const out = await createFireStationPlugin().run({
      submissionId: 'live',
      nowIso: '2026-09-19T00:00:00.000Z',
      locations: [
        {
          externalId: 'LIVE-FS',
          address: null,
          city: 'Philadelphia',
          state: 'PA',
          zip: null,
          latitude: 39.9526,
          longitude: -75.1652,
        },
      ],
    });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(out.raw), out.unavailableReason, out.durationMs);
    expect(out.available).toBe(true);
    expect(out.values).toHaveLength(1);
    expect(out.values[0]!.value).toBeGreaterThan(0);
    expect(out.values[0]!.value).toBeLessThan(8.05);
  }, 15_000);
});
