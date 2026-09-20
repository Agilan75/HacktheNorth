/**
 * A03 live smoke for `observe` and `relate`: exactly ONE tiny Anthropic call per
 * owned call (one 32x32 image for observe, two observations for relate), only
 * with RUN_LIVE=1 and a configured key. The offline suites live in
 * `observe.test.ts` and `relate.test.ts` (moved at CP1, docs/contracts/requests/A03.md).
 */
import { describe, expect, it } from 'vitest';
import type { RelateInput } from '@retrofit/contracts';
import { OBJECT_VOCAB } from '@retrofit/engine';
import { createClaudeProvider } from '../claude';
import type { LlmProvider } from '../types';
import { loadEnv } from '../../env';
import { observeCall } from './observe';
import { relateCall } from './relate';
/* -------------------------------------------------------------------------- */
/* Live smoke — RUN_LIVE=1 only, one tiny request per call                     */
/* -------------------------------------------------------------------------- */

const env = loadEnv();
const LIVE = env.RUN_LIVE === '1' && env.ANTHROPIC_API_KEY !== undefined;

/** The real provider (A02), built once per call so each `it` is independent. */
function liveProvider(): LlmProvider {
  return createClaudeProvider({ apiKey: env.ANTHROPIC_API_KEY, workspaceId: env.ANTHROPIC_WORKSPACE_ID });
}

describe.skipIf(!LIVE)('live Anthropic smoke (RUN_LIVE=1)', () => {
  it('observe: one 32x32 frame comes back as one sanitised frame entry', async () => {
    const sharp = (await import('sharp')).default;
    const png = await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 128, g: 128, b: 128 } },
    })
      .png()
      .toBuffer();
    const provider = liveProvider();
    const out = await observeCall(
      provider,
      { roomLabel: 'Test', frames: [{ index: 7, bearingDeg: 0, quality: 1 }], vocabulary: OBJECT_VOCAB, runIndex: 0 },
      [{ kind: 'image', mimeType: 'image/png', dataBase64: png.toString('base64') }],
    );
    expect(out.frames).toHaveLength(1);
    expect(out.frames[0]?.index).toBe(7);
    for (const o of out.frames[0]?.objects ?? []) {
      expect(OBJECT_VOCAB).toContain(o.label);
      expect(o.confidence).toBeGreaterThanOrEqual(0);
      expect(o.confidence).toBeLessThanOrEqual(1);
    }
  }, 120_000);

  it('relate: two observations return only allowed keys and known ids', async () => {
    const provider = liveProvider();
    const input: RelateInput = {
      roomLabel: 'Bedroom',
      observations: [
        { id: 'o1', label: 'portable_heater', bearingDeg: 90, distanceBand: 'near', confidence: 0.9 },
        { id: 'o2', label: 'bedding', bearingDeg: 95, distanceBand: 'near', confidence: 0.9 },
      ],
      engineHazards: [],
      allowedHazardKeys: ['heaterNearCombustible'],
    };
    const out = await relateCall(provider, input);
    for (const h of out.hazards) {
      expect(h.hazardKey).toBe('heaterNearCombustible');
      for (const id of h.observationIds) expect(['o1', 'o2']).toContain(id);
    }
  }, 120_000);
});
