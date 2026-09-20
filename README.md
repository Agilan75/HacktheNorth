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
- **No account in the book has a single-move flip.** Most declined property accounts fail on at least one factor the insured cannot change (building-age share, state, or renewal status), and the engine names which. The few knocked out on premium alone — which *is* movable — would need more than the two-component move the flip is capped at (PRD 6.4). Five accounts have a flip of some kind; none reaches FIT in one move. The flip is exercised on synthetic and tenant cases.
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

**The book:** 5 FIT, 4 REFER, 149 DOES_NOT_FIT — of which 120 are knocked out at triage on line of business (cyber, auto and the rest, which these guidelines never covered) and 29 are property accounts that fail a named rule. PRD 7.2 predicted "few will be FIT". The top of the queue is **SUB-2025-00138, Lumen Data Works Inc**: FIT, appetite 94/100, quality index 86.2, TIV $52.4M, quoted $154,000 against a predicted $149,978. The best account with no authored values is **SUB-2026-00081, Coastal Freight Systems LLC** at rank 6: FIT, appetite 88/100, TIV $18.5M, quoted $58,800 vs predicted $62,725.

**Why 29 property accounts still fail.** Counting the knockout factor on each (an account can fail more than one): premium outside $50K–$175K on 19, buildings older than 1990 on 14, risk state not on the carrier's list on 16 (TX, WA, MA, IL, NJ, TN), renewal rather than new business on 7, construction class on 6. These are Federato's own numbers judged against Federato's own table — SUB-2025-00001 quotes $619,900 on $112M of TIV, roughly three times the program's ceiling. The guidelines describe a small-account program ($50K–$175K premium, $50M–$100M target TIV) and much of the sample book sits above it.

**Eleven accounts carry authored values.** Federato holds no policy for SUB-2025-00115, -00126, -00132, -00134, -00138, -00143 and SUB-2026-00118, -00131, -00133, -00141, -00147, so they arrived with an insured name, industry, revenue and HQ state and nothing else: appetite 15/100, completeness 11%, no premium. Their location, building, premium and loss values were hand-authored from the fully populated peers and applied through the same `answer`-provenance merge a broker reply uses (`apps/api/data/backfill/*.json`, applied by `npm run backfill`). Every one is tagged `sourceDetail: "synthetic:backfill-v1"`, shows a **Synthetic** badge in the queue and on the account page, and is scored by the engine like any other account — the engine, not the author, decided each verdict. Four came out FIT, four REFER, three DOES_NOT_FIT.

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

### Seeing the book in 3D (`/explore`)

Three views over the same rows the queue shows, all reading the API's own numbers:

- **Appetite terrain** — the rules themselves as ground. The floor is TIV by quoted premium on log axes, cut at the exact band edges, and the height of each terrace is the appetite score the selected account would have if only those two values moved; every other factor stays where that account has it. The target bands rise as a red plateau, acceptable ground steps down around it, and knocked-out ground is drawn as an open wire cage, since a score there can never be written. The account's pin stands on its own terrace — its height *is* the score the queue shows — and a red arrow points at the nearest ground in both target bands, labelled with the change it would take. Band edges are parsed live from `GET /rules`, so each cliff is labelled with the rule that cuts it (`$150M · AG-TIV-NA`). Selecting a state-knocked-out account turns the whole landscape to cages: no TIV or premium rescues it.
- **3D scatter** — appetite score × pricing adequacy × TIV, sphere size the quoted premium, colour the verdict, a ring for authored values, and a floor for accounts with no price yet.
- **Network** — submissions linked to their underwriter, state, line of business and verdict; clicking a hub lights up its accounts.

All 158 accounts appear at once. The 120 with no TIV or premium wait in a labelled tray beside the floor rather than being dropped, each explaining itself on hover, and one checkbox hides them.

### Verification

Final 10M numbers: see `VERIFICATION.md`.

