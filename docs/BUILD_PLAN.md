# Retrofit build plan (~110 agents, 6 at a time)

## Context

> **Pre-flight corrections applied 2026-09-19 (read these first; they override the text below).**
>
> 1. **The monorepo lives at the repository root** (`/Users/calebchincalebchin/hackthenorth`), not in a `retrofit/` subfolder. `packages/` and `apps/` sit beside the existing `docs/` and `prototype/`. Every path in this document that reads `retrofit/x` means `x`.
> 2. **The git repository already exists** on branch `build/retrofit`, remote `Agilan75/HacktheNorth` (shared with a teammate). Drop `git init` from CP0. Commit at every checkpoint; push the branch only at the very end; never merge to `main`; never force-push.
> 3. **`.env` exists at the repo root** with working Federato OAuth credentials and a working `GEMINI_API_KEY`. Never print it, copy it into a source file, or commit it.
> 4. **The Gemini model chain is verified live**: `gemini-3.6-flash`, `gemini-3.8-flash`, `gemini-3.5-flash` all answer `generateContent` with an enforced `responseSchema`. `gemini-3.7-flash` is held in reserve. Thinking is on by default (89-263 thought tokens on a trivial prompt), so `maxOutputTokens` must be generous and `finishReason: MAX_TOKENS` treated as a retryable diagnostic.
> 5. **A02 ports the Gemini provider from `prototype/gemini.js`** in this repo, not from the stale absolute path named in the A02 row below. `prototype/claude.js` is the Anthropic parity path and the fallback provider.
> 6. **`prototype/` is frozen.** No unit owns it, no unit edits it. It is read-only source material.
> 7. **`pdftoppm` is now installed**, so the "read PDFs whole, never with a `pages` argument" constraint below is lifted.
> 8. **Temporary files go in the agent's own scratchpad directory, never `/tmp`.** Under this sandbox `curl -o /tmp/...` silently writes a zero-byte file.
> 9. **The deep Federato pass queries `Policy`, not `Submission`** (F09). `Submission` has no premium, TIV, state, construction, or building fields and no reverse reference to `Policy`.
> 10. **This build runs unattended.** Nothing blocks on a human. Decide, log to `DECISIONS.md`, continue.

`retrofit/docs/PRD.md` (v1.2) is final and nothing is built: the folder holds only `docs/`, `.env` (working Gemini and Federato credentials), `.env.example`, `.gitignore`. The user asked for the build to be planned for many parallel agents, then chose **~100 agents with light review** and **phone app written last**. Prizes: Federato, Rox, Intact, MLH Gemini; Sentry and a GoDaddy domain last and non-integral.

**Machine facts (checked):** 8 cores, 8 GB RAM, Node 24.16, npm 11.13, 38 GB free, Xcode CLT present, no git repo yet, no `pdftoppm` (so PDFs must be read whole, never with a `pages` argument; all six Federato PDFs are ≤ 8 pages). The Workflow tool caps concurrency at `min(16, cores − 2)` = **6 agents at once**. About 110 units × ~15 min ÷ 6 slots ≈ 4.5 hours of agent time plus checkpoints: **estimate ~6 hours wall-clock**.

A planning agent produced a 209-unit decomposition; this plan merges it down to ~110 by pairing small related modules per unit, and keeps its structural ideas.

## How it runs

Four Workflow runs in sequence. Between them I (not an agent) run the heavy commands once, commit, read results, and decide the next run. Inside a run, units are scheduled by **dependency graph, not by wave**: each unit starts the moment its dependencies pass (`run(id) = Promise.all(deps.map(run)).then(() => agent(...))`), so the 6 slots stay full and there are no artificial barriers. Longest-chain units are listed first.

### Rules every agent receives (written to `AGENTS.md` in Run 0)

