# INTERPRETATIONS — the scoring oracle

**Owner:** W0-2 (Run 0). **Status: FROZEN.** Nothing in Run 1, 2 or 3 changes a
number in this file. A change request goes to `docs/contracts/requests/<unit>.md`.

**Who must read this file and obey it exactly:**

| Reader | Why |
| --- | --- |
| E01, E03, E05, E06, E07, E08 | They implement it. |
| E13, E14, E15 | The rulebook and rating JSON must encode exactly these conditions. |
| **V01 (naive second implementation)** | It is written from `APPETITE_GUIDELINES.pdf`, `vectors/commercial.json`, `NAIVE_SPEC.md` **and this file only**. |
| V02, V05, V08 | The 10M differential run samples at every boundary named here. |

The differential test samples **exactly at** every threshold below. Anything
left fuzzy here becomes a false disagreement in ten million cases. So every row
states an outcome for the boundary value itself, and no row says "roughly",
"about" or "approximately".

**Source document:** `docs/federato/APPETITE_GUIDELINES.pdf`, page 2, the table
headed *"2025 Sample: Commercial Property Underwriting Guidelines"*, columns
**Factor / Acceptable / Target / Not Acceptable**. Rows are cited below as
`AG p2 "<Factor>"`. The PRD sections that extend it are cited as `PRD 6.x`.

---

## 0. Reading rules that apply everywhere

| # | Rule |
| --- | --- |
| G-1 | All comparisons are on finite IEEE-754 doubles. A value that is `null`, `undefined`, `NaN` or `±Infinity` is **missing**, never 0. |
| G-2 | A **missing** appetite component sets `m[i] = 0`, `x[i] = null`, `t[i] = null`. It contributes **0 points** to the score, does **not** renormalize the remaining weights, does **not** set a knockout, and lowers completeness. |
| G-3 | A **known** component with tier value `0` sets the knockout mask. Only known components can knock out. |
| G-4 | Money is USD, plain numbers. `$150M` means `150000000` exactly. `$50K` means `50000`. |
| G-5 | Years are integers. A non-integer `yearBuilt` is floored before comparison. |
| G-6 | Shares (`pctTiv*`) are in `[0, 1]`, not percentages. "50%" means `0.5`. |
| G-7 | US state codes are compared as upper-case two-letter strings after trimming. Anything else is out-of-list, not missing, **unless the field is absent**, which is missing. |
| G-8 | Construction types are compared after normalizing to lower snake_case (`"Masonry Non-Combustible"` → `masonry_non_combustible`). |
| G-9 | Every tier assignment below is exhaustive: for a known input, exactly one of Target / Acceptable / Not Acceptable applies. There are no gaps and no overlaps. |
| G-10 | `refer` is a **flag, not a score**. A refer rule leaves the factor at its Acceptable tier value (0.6) and raises REFER at stage 9. It never zeroes a factor and never sets a knockout. |

---

## 1. Tier values

| Label | Value |
| --- | --- |
| Not Acceptable | `0` |
| Acceptable | `0.6` |
| Target | `1` |
| Refer (flag only) | factor keeps `0.6` |

`appetiteScore = 100 × Σ_i w_i · t_i` over the eight appetite factors, skipping
factors where `m = 0`. Range `[0, 100]`.

### T-BLANK — the four factors whose Target column is blank

`AG p2` leaves the **Target** cell empty for **Submission type**, **Line of
business**, **Construction type** and **Loss value**.

> **Decision.** For these four factors, meeting the **Acceptable** condition
> assigns tier value **`1` (TIER_TARGET)**, not `0.6`.

Reason: Acceptable is the best outcome the document allows for these four, so
capping them at 0.6 would make 100 unreachable and would silently reweight the
book. This is the single most consequential interpretation in the file.

The other four factors (**Primary risk state**, **TIV**, **Total premium**,
**Building age**) have a real Target column and use `0.6` for Acceptable.

A perfect account therefore scores exactly `100.000000`.

---

### T-SPAN — a factor that spans several components

