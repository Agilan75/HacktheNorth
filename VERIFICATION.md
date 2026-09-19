# Verification

Generated 2026-09-19T16:38:04.459Z (run started 2026-09-19T15:52:09.876Z). PRD §12. Every count below is the number of cases actually completed, not the number requested.

## Headline

| Layer | Cases completed | Result |
| --- | --- | --- |
| A. Property tests | 10,000,000 | 0 invariant violations |
| B. Differential (naive second implementation) | 10,000,000 | 0 disagreements |
| C. LLM second opinion | 1,332 | 1,331 agreed, 99.9% (95% Wilson interval 99.6% – 100.0%, n = 1,332) |

## Reading these numbers

**The zeros were earned, not assumed.** The first 100K differential run on the finished engine reported **20,662 invariant violations and 1,369 engine-vs-naive disagreements**. They traced to three root causes, all fixed before this run:

1. **A hole in our own interpretation contract.** `INTERPRETATIONS.md` specified how to compare state codes and construction types, and said nothing about submission type or line of business. The engine and the naive implementation filled the gap differently (one case-folded `"NEW_BUSINESS"`, one did not; one read a blank string as missing, one as out-of-list). Neither was buggy — the contract was. It was closed with rule G-11 on underwriting grounds, and each side was brought into line with the contract once, never by copying the other. The naive implementation stayed isolated from the engine code throughout (checked by grep at every checkpoint).
2. **Peer distance overflowed** on the generator's deliberately absurd inputs (±1.8e308), violating PRD 12's own rule that scaling keeps every distance component in [0, 1].
3. **The symmetry invariant** counted a null-both-ways distance as asymmetric.

A second, independent review of the **real** Federato data (not synthetic cases) then found **39 confirmed defects** the differential could not see, because they live in how real records are read rather than in the scoring arithmetic — for example, every hydrated building was being given the first location's id, which put the primary risk state wrong on 11 of the 27 real accounts. All 39 were fixed and are pinned by integration tests over the real snapshot. See `DECISIONS.md`, sections CP1 and Run 2.

**What layer B can and cannot catch.** The naive implementation was written by an agent that never saw the engine code, from `APPETITE_GUIDELINES.pdf` **and our shared interpretation contract**. So layer B catches arithmetic, boundary and logic errors, but it cannot catch an interpretation error that both implementations share. That is layer C's job.

**What layer C can and cannot catch.** Gemini sees the guideline text and each account's rolled-up facts — never the engine's score, tier, knockouts or verdict. The facts are the ones the engine scored on, so a disagreement is purely a question of judgement. One interpretation is folded into the facts: the construction share already counts Fire Resistive and Modified Fire Resistive as acceptable (interpretation I-3), so layer C cannot disagree with us on that one. It tests judgement *given* our interpretations.

**The one disagreement is a genuine gap in the guidelines, not an engine bug.** At exactly 50% acceptable construction, the PDF says Acceptable requires ">50%" and Not Acceptable is ">50% other types" — at 50/50 neither condition holds. We chose Acceptable (the friendlier tier, applied consistently at every boundary; `INTERPRETATIONS.md` §3.5). Gemini read ">50%" as a hard floor. Both readings are defensible, and PRD 12 predicted exactly this: disagreements cluster on the ambiguities. Changing the decision is one line in the rulebook, and it is shown to the underwriter on the rule card either way.

**Why 706 layer-C cases are unanswered.** The Gemini API key's prepaid credits ran out part-way through the run (HTTP 402, "prepayment credits are depleted"). 1,332 stratified cases — including all 38 real property accounts — were answered first, which is well past the point where PRD 12 says agreement stops moving. Topping up the credits and re-running `npm run verify:llm` resumes from the on-disk cache and answers only the remaining 706.

## Layers A and B

- Requested: 10,000,000 cases, seed 20260919, 6 workers, chunk size 10,000.
- Completed: 10,000,000 cases.
- Throughput: 3,631 cases per second.
- Invariant violations: 0.
- Engine-versus-naive disagreements: 0.
- Cases that threw: 0.

## Layer C: LLM second opinion

- Cases judged: 1,332.
- Agreed with the engine: 1,331.
- Agreement rate: 99.9% (95% Wilson interval 99.6% – 100.0%, n = 1,332).
- Disagreements: 1.

