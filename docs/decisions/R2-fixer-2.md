# R2 Fixer 2: decisions

Files: `packages/engine/src/stages/discover.ts`, `apps/api/src/services/reply.ts`,
`apps/console/src/panels/Vector.tsx`, plus the test file next to each.

## I3-2 / R3-5 / R5-4: hq Location name shown as the insured
- `resolveGroup` still pins a leaf under an `hq` segment to the insured group, and it now also returns `viaHq`.
- In `discover`, a match reached through hq is accepted only when it is `insured.headquartersState`. Anything else (`hq.name`, `hq.city`, `hq.zip`, ...) goes to `unmapped` with the reason "hq location field ... is not an insured attribute".
- Why unmapped and not `locations[]`: the HQ is not a risk location. INTERPRETATIONS/PRD use it only for the HQ state, so we do not create a location for it.
- Checked with `realCases()` on the committed snapshot: all 38 cases have exactly one `insured.name`. The 11 no-policy cases now show the real insured, e.g. SUB-2025-00115 is "Halcyon Metalworks Corp".

## R5-5: NAICS vs SIC false contradiction
- Removed `siccode`/`sic` from the `insured.industry` aliases. `Insured.sic_code` is now unmapped and shown in the schema panel.
- `realCases()`: 0 of 38 cases have more than one `insured.industry` value.

## R4-4: prose dates in a broker reply
- The skeptic's suggested fix is in `validate.ts`, which I do not own. The fix is in `reply.ts` instead:
  - Before `validateExtraction`, values for `receivedDate` / `effectiveDate` / `expirationDate` / `dateOfLoss` are converted to ISO. Accepted forms: "Month D, YYYY" (full or short month name, optional ordinal), "D Month YYYY", and "M/D/YYYY" read US-style.
  - The day is checked against the real month length, leap years included. `new Date()` is never used.
  - A string that is not a real date (e.g. "February 30, 2025") is passed through unchanged, so F13 still rejects it as `unparseable`.
- The quote check is unaffected: it compares the quote to the source text, never the value.
- Gap: `validateExtraction` itself still accepts only ISO. Any other caller of it keeps that restriction. The broker-reply path, which is the only PRD 7.6 path, is fixed.

## R4-6: "new business" dropped for submissionType
- Removed `options` from the submissionType extract spec in `reply.ts`. extract-reply's option match only folds case, so it threw the value away.
- The raw string now reaches F13's `parseString`, which already applies G-11 (snake_case plus aliases: new / new business / new-business become new_business). Anything else is still rejected there as `unparseable`.
- Cost: the extract prompt no longer lists "one of: new_business | renewal" for this field. That list did nothing useful, because the prompt already tells the model to return the value verbatim.

## R5-10: Vector panel said "Target" for T-BLANK factors
- `tierName` now takes the component key. For the four blank-Target components (isNewBusiness, isPropertyLine, pctTivAcceptableConstruction, fiveYearLoss), tier 1 reads "Acceptable". This matches `evaluate.derivedTier` and panel (b).
- The key list is hard-coded in the panel, the smallest fix that needs no model change. The better fix is to add the engine's tier token to `VectorComponentView` in `panels/types.ts`, which I do not own.
- The footnote now mentions T-BLANK.
- Changed an existing assertion in `Vector.test.tsx` from `fiveYearLoss` "1 · Target" to "1 · Acceptable". The old assertion encoded the bug.

## Not mine, observed
- `apps/api/src/services/actions.test.ts` "routes every non-knocked-out account..." fails: `skipped` is 4, the test expects 3.
- Not caused by these fixes: `planActions` on the mini snapshot returns skipped=4 both with and without my discover.ts changes (checked by temporarily reverting them).
- Likely a concurrent edit elsewhere, or a stale expectation (SUB-1003, cyber, is also skipped).
