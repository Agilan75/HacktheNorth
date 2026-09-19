# R2b G2: decisions

Files: `packages/engine/src/stages/merge.ts`, `packages/federato/src/actions/apply-reply.ts`,
`packages/federato/src/actions/validate.ts`, `apps/api/src/services/reply.ts`,
`apps/api/src/services/actions.test.ts`, plus the test file next to each. `request.ts` and `actions.ts` were not changed.

## R-I4-2: accepted answers that went nowhere

### D1: merge lands the paths the request asks for (merge.ts)
- `buildings.*.<leaf>` / `locations.*.<leaf>` go to the account's only building or location.
  - With none, merge creates one reported entity (`reply-building-1`, labelled "reported by broker"; `reply-location-1`).
  - With several, `*` is ambiguous and the value is dropped.
  - A concrete id the account does not have is still dropped (the old G-1 behaviour).
  - Rollup already ties one building to one location with its only-location rule, so a reported building gets the reported state.
- `rollup.totalTiv` goes to the TIV of the only (or reported) building. It is dropped when there are several buildings.
- `rollup.fiveYearLoss` goes to one aggregate claim (`reply-five-year-loss`) with `paidIndemnity` = the total.
  - Its `dateOfLoss` is the best `receivedDate`, which is the inclusive end of the I-4 window. That date carries the answer's provenance.
  - It lands only when no claim is listed, or when the aggregate claim already exists (a second answer joins the same claim).
  - It is dropped when there is no ISO received date. Merge does not know `asOf`, so it cannot promise the value falls inside the window.
  - Effect: `fiveYearClaimCount` = 1, so the expected-loss frequency treats the answer as one claim. This is accurate for the seeded reply ("one water damage claim ... $42,000").
- Every other `rollup.*` path is derived arithmetic and is dropped.
- Rejected alternative: stop asking for `*`/`rollup.*` in request.ts. That hides the gap, and the no-policy accounts would have nothing to ask for (fixer 4 D2 agrees).
- Rejected alternative: a rollup override slot. That needs rollup.ts and types.ts, which I do not own.

### D2: applyReply proves each value lands (apply-reply.ts)
- Each accepted value is merged, in order, with the engine's own `merge`, exactly as the re-score will merge it. If the merge writes no new field, the value is moved from accepted to rejected with `rejection: 'not_applied'`, and it is left out of `externalValues`. The same change is made in `extracted`, so the log agrees.
- Using the real `merge` keeps a single source of truth. A second path grammar in apply-reply would drift.
- `'not_applied'` is not a member of the frozen `ExtractionRejection` union. I used a local cast with `TODO(contract)`. The DTO field is `string`, so the value reaches the wire unchanged. **Contract change wanted:** add `| 'not_applied'` to `ExtractionRejection` in `packages/federato/src/types.ts`.
- reply.ts: the action note now says `not applied: <paths>`. The status and the rescore action follow `accepted`, which now holds only values that landed.

## R4-4: prose dates in the gate (validate.ts)
- `parseDate` accepts ISO, "Month D, YYYY" (full or short month name, optional period and ordinal), "D Month YYYY", and "M/D/YYYY" read US-style. It returns ISO.
- It checks the real month length, leap years included. `new Date()` is never used.
- A non-ISO string that is not a real date is `unparseable`.
- Change: `2025-02-29` was accepted before, because the old check only had day ≤ 31. It is now rejected.
- reply.ts's duplicate pre-conversion is removed. validate.ts is the one gate for every caller.

## actions.test.ts "skipped=3 vs 4": the test was wrong
- The mini book now stores SUB-1003 (cyber), a triage knockout. Fixer 1's R4-1 change stores and scores knockouts.
- PRD 7.6 routes only accounts that are not knocked out, and asks the broker only for REFER-missing-data, an open HIGH contradiction, or one flip from FIT. A line-of-business knockout meets none of those. So SUB-1003 gets no route and no request, and it counts as skipped, like SUB-1005.
- The code is right. The expectation is now 4, with an assertion that SUB-1003 gets no action.

## Not fixed (other owners)
- `tests/integration/action-loop.test.ts` "plan actions over the real book" filters rows with `r.lineOfBusiness === 'commercial_property'` and expects 38. Since R4-1, ingest.ts stores all 158 rows on `FEDERATO_LINE` (row column) and puts the Federato line only on `canonical.lineOfBusiness`, so the filter returns 158.
  - With the filter changed to `r.canonical?.lineOfBusiness === 'commercial_property'`, every other assertion in that test passes. I checked this with a temporary copy, since deleted.
  - Fix: either change that filter line in the test, or have ingest.ts give knockout rows a distinguishable column. The column type is the frozen `LineOfBusiness` union, so the test is the practical place.
- `apps/api/src/services/rescore.ts(262)`: TS2554, 6 arguments where 4–5 are expected. This comes from a concurrent edit, not mine.
- golden.test.ts and engine-pipeline.test.ts fail the same way with my merge change disabled. They are not caused by this unit.