- **A + B:** property tests, plus a naive second implementation written by an agent that never saw the engine code, from the PDF and our shared interpretation contract (`docs/contracts/INTERPRETATIONS.md`). Because both implement the same contract, layer B catches arithmetic and logic errors but cannot catch an interpretation both sides share — that is what layer C is for. At 100K: 0 invariant violations, 0 disagreements.
- **C:** a Gemini second opinion given only the guideline text and each account's rolled-up facts — never the engine's score, tier or verdict. The facts are the ones the engine scored on, and the construction fact already counts Fire Resistive as acceptable (our interpretation I-3), so layer C tests judgement *given* our interpretations, not the interpretations themselves. 1,331 of 1,332 agreed (99.9%, 95% CI 99.6–100.0%); all 38 real property accounts agreed. The one disagreement is exactly-50% acceptable construction, which the PDF leaves open (Acceptable needs ">50%", Not Acceptable is ">50% other types"; at exactly 50% neither holds). 706 of the planned 2,038 cases went unanswered when the credits ran out mid-run.

**The tests found real bugs.** The differential started at 20,662 invariant violations and 1,369 disagreements: a hole in our own interpretation contract and a peer-distance overflow. A review of the real data then found 39 confirmed defects, including every building assigned the first location's id (wrong state on 11 of 27 accounts), only 38 of 158 submissions stored, broker answers silently dropped, and zero FIT accounts because a date conflict present on all 27 accounts was wrongly treated as blocking. All are fixed and logged in `DECISIONS.md`.

### Live ↔ snapshot

Leave `FEDERATO_BASE_URL` empty and the API runs `MockFederatoAdapter` over a saved snapshot of the real data: same query contract, no code change. A banner on startup and on every console page names the source.

---

## How a submission becomes a ranked verdict

Every number below is computed by code in `packages/engine`, which has no I/O, no clock, no randomness and no model. The same input always gives the same output. What follows is the whole path, in order.

### Step 0 — Authenticate and discover

`packages/federato/src/auth.ts` mints an OAuth token against `auth.product.federato.ai` (the custom Auth0 domain, not the canonical one — the other returns "401 Invalid token"). Tokens last four hours; the cache refreshes five minutes early, stamps expiry from request-send time so latency shortens rather than extends a token's life, and a 401 triggers exactly one re-mint. The secret is never logged; the startup banner prints the host only.

Then `{"action": "schema"}` is called **before any query**, and the response is flattened into a resource graph (`live-adapter.ts`, `planner/graph.ts`). Field names are never assumed. Every field the rulebook needs is located by a synonym table and a shortest-path search through that graph; anything unplaceable stays visibly unmapped in the trace rather than being guessed.

### Step 1 — Plan and run the queries

Four passes, all built from the discovered schema rather than hardcoded (detail in "How the agent plans queries" above):

1. **Triage** — one query over all 158 submissions for id, status and line of business. 120 are knocked out here on line of business, each citing the rule.
2. **Deep** — one `Policy` query expanding insured, claims and exposure units down to buildings; 27 property policies hydrated in a single call, 1.4 s.
3. **No-policy** — a results-derived pass for survivors the deep query returned nothing for.
4. **Follow-up** — an extra hydration pass for accounts that scored well and were not knocked out, expanding coverages, endorsements and producer.

Failures adapt rather than abort: a zero-row filter is rewritten into `$elemMatch` form (a dot-path through an array silently matches nothing on the live handler), then the narrowest filter is dropped, then the projection is reduced to a minimal one. Each attempt is its own trace row pointing back at the one it replaced. Server-side `over` aggregation is deliberately declined, with the measurement that justifies it recorded in the trace.

### Step 2 — Normalise into one canonical record

Every raw bundle is mapped onto a single `CanonicalSubmission` shape. Each field is stored as a list of `{value, provenance}` pairs, never a bare value — so the record can hold the broker's TIV *and* an enrichment's TIV at once, each knowing where it came from (`self_reported`, `enrichment`, `sweep`, `answer`). Nothing is ever overwritten.

### Step 3 — Merge, then roll up

`merge` folds external values — enrichment, camera observations, broker answers, the authored backfill — into the canonical record by dotted path. It only appends.

`rollup` then computes the derived facts the rules actually read, over the merged record rather than the broker's version alone:

- **Total TIV**, summed across buildings
- **Primary risk state** — the state holding the largest share of TIV (the guidelines name the factor but the API has no such field)
- **Share of TIV pre-1990 and post-2010**, and the oldest and newest build years
- **Share of TIV in acceptable construction classes**
- **Five-year loss** — paid indemnity + paid expense + open reserves, inside a five-year window ending at the received date
- **TIV-weighted protection class** and **share sprinklered**

