/**
 * A03 offline tests for `observe`, against the deterministic fake provider. No
 * network. Moved verbatim out of `observe.live.test.ts` at CP1
 * (docs/contracts/requests/A03.md) so they run in the default suite.
 */
import { describe, expect, it } from 'vitest';
import type { ObserveInput } from '@retrofit/contracts';
import { OBJECT_CATEGORY, OBJECT_VOCAB } from '@retrofit/engine';
import { createFakeLlm } from '../fake-provider';
import type { AnyGenerateJsonRequest, LlmImagePart, LlmPart } from '../types';
import { LlmError } from '../types';
import { observeCall } from './observe';
/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */
const img = (tag: string): LlmImagePart => ({
  kind: 'image',
  mimeType: 'image/jpeg',
  dataBase64: Buffer.from(tag).toString('base64'),
});

const observeInput = (runIndex: 0 | 1 = 0): ObserveInput => ({
  roomLabel: 'Bedroom',
  frames: [
    { index: 0, bearingDeg: 10, quality: 0.9 },
    { index: 1, bearingDeg: 40, quality: 0.8 },
  ],
  vocabulary: OBJECT_VOCAB,
  runIndex,
});
const textsOf = (parts: readonly LlmPart[] | undefined): string[] =>
  (parts ?? []).flatMap((p) => (p.kind === 'text' ? [p.text] : []));
/* -------------------------------------------------------------------------- */
/* observe — offline                                                          */
/* -------------------------------------------------------------------------- */