A factor spanning more than one vector component writes **its own tier value into
every one of those components**, and the appetite score sums over the **eight
factors, never over the eleven components**. `building_age` is the only such
factor in `vectors/commercial.json`: `t[5]` and `t[6]` both carry the
`building_age` tier, and the score counts `w[building_age] × t` exactly once.

Summing over components instead would double-count `building_age` and make 100
unreachable. E05 `tiersFor`, E06 `evaluate`, the console's Vector panel (C10) and
V05's vector invariants all read this same rule.

## 2. Factor weights (W-1)

The PDF states no weights. These are Retrofit's, and they sum to **exactly 1**.

| # | Factor | Weight | Cite |
| --- | --- | --- | --- |
| 1 | `submission_type` | **0.10** | AG p2 "Submission type" |
| 2 | `line_of_business` | **0.15** | AG p2 "Line of business" |
| 3 | `primary_risk_state` | **0.15** | AG p2 "Primary risk state" |
| 4 | `tiv` | **0.15** | AG p2 "TIV (Total Insured Value)" |
| 5 | `total_premium` | **0.15** | AG p2 "Total premium" |
| 6 | `building_age` | **0.10** | AG p2 "Building age" |
| 7 | `construction_type` | **0.10** | AG p2 "Construction type" |
| 8 | `loss_value` | **0.10** | AG p2 "Loss value" |
| | **Sum** | **1.00** | |

The 0.15 group is the four factors that can also be **Target**; the 0.10 group
is the four with a blank Target column. Summing in the order above gives exactly
`1` in double arithmetic; the schema still checks `|Σw − 1| ≤ 1e-9`
(`WEIGHT_SUM_TOLERANCE`).

---

## 3. Boundaries — condition → exact outcome

Every row is `(input) → (tier)`. **Bold** rows are the boundary values the
generator samples at.

### 3.1 TIV — `AG p2 "TIV (Total Insured Value)"`
Acceptable "Up to $150M" · Target "$50M-$100M" · Not Acceptable "Over $150M".
Input: `rollup.totalTiv` (component 3, `totalTiv`).

| Condition | Tier | Value |
| --- | --- | --- |
| `tiv < 50000000` | Acceptable | 0.6 |
| **`tiv == 50000000`** | **Target** | **1** |
| `50000000 < tiv < 100000000` | Target | 1 |
| **`tiv == 100000000`** | **Target** | **1** |
| `100000000 < tiv < 150000000` | Acceptable | 0.6 |
| **`tiv == 150000000`** | **Acceptable** | **0.6** |
| `tiv > 150000000` | Not Acceptable | 0 |
| missing | — | `m = 0` |

Formally: Target iff `50e6 ≤ tiv ≤ 100e6`; Not Acceptable iff `tiv > 150e6`;
Acceptable otherwise. **Both target-band ends are inclusive. The $150M ceiling
is inclusive of Acceptable** ("Over $150M" is strict).
`tiv == 0` is Acceptable, not missing.

### 3.2 Total premium — `AG p2 "Total premium"`
Acceptable "$50K-$175K" · Target "$75K-$100K" · Not Acceptable "Under $50K or
over $175K". Input: `pricing.quotedPremium` (component 4, `quotedPremium`).

| Condition | Tier | Value |
| --- | --- | --- |
| `p < 50000` | Not Acceptable | 0 |
| **`p == 50000`** | **Acceptable** | **0.6** |
| `50000 < p < 75000` | Acceptable | 0.6 |
| **`p == 75000`** | **Target** | **1** |
| `75000 < p < 100000` | Target | 1 |
| **`p == 100000`** | **Target** | **1** |
| `100000 < p < 175000` | Acceptable | 0.6 |
| **`p == 175000`** | **Acceptable** | **0.6** |
| `p > 175000` | Not Acceptable | 0 |
| missing | — | `m = 0` |

Formally: Not Acceptable iff `p < 50000 || p > 175000`; Target iff
`75000 ≤ p ≤ 100000`; Acceptable otherwise. **All four band edges are
inclusive of the friendlier tier** ("Under" and "over" are both strict).

### 3.3 Loss value (5-year) — `AG p2 "Loss value"`
Acceptable "Under $100,000" · Target blank · Not Acceptable "Over $100,000".
Input: `rollup.fiveYearLoss` (component 8, `fiveYearLoss`).

