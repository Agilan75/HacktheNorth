import { FRAME_COUNT, startCamera, stopCamera, runSweep, framesFromFiles } from "./capture.js";
import { analyzeFrames } from "./gemini.js";
import { priceQuote, contentsTotal, formatUSD, CONFIDENCE_THRESHOLD } from "./pricing.js";

const $ = (id) => document.getElementById(id);

// Model output is untrusted text: build DOM nodes, never innerHTML.
function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null));
  return node;
}

const video = $("video");
let apiKey = null;
let frames = [];
let sweepAbort = null;
let cameraOn = false;

function show(view) {
  for (const section of document.querySelectorAll(".view")) section.hidden = section.id !== `view-${view}`;
  $("rescan").hidden = view === "capture" || view === "setup";
  $("save-frames").hidden = $("rescan").hidden;
  window.scrollTo(0, 0);
}

function thumb(frame) {
  const img = el("img", { src: frame.dataUrl, alt: `Frame ${frame.n}`, loading: "lazy" });
  const button = el("button", { className: "thumb", title: `Frame ${frame.n}` }, img, el("span", {}, String(frame.n)));
  button.addEventListener("click", () => {
    $("lightbox-img").src = frame.dataUrl;
    $("lightbox-caption").textContent = `Frame ${frame.n} of ${frames.length}`;
    $("lightbox").showModal();
  });
  return button;
}

$("lightbox").addEventListener("click", () => $("lightbox").close());

// ---------- capture ----------

function resetCapture() {
  sweepAbort?.abort();
  sweepAbort = null;
  stopCamera(video);
  cameraOn = false;
  frames = [];
  $("primary").textContent = "Open camera";
  $("stage-idle").hidden = false;
  $("sweep-overlay").hidden = true;
  $("capture-error").hidden = true;
  $("capture-thumbs").replaceChildren();
  $("upload").value = "";
  show("capture");
}

function captureError(message) {
  $("capture-error").textContent = message;
  $("capture-error").hidden = false;
}

$("primary").addEventListener("click", async () => {
  $("capture-error").hidden = true;

  if (sweepAbort) {
    resetCapture();
    return;
  }

  if (!cameraOn) {
    try {
      await startCamera(video);
    } catch (err) {
      captureError(err.name === "NotAllowedError" ? "Camera permission was denied. Allow it, or upload photos instead." : err.message);
      return;
    }
    cameraOn = true;
    $("stage-idle").hidden = true;
    $("primary").textContent = "Start sweep";
    return;
  }

  sweepAbort = new AbortController();
  $("primary").textContent = "Cancel";
  $("sweep-overlay").hidden = false;
  $("capture-thumbs").replaceChildren();
  const captured = await runSweep(video, {
    signal: sweepAbort.signal,
    onFrame: (frame) => {
      $("sweep-count").textContent = `Turn slowly · ${frame.n} / ${FRAME_COUNT}`;
      $("sweep-bar").style.width = `${(frame.n / FRAME_COUNT) * 100}%`;
      $("capture-thumbs").append(thumb(frame));
    },
  });
  if (!captured) return;
  sweepAbort = null;
  stopCamera(video);
  cameraOn = false;
  frames = captured;
  analyze();
});

$("upload").addEventListener("change", async (event) => {
  $("capture-error").hidden = true;
  const files = event.target.files;
  if (!files.length) return;
  try {
    frames = await framesFromFiles(files);
  } catch (err) {
    captureError(err.message);
    return;
  }
  sweepAbort?.abort();
  sweepAbort = null;
  stopCamera(video);
  cameraOn = false;
  analyze();
});

// Dev aid: saves the current sweep so compare.mjs can replay it against other models.
$("save-frames").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(frames)], { type: "application/json" }));
  el("a", { href: url, download: "room-sweep-frames.json" }).click();
  URL.revokeObjectURL(url);
});

$("rescan").addEventListener("click", resetCapture);
$("retry").addEventListener("click", analyze);

// ---------- analyze ----------

