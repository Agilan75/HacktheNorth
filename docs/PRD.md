# Retrofit — Product Requirements Document

**Version 1.2 · 2026-09-19 · Hack the North 2026**

This is the single source of truth. It replaces the Master Build Prompt and the working draft (`archive/PRD-v0.6-working-draft.md`). Federato's official docs are in `docs/federato/`.

---

## 1. Summary

Retrofit is one deterministic underwriting engine with two front doors.

- **The engine** takes facts about a risk and returns numbers: an appetite score, a predicted premium, an expected loss, data completeness, and confidence. A verdict (`FIT` / `REFER` / `DOES_NOT_FIT`) is derived from those numbers, with the deciding rule cited to the carrier's guidelines and the smallest change that would reach FIT.
- **Front door 1, the underwriter console (Federato prize).** An agent reasons about which data to pull from Federato's API, scores every submission against Federato's appetite guidelines, and shows a quality-ranked queue with a plain-English explanation for each.
- **Front door 2, the renter phone app (Intact prize).** A renter sweeps their room with the camera. Gemini lists what it sees, code turns that into hazards, and the same engine returns a tenant insurance verdict, a price estimate, and what to fix.
- **The action loop (Rox prize).** The agent does not stop at a ranking. It routes each live account to an underwriter with the authority to write it, drafts the exact information request to the broker, reads the broker's free-text reply back into typed fields, re-scores, and logs what changed.
- **The bridge (optional, last).** A photo or sweep can be attached to a Federato submission to check a broker-reported fact, such as sprinklers.

> *"Underwriting runs on what the broker typed. We built the camera that checks."*

## 2. Problem

1. **Triage is manual.** Underwriters check hundreds of submissions by hand against appetite guidelines.
2. **Verdicts are opaque.** A declined broker rarely learns which rule decided it or what would change the outcome.
3. **Inputs are unverified.** Brokers type "sprinklered: yes" and the carrier prices on it.
4. **Renters get quotes from forms that never look at the room**, so the hazards that drive losses are invisible to pricing and to the renter.

## 3. Goals, non-goals, priorities

### Goals

| # | Goal | Prize |
| --- | --- | --- |
| G1 | The agent decides which queries to run against Federato's API from the live schema and the rulebook, and records why | Federato |
| G2 | Every submission gets a numeric score, a quality rank, a predicted premium, and a 2–3 sentence explanation with a recommendation | Federato |
| G3 | Ambiguities and contradictions in the data or the guidelines are shown, not hidden | Federato |
| G4 | Every non-FIT result includes the minimal change that reaches FIT, with the new score and price | Both |
| G5 | A renter completes a sweep and receives a verdict, a price estimate, and a fix | Intact |
| G6 | The engine's numbers are verified by 10 million generated tests, a second implementation, and an LLM second opinion | Both |
| G7 | The agent acts on its findings: routes, requests missing or contradicted data, ingests unstructured replies, and re-scores, with every action logged | Rox, Federato |

### Non-goals

Binding or payments. Actuarially certified pricing. Authentication or multi-carrier support. Custom native modules or a required EAS build. Nested boolean logic in rules. An LLM deciding any verdict, score, or dollar amount.

### Priority order

1. Engine + Federato agent + scoring, ranking, explanations.
2. Server and console.
3. Verification.
4. Phone app. **Deferred to phase 2**; its on-device demo happens after phase 1 ships.
5. The bridge and extra enrichment.

Federato's own guidance ranks agentic reasoning first, explanations second, UI polish third, and calls enrichment optional. This order follows that.

## 4. Users

| User | Needs |
| --- | --- |
| **Commercial underwriter** | A ranked queue, a trusted score, the reason, and what is missing or contradicted |
| **Renter** | A quote in under a minute, without a long form, and a clear fix |
| **Broker** (indirect) | The smallest change that gets a declined risk accepted |
| **Judge** | To see the agent think, and to see one engine serve both prizes |

## 5. Architecture

```
   FEDERATO API                                     IPHONE (Expo Go)
        │                                                 │
        ▼                                                 ▼
┌──────────────────┐                            ┌──────────────────┐
│ packages/federato│                            │   apps/mobile    │
│ adapter + planner│                            │  sweep → frames  │
└────────┬─────────┘                            └────────┬─────────┘
         │ records + query trace                         │ photos + bearings
         ▼                                               ▼
┌────────────────────────────────────────────────────────────────────┐
│                 apps/api  (thin: Hono + SQLite)                    │
│     enrichment · image quality gate · Gemini calls · storage       │
│   ┌────────────────────────────────────────────────────────────┐   │
│   │      packages/engine  (pure, deterministic, numeric)       │   │
│   └────────────────────────────────────────────────────────────┘   │
└──────────────┬──────────────────────────────────┬──────────────────┘
               ▼                                  ▼
        apps/console (web)                  apps/mobile (phone)
```

### Repo layout (npm workspaces)

```
retrofit/
  package.json            README.md  PLAN.md  DECISIONS.md  STATUS.md  DEMO.md  VERIFICATION.md
  .env  .env.example
  docs/                   PRD.md, federato/ (official PDFs + live-schema.json)
  packages/
    engine/               pure TS, zero I/O
    federato/             adapter, query planner, mock snapshot, reference files
    design/               tokens shared by console and mobile
    verify/               test generators, naive second implementation, LLM comparison
  apps/
    api/                  Hono, better-sqlite3 + Drizzle, enrichment, Gemini
    console/              Vite + React
    mobile/               Expo + Expo Router (phase 2)
```

