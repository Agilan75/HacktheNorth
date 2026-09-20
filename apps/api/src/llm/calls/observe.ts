/** Gemini call 1 of 8: `observe`. Body owned by Run 1 unit A03. */
import { z } from 'zod';
import type {
  ObserveFrameOutput,
  ObserveInput,
  ObserveObject,
  ObserveOutput,
} from '@retrofit/contracts';
import { DISTANCE_BAND_ORDER, OBJECT_CATEGORY, OBJECT_VOCAB, math } from '@retrofit/engine';
import type { ObjectLabel } from '@retrofit/engine';
import type { LlmImagePart, LlmPart, LlmProvider, ResponseSchemaNode } from '../types';
import { LlmError } from '../types';

/* -------------------------------------------------------------------------- */
/* Schema                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Lenient on labels and box shape on purpose: one stray label must not cost a
 * retry of a 15-image request. Code filters and repairs below.
 */
const rawObjectZ = z.object({
  label: z.string(),
  category: z.string().optional(),
  box_2d: z.array(z.number()),
  distanceBand: z.enum(['near', 'mid', 'far']),
  confidence: z.number(),
  notes: z.string().optional().default(''),
});

const rawFrameZ = z.object({
  index: z.number().int(),
  usable: z.boolean(),
  reason: z.string().optional().default(''),
  ceilingVisible: z.boolean(),
  objects: z.array(rawObjectZ).optional().default([]),
});

const rawOutputZ = z.object({ frames: z.array(rawFrameZ) });
type RawOutput = z.infer<typeof rawOutputZ>;

function responseSchema(vocabulary: readonly ObjectLabel[]): ResponseSchemaNode {
  return {
    type: 'OBJECT',
    properties: {
      frames: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            index: { type: 'INTEGER', description: 'The frame index given in the frame label.' },
            usable: { type: 'BOOLEAN' },
            reason: { type: 'STRING' },
            ceilingVisible: { type: 'BOOLEAN' },
            objects: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  label: { type: 'STRING', enum: vocabulary },
                  box_2d: {
                    type: 'ARRAY',
                    description: '[y0, x0, y1, x1] normalised to 0..1000',
                    items: { type: 'INTEGER', minimum: 0, maximum: 1000 },
                  },
                  distanceBand: { type: 'STRING', enum: DISTANCE_BAND_ORDER },
                  confidence: { type: 'NUMBER', minimum: 0, maximum: 1 },
                  notes: { type: 'STRING' },
                },
                required: ['label', 'box_2d', 'distanceBand', 'confidence', 'notes'],
                propertyOrdering: ['label', 'box_2d', 'distanceBand', 'confidence', 'notes'],
              },
            },
          },
          required: ['index', 'usable', 'reason', 'ceilingVisible', 'objects'],
          propertyOrdering: ['index', 'usable', 'reason', 'ceilingVisible', 'objects'],
        },
      },
    },
    required: ['frames'],
    propertyOrdering: ['frames'],
  };
}

/* -------------------------------------------------------------------------- */
/* Prompt                                                                     */
/* -------------------------------------------------------------------------- */

const SYSTEM_INSTRUCTION =
  'You are a careful visual surveyor for a renters-insurance quote. You report only what is ' +
  'visible in the images, using a fixed object vocabulary. You never estimate a price, a ' +
  'score, or a verdict.';

function buildPrompt(input: ObserveInput, order: readonly number[]): string {
  const vocab = input.vocabulary.join(', ');
  return [
    `These ${order.length} images are frames from one continuous 360° camera sweep of a room labelled "${input.roomLabel}".`,
    'Each image is preceded by a text label giving its frame index, compass bearing in degrees, and a 0..1 image-quality score.',
    'The images may not be in capture order; use the bearings, not the order, to judge where things are.',
    '',
    'For EVERY frame, return one entry with:',
    '- index: the frame index from its label (not its position in this request).',
    '- usable: false if the image is not a real room interior (a photo of a screen, an obstructed or covered lens, a blank or black image), otherwise true. Give a short reason either way.',
    '- ceilingVisible: true only if a meaningful part of the ceiling is clearly in view.',
    '- objects: the objects visible in that frame.',
    '',
    `Object labels must come from this vocabulary and nothing else: ${vocab}.`,
    'Use "unknown" for something relevant to fire, electrical, water, egress or theft risk that fits no other label. Do not list ordinary furniture.',
    'For each object: box_2d is [y0, x0, y1, x1] normalised to 0..1000; distanceBand is how far it is from the camera (near < ~1.5 m, mid ~1.5–3 m, far > 3 m);',
    'confidence is your honest 0..1 probability that the object is really there with that label — below 0.5 if blurry, occluded or inferred; notes is one short factual phrase.',
    'The same physical object seen in two frames is listed in each frame it appears in.',
    'Do not report an object because it is absent or expected. Do not guess about anything outside the frame.',
  ].join('\n');
}

