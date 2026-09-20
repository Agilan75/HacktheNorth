# CP1-FX4 — offline LLM tests moved out of `*.live.test.ts`

**Problem.** A02–A06 each owned only a `*.live.test.ts` path, so their offline suites (fake
provider / injected `fetchImpl`, no network) sat in files `vitest.config.ts` excludes unless
`RUN_LIVE=1`. 98 offline tests never ran in the default suite.

**Change.** Per requests A02–A06, every offline `describe` block was moved verbatim into a
non-live file beside it; each `*.live.test.ts` now holds only its live smoke block plus the
fixtures that block needs. Only headers and imports were edited.

| Unit | Live file (smoke only) | New offline file(s) | Tests |
|---|---|---|---|
| A02 | `llm/gemini.live.test.ts` | `llm/gemini.test.ts` | 30 |
| A03 | `llm/calls/observe.live.test.ts` | `llm/calls/observe.test.ts`, `llm/calls/relate.test.ts` | 7 + 4 |
| A04 | `llm/calls/narrate.live.test.ts` | `llm/calls/narrate.test.ts` | 18 |
| A05 | `llm/calls/second-opinion.live.test.ts` | `llm/calls/schema-assist.test.ts`, `llm/calls/second-opinion.test.ts` | 10 + 8 |
| A06 | `llm/calls/extract-reply.live.test.ts` | `llm/calls/draft-request.test.ts`, `llm/calls/extract-reply.test.ts` | 7 + 14 |

Total 98, all passing with RUN_LIVE unset (the `vitest.setup.ts` fetch guard is active; no
NETWORK_BLOCKED).

**Decisions.**
1. **A03 split into `observe.test.ts` + `relate.test.ts`.** The fixtures separate cleanly
   (`img`/`observeInput`/`textsOf` are observe-only, `relateInput` is relate-only), so the
   optional split was taken.
2. **A04 kept in one file, `narrate.test.ts`.** The narrate and verify-fix blocks share the
   fixture section (`TINY_PNG` etc.); splitting would duplicate it for no gain.
3. **A04 `vi.mock('../generate-json')` shim dropped** from both files. Verified first:
   `generateJson` in `apps/api/src/llm/generate-json.ts` is fully implemented and nothing in
   non-test `apps/api/src/llm/**` throws `NOT_IMPLEMENTED`, so the shim was a pure pass-through.
   All 18 tests pass without it.
4. **Shared fixtures are duplicated, not shared via a helper module.** Where the live smoke
   needs a fixture that the offline block also uses (A02 `narrateZod`/`narrateResponse`, A04
   `NARRATE_INPUT`/`VERIFY_INPUT`/`TINY_PNG`, A06 `draftInput`/field specs/`extractInput`), it
   is copied into both files. Keeps "move verbatim, fix only imports" and avoids a new non-test
   source file (out of FX4's ownership).

**Not done / follow-up.** `OWNERSHIP.json` / `UNITS.json` were not edited (not FX4's files); the
new paths should be assigned to A02–A06 as the requests ask. `npx tsc --noEmit -p apps/api`
is clean for every FX4 file; its only errors are in `apps/api/src/routes/submissions.test.ts`
(`vectorSpec` missing on `SubmissionDetailDto`), which FX4 does not own.
