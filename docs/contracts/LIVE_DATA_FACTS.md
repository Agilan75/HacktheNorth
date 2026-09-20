# Live data facts

Probed directly against the Federato API on 2026-09-19, before Run 1. Every number here was measured, not assumed. Run 1 units — especially F02 (snapshot), F03/F04 (mock parity), F09 (plan), E03 (rollup) and E13 (rulebook) — should treat this as ground truth and must not re-derive it by guessing.

## Record counts (F02 asserts these)

| Resource | Total |
| --- | --- |
| Submission | 158 |
| Policy | 113 |
| Claim | 179 |
| Building | 129 |
| Location | 70 |
| ExposureUnit | 938 |
| Coverage | 366 |
| Endorsement | 253 |
| Insured | 30 |
| Contact | 14 |
| Underwriter | 8 |
| Broker | 6 |

Submission by line of business: property 38, health 36, cgl 21, auto 20, cyber 18, excess 15, lpl 10.
Submission by status: bound 113, declined 14, lost 10, cleared 7, received 7, quoted 7.
Policy by line of business: property 27, health 25, excess 15, cyber 14, auto 14, cgl 11, lpl 7.
Policy by status: active 76, expired 26, non_renewed 6, cancelled 5.

## The deep hydrated query works in one call

```json
{ "resource": "Policy",
  "where": { "line_of_business": "property" },
  "expand": { "insured": true, "submission": true, "claims": true,
              "exposure_units": { "location": { "buildings": true } } },
  "pagination": { "limit": 200 } }
```

Returns **all 27 property policies fully hydrated in 1.4 s**. `insured`, `submission`, `claims`, and `exposure_units → location → buildings` all come back as objects, not ids. All 27 have at least one building and a premium. This is the deep pass of PRD §7.5 step 4 — it is verified, use it.

`Submission` has no premium, TIV, state, construction, or building fields and **no reverse reference to `Policy`**. Rooting the deep pass at `Submission` returns nothing scoreable.

The 11 property submissions with no policy are reachable as their own query (`status $in [lost, cleared, quoted, declined, received]`, expand `insured.hq` and `broker`) — returns exactly 11.

## `over` does not group — do not use server-side aggregation

`QUERY_REQUEST_BODY.pdf` documents `over` as SQL-style `GROUP BY` returning a `groups` key. **The deployed handler does not partition.** Measured across six variants (scalar field, reference path, with and without `expand`, with and without `sort`/`pagination`, `$count` vs `$sum`):

- The response key is always `results`, never `groups`.
- Row count always equals the input record count (113 policies → 113 rows), not the group count.
- `$count` returns `1` on every row. `$sum` returns a constant global artifact (`11063900`) that matches neither the group subtotal nor the book total (`128011000`).

The PDF's worked example output (`property: 27 policies, 6690900 premium`) is arithmetically correct — property's real premium subtotal *is* `6,690,900` — so the documentation describes intended behaviour that the live handler does not implement.

**Decision:** the planner never emits an `over` clause. Every rollup happens in `packages/engine` stage 3, which PRD §6.3 already specifies. F10's adapt step records a trace note when it declines server-side aggregation and why. F04 may implement `over` in the mock per the PDF, but since no query uses it, live and snapshot stay equivalent either way.

## The documented array pitfall reproduces exactly

- `filter: { "exposure_units.location.state": "CA" }` → **0 results**.
- `filter: { "exposure_units": { "$elemMatch": { "location": { "state": "CA" } } } }` → **47 policies**.

F10's adapt rule (zero results → retry with `$elemMatch` in place of a dot-path) is not hypothetical; this is the exact case.

## Enum values the rulebook must match

`Building.construction_type` — eight values, and they map cleanly onto the appetite table:

| Value | n | Appetite |
| --- | --- | --- |
| Fire Resistive | 21 | acceptable, **flagged** (not listed in the PDF; PRD §6.6 interpretation) |
| Frame | 19 | not acceptable |
| Non-Combustible | 19 | acceptable |
| Masonry Non-Combustible | 17 | acceptable |
| Joisted Masonry | 15 | acceptable ("JM" in the PDF) |
| Modified Fire Resistive | 15 | acceptable, **flagged** |
| Wood Frame | 14 | not acceptable |
| Steel Frame | 9 | acceptable ("non-combustible/steel") |

`Policy.business_type` is `new` / `renewal` — lowercase, not "New business" / "Renewal business". The rulebook must match the data's casing, not the PDF's prose.

`Location.state` — CA 19, TX 9, TN 8, FL 7, IL 5, AZ 4, WA 4, CO 4, NJ 4, MO 2, MA 2, GA 2. Against the appetite list: **CA, FL, CO are Target; GA is Acceptable; TX, TN, IL, AZ, WA, NJ, MO, MA are Not Acceptable. OH, PA, MD, NC, SC, VA and UT do not appear in the data at all.**

`Location.hazard_tags` — flood 31, wildfire 23, hail 17, tornado 15, earthquake 14, winter_storm 8, hurricane 6, wind 5. These are catastrophe perils, **not** room hazards; nothing in the tenant/sweep vocabulary maps to them.

`Location.protection_class` — integers 1–10, all present.
`ExposureUnit.kind` — census_segment 283, vehicle 193, professional 185, driver 154, location 88, underlying_layer 21, digital_asset 14. Only `location` matters for commercial property.

## Numbers that drive scoring and pricing

**Buildings (n = 129):** `year_built` ranges 1948–2024. **71 are pre-1990 (55%)**; only 17 are post-2010. PRD §7.2 says the oldest is 1951 — the real minimum is **1948**. Because most accounts carry a pre-1990 building, the pre-1990 REFER path fires constantly; `INTERPRETATIONS.md` must keep it clearly distinct from the ">50% of TIV pre-1990" Not-Acceptable path or nearly every account collapses to one verdict.

**Property premium (n = 27):** min 45,900, max 703,500, subtotal 6,690,900.
- 17 of 27 are **over 175K → Not Acceptable on premium**.
- 2 are under 50K → also Not Acceptable.
- 8 sit in the 50K–175K Acceptable band; only **3** land in the 75K–100K Target band.

`premium ÷ technical_premium` across all 27: min 0.93, median 1.05, max 1.21 — confirms PRD §6.7 exactly, and the rating fit in E15/E17 has a real signal to fit against.

Few accounts will be FIT. That is the dataset, not a bug — it is why ranking, the quality index, and the minimal flip carry the demo rather than a long green list.

## Transport

- Responses are `{"output":[{"data":{...}}]}` **even with `?outputOnly=true`**, and arrive with HTTP 201. Unwrap both shapes (F01).
- Tokens last 4 hours; mint from `auth.product.federato.ai`.
