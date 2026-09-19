# R2 fixer 5 — decisions

Files: `packages/engine/src/stages/evaluate.ts`, `packages/engine/src/stages/contradict.ts`,
`packages/federato/src/explain/template.ts` and their colocated tests.

## D-1 — I-3 dependency test lives in the engine (R1-4, R2-1, R3-4, R5-9)
`evaluate` now attaches I-3 only when removing the `assumedAcceptable` TIV
(from `submission.rollup.pctTivByConstruction`) from the construction share
changes which construction rules fire. The counterfactual re-fires every rule
(base + extensions) that reads `pctTivAcceptableConstruction`, so the 0.5
threshold and comparator come from the rulebook, not a hard-coded 0.5. Closes
the gap E06 D-5 left for E13. `template.ts` is unchanged for I-3: it keeps
trusting `result.interpretations`, which is now correct, so R5-9 is fixed at
the source (also fixes the rule card and every other consumer). On the real
snapshot I-3 goes from 27/27 policies to 6 (SUB-2025-00054, -00070, -00074,
-00083, -00092, SUB-2026-00025); none of the 8 accounts with zero FR/MFR TIV
carry it.

## D-2 — decline wording names only immovable knockouts (R2-3)
A knockout factor is "unchangeable" when one of its component keys is in
`flip.blockedByImmovable` (via `FactorOutcome.componentKeys`, with a private
component→factor table as fallback). All immovable: ", which the insured
cannot change". Some: "; the insured cannot change X". None: no clause.

## D-3 — a broker answer resolves a contradiction (R4-5)
`contradict` returns `status: 'resolved'` when (a) the latest `answer` value
in the slot materially equals (same tolerance as detection) at least one
non-answer value, and (b) that answer is the slot's `bestValue`, i.e. the value
the engine scores on. (b) is an addition to the reviewer's minimal fix: without
it an answer that agrees with the broker but loses to a higher-confidence
enrichment value would hide a conflict the engine is still scoring through.
A reply that conflicts with every submitted value stays open (PRD 7.6).
Severity is unchanged; V-3 already ignores non-open contradictions. On the
real snapshot, SUB-2026-00081 with a confirming receivedDate answer goes
REFER -> FIT.

## Not mine
`golden.test.ts > rating/commercial.json is reproduced byte-for-byte` failed
during this run. `rating:fit` imports only rollup/price/real/fit, none of which
I touched; `stages/rollup.ts` was edited by another fixer mid-run (after the
test had passed for me once).