async function analyze() {
  $("analyzing-count").textContent = frames.length;
  $("analyzing-thumbs").replaceChildren(...frames.map(thumb));
  show("analyzing");

  const started = Date.now();
  $("elapsed").textContent = "0s";
  const ticker = setInterval(() => {
    $("elapsed").textContent = `${Math.round((Date.now() - started) / 1000)}s`;
  }, 1000);

  try {
    $("analyzing-status").textContent = "";
    const result = await analyzeFrames(frames, apiKey, (status) => {
      $("analyzing-status").textContent = status;
    });
    console.info(`Analyzed by ${result.model}`);
    renderResults(result);
    show("results");
  } catch (err) {
    console.error(err);
    $("error-message").textContent = err.message;
    $("error-raw-block").hidden = !err.rawText;
    $("error-raw").textContent = err.rawText || "";
    show("error");
  } finally {
    clearInterval(ticker);
  }
}

// ---------- results ----------

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };
const percent = (x) => `${Math.round(x * 100)}%`;
const frameThumbs = (numbers) => el("div", { className: "thumbs" }, ...numbers.map((n) => thumb(frames[n - 1])));

function renderResults({ hazards, contents, unanswerable }) {
  const quote = priceQuote(hazards);

  $("quote-total").replaceChildren(formatUSD(quote.total), el("span", {}, "/mo"));
  $("quote-lines").replaceChildren(
    el("div", { className: "line" }, el("span", {}, "Base rate"), el("span", {}, formatUSD(quote.base))),
    ...quote.lineItems
      .filter((item) => item.applied)
      .map((item) =>
        el("div", { className: "line" }, el("span", {}, item.label), el("span", {}, `+${formatUSD(item.delta)}`))
      )
  );

  // lineItems is parallel to hazards; pair by index so duplicate model ids can't cross wires
  const sorted = hazards
    .map((hazard, i) => ({ hazard, item: quote.lineItems[i] }))
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.hazard.severity] - SEVERITY_RANK[b.hazard.severity] || b.hazard.confidence - a.hazard.confidence
    );
  $("hazard-count").textContent = hazards.length;
  $("hazards").replaceChildren(
    ...(sorted.length
      ? sorted.map(({ hazard, item }) => hazardCard(hazard, item))
      : [el("p", { className: "empty" }, "No hazards found in these frames.")])
  );

  $("contents-count").textContent = contents.length;
  $("contents").replaceChildren(contents.length ? contentsTable(contents) : el("p", { className: "empty" }, "No insurable items identified."));

  $("unanswerable-block").hidden = !unanswerable.length;
  $("unanswerable").replaceChildren(...unanswerable.map((text) => el("li", {}, text)));
}

function hazardCard(hazard, item) {
  const priced = item.applied;
  return el(
    "article",
    { className: `card hazard ${priced ? "" : "unpriced"}` },
    el(
      "div",
      { className: "card-head" },
      el("span", { className: `badge ${hazard.severity}` }, hazard.severity),
      el("h3", {}, hazard.label),
      el("span", { className: "delta" }, priced ? `+${formatUSD(item.delta)}/mo` : "not priced")
    ),
    el("p", {}, hazard.detail),
    el(
      "p",
      { className: "fix" },
      el("strong", {}, "Fix: "),
      hazard.fix,
      priced ? el("span", { className: "saving" }, ` Saves ${formatUSD(item.delta)}/mo`) : null
    ),
    el(
      "div",
      { className: "meta" },
      `Confidence ${percent(hazard.confidence)}` +
        (priced ? "" : ` · below the ${percent(CONFIDENCE_THRESHOLD)} pricing threshold`) +
        (hazard.frames.length > 1 ? ` · spans ${hazard.frames.length} frames` : "")
    ),
    hazard.frames.length ? frameThumbs(hazard.frames) : null
  );
}

function contentsTable(contents) {
  const rows = [...contents]
    .sort((a, b) => b.est_value - a.est_value)
    .map((c) =>
      el(
        "tr",
        {},
        el("td", {}, c.label, el("div", { className: "meta" }, `${c.category} · ${percent(c.confidence)} confident`)),
        el("td", { className: "num" }, formatUSD(c.est_value))
      )
    );
  return el(
    "table",
    { className: "card" },
    el("tbody", {}, ...rows),
    el(
      "tfoot",
      {},
      el("tr", {}, el("td", {}, "Suggested contents coverage"), el("td", { className: "num" }, formatUSD(contentsTotal(contents))))
    )
  );
}

// ---------- boot ----------

try {
  ({ GEMINI_API_KEY: apiKey } = await import("./config.js"));
} catch {}

if (!apiKey || apiKey === "PASTE_KEY_HERE") show("setup");
else show("capture");