| Stratum | Cases | Agreed | Rate |
| --- | --- | --- | --- |
| real_property | 38 | 38 | 100.0% |
| contradiction_open | 40 | 40 | 100.0% |
| state_tie_break | 60 | 60 | 100.0% |
| construction_fire_resistive_decides | 80 | 80 | 100.0% |
| age_refer_unknown_tiv_pre1990 | 60 | 60 | 100.0% |
| age_pre1990_exact_half | 80 | 80 | 100.0% |
| age_pre1990_just_over_half | 60 | 60 | 100.0% |
| age_post2010_exact_half | 60 | 60 | 100.0% |
| construction_exact_half | 80 | 79 | 98.8% |
| construction_just_under_half | 60 | 60 | 100.0% |
| tiv_at_150m | 70 | 70 | 100.0% |
| tiv_just_over_150m | 60 | 60 | 100.0% |
| tiv_at_100m | 50 | 50 | 100.0% |
| tiv_at_50m | 50 | 50 | 100.0% |
| premium_just_under_50k | 60 | 60 | 100.0% |
| premium_at_50k | 60 | 60 | 100.0% |
| premium_at_75k | 50 | 50 | 100.0% |
| premium_at_100k | 50 | 50 | 100.0% |
| premium_at_175k | 60 | 60 | 100.0% |
| premium_just_over_175k | 60 | 60 | 100.0% |
| loss_at_100k | 70 | 70 | 100.0% |
| loss_just_over_100k | 29 | 29 | 100.0% |
| loss_zero_known | 5 | 5 | 100.0% |
| age_refer_minority_pre1990 | 7 | 7 | 100.0% |
| state_multi | 9 | 9 | 100.0% |
| state_acceptable_tier | 4 | 4 | 100.0% |
| submission_not_new | 1 | 1 | 100.0% |
| line_not_property | 1 | 1 | 100.0% |
| missing_component | 5 | 5 | 100.0% |
| ordinary | 13 | 13 | 100.0% |

### Every layer-C disagreement

#### V03:947746280:34 (stratum `construction_exact_half`) — cached

- **Engine:** FIT, deciding factor `tiv`. Appetite score 88.0, completeness 100.0%, knockouts: none.
  Tier values: submission_type 1, line_of_business 1, primary_risk_state 1, tiv 0.6, total_premium 0.6, building_age 1, construction_type 1, loss_value 1.
- **Model:** DOES_NOT_FIT, deciding factor `construction_type`.

> The guideline specifies that Acceptable construction type requires ">50% JM, non-combustible/steel, or masonry non-combustible". The submission has exactly 50% of TIV in acceptable construction types, which fails to meet the >50% threshold and is therefore Not Acceptable. Under Rule 1, "If any factor is Not Acceptable, the verdict is DOES_NOT_FIT", with construction_type being the first Not Acceptable factor.

## Caveats

- Layer C is capped: agreement stops moving after a few thousand stratified cases, and ten million model calls would cost thousands of dollars.
- The model is the less reliable party. A layer-C disagreement is a lead, not proof the engine is wrong.
- The app also uses Gemini, so layer C is a weaker independent check than a second vendor would be. Layer B is the real correctness check.
- The model sees only the guideline text and the rolled-up facts — never the engine's score, tier, knockouts or verdict. The facts are the engine's own rollup, with interpretation I-3 folded into the construction share (see *Reading these numbers*).

## Layer C: run notes

- Real property submissions in the run: 38 (of 38 in the book).
- Agreement means the model reached the same verdict. The deciding factor is compared separately: 1319 of 1331 agreeing cases also named the same deciding factor.
- Cases the model did not answer (excluded from every count above): 706. Rerun `npm run verify:llm` to resume from the cache.

## Extraction check

**Not measured.** The check scores the `extract-reply` call against 30 written broker replies with known answers (clean, partial, vague, self-contradicting, loss-run). It runs after layer C, and by then the Gemini credits were exhausted: every extraction call returned HTTP 402 and came back empty. The resulting score (21 of 51 fields, 41%) measures the billing failure, not the model — the clean replies scored 0 of 15 while the vague ones scored 7 of 7, because an empty answer happens to be "correct" when nothing should be extracted. It was discarded, kept out of `summary.json`, and the console shows "Not measured". The companion figure, "0 wrong values through the 0.8 gate", is equally vacuous (nothing was extracted) and is not claimed either.

The only live evidence is the end-to-end smoke (`docs/status/smoke.md`): one conversational broker reply produced **4 of 4 fields correct**, each with a verbatim source quote checked by code. That is one reply, not an accuracy rate.

To measure it: run `npm run verify:llm`. Reply extraction has since moved to Claude Sonnet 5 (DECISIONS L-1, L-2) and works live, so the check now calls Claude rather than the exhausted Gemini key.

