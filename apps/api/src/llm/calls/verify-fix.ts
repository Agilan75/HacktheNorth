/** Gemini call 3 of 8: `verify-fix`. Body owned by Run 1 unit A04. */
import { z } from 'zod';
import { math } from '@retrofit/engine';
import type { VerifyFixInput, VerifyFixOutput } from '@retrofit/contracts';
import { generateJson } from '../generate-json';
import { LlmUnavailableError } from '../types';
import type { LlmImagePart, LlmProvider, LlmSchema, ResponseSchemaNode } from '../types';

/** Longest `reason` kept; anything longer is cut on a word boundary. */
const MAX_REASON_CHARS = 400;

const MAX_OUTPUT_TOKENS = 2048;

/**
 * What the route gets when the model cannot answer. Conservative on purpose:
 * a fix is never credited without evidence, so the hazard stays present at
 * zero confidence and the verdict and price do not move.
 */
const UNVERIFIED_REASON = 'The photo could not be checked, so the hazard is still counted.';

const RESPONSE: ResponseSchemaNode = {
  type: 'OBJECT',
  properties: {
    stillPresent: {
      type: 'BOOLEAN',
      description: 'True if the hazard described is still visible or cannot be ruled out in the photo.',
    },
    confidence: {
      type: 'NUMBER',
      description: 'How sure you are of stillPresent, 0 to 1.',
      minimum: 0,
      maximum: 1,
    },
    reason: {
      type: 'STRING',
      description: 'One plain sentence naming what in the photo decided the answer.',
    },
  },
  required: ['stillPresent', 'confidence', 'reason'],
  propertyOrdering: ['stillPresent', 'confidence', 'reason'],
};

const ZOD = z.object({
  stillPresent: z.boolean(),
  confidence: z.number().finite(),
  reason: z.string(),
});

const SCHEMA: LlmSchema<z.infer<typeof ZOD>> = { zod: ZOD, response: RESPONSE };

const SYSTEM_INSTRUCTION =
  'You check one photo to see whether a single home-safety hazard has been fixed. ' +
  'You only describe what the photo shows. You never estimate a price, a score or a verdict. ' +
  'If the photo is blurry, dark, shows a screen, or does not show the area where the hazard was, ' +
  'answer stillPresent true with low confidence and say why.';

/** Collapses whitespace and strips anything that could break a single-line field. */
function oneLine(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function cap(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function buildPrompt(input: VerifyFixInput, photo: LlmImagePart): string {
  const lines = [
    `Room: ${oneLine(input.roomLabel)}`,
    `Hazard being checked: ${oneLine(input.hazardLabel)} (key: ${oneLine(input.hazardKey)})`,
    `What was seen before the fix: ${oneLine(input.whatWasSeen)}`,
  ];
  if (photo.label !== undefined && photo.label.trim().length > 0) {
    lines.push(`Photo: ${oneLine(photo.label)}`);
  }
  lines.push(
    '',
    'The attached photo was taken after the occupant says they fixed this hazard.',
    'Is the hazard still present in the photo?',
    'Answer stillPresent=false only if the photo clearly shows the same area and the hazard is gone or resolved.',
    'Give confidence from 0 to 1 and one short reason that names what you can see.',
  );
  return lines.join('\n');
}

function unverified(): VerifyFixOutput {
  return { stillPresent: true, confidence: 0, reason: UNVERIFIED_REASON };
}

export async function verifyFixCall(
  provider: LlmProvider,
  input: VerifyFixInput,
  photo: LlmImagePart,
): Promise<VerifyFixOutput> {
  let result;
  try {
    result = await generateJson(provider, {
      callName: 'verify-fix',
      prompt: buildPrompt(input, photo),
      parts: [photo],
      schema: SCHEMA,
      systemInstruction: SYSTEM_INSTRUCTION,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      temperature: 0,
    });
  } catch (error) {
    // Configuration problems are the route's to report; everything else degrades.
    if (error instanceof LlmUnavailableError) throw error;
    return unverified();
  }
  if (result.degraded) return unverified();

  const reason = cap(oneLine(result.data.reason), MAX_REASON_CHARS);
  return {
    stillPresent: result.data.stillPresent,
    confidence: math.clamp01(result.data.confidence),
    reason: reason.length > 0 ? reason : 'No reason given.',
  };
}
