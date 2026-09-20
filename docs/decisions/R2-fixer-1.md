# R2 fixer 1 — ingest knockouts, narrate number order, coarse peers

## F1-1 — Triage knockouts are stored and scored (I2-1, I3-1, R3-1, R4-1, R5-1)
Supersedes **A16 D6** ("Triage knockouts ... are counted, not stored"), which
contradicted PRD §15 / §11 / §7.7 and INTERPRETATIONS 3.8.

- `ingestFederato` stores one row per `planned.plan.knockedOut` entry (filtered
  by `externalIds` when given; same idempotency / `force` rule as survivors).
- The raw bundle is the one `Submission` row triage already read
  (`id`, `submission_number`, `status`, `line_of_business`) — the same shape
  `toBundles` builds for a survivor with no policy — so `federatoLine(row)` in
  routes/submissions.ts finds Federato's own line for the queue's display line.
- `queryTrace` is the triage entries only (`pass === 'triage'`, including any
  adapt retry of triage).
- The **row** stays `lineOfBusiness: 'commercial_property'` (scored with the
  commercial spec, ranked in the commercial queue); the **canonical**
  `lineOfBusiness` is set to Federato's raw line (e.g. `cyber`). Stage 6 reads
  that through G-11 and gives `isPropertyLine = 0`, so evaluate records a
  line_of_business knockout and the verdict is DOES_NOT_FIT with a templated
  explanation. This is a deliberate widening of the `LineOfBusiness` type on
  the canonical (cast); the engine already handles non-property strings there.
- Consequence: `EngineResult.lineOfBusiness` for these rows is the raw line.
  Nothing on the queue/detail path reads it for them; see notFixed about
  `/share`.
- Response counters: `ingested` / `updated` / `skipped` and `externalIds` count
  every stored row, knockouts included (158 on the real book), so
  `ingested === externalIds.length === stored rows` holds, which seed.ts and
  the api-flow test rely on. `knockedOutAtTriage` stays 120.
- Knockouts never enter the high-scorer follow-up (they are not in `touched`).
- Verified: the 38 property results (all fields but canonical/asOf, and rank)
  are byte-identical with and without the 120 knockouts in the book — they
  contribute no peer component and no premium, so BookStats-dependent numbers
  do not move.
- A request for a knocked-out id now warns
  "`<id>` was knocked out at triage (reason); stored as out of appetite."

## F1-2 — narrate numbers compared in order (R4-8)
`survivalProblems` still reports missing / invented numbers by set, and then
requires the template's number tokens to appear in the same order and
multiplicity. A swap (quoted <-> predicted premium) or a dropped repeat falls
back to the template. Cost: a polish may not reorder numbers.

## R1-3 — not fixed here
peers.ts only sees the vector. For a no-policy account the vector carries no
`totalTiv` and no `stateTier`, so no change inside peers.ts can place it.
The fix belongs in vectorize.ts / rollup.ts (see the fixer report).
