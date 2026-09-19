# Retrofit

Retrofit is one deterministic underwriting engine with two front doors: an underwriter console that ranks Federato's live submission book against the carrier's appetite guidelines, and a renter phone app where the camera replaces most of the quote form. Gemini reads photos and prose. Code decides every verdict, score, and dollar amount.

> **Underwriting runs on what the broker typed. We built the camera that checks.**

Build state: 8 workspaces, `tsc -b` 0 errors; see STATUS.md for the final test count.

---

## Intact: the quoting interface

### The problem

Renters get quotes from forms that never look at the room. A heater beside the curtains or a missing smoke detector drives losses but never reaches the price, and the renter never learns what to fix.

### How AI is used

Gemini sees; the engine decides.

- **Quality gate in code first:** blur, brightness, clipping, and duplicate checks before any model call.
- **`observe`.** Gemini lists objects per frame from a fixed vocabulary (`portable_heater`, `curtain`, `smoke_detector`, ...) with a confidence.
- **Code turns objects into hazards.** Pure geometry places objects by compass bearing; a heater within ±20° of fabric or bedding becomes `heaterNearCombustible`. "No smoke detector" counts only if the ceiling was visible; otherwise it becomes a question.
- **The engine** applies the tenant rulebook and rating table and returns the verdict, estimate, the deciding rule (for a tenant verdict, the worst tenant rule that fired), and the fix. `verify-fix` checks one new photo of a fixed hazard and re-prices.

### User journey and key features

Your rooms (with an About screen) → new room → sweep → analyzing → confirm → questions → verdict → verify my fix.

- **Sweep:** auto-capture as you turn, a 2D Skia coverage ring, Finish at 75% coverage.
- **Confirm:** low-confidence objects on a radar ring to confirm or dismiss.
- **Questions:** one at a time, with a "Questions skipped: N" counter that expands to reasons.
- **Verdict:** a gradient hero for the verdict and the price, estimate with its factor breakdown (each factor iconified), the deciding rule, and the fix. **Verify my fix** re-photographs the hazard and shows the price drop.
- **Photo upload** for anyone who cannot do a sweep.
- **About** (`/about`, linked from the header): what Retrofit is, how the three steps work, and a privacy line — reachable without leaving the flow, not a forced first-run gate.
- **Visual system:** a `@retrofit/design`-token-only accent layer on top of the frozen PRD §13 palette — `Icon` (Ionicons) and `Hero` (a gradient, no-shadow surface; PRD §13 still bars shadows everywhere) added to the phone kit, used for the brand mark, the verdict/price cards, per-hazard icons, and the About screen. Red stays reserved for verdicts (PRD §13: "red never means bad"); blue marks informational/in-progress state, green marks positive/completed — the same meaning as the console's palette.

### Assumptions, limitations, and future improvements

- **No one has run the phone app on an iPhone yet**, so the camera sweep and its Skia coverage ring are still unverified on real hardware. Every other screen, though, has now been driven end to end in a browser (`expo start --web`) against the live API — real sweeps, real questions, real verdicts — which caught and fixed two real bugs a code read alone hadn't: a screen-reader-only nested-heading conflict on `/confirm`, and a colour-contrast failure where an outlined verdict pill's red text landed on a dark gradient it wasn't designed for (now backed by an opaque plate). `expo-doctor` stays 21/21 and all 139 logic tests still pass.
- **The Gemini key's prepaid credits are depleted (HTTP 402).** Until topped up in Google AI Studio, the phone app's vision call, broker-reply extraction, request drafting, and narration fall back or fail. Scoring, ranking, template explanations, and the whole engine are unaffected.
- **Broker-reply extraction accuracy is unmeasured.** The 30-fixture check ran after the credits ran out.
- **The 3D coverage dome was cut.** The app uses the 2D Skia ring, the PRD's named fallback.
- **Tenant rates are invented** and labelled "estimate".
- **No account in the real book has a minimal flip.** 23 of the 26 declined property accounts fail on at least one factor the insured cannot change (building-age share, state, or renewal status), and the engine names which. The other 3 (SUB-2026-00014, SUB-2026-00028, SUB-2025-00070) are knocked out on premium, which *is* movable, but reaching FIT would take more than the two-component move the flip is capped at (PRD 6.4). The flip is exercised on synthetic and tenant cases.
- **Enrichment is display-only.** OpenFEMA flood zones and Overpass fire-station distance are fetched and shown on each account's enrichment card, but no rule, rating factor or contradiction reads them yet, so they do not move a score or a price. By PRD 8's own test that makes them a future improvement, not a scoring input; the obvious next step is an extension rule that refers any location in a FEMA A or V zone. Overpass was also mostly unavailable on the night (public mirrors rate-limited; 2 of 27 accounts), while OpenFEMA worked across the book.
- **Broker contacts are synthetic,** so approving a request marks it sent. Nothing is emailed.
- **Next:** the on-device walk, real tenant rates, and a photo that checks a broker-typed "sprinklered: yes".