### Constraints

- TypeScript everywhere. Node 20+, npm 10+. No Python, no Docker, no pnpm.
- Build machine is macOS. All scripts run through `npm run ...`.
- Database is one SQLite file at `apps/api/data/retrofit.db`.
- Secrets live only in the repo-root `.env` (git-ignored). Nothing secret reaches the console or the phone.
- `packages/engine` imports nothing from `apps/*` and no LLM SDK.
- Pick a stable set of dependency versions and stay on it.

## 6. The engine (`packages/engine`)

### 6.1 Principle

The engine is arithmetic. Same input, same output, always. Every submission is reduced to a fixed-length **feature vector** of measured numbers (§6.4), and every output is computed from that vector by a fixed formula. Gemini's output reaches the engine only as a typed observation carrying a confidence number, and is treated like any other measurement.

### 6.2 Canonical submission

Every value is `Field<T> = { value, provenance }`, where provenance is `{ source: 'self_reported' | 'enrichment' | 'sweep' | 'answer', sourceDetail?, confidence?, observedAt? }`. One field can hold several competing values from different sources; nothing overwrites anything.

Groups: `insured`, `location`, `building` (one or many), `hazards`, `exposure`, `coverage`, `history` (claims), `pricing` (quoted, technical, and target premium), plus `raw` and `fieldMap`. `lineOfBusiness` is `commercial_property` or `tenant`.

### 6.3 Stages

Each stage is a pure function. Its output type is the next stage's input type.

| # | Stage | Input | Output |
| --- | --- | --- | --- |
| 1 | discover | raw records + schema document | `fieldMap`: raw path → canonical path, with match confidence |
| 2 | normalize | raw records + `fieldMap` | `CanonicalSubmission` |
| 3 | rollup | canonical with many buildings and claims | adds derived numbers: total TIV, % of TIV pre-1990, % of TIV by construction class, primary state by TIV share, 5-year loss total, claim count |
| 4 | merge | canonical + enrichment + sweep observations + answers | fields now holding several sourced values |
| 5 | contradict | merged + rulebook | `Contradiction[]`: field, values, severity (HIGH if a rule depends on it), affected rules |
| 6 | **vectorize** | merged + vector spec | raw vector `x`, tier vector `t`, presence mask `m` (§6.4) |
| 7 | evaluate | `x`, `t`, `m` + rulebook | appetite score `w · t`, knockout mask, fired rules with citations, missing fields, completeness, confidence |
| 8 | price | `x` + rating table | predicted premium, expected annual loss, factor-by-factor breakdown |
| 9 | verdict | outputs of 5 and 7 | FIT / REFER / DOES_NOT_FIT + deciding rule |
| 10 | flip | `x` + rulebook + verdict | the shortest move in vector space that reaches the acceptable region (max 2 components), with the score and price after the move, or `null` |
| 11 | voi | `m` + undetermined rules | next question + skipped fields, each with a one-line reason |
| 12 | **peers** | `x` + every other account's vector | the k nearest accounts with their distance, rate, and loss experience |
| 13 | rank | all results | ordered queue with quality index |

`runEngine(input, rulebook, ratingTable)` composes stages 3–11 and returns one `EngineResult`; `peers` and `rank` run over the whole set afterwards. The server stores results unchanged and both apps render from them. A separate `sweep` module is pure geometry: bearings, coverage arcs, largest uncovered gap, object placement, and pair rules (a `portable_heater` within ±20° and the same or adjacent distance band of `curtain`/`fabric`/`bedding` → `heaterNearCombustible`).

### 6.4 The feature vector

One spec file per line of business (`vectors/commercial.json`, `vectors/tenant.json`) lists the components in order, with each one's canonical source, type, scaling, and direction (higher is better, or lower is better). The vector is the only thing downstream stages read.

**Commercial property (11 components):**

| # | Component | Source | Scaling for distance |
| --- | --- | --- | --- |
| 0 | isNewBusiness | 0 or 1 | none |
| 1 | isPropertyLine | 0 or 1 | none |
| 2 | stateTier | 0 out, 1 acceptable, 2 target, from primary state | ÷ 2 |
| 3 | totalTiv | USD | log, then min-max over the book |
| 4 | quotedPremium | USD | log, then min-max |
| 5 | pctTivPre1990 | 0–1 | none |
| 6 | pctTivPost2010 | 0–1 | none |
| 7 | pctTivAcceptableConstruction | 0–1 | none |
| 8 | fiveYearLoss | USD | log(1 + x), then min-max |
| 9 | pctTivSprinklered | 0–1 (extension) | none |
| 10 | tivWeightedProtectionClass | 1–10 (extension) | ÷ 10 |

Components 0–8 drive Federato's eight factors. Components 9–10 feed pricing, peers, and extension rules only.

**Tenant:** one 0/1 component per hazard, plus smoke-detector count, building age, contents limit, and term.

**Three parallel arrays per submission:**
- `x`, the raw measured values.
- `t`, the tier vector: each appetite factor mapped to 0 (Not Acceptable), 0.6 (Acceptable), or 1 (Target) by the rulebook's thresholds.
- `m`, the presence mask: 1 where the value is known, 0 where it is missing. A missing component is never imputed for scoring; it lowers completeness and forces REFER.

