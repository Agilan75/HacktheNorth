# backfill-restore — rebuild the eleven no-policy backfill files from the snapshot

Stage: repair. Problem: `apps/api/data/backfill/` was never committed. `git ls-files apps/api/data`
was empty and nothing in `.gitignore` covered that path, so the eleven hand-authored files existed
only on the machine that wrote them. `apps/api/src/scripts/backfill.test.ts` asserts that exactly
eleven parse, so it failed on a fresh clone of any OS, and `npm run backfill -w @retrofit/api` could
not run at all.

The originals were not recoverable. They are in no commit on any branch, and the local
`apps/api/data/retrofit.db` holds no canonical carrying `sourceDetail: 'synthetic:backfill-v1'`, so
the backfill had never been applied to it either. The files were rebuilt instead.

## Which eleven

A no-policy account is `accountKindOf` in `apps/api/src/routes/submissions.ts`: a Federato row that
is not knocked out on line of business, whose raw bundle has no `Policy` record, and whose canonical
has no buildings. 131 of the 158 submissions have no Policy; 120 of those are triage knockouts on a
line Retrofit does not score. Eleven remain:

| External id | Insured | HQ | Buildings | TIV |
| --- | --- | --- | --- | --- |
| SUB-2025-00115 | Halcyon Metalworks Corp | Oakland CA | 3 | $54,397,000 |
| SUB-2025-00126 | Lakeside Medical Group Group | Houston TX | 3 | $35,716,000 |
| SUB-2025-00132 | Harbor Point Retail LLC | Denver CO | 1 | $12,258,000 |
| SUB-2025-00134 | Willowbrook Stores Inc | Austin TX | 1 | $24,302,000 |
| SUB-2025-00138 | Lumen Data Works Inc | Miami FL | 1 | $2,073,000 |
| SUB-2025-00143 | Aperture Cloud Corp | Seattle WA | 1 | $26,254,000 |
| SUB-2026-00118 | Lakeside Medical Group LLC | Miami FL | 2 | $29,244,000 |
| SUB-2026-00131 | Cedar Valley Health LLC | Sacramento CA | 2 | $13,436,000 |
| SUB-2026-00133 | Merrin Hale LLP | Chicago IL | 2 | $23,279,000 |
| SUB-2026-00141 | Lakeside Medical Group Group | Houston TX | 3 | $35,716,000 |
| SUB-2026-00147 | Fielder's Table Inc | Nashville TN | 1 | $10,628,000 |

## Decisions

