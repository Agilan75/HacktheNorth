# NAIVE_SPEC — the brief for unit V01

**Written by W0-4 (Run 0). FROZEN.** This file is the entire brief for the
naive second implementation. It is written to be read *in isolation*: you can
do the whole job from this file plus the three sources named below.

---

## 1. What you are building and why

Retrofit scores commercial property submissions against a one-page appetite
table. `packages/engine` is one implementation of that table. You are writing
the **second, independent one**: a single flat function of `if` statements,
written straight from the PDF, sharing no code and no reasoning with the
engine.

PRD §12 layer B compares the two over ten million generated cases. Any
disagreement is a bug in one of them. That check is worth nothing if the two
implementations were written from the same code, so your isolation is the
point of the exercise, not a formality.

## 2. Isolation — the hard rules

**You may read exactly these three files, and nothing else in the repository:**

1. `docs/federato/APPETITE_GUIDELINES.pdf` — page 2, the table headed
   *"2025 Sample: Commercial Property Underwriting Guidelines"*.
2. `packages/engine/vectors/commercial.json` — the component list, for field
   names and units only. It is data, not logic: it contains no thresholds.
3. `docs/contracts/INTERPRETATIONS.md` — the frozen decisions that close every
   gap the PDF leaves open. **Obey it exactly.** Every boundary in it states an
   outcome for the boundary value itself.

Plus this file.

**You are FORBIDDEN to open `packages/engine/src/**`.** Not to check a name,
not to resolve an ambiguity, not "just to see how they handled it". If
something is genuinely undecidable from the three sources above, implement the
reading you believe the PDF supports, write the question and your answer into
`docs/contracts/requests/V01.md`, and carry on. Do not read the engine.

Also forbidden: `packages/engine/src/constants.ts`, `schemas.ts`, `types.ts`,
`runEngine.ts`, any engine test or fixture, any engine rulebook JSON under
`packages/engine/rules/` or `packages/engine/rating/`, and
`packages/verify/src/compare.ts` (which adapts engine output).

**Your code must not import from `@retrofit/engine`.** Not a type, not a
constant, not `type`-only. Checkpoint CP1 runs:

```
grep -r "@retrofit/engine" packages/verify/src/naive
```

and it **must return nothing**. Re-declare anything you need locally, or import
the shared shapes from `../types.js` (`packages/verify/src/types.ts`), which is
itself engine-free by construction.

## 3. What you own

`packages/verify/src/naive/**`, and nothing else. Create:

- `packages/verify/src/naive/index.ts` — the implementation and its exports.
- `packages/verify/src/naive/naive.test.ts` — your tests.

You may split into more files under `naive/` if you prefer; the export surface
below must be reachable from `naive/index.ts`.

## 4. The function you must export

```ts
import type { NaiveEvaluate, NaiveInput, NaiveResult } from '../types.js';

export const naiveEvaluate: NaiveEvaluate = (input: NaiveInput): NaiveResult => { … };
```

`packages/verify/src/types.ts` already declares `NaiveInput`, `NaiveResult`,
`NaiveFactorOutcome`, `NaiveFactorId`, `NaiveTierLabel` and `NaiveVerdict`.
Import them as types; do not redefine them, and do not change that file (it is
frozen and owned by W0-4 — send a request to
`docs/contracts/requests/V01.md` if something is missing).

### 4.1 Input

Every field is in raw units. **`null` means the fact is missing** — never
treat it as zero (INTERPRETATIONS G-1, G-2).

| Field | Type | Meaning |
| --- | --- | --- |
| `submissionType` | `string \| null` | `'new_business'` or `'renewal'`; any other string is a value you must still classify |
| `lineOfBusiness` | `string \| null` | `'commercial_property'` is property; anything else is another line |
| `primaryState` | `string \| null` | two-letter US state code of the largest TIV share |
| `totalTiv` | `number \| null` | dollars, e.g. `150000000` |
| `quotedPremium` | `number \| null` | dollars, e.g. `75000` |
| `pctTivPre1990` | `number \| null` | share in `[0, 1]` of known TIV in buildings with `yearBuilt < 1990` |
| `pctTivPost2010` | `number \| null` | share in `[0, 1]` of known TIV in buildings with `yearBuilt >= 2010` |
| `pctTivAcceptableConstruction` | `number \| null` | share in `[0, 1]` of known TIV in acceptable construction classes |
| `fiveYearLoss` | `number \| null` | dollars of five-year incurred loss; `0` is *known*, not missing |
| `anyBuildingPre1990` | `boolean \| null` | true when at least one building predates 1990 |
| `hasOpenHighContradiction` | `boolean` | true when an unresolved HIGH-severity contradiction is open |

The generator will hand you hostile values: `0`, negatives, `1e18`,
`Number.MAX_VALUE`, shares slightly outside `[0, 1]`, empty strings,
lower-case state codes, and every threshold value exactly. Treat non-finite
numbers (`NaN`, `±Infinity`) as **missing**. Trim and upper-case state codes
before comparing. **Never throw.**

### 4.2 Output

```ts
{
  appetiteScore: number,            // 0..100
  completeness: number,             // 0..100
  verdict: 'FIT' | 'REFER' | 'DOES_NOT_FIT',
  knockoutFactorIds: NaiveFactorId[],   // ascending weight-table order
  referReasons: string[],           // short stable strings, see 5.5
  decidingFactorId: NaiveFactorId | null,
  factors: NaiveFactorOutcome[],    // all eight, in weight-table order
}
```

