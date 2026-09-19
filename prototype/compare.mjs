// Runs one set of frames through Gemini, Claude Sonnet 5 and Claude Opus 5 and compares
// hazards found, latency and cost.
//
//   node compare.mjs ~/Downloads/room-sweep-frames.json   (from the app's "Download frames" link)
//   node compare.mjs path/to/folder-of-photos              (resized with sips, macOS only)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { analyzeFrames } from "./gemini.js";
import { analyzeFramesClaude } from "./claude.js";
import { priceQuote, formatUSD } from "./pricing.js";
import * as config from "./config.js";

const CLAUDE_PRICES = { "claude-sonnet-5": [2, 10], "claude-opus-5": [5, 25] }; // $ per 1M in/out

function loadFrames(input) {
  if (fs.statSync(input).isFile()) return JSON.parse(fs.readFileSync(input, "utf8"));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sweep-"));
  const files = fs.readdirSync(input).filter((f) => /\.(jpe?g|png|heic)$/i.test(f)).sort().slice(0, 20);
  return files.map((file, i) => {
    const out = path.join(tmp, `${i + 1}.jpg`);
    execFileSync("sips", ["-Z", "768", "-s", "format", "jpeg", "-s", "formatOptions", "70", path.join(input, file), "--out", out], { stdio: "ignore" });
    return { n: i + 1, dataUrl: "data:image/jpeg;base64," + fs.readFileSync(out).toString("base64") };
  });
}

const input = process.argv[2];
if (!input) {
  console.error("usage: node compare.mjs <frames.json | folder of photos>");
  process.exit(1);
}
const frames = loadFrames(input);
console.log(`${frames.length} frames loaded\n`);

const runs = [
  ["gemini (with fallback)", () => analyzeFrames(frames, config.GEMINI_API_KEY)],
  ...Object.keys(CLAUDE_PRICES).map((model) => [
    model,
    () => analyzeFramesClaude(frames, config.ANTHROPIC_API_KEY, model, config.ANTHROPIC_WORKSPACE_ID),
  ]),
];

const results = await Promise.all(
  runs.map(async ([name, run]) => {
    const started = Date.now();
    try {
      const result = await run();
      return { name, seconds: (Date.now() - started) / 1000, result };
    } catch (err) {
      return { name, seconds: (Date.now() - started) / 1000, error: err.message };
    }
  })
);

for (const { name, seconds, result, error } of results) {
  console.log(`=== ${name} · ${seconds.toFixed(1)}s`);
  if (error) {
    console.log(`  FAILED: ${error}\n`);
    continue;
  }
  const prices = CLAUDE_PRICES[name];
  if (prices && result.usage) {
    const { input_tokens, output_tokens } = result.usage;
    const cost = (input_tokens * prices[0] + output_tokens * prices[1]) / 1e6;
    console.log(`  tokens ${input_tokens} in / ${output_tokens} out · $${cost.toFixed(3)} per scan`);
  } else {
    console.log(`  answered by ${result.model}`);
  }
  console.log(`  premium ${formatUSD(priceQuote(result.hazards).total)}/mo · ${result.hazards.length} hazards · ${result.contents.length} contents · ${result.unanswerable.length} unanswerable`);
  for (const h of result.hazards) {
    const span = h.frames.length > 1 ? " [cross-frame]" : "";
    console.log(`  - ${h.severity.padEnd(6)} ${h.confidence.toFixed(2)}  frames ${h.frames.join(",") || "-"}${span}  ${h.label}`);
  }
  console.log();
}

fs.writeFileSync("compare-output.json", JSON.stringify(results, null, 2));
console.log("Full results written to compare-output.json");
