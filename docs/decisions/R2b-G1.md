# R2b G1 — coarse peers for the 11 no-policy property accounts (R1-3 / I3-4)

PRD 6.4: "For the 11 without a policy, a reduced vector (requested limit,
insured revenue, headquarters state) still places them among peers, labelled
as a coarse match." On the live book those 11 have m = 0 on every peer
component (2..10), so `peers()` over the FeatureVector alone found nobody.

## Decisions

1. **`peers()` takes an optional 6th argument `self?: CanonicalSubmission`.**
   Backwards compatible: without it, behaviour is byte-identical (golden,
   runEngine and price tests unchanged). With it, and only when the account has
   the reduced vector, peers builds a *comparison-only copy* of the vector:
   a missing `totalTiv` is filled by `exposure.requestedLimit`, a missing
   `stateTier` by the HQ state's tier (same TARGET/ACCEPTABLE lists vectorize
   uses, via `canonicalStateCode`). The account's own x/t/m are never touched
   (test: "coarse inputs never enter the vector itself").
   Rejected: filling component 3 in vectorize/rollup — that would score the
   account on a number it never submitted.
2. **Revenue** is not a spec component. A candidate may carry
   `revenue?: number | null` beside the entry (structural extension of
   `PeerVectorEntry`, no types.ts change). It is compared only on the coarse
   path, log-scaled then min-maxed over the revenues present in that one
   comparison, as one extra slot past the spec's last index. `componentsUsed`
   still reports spec indices only ([2, 3]); `comparedComponents` counts revenue.
3. **A coarse-placed account is compared to the policy book only**
   (`!candidate.coarse`): another no-policy account has no rate and no loss,
   so it would add nothing to the benchmark. Every match is labelled coarse.
4. **rescore.ts** attaches revenue to every candidate and, after `runEngine`,
   re-runs peers with `result.canonical` for property accounts, replacing
   `result.peers` only when the account is coarse. Price, score, verdict,
   quality and rank were computed without the coarse inputs and stay as they
   are (coarse inputs feed peers only). The explanation is built after the
   replacement. Triage knockouts (canonical line is Federato's raw line) still
   take no peers.
5. First-finite value is used for requested limit / revenue / HQ state
   (vectorize's confidence-ranked `pickValue` is private). The 11 each carry
   one value per slot, so the choice has no effect on real data.

Observed on the real book: requested limits (1M–25M) mostly sit below the
book's smallest TIV, so min-max clamps them to 0 and HQ state tier (plus
revenue in the API path) does most of the separating. That is what a coarse
match is; it is labelled as such.

## Needs a file G1 does not own

- `packages/engine/src/runEngine.ts` — pass the canonical so the engine path
  (and tests/integration/engine-pipeline.test.ts) places the 11 too, while
  keeping coarse inputs out of pricing:
  ```ts
  const pricingPeers = peerVectors.length === 0 ? null : peers(vector, spec, peerVectors, bookStats);
  const peerResult = peerVectors.length === 0 ? null : peers(vector, spec, peerVectors, bookStats, undefined, canonical);
  const priced = price(vector, spec, ratingTable, canonical, bookStats, pricingPeers);
  ```
  Verified by simulation: all 11 get 5 coarse peers from the policy book.
- `tests/integration/api-flow.test.ts:284` — `it.fails('DEFECT I3-4 ...')` now
  passes, so vitest reports "Expect test to fail"; change `it.fails` to `it`.
- `apps/api/src/services/ingest.test.ts:159-166` pins the defect
  (`expect(noPolicy.peers).toHaveLength(0)`). Replace with
  `expect(noPolicy.peers.length).toBeGreaterThan(0);`
  `expect(noPolicy.peers.every((m) => m.coarse && m.quotedPremium !== null)).toBe(true);`
  and update the comment on lines 159-160.