**What the vector makes simple:**
- **Score** is a dot product: `appetite = 100 × (w · t)`, with `w` from the rulebook, summing to 1.
- **Knockouts** cannot be expressed by a weighted sum, so they stay a separate check: any `t[i] = 0` on an appetite factor sets the knockout mask.
- **Flip** is geometry. Each rule threshold is a boundary in the space; the flip is the smallest scaled move (in at most 2 components) that lands inside every acceptable boundary. Components that cannot be changed by the insured (state, building age) are marked immovable in the spec and are never proposed; if only immovable components fail, flip returns `null` with that reason.
- **Peers** are nearest neighbours: scaled Euclidean distance over components 2–10, computed over known components only and rescaled by the number compared. `k = 5`.
- **Pricing** takes `x` as its input row, so the fitted model and the engine read the same numbers.
- **Testing** generates vectors directly (§12).

**What peers can and cannot say.** Checked against the live data: all 27 property accounts that have buildings and a premium were bound, and the 11 that were lost, declined, cleared, or only quoted have no policy and so no full vector. A "similar accounts were bound vs declined" signal therefore does not exist in this dataset, and Retrofit does not claim one. Peers are used for what the data supports: "the five most similar accounts paid a median $0.41 per $100 of TIV and averaged $38K a year in losses; this one is quoted at $0.29" (figures illustrative). That is a benchmark on rate and loss, shown beside the model's prediction. For the 11 without a policy, a reduced vector (requested limit, insured revenue, headquarters state) still places them among peers, labelled as a coarse match.

### 6.5 The numbers

| Output | Formula |
| --- | --- |
| **Appetite score (0–100)** | `100 × (w · t)`. Tier values are 0, 0.6, 1. Weights sum to 1 and live in the rulebook file. A zero tier on any appetite factor also sets a knockout. |
| **Completeness (%)** | sum of `m` over required components ÷ number of required components |
| **Confidence (0–1)** | product of source confidences for fields the deciding rules used. Fixed table: broker-typed 0.7, public record 0.9, user answer 0.8, camera = the model's stated confidence after the adjustments in §9.3. |
| **Verdict** | knockout → DOES_NOT_FIT. Otherwise completeness < 100% or an open HIGH contradiction → REFER. Otherwise FIT. |
| **Distance to appetite** | size of the minimal flip: 0, 1, 2, or none |
| **Peer rate and peer loss** | median rate per $100 TIV and mean annual loss across the 5 nearest accounts |
| **Predicted premium, expected loss** | §6.7 |
| **Quality index (0–100)** | §6.8 |

### 6.6 Rulebooks

Rules are data:

```ts
Rule { id, lineOfBusiness, factor, tier: 'target'|'acceptable'|'not_acceptable'|'refer',
       when: Condition[],           // AND-only
       weight?, citation: { doc, section, quote }, fixHint?, ratingFactor? }
Condition { field, op: 'lt'|'lte'|'gt'|'gte'|'eq'|'neq'|'in'|'notin'|'exists'|'missing', value? }
```

**`rules/commercial.json`: Federato's eight factors, transcribed from `APPETITE_GUIDELINES.pdf`.** Each rule cites its table row.

| Factor | Acceptable | Target | Not Acceptable |
| --- | --- | --- | --- |
| Submission type | New business | | Renewal |
| Line of business | Property | | All others |
| Primary risk state | OH, PA, MD, CO, CA, FL, NC, SC, GA, VA, UT | OH, PA, MD, CO, CA, FL | All others |
| TIV | Up to $150M | $50M–$100M | Over $150M |
| Total premium | $50K–$175K | $75K–$100K | Under $50K or over $175K |
| Building age | Newer than 1990 | Newer than 2010 | Older than 1990 |
| Construction | >50% JM, non-combustible/steel, or masonry non-combustible | | >50% other |
| Loss value (5-year) | Under $100K | | Over $100K |

**Interpretations of ambiguous guidelines.** Each is shown on the console's rule card and named in the explanation when it matters.

| Ambiguity | Decision |
| --- | --- |
| "Primary risk state" has no field, and policies span up to four states | The state carrying the largest share of TIV. The explanation lists the others. |
| Building age across many buildings (oldest seen: 1951) | Mirror the construction factor's wording: Not Acceptable when more than 50% of TIV is pre-1990; REFER when any building is pre-1990, naming the buildings. |
| "Fire Resistive" and "Modified Fire Resistive" are better classes than those listed, but are not listed | Treat as acceptable and flag the assumption. |
| Loss value | paid indemnity + paid expense + open reserves, dated within five years of the submission's received date |

**`rules/extensions.json`: Retrofit's own rules** (sprinklers, protection class, room hazards). Labelled as ours everywhere. They can raise REFER or a contradiction and feed the premium, and they never touch the appetite score, so the score stays defensible against Federato's document.

**`rules/tenant.json`:** 12–18 rules on hazards, smoke detection, building age, and contents, each with a rating factor. Questions come from `questions/tenant.json` (plain-language question, input type, options, accessibility label).

### 6.7 Predicted payment

**Commercial.** The real data supports a model: across 27 property policies, rate runs $0.23–$0.66 per $100 of TIV (median $0.40); premium tracks TIV with R² = 0.72; `premium ÷ technical_premium` runs 0.93–1.21 (median 1.05).

