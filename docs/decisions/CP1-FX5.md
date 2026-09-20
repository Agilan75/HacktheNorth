# CP1-FX5 — contract requests C01, C05, C09, C14

## D1. `SubmissionDetailDto.vectorSpec` carries the full `VectorSpec`, optional
**Decision:** add `readonly vectorSpec?: VectorSpec` (the whole engine type), not a
four-column projection. Schema: `vectorSpecSchema` (opaque, like every other
engine-owned object in `dto.schemas.ts`) `.optional()` on `submissionDetailSchema`.
**Why:** C01 allows either; the full spec is already the engine's own type, so no
new wire shape is invented, and future panels (scaling, direction, factor) need no
second contract change. **Rejected:** a `{key,label,immovable,appetiteFactor}[]`
projection — one more type to keep in sync with the engine for no saving.

## D2. The route sends the spec for `result.vector.lineOfBusiness`, cached, and omits it on read failure
`readVectorSpec` is read once per line per app instance. If it throws, the detail
still returns 200 without `vectorSpec` (the field only labels the vector; failing
the whole page over a label would be worse). A failed read is not cached, so the
next request retries. **Rejected:** checking `spec.version === vector.specVersion`
and dropping the spec on mismatch — the request says "from the active spec", and
the console already guards on line of business.

## D3. Console reads labels only from the DTO; the private copy is deleted
`vectorView` uses `dto.vectorSpec.components[i]` when `vectorSpec.lineOfBusiness`
matches the vector's line. Otherwise it falls back to the flip move's key/label,
then `c<i>` / `Component <i>`, with `immovable`/`appetiteFactor` false. No spec
table remains in `apps/console`. `scaled` stays `null`: computing it from the
spec's scaling rule would be the console recomputing an engine number (PRD 10).

## D4. C14 needed no API change
`AggregateDto` (frozen at Run 0) already declares, and `services/aggregate.ts`
already fills, `counts`, `topKnockoutFactors[].label`, `bookAdequacy.{median,
underpricedCount,n}` and `oneFlipAway[].{moveLabel,scoreAfter,premiumAfter}`. The
gap was only the console's `AggregateResponse`. So the new optional fields are on
`AggregateResponse` in `apps/console/src/api/client.ts`, passed straight through.
`verification` stays `{}` when absent (the request allows it; the page handles it).

## D5. AggregatePage: API numbers first, old sums only as fallback
- "Submissions with a verdict" = `counts.scored`, with the note "of N ingested ·
  K knocked out"; the verdict sum only when `counts` is absent.
- Book adequacy: median from `bookAdequacyDetail.median`, plus the line
  "U of N priced submissions quoted below predicted premium." (engine's
  `underpricedCount` / `n`, never counted in the console).
- One-flip list: new columns "Score after" and "Premium after"; "What would flip
  it" shows the engine's `moveLabel`, falling back to the queue explanation.
- Knockout bars use the API `label`, else `titleCase(factorId)`.

## D6. Typecheck against source, not stale declarations
`npx tsc --noEmit -p apps/api` / `-p apps/console` report `vectorSpec does not exist`
because project references read `packages/contracts/dist/dto.d.ts`, built before
this change. Rebuilding dist is the checkpoint's `tsc -b`, which fixers may not
run. Verified instead with a scratch tsconfig (same options, no references,
contracts resolved to `src/`): 0 errors in apps/api and apps/console.
`npx tsc --noEmit -p packages/contracts`: 0 errors.

## D7. C05 / C09 test files committed verbatim
No import path changes were needed: the repo's own files use `.js` extensions
and the `console` project resolves both forms.
