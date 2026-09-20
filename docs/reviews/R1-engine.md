# R1 — engine review (packages/engine/src)

Reviewer: R1 (Run 2, read-only). Scope: PRD 6.5, INTERPRETATIONS (G-11, T-SPAN, V-6, V-7, V-8, P-5), flip, pricing.

## Method

A harness (`tsx`, scratchpad only) loads `realCases()` from the committed snapshot and replays `apps/api/src/services/rescore.ts#rescoreBook`:
a vector pass with no BookStats, `computeBookStats` over the 38 property accounts, then full `runEngine` with extensions, BookStats and the other 37 as peers, then `rank`.
`asOf` = receivedDate, falling back to effectiveDate, the same as the golden test. No network, no DB, no server.

## Hand recomputation (they match except where a finding says otherwise)

| Account | Check | By hand | Engine |
|---|---|---|---|
| SUB-2025-00001 | TIV | 2,321+2,775+31,614+898+18,446+1,353+13,749+14,002+27,410 = 112,568,000 → 0.6 | 112,568,000 → 0.6 |
| | pre-1990 share | 66,952,000 / 112,568,000 = 0.59477 > 0.5 → 0, knockout, no age refer | 0.594769, AG-AGE-NA, no AG-AGE-REFER |
| | acceptable construction | JM+NC+FR = 51,223,000 / 112,568,000 = 0.45504 < 0.5 → 0 | 0.455041 → 0 |
| | score | 0.10+0.15+0.15+0.09+0+0+0+0.10 = **59** | 59 |
| | completeness / confidence | 9/9 = 100 / premium is self_reported = 0.7 | 100 / 0.7 |
| | verdict / deciding factor | DOES_NOT_FIT / lowest-index knockout = total_premium | DOES_NOT_FIT / AG-PREM-NA-HIGH |
| | quality | 0.5·59 + 0.2·(619,900/458,334/2·100 = 67.625) + 0.15·100 + 0.1·100 + 0.05·70 = **71.53** | 71.53 |
| SUB-2025-00070 | TIV 52,665,000 → Target 1; premium 321,300 → 0; pre-1990 0.2789, post-2010 (2010 counts) 0.4781 → 0.6 + refer; construction 0.7570 → 1 | score 0.10+0.15+0.15+0.15+0+0.06+0.10+0.10 = **81** | 81, AG-AGE-REFER fired, DOES_NOT_FIT on total_premium |
| SUB-2026-00081 | 1,1,CA→1, TIV 18.49M→0.6, premium 58,800→0.6, pre 0 / post 0.7455→1, construction 0.7455→1, loss 0→1 | **88**, deciding tiv (0.6, weight 0.15 tie with premium, tiv earlier) | 88, AG-TIV-A-LOW, conf 0.7 |
| SUB-2024-00076 | TN → 0 knockout, premium 45,900 → 0 knockout | score 64, deciding primary_risk_state (index 2 < 4) | 64, AG-STATE-NA |
| No-policy (11) | 1/9 known → completeness 11.1; P-5 with adequacy and loss dropped: (7.5+1.111+5)/0.65 | **20.94** | 20.94 |

Rank follows P-6: non-knockouts first (00081, then the 11 no-policy ones), then knockouts by distance (all null) and then index.

Rating table monotonicity (`rating/commercial.json`): construction, age, protection class, sprinkler and loss-history factors are all non-increasing from worst to best, so no worse known class is cheaper. `fitError` {MAPE 0.278, R² 0.724, n 27} reproduces exactly from the engine's own predictions against `technical_premium`, and `price` passes it through (`basis: fitted`).

Flip: immovable components (0,1,2,5,6,8,10) are never proposed, and moves are capped at 2. But see R1-2: "reaches FIT" is checked against a verdict that is not the engine's real one.

## Findings

### R1-1 BLOCKER — a policy with zero claims is treated as "claims never fetched" (I-4, W0-2.8)
`stages/rollup.ts:365`. `claimsNeverFetched` looks only for a `raw.records.Claim` key. The deep pass (`federato/src/planner/to-bundle.ts`, and `fixtures/real.ts`) embeds claims inside `records.Policy[].data.claims` and never writes a `Claim` key. So a hydrated policy with `claims: []` gets `fiveYearLoss = null` and `m[8] = 0`.
Real impact, on 4 of the 27 policies (SUB-2026-00007, -00025, -00028, -00038):
- appetite score is **10 points low** (45→55, 56→66, 61→71, 74→84)
- completeness shows 88.9% instead of 100%
- predicted premium is 8.1% low, because the loss factor is 1 instead of loss_none at 1.0885 (for example 139,796 instead of 152,168)
- the quality index drops the loss term
- the flip reason says "fiveYearLoss cannot be changed", and VOI says "ask the broker"

Repro: run `runEngine` on `realCases()` SUB-2026-00007. Then run it again with `raw.records.Claim = []` added. The only difference is the key.
Fix: treat the claims list as fetched when a raw Policy row carries a `claims` array.