### Step 4 — Detect contradictions

Any field holding two materially different values is flagged (`contradict.ts`): numbers compared within a money tolerance, strings trimmed and case-folded, so "oh" versus "OH" is not a conflict. Severity is earned, not assumed — a contradiction is HIGH only when some rule actually reads a field that path feeds. An open HIGH contradiction forces REFER. A broker answer closes a contradiction only when it confirms the value that was scored on.

### Step 5 — Vectorise: values become tiers

Each account becomes an 11-component feature vector. For every component the engine records three things: the raw value `x`, the tier value `t`, and a known/unknown mask `m`. The tier comes from the guidelines table:

| Tier | Value | Meaning |
|---|---|---|
| Target | 1.0 | the preferred band |
| Acceptable | 0.6 | inside appetite, not preferred |
| Not acceptable | 0.0 | a knockout |

Four factors — submission type, line of business, construction and loss value — have a blank Target column in the PDF, so Acceptable scores 1.0 for them rather than being penalised for a tier the carrier never defined.

The bands themselves, verbatim from page 2 of `docs/federato/APPETITE_GUIDELINES.pdf`:

| Factor | Weight | Target | Acceptable | Not acceptable |
|---|---|---|---|---|
| Submission type | 0.10 | — | New business | Renewal |
| Line of business | 0.15 | — | Property | All other lines |
| Primary risk state | 0.15 | OH PA MD CO CA FL | + NC SC GA VA UT | All other states |
| TIV | 0.15 | $50M–$100M | up to $150M | over $150M |
| Total premium | 0.15 | $75K–$100K | $50K–$175K | under $50K or over $175K |
| Building age | 0.10 | newer than 2010 | newer than 1990 | older than 1990 |
| Construction | 0.10 | — | >50% JM / non-combustible / steel / masonry NC | >50% other |
| Loss value | 0.10 | — | under $100,000 | over $100,000 |

### Step 6 — Evaluate: tiers become a score

For each of the eight factors:

```
known   = every component of that factor has a value
points  = known ? 100 × weight × tierValue : 0
```

and the appetite score is the sum:

```
appetiteScore = 100 × Σ (weight × tierValue)
```

So a perfect account scores 100, an all-Acceptable one scores 60, and a missing factor scores 0 — **the remaining weights are not rescaled**, because pretending a missing factor doesn't exist would reward incomplete submissions. A knockout decides the verdict but does not zero the score; an account can be out of appetite and still score 69.

Two more numbers fall out here:

- **Completeness** = the share of required components that are known, as a percentage.
- **Confidence** = the combined source confidence of the fields the deciding rule read.

Weights live in `packages/engine/rules/commercial.json` and must sum to 1 — a schema check fails the build otherwise.

### Step 7 — Price

Predicted premium is built per building and summed:

```
buildingPremium = tiv ÷ 100 × baseRate × construction × age × protectionClass × sprinkler
predicted       = Σ buildingPremium × lossHistoryFactor
```

The factors were fitted by least squares against the 27 real policies (R² 0.72), constrained monotonic and frozen into `packages/engine/rating/commercial.json`. **Adequacy** is quoted ÷ predicted — above 100% is overpriced, below is underpriced. The five nearest peers by vector distance give a rate-per-$100-of-TIV benchmark and a mean annual loss, which also feeds expected loss.

### Step 8 — Flip: what is the smallest change that fits?

The flip search asks whether this account could reach FIT, and at what cost. It considers at most two components, singles before pairs, and skips components the insured cannot change (state, build year, renewal status). A candidate set is kept only if the result actually evaluates to FIT. Output: the moves, the score before and after, and the premium before and after. When nothing works it says why — "every failing component is immovable: state, building age" — rather than going quiet.

### Step 9 — Verdict: the ladder

Five rungs, checked in order (`verdict.ts`). The appetite score is never compared to a cutoff:

1. Any factor knocked out → **DOES_NOT_FIT**
2. Completeness below 100% → **REFER** (missing data is never imputed)
3. An open HIGH contradiction → **REFER**
4. A refer-tier rule fired (for example protection class 9 or worse) → **REFER**
5. Otherwise → **FIT**