| Condition | Tier | Value |
| --- | --- | --- |
| `loss < 100000` | Acceptable → **T-BLANK** | 1 |
| **`loss == 100000`** | **Acceptable → T-BLANK** | **1** |
| `loss > 100000` | Not Acceptable | 0 |
| missing | — | `m = 0` |

The PDF's "Under / Over" leaves exactly `$100,000` undefined. **Decision:
`100000` is not "over", so it is Acceptable.** Formally: Not Acceptable iff
`loss > 100000`. A submission with zero claims has `fiveYearLoss = 0`, which is
**known**, not missing (see 4.4).

### 3.4 Building age — `AG p2 "Building age"` + `PRD 6.6`
Acceptable "Newer than 1990" · Target "Newer than 2010" · Not Acceptable "Older
than 1990". Policies hold up to 129 buildings, so PRD 6.6 mirrors the
construction factor's `>50% of TIV` wording.

**Per-building classification (closes the 1990 and 2010 gaps):**

| Condition | Class |
| --- | --- |
| `yearBuilt < 1990` | **pre-1990** |
| **`yearBuilt == 1990`** | **not pre-1990** (counts as "newer than 1990") |
| `1990 < yearBuilt < 2010` | not pre-1990, not post-2010 |
| **`yearBuilt == 2010`** | **post-2010** (counts as "newer than 2010") |
| `yearBuilt > 2010` | post-2010 |

So `pre1990 ⇔ yearBuilt < 1990` and `post2010 ⇔ yearBuilt ≥ 2010`. Both cutoff
years belong to the **newer** side. This is why component 5 is named
`pctTivPre1990` (`< 1990`) and component 6 `pctTivPost2010` (`≥ 2010`).

**Factor tier from the TIV shares** (`pctTivPre1990` = share of *known* TIV in
pre-1990 buildings; likewise `pctTivPost2010`):

| Condition | Tier | Value |
| --- | --- | --- |
| `pctTivPre1990 > 0.5` | Not Acceptable | 0 |
| **`pctTivPre1990 == 0.5`** | **Acceptable** (+ refer, see R-AGE-REFER) | **0.6** |
| `pctTivPre1990 ≤ 0.5` and `pctTivPost2010 > 0.5` | Target | 1 |
| **`pctTivPost2010 == 0.5`** (and `pctTivPre1990 ≤ 0.5`) | **Acceptable** | **0.6** |
| otherwise (both shares `≤ 0.5`) | Acceptable | 0.6 |
| no building has a known `yearBuilt` | — | `m = 0` on components 5 and 6 |

Order of evaluation: Not Acceptable is checked first, then Target, then
Acceptable. Both `> 0.5` tests are **strict**; exactly 50% is never
Not Acceptable and never Target.

#### R-AGE-REFER — "any building pre-1990" versus ">50% of TIV pre-1990"

These are two different paths and must never be collapsed:

| Condition | Effect |
| --- | --- |
| `pctTivPre1990 > 0.5` | **Not Acceptable path.** `t[building_age] = 0`, **knockout set**, verdict `DOES_NOT_FIT`. No refer flag is raised (the knockout already decides it). |
| `0 < pctTivPre1990 ≤ 0.5` | **REFER path.** `t[building_age]` stays at its Acceptable/Target value, **no knockout**, a rule with `tier: "refer"` fires and names every pre-1990 building id (`rollup.pre1990BuildingIds`). Verdict is `REFER` unless something else already makes it `DOES_NOT_FIT`. |
| `pctTivPre1990 == 0` **and no building has `yearBuilt < 1990`** | No refer flag. |
| `pctTivPre1990 == 0` **but at least one building has `yearBuilt < 1990` with an unknown TIV** | **REFER path**, exactly as the row above. The trigger is the existence of a pre-1990 building, not its TIV share — PRD 6.6 says "REFER when any building is pre-1990, naming the buildings". `rollup.pre1990BuildingIds` therefore includes buildings whose `yearBuilt < 1990` **whatever their TIV**, including unknown. |
| a building has an unknown `yearBuilt` while others are known | Shares are computed over known-TIV, known-year buildings only; components 5/6 stay **known**. The unknown building raises a separate `missing data` refer through completeness, not through this rule. |