1. **One tree, disjoint file ownership.** Each unit gets the exact paths it may write. `docs/contracts/OWNERSHIP.json` maps file → unit. No worktrees (8 GB RAM).
2. **Stub-first, frozen skeleton.** Run 0 creates every barrel, route registration, `App.tsx`, and a throwing stub (`throw new Error('NOT_IMPLEMENTED:<unit>')`) with the final signature for every module. The tree typechecks from the first checkpoint, and later units only replace bodies of files that already exist. Frozen files: all `package.json`, lockfile, tsconfigs, `types.ts` files, barrels, `app.ts`, `App.tsx`, DB schema, DTOs, vector specs, `INTERPRETATIONS.md`.
3. **Need a frozen file changed?** Write `docs/contracts/requests/<unit>.md`, continue with a local cast. I apply additive changes at checkpoints.
4. **Never run** `npm install`, `git commit`, repo-wide `tsc`, package-wide `vitest`, the verify CLI, or a listening server. Run only your own test file with `VITEST_MAX_WORKERS=1`; optionally `tsc --noEmit -p <own package>` once at the end.
5. **No network by default.** `vitest.setup.ts` throws on any non-localhost fetch unless `RUN_LIVE=1`. Only unit F02 (snapshot) touches live Federato. Only the units that own a Gemini call run their `*.live.test.ts`, with a tiny input. Everyone else uses `FE/fixtures/mini-snapshot.ts`, then the real snapshot, and `llm/fake-provider.ts`.
6. **Route tests are in-process** (`app.request()` + `:memory:` DB + injected `Deps`).
7. **No shared helpers invented.** `docs/contracts/HELPERS.md` lists where each lives (`EN/util/math`, `contracts/format`, `sweep/geometry`). New helpers stay private to your file.
8. **Decisions** go to `docs/decisions/<unit>.md`; blockers > 30 min get stubbed with `// TODO(blocked):` and logged to `docs/status/blocked.jsonl`.
9. **Structured output:** files written, test command + result, contract requests, open issues.

Aliases: EN `packages/engine`, FE `packages/federato`, CT `packages/contracts`, DS `packages/design`, VF `packages/verify`, API `apps/api`, CON `apps/console`, MOB `apps/mobile`.

---

## Run 0 — scaffold and contracts (5 agents, ~70 min)

W0-1 ∥ W0-2, then W0-3 ∥ W0-4, then W0-5.

| Unit | Owns |
| --- | --- |
| **W0-1 Root + tooling** | Root `package.json` (workspaces, `"type":"module"`, scripts run as `node --env-file-if-exists=.env --import tsx …`), `.npmrc` (`save-exact`), `tsconfig.base.json` (strict, Bundler resolution, `erasableSyntaxOnly`, project refs; MOB excluded), `vitest.config.ts` (+ jsdom project for CON, `*.live.test.ts` excluded), `vitest.setup.ts` (fetch guard), all 8 workspace `package.json` + `tsconfig.json` with the **full dependency set pinned via `npm view`**, rewritten `.env.example` (the current one has stale `FEDERATO_API_KEY`/`*_PATH` vars), `AGENTS.md`, `PLAN.md`, `DECISIONS.md` seed, `docs/contracts/{UNITS.json,OWNERSHIP.json,HELPERS.md,requests/}` |
| **W0-2 Engine contracts** | `EN/src/types.ts` (Provenance, Field, CanonicalSubmission, RawBundle, FieldMap, Observation, VectorSpec, FeatureVector{x,t,m}, BookStats, Rule, Condition, Rulebook, RatingTable, Rollup, Contradiction, EvaluateResult, PriceBreakdown, VerdictResult, Flip, VoiResult, PeerResult, RankedEntry, EngineInput, EngineResult, CoverageResult), `schemas.ts` (zod for rulebook/vector/rating/questions), `constants.ts` (tier values, source-confidence table, K_PEERS, tolerances, 21-label `OBJECT_VOCAB`), `util/math.ts` (implemented), **final** `vectors/commercial.json` + `vectors/tenant.json`, `data.ts`, barrel + stubs for every stage, and **`docs/contracts/INTERPRETATIONS.md`** |
| **W0-3 Federato + DTO + API contracts** | `FE/src/types.ts` (FederatoAdapter{kind,getSchema,query,getGuidelines,getGlossary}, QueryPayload, QueryTraceEntry, PlannerResult, SchemaAssistFn injected, RoutingDecision, RequestSelection, ReplyApplication, Explanation), FE barrel + stubs, `FE/fixtures/mini-snapshot.ts`; `CT/src/{dto.ts,dto.schemas.ts,routes.ts,llm-io.ts,format.ts}`; `API/src/{db/schema.ts,env.ts,app.ts}`, 501 route stubs, `services/types.ts` (`Deps{db,adapter,llm,clock}`), `llm/{types.ts,index.ts,fake-provider.ts}` (`generateJson({prompt, parts?, schema:{zod,response}, callName})`), `enrich/types.ts`, `observability/index.ts` (no-op hook so Sentry needs no later edit to `app.ts`) |
| **W0-4 UI, verify, mobile skeletons** | CON `index.html`, `vite.config.ts`, `main.tsx`, frozen `App.tsx` route table, page + panel stubs, `panels/types.ts`; DS `tokens.ts` (final per PRD §13); VF `types.ts` (no engine imports), `spec/NAIVE_SPEC.md`, stubs; MOB `package.json`, `app.json` (permission strings), `_layout.tsx`, screen stubs |
| **W0-5 Contract auditor** (read-only) | Maps every noun in PRD §6–§11 to a type or field; gaps fixed before freeze |

