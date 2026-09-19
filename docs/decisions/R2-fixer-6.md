# R2 fixer 6: decisions

Files changed: `packages/engine/src/stages/{vectorize,flip,normalize}.ts`,
`apps/api/src/llm/calls/draft-request.ts`, plus each file's colocated test.

## R-I4-1 / R-I4-3: vectorize `readSource`
- `readSource` still walks the spec path literally first. A segment may now carry
  one array index (`buildings[0].yearBuilt`). When a two-segment `hazards.<key>`
  path finds nothing, it falls back to `hazards.present.<key>`, which is where
  merge writes sweep hazards. A direct `hazards.smokeDetectorCount` still reads
  directly.
- I did not switch to `util/fields.readPath`. Its index syntax is `buildings.0`,
  not `buildings[0]`, so it would not have fixed R-I4-3. The private walker keeps
  `pickValue` exactly as E05 wrote it.
- A hazard the sweep did not see stays missing (m=0), and pricing skips it as before.

## R1-2: flip ignores extension rules
- `flip()` takes an optional trailing `extensions?: Rulebook`. It is passed to
  `evaluate` both before the search and after each candidate. The parameter is
  optional and additive, so every existing caller still compiles.
- If an extension refer rule has fired on an immovable component (for example
  X-PPC-UNPROTECTED on `tivWeightedProtectionClass`, immovable under F-2), flip
  returns `null` straight away with that component in `blockedByImmovable`. No
  move can clear that referral.
- **runEngine.ts is not mine.** Until `runEngine.ts:83` passes `extensions`
  (`flip(vector, spec, rulebook, ratingTable, canonical, bookStats, extensions)`),
  the live pipeline still runs flip without extensions.
- Open HIGH contradictions stay out of the search, as recorded in V05 decision 6.
  A REFER account that is REFER only because of a contradiction still shows 0
  moves (SUB-2026-00081). The optional follow-up in `verdict.ts` (a 0-move flip on
  a non-FIT verdict gives distance null) is not mine.

## R1-3: flip premiumAfter
- `premiumAfter` now prices a moved copy of the submission, because
  `priceCommercial` reads buildings, not the vector:
  - totalTiv: every building's TIV is scaled by to/from.
  - pctTivAcceptableConstruction / pctTivSprinklered: (to - from) x known TIV is
    shifted, in building order, out of buildings outside the class. A building
    moved only in part is split: the rest keeps its facts, and the moved part
    becomes a sibling `<id>~flip`.
  - Target construction class: the construction slot of the largest-TIV
    acceptable building. If there is none, "Joisted Masonry" (rating 1.0717, the
    middle of the acceptable classes).
  - quotedPremium: written to `pricing.quotedPremium`. The predicted premium does
    not change; only adequacy moves.
- The acceptable-class test duplicates rollup's private alias table
  (`steel_frame`->`steel` and others) together with
  ACCEPTABLE_CONSTRUCTION ∪ ASSUMED_ACCEPTABLE_CONSTRUCTION.

## R1-1: normalize building ownership
- `Entity` records `ancestors`: the keys of the grouped entities it was hydrated
  under. A building's owner is the location whose key is in its ancestors, and
  the id-list fallback is unchanged. Prefixes are unchanged, so field reads are
  unaffected.
- Checked against the real snapshot. Primary states are now TX, FL, MA, CA, CA,
  MA, TX, FL, NJ, FL, TN for 00065, 00090, 25-00004, 00061, 00052, 00054, 00066,
  00091, 00092, 26-00007, 26-00098. SUB-2025-00004 PPC is 5.07.
- **Out of scope (not mine):** `packages/engine/src/fixtures/golden.test.ts` pins
  the old deciding rules on 5 accounts: 00065 AG-AGE-NA->AG-STATE-NA, 00090
  AG-STATE-NA->AG-PREM-NA-HIGH, 25-00004 AG-PREM-NA-HIGH->AG-STATE-NA, 00061
  AG-STATE-NA->AG-PREM-NA-HIGH, 00092 AG-PREM-NA-HIGH->AG-STATE-NA.
  `rating/commercial.json` was fitted on the mis-attributed rows. Its owner must
  rerun `npm run rating:fit` and repin both.

## R4-7: draft-request extra asks
- After the `?` check, every remaining sentence that is not a bullet and names no
  requested label is rejected ("extra request") if it contains a request cue
  (please, kindly, send, provide, share, confirm, forward, attach, upload,
  submit, include, advise, need(s/ed), require(s/d), could/can/would you, let us
  know).
- There are two exemptions, both matched against closed patterns:
  - A reply-only closer: "Please reply (with this/that/these/the value(s)/details) (when you can)".
  - A list intro ending in "... need the following:". The text before the intro
    is still checked, so "Please send the lease; we need the following:" fails.
- A false rejection costs only a fall back to the template, which always passes.