**The canonical refer condition, stated once so both implementations copy it verbatim:**

```
ageRefer  ⇔  anyBuildingPre1990 === true  AND  pctTivPre1990 <= 0.5
```

where `anyBuildingPre1990` is true when at least one building has a known `yearBuilt < 1990`, regardless of whether that building's TIV is known. Above 0.5 the knockout already decides and no refer flag is raised. `NAIVE_SPEC.md` 5.5 step 4 states the identical condition.

A refer flag **never** lowers the appetite score. Two accounts with the same
shares score identically whether or not the refer flag fired.

### 3.5 Construction type — `AG p2 "Construction type"`
Acceptable ">50% JM, non-combustible/steel, or masonry non-combustible" ·
Target blank · Not Acceptable ">50% other types".
Input: `rollup.pctTivAcceptableConstruction` (component 7).

**Acceptable classes** (normalized, `ACCEPTABLE_CONSTRUCTION`):
`joisted_masonry`, `non_combustible`, `steel`, `masonry_non_combustible`.
Plus, by **I-3** below: `fire_resistive`, `modified_fire_resistive`.

Every other class, **including unknown or unrecognised construction types on a
building whose TIV is known**, counts toward "other". Buildings with an unknown
TIV are excluded from both numerator and denominator.

| Condition | Tier | Value |
| --- | --- | --- |
| `pctAcceptable > 0.5` | Acceptable → **T-BLANK** | 1 |
| **`pctAcceptable == 0.5`** | **Acceptable → T-BLANK** | **1** |
| `pctAcceptable < 0.5` | Not Acceptable | 0 |
| no building has known TIV | — | `m = 0` |

The PDF's two ">50%" cells leave an exact 50/50 split undefined. **Decision:
exactly 50% acceptable construction is Acceptable.** Equivalently: Not
Acceptable iff the *other* share is strictly greater than 0.5, i.e.
`pctOther > 0.5`. The two forms agree because `pctOther = 1 − pctAcceptable`
over known-TIV buildings.

### 3.6 Primary risk state — `AG p2 "Primary risk state"`
Acceptable "OH, PA, MD, CO, CA, FL, NC, SC, GA, VA, UT" · Target "OH, PA, MD,
CO, CA, FL" · Not Acceptable "All other states".
Input: `rollup.primaryState` → component 2 `stateTier` ∈ {0, 1, 2}.

| Condition | `stateTier` | Tier | Value |
| --- | --- | --- | --- |
| state ∈ {OH, PA, MD, CO, CA, FL} | 2 | Target | 1 |
| state ∈ {NC, SC, GA, VA, UT} | 1 | Acceptable | 0.6 |
| any other code | 0 | Not Acceptable | 0 |
| state unknown | — | — | `m = 0` |

The Target list is a subset of the Acceptable list; Target is checked first.

### 3.7 Submission type — `AG p2 "Submission type"`
Acceptable "New business" · Target blank · Not Acceptable "Renewal business".

| Condition | Tier | Value |
| --- | --- | --- |
| `new_business` | Acceptable → **T-BLANK** | 1 |
| `renewal` | Not Acceptable | 0 |
| any other value | Not Acceptable | 0 |
| missing | — | `m = 0` |

### 3.8 Line of business — `AG p2 "Line of business"`
Acceptable "Property" · Target blank · Not Acceptable "All other lines".

| Condition | Tier | Value |
| --- | --- | --- |
| property (`commercial_property`) | Acceptable → **T-BLANK** | 1 |
| any other line | Not Acceptable | 0 |
| missing | — | `m = 0` |

The 120 non-property submissions knocked out in the triage pass are scored the
same way, they are simply never queried in depth.

---

## 4. The four PRD 6.6 interpretations, as testable rules

### I-1 — Primary risk state = largest TIV share
`PRD 6.6 "Primary risk state has no field, and policies span up to four states"`.

```
primaryState = the state code with the greatest Σ TIV over buildings whose
               state AND tiv are both known.
```

* TIV is attributed to a building's **location's** state (`Policy →
  exposure_units → location.state → buildings`).
