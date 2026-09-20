# R2b-G3 — flip pipeline, positional narrate guard, share line

Files changed: `packages/engine/src/runEngine.ts`,
`packages/federato/src/explain/narrate-guard.ts`, `apps/api/src/routes/static.ts`,
plus each file's colocated test.

## R1-2 (pipeline half): runEngine → flip
- `runEngine` now passes `extensions` to `flip`, so the search evaluates FIT with
  the same two rulebooks the verdict uses. An immovable extension refer
  (X-PPC-UNPROTECTED) now gives `flip = null` and `blockedByImmovable:
  ['tivWeightedProtectionClass']`, so `distanceToAppetite = null`, not 0.
- `flip()` takes no contradictions, and flip.ts is not mine. runEngine
  post-processes instead (`withContradictions`): a **zero-move** flip (meaning
  "already FIT") while an open HIGH contradiction stands is replaced by
  `flip = null` with a reason that names the contradicted paths. So a REFER
  that is REFER only because of a contradiction never gets distance 0.
- A flip **with moves** is kept even while a HIGH contradiction is open. Those
  moves clear every appetite and extension rule. Resolving a contradiction is a
  broker question that no vector move answers (V05 decision 6). Rejected: nulling
  every flip while any HIGH contradiction is open. Under R1-5 (receivedDate HIGH
  on all 27 policies) that removed the flip, and the knockout distance ordering,
  from every real account.
- Known gap (flip.ts, not mine): `resolveBounds` builds candidates from the
  base rulebook only. A REFER caused only by a *movable* extension rule
  (X-SPRINKLER-LARGE-UNPROTECTED) now gets `flip = null` ("No move over at
  most two components reaches FIT"). It no longer gets a false 0-move FIT, but it
  also gets no helpful move. The test accepts either null or a flip with moves,
  and never 0.

## R4-8 downstream: narrate-guard is positional
- Uses the same approach as R2-fixer-1 F1-2 in `apps/api/src/llm/calls/narrate.ts`.
  After the set checks (missing / invented) pass, the polished text's numbers must
  equal the template's numbers in order and in count (normalized, so `$240K` still
  matches `$240,000`). So each value keeps its slot in the template, and with it
  the label that slot carries. A swap or a dropped repeat fails, and the result
  falls back to the template. `changedNumbers` names the moved keys.
- Cost: a polish may not reorder numbers. Rejected: label-proximity matching
  (the word before each number). Rewordings such as "a $240K quote" against
  "quoted premium $240,000" would make it reject valid text or miss real swaps.

## Share DTO line of business
- `toShareDto` sends `row.lineOfBusiness`, not `result.lineOfBusiness`. A triage
  knockout's engine result carries Federato's raw line (`cyber`), which fails
  `lineOfBusinessSchema`. The row is always `commercial_property | tenant`, and
  it is also what `GET /submissions/:id` reports.