Each `NaiveFactorOutcome` is
`{ factorId, tier, tierValue, weight, points, knockout }`, where `tier` and
`tierValue` are `null` for a missing input, and
`points = weight × tierValue × 100` (`0` when missing).

## 5. The algorithm, start to finish

Write it as one flat pass. No shared helper library, no table-driven cleverness,
no reuse of anything in `packages/verify/src` other than the types. Repetitive
`if` statements are the desired style: they are easy to read against the PDF,
and they fail differently from the engine, which is what makes the comparison
worth running.

### 5.1 Tier the eight factors

Exactly the eight factors of INTERPRETATIONS §2, in this order:

`submission_type`, `line_of_business`, `primary_risk_state`, `tiv`,
`total_premium`, `building_age`, `construction_type`, `loss_value`.

Tier values: Not Acceptable `0`, Acceptable `0.6`, Target `1`. For the four
factors whose Target column is blank — submission type, line of business,
construction type, loss value — an Acceptable input scores `1`, not `0.6`
(INTERPRETATIONS **T-BLANK**). Read §1 and §3 of INTERPRETATIONS and transcribe
every boundary literally, including which side of each `==` is friendlier.

A missing input sets `tier = null`, `tierValue = null`, contributes `0` points,
does **not** renormalize the other weights, and cannot knock out.

### 5.2 Score

`appetiteScore = 100 × Σ (weight_i × tierValue_i)` over the known factors, with
the weights of INTERPRETATIONS §2 (0.10/0.15/0.15/0.15/0.15/0.10/0.10/0.10).
Sum them in the table order above so the double arithmetic matches.

### 5.3 Completeness

`completeness = 100 × (known required components ÷ 9)`.

The denominator counts **components, not factors**. There are eight appetite
factors but nine required components, because `building_age` spans two:
`pctTivPre1990` and `pctTivPost2010`. Those two are always **jointly known or
jointly missing**, so a known `building_age` contributes 2 to the numerator and
every other known factor contributes 1. INTERPRETATIONS V-6 states the identical
denominator; `completeness` is compared by the differential, so ÷8 here would
fail every masked case.

### 5.4 Knockouts

A **known** factor whose tier value is `0` is a knockout. `knockoutFactorIds`
lists them in weight-table order. A missing factor never knocks out.

### 5.5 Verdict

In this exact order (INTERPRETATIONS V-1..V-5):

1. any knockout → `DOES_NOT_FIT`;
2. else `completeness < 100` → `REFER` with reason `missing_data`;
3. else `hasOpenHighContradiction` → `REFER` with reason `open_high_contradiction`;
4. else the age refer path. The condition is exactly:

   ```
   ageRefer  ⇔  anyBuildingPre1990 === true  AND  pctTivPre1990 <= 0.5
   ```

   → `REFER` with reason `pre_1990_building`. `anyBuildingPre1990` is true when at
   least one building has a known `yearBuilt < 1990`, **whatever its TIV, including
   unknown** — the trigger is the building's existence, not its TIV share. Above
   0.5 the knockout in step 1 has already decided and no refer is raised.
   INTERPRETATIONS **R-AGE-REFER** states this same line verbatim: ">50% of TIV
   pre-1990" and "any building pre-1990" are two different paths and must never be
   collapsed. The refer flag never changes the score;
5. else `FIT`.

### 5.6 Deciding factor

In this exact order (INTERPRETATIONS V-8 states the identical rule):

1. if any knockout fired → the knockout factor with the **lowest index** in the
   weight-table order;
2. otherwise, among **known** factors, the one with the **lowest `tierValue`**,
   ties broken by **highest weight**, further ties by the weight-table order;
3. `null` when every appetite factor is missing.

"Lowest-scoring" means lowest **tier value**, never lowest points. The two
disagree — `building_age` at t=0.6, w=0.10 is 6 points while `tiv` at t=0.6,
w=0.15 is 9 points — and `decidingFactorId` is compared exactly, so picking the
other reading fails the differential on every mixed-tier case.

The refer reason lives in `referReasons` and never changes `decidingFactorId`:
a `REFER` for `missing_data` still reports whichever known factor is weakest.

## 6. What you must NOT implement

Pricing, expected loss, flip, peers, quality index, rank, VOI, the vector
scaling, `BookStats`, sweeps. Layer B compares appetite scoring only. If a
value is not in `NaiveResult`, do not compute it.

## 7. Tests you must write

In `naive/naive.test.ts`, with no engine import:

- every worked boundary case in INTERPRETATIONS **§8**, asserted exactly;
- each of the boundary rows of §3 that are printed in bold — the `==` cases for
  `$50M`, `$100M`, `$150M`, `$50K`, `$75K`, `$100K` premium, `$100,000` loss,
  `yearBuilt` 1990 and 2010, `0.5` shares — asserted on both sides;
- one all-missing input: score `0`, completeness `0`, verdict `REFER`, no throw;
- hostile values: negative TIV, `1e18` premium, `''` state, `'oh'` lower-case,
  share `1.0000001`, `NaN` arriving as `null`. None may throw;
- determinism: the same input twice gives a deeply equal result.

Run only your own file:

```
VITEST_MAX_WORKERS=1 npx vitest run packages/verify/src/naive/naive.test.ts
```

Never run the package-wide suite, `npm install`, or the verify CLI.

## 8. Done when

- `naiveEvaluate` is exported from `packages/verify/src/naive/index.ts` and
  satisfies `NaiveEvaluate`;
- your test file passes;
- `grep -r "@retrofit/engine" packages/verify/src/naive` prints nothing;
- you never opened `packages/engine/src/**`.