**`INTERPRETATIONS.md` must settle what the PRD leaves open**, because the 10M differential test samples exactly at thresholds and the two implementations will otherwise disagree: inclusive/exclusive for every boundary ($150M TIV, $100K loss, years 1990 and 2010, exactly 50% construction), the tier value for "Acceptable" on the four factors with no Target column, the eight factor weights, the REFER path for "any building pre-1990", and a 1e-6 score tolerance.

**Dependencies (one install):** typescript ~5.9, vitest ^3, tsx ^4, fast-check ^4 · zod ^4 · hono ^4 + @hono/node-server · drizzle-orm + better-sqlite3 ^12 · sharp ^0.34 · @google/genai ^1 · react/react-dom pinned to Expo's version, react-router ^7, vite ^7, testing-library, jsdom, `@fontsource-variable/{fraunces,inter}` (fonts without wifi) · @sentry/node, @sentry/react (unused until the end) · Expo set from `expo-template-blank-typescript`. No eslint, prettier, Tailwind, dotenv, drizzle-kit (migration is hand-written `CREATE TABLE IF NOT EXISTS`).

**Checkpoint CP0 (me):** `npm install`, smoke `better-sqlite3` and `sharp` on Node 24, `tsc -b`, `vitest`, commit, tag `cp0-green`. Fallbacks: better-sqlite3 → node-gyp compile → `drizzle-orm/sqlite-proxy` over `node:sqlite` (confined to `API/src/db/client.ts`); Expo peer conflict → remove `apps/mobile` from workspaces and give it its own install in Run 3.

---

## Run 1 — phase-1 build (~74 units, dependency-scheduled)

Each unit = module(s) + colocated test(s). "K" = Run 0 contracts.

**Engine (17)**

| ID | Scope | Deps |
| --- | --- | --- |
| E01 | Condition ops, Field helpers, confidence table | K |
| E02 | discover + normalize | K |
| E03 | rollup (TIV, % pre-1990/post-2010, % construction, primary state, 5-yr loss) | K |
| E04 | merge + contradict | K |
| E05 | scaling/BookStats + vectorize + x→t tiers (tests use INTERPRETATIONS boundaries) | K |
| E06 | evaluate + verdict (incl. refer-tier path) | K |
| E07 | price commercial + price tenant + expected loss (credibility blend) | K |
| E08 | flip-bounds + flip (≤ 2 components, immovables excluded, null reason) | K |
| E09 | voi | K |
| E10 | peers (incl. reduced-vector coarse match) + quality index + rank | K |
| E11 | sweep geometry (bearings, arcs, largest gap) | K |
| E12 | sweep observations (±15° dedupe, self-consistency halving, negative evidence) + pair rules → `hazards.*` | K |
| E13 | `rules/commercial.json` from the PDF with row citations + schema test | K |
| E14 | `rules/extensions.json`, `rules/tenant.json`, `questions/tenant.json` | K |
| E15 | `rating/tenant.json`, commercial monotonic priors, monotonic least-squares fit lib + `rating:fit` CLI | K |
| E16 | synthetic fixtures with expected vectors + `runEngine` composer | E03–E09 |
| E17 | real fixtures from snapshot, run fit, freeze `rating/commercial.json`, golden test | F02, F09, E02, E15, E16 |

**Federato (13)**

| ID | Scope | Deps |
| --- | --- | --- |
| F01 | OAuth (cache, refresh) + live adapter (unwrap both envelopes, accept 201, parse `[CODE]` errors) | K |
| F02 | **Snapshot: the only live Federato caller.** All 12 resources + hydrated Policy query; asserts 158/113/129/179 | F01 |
| F03 | Mock `where`/operators/`$elemMatch`/combinators | K |
| F04 | Mock expand/unwind/`$expand` + filter/over/reductions/select/sort/pagination | K |
| F05 | MockFederatoAdapter over snapshot + `createAdapter(env)` + loud banner | F03, F04 |
| F06 | Guidelines + glossary transcriptions, reference index, query-language notes | K |
| F07 | Synonym table (test: every path exists in `docs/federato/live-schema.json`) + resource graph/shortest path | K |
| F08 | Planner collect + locate (injected assist, ≥ 0.8 gate, unmapped stay visible) | K |
| F09 | Plan triage + plan deep + no-policy follow-up + results → `RawBundle` | K |
| F10 | Adapt (`$elemMatch` swap, drop narrowest filter) + trace recorder | K |
| F11 | Planner run end to end + high-scorer follow-up query | F05, F07–F10 |
| F12 | Explanation template, recommendation, mixed-case wording, narrate guard | K |
| F13 | Actions: request selection, draft validator, extraction validator (type/range/quote/0.8), apply-reply, routing by region + authority limit | K (routing regions: F02) |