- **Predicted premium** = Σ over buildings of `tiv ÷ 100 × baseRate × construction × age × protectionClass × sprinkler`, then × a loss-history factor. Factors are fitted once by least squares against `technical_premium`, constrained to be monotonic (a worse class is never cheaper), then frozen into `rating/commercial.json`. The fitting script is `npm run rating:fit`; the engine only reads the frozen file. With 27 policies the fit is thin, so its error is reported on screen.
- **Price adequacy** = quoted premium ÷ predicted premium. Under 0.9 means underpriced for the risk.
- **Expected annual loss** = the account's claim frequency × mean severity over five years, blended with the mean of its 5 nearest peers (falling back to the book average) by a credibility weight `n ÷ (n + k)`.

**Tenant.** No loss data exists, so this is a rating table, labelled "estimate": `baseMonthlyRate × contentsFactor × buildingAgeFactor × Π hazardFactors × termFactor`. The verdict screen shows the breakdown, so "fix this and save $6/month" is a subtraction the user can check.

### 6.8 Quality index and rank

`quality = 0.50 × appetite + 0.20 × adequacy′ + 0.15 × (1 − lossRatio)′ + 0.10 × completeness + 0.05 × confidence′`, where ′ means scaled to 0–100 and clamped. Weights live in config and are shown on screen. Knockouts rank below every non-knockout regardless of index, ordered among themselves by distance to appetite, then index. These weights are a starting point and are listed as an open question.

## 7. Federato agent (`packages/federato`)

### 7.1 The API

| Topic | Fact (verified live 2026-09-19) |
| --- | --- |
| Auth | Auth0 client credentials. `POST https://auth.product.federato.ai/oauth/token` with audience `https://product.federato.ai/core-api`. Tokens last 4 hours. |
| Endpoint | `POST https://product.federato.ai/integrations-api/handlers/federato-hack-north?outputOnly=true`, body `{ action: "schema" \| "query", payload }` |
| Envelope | Responses arrive as `{ output: [ { data } ] }` with HTTP 201 even with `outputOnly=true`. Unwrap both shapes. |
| Errors | Plain strings with a `[CODE]` prefix. Parse the prefix. |
| Guidelines, glossary | PDFs, not endpoints. Transcribed to `packages/federato/reference/`. |

### 7.2 The data

JSON. Twelve resources linked by numeric id. Money is plain USD numbers, dates are `YYYY-MM-DD`, missing is `null`. Results come as `{ total, results, resource }`.

```
Submission ──► Insured ──► hq Location
     ▲
   Policy ──► claims[]         ──► Claim (paid_indemnity, paid_expense, reserves, date_of_loss, cause_of_loss)
          ──► exposure_units[] ──► ExposureUnit ──► Location (state, lat/long, hazard_tags[], protection_class)
          ──► coverages[]                               └──► buildings[] ──► Building (tiv, year_built,
          ──► producer.broker                                 construction_type, sprinklered, stories, roof_year)
```

Counts: 158 submissions (38 property, 36 health, 21 cgl, 20 auto, 18 cyber, 15 excess, 10 lpl), 113 policies, 129 buildings, 179 claims. Of the 38 property submissions, 27 have a policy and 11 do not (4 lost, 3 cleared, 3 quoted, 1 declined); those 11 lack premium, business type, and buildings and resolve to REFER with missing data. Of the 27: 20 new and 7 renewal; most include a pre-1990 building; premiums reach $703K against a $175K ceiling; only 4 pass new business + premium + TIV together. Few will be FIT, so ranking, score, and flip carry the value. `hazard_tags` are catastrophe perils (flood, wildfire, hail, tornado, earthquake, hurricane), not room hazards.

### 7.3 Query language

Mongo-flavoured. Pipeline: `where` → `expand` → `unwind` → `filter` → `over` → `select` → `sort` → `pagination`. Operators `$eq $ne $exists $gt $gte $lt $lte $in $nin $contains $elemMatch`; combinators `$and $or $not`; reductions `$sum $avg $min $max $count $countDistinct`. Dot-paths do not cross arrays; use `$elemMatch`. Use the `expand` stage when a later stage needs the reference, the `$expand` leaf when it is only wanted in output.

### 7.4 Adapter

`getSchema()`, `query(payload)`, `getGuidelines()`, `getGlossary()`. OAuth with token cache and refresh before expiry. Env: `FEDERATO_BASE_URL`, `FEDERATO_TOKEN_URL`, `FEDERATO_AUDIENCE`, `FEDERATO_CLIENT_ID`, `FEDERATO_CLIENT_SECRET`. `FEDERATO_BASE_URL` unset → `MockFederatoAdapter`, which implements the same `query` contract (the subset the planner emits) over a saved snapshot of the real data. That snapshot is also the wifi-failure fallback. `npm run federato:snapshot` refreshes it. A loud banner at startup says which adapter is active.

### 7.5 Query planner

This is the graded part. It is deterministic, with one optional Gemini call.

1. **Read** the live schema into a resource graph.
2. **Collect** the fields the rulebook and rating table need.
3. **Locate** each field: match canonical names to schema paths using the synonym table (the only place Federato field names appear), then a graph search for the shortest reference path from a root resource. Names the table cannot resolve go to Gemini's `schema-assist` call; only matches ≥ 0.8 confidence are accepted, the rest stay visibly unmapped.
4. **Plan** in two passes. *Triage*: one cheap query over all submissions selecting id, status, and line of business; 120 of 158 are knocked out on line of business with the reason recorded. *Deep*: for survivors, one `Policy` query with `expand { insured, claims, exposure_units: { location: { buildings } } }` (verified: returns all 27 hydrated in one call). Submissions with no policy get a follow-up query through `Submission → insured → hq`.
5. **Adapt.** Zero results → retry with `$elemMatch` in place of a dot-path, or drop the narrowest filter, and record that it did. High-scoring accounts get one further query for broker history and coverage detail.
6. **Trace.** Every query is stored with: the goal, which rule needed it, the path chosen and why, the payload, row count, and duration. The console renders this as "How the agent got here".

