/** Gemini call 2 of 8: `relate`. No images. Body owned by Run 1 unit A03. */
import { z } from 'zod';
import type { RelateHazard, RelateInput, RelateOutput } from '@retrofit/contracts';
import { math } from '@retrofit/engine';
import type { LlmProvider, ResponseSchemaNode } from '../types';

const rawHazardZ = z.object({
  hazardKey: z.string(),
  present: z.boolean(),
  confidence: z.number(),
  reason: z.string().optional().default(''),
  observationIds: z.array(z.string()).optional().default([]),
});

const rawOutputZ = z.object({ hazards: z.array(rawHazardZ) });
type RawOutput = z.infer<typeof rawOutputZ>;

function responseSchema(allowedHazardKeys: readonly string[]): ResponseSchemaNode {
  return {
    type: 'OBJECT',
    properties: {
      hazards: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            hazardKey: { type: 'STRING', enum: allowedHazardKeys },
            present: { type: 'BOOLEAN' },
            confidence: { type: 'NUMBER', minimum: 0, maximum: 1 },
            reason: { type: 'STRING' },
            observationIds: { type: 'ARRAY', items: { type: 'STRING' } },
          },
          required: ['hazardKey', 'present', 'confidence', 'reason', 'observationIds'],
          propertyOrdering: ['hazardKey', 'present', 'confidence', 'reason', 'observationIds'],
        },
      },
    },
    required: ['hazards'],
    propertyOrdering: ['hazards'],
  };
}

const SYSTEM_INSTRUCTION =
  'You judge spatial relationships between already-detected objects in one room for a ' +
  'renters-insurance survey. You never see images, never invent objects, and never estimate a ' +
  'price, a score, or a verdict.';

function buildPrompt(input: RelateInput): string {
  const observations = input.observations
    .map(
      (o) =>
        `- id=${o.id} label=${o.label} bearing=${Math.round(o.bearingDeg)}° ` +
        `distance=${o.distanceBand} confidence=${math.clamp01(o.confidence).toFixed(2)}`,
    )
    .join('\n');
  const engine =
    input.engineHazards.length === 0
      ? '(none)'
      : input.engineHazards
          .map((h) => `- ${h.hazardKey} confidence=${math.clamp01(h.confidence).toFixed(2)}`)
          .join('\n');
  return [
    `Room: "${input.roomLabel}". Objects were detected during a 360° camera sweep.`,
    'Bearings are compass degrees from the camera at the room centre; distance is near, mid or far from the camera.',
    'Two objects are likely close together when their bearings are within about 20° and their distance bands are the same or adjacent.',
    '',
    'Observations:',
    observations,
    '',
    'Hazards the rule engine already found from these observations:',
    engine,
    '',
    `Allowed hazard keys (return no other key): ${input.allowedHazardKeys.join(', ')}.`,
    '',
    'Return only hazards that ADD to or ADJUST the engine list:',
    '- a relational hazard the engine missed, with present=true;',
    '- an engine hazard you believe is wrong, with present=false and your confidence that it is absent;',
    '- an engine hazard whose confidence should change, with present=true and the adjusted confidence.',
    'For each: observationIds lists the ids above that support it (at least one when present=true);',
    'confidence is your honest 0..1 probability; reason is one short sentence citing the ids.',
    'Do not repeat an engine hazard you agree with unchanged. If there is nothing to add or adjust, return an empty list.',
  ].join('\n');
}

const MAX_REASON_CHARS = 240;

/**
 * Drops any key outside `allowedHazardKeys` (PRD §9.2: limited to `hazards.*`),
 * any observation id that was not sent, and any "present" hazard left with no
 * supporting observation. One entry per key: the highest confidence wins.
 */
function sanitise(input: RelateInput, raw: RawOutput): RelateOutput {
  const allowed = new Set(input.allowedHazardKeys);
  const known = new Set(input.observations.map((o) => o.id));
  const byKey = new Map<string, RelateHazard>();

  for (const h of raw.hazards) {
    if (!allowed.has(h.hazardKey)) continue;
    const ids = [...new Set(h.observationIds.filter((id) => known.has(id)))];
    if (h.present && ids.length === 0) continue;
    const hazard: RelateHazard = {
      hazardKey: h.hazardKey,
      present: h.present,
      confidence: math.clamp01(h.confidence),
      reason: h.reason.trim().slice(0, MAX_REASON_CHARS),
      observationIds: ids,
    };
    const prior = byKey.get(h.hazardKey);
    if (prior === undefined || hazard.confidence > prior.confidence) {
      byKey.set(h.hazardKey, hazard);
    }
  }

  const order = new Map(input.allowedHazardKeys.map((k, i) => [k, i] as const));
  const hazards = [...byKey.values()].sort(
    (a, b) => (order.get(a.hazardKey) ?? 0) - (order.get(b.hazardKey) ?? 0),
  );
  return { hazards };
}

export async function relateCall(
  provider: LlmProvider,
  input: RelateInput,
): Promise<RelateOutput> {
  // Nothing to relate, or nothing that may be returned: no call is spent.
  if (input.observations.length === 0 || input.allowedHazardKeys.length === 0) {
    return { hazards: [] };
  }

  const result = await provider.generateJson<RawOutput>({
    callName: 'relate',
    prompt: buildPrompt(input),
    schema: {
      zod: rawOutputZ as unknown as z.ZodType<RawOutput>,
      response: responseSchema(input.allowedHazardKeys),
    },
    systemInstruction: SYSTEM_INSTRUCTION,
    temperature: 0,
  });

  return sanitise(input, result.data);
}
