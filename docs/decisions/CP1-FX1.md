# CP1-FX1 — vectorize: G-11 canonicalization and PRD 12 scaled range

Files: `packages/engine/src/stages/vectorize.ts`, `packages/engine/src/stages/normalize.ts`
and their colocated tests.

## Defect 1 — categorical canonicalization (G-11, G-7 amended)

**Decision.** `normalize.ts` now exports four G-11 canonicalizers built on its
existing private coercers: `canonicalSubmissionType` (the existing
`toSubmissionType`), `canonicalLineOfBusiness` (lower snake_case),
`canonicalStateCode` (trimmed upper case) and `canonicalConstructionType`
(lower snake_case, G-8). Each returns `null` for a value that is empty or
whitespace-only after trimming. `vectorize.ts` applies them:

- `isNewBusiness`: null/undefined/blank -> missing; otherwise
  `canonicalSubmissionType(v) === 'new_business'` -> 1, else 0 (renewal and any
  other non-blank value stay KNOWN and knock out, as before).
- `isPropertyLine`: null/undefined/blank -> missing (was: always known);
  otherwise lower-snake equals `commercial_property` -> 1, else 0.
- `stateTier`: uses `canonicalStateCode`; blank -> missing (unchanged behaviour).
- Construction type: stage 6 never reads a construction string — component 7
  is the numeric `rollup.pctTivAcceptableConstruction` produced by rollup — so
  there is nothing to canonicalize in vectorize. The canonicalizer is exported
  for whoever owns rollup.

**Reason.** One canonicalizer, one owner (normalize), so the two stages cannot
drift. Using the existing snake-case coercer means `"New Business"` and
`"newbusiness"` are also new business — a superset of G-11's trim + case-fold.

**Rejected.** A second private trim/lowercase in vectorize: duplicates normalize
and would disagree with it on `"new"` / `"New Business"`.

**Open issue for the oracle owner.** `verify/src/naive/index.ts` compares
`trim().toLowerCase() === 'new_business'`, so it scores `"new"` / `" new "` as
not-new-business, and it treats `""` as a known value. G-11 says both are
wrong; that file is not mine.

## Defect 2 — scaled components in [0, 1] (PRD 12)

**Decision.** `scaleVector` clamps every component into [0, 1] with a private
`clampUnit` (NaN -> 0, +Infinity -> 1, -Infinity -> 0; the shared `clamp01`
sends +Infinity to 0, the wrong edge). `none` now clamps (was: raw value
as-is). `divide` and min-max use private overflow-safe versions: when
`max - min` or `v - min` overflows, both are recomputed on halves, so the ratio
is never Infinity/Infinity. For ordinary finite inputs the result is
bit-identical to `util/math` `minMax` / `divideScale`. Raw values that are
null/NaN/±Infinity stay missing (null) per G-1; finite absurd values
(±Number.MAX_VALUE, negative shares) are KNOWN, keep their tiers, and clamp.

**Rejected.** Editing `util/math.ts` `minMax`/`clamp01` — not my file.