### 7.6 Actions

Rox's prize asks for a system that works on messy data (unstructured, incomplete, conflicting) and **takes meaningful actions**. Federato asks whether the underwriter can act on the output. Federato's API is read-only (`schema` and `query` only), so actions are recorded in Retrofit's own database and nothing is written back.

| Action | Trigger | Done by | Result |
| --- | --- | --- | --- |
| **Route** | Any account that is not knocked out | Code | Assigned to the underwriter whose `region` matches the primary state and whose `authority_limit` covers the requested limit. None qualifies → flagged "needs referral to senior authority". |
| **Request** | REFER for missing data, an open HIGH contradiction, or an account one flip from FIT | Code picks the fields; Gemini drafts the wording | A message to the broker contact naming exactly what is needed and why ("year built for Building C is missing; it decides the building-age factor"). Saved to an outbox as a draft. The underwriter approves it. **Nothing is actually emailed**: the dataset's contacts are synthetic, and the demo marks the message sent. |
| **Ingest reply** | A broker reply is pasted or uploaded (free text, or a PDF such as loss runs) | Gemini extracts; code validates | Typed field values, each with a confidence and the quoted sentence it came from. Accepted at ≥ 0.8 and written with `answer` provenance; lower ones go to the underwriter to confirm. If the reply conflicts with what the broker first submitted, that is a contradiction like any other. |
| **Re-score** | Any new field value | Engine | New vector, score, price, verdict, and rank. |
| **Log** | Every action | Code | Who or what acted, the before and after numbers, and the source text. |

The loop is: incomplete or conflicting data → the agent asks for precisely what would change the outcome → unstructured answer comes back → it becomes numbers → the ranking moves. The engine stays deterministic throughout; Gemini only turns prose into typed values and typed values into prose.

### 7.7 Explanations

Every submission gets 2–3 sentences: appetite match, the key numbers, and a recommendation (accept / review / decline / investigate). They are generated from a deterministic template over the fired rules, so all 158 exist instantly and never contradict the numbers. When a submission is opened, Gemini's `narrate` call may polish the wording only; the numbers and the recommendation are passed in and checked to survive unchanged. Mixed cases say so: "In appetite on TIV and state, out on premium."

## 8. Server (`apps/api`)

Thin. Routes call the adapter, Gemini, and `runEngine`, and store the result. No business logic in handlers. `PORT` default 3000, CORS open for dev.

**Tables:** `submissions` (id, source, lineOfBusiness, externalId, raw, canonical, result, queryTrace, shareSlug, timestamps) · `sweeps` (id, submissionId nullable, roomLabel, term, frames, frameQuality, observations, coverage, stage, createdAt) · `enrichments` (id, submissionId, source, payload, createdAt) · `actions` (id, submissionId, type, status, payload, before, after, sourceText, createdAt).

| Endpoint | Behaviour |
| --- | --- |
| `POST /ingest/federato` | Run the planner, normalize, evaluate, store. Idempotent by externalId. |
| `GET /submissions` | Ranked queue |
| `GET /submissions/:id` | Full `EngineResult`, query trace, explanation |
| `POST /submissions/:id/run` | Re-run enrichment and engine |
| `POST /enrich/:id` | Run enrichment plugins, re-run engine |
| `POST /actions/plan` | Run routing and generate request drafts for every qualifying account |
| `GET /actions` · `POST /actions/:id/approve` | Outbox and action log; approve marks a request sent |
| `POST /submissions/:id/reply` | Body: free text or an uploaded PDF. Extract, validate, apply, re-score; returns the before and after |
| `POST /sweeps` · `GET /sweeps/:id` | Start the sweep pipeline; poll `stage` |
| `POST /sweeps/:id/answers` · `GET /sweeps/:id/next-question` | VOI loop |
| `POST /sweeps/:id/verify-fix` | One new photo of a fixed hazard; re-run; return the new verdict and price |
| `GET /aggregate` | Portfolio numbers and verification headline |
| `GET /rules` · `GET /glossary` | Active rulebooks with citations; glossary |
| `GET /s/:shareSlug` · `GET /health` | Public result JSON; liveness + active adapter |

**Enrichment** (`src/enrich/*`): two plugins. Flood zone via OpenFEMA, and fire-station distance via Overpass. Locations already carry coordinates; geocode with Nominatim only when they are missing. Each plugin has a 6 s timeout, a per-source cache, and an "unavailable" card on failure. Enriched values sit beside broker values with `enrichment` provenance. A plugin that cannot move a score, the premium, or raise a contradiction is cut.

`npm run seed` ingests and enriches everything.

## 9. Gemini layer (`apps/api/src/llm`)

### 9.1 Setup

`@google/genai`, `GEMINI_API_KEY`. Model chain `gemini-3.6-flash` → `gemini-3.8-flash` → `gemini-3.5-flash`, falling through on 429/500/503. Enforced `responseSchema` with `application/json`, then zod validation, one retry, then graceful degrade. One small interface, `generateJson({ prompt, images?, schema })`, so the provider can be swapped. If the key is unset the API still starts, prints a banner, and serves the seeded sweep.

### 9.2 Permitted calls

