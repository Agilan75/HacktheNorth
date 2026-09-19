# R4 — `apps/api` review

Reviewer: R4 (read-only). Date: 2026-09-19.
Scope: `apps/api/src/**`: routes, services, the Gemini call wrappers, and
where each Gemini output ends up. Checked against PRD §8, §9.2, §7.6, §7.7
and §15.

Method: every probe runs the **real committed snapshot**
(`packages/federato/snapshot/snapshot.json`) through the real `createApp` on
an in-memory SQLite DB, with `createMockAdapter` and the fake LLM provider.
There is no network, and enrich/run are never called. Each probe is a
standalone `.mts` file run with `node_modules/.bin/tsx <file>` from the repo
root. Every repro below is complete: paste it after the shared preamble.

```ts
// Preamble shared by every repro (ESM, top-level await).
const R = '/Users/calebchincalebchin/hackthenorth';
const { createDb } = await import(`${R}/apps/api/src/db/client.ts`);
const { migrate } = await import(`${R}/apps/api/src/db/migrate.ts`);
const { createFakeLlm } = await import(`${R}/apps/api/src/llm/fake-provider.ts`);
const { fixedClock } = await import(`${R}/apps/api/src/services/types.ts`);
const { createApp } = await import(`${R}/apps/api/src/app.ts`);
const { createMockAdapter, loadSnapshot } = await import(`${R}/packages/federato/src/index.ts`);
const mk = (handler?: (r: any) => unknown) => {
  const h = createDb({ url: ':memory:' }); migrate(h);
  const deps = { db: h.db, adapter: createMockAdapter({ snapshot: loadSnapshot() }),
    llm: createFakeLlm(handler ? { handler } : {}), clock: fixedClock('2026-09-19T12:00:00.000Z') };
  const app = createApp({ deps });
  const j = async (m: string, p: string, b?: unknown) => (await app.request(p, b === undefined ? { method: m }
    : { method: m, body: JSON.stringify(b), headers: { 'content-type': 'application/json' } })).json();
  return { deps, app, j };
};
```

## What is correct (checked, no finding)

- **DTO conformance.** On the full real book, every response parses against
  its `@retrofit/contracts` schema: `/health`, `/ingest/federato`,
  `/submissions`, `/submissions/:id` (all 38 rows, 0 failures), `/aggregate`,
  `/rules`, `/glossary`, `/actions/plan`, `/actions`,
  `/actions/:id/approve` and `/submissions/:id/reply`.
- **0.8 gate.** `MIN_EXTRACTION_CONFIDENCE = 0.8` is applied in
  `validateExtraction`, and a value at 0.79 goes to `needsConfirmation`. An
  unverifiable PDF quote is capped at 0.79 (`extract-reply.ts:36`) and then
  routed to confirmation (`services/reply.ts:155`), so a PDF value can never
  pass the gate on its own. Answers are written with `answer` provenance and
  no model confidence, so V-7's fixed 0.8 applies (`apply-reply.ts`).
- **Unrequested fields** are dropped twice: in `validateReply` and again as
  `not_requested` in `validateExtraction`.
- **verify-fix** runs the code quality gate before the model. A failed call or
  a degraded one gives `stillPresent: true, confidence: 0`, and a fix counts
  only at or above `MIN_OBSERVATION_CONFIDENCE` (`sweep.ts:417`).
- **relate** is limited to `heaterNearCombustible` and `powerBarOverload`, in
  both the response enum and a code filter (`relate.ts:98`). It can only add
  or adjust a hazard, and never remove one.
- **schema-assist** is not wired into ingest (A16 D6), so ingest is fully
  deterministic.
- Routes `actions.ts`, `reply.ts` and `run.ts` only parse, validate, call a
  service and map errors.

## Findings

### R4-1 BLOCKER: ingest stores 38 submissions, not 158
`apps/api/src/services/ingest.ts:137-170` stores only the planner's bundles.
The 120 accounts knocked out at triage are counted but never written (A16 D6,
a unit decision, not a DECISIONS.md row). PRD §15 says that `npm run seed`
"stores all 158 submissions with results and query traces". PRD §10 says that
non-property rows are "present and collapsed under 'Out of appetite: line of
business'". That makes `displayLine`/`isOutOfAppetiteLine` in
`routes/submissions.ts` dead code.

Repro:
```ts
const { j } = mk(); await j('POST', '/ingest/federato', {});
console.log((await j('GET', '/submissions?limit=500')).page.total); // 38, expected 158
```

### R4-2 BLOCKER: the reply loop reports answers as accepted and re-scored, but the engine throws most of them away
For all 11 no-policy accounts, `selectRequest` asks for `locations.*.state`,
`buildings.*.{tiv,yearBuilt,constructionType}` and `rollup.fiveYearLoss`.
These accounts have 0 buildings and 0 locations. `merge.resolveSlot` returns
null for a `*` id and for `rollup.*`, so it drops those values without any
signal. `services/reply.ts:253-315` still counts them as `accepted`, logs
"6 accepted", and writes a `rescore` action "Re-scored after the broker reply
(locations.*.state, buildings.*.tiv, …)". On re-score only
`pricing.quotedPremium` moved: `x` goes from `[null,1,null…]` to
`[null,1,null,null,90000,null…]`, the canonical still has 0 buildings, and
`20000` is nowhere in it.

