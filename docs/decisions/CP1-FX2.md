# CP1-FX2 — peer distance robustness and the symmetry invariant

Files: `packages/engine/src/stages/peers.ts` (+ test), `packages/verify/src/invariants/vector.ts` (+ test).

## Root cause
`peers.ts` used `scaledEuclidean` from `util/math.ts`, which skips non-finite
inputs but not overflow: with `rule: 'none'` components carrying ±Number.MAX_VALUE,
`(a - b)²` overflows to Infinity, so d = Infinity (and `Infinity - Infinity` = NaN
in the invariant's symmetry check). Infinity serialises as `null` in the 100K
report, which is the `{ distance: null }` seen for seed 20260919 case 40.

## Decisions
1. **Private overflow-safe distance in peers.ts** (`pairDistance`), instead of
   editing `util/math.ts` (not owned). Compares only components known on both
   sides with finite scaled values; rescales by the count compared (PRD 6.4).
   When the largest compared magnitude exceeds 1 it pre-divides by it, so no
   square overflows; result capped at Number.MAX_VALUE. For values in [0, 1]
   (the normal case, and every case once FX1's clamp lands) the arithmetic is
   bit-identical to the old formula. Rejected: clamping into [0, 1] inside peers —
   that would make distinct out-of-range values compare equal (d = 0 for
   non-identical vectors, breaking PRD 12) and duplicates FX1's job.
2. **Zero only for identical**: exact 0 when every compared pair is equal; a
   non-zero difference that underflows in the pre-division is floored at
   Number.MIN_VALUE.
3. **Null only when nothing is comparable**; the reason is carried in the private
   result (`ok: false, reason`) and the pair is dropped (P-1). `PeerMatch` has no
   reason field and `types.ts` is frozen, so it is not surfaced further.
4. **Invariant**: new exported `checkPeerPair(ab, ba, label)`. Null both ways
   (bare null or `distance: null`) is symmetric; null vs a number is a
   violation; non-finite/negative flagged per direction; symmetry compared only
   when both are finite; componentsUsed must match both ways.
5. **componentsUsed comparison uses the compared set** (componentsUsed ∩ known
   and finite on both sides), not the raw query-level list. `peers()` reports
   the coarse set [2,3] when the query vector is reduced and [2..10] otherwise,
   so a reduced-vs-full pair legitimately reports different lists while
   comparing exactly the same components. Rejected: raw list equality (false
   violations on every reduced-vs-full pair).

Sampled 5,000 cases of seed 20260919 through the invariant after the fix: 0 violations.
