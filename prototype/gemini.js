// Tried in order. An overloaded model (429/500/503) falls through to the next one,
// and the whole list is cycled MAX_ROUNDS times before giving up.
const MODELS = ["gemini-3.6-flash", "gemini-3.8-flash", "gemini-3.5-flash"];
const MAX_ROUNDS = 2;
const ROUND_BACKOFF_MS = 2500;
const RETRYABLE = new Set([429, 500, 503]);
const endpoint = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

export const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    hazards: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          detail: { type: "string" },
          frames: { type: "array", items: { type: "integer" } },
          severity: { type: "string", enum: ["high", "medium", "low"] },
          confidence: { type: "number" },
          fix: { type: "string" },
        },
        required: ["id", "label", "detail", "frames", "severity", "confidence", "fix"],
      },
    },
    contents: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          category: {
            type: "string",
            enum: ["electronics", "jewelry", "bicycle", "instrument", "furniture", "appliance", "other"],
          },
          est_value: { type: "number" },
          confidence: { type: "number" },
          frames: { type: "array", items: { type: "integer" } },
        },
        required: ["id", "label", "category", "est_value", "confidence", "frames"],
      },
    },
    unanswerable: { type: "array", items: { type: "string" } },
  },
  required: ["hazards", "contents", "unanswerable"],
};

export function hazardPrompt(n) {
  return `You are given ${n} frames from a single continuous 360° sweep of one room, in order. Frame 1 is the first captured, frame ${n} the last. Each image is preceded by its label ("Frame 1", "Frame 2", ...). Reason across frames — objects seen in different frames may be in the same room and their relationship may itself be the hazard.

You are a home-insurance risk surveyor assessing this room for a renters policy.

HAZARDS
Report conditions that raise the likelihood of an insurance claim: fire, electrical, water, trip/fall, security/theft, structural.
- Relationships count as hazards, not just objects. Examples: a space heater in one frame close to curtains or bedding seen in an adjacent frame; an overloaded power strip under a desk that has open drinks on it; a candle below a shelf; an extension cord running across a walkway; valuables visible from a ground-floor window.
- Adjacent frame numbers are physically adjacent in the room. Use that to judge proximity.
- "frames" must list every frame number that shows any part of the hazard.
- "detail" explains what you see and why it is a risk, citing frame numbers.
- "fix" is one concrete action the resident can take today.
- severity: "high" = plausible cause of a serious fire, flood, or injury claim; "medium" = meaningful risk that needs a contributing factor; "low" = minor or housekeeping-level risk.
- confidence is your honest probability (0 to 1) that the hazard really exists as described. Use values below 0.5 when the image is blurry, partially occluded, or you are inferring. Do not inflate.
- Do not report a hazard merely because something is absent from view; put that in "unanswerable" instead.
- Report each distinct hazard once. Use ids h1, h2, ...

CONTENTS
List insurable belongings worth roughly $50 or more.
- The same physical item seen in several frames is ONE entry with all its frames listed.
- est_value is a conservative replacement cost in USD for what is visibly there; when the model or brand is unclear, estimate a mid-range equivalent and lower the confidence.
- Use ids c1, c2, ...

UNANSWERABLE
List anything material to risk that these frames cannot settle, each as a short sentence saying what is unknown and why (for example: "Smoke detector presence — the ceiling was not captured in any frame."). Prefer listing a question here over guessing.

If the frames do not show a room interior, return empty hazards and contents and explain in "unanswerable".`;
}

export function buildRequest(frames) {
  const parts = [{ text: hazardPrompt(frames.length) }];
  for (const frame of frames) {
    parts.push({ text: `Frame ${frame.n}` });
    parts.push({
      inline_data: {
        mime_type: "image/jpeg",
        // inline_data.data wants the raw payload, not the data URL
        data: frame.dataUrl.split(",")[1],
      },
    });
  }
  return {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  };
}

export class VisionError extends Error {
  constructor(message, rawText = null) {
    super(message);
    this.name = "VisionError";
    this.rawText = rawText;
  }
}

const clamp01 = (x) => Math.min(1, Math.max(0, Number(x) || 0));

export function sanitize(result, frameCount) {
  const validFrames = (list) =>
    [...new Set(list || [])].filter((n) => Number.isInteger(n) && n >= 1 && n <= frameCount).sort((a, b) => a - b);
  return {
    hazards: (result.hazards || []).map((h) => ({
      ...h,
      confidence: clamp01(h.confidence),
      frames: validFrames(h.frames),
    })),
    contents: (result.contents || []).map((c) => ({
      ...c,
      confidence: clamp01(c.confidence),
      frames: validFrames(c.frames),
    })),
    unanswerable: result.unanswerable || [],
  };
}

// Sends the same request to each model in turn until one is not overloaded.
async function postWithFallback(body, apiKey, onStatus) {
  let lastError;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (round > 0) await new Promise((resolve) => setTimeout(resolve, ROUND_BACKOFF_MS));
    for (const model of MODELS) {
      let response;
      try {
        response = await fetch(`${endpoint(model)}?key=${encodeURIComponent(apiKey)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
      } catch (err) {
        throw new VisionError(`Network error reaching Gemini: ${err.message}`);
      }

      const bodyText = await response.text();
      if (response.ok) return { bodyText, model };

      let message = bodyText;
      try {
        message = JSON.parse(bodyText).error?.message || bodyText;
      } catch {}
      lastError = new VisionError(`Gemini (${model}) returned ${response.status}: ${message}`);
      if (!RETRYABLE.has(response.status)) throw lastError;
      onStatus?.(`${model} is busy, trying another model…`);
    }
  }
  throw lastError;
}

export async function analyzeFrames(frames, apiKey, onStatus) {
  const { bodyText, model } = await postWithFallback(JSON.stringify(buildRequest(frames)), apiKey, onStatus);

  let data;
  try {
    data = JSON.parse(bodyText);
  } catch {
    throw new VisionError("Gemini response envelope was not JSON.", bodyText);
  }

  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text;
  if (!text) {
    const reason = candidate?.finishReason || data.promptFeedback?.blockReason || "unknown";
    throw new VisionError(`Gemini returned no content (reason: ${reason}).`, bodyText);
  }

  let result;
  try {
    result = JSON.parse(text);
  } catch (err) {
    const truncated = candidate.finishReason === "MAX_TOKENS" ? " The output was cut off at the token limit." : "";
    throw new VisionError(`Could not parse the model's JSON: ${err.message}.${truncated}`, text);
  }
  return { ...sanitize(result, frames.length), model };
}
