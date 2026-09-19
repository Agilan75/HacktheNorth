# Retrofit — Product Requirements Document

**Status:** Draft v0.6 · 2026-09-19 · Hack the North 2026
**Source:** Master Build Prompt §0–§14, with two amendments: **the LLM provider is Gemini, not Anthropic** (§8), and **the build machine is a Mac and the test device is an iPhone**, not Windows and Android (§7). Where this PRD and the build prompt disagree, this PRD wins.

---

## 1. Summary

Retrofit is one underwriting engine with two front doors.

- **Engine.** Takes a submission, discovers its schema at runtime, normalizes it to a canonical risk object, enriches it with real-world data, checks it against a carrier's appetite rules, and returns a verdict (`FIT` / `REFER` / `DOES_NOT_FIT`) with the deciding rule cited to a guideline section, plus the smallest change that would flip the verdict.
- **Front door 1 — Underwriter console (Federato track).** Commercial submissions pulled from Federato's API into a web console.
- **Front door 2 — Renter mobile app (Intact track).** A 20-second 360° room sweep finds hazards, which become fields in the same canonical submission. The same engine returns a tenant insurance verdict, estimate, and next step.
- **The bridge.** A sweep can be attached to an existing Federato submission as physical verification of self-reported fields. When the sweep contradicts what the broker typed, the console flags it, the rule re-fires, and the verdict updates.

> *"Underwriting runs on what the broker typed. We built the camera that checks."*

Domain: **retro.fit**. The TLD is the verdict; every submission is a slug.

## 2. Problem

Underwriting decisions rest on self-reported data that nobody verifies. Brokers type "sprinklered: yes" and "no portable heating"; the carrier prices on it. Three consequences:

1. **Unverified inputs.** There is no cheap way to check physical facts about a risk before binding.
2. **Opaque verdicts.** When a submission is declined or referred, the broker rarely learns which rule decided it or what would change the outcome.
3. **Schema friction.** Every source sends a different payload shape, and mapping each one by hand is slow.

On the consumer side, renters get a quote from a form that never looks at the room, so hazards that drive real losses (a space heater beside curtains, daisy-chained power bars, no smoke detector) are invisible to pricing and to the renter.

## 3. Goals and non-goals

### Goals

| # | Goal | Track |
| --- | --- | --- |
| G1 | An underwriter can open a queue of Federato submissions and see, per submission, a verdict with a cited rule trace | Federato |
| G2 | Schema is discovered at runtime; no Federato field names are hardcoded outside one synonym table | Federato |
| G3 | Contradictions between self-reported and real-world data are surfaced and ranked by whether a rule depends on them | Federato |
| G4 | Every non-FIT verdict comes with the minimal change that would make it FIT | Both |
| G5 | A renter completes a room sweep and receives a verdict, estimate, and next step | Intact |
| G6 | A sweep attached to a commercial submission updates its verdict in the console | Both |

### Non-goals

- Binding, payments, or issuing a real policy.
- Actuarially sound pricing. The estimate is a transparent base rate plus rule-driven adjustments, and is labelled "estimate".
- Authentication, multi-tenancy, multi-carrier support.
- Custom native modules, a required EAS build, or anything that breaks Expo Go.
- Nested boolean logic in rules. Conditions are AND-only.
- Agent loops inside the API. LLM calls are limited to the five listed in §8.

### Priority when tradeoffs arise

1. **Floor:** Federato console path (G1–G4).
2. **Demo:** Intact sweep → verdict path (G5).
3. **Differentiator:** the bridge (G6).
4. Everything else is optional.

## 4. Users

| User | Context | What they need |
| --- | --- | --- |
| **Commercial underwriter** | Works a queue of broker submissions in a web console | Triage quickly, trust the verdict, see why, see what is missing or contradicted |
| **Renter** | On their phone, in their room, wants tenant insurance | A quote in under a minute without a long form, and a clear idea of what to fix |
| **Broker** (indirect) | Submitted the risk | The smallest change that gets a declined risk accepted |
| **Hackathon judge** | Watches a 3-beat demo | One engine serving both tracks, with the bridge as the payoff |

## 5. User stories

### Underwriter console

- **U1.** I see a queue of submissions sorted by distance to appetite, with verdict, contradiction count, and a "1 flip from FIT" badge.
- **U2.** I open a submission and see the discovered schema: raw keys → canonical paths with confidence, unmapped keys highlighted.
- **U3.** I see enrichment cards with source, timestamp, and an explicit "unavailable" state when a source fails.
- **U4.** I see contradictions across self-reported, enrichment, and sweep values, with HIGH severity when a rule depends on the field.
- **U5.** I see the verdict trace: fired rules with citation and guideline quote, undetermined rules, and missing fields.
- **U6.** For non-FIT verdicts I see the minimal flip: at most two field changes, each with a fix hint.
- **U7.** I see portfolio aggregates, and the agreement rate against expected verdicts where fixtures carry them.
- **U8.** I can browse the active rulebook and glossary, and glossary terms in the trace have tooltips.
- **U9.** I always know whether I am looking at Mock or real Federato data.

### Renter mobile

- **R1.** I do a guided sweep and see coverage fill in around me, with a hint telling me which way to turn.
- **R2.** I confirm or dismiss anything the camera was unsure about.
- **R3.** I am asked only the questions that could still change my verdict, and I can see how many were skipped and why.
- **R4.** I receive a verdict, an estimate, the deciding rule, what to fix, and a next step.
- **R5.** I can tap a hazard and see the photo crop, why it matters, and what fixing it would change.

### Bridge

- **B1.** From a console submission I get a QR/link that opens the phone at `/new?attach=:id`. After the sweep, sweep-observed values appear alongside self-reported ones, contradictions are flagged, affected rules re-fire, and the verdict updates.

## 6. Functional requirements

### 6.1 Canonical risk object

`CanonicalSubmission` in `packages/engine/src/types.ts`. Every field is optional, typed, and wrapped as `Field<T> = { value, provenance }`, where provenance records `source` (`self_reported` | `enrichment` | `sweep` | `answer`), optional `sourceDetail`, `confidence`, and `observedAt`.

Groups: `insured`, `location`, `building`, `hazards`, `exposure`, `coverage`, `history`, plus `raw` (the untouched payload) and `fieldMap` (raw field → canonical path). `lineOfBusiness` is `commercial_property` or `tenant`.