| Call | Input | Output |
| --- | --- | --- |
| **observe** | Up to 15 quality-passed frames with bearings, one request | Per frame: `usable` + reason, `ceilingVisible`, and objects `{ label, category, box_2d, distanceBand, confidence, notes }` from a fixed vocabulary: `portable_heater, extension_cord, power_bar, outlet, curtain, fabric, bedding, smoke_detector, sprinkler_head, window_ac_unit, stove, candle, bike, jewelry, camera, laptop, tv, instrument, blocked_exit, water_heater, unknown` |
| **relate** | Merged observation list, no images | Relational hazards with confidence, limited to `hazards.*`. Engine pair rules run first; this call only adds or adjusts confidence. |
| **verify-fix** | One new photo + the hazard being checked | `{ stillPresent, confidence, reason }` |
| **narrate** | Numbers, fired rules, flip, template explanation | Polished wording only |
| **schema-assist** | Unmapped keys, sample values, canonical field list | Mapping with confidence; accepted at ≥ 0.8 |
| **draft-request** | The fields needed, why each matters, broker and insured names | A short, specific message. Code checks that every requested field appears and nothing else is asked for. |
| **extract-reply** | Free text or PDF + the list of fields that were requested + the vector spec | `[{ field, value, confidence, quote }]`. Values are type- and range-checked by code; the quote must appear in the source. |
| **second-opinion** *(verification only)* | Guideline text + rolled-up facts | Predicted verdict + deciding factor (§12) |

No agent loops inside the API.

### 9.3 Image quality and observation handling

1. **Quality gate, in code, before Gemini.** With `sharp`: blur (variance of Laplacian), mean brightness, clipped-pixel share, resolution, and perceptual-hash duplicate check against the previous frame. Each frame gets a 0–1 quality number; frames under threshold are dropped. Too few frames or coverage under 75% → the app asks for a re-sweep of the named arc.
2. **Model gate.** A frame must also come back `usable` from Gemini (it catches photos of screens and obstructed lenses).
3. **Dedupe.** Same label within ±15° merges, keeping max confidence.
4. **Self-consistency.** `observe` runs twice with frame order shuffled. Objects found in both runs keep their confidence; objects found once are halved.
5. **Negative evidence.** "No smoke detector" counts only if `ceilingVisible` was true in frames covering at least 50% of the sweep. Otherwise the field stays unknown and becomes a question.
6. **Crops.** `box_2d` is used by code to crop the frame for the hazard detail screen.
7. **Confirmation.** Observations under 0.6 go back to the user to confirm or dismiss before the engine runs.

**Phase 2 stretch:** reading manufacture dates from labels; contents inventory with value ranges summed into a suggested limit; an exterior photo estimating stories and construction class to check `Building.stories` and `construction_type` (the best form of the bridge); tamper checks.

## 10. Console (`apps/console`)

Vite + React + TypeScript + React Router. Clarity over polish.

| Route | Content |
| --- | --- |
| `/queue` | The main view. Ranked table: rank, quality index, verdict pill, insured, appetite score, quoted vs predicted premium, adequacy, completeness, contradictions, "1 flip from FIT" badge, assigned underwriter, pending action, one-line explanation. Filters by line, verdict, state, underwriter. Non-property rows are present and collapsed under "Out of appetite: line of business". |
| `/submissions/:id` | (a) Explanation and recommendation (b) Score breakdown: eight factors with tier, weight, points, citation and quote (c) **How the agent got here**: the query trace (d) Pricing: factor-by-factor premium, adequacy, expected loss, and the **peer benchmark**: the five nearest accounts with distance, rate, and losses (e) Buildings table with the rollup (f) Contradictions and interpretations applied (g) Minimal flip with new score and price (h) The feature vector itself: raw, tier, and mask, so every number on the page can be traced (i) Discovered schema with unmapped keys (j) Enrichment cards (k) **Actions**: routing, the drafted request with approve, a box to paste or upload the broker's reply, and the log with before and after numbers (l) Attached photo or sweep, if any |
| `/actions` | Outbox and action log across the book: drafts awaiting approval, sent, replied, and the rank movement each reply caused. |
| `/rules` | Rule cards by factor with citation, quote, weight, and any interpretation. Extension rules in a separate, labelled group. |
| `/glossary` | Searchable; also powers tooltips. |
| `/aggregate` | Counts by verdict, score distribution, top knockout factors, one-flip-away list, book adequacy, and the verification headline numbers. |
| Header | Banner: live Federato or snapshot. Never hidden. |

## 11. Phone app (`apps/mobile`) — phase 2

Intact's prize is "The Quoting Interface of the Future": an AI-driven car or tenant quoting experience, complete or partial, judged on being clear, intuitive, and inclusive. The app is a tenant quote where the camera replaces most of the form. Inclusivity is a requirement, not a finish: screen-reader labels on everything, dynamic type, 44 pt targets, colour never the only signal, plain-language questions, and a photo-upload path for anyone who cannot do a sweep.

Expo (latest stable SDK), Expo Router, runs in Expo Go on a physical iPhone. The iOS Simulator has no camera; it covers layout, with the photo-picker fallback standing in for the sweep. Heading from `expo-location` `watchHeadingAsync`, pitch from `DeviceMotion`. Permission strings in `app.json`. `EXPO_PUBLIC_API_URL` points at an HTTPS tunnel (`npx cloudflared tunnel --url http://localhost:3000`).

