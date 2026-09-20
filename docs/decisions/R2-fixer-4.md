# R2 fixer 4 — decisions

Files owned: `packages/engine/src/stages/rollup.ts`, `packages/federato/src/planner/to-bundle.ts`,
`packages/federato/src/actions/request.ts` and their colocated tests.

## D1 — Zero-claim policies (R1-1, R1-2, R2-2, R3-6): fixed in BOTH rollup and to-bundle

The deep pass embeds claims in the Policy row and nothing ever wrote a `records.Claim` key, so
`claims: []` read as "claims never fetched" and 4 of 27 real policies (SUB-2026-00007/-00025/-00028/-00038)
got `fiveYearLoss = null`.

- `to-bundle.ts` now emits `records.Claim = []` when any hydrated policy row carries an expanded claims
  list. This is the W0-2.8 signal, exactly as the contract describes it.
- `rollup.ts` also treats any raw row whose `data.claims` is an expanded list as "fetched". This was
  needed because `packages/engine/src/fixtures/real.ts` (not mine) builds its own bundles with only a
  `Policy` key, and `tests/integration/engine-pipeline.test.ts` asserts planner-path vectors equal
  file-path vectors. With only the to-bundle fix, that parity test would fail on m[8] for the 4 accounts.
- "Expanded" means an array that is empty or holds only objects. A bare id list (`claims: [11, 12]`, the
  unexpanded shape in `snapshot.json`) does NOT count as fetched. Otherwise a policy with real but
  unexpanded claims would get a false known 0.
- The Claim key stays empty (no flattened rows) so normalize never counts a claim twice.

Consequence, outside my files: `packages/engine/rating/commercial.json` was fitted on the wrong loss input.
`golden.test.ts > frozen fit > is reproduced byte-for-byte` now fails (baseRate 0.298 -> 0.3382). The
file needs a `npm run rating:fit` regeneration by its owner. I confirmed the attribution by temporarily
reverting only the rollup change: the golden passes then.

## D2 — Not fixed here (need files I do not own)

- R-I4-2: the paths that request.ts asks for are the right questions. The defect is that merge cannot
  write `*` / `rollup.*` paths while apply-reply reports them as accepted. The fix belongs in merge.ts
  and apply-reply.ts. Changing request.ts to stop asking would hide the gap and fight that fix.
- I3-4: coarse peers belong in peers.ts or rescore.ts. The finding explicitly rules out rollup.