**Requirement:** one canonical field can hold competing values from different sources. Enrichment and sweep values are written alongside self-reported values and never overwrite them. Contradiction detection depends on this.

### 6.2 Engine modules (`packages/engine`)

Pure TypeScript, zero I/O, tested with vitest. The engine must not import from `apps/*` or from any LLM SDK.

| Module | Requirement | Acceptance |
| --- | --- | --- |
| **schema-discovery** | Map an arbitrary JSON payload (optionally with a Federato schema document) to canonical paths. Deterministic first pass: synonym table, fuzzy match, type checks. Exposes a hook for an LLM-assisted second pass supplied by the API layer. | ≥2 fixtures with a different raw schema map correctly. Unknown fields land in `raw` and surface as "unmapped". Federato field names appear only in the synonym table. |
| **normalize** | raw + fieldMap → `CanonicalSubmission` with `self_reported` provenance. Glossary-driven term normalization (TIV, COPE, loss runs). | Same input always yields the same output. |
| **rules** | Rules as data: `{ id, lineOfBusiness, description, when, verdict, citation { doc, section, quote }, premiumAdjustmentPct?, fixHint? }`. Ops: `lt, lte, gt, gte, eq, neq, in, notin, exists, missing`. | Returns `{ verdict, firedRules, undeterminedRules, missingFields }`. Precedence: any DOES_NOT_FIT → DOES_NOT_FIT; else any REFER → REFER; else FIT. Ships `commercial.json` (18–25 rules) and `tenant.json` (12–18 rules), each cited to a section. |
| **voi** | A field is worth asking only if it is unknown, an undetermined rule depends on it, and that rule could still change the final verdict. | Returns the next question and the skipped fields, each with a one-line reason. Stops when nothing can change the verdict. Questions come from `questions/tenant.json` (question, input type, options, accessibility label). |
| **flip** | For non-FIT verdicts, breadth-first search over single-field changes, then pairs, across a discretized domain per field. | Returns the cheapest change set yielding FIT, each change tied to its rule's `fixHint`. Capped at 2 changes. Returns `null` if none exists. |
| **contradiction** | For fields with ≥2 values from different sources, flag disagreement beyond tolerance (numeric per field; exact for booleans and enums). | Outputs `{ field, values, severity, affectedRules }`. HIGH if any rule depends on the field, else LOW. |
| **aggregate** | Portfolio roll-up across submissions. | Counts by verdict, most-fired rules, one-flip-from-FIT list, contradiction counts, agreement rate and disagreement list when fixtures carry `expectedVerdict`. |
| **sweep** | Pure geometry: bearings 0–360, coverage arcs (merge intervals, % covered, largest uncovered gap and its start bearing), object placement `{ label, bearing, distanceBand, confidence }`, relational hazard rules over object pairs. | A `portable_heater` within ±20° and the same or adjacent distance band of `curtain`/`fabric`/`bedding` sets `heaterNearCombustible=true`. Output is canonical `hazards.*` fields with `sweep` provenance. |

**Fixtures:** at least 12 commercial (≥3 with missing fields, ≥3 with self-reported vs enrichment contradictions, ≥2 with a different raw schema) and 6 tenant.

### 6.3 Federato adapter (`packages/federato`)

```ts
interface FederatoAdapter {
  discoverSchema(): Promise<unknown>
  listSubmissions(): Promise<unknown[]>
  getSubmission(id: string): Promise<unknown>
  getGuidelines(): Promise<string>
  getGlossary(): Promise<Record<string, string>>
}
```

- **`HttpFederatoAdapter`** reads `FEDERATO_BASE_URL`, auth settings, and optional path overrides `FEDERATO_SCHEMA_PATH`, `FEDERATO_SUBMISSIONS_PATH`, `FEDERATO_GUIDELINES_PATH`, `FEDERATO_GLOSSARY_PATH` (defaults `/schema`, `/submissions`, `/guidelines`, `/glossary`). Auth is bearer, from either a static `FEDERATO_API_KEY` or an OAuth client-credentials exchange (`FEDERATO_CLIENT_ID`, `FEDERATO_CLIENT_SECRET`, `FEDERATO_TOKEN_URL`, optional `FEDERATO_AUDIENCE`), with the token cached until expiry. Tolerates both `{ data: [...] }` and bare arrays. Logs the first payload's top-level keys at startup.
- **`MockFederatoAdapter`** serves the §6.2 fixtures plus a sample guidelines markdown and glossary written in standard commercial property language (TIV, COPE, protection class, sprinklered, loss runs, occupancy, ISO construction classes 1–6).
- **Selection:** `FEDERATO_BASE_URL` set → HTTP, otherwise Mock. A loud banner at API startup says which is active. Swapping requires zero code changes. Nothing about the real API is asserted as truth in code; it is all env vars plus the adapter.
- **`npm run federato:probe`** hits every adapter method, prints shapes, and writes `packages/federato/probe-output.json`.
- **`npm run federato:compile-guidelines`** sends `getGuidelines()` to the LLM, asks for rules in the §6.2 shape with citations, and writes `rules/commercial.generated.json` and `rules/commercial.review.md` (every rule with its source quote). It never overwrites `commercial.json`; the team promotes manually.

### 6.4 API (`apps/api`)

Hono on Node, `better-sqlite3` + Drizzle, DB file at `apps/api/data/retrofit.db`, CORS open for dev, `PORT` default 3000.

**Tables**

| Table | Columns |
| --- | --- |
| `submissions` | id, source (`federato` \| `sweep`), lineOfBusiness, raw, canonical, verdict, createdAt, updatedAt, shareSlug |
| `sweeps` | id, submissionId (nullable), roomLabel, term, frames, observations, coverage, createdAt |
| `enrichments` | id, submissionId, source, payload, createdAt |

**Endpoints**