Repro (SUB-2025-00115):
```ts
const ans: any[] = [
 ['locations.*.state','OH','The building is located in OH.'],
 ['buildings.*.tiv','$60,000,000','Total insured value is $60,000,000.'],
 ['pricing.quotedPremium','$90,000','The quoted premium is $90,000.'],
 ['buildings.*.yearBuilt','2012','The building was built in 2012.'],
 ['buildings.*.constructionType','Joisted Masonry','Construction is Joisted Masonry.'],
 ['rollup.fiveYearLoss','$20,000','Five-year losses total $20,000.']];
const { j } = mk(r => r.callName === 'extract-reply' ? { values: ans.map(([canonicalPath, value, quote]) =>
  ({ canonicalPath, value, confidence: 0.95, quote })), notFound: [] } : undefined);
await j('POST', '/ingest/federato', {});
const rep = await j('POST', '/submissions/SUB-2025-00115/reply', { text: ans.map(a => a[2]).join(' ') });
console.log(rep.accepted.length, rep.result.vector.m); // 6 accepted; m = [0,1,0,0,1,0,...]: only premium landed
```
Fix: the service must check what the merge actually applied. Better, the
request should never ask for a path the merge cannot write
(`packages/federato/src/actions/request.ts` `missingDataFields` / `FLIP_PATH`).

### R4-3 BLOCKER: extract-reply accepts a dollar value its quote never states (the "no LLM decides a dollar amount" invariant)
Both checks only confirm that the quote appears somewhere in the source
(`extract-reply.ts:297-304`, `federato validate.ts:639`). Neither checks that
the **value** appears in the quote. Only years are tied to their quote. A
reply that states no premium can therefore set one.

Repro:
```ts
const { j } = mk(r => r.callName === 'extract-reply' ? { values: [{ canonicalPath: 'pricing.quotedPremium',
  value: '$90,000', confidence: 0.95, quote: 'Thanks for getting back to us' }], notFound: [] } : undefined);
await j('POST', '/ingest/federato', {});
const rep = await j('POST', '/submissions/SUB-2025-00115/reply',
  { text: 'Thanks for getting back to us. We are still gathering the documents and will follow up next week.' });
console.log(rep.accepted[0].accepted, rep.result.vector.x[4], rep.before.appetiteScore, rep.after.appetiteScore);
// true 90000 15 30
```
Fix: extend the year rule to money, number and percent. Parse every number in
the normalised quote and require one of them to equal the coerced value. For
booleans and categoricals, require the chosen option word in the quote.

### R4-4 MAJOR: a prose date is rejected, and a received date is the only field any policy account is asked for
All 27 policy accounts request exactly one field, `receivedDate`, from their
HIGH contradiction. `services/reply.ts` `LEAF_SPEC` has no date entry, so
extract-reply treats it as a free string. Its prompt then says "Do not compute
or convert". `validateExtraction` accepts only `YYYY-MM-DD`, so the faithful
answer "December 13, 2025" is rejected as `unparseable`.

Repro:
```ts
const { j } = mk(r => r.callName === 'extract-reply' ? { values: [{ canonicalPath: 'receivedDate',
  value: 'December 13, 2025', confidence: 0.95, quote: 'We received the submission on December 13, 2025.' }], notFound: [] } : undefined);
await j('POST', '/ingest/federato', {});
const rep = await j('POST', '/submissions/SUB-2026-00081/reply', { text: 'We received the submission on December 13, 2025.' });
console.log(rep.accepted.length, rep.rejected.map((v: any) => v.rejection)); // 0 [ 'unparseable' ]
```

### R4-5 MAJOR: an accepted answer can never clear a HIGH contradiction
The engine only ever emits `status: 'open'` (`packages/engine/src/stages/contradict.ts:263`).
There is no `resolved` path. When the broker answers the one field a
contradiction-triggered request asks for, and the value is accepted, the
account stays REFER at the same score and rank, with the contradiction still
open. This is the case for all 27 policy accounts. SUB-2026-00081 is in
appetite on every factor and is REFER only because of this contradiction.

Repro: R4-4 with `value: '2025-12-13'` and the quote `'Our records show it was received 2025-12-13.'`
→ `accepted 1`, `before REFER rank 1 → after REFER rank 1`, contradictions
`[["receivedDate","HIGH","open"]]`.