| # | Decision | Why | Rejected alternative |
| --- | --- | --- | --- |
| D1 | **The values are read from the committed snapshot, not invented.** Each submission names its insured, the insured names its headquarters `Location`, and that location lists `buildings`. Every one of those `Building` records is in `packages/federato/snapshot/snapshot.json` with a real `tiv`, `year_built`, `construction_type`, `sprinklered`, `stories`, `roof_year` and `occupancy`. Claims reach the same insured through its other policies. | Federato holds all of it. Its query reaches buildings through a `Policy` record these eleven submissions do not have, which is the only reason the account pages were blank. The snapshot was fetched table by table, so it carries what the per-submission query could not. The header comment in `backfill.ts` describing values written "from each account's industry, revenue and state" now describes the code that replaced it. | Hand-authoring plausible values from industry, revenue and state, which is what the lost originals did. Eleven real accounts would carry eleven invented numbers when the real ones are in the tree. |
| D2 | **Summing the location's buildings is the account's TIV.** | Where the snapshot also carries a location-level `ExposureUnit` with `basis: 'tiv'`, its `basis_amount` equals that sum exactly, for all eight of the eleven that have one. Two independent records agreeing is as close to a check as this data allows. | Trusting the `ExposureUnit` alone, which three accounts do not have. |
| D3 | **One reported building carries the portfolio, with its characteristics chosen so the engine's percentages keep the portfolio's real classification.** The merge grammar (`wildcardEntry`, `merge.ts`) gives a `*` path the account's only entity, or creates one when it has none, and drops the value when there are several. So a file can describe one building and one location, no more. Year built is the value-weighted mean. Construction is the class holding the most value on the majority side of the acceptable/not-acceptable split. Sprinklered follows the value-weighted majority. | Every rule that reads these is a majority test — `pctTivPre1990 > 0.5`, `pctTivAcceptableConstruction >= 0.5`, and so on. Choosing the majority side keeps the verdict the real portfolio would earn. It was checked account by account: the weighted mean year lands on the same side of 1990 as the real value-weighted share in all eleven, and the majority-side class keeps SUB-2025-00115 acceptable at its real 60%, where the single largest building alone (Frame, $21.6M of $54.4M) would have flipped it. | The largest building's own attributes, which flips SUB-2025-00115 from acceptable construction to not acceptable. Several `buildings.*` entries, which the merge grammar drops as ambiguous. |
| D4 | **Each file states the approximation in its own `rationale`.** | The single reported building reports 100% sprinklered where the portfolio is 74%, and 100% acceptable construction where it is 60%. The rule outcome is right and the percentage is coarse. Whoever reads the account page should be able to find that out from the file that produced it. | Leaving the loss of resolution undocumented. |
| D5 | **Five-year incurred loss is the real claims on the insured's other policies**, dated within the window the engine uses: the received date back five years, both ends inclusive (INTERPRETATIONS I-4). Paid indemnity plus paid expense plus both reserves, matching `rollup.ts`'s `windowTotal` exactly, because the merge lands one aggregate claim and the engine totals it the same way. | The claims are real and they are the insured's. Totalling them differently from `rollup` would mean a backfilled account and a populated one measure loss differently. | Paid indemnity alone, which understates every account against its populated peers. |
| D6 | **The premium is the account's TIV at 0.4319%, the median rate of the book's six full-value property placements** — the policies whose `limit` equals their insured's total building value, so premium and values are comparable. | It is the only figure with no source: these submissions were never quoted. A rate drawn from the book's own comparable placements is the nearest thing to evidence. The result is not flattering and was not tuned: eight of the eleven land inside the appetite's acceptable premium band, one above it and two below. SUB-2026-00147 lands at $45,900, which is what the insured's own expiring policy actually charged on the same buildings. | A sibling policy's premium. The insured's other policies quote wildly different premiums on unrelated limits (one is $5.5M on a $1M limit), so a sibling would have produced nonsense. |
| D7 | **Renewal only where the insured holds a policy expiring on the submission's target effective date**; everything else is new business. One account qualifies, SUB-2025-00126, whose policy 1057 expires 2025-10-01, its target effective date. | That is what a renewal is, and it is a test the data can answer. `submissionType` is scored (`AG-ST-NA` makes a renewal not acceptable), so guessing it would move a verdict. | Marking all eleven new business, which is convenient and would have flattered SUB-2025-00126. |
| D8 | **Files are named for their external id** and carry `rationale`, not `targetVerdict`. | `readBackfillDir` sorts by filename, so the id sorts them into book order. `targetVerdict` is optional, is never read by `runBackfill`, and naming an intended verdict for values this file is supposed to derive honestly would invert the engine's job. | Recording a target verdict per account. |

## Verification

- `npx vitest run apps/api/src/scripts/backfill.test.ts` — 3 passed. Eleven files parse and every
  path is inside the whitelist.
- A temporary check, run once and deleted, merged each file over that account's stored canonical and
  ran `rollup`. All ten components the eleven accounts were missing — `isNewBusiness`, `stateTier`,
  `totalTiv`, `quotedPremium`, `pctTivPre1990`, `pctTivPost2010`, `pctTivAcceptableConstruction`,
  `fiveYearLoss`, `pctTivSprinklered`, `tivWeightedProtectionClass` — resolve for all eleven, and
  each merge produces exactly one building and one location.
- `npm test` — 1,925 passed, 156 files. The suite is green for the first time in this repository's
  history; the previous best was 1,924 with this one test failing.

## For whoever runs the demo

`npm run backfill -w @retrofit/api` now works. It is idempotent: an account whose canonical already
carries a synthetic value is skipped. Nothing here has been applied to any database yet, local or
deployed, so the account pages still show dashes until someone runs it.

If the original eleven files turn up on another machine, they are the ones the team has looked at,
and they should replace these. Nothing else in the tree depends on the values.
