# R5 — Console review (apps/console)

Reviewer: R5 (read-only). Date: 2026-09-19.

## Method

Rendered the real console against the real snapshot rather than reading
fixtures. A scratchpad script (no network, no listening server) built the API
in-process with `createApp({ deps })` over `createMockAdapter({ snapshot:
loadSnapshot() })`, `createFakeLlm()` and an in-memory DB, ran
`POST /ingest/federato` and `POST /actions/plan`, then:

1. drove `createApiClient({ baseUrl, fetchImpl: (u, i) => app.request(u, i) })`
   over every route and dumped each view model next to its raw DTO; and
2. mounted `<App/>` in jsdom under `MemoryRouter` with `globalThis.fetch`
   pointed at `app.request`, for `/queue`, `/submissions/SUB-2026-00081`,
   `/submissions/SUB-2025-00115`, `/actions`, `/rules`, `/glossary` and
   `/aggregate`, and ran `dom-accessibility-api`'s `computeAccessibleName`
   over every focusable element.

Repro harness (run from a scratchpad dir, `tsx --tsconfig apps/console/tsconfig.json`):

```ts
const handle = createDb({ url: ':memory:' }); migrate(handle);
const deps = { db: handle.db, adapter: createMockAdapter({ snapshot: loadSnapshot() }),
  llm: createFakeLlm(), clock: fixedClock('2026-09-19T12:00:00.000Z') };
const app = createApp({ deps });
await app.request('/ingest/federato', { method: 'POST' });
const client = createApiClient({ baseUrl: 'http://x',
  fetchImpl: (u, i) => app.request(String(u).replace('http://x', ''), i) });
```

## What holds up

- **Adapter banner.** Rendered in the header on every route, in every state
  (loading, error, unknown, live, snapshot). The state is in words
  ("Data source: Snapshot"), `role="status"`. `mock` maps to "Snapshot". No
  route or style hides it.
- **Panels a–l.** All twelve render, in PRD order, each in its own error
  boundary, with real data for SUB-2026-00081. (j) shows "No enrichment has run"
  offline, which is expected. (l) shows "No photo or sweep is attached", which
  is also correct.
- **Verdict pills** always carry the word plus an sr-only long label. Badges carry
  text. Every focusable control has an accessible name. The Approve buttons are
  disambiguated per insured.
- **Queue, aggregate and score breakdown numbers** trace straight to DTO fields.
  The score total is `appetiteScore`, never a re-sum. Rank is the API's rank.
  Completeness is read as 0–100, and adequacy and confidence as ratios.

## Findings

### R5-1 BLOCKER — The 120 non-property submissions never reach the queue, so "Out of appetite: line of business" never renders
`apps/api/src/services/ingest.ts:137` stores only planner bundles. Triage
knockouts are counted (`knockedOutAtTriage: 120`) but never persisted. After
ingest, `GET /submissions` returns **38** rows. Every row has
`outOfAppetiteLine: false`, and `/aggregate` reports `counts.total: 38`.
PRD 10 says "Non-property rows are present and collapsed", and PRD 15 says
seed "stores all 158 submissions". `QueuePage` shows the group only when rows
exist, so the group is never shown. The Line filter lists only
`commercial_property`.

### R5-2 BLOCKER — The Flip panel labels predicted premium as "Quoted premium"
`apps/console/src/api/client.ts:472` sets `premiumBefore =
result.price.predictedPremium`. `panels/Flip.tsx:86` renders it under the label
"Quoted premium". This is wrong on 27 of 38 accounts. SUB-2026-00081 shows
"Quoted premium $63,835" when it is quoted at $58,800. SUB-2026-00014 shows
$433,752 when it is quoted at $703,500. Panel (d) on the same page shows the
correct quoted figure.

### R5-3 BLOCKER — The Buildings panel flags every Steel Frame building "unacceptable construction"
`apps/api/src/routes/submissions.ts:212-215` compares the raw
`constructionType` ("steel_frame") against the rollup's normalized key
("steel"). There is no match, so `acceptableConstruction` falls back to false.
This affects 8 of 117 buildings. On SUB-2026-00081, building 109 (Steel Frame,
$13.8M) is flagged unacceptable. The rollup two lines above says 74.6% of TIV
is in acceptable construction, which is exactly that building, and /rules
lists Steel Frame as acceptable.

