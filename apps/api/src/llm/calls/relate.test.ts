/**
 * A03 offline tests for `relate`, against the deterministic fake provider. No
 * network. Moved verbatim out of `observe.live.test.ts` at CP1
 * (docs/contracts/requests/A03.md) so they run in the default suite.
 */
import { describe, expect, it } from 'vitest';
import type { RelateInput } from '@retrofit/contracts';
import { createFakeLlm } from '../fake-provider';
import { LlmError } from '../types';
import { relateCall } from './relate';
/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */
const relateInput = (): RelateInput => ({
  roomLabel: 'Bedroom',
  observations: [
    { id: 'obs-1', label: 'portable_heater', bearingDeg: 30, distanceBand: 'near', confidence: 0.86 },
    { id: 'obs-2', label: 'curtain', bearingDeg: 38, distanceBand: 'near', confidence: 0.81 },
    { id: 'obs-3', label: 'power_bar', bearingDeg: 200, distanceBand: 'mid', confidence: 0.7 },
  ],
  engineHazards: [{ hazardKey: 'heaterNearCombustible', confidence: 0.8 }],
  allowedHazardKeys: ['heaterNearCombustible', 'powerBarOverload', 'blockedExit'],
});
/* -------------------------------------------------------------------------- */
/* relate — offline                                                           */
/* -------------------------------------------------------------------------- */

describe('relateCall (fake provider)', () => {
  it('returns the canned relational hazard, with no image parts', async () => {
    const llm = createFakeLlm();
    const out = await relateCall(llm, relateInput());
    expect(out).toEqual({
      hazards: [
        {
          hazardKey: 'heaterNearCombustible',
          present: true,
          confidence: 0.78,
          reason: 'the heater and the curtain share a bearing and a distance band',
          observationIds: ['obs-1', 'obs-2'],
        },
      ],
    });
    const calls = llm.callsFor('relate');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.partKinds).toEqual([]);
    expect(calls[0]?.prompt).toContain('id=obs-1 label=portable_heater bearing=30° distance=near confidence=0.86');
    expect(calls[0]?.prompt).toContain('- heaterNearCombustible confidence=0.80');
    expect(calls[0]?.prompt).toContain('heaterNearCombustible, powerBarOverload, blockedExit');
  });

  it('sanitises: disallowed keys, unknown ids, unsupported present hazards, duplicates, clamps', async () => {
    const llm = createFakeLlm({
      overrides: {
        relate: {
          hazards: [
            { hazardKey: 'arson', present: true, confidence: 0.9, reason: 'not allowed', observationIds: ['obs-1'] },
            { hazardKey: 'blockedExit', present: true, confidence: 0.9, reason: 'no real evidence', observationIds: ['obs-99'] },
            { hazardKey: 'powerBarOverload', present: true, confidence: 0.4, reason: 'low', observationIds: ['obs-3', 'obs-3', 'obs-42'] },
            { hazardKey: 'powerBarOverload', present: true, confidence: 1.6, reason: ' high ', observationIds: ['obs-3'] },
            { hazardKey: 'heaterNearCombustible', present: false, confidence: -0.3, reason: 'curtain is behind glass', observationIds: [] },
          ],
        },
      },
    });
    const out = await relateCall(llm, relateInput());
    expect(out.hazards).toEqual([
      { hazardKey: 'heaterNearCombustible', present: false, confidence: 0, reason: 'curtain is behind glass', observationIds: [] },
      { hazardKey: 'powerBarOverload', present: true, confidence: 1, reason: 'high', observationIds: ['obs-3'] },
    ]);
  });

  it('spends no call when there is nothing to relate or nothing allowed', async () => {
    const llm = createFakeLlm();
    await expect(relateCall(llm, { ...relateInput(), observations: [] })).resolves.toEqual({ hazards: [] });
    await expect(relateCall(llm, { ...relateInput(), allowedHazardKeys: [] })).resolves.toEqual({ hazards: [] });
    expect(llm.calls()).toHaveLength(0);
  });

  it('propagates a provider failure as LlmError', async () => {
    const llm = createFakeLlm({ failFor: ['relate'] });
    await expect(relateCall(llm, relateInput())).rejects.toBeInstanceOf(LlmError);
  });
});