| Endpoint | Behaviour |
| --- | --- |
| `POST /ingest/federato` | Pull all submissions via the adapter, discover schema, normalize, store. Idempotent by `externalId`. |
| `GET /submissions` · `GET /submissions/:id` | List with verdict summary; full trace. |
| `POST /submissions/:id/run` · `GET /submissions/:id/flip` | Re-run enrichment and rules; minimal flip. |
| `POST /enrich/:id` | Run enrichment plugins, store results, re-run rules. |
| `POST /sweeps` | Body `{ roomLabel, term, frames: [{ bearing, pitch, imageBase64 }], attachToSubmissionId? }`. Runs the sweep pipeline. With `attachToSubmissionId`, merges sweep-provenance fields into that submission and recomputes contradictions and verdict. Without it, creates a new tenant submission. |
| `GET /sweeps/:id` | Returns current `stage` so the phone can poll (every 800 ms) and drive staged loaders from real progress. |
| `POST /sweeps/:id/answers` | `{ field, value }` applied with `answer` provenance; re-runs rules; returns next VOI question, skipped list, current verdict. |
| `GET /sweeps/:id/next-question` | Next VOI question. |
| `GET /aggregate` | Portfolio roll-up. |
| `GET /s/:shareSlug` | Public JSON for the shareable submission page. |
| `GET /health` | Liveness, plus which adapter is active. |

`npm run seed` ingests from the active adapter and enriches everything.

### 6.5 Enrichment plugins (`apps/api/src/enrich/*`)

Each plugin is `{ name, appliesTo(sub), run(sub) }`, wrapped in try/catch with a 6 s timeout, cached in `enrichments` by (submissionId, source). A failure produces a visible "unavailable" card and never a crash.

| Plugin | Source | Fills |
| --- | --- | --- |
| geocode | Nominatim (proper User-Agent, 1 req/sec) | `lat`, `lng` |
| fire-station-distance | Overpass: nearest `amenity=fire_station` within 10 km, haversine | `fireStationDistanceKm` |
| building-footprint | Overpass: nearest building polygon; `building:levels`, `start_date` | `stories`, `yearBuilt` |
| flood-zone | FEMA NFHL ArcGIS REST (US only; others "n/a (non-US)") | `floodZone` |
| weather-history *(optional)* | Open-Meteo archive, hail/severe wind days in last 3 years | `severeWeatherDays` |
| google-places *(if `GOOGLE_PLACES_API_KEY`)* | Verify business type | reports "not configured" otherwise |

### 6.6 Mobile (`apps/mobile`)

Expo (latest stable SDK), Expo Router, iPhone-first, must run in Expo Go. Libraries: `expo-camera`, `expo-sensors`, `expo-haptics`, `expo-location`, `react-native-reanimated`, `@shopify/react-native-skia`, `expo-gl` + `three` + `@react-three/fiber/native`, Fraunces and Inter via `@expo-google-fonts`, `expo-image`, optionally `moti`. Any library that fails in Expo Go on iOS is replaced and logged in `DECISIONS.md`.

| Route | Screen |
| --- | --- |
| `/` | Home: rooms/submissions list, skeleton cards, big red "New sweep" button |
| `/new` | Room label, term (4/8/12 months), optional "attach to submission" picker (the bridge) |
| `/sweep` | Full-screen camera with scan dome overlay, coverage % in large Fraunces, directional hint ("Turn right — 120° unscanned"), progress bar. Auto-captures every ~1.2 s once heading has advanced ≥10°; cap 15 frames; haptic tick per capture. "Finish" enabled at ≥75% coverage; auto-advance at 100%. |
| `/analyzing` | Three staged loaders ("Reading the room", "Checking relationships", "Running appetite") driven by real pipeline stages. Never a blank spinner. |
| `/confirm` | Low-confidence pins on a 2D Skia radar ring with confirm/dismiss chips. Skippable. |
| `/questions` | One question at a time, chat-style, input matched to type, persistent "Questions skipped: N" counter that expands to the reason list. |
| `/verdict` | Big Fraunces verdict word, pill state, estimate, the deciding rule with citation, minimal flip ("Fix this and you fit"), red **Next step** button opening a sheet (Continue to quote / Send to my landlord / Save). Single haptic on reveal. |
| `/hazard/[id]` | Photo crop from the frame at that bearing, what/why, "If fixed → verdict becomes X". |
| `/s/[slug]` | Shareable submission page; also renders on web. |

**Scan dome (`components/ScanDome.tsx`).** Transparent GL view over the camera. A cylinder around the viewer (radius 3, height 2.4) in 36 panels of 10°, optional upper ring for pitch > 25°. Camera rotation follows device heading and pitch through an exponential filter, tolerating ±15° noise. Panels start Muted tint at 35% opacity and animate to Red at 70% over 250 ms when scanned. After analysis, hazards render as red spheres with labels; tap opens `/hazard/[id]`.
**Time box: 45 minutes.** If the dome is not rendering on the iPhone by then, fall back to `components/ScanRing.tsx` (2D Skia radar ring) and log it. The ring is required regardless, for `/confirm`.

**Networking.** Base URL from `EXPO_PUBLIC_API_URL`. Retry with backoff. Offline: queue the sweep and show "Waiting for connection". If camera capture fails, allow picking 3 library photos assigned bearings 0/120/240.

### 6.7 Console (`apps/console`)

Vite + React + TypeScript + React Router, same design tokens.

| Route | Content |
| --- | --- |
| `/queue` | Table: id, insured, LOB, verdict pill, contradictions count, "1 flip from FIT" badge, source, updated. Sorted by distance to appetite (0 = FIT, 1 = one flip, 2 = two flips, 3 = none). Filters. Skeleton rows. |
| `/submissions/:id` | (a) Discovered schema (b) Enrichment cards (c) Contradictions, red outline for HIGH (d) Appetite: verdict pill, fired rules with citation and expandable quote, undetermined rules, missing fields (e) Minimal flip (f) Sweep panel if attached: SVG twin of the radar ring, pins, frames strip (g) "Re-run" and "Attach sweep" (QR/link to `/new?attach=:id`) |
| `/rules` | Read-only rule cards grouped by section with citation and quote. Links `commercial.review.md` if present. |
| `/glossary` | Searchable terms; also powers tooltips in the trace. |
| `/aggregate` | KPI tiles, agreement rate, disagreements table, all with skeletons. |
| Header | Banner showing the active Federato adapter (Mock vs HTTP). Never hidden. |

### 6.8 Design system (`packages/design`)