---

## Federato: the underwriting agent

### How the agent plans queries

The planner (`packages/federato/src/planner`) builds its queries from the live schema, not a fixed script.

1. **Read** the schema into a resource graph, and **collect** every field the rulebook and rating table need.
2. **Locate** each field: a synonym table, then a shortest-path search through the graph. Anything the table cannot place stays **visibly unmapped** in the trace. The planner also accepts an injected Gemini `schema-assist` (matches accepted only at 0.8 confidence or higher), but it is **not enabled in the shipped ingest path** — on this dataset the synonym table and graph search place every field the rulebook needs except building-level protection class, which Federato stores on the location.
3. **Triage:** one query over all 158 submissions for id, status, and line of business. 120 are knocked out on line of business, with the rule cited.
4. **Deep pass:** one `Policy` query expanding insured, claims, and exposure units down to buildings. It returns all 27 property policies fully hydrated in one query. The trace records why `Submission` was rejected as root: no premium, TIV, or building fields.
5. **Adapt.** On the live handler a dot-path through an array silently matches nothing (`exposure_units.location.state: CA` returns 0 rows; the `$elemMatch` form returns 47). On zero results the planner rewrites the clause into `$elemMatch` form, or drops the narrowest filter, and records which. It also **declines `over`**: the docs call it a GROUP BY, but the deployed handler returns one row per record and a constant `$sum`. The planner strips it and writes the reason into the trace; the engine does every rollup.
6. **Trace.** Each query is stored with its goal, the rule that needed it, the path and why, the payload, row count, and duration. The console shows this as "How the agent got here".

Live: `npm run seed` ran 4 planner queries in 9.2 s and stored all 158 submissions, 158 scored, 158 with a query trace.

### Scoring against the eight factors

Each submission becomes an 11-component feature vector. The appetite score is `100 × (w · t)` over Federato's eight factors (weights: line, state, TIV, premium 0.15 each; submission type, building age, construction, loss 0.10 each), with tiers 0 / 0.6 / 1. Any Not Acceptable tier is a knockout. Missing data is never imputed; it forces REFER. Every rule cites its `APPETITE_GUIDELINES.pdf` row verbatim. Retrofit's own sprinkler and protection-class rules sit in a separate, labelled rulebook and never touch the score.

**The book:** 1 FIT, 11 REFER, 146 DOES_NOT_FIT (120 knocked out at triage on line of business). PRD 7.2 predicted "few will be FIT". The #1 account is **SUB-2026-00081, Coastal Freight Systems LLC**: FIT, appetite 88/100, TIV $18.5M, quoted $58,800 vs predicted $62,725.

### Interpretations of the ambiguous guidelines

Shown on the rule card and in the explanation when decisive. Full contract: `docs/contracts/INTERPRETATIONS.md`.

| Ambiguity | Retrofit's reading |
| --- | --- |
| "Primary risk state" has no field; policies span up to four states | The state with the largest share of TIV |
| Building age across many buildings | Not Acceptable when more than 50% of TIV is pre-1990; REFER when any building is pre-1990, naming it |
| Fire Resistive classes are unlisted | Treated as acceptable, flagged as an assumption |
| Loss value | Paid indemnity + paid expense + open reserves, within five years of the received date |
| Exact boundaries ($150M, $50K, 50%) | Resolve to the friendlier tier |

### Pricing

Predicted premium is the sum of `tiv ÷ 100 × baseRate × construction × age × protectionClass × sprinkler` per building, times a loss-history factor. Factors were fitted by least squares on the 27 real policies (R² 0.72), constrained monotonic, and frozen into `packages/engine/rating/commercial.json`. Adequacy is quoted ÷ predicted; the five nearest peers give a rate and loss benchmark.

### Explanations

A deterministic template over the fired rules writes 2–3 sentences for every submission, so all 158 exist instantly and never contradict the numbers. Gemini may polish the wording; a positional guard rejects any edit that changes a number or the recommendation.

### Verification

Final 10M numbers: see `VERIFICATION.md`.

