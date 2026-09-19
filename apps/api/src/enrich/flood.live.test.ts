/**
 * ONE live call each to FEMA NFHL and Nominatim (unit A07's network exception),
 * to confirm the response shapes flood.ts and geocode.ts parse.
 * Runs only with RUN_LIVE=1.
 */
import { describe, expect, it } from 'vitest';
import { createFloodPlugin } from './flood';
import { geocode } from './geocode';

describe('enrichment live shapes', () => {
  it('Nominatim returns coordinates for a street address', async () => {
    const r = await geocode({
      externalId: 'LIVE-G',
      address: '1600 Pennsylvania Ave NW',
      city: 'Washington',
      state: 'DC',
      zip: '20500',
      latitude: null,
      longitude: null,
    });
    expect(r).not.toBeNull();
    expect(r!.latitude).toBeCloseTo(38.8977, 1);
    expect(r!.longitude).toBeCloseTo(-77.0365, 1);
  });

  it('FEMA NFHL returns a flood zone for a Miami point', async () => {
    const out = await createFloodPlugin().run({
      submissionId: 'live',
      nowIso: '2026-09-19T00:00:00.000Z',
      locations: [
        {
          externalId: 'LIVE-F',
          address: null,
          city: 'Miami',
          state: 'FL',
          zip: null,
          latitude: 25.7657,
          longitude: -80.1936,
        },
      ],
    });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(out.raw), out.unavailableReason, out.durationMs);
    expect(out.available).toBe(true);
    expect(out.values).toHaveLength(1);
    expect(typeof out.values[0]!.value).toBe('string');
  });
});