| Token | Value |
| --- | --- |
| Paper (background) | `#FAF8F2` |
| Ink (text) | `#1F1E1B` |
| Red (accent; placeholder until Intact's exact red is confirmed) | `#E4002B` |
| Red deep / Red tint | `#B80022` / `#FBE3E6` |
| Muted / Muted deep / Muted tint | `#7C8073` / `#5E6357` / `#EDEFE8` |
| Type | Fraunces (display, verdict), Inter (body). Scale 34/28/22/17/15/13. Line-height 1.3 display, 1.5 body. |
| Layout | 4-pt grid. Radius 16 cards, 999 pills. No shadows; 1 px Muted-tint borders. |

- **Red never means "bad".** FIT = red filled pill, REFER = red outlined pill, DOES_NOT_FIT = ink filled pill. Hazard severity is pin size, not colour.
- **Accessibility.** Colour never carries meaning alone. Every interactive element has `accessibilityLabel` and `accessibilityRole`. Dynamic type supported. Minimum touch target 44 pt.
- **Motion.** Skeleton loaders (paper base, muted-tint shimmer) for every list and card. Reanimated springs for card entry, 200–300 ms, no double bounce.

## 7. Technical constraints

- **Repo:** npm workspaces monorepo (`apps/*`, `packages/*`). No pnpm.
- **Language:** TypeScript everywhere. No Python. Node 20+, npm 10+.
- **Build machine:** macOS. All scripts go through `npm run ...` and stay cross-platform where that is free, but Windows is not a target. `npm run dev` runs api + console concurrently; `npm run mobile` runs `expo start`.
- **Data:** no Docker. File-based SQLite.
- **Mobile:** Expo Go on a physical iPhone is the primary target. The iOS Simulator has no camera, so it is used only for layout and navigation, with the photo-picker fallback standing in for the sweep. Android is untested. EAS config, if added, is optional and documented.
- **iOS specifics:** camera, motion, and location permission strings in `app.json`. Heading comes from `expo-location`'s `watchHeadingAsync` (true/magnetic heading) with `DeviceMotion` for pitch. The API must be reached over HTTPS or the local network; the tunnel gives HTTPS.
- **Network:** the phone reaches the backend through a tunnel (`npx cloudflared tunnel --url http://localhost:3000` or `npx localtunnel --port 3000`).
- **Versions:** pick a stable set and stay on it. No major-version changes to chase a bug.
- **Testing:** vitest for every engine module. One Maestro smoke flow if time allows; never a blocker.

## 8. LLM layer — Gemini *(amended from the build prompt)*

The build prompt specifies Anthropic. **Retrofit uses Gemini instead.** Everything else about the LLM design is unchanged: narrow calls, code does the rest, the model never decides a verdict or a dollar amount.

| Item | Build prompt | This PRD |
| --- | --- | --- |
| SDK | `@anthropic-ai/sdk` | `@google/genai` |
| Env var | `ANTHROPIC_API_KEY` | `GEMINI_API_KEY` |
| Vision/reasoning model | `claude-sonnet-5` | `gemini-3.6-flash`, falling through to `gemini-3.8-flash` then `gemini-3.5-flash` on 429/500/503 (the chain the Room Sweep prototype already uses) |
| Narration model | `claude-haiku-4-5` | Same Flash chain (short prompt, low cost) |
| JSON handling | Ask for JSON, strip fences, zod-validate, retry once | Enforced `responseSchema` + `responseMimeType: application/json`, then zod-validate, retry once, then degrade gracefully |

- All LLM code lives in `apps/api/src/llm/` behind a small provider interface (`generateJson({ prompt, images?, schema })`), so the provider can be swapped again without touching the pipeline.
- The key lives **only** in the repo-root `.env` (git-ignored), which the API and the federato scripts load. It is never shipped to the phone or console (the prototype's client-side key is not carried over). `.env.example` lists `GEMINI_API_KEY=` empty.
- If `GEMINI_API_KEY` is unset, the API starts anyway, prints a banner, and the sweep pipeline falls back to the seeded "cached run" so the console path and demo still work.

**The five permitted calls**

| Call | Input | Output |
| --- | --- | --- |
| **observe** | Up to 15 frames (max 1024 px, JPEG q=0.7), each tagged with bearing, in one batched request | Per frame `[{ label, category, bearing, distanceBand, confidence, notes }]` from a fixed vocabulary: `portable_heater, extension_cord, power_bar, outlet, curtain, fabric, bedding, smoke_detector, sprinkler_head, window_ac_unit, stove, candle, bike, jewelry, camera, laptop, tv, instrument, blocked_exit, water_heater, unknown`. Code dedupes across frames (same label within ±15° → merge, keep max confidence). |
| **relate** | The merged observation list, no images | Relational hazards with reasoning and confidence, restricted to `hazards.*`. The engine's `sweep` rules run first; this call only adds or adjusts confidence and never removes a code-derived hazard. |
| **narrate** | Verdict, fired rules, flip | One or two sentences for the verdict card and one per hazard pin, each under 20 words. |
| **schema-assist** | Unmapped raw keys, sample values, canonical field list | Mapping with confidence. Accepted only at ≥0.8; everything else stays unmapped and visible. |
| **compile-guidelines** *(offline script)* | Guidelines text | Draft rules with citations for human review (§6.3). |

Observations under 0.6 confidence go back to the app for confirm/dismiss before rules run.

## 9. Build process and deliverables

A single ~5 hour autonomous run with parallel subagents. It does not wait for human input: unknowns are decided and logged in `DECISIONS.md`. Plan first (10 minutes max) into `PLAN.md`.

| Workstream | Window | Scope |
| --- | --- | --- |
| A — engine + federato | 0–2 h | Types, 8 modules with tests, fixtures, mock + HTTP adapters, sample guidelines and glossary, probe and compile scripts |
| B — api | 0.5–3 h | Hono app, Drizzle schema, endpoints, enrichment plugins, sweep pipeline, seed, schema-assist |
| C — mobile | 0.5–3.5 h | Scaffold, tokens, fonts, screens, capture loop, scan dome (45-min box, then ring), skeletons, networking |
| D — console | 1.5–3.5 h | Vite app, pages, tokens, skeletons, adapter banner |
| Integration | 3.5–4.5 h | End to end on the iPhone in Expo Go (Simulator for non-camera screens); fix what breaks; Maestro flow if time remains |
| Wrap-up | 4.5–5 h | README, DEMO.md, DECISIONS.md, STATUS.md, `.env.example`, final commit |

**Rules:** init git first and commit every ~20 minutes. Never spend more than 30 minutes on one blocker: stub it, mark `// TODO(blocked): ...`, log it in STATUS.md, move on. At 5 hours, stop and write STATUS.md (what runs end to end, what is stubbed, exact commands, known bugs, prioritized next steps).

**Documents**

- **README.md**, in order: what Retrofit is and the pitch line · **Intact section** with headings *The problem*, *How AI is used*, *User journey and key features*, *Assumptions, limitations, and future improvements* (car insurance, iOS universal links, EAS build, real premium rating) · **Federato section** (ingestion, schema discovery, enrichment sources, rule representation and citation, contradiction detection, sweep as physical enrichment, Mock → HTTP switch, compiling and reviewing guidelines) · architecture diagram and repo map · macOS setup · accessibility notes · the retro.fit domain.
- **DEMO.md**, three beats:
  1. **Console (Federato).** Open `/queue` sorted by distance to appetite. Open a submission stuck at REFER because "sprinklered: yes — source: broker" is unverified. Show discovered schema, enrichment cards, one contradiction already flagged from public records.
  2. **Phone (bridge).** "Retrofit sends the insured a link. They sweep." `/new?attach=:id` → sweep → the console updates: a HIGH contradiction fires (broker: no portable heating; sweep: heater at 40°), the rule re-fires with its citation, the verdict moves, the minimal flip appears.
  3. **Phone (Intact).** "Same sweep, no broker. For a renter it's the whole application." New room → sweep → two questions with the skipped counter → verdict, estimate, Next step.
  Includes exact run commands and the seeded "cached run" fallback in case venue wifi dies.

## 10. Definition of done

- `npm test` passes in `packages/engine`.
- `npm run seed` ingests mock (or real, if env is set) submissions, enriches them, and stores verdicts.
- Console shows queue, a full trace (schema, enrichment, contradictions, appetite, flip), rules, glossary, aggregate.
- Mobile in Expo Go on an iPhone: New room → Sweep with visible coverage feedback → Analyzing (staged) → Confirm → Questions with skipped counter → Verdict with next step, against the local API.
- Attaching a sweep to a Federato submission updates that submission's contradictions and verdict, visible in the console.
- README, DEMO.md, DECISIONS.md, STATUS.md written.
- **Invariants:** same submission and rulebook always yield the same verdict; every verdict names its deciding rule with document, section, and quote; the LLM never decides a verdict or a dollar amount.

## 11. Prior art in this repo

The parent folder holds a working **Room Sweep** prototype: a no-build web app that captures 20 frames from one sweep and sends them to Gemini in a single request with an enforced `responseSchema`. Retrofit keeps three things from it:

- **Multi-frame, single request**, so the model can find hazards that exist only as a relationship between frames.
- **The model never returns a dollar amount.** In Retrofit this goes further: the model returns observations, the `sweep` module derives hazards, and the `rules` module derives verdict and premium adjustment.
- **The Gemini model fallback chain** for overloaded models, and enforced structured output.

It drops one thing: the client-side API key.

## 12. Risks

| Risk | Mitigation |
| --- | --- |
| Federato API or guidelines are unavailable or differ from expectations | Mock adapter and hand-written rulebook are first-class; probe script shows real shapes fast; all paths are env vars |
| Heading from the magnetometer is noisy in Expo Go | Exponential filter, ±15° tolerance, 10° panels, relational rules at ±20° |
| GL dome fails in Expo Go on iOS | 45-minute time box, then the Skia ring, which is needed anyway |
| Gemini latency, overload, or bad JSON on a 15-frame request | Downscaled frames, model fallback chain, enforced schema, one retry, graceful degrade, seeded cached run |
| Venue wifi dies during the demo | Seeded sweep fallback documented in DEMO.md |
| Public enrichment APIs rate-limit or time out | 6 s timeout, per-source cache, visible "unavailable" cards |
| The orchestrating agent cannot drive a physical iPhone | Agents verify the API, console, and engine directly, and the mobile app via typecheck, `expo-doctor`, and the Simulator; the camera sweep is verified by a human on the phone, with a checklist in STATUS.md |
| The bridge is cut for time | It ranks third; the engine supports multi-source fields from day one, so the bridge is a thin endpoint and UI layer |

## 13. Alignment with Federato's challenge docs *(added v0.4; overrides §6.3 and parts of §6.2, §6.7, §9 where they conflict)*

Federato's official package is in `docs/federato/` (six PDFs plus `live-schema.json`, pulled from the live API on 2026-09-19). The credentials work. The build prompt was written before these docs existed and guessed at the API. Several guesses were wrong.

### 13.1 What Federato actually asks for

An **AI underwriting agent** that (1) scores each submission against the appetite guidelines, (2) **reasons about which data to request from the API**, (3) ranks the queue, and (4) explains every decision in plain English. Their stated priority order is: agentic reasoning, then explanations, then UI polish. Their named pitfalls include hardcoded queries, over-investing in enrichment, and UI over reasoning. Enrichment is optional. Any LLM is allowed.

### 13.2 Facts about the real API

| Topic | Reality |
| --- | --- |
| Auth | Auth0 client credentials. Token URL `https://auth.product.federato.ai/oauth/token`, audience `https://product.federato.ai/core-api`. Tokens last 4 hours; the adapter must re-mint. |
| Endpoint | One URL: `POST https://product.federato.ai/integrations-api/handlers/federato-hack-north?outputOnly=true` with `{ action: "schema" \| "query", payload }`. There are no `/schema`, `/submissions`, `/guidelines`, `/glossary` paths. |
| Envelope | Observed: responses arrive as `{ output: [ { data } ] }` with HTTP 201 even with `outputOnly=true`. The adapter unwraps both shapes. |
| Guidelines, glossary | PDFs, not endpoints. Transcribed into `packages/federato/reference/` as markdown and JSON. |
| Data | Relational, 12 resources: Submission (158), Policy (113), Insured (30), Location (70), Building (129), Claim (179), plus Broker, Contact, Coverage, Endorsement, Underwriter, ExposureUnit. References hold ids and need `$expand`. Dot-paths do not traverse arrays; use `$elemMatch`. |
| Lines of business | 38 property, 36 health, 21 cgl, 20 auto, 18 cyber, 15 excess, 10 lpl. Only property is in appetite. |
| Where the appetite fields live | `business_type`, `premium`, `line_of_business` on Policy; state on Location; `tiv`, `year_built`, `construction_type`, `sprinklered` on Building; loss value from Claim (`paid_indemnity`, `paid_expense`, reserves). Verified for property: 38 property submissions, 27 property policies, 11 submissions with no Policy (4 lost, 3 cleared, 3 quoted, 1 declined). Those 11 have no premium, business type, or buildings, so they score as REFER with missing data. |
| Errors | Plain message strings with a `[CODE]` prefix; parse the prefix. |

### 13.3 What changes in Retrofit

| # | Gap | Change |
| --- | --- | --- |
| 1 | **No query-reasoning layer.** The build prompt pulls everything through a flat `listSubmissions()` and forbids agent loops. This is the part Federato grades hardest. | Add `packages/federato/planner`: reads the live schema plus the rulebook's required fields, walks the reference graph to find where each field lives, and emits queries (`select`, `$expand`, `where`, `$elemMatch`, aggregations). Every query carries a recorded reason ("rule R4 needs building year; Building is reachable via Policy → exposure_units → location → buildings"). Deterministic core, with one optional Gemini call to resolve field names the synonym table cannot. It adapts: a cheap first pass over all 158 to knock out non-property and wrong-state submissions, then a deep expansion only for survivors. |
| 2 | **Adapter interface is the wrong shape.** | `FederatoAdapter` becomes `getSchema()`, `query(payload)`, `getGuidelines()`, `getGlossary()` (the last two read local reference files). OAuth with token cache and refresh. Env: `FEDERATO_BASE_URL`, `FEDERATO_TOKEN_URL`, `FEDERATO_AUDIENCE`, `FEDERATO_CLIENT_ID`, `FEDERATO_CLIENT_SECRET`. The Mock adapter implements the same `query` contract over a snapshot of the real data, so it doubles as the wifi-failure fallback. |
| 3 | **Schema discovery means graph discovery**, not flat key matching. | `fieldMap` values become resource paths (`Policy.exposure_units[].location.buildings[].year_built`). The synonym table stays the only place field names appear. |
| 4 | **One submission has many buildings.** | `normalize` gains roll-ups: total TIV (sum), oldest `year_built`, construction share by TIV (the guideline says ">50%"), five-year loss total. Each roll-up records which buildings drove it. |
| 5 | **Federato wants a score and a ranked queue**, and the guidelines have three tiers (Acceptable, Target, Not Acceptable). The build prompt has verdicts only. | Keep FIT / REFER / DOES_NOT_FIT. Add a 0–100 score: any Not Acceptable factor → DOES_NOT_FIT; each Acceptable factor earns points, Target earns more; missing required data → REFER. `/queue` sorts by score, then by distance to appetite. Rules gain an optional `tier` and `weight`. |
| 6 | **The real guidelines are 8 factors**, not the 18–25 rule sample the prompt invented. | `commercial.json` is built from the real table (about 18 rules across tiers), each cited to the PDF's row. Rules the guidelines do not contain (sprinklered, protection class, hazard tags, portable heating) move to a separate, clearly labelled **Retrofit extension** rulebook. They affect REFER and contradictions but never the Federato score, so the score stays defensible against the source document. |
| 7 | **Explanations are graded.** | Every submission gets a 2–3 sentence explanation: appetite match, key factors, recommendation (accept / review / decline / investigate). Built from a deterministic template over fired rules so all 158 have one instantly; Gemini polishes wording only for the opened submission. Contradictory submissions say so explicitly. |
| 8 | **The console needs a reasoning trace.** | `/submissions/:id` gains a "How the agent got here" panel: the queries run, why each was chosen, what came back. `/queue` shows rank and score. |
| 9 | **Enrichment is over-scoped.** Locations already carry latitude and longitude. | Cut to two plugins: flood zone (OpenFEMA) and one of fire-station distance or weather history. Geocode only when coordinates are missing. Enrichment must visibly move a score or raise a contradiction, or it is dropped. |
| 10 | **The bridge still fits, with one correction.** | `Building.sprinklered` is a real broker-reported field a sweep can contradict, so demo beats 1 and 2 stand on a real property submission. `Location.hazard_tags` turned out to be catastrophe perils (flood, wildfire, hail, tornado, earthquake), not room hazards, so a camera cannot contradict it. The build prompt's "broker said no portable heating" contradiction has no real field behind it. In the bridge demo, heater and wiring findings are presented as *new* sweep-only facts that fire extension rules, and only sprinklers are presented as a contradiction. |
| 11 | **Build order.** The prompt gives the console and mobile most of the hours. | Reorder: planner + real rulebook + scoring + explanations first, console second, mobile third, extra enrichment last. |

### 13.4 Query language, as the planner must use it

Mongo-flavoured. Pipeline order: `where` (raw records) → `expand` (hydrate references) → `unwind` (fan arrays into rows) → `filter` (hydrated rows) → `over` (group) → `select` (paths, `$expand` leaves, reductions) → `sort` → `pagination`. Operators: `$eq $ne $exists $gt $gte $lt $lte $in $nin $contains $elemMatch`, combinators `$and $or $not`. Reductions: `$sum $avg $min $max $count $countDistinct`. `total` reports all matches regardless of pagination. Use the `expand` stage when a later stage needs the reference, and the `$expand` leaf when it is only wanted in the output.

The planner's two core queries:

1. **Triage** (cheap, all lines): `Submission` selecting id, status, and line_of_business. Knocks out 120 of 158 on line of business alone, with the reason recorded.
2. **Deep** (property only): `Policy` `where { line_of_business: "property" }`, `expand { insured, claims, exposure_units: { location: { buildings } } }`. Verified live: returns all 27 property policies fully hydrated in one call.

### 13.5 What the real data looks like (27 property policies, checked 2026-09-19)

- 20 new business, 7 renewal. Renewal is Not Acceptable, so 7 fail on the first factor.
- Most policies span several states (one covers AZ, CA, FL, WA). The guideline says "primary risk state" and no such field exists. **Decision:** primary state is the state carrying the largest share of TIV; the explanation names it and lists the others.
- Most policies include a building older than 1990 (oldest seen: 1951). Judging by the oldest building declines nearly everything. **Decision:** mirror the wording of the construction factor: Not Acceptable when more than 50% of TIV sits in pre-1990 buildings, REFER when any building is pre-1990, and name the buildings.
- Premiums on the larger accounts run far above the $175K ceiling (up to $703K). Only 4 of 27 pass new business + premium + TIV together, before state, age, construction, and losses are applied. Expect very few FIT. Ranking, score, and minimal flip are therefore the useful outputs, not the verdict alone.
- Construction is one of eight strings: Fire Resistive, Modified Fire Resistive, Masonry Non-Combustible, Non-Combustible, Steel Frame, Joisted Masonry, Frame, Wood Frame. The guideline accepts JM, non-combustible/steel, and masonry non-combustible. Fire Resistive is a better class than all of those but is not listed. **Decision:** treat it as acceptable and flag the assumption in the explanation.
- Loss value is computed from Claims (paid indemnity + paid expense, plus reserves on open claims) over five years.

Each decision above interprets an ambiguous guideline. They are shown on the console's rule cards, so a judge sees that the agent noticed the ambiguity.

### 13.6 Unchanged

The canonical object with provenance, contradiction detection, minimal flip, VOI questions, the sweep pipeline, the mobile app, the design system, and everything on the Intact side. Federato's docs say nothing about those.

## 14. Architecture revision *(added v0.6; overrides earlier sections where they conflict)*

### 14.1 Principle: the engine is arithmetic

The engine is fully deterministic. Every output is a number or is derived from numbers by a fixed formula. No LLM output enters the engine except as a typed observation with a confidence number, and the engine treats that like any other measured input.

| Output | How it is computed |
| --- | --- |
| **Appetite score (0–100)** | Eight factors from Federato's table. Each factor scores 0 (Not Acceptable), 60 (Acceptable), or 100 (Target), times a fixed weight. Weights sum to 1 and live in the rulebook file. Any Not Acceptable factor also sets a knockout flag. |
| **Verdict** | Derived from the numbers: knockout → DOES_NOT_FIT; no knockout but completeness < 100% or an open HIGH contradiction → REFER; otherwise FIT. |
| **Data completeness (%)** | Required fields present ÷ required fields. |
| **Confidence (0–1)** | Product of source confidences for the fields the deciding rules used. Broker-typed = 0.7, public record = 0.9, camera = the model's confidence, user answer = 0.8. Fixed table. |
| **Distance to appetite** | Number of field changes in the minimal flip (0, 1, 2, or none). |
| **Predicted premium** | §14.5. |
| **Expected annual loss** | §14.5. |
| **Quality rank** | §14.6. |

### 14.2 Engine stages: what goes in, what comes out

Each stage is a pure function. Its output type is the next stage's input type, and each is testable on its own.

| # | Stage | Input | Output |
| --- | --- | --- | --- |
| 1 | discover | raw records + schema document | `fieldMap` (raw path → canonical path, with match confidence) |
| 2 | normalize | raw records + `fieldMap` | `CanonicalSubmission` (values with provenance) |
| 3 | rollup | `CanonicalSubmission` with many buildings and claims | same object plus derived numbers: total TIV, % TIV pre-1990, % TIV by construction class, primary state by TIV share, 5-year loss total, claim count |
| 4 | merge | canonical + enrichment values + sweep observations + answers | same object, fields now holding several sourced values |
| 5 | contradict | merged object + rulebook | `Contradiction[]` with severity |
| 6 | evaluate | merged object + rulebook | factor scores, knockouts, fired rules, undetermined rules, missing fields, completeness, confidence |
| 7 | price | merged object + evaluate output + rating table | predicted premium, expected annual loss, the factor-by-factor breakdown |
| 8 | verdict | outputs of 5, 6 | FIT / REFER / DOES_NOT_FIT + deciding rule |
| 9 | flip | merged object + rulebook + verdict | minimal change set, and the score and premium after the change |
| 10 | voi | merged object + undetermined rules | next question + skipped list |
| 11 | rank | all evaluated submissions | ordered queue with quality rank |

A single `runEngine(input, rulebook, ratingTable)` composes 3–10 and returns one `EngineResult`. The server stores that object as-is; both apps render from it.

### 14.3 Phone camera: image quality, then Gemini

**Quality gate (deterministic, server-side, before any Gemini call).** Using `sharp`: blur (variance of Laplacian), mean brightness, clipped-pixel share, resolution, and duplicate detection by perceptual hash against the previous frame. Each frame gets a 0–1 quality number. Frames under threshold are dropped; if too few remain, or sweep coverage is under 75%, the app asks for a re-sweep of the named arc. Gemini also returns a per-frame `usable` flag and reason (the prototype showed it correctly refusing frames that were photos of a screen); a frame must pass both.

**Gemini ideas beyond listing objects, ranked by demo value for effort:**

1. **Verify the fix.** After the verdict says "move the heater and you fit", the renter re-photographs that spot. Gemini confirms the hazard is gone, the engine re-runs, and the price drops on screen. This closes the loop the minimal flip opens, and nobody else will have it.
2. **Bounding boxes.** Ask Gemini for a box per detected object. Code crops the frame for the hazard detail screen. Replaces guesswork about where in the photo the hazard is.
3. **Read the label.** Manufacture dates on water heaters and smoke detectors, extinguisher expiry. A photographed date is a number, which suits the engine.
4. **Self-consistency as a confidence number.** Run `observe` twice with frame order shuffled. Objects found in both runs keep their confidence; objects found once are halved. Turns model flakiness into a measured quantity.
5. **Negative evidence done properly.** "No smoke detector" only counts if Gemini reports the ceiling was visible in enough frames. Otherwise the field stays unknown and becomes a question.
6. **Contents inventory.** Item list with replacement-value ranges, summed by code into a suggested contents limit (carried over from the prototype).
7. **Exterior photo for commercial.** One photo of the building estimates stories and construction class, checked against `Building.stories` and `construction_type`. This is a better bridge to Federato's data than a room sweep, because those fields exist in their schema and feed their rules.
8. **Tamper checks.** Flag photos of screens, repeated frames, and mismatched lighting across a sweep.

Build 1, 2, and 5. Add 7 if the bridge survives.

### 14.4 How Federato's data is formatted

JSON over one POST endpoint. Twelve tables that point at each other by numeric id:

```
Submission ──► Insured ──► hq Location
     ▲
     │ (Policy.submission)
   Policy ──► claims[]          ──► Claim (paid_indemnity, paid_expense, reserves, date_of_loss, cause_of_loss)
          ──► exposure_units[]  ──► ExposureUnit ──► Location (state, lat/long, hazard_tags[], protection_class)
          ──► coverages[]                                └──► buildings[] ──► Building (tiv, year_built,
          ──► producer.broker                                  construction_type, sprinklered, stories, roof_year, sqft)
```

A raw Policy holds ids (`"claims": [1, 2]`, `"insured": 1`); asking for `expand` swaps ids for full records. Query results arrive as `{ total, results: [...], resource }`, wrapped in `{ output: [ { data } ] }`. Money is plain numbers in USD. Dates are `YYYY-MM-DD` strings. Missing values are `null`. One property policy typically covers 2–9 buildings across 1–4 states, which is why the rollup stage exists.

### 14.5 Predicted payment (both front doors)

Two numbers each, both from fixed formulas.

**Commercial (Federato).** Real data supports this: across the 27 property policies the rate runs $0.23–$0.66 per $100 of TIV (median $0.40), premium tracks TIV with R² = 0.72, and the book's `premium ÷ technical_premium` runs 0.93–1.21 (median 1.05).
- **Predicted premium** = Σ over buildings of `tiv ÷ 100 × base rate × construction factor × age factor × protection-class factor × sprinkler factor`, then × a loss-history factor. Factors are fitted once by least squares on the real policies against `technical_premium`, then frozen into `rating/commercial.json`. With 27 policies the fit is thin, so factors are constrained to be monotonic (worse class never cheaper) and the fit's error is reported, not hidden.
- **Price adequacy** = quoted `premium` ÷ predicted premium. Under 0.9 means the account is underpriced for its risk. This is a number underwriters use daily and it feeds the quality rank.
- **Expected annual loss** = claim frequency × mean severity from the account's own five years, blended with the book average by a credibility weight `n ÷ (n + k)`.

**Tenant (Intact).** No loss data exists, so this is a transparent rating table, labelled "estimate": `base monthly rate × contents-limit factor × building-age factor × Π hazard factors`. Each hazard's factor is in `rating/tenant.json`. The verdict screen shows the breakdown, so "fix this and save $6/month" is a subtraction the user can check.

### 14.6 Final output for Federato: a quality ranking

The console's main view becomes a ranked list. **Quality index (0–100)** = 0.50 × appetite score + 0.20 × price adequacy (scaled) + 0.15 × (1 − expected loss ratio, scaled) + 0.10 × completeness + 0.05 × confidence. Knockouts are ranked below all non-knockouts regardless of index, ordered by distance to appetite. Weights live in config and are shown on screen. Each row shows rank, index, verdict, predicted vs quoted premium, and a 2–3 sentence explanation; the detail page shows every component number and the query trace.

### 14.7 Server

Thin. Routes call the adapter, Gemini, and `runEngine`, and store the result. No business logic in route handlers. SQLite, three tables.

### 14.8 Verification plan

Three layers, because they answer different questions.

| Layer | Volume | Question it answers | Oracle |
| --- | --- | --- | --- |
| **A. Property tests** | **10 million** generated submissions | Does the engine obey its own laws? | Invariants: same input → same output; improving any factor never lowers the score; a knockout always yields DOES_NOT_FIT; applying the returned flip always yields FIT; premium is monotonic in each factor; completeness and confidence stay in range; no crashes on nulls, empty arrays, or absurd values. |
| **B. Differential test** | the same 10 million | Is the arithmetic right? | A second, deliberately naive implementation of the eight factors (a flat function of if-statements written straight from the PDF table, by a different agent, sharing no code). Any disagreement is a bug in one of them. |
| **C. LLM second opinion** | all 38 real property submissions + ~2,000 generated ones, stratified so every factor boundary and every ambiguity is over-sampled | Would a careful reader of the guidelines reach the same verdict? | Claude (or Gemini if the Claude key is still unscoped) is given the guideline text and the rolled-up facts, returns verdict + the factor it thinks decided. |

Layers A and B run locally in minutes (the engine is pure and takes microseconds per case; the run is seeded and parallelised across cores) and go in CI at a reduced count.

**Why layer C is not 10 million.** Ten million LLM calls at even a tenth of a cent each is $10,000, and at normal rate limits would take days; the hackathon is 36 hours. It would also prove little: past a few thousand stratified cases the agreement rate stops moving. And the LLM is the less reliable party here. When it disagrees with the engine, that is a lead to investigate, not proof the engine is wrong. Expect disagreements to cluster on the three known ambiguities (primary state, building age across many buildings, Fire Resistive construction); that finding is itself worth showing judges.

Output of all three: `VERIFICATION.md` with counts, agreement rate with a confidence interval, and every layer-C disagreement listed with both sides' reasoning. The console's `/aggregate` page shows the headline numbers.

## 15. Open questions

1. **Gemini key.** Resolved. In the root `.env`; verified against `gemini-3.6-flash` on 2026-09-19.
2. **Provider.** Resolved: Gemini, confirmed by Caleb. The provider interface in §8 keeps a swap cheap if prize rules ever require it.
3. **Dev platform.** Resolved: build on Mac, run on iPhone.
4. **Federato access.** Resolved. URLs, audience, and credentials are in `.env`; token mint, schema, and queries verified live on 2026-09-19.
5. **Estimate formula.** Assumed: base rate from `tenant.json`, fired rules' `premiumAdjustmentPct` summed additively, scaled by term.
6. **Intact red.** `#E4002B` is a placeholder until the exact brand red is confirmed.
7. **Claude key for verification layer C.** The Anthropic key on file returns 400 (not scoped to a workspace). Needs a workspace-scoped key, or layer C runs on Gemini.
8. **Quality-index weights.** The 50/20/15/10/5 split in §14.6 is a starting point, not derived from anything.