* Buildings with unknown TIV contribute `0` and never decide the winner.
* Buildings with unknown state are excluded entirely.
* **Tie-break:** when two states carry exactly equal TIV, take the
  **alphabetically first two-letter code** (`CA` before `OH`). Deterministic and
  independent of record order.
* If no building has both a known state and a known TIV, `primaryState = null`
  and component 2 is missing.
* Every other state, with its share, is listed in `rollup.stateShares`
  (descending share, then alphabetical) and named in the explanation.

### I-2 — Building age mirrors the construction wording
`PRD 6.6 "Mirror the construction factor's wording: Not Acceptable when more
than 50% of TIV is pre-1990; REFER when any building is pre-1990"`.
Fully specified in 3.4 and R-AGE-REFER. The mirror is exact: both factors use a
**strict** `> 0.5` TIV share and both compute the share over known-TIV
buildings only.

### I-3 — Fire Resistive and Modified Fire Resistive
`PRD 6.6 "Treat as acceptable and flag the assumption"`.

* `fire_resistive` and `modified_fire_resistive` count toward
  `pctTivAcceptableConstruction` exactly as the four listed classes do.
* Every such building is recorded in `rollup.pctTivByConstruction[].assumedAcceptable = true`.
* When the construction factor's tier **depends** on them — that is, when
  removing their TIV from the numerator would change the 3.5 outcome — the
  interpretation `I-3` is attached to the result, shown on the rule card, and
  named in the explanation. Otherwise it is recorded but not surfaced.
* This never changes the tier value, only the flag.

### I-4 — Loss value definition and window
`PRD 6.6 "paid indemnity + paid expense + open reserves, dated within five
years of the submission's received date"`.

```
claimAmount = paidIndemnity + paidExpense + reserves     (missing term = 0)
fiveYearLoss = Σ claimAmount over claims where
               windowFrom ≤ dateOfLoss ≤ windowTo
```

* `windowTo` = `receivedDate` when known, otherwise `EngineInput.asOf`.
  The engine never reads the clock.
* `windowFrom` = the same calendar date five years earlier
  (`YYYY-05-17` → `YYYY-5, -05-17`). Feb 29 → Feb 28 in a non-leap year.
* **Both endpoints are inclusive.** A claim dated exactly on `windowFrom` or
  exactly on `windowTo` is **in** the window.
* A claim with a missing or unparsable `dateOfLoss` is **excluded** from the sum
  and counted in `rollup.claimCount` but not in `fiveYearClaimCount`.
* A claim whose three money terms are all missing contributes `0`.
* **Zero claims in the window ⇒ `fiveYearLoss = 0`, which is KNOWN**
  (`m[8] = 1`), not missing, provided the claims list itself was retrieved. If
  claims were never fetched (`records.Claim` absent from the `RawBundle`),
  `fiveYearLoss = null` and `m[8] = 0`.
* Negative reserves (recoveries) are summed as given; the total is floored at
  `0` before the 3.3 comparison.

---

## 5. Verdict and the rest of the chain

| # | Rule |
| --- | --- |
| V-1 | Any knockout → `DOES_NOT_FIT`. Checked first, before completeness and contradictions. |
| V-2 | Otherwise `completeness < 100` → `REFER`. |
| V-3 | Otherwise an **open HIGH** contradiction → `REFER`. |
| V-4 | Otherwise a fired `refer` rule (e.g. R-AGE-REFER) → `REFER`. |
| V-5 | Otherwise `FIT`. |
| V-6 | `completeness = 100 × (Σ m over required components ÷ number of required components)`. For `vectors/commercial.json` the required components are **0–8** — **nine** of them, not eight; 9 and 10 are `required: false`. The denominator counts **components, not factors**: `building_age` spans components 5 (`pctTivPre1990`) and 6 (`pctTivPost2010`), which are always **jointly known or jointly missing**. `NAIVE_SPEC.md` 5.3 states the identical denominator. |
| V-7 | `confidence` = the product of the source confidences of the fields used by the **single deciding rule of V-8** (not every fired rule), clamped to `[0, 1]`. With no deciding fields, `confidence = 1`. Table: broker-typed (`self_reported`) **0.7**, public record (`enrichment`) **0.9**, user answer (`answer`) **0.8**, camera (`sweep`) = the model's stated confidence after PRD 9.3. |
| V-8 | The **deciding factor** is: (a) if any knockout fired, the knockout factor with the lowest index in the 2 factor order; (b) otherwise, among **known** factors, the one with the **lowest `tierValue`**, ties broken by **highest weight**, further ties by the 2 factor order; (c) `null` when every appetite factor is missing. The refer reason is carried separately in `referReasons` and never changes `decidingFactorId`. "Lowest-scoring" means lowest **tier value**, not lowest points — the two differ (e.g. `building_age` t=0.6 w=0.10 = 6 points versus `tiv` t=0.6 w=0.15 = 9 points), and `decidingFactorId` is compared exactly by the differential. `NAIVE_SPEC.md` 5.6 states the identical rule. |
| V-9 | `distanceToAppetite` = the number of moves in the returned flip (0, 1 or 2), or `null` when no flip exists. A `FIT` account has `0`. |