describe('observeCall (fake provider)', () => {
  it('returns the canned frames with categories fixed by code and one request of interleaved parts', async () => {
    const llm = createFakeLlm();
    const out = await observeCall(llm, observeInput(), [img('a'), img('b')]);

    expect(out.frames.map((f) => f.index)).toEqual([0, 1]);
    expect(out.frames[0]?.objects.map((o) => o.label)).toEqual(['portable_heater', 'curtain']);
    expect(out.frames[0]?.objects[0]).toEqual({
      label: 'portable_heater',
      category: 'heat_source',
      box_2d: [620, 140, 880, 360],
      distanceBand: 'near',
      confidence: 0.86,
      notes: 'free-standing electric heater on the floor',
    });
    expect(out.frames[1]?.objects[0]?.category).toBe(OBJECT_CATEGORY.smoke_detector);
    expect(out.frames[1]?.ceilingVisible).toBe(true);

    const calls = llm.callsFor('observe');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.partKinds).toEqual(['text', 'image', 'text', 'image']);
    expect(calls[0]?.prompt).toContain('portable_heater, extension_cord, power_bar');
    expect(calls[0]?.prompt).toContain('"Bedroom"');
  });

  it('sends frames in capture order for run 0 and reversed for run 1, deterministically', async () => {
    const seen: string[][] = [];
    const llm = createFakeLlm({
      handler: (req: AnyGenerateJsonRequest) => {
        seen.push(textsOf(req.parts));
        return undefined;
      },
    });
    await observeCall(llm, observeInput(0), [img('a'), img('b')]);
    await observeCall(llm, observeInput(1), [img('a'), img('b')]);
    await observeCall(llm, observeInput(1), [img('a'), img('b')]);

    expect(seen[0]).toEqual([
      'Frame index=0, bearing 10°, quality 0.90',
      'Frame index=1, bearing 40°, quality 0.80',
    ]);
    expect(seen[1]).toEqual([
      'Frame index=1, bearing 40°, quality 0.80',
      'Frame index=0, bearing 10°, quality 0.90',
    ]);
    expect(seen[2]).toEqual(seen[1]);
  });

  it('pairs each label with its own image bytes after reordering', async () => {
    let parts: readonly LlmPart[] = [];
    const llm = createFakeLlm({
      handler: (req: AnyGenerateJsonRequest) => {
        parts = req.parts ?? [];
        return undefined;
      },
    });
    await observeCall(llm, observeInput(1), [img('first'), img('second')]);
    const second = parts[1];
    expect(second?.kind).toBe('image');
    expect(second?.kind === 'image' ? Buffer.from(second.dataBase64, 'base64').toString() : '').toBe(
      'second',
    );
  });

  it('sanitises: drops off-vocabulary labels and extra frames, clamps boxes and confidence, gates unusable frames', async () => {
    const llm = createFakeLlm({
      overrides: {
        observe: {
          frames: [
            {
              index: 0,
              usable: true,
              reason: ' ok ',
              ceilingVisible: false,
              objects: [
                // wrong category from the model; code overrides it
                { label: 'portable_heater', category: 'valuables', box_2d: [900, 800, 100, 50], distanceBand: 'near', confidence: 1.7, notes: 'heater' },
                // outside the fixed vocabulary
                { label: 'sofa', category: 'other', box_2d: [0, 0, 10, 10], distanceBand: 'mid', confidence: 0.9, notes: '' },
                // in OBJECT_VOCAB but not in this request's vocabulary
                { label: 'bike', category: 'other', box_2d: [0, 0, 10, 10], distanceBand: 'far', confidence: 0.9, notes: '' },
                // degenerate box
                { label: 'candle', category: 'heat_source', box_2d: [100, 100, 100, 300], distanceBand: 'near', confidence: 0.5, notes: '' },
                // wrong arity
                { label: 'candle', category: 'heat_source', box_2d: [1, 2, 3], distanceBand: 'near', confidence: 0.5, notes: '' },
                { label: 'curtain', box_2d: [-40, 10, 1400, 20], distanceBand: 'near', confidence: -0.2, notes: 'x'.repeat(500) },
              ],
            },
            {
              index: 0,
              usable: false,
              reason: 'duplicate index is ignored',
              ceilingVisible: true,
              objects: [],
            },
            { index: 99, usable: true, reason: 'never sent', ceilingVisible: true, objects: [] },
          ],
        },
      },
    });
    const input: ObserveInput = {
      ...observeInput(),
      frames: [
        { index: 0, bearingDeg: 0, quality: 1 },
        { index: 1, bearingDeg: 30, quality: 1 },
        { index: 2, bearingDeg: 60, quality: 1 },
      ],
      vocabulary: OBJECT_VOCAB.filter((l) => l !== 'bike'),
    };
    const out = await observeCall(llm, input, [img('a'), img('b'), img('c')]);

    expect(out.frames.map((f) => f.index)).toEqual([0, 1, 2]);
    const f0 = out.frames[0];
    expect(f0?.reason).toBe('ok');
    expect(f0?.objects).toHaveLength(2);
    expect(f0?.objects[0]).toMatchObject({
      label: 'portable_heater',
      category: 'heat_source',
      box_2d: [100, 50, 900, 800],
      confidence: 1,
    });
    expect(f0?.objects[1]).toMatchObject({
      label: 'curtain',
      category: 'combustible',
      box_2d: [0, 10, 1000, 20],
      confidence: 0,
    });
    expect(f0?.objects[1]?.notes).toHaveLength(200);

    // frames the model skipped come back unusable, never silently usable
    expect(out.frames[1]).toEqual({
      index: 1,
      usable: false,
      reason: 'frame not returned by the model',
      ceilingVisible: false,
      objects: [],
    });
  });

  it('drops objects and ceiling evidence from a frame the model marked unusable', async () => {
    const llm = createFakeLlm({
      overrides: {
        observe: {
          frames: [
            {
              index: 0,
              usable: false,
              reason: 'photo of a screen',
              ceilingVisible: true,
              objects: [
                { label: 'tv', category: 'valuables', box_2d: [0, 0, 500, 500], distanceBand: 'near', confidence: 0.9, notes: '' },
              ],
            },
          ],
        },
      },
    });
    const input: ObserveInput = { ...observeInput(), frames: [{ index: 0, bearingDeg: 0, quality: 0.7 }] };
    const out = await observeCall(llm, input, [img('a')]);
    expect(out.frames).toEqual([
      { index: 0, usable: false, reason: 'photo of a screen', ceilingVisible: false, objects: [] },
    ]);
  });

  it('rejects a descriptor/image count mismatch before spending a call, and skips an empty sweep', async () => {
    const llm = createFakeLlm();
    await expect(observeCall(llm, observeInput(), [img('a')])).rejects.toBeInstanceOf(LlmError);
    await expect(observeCall(llm, { ...observeInput(), frames: [] }, [])).resolves.toEqual({ frames: [] });
    expect(llm.calls()).toHaveLength(0);
  });

  it('propagates a provider failure as LlmError', async () => {
    const llm = createFakeLlm({ failFor: ['observe'] });
    await expect(observeCall(llm, observeInput(), [img('a'), img('b')])).rejects.toBeInstanceOf(LlmError);
  });
});