### R5-4 BLOCKER — Wrong insured name on all 11 no-policy accounts (queue ranks 2–12)
`packages/engine/src/stages/discover.ts` (the group resolution around
`:380-415`) maps `Submission.insured.hq.name` (a Location's name) to
`insured.name`. SUB-2025-00115 is shown everywhere as "Regional Branch 1". Its
insured is "Halcyon Metalworks Corp" (snapshot Insured id 5). The bad mapping
also creates a bogus `insured.name` contradiction on each of these accounts.

### R5-5 MAJOR — The Contradictions count is inflated on every account by NAICS vs SIC
`discover.ts` maps both `insured.naics_code` and `insured.sic_code` to
`insured.industry`. They are two different code systems, not competing values,
so every one of the 38 accounts carries an open "insured.industry"
contradiction. The queue's Contradictions column reads "2" on every row, and
one of the two is always this false positive.

### R5-6 MAJOR — The Flip panel says "already in appetite" next to a REFER verdict
The engine returns a flip with `moves: []` and `verdictAfter: 'FIT'` for
SUB-2026-00081. That account is REFER because of an open HIGH contradiction,
and applying zero moves does not yield FIT (F-6, PRD 12). The console shows
"In appetite / No flip needed: this account is already in appetite." beside a
REFER pill. The source is `packages/engine/src/stages/flip.ts`, which ignores
the contradiction and refer paths. The copy in `panels/Flip.tsx:70` also keys
on distance 0 and never checks the verdict.

### R5-7 MAJOR — Pricing (d) is not factor by factor: per-building rating is dropped
`client.ts:393` maps only `price.factors`, which on commercial holds only
`lossHistory`. `price.perBuilding` (baseRate, then the construction, age,
protectionClass and sprinkler multipliers, then the per-building premium) is
never shown. For SUB-2026-00081 the table is one row, "lossHistory ×1.09",
under a $63,835 premium. Nothing on the page gets from TIV to that number.
PRD 10(d) calls for "factor-by-factor premium".

### R5-8 MAJOR — "Value of information 0.0 pts" is invented
`client.ts:577` falls back to `?? 0` when no VOI entry exists. For commercial,
`result.voi.ranked` is empty on all 38 accounts, so all 104 requested fields
across the book show "0.0 pts". That number is not in the DTO. It should be
"—" or omitted.

### R5-9 MAJOR — The explanation claims a fire-resistive assumption that was not applied
`packages/federato/src/explain/template.ts:331` adds "fire-resistive
construction is treated as acceptable, an assumption" whenever I-3 appears in
`result.interpretations`. The engine lists I-3 whenever the construction field
is touched (`evaluate.ts:457-465`). 8 accounts carry the sentence, in panel (a)
and in the queue's Why column, with no fire-resistive building. SUB-2026-00081
is one: its buildings are steel and wood frame.

### R5-10 MAJOR — The Vector panel's tier names contradict the Score breakdown
`panels/Vector.tsx:36-41` derives the tier name from the value (1 → "Target",
0.6 → "Acceptable"). The engine's tier label, used by panel (b), says
Acceptable (1.0) for the T-BLANK factors (submission type, line, construction,
loss). For SUB-2026-00081, (h) prints "1 · Target" for components 0, 1, 7 and
8, while (b) prints "Acceptable (1.0)". A `refer` tier also shows as
"Acceptable".

### R5-11 MINOR — A failed broker reply erases the pasted text
`pages/SubmissionPage.tsx:248` `run()` catches the error, so `onSubmitText`
always resolves. `ReplyBox.tsx:101/112` then calls `onOk`, which does
`setText('')`. Repro: make `postReply` reject, for example a 500 from
`/submissions/:id/reply`. The alert shows and the textarea is emptied. The
same happens to the file input. ReplyBox's own error branch is unreachable.

### R5-12 MINOR — The aggregate one-flip fallback invents a verdict, rank and premium
`client.ts:705-724`: when the queue fetch fails or has no row for the id, the
row is built with `rank: 0`, `qualityIndex: 0`, `verdict: 'REFER'` and
`predictedPremium: o.premiumAfter`. The page then renders a REFER pill and a
"Predicted premium" that is really the post-flip premium. One-flip accounts
are often DOES_NOT_FIT (distance 1).

### R5-13 MINOR — Focusable elements with no interactive role (PRD 13)
- `components/Tooltip.tsx:178` is a `<span tabIndex=0>` with no role and an
  empty computed accessible name. It is flagged by the scan on /rules.
- `components/DataTable.tsx:189`: clickable `<tr tabIndex=0>` rows have no
  button or link role, so their activation is not announced.

## Not findings (checked, correct or settled)
- 0 FIT / 12 REFER / 26 DNF: SUB-2026-00081 is REFER only through V-3.
  `Policy.submission.received_date` and `Policy.dates.submission_received`
  disagree on 27 of 27 real policies, and receivedDate feeds the loss window.
  This is contract-correct, and worth a product look.
- Ranks 2–12 (quality 20.9) sit above DNF rows with quality around 85. That is
  P-6.
