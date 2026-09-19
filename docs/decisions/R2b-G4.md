# R2b G4 — console panels: Flip label, VOI null, trace prose, per-building pricing

Files: `apps/console/src/panels/{Flip,QueryTrace,Pricing}.tsx`, `panels/types.ts`,
`api/client.ts` and their colocated tests.

## D1 — R5-2: flip premiums are labelled "Predicted premium"
Both `premiumBefore` paths are predicted: `client.ts` falls back to
`price.predictedPremium`, and the engine's `flip.ts` computes `premiumBefore` with
`predictedPremium(...)`. The Unavailable stat and the before→after stat now both say
"Predicted premium". Rejected: switching the fallback to the quoted premium — the
before→after pair must be the same measure as `premiumAfter`, which is predicted.

## D2 — R5-8: `RequestDraftView.requestedFields[].voi` is `number | null`
The client maps "no ranked VOI entry" to `null`. `formatScore(null)` already
returns "—", so Actions.tsx (not mine) typechecks and now prints "— pts" instead
of "0.0 pts". Dropping the " pts" suffix for null is left to the Actions owner
(see notFixed in the structured output).

## D3 — R3-2: the trace view gains path, adaptation and error; `note` is notes only
New optional `QueryTraceEntryView` fields: `path`, `why`, `alternativesRejected`,
`requiredBy`, `adaptation` (null, never 'none'), `error`. Optional so
`fixtures/dto.ts` (not mine) still typechecks. `note` no longer concatenates the
adaptation kind and the error — each is rendered under its own text label
("Adapted:", "Note:", "Error:"), so colour is never the only signal and no kind is
printed twice. Known adaptation kinds (`elem_match_swap`, `drop_narrowest_filter`)
render as a plain-English sentence; an unknown kind renders verbatim. The payload
stays behind a closed `<details>`, so nothing JSON-shaped appears in the prose.
An empty `requiredBy` renders "No scoring rule needed this query"; an absent one
renders nothing (older views).

## D4 — R5-7: per-building rating table, no subtotal
`PricingView.buildings?` (optional, same reason). Pricing renders one row per
building: TIV, base rate per $100, one column per factor key in first-seen order
(multiplier with its input), building premium. Factor keys get readable labels
(`protectionClass` → "Protection class", `lossHistory` → "Loss history"). The sum of
building premiums is not in the DTO, so it is described in words, never printed.
Per-building multipliers show up to 3 decimals (×0.981) and base rates up to 4 —
display precision only.