- **A + B:** property tests, plus a naive second implementation written by an agent that never saw the engine code, from the PDF and our shared interpretation contract (`docs/contracts/INTERPRETATIONS.md`). Because both implement the same contract, layer B catches arithmetic and logic errors but cannot catch an interpretation both sides share — that is what layer C is for. At 100K: 0 invariant violations, 0 disagreements.
- **C:** a Gemini second opinion given only the guideline text and each account's rolled-up facts — never the engine's score, tier or verdict. The facts are the ones the engine scored on, and the construction fact already counts Fire Resistive as acceptable (our interpretation I-3), so layer C tests judgement *given* our interpretations, not the interpretations themselves. 1,331 of 1,332 agreed (99.9%, 95% CI 99.6–100.0%); all 38 real property accounts agreed. The one disagreement is exactly-50% acceptable construction, which the PDF leaves open (Acceptable needs ">50%", Not Acceptable is ">50% other types"; at exactly 50% neither holds). 706 of the planned 2,038 cases went unanswered when the credits ran out mid-run.

**The tests found real bugs.** The differential started at 20,662 invariant violations and 1,369 disagreements: a hole in our own interpretation contract and a peer-distance overflow. A review of the real data then found 39 confirmed defects, including every building assigned the first location's id (wrong state on 11 of 27 accounts), only 38 of 158 submissions stored, broker answers silently dropped, and zero FIT accounts because a date conflict present on all 27 accounts was wrongly treated as blocking. All are fixed and logged in `DECISIONS.md`.

### Live ↔ snapshot

Leave `FEDERATO_BASE_URL` empty and the API runs `MockFederatoAdapter` over a saved snapshot of the real data: same query contract, no code change. A banner on startup and on every console page names the source.

---

## Rox: the action loop over messy data

It routes each live account to an underwriter whose region and authority fit, drafts a broker request naming exactly the missing or contradicted fields, and reads the free-text reply back into typed fields. Each field must carry a verbatim quote that code finds in the reply, pass type and range checks, and clear a 0.8 confidence gate; then the account re-scores and the before and after are logged. Live, the reply *"The main building was built in 1998, it's joisted masonry, and total insured value is about $64.5M. Five-year losses total $42,000."* became four typed fields, and SUB-2026-00118 (Lakeside Medical Group LLC) moved from rank 8 to rank 2.

---

## Architecture and repo map

Federato → `packages/federato` → `apps/api` (calls `packages/engine`) → `apps/console` and `apps/mobile`.

| Workspace | Role |
| --- | --- |
| `packages/engine` | Pure TypeScript, zero I/O: vector specs, rulebooks, rating tables, every stage from rollup to rank |
| `packages/federato` | OAuth adapter, snapshot mock, planner and trace, explanation templates, routing and requests |
| `packages/contracts` | Wire types shared by the API and both apps |
| `packages/design` | Tokens for console and phone, with a contrast test |
| `packages/verify` | Generators, naive second implementation, invariants, layer C |
| `apps/api` | Hono + SQLite, enrichment, Gemini layer, action loop, seed |
| `apps/console` | Vite + React: queue, submission detail, actions, rules, glossary, aggregate |
| `apps/mobile` | Expo Router tenant quote app |

---

## macOS setup

Requires Node 24.

```sh
npm install
cp .env.example .env
```

Set `GEMINI_API_KEY`; the five `FEDERATO_*` variables (`BASE_URL`, `TOKEN_URL`, `AUDIENCE`, `CLIENT_ID`, `CLIENT_SECRET`), leaving `FEDERATO_BASE_URL` empty for the snapshot; `PORT` (default 3000); and `EXPO_PUBLIC_API_URL` for the phone.

```sh
npm run seed          # ingest, score, enrich all 158; plan actions
npm run dev:api       # API on :3000
npm run dev:console   # console on http://127.0.0.1:5173
npm test              # full suite, including the 100K property + differential run
npm run verify        # layers A + B at 10M
npm run verify:llm    # layer C (needs Gemini credits)
```

---

## Accessibility

- **Colour never carries meaning alone.** Verdict pills pair colour with a mark and a label (● FIT, ◐ REFER, ○ DOES_NOT_FIT).
- **Contrast is tested:** `packages/design` checks token pairs against WCAG ratios.
- **Console:** labelled controls, `aria-sort` on sortable tables, live regions for loading, visible focus, reduced-motion support.
- **Phone:** 44 × 44 pt minimum targets, Dynamic Type, accessibility labels, plain-language questions, and a photo-upload path for anyone who cannot turn in place.

---

## Domain

The intended domain is **retro.fit**. It is **not registered yet**; registering it and pointing it at the console is a human step.
