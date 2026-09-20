# R3 — Federato judge review (planner trace, mock parity, explanations)

Reviewer: R3 (read-only). Date: 2026-09-19. Everything here comes from running the code offline against the committed real snapshot. No network was used and no source file was edited.

## How it was run

These scripts live in the R3 scratchpad and are not committed:

- `r3-ingest.mts`: in-memory SQLite, `createMockAdapter({ snapshot: loadSnapshot() })`, fake LLM, `ingestFederato(deps, { lineOfBusiness: 'commercial_property' })`, then dumps every stored row.
- `r3-console.mts`: same setup, then `createApp({ deps })` is bridged into `createApiClient({ fetchImpl })` and `getSubmission()` is called. This is exactly what the console renders.
- `r3-parity.mts`: mock queries checked against the measured facts in LIVE_DATA_FACTS.
- `r3-adapt.mts`: the `$elemMatch` swap run on the real schema and data.

## What a judge sees in "How the agent got here" (real snapshot)

| Step | Pass | Rows | Note rendered (red) |
|---|---|---|---|
| 0 | triage, Submission | 158 | `none` |
| 1 | deep, Policy (expands insured, submission, claims, exposure_units.location.buildings) | 27 | `none · Server-side aggregation declined. ...` |
| 2 | no_policy_followup, Submission -> insured -> hq | 11 | `none` |
| 3 | high_scorer_followup (SUB-2026-00081 only) | 1 | `none` |

Verdict from a judge's seat: this reads as a fixed four-step script.

- **The payloads are literals in `plan.ts`.** The locate step only appends a "Located fields under Policy: ..." suffix to a string, and the console never shows that string.
- **The planner never adapts on real data.** No planned query has a dot-path that crosses an array, so the `$elemMatch` swap never fires. It is correct when forced (CA filter: 0 rows, then 47 after the swap). It is simply unreachable in the demo.
- **The `over` "decline" is canned.** It is a pre-written paragraph attached to every deep query. The planner never builds an `over` clause and then removes it.
- **What each query taught the agent is never written down.** Examples:
  - The triage entry does not say "120 knocked out: health 36, cgl 21, auto 20, cyber 18, excess 15, lpl 10".
  - The deep entry does not say "27 of 38 survivors hydrated, so 11 need another route".
- **The console hides the reasoning the trace already records.** `apps/console/src/api/client.ts` `queryTraceView` keeps only goal, rows, ms, notes and payload. It drops these fields:
  - `pathChosen.why`
  - `alternativesRejected`
  - `requiredBy`: which rule needed the query, which PRD §7.5 step 6 requires

  Those dropped fields are the only parts of the trace that read like thinking.

## Mock parity with QUERY_REQUEST_BODY.pdf (operators the planner emits)

The mock matches the measured live behaviour for everything the planner emits:

- `where` equality
- `where id $in [...]`
- a `filter` dot-path across a single expanded reference (`submission.submission_number $in`)
- nested `expand`
- `select` as an array
- `sort`
- `pagination.limit`
- `$elemMatch` nested at two array boundaries (`exposure_units` -> `location.buildings`)

A dot-path through an array returns 0 rows and the `$elemMatch` form returns 47 rows, which matches LIVE_DATA_FACTS. The no-policy status query returns 11. The mock implements `over` per the PDF, which P12 allows, and no query uses it. **No parity defects were found.**

## Explanations (all 38 read; 5 quoted)

Every explanation has three sentences and a recommendation, and every open HIGH contradiction is named. Several state things that are false:

1. **SUB-2026-00081** (rank #1, the only in-appetite account): "5-year losses $0 ... In appetite on every factor; conflicting values on received date; fire-resistive construction is treated as acceptable, an assumption."
   - The policy has a $629,200 claim, which the I-4 window excludes without saying so.
   - It has no Fire Resistive building: only Steel Frame and Wood Frame.
2. **SUB-2025-00115**: "Regional Branch 1 is referred ... broker must supply the missing submission type, primary state, TIV ..."
   - The insured is Halcyon Metalworks Corp. "Regional Branch 1" is the name of its HQ Location.
   - The submission was already declined for loss_history.
3. **SUB-2024-00076**: "...fire-resistive construction is treated as acceptable, an assumption." Every building is Joisted Masonry.
4. **SUB-2026-00038**: "missing loss history". The deep query fetched `claims: []`. That is a known $0 under I-4, not missing data.
5. **SUB-2026-00028**: "knocked out on premium and construction, which the insured cannot change." Premium is movable.

## Findings

Returned in structured form. Summary:

| Id | Severity | What is wrong |
|---|---|---|
| R3-1 | BLOCKER | Only 38 of 158 submissions are stored. The 120 line-of-business knockouts get no result, explanation or trace (PRD §15, §7.7, §10 /queue). |
| R3-2 | MAJOR | The console trace drops `why`, `alternativesRejected` and `requiredBy`, and prints a red `none` on every step. |
| R3-3 | MAJOR | The trace never records what it learned, and no adaptation ever fires on real data. The graded "adapting to results" is invisible. |
| R3-4 | MAJOR | The I-3 fire-resistive assumption is surfaced on every account with known construction, including accounts with no FR building. |
| R3-5 | MAJOR | All 11 no-policy accounts show the HQ Location's name as the insured name. |
| R3-6 | MAJOR | 4 policies with `claims: []` show as "missing loss history" instead of a known $0. |
| R3-7 | MAJOR | "5-year losses $0" on accounts carrying up to $1.6M of claims, with no disclosure that the window excluded them. |
| R3-8 | MAJOR | No-policy explanations recommend asking the broker for data on submissions already declined or lost. |
| R3-9 | MINOR | The "which the insured cannot change" clause is applied to premium. |
| R3-10 | MINOR | A NAICS vs SIC "insured.industry" contradiction is raised on all 38 accounts. |
| R3-11 | MINOR | The no-policy query claims AG-STATE-T needs `insured.hq.state`, but the HQ state it fetched is discarded and then requested from the broker. |
| R3-12 | MINOR | Every account's trace shows every query, including the other pass's queries, so the trace is not specific to the account. |