| Route | Screen |
| --- | --- |
| `/` | Rooms list, skeleton cards, "New sweep" |
| `/new` | Room label, term (4/8/12 months), optional attach-to-submission |
| `/sweep` | Camera with coverage overlay, coverage %, turn hint, auto-capture every ~1.2 s once heading advances ≥ 10°, cap 15 frames, haptic per capture, Finish at ≥ 75% |
| `/analyzing` | Staged loaders driven by the real `stage` value |
| `/confirm` | Low-confidence items on a 2D radar ring, confirm or dismiss |
| `/questions` | One at a time, with a "Questions skipped: N" counter that expands to reasons |
| `/verdict` | Verdict, estimate with breakdown, deciding rule, the fix, **Verify my fix** (re-photo → price drops), Next step sheet |
| `/hazard/[id]` | Cropped photo, what and why, "if fixed → verdict becomes X, price becomes Y" |
| `/s/[slug]` | Shareable result |

**Coverage overlay.** A 3D dome (`expo-gl` + `three` + `@react-three/fiber/native`): 36 panels of 10° that turn red as scanned. Time box 45 minutes; if it is not rendering on the iPhone by then, use the 2D Skia ring, which `/confirm` needs anyway. Any library that fails in Expo Go is replaced and logged.

Networking: retry with backoff; offline queues the sweep; if capture fails, pick 3 library photos at bearings 0/120/240.

## 12. Verification (`packages/verify`)

| Layer | Volume | Question | Oracle |
| --- | --- | --- | --- |
| **A. Property tests** | 10 million generated submissions, seeded, parallel across cores | Does the engine obey its own laws? | Same input → same output. Improving any factor never lowers the score. A knockout always yields DOES_NOT_FIT. Applying the returned flip always yields FIT. Premium is monotonic in every factor. Completeness and confidence stay in range. No crash on nulls, empty arrays, or absurd values. |
| **B. Differential** | The same 10 million | Is the arithmetic right? | A deliberately naive second implementation: one flat function of if-statements written straight from the PDF table by a different agent, sharing no code with the engine. Any disagreement is a bug in one of them. |
| **C. LLM second opinion** | All 38 real property submissions + ~2,000 generated, stratified to over-sample every threshold and every ambiguity | Would a careful reader of the guidelines reach the same verdict? | Gemini, given only the guideline text and rolled-up facts, returns a verdict and deciding factor. It never sees engine output. |

The generator works at two levels. Most cases are drawn directly as vectors: each component sampled around its rule thresholds (just under, at, just over), with random presence masks and extremes. A smaller share are full multi-building submissions, so rollup and vectorize are tested too. Added invariants for the vector design: `vectorize` is a pure function of the merged submission; scaling keeps every distance component in 0–1; peer distance is symmetric and zero only for identical vectors; a returned flip never touches an immovable component. Layers A and B run as `npm run verify` (full) and at 100K in `npm test`. Layer C is `npm run verify:llm`.

Layer C is capped because 10 million LLM calls would cost thousands of dollars and take days, and agreement stops moving after a few thousand stratified cases. The LLM is the less reliable party: a disagreement is a lead, not proof the engine is wrong. Because the app also uses Gemini, layer C is a weaker independent check than a second vendor would be; layer B is the real correctness check.

**Extraction check.** `extract-reply` is scored against 30 written broker replies with known answers, including vague, partial, and self-contradicting ones. Reported: field accuracy, and how often a wrong value got through the 0.8 gate.

Output: `VERIFICATION.md` with counts, agreement rate with a 95% interval, and every layer-C disagreement listed with both sides' reasoning. Disagreements are expected to cluster on the §6.6 ambiguities.

## 13. Design system (`packages/design`)

