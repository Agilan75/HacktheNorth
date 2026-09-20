# Shared helpers — the complete list

There are **three** shared helper modules in Retrofit. This file is the whole
inventory. No unit may invent a fourth.

| Module | Owned by | What lives there | Who may import it |
| --- | --- | --- | --- |
| `packages/engine/src/util/math.ts` | W0-2 (implemented in Run 0, frozen) | All numeric primitives: `clamp`, `clamp01`, `lerp`, `round`, `roundTo`, `mean`, `median`, `stdev`, `percentile`, `sum`, `safeDiv`, `euclidean`, `weightedEuclidean`, `zScore`, `minMaxScale`, `nearlyEqual(a, b, tol)`, `credibilityBlend`. Deterministic, pure, no `Math.random`, no `Date`. | Anything inside `packages/engine`, and any other package via the `@retrofit/engine` barrel if re-exported there. |
| `packages/contracts/src/format.ts` | W0-3 (Run 0, frozen) | All presentation formatting shared by the API, console and mobile: `formatMoney`, `formatTiv`, `formatPercent`, `formatScore`, `formatVerdict`, `formatDate`, `formatDistance`, `titleCase`, `pluralize`, `truncateQuote`. Formatting only — never arithmetic that changes a number's value. | `apps/api`, `apps/console`, `apps/mobile`, `packages/federato`. |
| `packages/engine/src/sweep/geometry.ts` | E11 | All angular and planar geometry for the camera sweep: `normalizeBearing`, `bearingDelta`, `arcUnion`, `coveredFraction`, `largestGap`, `withinTolerance(a, b, deg)`, `dedupeByBearing`. Pure, degrees, 0–360 clockwise from north. | Anything inside `packages/engine`; `apps/api` sweep services via the barrel. |

## The rule

**No new shared helpers.** If your unit needs a utility that is not in the table
above:

1. Check the table again — `util/math.ts` in particular is deliberately wide.
2. If it genuinely is not there, write it **private to your own file**. Do not
   export it. Do not create `utils.ts`, `helpers.ts`, `common.ts`, or `lib.ts`.
   Do not add it to someone else's helper module — those files are frozen and
   owned by another unit.
3. If three or more units would plainly need it, write
   `docs/contracts/requests/<your-unit-id>.md` asking for it to be added to the
   owning module at the next checkpoint, and keep your private copy until then.

Duplicating an existing helper is a review finding. Silently widening a frozen
helper is an ownership violation.

## Things that are not helpers

- **Constants** live in `packages/engine/src/constants.ts` (tier values, source
  confidence table, `K_PEERS`, tolerances, `OBJECT_VOCAB`). Frozen, W0-2.
- **Zod schemas** for rulebooks, vector specs, rating tables and question sets
  live in `packages/engine/src/schemas.ts`. Frozen, W0-2.
- **Wire schemas** for request and response bodies live in
  `packages/contracts/src/dto.schemas.ts`. Frozen, W0-3.
- **Interpretations of the guidelines** (every boundary, every weight, the tier
  value for "Acceptable", the REFER paths, the 1e-6 tolerance) live in
  `docs/contracts/INTERPRETATIONS.md`. Frozen, W0-2. Both the engine and the
  naive verify implementation read it; neither may re-decide a boundary locally.