The deciding factor is the earliest knockout in factor order, or else the lowest tier, breaking ties by weight. It carries the rule id and the verbatim quote from the guidelines PDF.

### Step 10 — Rank the queue

Ranking uses a broader quality index than appetite alone, because an account that fits but is badly underpriced is not the best use of an underwriter's next hour:

```
qualityIndex = 0.50 × appetite
             + 0.20 × adequacy
             + 0.15 × lossRatio
             + 0.10 × completeness
             + 0.05 × confidence
```

A term whose input is missing is dropped and the rest renormalised — never imputed. Knockouts sort below every non-knockout regardless of index, and among themselves by distance to appetite (one move, then two), so the closest misses surface first. Ties break on id, so the order is stable.

### Step 11 — Value of information

For every unanswered question, the engine computes how much the score could move if it were answered, and ranks the questions by that. This is what decides which fields a broker request asks for — not a model.

### Step 12 — Explain

A deterministic template turns the fired rules into three sentences: what it is and how it scores, which factors are in and out, and a recommendation (`accept`, `review`, `decline`, `investigate`) with the reason. All 158 exist instantly and cannot contradict the numbers. Gemini may polish the wording, and a positional guard rejects any edit that changes a number, reorders quoted against predicted premium, or alters the recommendation — on failure the template text is used.

### Step 13 — Act

Each surviving account is routed to an underwriter whose region matches the primary state and whose authority limit covers the requested limit (smallest qualifying authority wins), and a broker request is drafted naming exactly the missing or contradicted fields. A reply is read back into typed fields: each must carry a verbatim quote code can find in the source, pass type and range checks, and clear a 0.8 confidence gate. Then the account re-scores and the before/after and rank movement are logged.

### Where the LLM is, and is not

Eight model calls exist. None of them decides anything:

| Call | What it does | What stops it deciding |
|---|---|---|
| `observe` | lists objects in a photo | fixed vocabulary; code turns objects into hazards |
| `relate` | suggests hazard pairs | engine pair rules run first |
| `verify-fix` | checks a fix photo | defaults to "still counted" when unclear |
| `narrate` | polishes explanation prose | positional number and recommendation guard |
| `schema-assist` | suggests field mappings | 0.8 gate, must exist in the schema; disabled in the shipped ingest |
| `draft-request` | writes the request email | code picks the fields; any new dollar figure rejects the draft |
| `extract-reply` | reads values out of a reply | quote must appear in the source; type and range checked |
| `second-opinion` | verification only | never sees engine output, never called from a request path |

---

## Requirements coverage

Audited against `docs/federato/STUDENT_PROJECT_GUIDELINES.pdf` by reading the code, not by memory. Gaps are listed as plainly as the passes.

### Minimum viable solution

| Requirement | State |
|---|---|
| Queries the API successfully | **Yes** — 4 planner queries, 9.2 s, live |
| Applies appetite guidelines using logic | **Yes** — rulebook transcribed from page 2, weights enforced to sum to 1 |
| Ranks submissions by a calculated score | **Yes** — quality index, stable ordering |
| Shows a list with brief explanations | **Yes** — all 158 carry a 3-sentence explanation |
| Handles 50+ submissions in reasonable time | **Yes** — 158 ingested and scored in 9.2 s; scoring alone runs at 3,631 cases/second |

### Strong and exceptional

| Requirement | State |
|---|---|
| Queries constructed dynamically, not hardcoded | **Yes** — needed fields derived from the rulebook, roots chosen from the schema graph, rejected alternatives recorded |
| Explanations detailed and justify every decision | **Yes** — per-factor tier, weight, points, rule id and the verbatim PDF quote |
| Handles edge cases (missing fields, API issues) | **Yes** — minimal-projection fallback, `$elemMatch` rewrite, filter widening, snapshot fallback, enrichment timeouts |
| Clean code, good error messages | **Yes** — 2,036 tests, typed errors, no secret ever logged |
| Traceable agentic reasoning | **Yes** — per-submission query trace, shown as "How the agent got here" |
| Adapts based on results | **Yes** — deeper pass for high scorers, separate pass for no-policy accounts, retry ladder |
| Contradictions addressed transparently | **Yes** — the panel shows both sides with source and confidence, and the explanation prose names the conflict, both sources, and whether the verdict survives either value. One conflict shape exists in the book (two received dates, 27 of 158 accounts), so this is proven on a single class |
| Polished, actionable UI | **Yes** — accept or decline with a reason, re-run the agent, run enrichment, approve a request, paste a broker reply and watch the account re-score. A decision is recorded *beside* the engine's verdict and never over it: the verdict, its deciding rule and its score stay exactly as computed |

