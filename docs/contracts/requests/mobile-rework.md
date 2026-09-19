# Contract request — mobile-rework

**File:** `packages/engine/src/rules.tenant.test.ts` (two `describe('questions/tenant.json')` cases).

**Change (additive to the data file, corrective to the test):** `questions/tenant.json` no longer
holds `q-contents-limit`. Two assertions in that test still assume it does.

1. Line ~152 — `expect(questions.questions).toHaveLength(tenantSpec.components.length)`.
   The 1:1 question-per-component invariant no longer holds: there are 14 components and 13
   questions, because `contentsLimit` is derived from the sweep and is never asked. Replace with
   the invariant that actually holds now — every question addresses a component, and every
   component except `contentsLimit` has a question:

   ```ts
   const DERIVED_COMPONENTS = new Set(['contentsLimit']);
   expect(questions.questions.length).toBe(
     tenantSpec.components.filter((c) => !DERIVED_COMPONENTS.has(c.key)).length,
   );
   ```

2. Line ~176 — `it('offers a contents option on each side of the $100,000 refer line')`. There is
   no contents question to offer options on. The rule boundary it really guards is still worth
   pinning, so keep the last line and drop the question lookup:

   ```ts
   it('puts the contents refer line at $100,000', () => {
     expect(fired(tenant, { contentsLimit: 100000 })).toEqual(['T-CONTENTS-STANDARD']);
     expect(fired(tenant, { contentsLimit: 150000 })).toEqual(['T-CONTENTS-HIGH']);
   });
   ```

**Why this unit cannot proceed without it:** Phase A of the mobile rework requires that the renter
is never asked to value their own belongings — that valuation is the thing the app exists to do.
`exposure.contentsLimit` is now summed from what the sweep priced, rounded up to the nearest
$5,000 over a $15,000 floor, with `source: 'sweep'` provenance. Leaving `q-contents-limit` in the
file would leave a question the app must never show, addressable through the answers endpoint,
contradicting the rule that no observable or derived field is ever asked.

**Workaround in place:** none is possible inside this unit's remit. `packages/engine/src/**` is
off-limits to this task (task rule 1) and every `*.test.ts` under it is frozen by AGENTS.md §2, so
the two cases above fail on `feat/ar-sweep` until a human applies this patch. Nothing else is
affected: `parseQuestions` drops unknown keys, so the added `observable` flag is invisible to the
engine, and the API reads it straight from the JSON file
(`apps/api/src/services/sweep.ts`, `readObservableQuestionIds`) rather than widening the frozen
`Question` type. The remaining 888 engine and API tests pass.

**Also for the record, not a request:** three engine/api tests fail on Windows independently of
this branch — `data.test.ts` "resolves data beside src/" (expects `/` path separators),
`fixtures/golden.test.ts` "byte-for-byte" (expects LF, gets CRLF), and `scripts/backfill.test.ts`
(reads the gitignored `apps/api/data/backfill`). All three fail identically on `build/retrofit`.