### R4-6 MAJOR: an answered submission type is dropped and logged as "not answered"
`services/reply.ts:86` gives `submissionType` the options
`['new_business','renewal']`. `extract-reply.ts:205` then compares them by
exact, case-folded string equality, so the prompt's verbatim answer
"new business" matches neither option. It lands in `notFound`. The reply
action's note says "not answered: submissionType" even though the broker
answered it. This field is asked of all 11 no-policy accounts.
`validateExtraction` would have accepted it through `snake()` and its aliases.

Repro: in R4-2, add `['submissionType','new business','This is a new business submission.']`
→ `rep.action.note` ends "not answered: submissionType".

### R4-7 MAJOR: draft-request lets Gemini ask for things that were never selected
PRD §9.2 says code checks "nothing else is asked for". `draftProblems`
(`draft-request.ts:124-132`) only inspects bullet lines and sentences ending
in `?`. `validateDraft` only flags extra requests that name a known leaf
phrase. A plain request sentence for anything else passes both, and is saved
with `actor: gemini:draft-request`.

Repro:
```ts
const { j } = mk(r => { if (r.callName !== 'draft-request') return undefined;
  const labels = r.prompt.split('\n').filter((l: string) => l.startsWith('- ') && l.includes(' — ')).map((l: string) => l.slice(2).split(' — ')[0]);
  return { subject: 'Information needed', body: ['Hello,', '', ...labels.map((l: string) => `- ${l}: needed to finish the review`), '',
    'Please also send us the signed ACORD 125 application and a copy of the current lease agreement.', '', 'Thank you.'].join('\n') }; });
await j('POST', '/ingest/federato', {});
const plan = await j('POST', '/actions/plan', { externalIds: ['SUB-2026-00081'] });
console.log(plan.actions.find((a: any) => a.type === 'request').actor); // gemini:draft-request, extra ask kept
```
Fix: reject every non-bullet sentence that carries a request cue (please,
send, provide…) unless it is the fixed closing line.

### R4-8 MAJOR: narrate can swap two numbers and the swap is served as the explanation
`survivalProblems` (`narrate.ts:82-89`) and `narrateGuard` (federato) compare
numbers as a **set**. Swapping quoted and predicted premium keeps the set, so
both guards pass. `GET /submissions/:id` then returns `narrated: true` with
"quoted premium $63,835 against a predicted $58,800", which reverses the
adequacy story.

Repro:
```ts
const { j } = mk(r => r.callName === 'narrate' ? { text: 'Coastal Freight Systems LLC is referred with an appetite score of 88/100, ranked #1 in the queue: TIV $18.5M, quoted premium $63,835 against a predicted $58,800, 5-year losses $0. In appetite on every factor; conflicting values on received date; fire-resistive construction is treated as acceptable, an assumption. Recommendation: investigate, because the broker must supply the conflict on received date.' } : undefined);
await j('POST', '/ingest/federato', {});
const d = await j('GET', '/submissions/SUB-2026-00081');
console.log(d.explanation.narrated, d.explanation.text.includes('quoted premium $63,835')); // true true
```
Fix: compare the number tokens as an ordered sequence, or check each number
together with its label.

### R4-9 MAJOR: the buildings table marks steel-frame buildings as not acceptable construction
`routes/submissions.ts:211-231` works out `acceptableConstruction` in the
handler, which is itself business logic in a route (PRD §8). It matches the
building's `steel_frame` against the rollup keys by exact string. The rollup
keys it as `steel` (acceptable), so the match fails and the row shows `false`.
8 of 117 real building rows are wrong. One is SUB-2026-00081 "Storage Shed A",
which is 74.5% of the TIV while the construction factor calls it acceptable.

Repro: `d = await j('GET','/submissions/SUB-2026-00081')` →
`d.buildings[0].constructionType === 'steel_frame'`,
`acceptableConstruction === false`, while
`d.rollup.pctTivByConstruction[0]` is `{constructionType:'steel', acceptable:true}`.
Fix: the engine or rollup should expose each building's class verdict, and the
route should copy it.

### R4-10 MINOR: the explanation claims a fire-resistive assumption on accounts with no fire-resistive building
27 of 27 policy accounts say "fire-resistive construction is treated as
acceptable, an assumption". 8 of them have no fire- or modified-fire-resistive
building. SUB-2026-00081 has only steel_frame and wood_frame. The engine
surfaces interpretation I-3 whenever the construction rule runs, and
`packages/federato/src/explain/template.ts:332` prints it.

Repro: for each row of `/submissions`, fetch the detail and test
`/fire-resistive … assumption/` against `buildings[].constructionType`.

## Notes (not findings)
- Every one of the 27 policy accounts carries a HIGH `receivedDate`
  contradiction between `Policy.submission.received_date` and
  `Policy.dates.submission_received`. That is real disagreement in the data.
  Combined with R4-5, no account in the real book can reach FIT. This is worth
  a look from whoever owns the synonym table (R3).
- `seededBrokerReply()` (`scripts/seed-data.ts`) is referenced only by its own
  test. It answers "Building C / Hollis Street" questions, but no real account
  is asked those, and nothing wires it into the demo.