### Flip

| # | Rule |
| --- | --- |
| F-1 | At most **2** components move. |
| F-2 | A component whose spec has `"immovable": true` is **never** proposed. In `vectors/commercial.json` those are components **0 (isNewBusiness), 1 (isPropertyLine), 2 (stateTier), 5 (pctTivPre1990), 6 (pctTivPost2010), 8 (fiveYearLoss)** and **10 (tivWeightedProtectionClass)**. PRD 6.4 names state and building age; Retrofit adds submission type, line of business, past losses and public protection class, because none of them can be changed by the insured either. Component **9 (pctTivSprinklered)** is movable — sprinklers can be installed. |
| F-3 | When every failing component is immovable, `flip = null` and `reason` says which (`blockedByImmovable`). |
| F-4 | Move length is measured in **scaled** space (each component mapped to `[0, 1]` by its spec rule against `BookStats`), and the winner is the smallest Euclidean length. Ties are broken by fewer moves, then by lower component index. |
| F-5 | A proposed move lands **just inside** the boundary, at the boundary value itself when the boundary is inclusive per §3 (e.g. premium → exactly `50000`), and at the smallest representable step past it when exclusive. |
| F-6 | `verdictAfter` must be `FIT`. A flip that only raises the score is not returned. |

### Peers and rank

| # | Rule |
| --- | --- |
| P-1 | Distance is `sqrt( Σ (a_i − b_i)² / nCompared )` over components **2–10**, using only components where **both** masks are 1. `nCompared = 0` → the pair is not a peer. |
| P-2 | `k = 5` (`K_PEERS`). Fewer than 5 candidates returns what exists. |
| P-3 | Peer rate = **median** rate per $100 TIV across the matched peers; peer loss = **mean** annual loss. |
| P-4 | Ties in distance are broken by ascending peer `id` (string compare), so the set is deterministic. |
| P-5 | `quality = 0.50·appetite + 0.20·adequacy′ + 0.15·(1 − lossRatio)′ + 0.10·completeness + 0.05·confidence′`. Each term is 0–100. Definitions, so no implementation invents its own: `adequacy = quotedPremium ÷ predictedPremium`; `adequacy′ = clamp(adequacy, 0, 2) ÷ 2 × 100`. `lossRatio = expectedAnnualLoss ÷ quotedPremium`; `(1 − lossRatio)′ = clamp(1 − lossRatio, 0, 1) × 100`. `confidence′ = confidence × 100`. `appetite` and `completeness` are already 0–100. **A term whose input is `null` (no quoted premium, no prediction, no expected loss) is dropped and the remaining weights are renormalized to sum to 1** — it is never imputed and never scored 0, because a missing number is already penalised through `completeness`. |
| P-6 | Knockouts rank below every non-knockout, ordered among themselves by `distanceToAppetite` ascending (`null` last), then by quality index descending, then by id. |

---

## 6. Scaling definitions (M)

Restated from `packages/engine/src/util/math.ts`, which is the implementation.