### Named pitfalls from the guidelines

| Pitfall | How it is avoided |
|---|---|
| Hardcoding queries | a planner builds them from the rulebook and the schema graph |
| Ignoring schema discovery | `{"action":"schema"}` runs first on every ingest; unmapped fields stay visible |
| No explanations | every submission has one, with the deciding rule quoted |
| Dot-paths on arrays | `$elemMatch` at every array boundary, computed from the schema (`exposure_units.location.state: CA` returns 0 rows; the `$elemMatch` form returns 47) |
| References without `$expand` | broker, contact and insured names come from `$expand` leaves; an unexpanded id yields `null`, never a guessed name |
| Overthinking enrichment | core reasoning first; enrichment is the last thing built, and it shows |
| UI over reasoning | twelve panels exist because the engine has twelve things worth showing |

### What does not meet the bar

- **Only one of the three external APIs reaches a decision.** Flood does. `rollup.worstFloodZoneTier` is fed by the OpenFEMA National Flood Hazard Layer — a field Federato's schema does not carry at all, which the planner reports as unmapped rather than silently dropping — and it is read by the extension rules `X-FLOOD-SFHA` and `X-FLOOD-COASTAL` and by a flood load in the rating table. So a fetched zone refers an account and raises its predicted premium, which lowers its price adequacy, which moves the ranked order: on the current book it repriced 13 accounts and moved 19 of the 27 property accounts' rank or price. Fire-station distance is still fetched, stored and displayed but feeds no rule, and the public Overpass mirrors were rate-limited on the night anyway, reaching 2 of 27 accounts; Nominatim only supplies the coordinates FEMA is then asked about.
- **The flood load is a judgement, not a fit.** Every other rating factor is least-squares fitted against the carrier's own technical premium. Only three real policies sit inside a flood zone, far too few to fit from, so the 15% inland and 35% coastal loads are a stated assumption. The dry load is pinned at exactly 1, so an account outside the mapped hazard — or one whose flood enrichment never ran — prices exactly as it did before flood existed, and the fitted MAPE still describes it.
- **The contradiction guarantee is proven on one conflict shape.** Every account carrying a source conflict names it in its own explanation, with both values, the field each came from, the rules it feeds and whether the verdict survives either value. But the real book contains exactly one shape of conflict — two competing received dates, on 27 of 158 accounts — so the other shapes are exercised only on synthetic cases.
- **The minimal flip has no live example.** Across the current book, 5 accounts have any flip and **none** is a single move to FIT, so the flip panel is a working feature with nothing to show on real data. It is exercised on synthetic and tenant cases.
- **Pagination is limit-only.** The planner requests 200 rows and warns if more exist rather than paging with `offset`. Correct for a 158-record book; it would silently truncate a larger one.
- **"Every verdict names its deciding rule" is not universal.** `decidingRule` is null when no factor carries a citation — an account with every factor missing, for instance. The UI says so in words rather than inventing a rule.
- **`createSentrySink` throws `NOT_IMPLEMENTED`** and `app.ts` still registers 501 fallbacks behind every real route. Nothing 501s today, but both are visible in the source.

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
| `apps/console` | Vite + React: queue, submission detail, actions, rules, glossary, aggregate, 3D explore |
| `apps/mobile` | Expo Router tenant quote app |

---

## macOS setup

Requires Node 24.

```sh
npm install
cp .env.example .env
```

Set `ANTHROPIC_API_KEY`; the five `FEDERATO_*` variables (`BASE_URL`, `TOKEN_URL`, `AUDIENCE`, `CLIENT_ID`, `CLIENT_SECRET`), leaving `FEDERATO_BASE_URL` empty for the snapshot; `PORT` (default 3000); and `EXPO_PUBLIC_API_URL` for the phone.

```sh
npm run seed          # ingest, score, enrich all 158; plan actions
npm run backfill -w @retrofit/api   # apply the authored values for the 11 no-policy accounts, then re-score and route
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
