import { RESPONSE_SCHEMA, hazardPrompt, sanitize, VisionError } from "./gemini.js";

const ENDPOINT = "https://api.anthropic.com/v1/messages";

// Claude's structured outputs require additionalProperties: false on every object.
function closeObjects(schema) {
  if (Array.isArray(schema)) return schema.map(closeObjects);
  if (!schema || typeof schema !== "object") return schema;
  const out = Object.fromEntries(Object.entries(schema).map(([key, value]) => [key, closeObjects(value)]));
  if (schema.type === "object") out.additionalProperties = false;
  return out;
}

const OUTPUT_SCHEMA = closeObjects(RESPONSE_SCHEMA);

export function buildClaudeRequest(frames, model) {
  // Images first, instructions last.
  const content = [];
  for (const frame of frames) {
    content.push({ type: "text", text: `Frame ${frame.n}` });
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: frame.dataUrl.split(",")[1] },
    });
  }
  content.push({ type: "text", text: hazardPrompt(frames.length) });
  return {
    model,
    max_tokens: 16000,
    output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    messages: [{ role: "user", content }],
  };
}

// Same return shape as gemini.js analyzeFrames, plus token usage.
export async function analyzeFramesClaude(frames, apiKey, model = "claude-sonnet-5", workspaceId = null) {
  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        // required for calls made straight from a browser
        "anthropic-dangerous-direct-browser-access": "true",
        // only needed when the key is not scoped to a single workspace
        ...(workspaceId ? { "anthropic-workspace-id": workspaceId } : {}),
      },
      body: JSON.stringify(buildClaudeRequest(frames, model)),
    });
  } catch (err) {
    throw new VisionError(`Network error reaching Claude: ${err.message}`);
  }

  const bodyText = await response.text();
  if (!response.ok) {
    let message = bodyText;
    try {
      message = JSON.parse(bodyText).error?.message || bodyText;
    } catch {}
    throw new VisionError(`Claude (${model}) returned ${response.status}: ${message}`);
  }

  let data;
  try {
    data = JSON.parse(bodyText);
  } catch {
    throw new VisionError("Claude response envelope was not JSON.", bodyText);
  }

  if (data.stop_reason === "refusal") {
    throw new VisionError(`Claude declined the request (${data.stop_details?.category || "no category"}).`, bodyText);
  }
  const text = data.content?.find((block) => block.type === "text")?.text;
  if (!text) throw new VisionError(`Claude returned no text (stop_reason: ${data.stop_reason}).`, bodyText);

  let result;
  try {
    result = JSON.parse(text);
  } catch (err) {
    const truncated = data.stop_reason === "max_tokens" ? " The output was cut off at the token limit." : "";
    throw new VisionError(`Could not parse the model's JSON: ${err.message}.${truncated}`, text);
  }
  return { ...sanitize(result, frames.length), model: data.model, usage: data.usage };
}