/**
 * The presentation order for the self-consistency pass (PRD §9.3 step 4).
 * Deterministic: run 0 keeps capture order, run 1 reverses it. No randomness.
 */
function presentationOrder(count: number, runIndex: 0 | 1): number[] {
  const order = Array.from({ length: count }, (_, i) => i);
  return runIndex === 1 ? order.reverse() : order;
}

function frameLabel(input: ObserveInput, position: number): string {
  const frame = input.frames[position];
  if (frame === undefined) return `Frame position ${position}`;
  const bearing = Math.round(frame.bearingDeg);
  const quality = math.clamp01(frame.quality).toFixed(2);
  return `Frame index=${frame.index}, bearing ${bearing}°, quality ${quality}`;
}

/* -------------------------------------------------------------------------- */
/* Sanitising                                                                 */
/* -------------------------------------------------------------------------- */

const MAX_NOTES_CHARS = 200;
const MAX_REASON_CHARS = 200;
const BOX_MAX = 1000;

function clampBox(raw: readonly number[]): readonly [number, number, number, number] | null {
  if (raw.length !== 4) return null;
  const v = raw.map((n) => Math.round(math.clamp(n, 0, BOX_MAX)));
  const [a, b, c, d] = v as [number, number, number, number];
  const y0 = Math.min(a, c);
  const y1 = Math.max(a, c);
  const x0 = Math.min(b, d);
  const x1 = Math.max(b, d);
  if (y1 === y0 || x1 === x0) return null;
  return [y0, x0, y1, x1];
}

function sanitiseObject(
  raw: RawOutput['frames'][number]['objects'][number],
  allowed: ReadonlySet<string>,
): ObserveObject | null {
  if (!allowed.has(raw.label)) return null;
  const label = raw.label as ObjectLabel;
  const box = clampBox(raw.box_2d);
  if (box === null) return null;
  return {
    label,
    // Category is a fixed function of the label; the model's opinion is ignored.
    category: OBJECT_CATEGORY[label],
    box_2d: box,
    distanceBand: raw.distanceBand,
    confidence: math.clamp01(raw.confidence),
    notes: (raw.notes ?? '').trim().slice(0, MAX_NOTES_CHARS),
  };
}

/**
 * Keeps only indices that were sent, one entry per index, in input order.
 * A frame the model skipped is reported unusable with no objects. Objects on an
 * unusable frame are dropped: the model gate (PRD §9.3 step 2) removes the frame.
 */
function sanitise(input: ObserveInput, raw: RawOutput): ObserveOutput {
  const allowed = new Set<string>(input.vocabulary.filter((l) => OBJECT_VOCAB.includes(l)));
  const byIndex = new Map<number, RawOutput['frames'][number]>();
  for (const frame of raw.frames) {
    if (!byIndex.has(frame.index)) byIndex.set(frame.index, frame);
  }

  const frames: ObserveFrameOutput[] = input.frames.map((sent) => {
    const got = byIndex.get(sent.index);
    if (got === undefined) {
      return {
        index: sent.index,
        usable: false,
        reason: 'frame not returned by the model',
        ceilingVisible: false,
        objects: [],
      };
    }
    const objects = got.usable
      ? got.objects
          .map((o) => sanitiseObject(o, allowed))
          .filter((o): o is ObserveObject => o !== null)
      : [];
    return {
      index: sent.index,
      usable: got.usable,
      reason: (got.reason ?? '').trim().slice(0, MAX_REASON_CHARS),
      ceilingVisible: got.usable && got.ceilingVisible,
      objects,
    };
  });

  return { frames };
}

/* -------------------------------------------------------------------------- */
/* The call                                                                   */
/* -------------------------------------------------------------------------- */

export async function observeCall(
  provider: LlmProvider,
  input: ObserveInput,
  frames: readonly LlmImagePart[],
): Promise<ObserveOutput> {
  if (frames.length !== input.frames.length) {
    throw new LlmError(
      `observe: ${frames.length} images for ${input.frames.length} frame descriptors`,
      { callName: 'observe', retryable: false },
    );
  }
  if (frames.length === 0) return { frames: [] };

  const order = presentationOrder(frames.length, input.runIndex);
  const parts: LlmPart[] = [];
  for (const position of order) {
    const image = frames[position];
    if (image === undefined) continue;
    parts.push({ kind: 'text', text: frameLabel(input, position) });
    parts.push(image);
  }

  const result = await provider.generateJson<RawOutput>({
    callName: 'observe',
    prompt: buildPrompt(input, order),
    parts,
    schema: {
      zod: rawOutputZ as unknown as z.ZodType<RawOutput>,
      response: responseSchema(input.vocabulary),
    },
    systemInstruction: SYSTEM_INSTRUCTION,
    temperature: 0,
  });

  return sanitise(input, result.data);
}