| Rule | Definition |
| --- | --- |
| `none` | value used as-is |
| `log_minmax` | `minMax( ln(max(x, 1)), stats.min, stats.max )` — note the **floor at 1**, so `x ≤ 1` maps to `0` and the log is never `-Infinity` |
| `log1p_minmax` | `minMax( ln(1 + max(x, 0)), stats.min, stats.max )` |
| `minmax` | `minMax(x, stats.min, stats.max)` |
| `divide` | `clamp01(x / divisor)` |
| `minMax(v, lo, hi)` | `clamp01((v − lo) / (hi − lo))`; when `hi − lo ≤ 1e-9` the result is **`0`** for every input |

`BookStats.min/max` are stored **after** the log transform, i.e. in scaling
space, so a second implementation must not log them again.

---

## 7. Tolerances

| Comparison | Tolerance | Constant |
| --- | --- | --- |
| Appetite score, tier values, premium, any engine-vs-naive number | **`1e-6`** | `SCORE_TOLERANCE` |
| Ratios, shares, completeness, confidence | `1e-9` | `RATIO_TOLERANCE` |
| Sum of the eight factor weights vs 1 | `1e-9` | `WEIGHT_SUM_TOLERANCE` |
| Money, in dollars | `1e-6` | `MONEY_TOLERANCE` |
| Degrees | `1e-9` | `ANGLE_TOLERANCE` |

Two results **agree** when every shared numeric field is within its tolerance
and every shared categorical field (verdict, tier label, deciding factor,
knockout set, flip component keys) is **exactly** equal. The differential
comparator reports anything else as a disagreement, with both sides' numbers.

---

## 8. Worked boundary cases (copy these into the generator)

All eight appetite components known, nothing missing, no contradictions.

| # | Input | Expected |
| --- | --- | --- |
| B1 | new business, property, `OH`, TIV `150000000`, premium `175000`, `pctTivPre1990 = 0`, `pctTivPost2010 = 0`, `pctTivAcceptableConstruction = 0.5`, loss `100000` | tiers `1, 1, 1, 0.6, 0.6, 0.6, 1, 1` → score `100×(0.10+0.15+0.15+0.09+0.09+0.06+0.10+0.10)` = **84.0**, no knockout, `FIT` |
| B2 | as B1 but TIV `150000000.01` | `tiv` → `0`, knockout, `DOES_NOT_FIT` |
| B3 | as B1 but premium `49999.99` | `total_premium` → `0`, knockout, `DOES_NOT_FIT` |
| B4 | as B1 but loss `100000.01` | `loss_value` → `0`, knockout, `DOES_NOT_FIT` |
| B5 | as B1 but `pctTivAcceptableConstruction = 0.4999` | `construction_type` → `0`, knockout, `DOES_NOT_FIT` |
| B6 | as B1 but `pctTivPre1990 = 0.5`, one building at `1989` | `building_age` stays `0.6`, **no** knockout, refer fires → `REFER`, score unchanged at **84.0** |
| B7 | as B1 but `pctTivPre1990 = 0.500001` | `building_age` → `0`, knockout, `DOES_NOT_FIT` |
| B8 | as B1 but every building `yearBuilt = 2010`, so `pctTivPost2010 = 1`, `pctTivPre1990 = 0` | `building_age` → `1` → score **88.0**, `FIT` |
| B9 | as B1 but TIV `50000000` and premium `75000` | `tiv` → `1`, `total_premium` → `1` → score `100×(0.10+0.15+0.15+0.15+0.15+0.06+0.10+0.10)` = **96.0** |
| B10 | as B9 but state `NC` | `primary_risk_state` → `0.6` → score **90.0** |
| B11 | as B9 but `quotedPremium` missing | `m[4] = 0`, premium contributes 0 → score **81.0**, completeness `8/9 = 88.888…%`, no knockout, `REFER` |
| B12 | renewal, everything else as B9 | `submission_type` → `0`, knockout, `DOES_NOT_FIT`, score **86.0** |

B1's arithmetic in full: `0.10·1 + 0.15·1 + 0.15·1 + 0.15·0.6 + 0.15·0.6 +
0.10·0.6 + 0.10·1 + 0.10·1 = 0.84`.

Note B12: a knockout does **not** zero the whole score. The score and the
verdict are independent outputs; only the verdict is decided by the knockout.
