# R2 fixer 3 — decisions

Files owned: `apps/console/src/api/client.ts`, `apps/api/src/routes/submissions.ts`,
`apps/api/src/env.ts` and their colocated tests.

## D1 — R6-1: a relative `DATABASE_URL` resolves against the repo root

`env.ts` now transforms `DATABASE_URL`: `:memory:`, `file:` URIs and absolute
paths pass through; any other value (including the default
`apps/api/data/retrofit.db`) is resolved against the repo root, computed from
`import.meta.url` (`apps/api/src/env.ts` and a built `apps/api/dist/env.js` are
both three levels below the root). Root `npm run dev:api`, the api package's own
`dev`/`start` (cwd `apps/api`) and `npm run seed` now open the same file, which
the existing `.gitignore` rule covers.

Chosen over resolving only the default: a user who copies the default into
`.env` would otherwise hit the same cwd bug. Consequence: the startup banner's
`Database:` line now prints an absolute path (it is only printed locally; it is
not served by `/health`).

## D2 — R4-9 / R5-3: building construction class read back from the engine rollup

The rollup keys `pctTivByConstruction` by `canonicalClass()` (G-8 snake case plus
a private alias table, `steel_frame -> steel`), which the frozen engine barrel
does not export and which this unit may not edit. Rather than restate the alias
table in the handler (business logic in a handler, and a second copy to drift),
`toBuildingRow` runs the engine's exported `rollup()` over that one building
(`locations: []`, `history: []`) and takes the class key it reports, then looks
that key up in the stored `result.rollup`. The acceptability still comes from
the stored result, so the table cannot disagree with the score on the same page.
A building with no known TIV is absent from the rollup and stays "no share",
as before.

The cleaner follow-up (not done, not my files): export `canonicalClass` from
`packages/engine/src/stages/rollup.ts` and the barrel, and call it directly.

The route test fixture's hand-built rollup used raw spellings (`'Joisted
Masonry'`) as keys, which the engine never produces; they are now the canonical
keys. The new test uses the real engine `rollup()`.

## D3 — R3-2 and R5-7: view data staged in the client, rendering left to the panel owner

`queryTraceView` no longer turns `adaptation: 'none'` into a note (fixed
outright). It also now maps `why`, `alternativesRejected` and `requiredBy` onto
each trace view entry, and `pricingView` maps `price.perBuilding` to
`buildings[]` (`buildingExternalId, tiv, baseRate, factors[{label, multiplier,
input}], premium`). `QueryTraceEntryView` / `PricingView` in
`apps/console/src/panels/types.ts` do not declare these yet and the panels do not
render them. The objects are built in a local before being returned so that they
typecheck both before and after the panel owner adds the fields.