**API (20)**

| ID | Scope | Deps |
| --- | --- | --- |
| A01 | DB client + migrate (node:sqlite fallback lives here) + repos | K |
| A02 | Gemini provider ported from `prototype/gemini.js` (MODELS chain, MAX_ROUNDS, RETRYABLE, VisionError, `clamp01`/`sanitize`, MAX_TOKENS diagnostics) + `generateJson` (zod, one retry, degrade) | K |
| A03–A06 | Gemini calls, two per unit, each with prompt, schema, fake-provider test, one tiny live smoke: observe+relate · verify-fix+narrate · schema-assist+second-opinion · draft-request+extract-reply | K |
| A07 | Enrichment HTTP helper (6 s timeout, cache) + Nominatim fallback + OpenFEMA flood | K |
| A08 | Overpass fire-station distance + enrichment runner + unavailable cards | A07 |
| A09 | Image metrics (Laplacian, brightness, clipping, pHash) + quality gate + `box_2d` crops; sharp-generated test assets | K |
| A10 | Seed data (sweep observations, messy broker reply) + server boot + banners | K |
| A11–A15 | Routes: static (health/share/rules/glossary) · ingest + submissions · run/enrich + aggregate · actions + reply · sweeps + sweep loop | K |
| A16 | Ingest service (idempotent) + rescore service (BookStats, peers, rank) | E16, E10, F09, F11, A01 |
| A17 | Actions-plan service + reply service | F13, A06, A16 |
| A18 | Sweep pipeline (drives `stage`) + questions + verify-fix service | A03, A04, A09, E12, E16 |
| A19 | Aggregate service (reads `VF/out/summary.json`) | A01 |
| A20 | `npm run seed` | A16–A19, A08, A10 |

**Console + design (15)** — all K-only, so they start at CP0

C01 API client + `useApi` + typed DTO fixtures (FIT/REFER/DNF/no-policy) · C02 token CSS + atoms (VerdictPill, Badge, CitationQuote, Skeleton, Card) · C03 DataTable + Filters + Layout + AdapterBanner · C04 QueuePage · C05 SubmissionPage · C06 panels Explanation + ScoreBreakdown · C07 QueryTrace + Schema · C08 Pricing + PeerBenchmark · C09 Buildings + Contradictions/Interpretations · C10 Flip + Vector + Enrichment · C11 Actions (routing, draft, ReplyBox, log) + AttachedSweep · C12 ActionsPage · C13 RulesPage + GlossaryPage + tooltip · C14 AggregatePage + SVG charts · D01 DS CSS-variable export + contrast test + RN helpers

**Verify (9)**

| ID | Scope | Deps |
| --- | --- | --- |
| **V01** | **Isolated naive implementation. Scheduled first**, while `EN/src` holds only stubs. May read only `APPETITE_GUIDELINES.pdf`, `vectors/commercial.json`, `INTERPRETATIONS.md`, `NAIVE_SPEC.md`. Forbidden to open `packages/engine/src/**`. Post-check: grep for any `@retrofit/engine` import. | K |
| V02 | Seeded PRNG + vector generator (under/at/over every threshold, random masks, extremes) | K |
| V03 | Multi-building submission generator + layer-C stratifier | K |
| V04 | Invariants: core + monotonic | K |
| V05 | Invariants: flip + vector; engine-vs-naive comparator | K |
| V06 | 30 written broker replies (clean, partial, vague, self-contradicting, loss-run style) + extraction scorer | K |
| V07 | Facts text (never includes engine output) + report writer + Wilson interval | K |
| V08 | Worker pool (chunked, seeded, partial counts; `execArgv: ['--import','tsx']`) + CLI + 100K test | V02, V04, V05, V01, E16 |
| V09 | Layer C runner (disk cache, resume, concurrency 2) | V03, V07, A05 |

**Checkpoint CP1 (me):** drain, apply contract requests, `tsc -b`, full `vitest` (4 workers), bounded fix loop (group errors by file → owner; ≤ 6 fixers with exclusive files; ≤ 2 rounds; remainder quarantined with `it.skip` + `TODO(blocked)`), commit.

