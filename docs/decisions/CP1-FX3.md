# CP1-FX3 — naive oracle aligned to INTERPRETATIONS G-11 / amended G-7

Scope: `packages/verify/src/naive/index.ts`, `packages/verify/src/naive/naive.test.ts`.
Read only the allowed sources (INTERPRETATIONS, NAIVE_SPEC, own files); nothing
under `packages/engine/src/**` was opened.

## D1. Blank categorical strings are missing
`code()` trims; an empty result is `null`, so submission type, line of business
and primary risk state treat `''` / whitespace-only exactly like `null`
(G-11, G-2). Supersedes V01 D2.

## D2. `"new"` is a known submission-type value
After trim + lower-case, `new` and `new_business` both give tier 1 (T-BLANK).
Other spellings (`new business`, `news`) stay out-of-list — G-11 names only
those two spellings.

## D3. Construction type has no string input in the oracle
NAIVE_SPEC 4.1 feeds construction as the numeric share
`pctTivAcceptableConstruction`; per-building construction strings are
normalised upstream of the oracle. There is no blank-string case to handle
here, so the G-11 tests cover the three string fields. Blank construction
strings are the rollup's responsibility (outside FX3's files).

## D4. One pre-existing assertion changed
The hostile-values test asserted `primaryState: ''` → tier 0, which encoded the
superseded D2. It now asserts `null`. The twelve §8 worked cases and all §3
boundary tests are untouched and pass.