### R1-2 BLOCKER — flip decides "FIT" without the extensions or the contradictions
`stages/flip.ts:370-371` and `:455-456` call `evaluate(…)` without `extensions` and `verdict(…, [])` with no contradictions (`runEngine.ts:81` does not pass either one).
- **Real data:** SUB-2026-00081 is rank #1 and the only non-knockout policy. Its verdict is REFER because of an open HIGH contradiction. Flip still returns `{moves: [], verdictAfter: 'FIT'}`, so `distanceToAppetite = 0` sits on a REFER account (V-9 says only FIT has 0).
- **Synthetic:** take 00081, drop the second receivedDate, set premium to 200,000 and protection class to 9. Flip proposes `quotedPremium 200000→175000, verdictAfter FIT`. Applying that move and re-running `runEngine` gives **REFER** (X-PPC-UNPROTECTED). F-6 is broken.

### R1-3 MAJOR — flip `premiumAfter` never reflects the move
`stages/flip.ts:499`: `price()` reads TIV, construction and sprinkler from `submission.buildings`, not from the moved vector, so `premiumAfter === premiumBefore` for every move.
Repro: take 00081 with building TIVs scaled to a total of 160M. Flip moves `totalTiv 160000000→150000000`, yet `premiumBefore = premiumAfter = 552,329`. PRD 6.3 promises "the score and price after the move".

### R1-4 MAJOR — I-3 (fire-resistive assumption) is attached to every account
`stages/evaluate.ts:455-466` counts an interpretation as relevant whenever a fired rule touches its `affects` paths. Every account fires a construction rule, so I-3 is always attached. INTERPRETATIONS I-3 says to surface it only when the construction tier depends on FR/MFR TIV.
Repro: SUB-2024-00076 has one Joisted Masonry building and no FR at all. `explain()` still prints "fire-resistive construction is treated as acceptable, an assumption". The same wrong text appears on 00001, where the tier is 0 with or without FR.

### R1-5 MAJOR — an open HIGH receivedDate contradiction on all 27 policies means no real account can ever be FIT
`stages/contradict.ts:254` marks a conflict HIGH whenever any rule depends on the field. Every hydrated policy has `submission.received_date ≠ dates.submission_received` (27/27, gaps of 2 to 52 days). Both dates give the same set of claims in the window (0 changes across all 27), so no tier depends on the choice.
This follows the literal PRD 6.3 wording ("HIGH if a rule depends on it"), but the result is that the best real account (00081, which is in appetite on every factor) is REFER, and nothing in the book can reach FIT. It needs a decision: either HIGH only when the alternative value changes a rule outcome, or pick the canonical received-date field.

### R1-6 MAJOR — expected annual loss is $0 for every real account
All 33 claims on the 27 policies are dated after the received date (they are the policy's own post-bind losses), so I-4 gives `fiveYearLoss = 0` and `fiveYearClaimCount = 0` everywhere. As a result:
- own EAL is 0
- the peer and book mean annual loss is 0
- the credibility weight is 0
- `lossHistory` is always `loss_none`
- the quality index's 15% loss term is a constant 100

SUB-2025-00001 carries $1.6M of incurred claims and shows "5-year losses $0" and an expected loss of $0. The appetite factor follows the frozen I-4, but PRD 6.7's expected loss (and the peer "averaged $X a year in losses") carries no information on this dataset. This needs a decision recorded in DECISIONS. It is not an engine arithmetic bug.

### R1-7 MINOR — unknown rating inputs use factor 1.0, which is not neutral on the fitted scale
`stages/price.ts:68` (`applied`) plus the fitted table. The sprinkler factors are 0.888 and 0.957 and loss_none is 1.0885, so "unknown" is not neutral:
- an unknown sprinkler status prices above a known unsprinklered building (40,690 vs 38,944 on SUB-2024-00076)
- an unknown construction prices below Frame and Wood Frame (36,339 vs 38,944)
- an unknown loss prices below zero loss (see R1-1)

A missing value produces a discount or a surcharge.

### R1-8 MINOR — flip calls missing components "cannot be changed"
`stages/flip.ts:318` marks a missing component as unsatisfied, so on all 11 no-policy accounts the reason reads "isNewBusiness, stateTier, fiveYearLoss cannot be changed". These components are unknown, not failing. The reason should say they are missing.

### R1-9 MINOR — spurious insured.industry contradiction on every account
`stages/discover.ts:70` aliases both `naics_code` and `sic_code` to `insured.industry`, so every account shows a LOW contradiction "484121 vs 4213". The two codes come from different code systems, so this is not a conflict.

## Not findings (checked, correct)
G-11 normalization, T-SPAN (score over 8 factors), V-6 (/9), V-8 deciding factor, P-5 renormalization, P-6 ordering, rating monotonicity, fitError reproduction, flip never proposes immovable components and never exceeds 2 moves.