---

## Run 2 — integration, review, fix (~18 units)

- **Integration tests (4):** I1 snapshot → discover → normalize → `runEngine` (expect 38 property, 27 full vectors, 11 REFER for missing data) + naive vs engine on the 27 real accounts · I2 planner over mock (trace shows triage then deep, 120 knocked out) + unset `FEDERATO_BASE_URL` selects mock with banner · I3 ingest → queue → detail, every response parses with CT zod schemas · I4 action loop on the seeded reply (fake LLM) + seeded sweep → verdict → verify-fix lowers price.
- **Reviewers (6, read-only, structured findings `{file,line,prdClause,severity,repro}`):** engine scoring vs §6.5 + INTERPRETATIONS · rulebooks and transcriptions vs the PDFs, quote-exact · federato planner/trace from a judge's view + mock parity with `QUERY_REQUEST_BODY.pdf` · API thin routes, DTO conformity, LLM guardrails (no LLM decides a number) · console (numbers trace to DTO, nothing recomputed; accessibility) · cross-cutting greps (`Date.now`/`Math.random`/I/O in engine, secrets reaching clients, `process.env` outside `env.ts`).
- **Verify each major finding** with a second agent before any fix; **fixers (≤ 6)** own only files named in confirmed findings and write the failing test first.
- **S1 end-to-end smoke (runs alone):** seed from snapshot, then seed live once, curl every endpoint, `vite build`, load every console route.

**Checkpoint CP2 (me, nothing else running):** full tests, 100K verify, then **`npm run verify` for the 10M run with 6 workers** (measure throughput at 100K first; report the count actually completed), then `verify:llm` (38 real + ~2,000 generated) and the extraction check, then one agent writes `VERIFICATION.md` from the outputs. Commit, tag.

---

## Run 3 — phone app, docs, extras (~15 units)

- **Mobile (9), K-only, excluded from root `tsc -b` so it can never gate phase 1:** M1 API client + offline queue · M2 heading filter + capture-loop state machine (≥ 10°, 1.2 s, cap 15, Finish ≥ 75%) + session store · M3 UI kit (labels, 44 pt) + ScanRing (Skia) · M4 ScanDome (45-min box, ring fallback, logged) · M5 `/` + `/new` · M6 `/sweep` + `/analyzing` · M7 `/confirm` + `/questions` with skipped counter · M8 `/verdict` + verify-fix + next-step sheet · M9 `/hazard/[id]` + `/s/[slug]` + 3-photo fallback. Checked by `tsc -p apps/mobile`, `expo-doctor`, iOS Simulator for non-camera screens.
- **Docs (3):** README (PRD §14 order) · DEMO.md · merge `docs/decisions/*` → `DECISIONS.md` + `STATUS.md` with the iPhone human checklist.
- **Completeness critic (1):** PRD §15 definition of done + §8/§10/§12 vs the repo; lists every `TODO(blocked)`; gaps become a last small fix round.
- **Last, non-integral (2):** Sentry for API (tracing over planner + Gemini calls) and console (session replay) via the Run 0 no-op hook · domain steps in STATUS.md.

**Checkpoint CP3:** final tests, commit, tag.

---

## Verification

- **Every checkpoint:** `tsc -b` and full `vitest` green (or failures quarantined and listed), commit.
- **CP0:** native modules load on Node 24; stub tree typechecks.
- **CP1:** all unit tests pass; `grep -r "@retrofit/engine" packages/verify/src/naive` returns nothing.
- **CP2:** `npm run seed` against the live API stores all 158 submissions with results and query traces; every endpoint returns 200; unsetting `FEDERATO_BASE_URL` serves the snapshot; console walked in a browser: queue → submission (explanation, factor breakdown with citations, query trace, pricing, flip) → approve request → paste seeded reply → fields extract with quotes → rank moves; 10M run reports its real count with zero unexplained failures; `VERIFICATION.md` has layer-C agreement with a 95% interval and the disagreement list.
- **CP3:** mobile typechecks, `expo-doctor` clean, Simulator screens load; README/DEMO/DECISIONS/STATUS present.

## Known limits, stated up front

- 6 agents run at once, not 100; the rest queue.
- The naive agent's isolation is enforced by instruction, by scheduling it before engine code exists, and by an import grep. There is no hard sandbox.
- The camera sweep cannot be verified by agents; it needs a human with an iPhone.
- The Gemini and Federato keys are in `.env`; agents are told never to print or copy them, and only the named units make live calls.