| Token | Value |
| --- | --- |
| Paper / Ink | `#FAF8F2` / `#1F1E1B` |
| Red, Red deep, Red tint | `#E4002B` (placeholder for Intact's red) / `#B80022` / `#FBE3E6` |
| Muted, Muted deep, Muted tint | `#7C8073` / `#5E6357` / `#EDEFE8` |
| Type | Fraunces (display, verdict), Inter (body). 34/28/22/17/15/13. |
| Layout | 4-pt grid, radius 16 cards / 999 pills, no shadows, 1 px Muted-tint borders |

Red never means "bad": FIT is a red filled pill, REFER red outlined, DOES_NOT_FIT ink filled. Colour never carries meaning alone. Every interactive element has an accessibility label and role; 44 pt minimum touch targets; dynamic type; skeleton loaders for every list and card.

## 14. Build plan

Autonomous run with parallel subagents. Unknowns are decided and logged in `DECISIONS.md`. Init git first; commit every ~20 minutes; never more than 30 minutes on one blocker (stub, mark `// TODO(blocked):`, log, move on).

**Phase 1**

| Workstream | Scope |
| --- | --- |
| A — engine | Types, stages 1–13, vector specs, three rulebooks, rating tables and fit script, unit tests, fixtures from the real snapshot |
| B — federato | Adapter with OAuth, planner with trace, snapshot + mock, reference transcriptions, explanation templates, routing and request selection |
| C — api | Tables, endpoints, two enrichment plugins, Gemini layer, action loop, image quality gate, seed |
| D — console | Queue, submission detail, actions, rules, glossary, aggregate |
| E — verify | Generator, naive second implementation, 10M run, layer C, `VERIFICATION.md` |
| Integration | Seed against the live API; walk the console end to end; fix what breaks |
| Wrap-up | README, DEMO.md, DECISIONS.md, STATUS.md |
| Last, not integral | **Sentry** across api and console (the prize asks for more than error monitoring: tracing over planner queries and Gemini calls, logs, session replay on the console). **GoDaddy Registry** domain registered and pointed at the console. Neither may delay anything above. |

A and B start together; C once engine types exist; D once `GET /submissions` returns data; E once `runEngine` is stable. E's naive implementation is written by an agent that has not seen the engine code.

**Phase 2:** mobile app, sweep pipeline end to end on the iPhone, verify-fix, then the bridge.

**Documents.** README in this order: what Retrofit is and the pitch line · **Intact section** with headings *The problem*, *How AI is used*, *User journey and key features*, *Assumptions, limitations, and future improvements* · **Federato section** (how the agent plans queries, scoring, interpretations, pricing, explanations, verification, switching live ↔ snapshot) · architecture and repo map · macOS setup · accessibility · the retro.fit domain. DEMO.md, Federato and Rox cut: (1) the agent's reasoning trail, shown first; (2) the ranked queue, with one line on why so few accounts fit; (3) one account: explanation, a flagged ambiguity, the flip; (4) the action loop live: approve the broker request, paste a messy reply, watch the fields extract and the rank move; (5) one line each on price adequacy, peers, and the verification numbers. Intact cut (phase 2): sweep → questions → quote → verified fix. Includes run commands and the snapshot and seeded-sweep fallbacks.

## 15. Definition of done

**Phase 1**
- `npm test` passes, including 100K property and differential cases. `npm run verify` completes 10 million with zero unexplained failures.
- `npm run seed` against the live API stores all 158 submissions with results and query traces.
- The console shows the ranked queue and, for any property account: explanation, factor breakdown with citations, query trace, pricing, flip.
- `VERIFICATION.md` exists with layer C agreement and the disagreement list.
- The action loop works end to end on a seeded reply: request drafted → approved → reply pasted → fields extracted with quotes → re-scored → rank change logged.
- Removing `FEDERATO_BASE_URL` switches to the snapshot with no code change.

**Phase 2**
- On an iPhone in Expo Go: New room → sweep with coverage feedback → analyzing → confirm → questions with skipped counter → verdict with estimate → verify fix changes the price.

**Invariants, always:** same input gives same output; every verdict names its deciding rule with document, section, and quote; no LLM decides a verdict, score, or dollar amount.

## 16. Risks

| Risk | Mitigation |
| --- | --- |
| Venue wifi or Federato's API fails mid-demo | Snapshot adapter, identical contract |
| Judges dispute an interpretation of the guidelines | Interpretations are visible, cited, and one config change to alter |
| Premium model is fitted on 27 policies | Monotonic constraints, error shown on screen, labelled "predicted" |
| 10M run is slower than expected | Seeded and chunked; report whatever count completed, never a number that was not run |
| Layer C shares a vendor with the app | Stated plainly; layer B carries correctness |
| Gemini overload or bad JSON | Model chain, enforced schema, retry, seeded sweep |
| Compass noise on the phone | Exponential filter, 10° panels, ±20° pair tolerance |
| Agents cannot drive a physical iPhone | Phase 2 ships with a human checklist in STATUS.md |
| The action loop looks fake because nothing is really sent | Say so on screen: contacts are synthetic, so sending is simulated; the extraction and re-scoring are real and run live |
| A wrong value is extracted from a reply | 0.8 gate, type and range checks, the quote must exist in the source, and the measured error rate is in `VERIFICATION.md` |
| Time runs out | Phase 1 alone is a complete Federato and Rox entry |

## 17. Open questions

1. **Quality-index weights** (50/20/15/10/5) are a starting point, not derived.
2. **Intact's exact red.**
3. **Tenant base rate and hazard factors** are invented for the demo; a real source would be better.
4. **Keys in chat.** The Gemini and Federato credentials were pasted into a chat transcript; rotate after the event.

## 18. Prize map

Criteria are from the event's Devpost page (read 2026-09-19). No limit on the number of prizes entered is stated.

| Prize | What it asks | What answers it | Status |
| --- | --- | --- | --- |
| **Federato** — Building the Federato Insurance Agent ($3,500) | An agent that thinks like an underwriter: ingest submissions, enrich with real-world risk data, judge against appetite guidelines | Query planner with trace (§7.5), real rulebook and vector scoring (§6), explanations (§7.7), two enrichment plugins (§8), actions (§7.6) | Core |
| **Rox** — Best AI Agent ($10K / $2K) | LLMs operating on real-world messy data and taking meaningful actions; unstructured information, incomplete datasets, conflicting sources | Unstructured: broker replies, PDFs, photos. Incomplete: presence mask, completeness, targeted requests. Conflicting: provenance and contradictions. Actions: §7.6 | Core |
| **Intact** — The Quoting Interface of the Future | AI-driven car or tenant quoting, complete or partial; clear, intuitive, inclusive | Phone app (§11) | Phase 2 |
| **MLH** — Best Use of Gemini API | Build something that makes people say "whoa" | Already the only LLM in the system (§9) | Opt in, no extra work |
| **Sentry** — Best Use of Sentry | Sentry products beyond error monitoring | Tracing, logs, session replay (§14) | Last |
| **MLH** — GoDaddy Registry domain | Register a domain | Registered at wrap-up | Last |

Not entered: Expo and Aramco (by decision), and every prize that would require adopting a platform the design does not need (Cloudflare, MongoDB Atlas, Backboard, Composio, Browserbase, Linq, ElevenLabs).
