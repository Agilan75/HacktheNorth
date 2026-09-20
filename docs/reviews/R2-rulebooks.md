# R2 — Rulebooks, citations and reference transcriptions

Reviewer: R2 (read-only). Date: 2026-09-19.
Scope: `packages/engine/rules/{commercial,extensions,tenant}.json`,
`packages/federato/src/reference/{guidelines,glossary}.ts`, and every consumer
of a rule citation or interpretation (evaluate, verdict, explain template,
console rules page) checked against `docs/federato/APPETITE_GUIDELINES.pdf`,
`GLOSSARY.pdf`, `INTERPRETATIONS.md` and PRD 6.6.

Method: `pdftotext` (raw and `-layout`) on both PDFs. Every quote was checked
mechanically after collapsing whitespace, and table-cell line breaks were
checked by hand against the `-layout` render. All 38 real cases
(`realCases()`) were then run end to end through `runEngine` + `explain` with
the committed rulebooks and rating table. Scripts are in my scratchpad, not in
the tree.

## What is correct (checked, no finding)

- **All 24 Federato citations in `commercial.json` are verbatim** from AG p2.
  Two cells wrap in the PDF (`OH, PA, MD, CO, CA, FL,` / `NC, SC, GA, VA, UT`,
  and `>50% JM, non-` / `combustible/steel, or` / `masonry non-` /
  `combustible`). Joining the wraps gives the quoted text exactly. Page 2 is
  pure ASCII, so `$50M-$100M` uses a real hyphen. Section labels match the
  row labels, including `TIV (Total Insured Value)`.
- **All four PRD quotes (I-1..I-4) and X-OURS are verbatim** from PRD 6.6.
  TN-PAIR is verbatim from PRD 6.3.
- **Thresholds match INTERPRETATIONS §3 exactly**, including every
  inclusive/strict edge: TIV 50M/100M inclusive Target, 150M inclusive
  Acceptable; premium 50K/175K inclusive Acceptable, 75K/100K inclusive
  Target; loss 100,000 Acceptable; construction 0.5 Acceptable; pre-1990
  `> 0.5` NA; post-2010 `> 0.5` Target. Each factor's rules are exhaustive and
  do not overlap. The weights equal W-1.
- `AG-AGE-REFER` (`pctTivPre1990 <= 0.5 AND rollup.oldestYearBuilt < 1990`)
  is equivalent to the canonical `ageRefer`, because `oldestYearBuilt` covers
  every building with a known year, whatever its TIV.
- `guidelines.ts` rows are verbatim. Its prose sections are verbatim, except
  that raw pdftotext drops a line-end hyphen that `-layout` shows exists. All
  15 `glossary.ts` definitions are verbatim, including the curly quotes.
- **Extensions never touch the score.** Evaluate filters `hit.extension` out
  of the factor hits, a fired extension rule gets `weight 0` and `points 0`,
  and the extension factors are not in `APPETITE_FACTORS`. On the real data,
  no extension rule moved a score. Extensions are labelled as ours: in the
  JSON `source`, in each citation ("Retrofit's own rule: …"), in the API
  rulebook label, and in the console rules page group and badge.
- `vectors/commercial.json` required (0–8), immovable (0,1,2,5,6,8,10) and
  factor mapping match V-6 and F-2.

## Findings

### R2-1 BLOCKER — Every real explanation says the Fire Resistive assumption was used, including accounts with no Fire Resistive buildings (I-3)

`evaluate.ts:460` attaches an interpretation whenever any fired rule touches a
path in its `affects` list. `I-3.affects = ["pctTivAcceptableConstruction"]`,
so I-3 is attached to **every** account whose construction is known.
INTERPRETATIONS I-3 says I-3 is attached, shown and named **only** when the
construction tier depends on those buildings, and "otherwise it is recorded
but not surfaced". `template.ts:331` trusts the engine ("named only when the
engine surfaced it") and adds "fire-resistive construction is treated as
acceptable, an assumption". `collectCitations` then adds the I-3 PRD quote.

Repro: run `realCases()` through `runEngine` + `explain`. **All 27** policies
carry `I-3` and the sentence. Only **6** actually depend on it (00054, 00070,
00074, 00083, 00092, 2026-00025). **8 have zero** FR/MFR TIV: 2024-00076,
2025-00004, 2025-00077, 2026-00007, 00031, 00038, 00081, 00098. Example,
SUB-2026-00081: "…In appetite on every factor; …; fire-resistive construction
is treated as acceptable, an assumption."

Fix: in evaluate, surface I-3 only when some `pctTivByConstruction[]` entry has
`assumedAcceptable` and removing those shares from the numerator changes the
3.5 outcome.

### R2-2 BLOCKER — A policy with `claims: []` gets its loss marked missing: loss scores 0 instead of 10 points and completeness drops to 88.9% (I-4)

`rollup.ts:365` treats claims as "never fetched" when `history` is empty
**and** `raw.records` has no `Claim` key. The deep pass nests claims inside
`Policy`, and neither `to-bundle.ts` (runtime) nor `fixtures/real.ts` ever
writes a `records.Claim` key. So a policy whose expanded `claims` came back
`[]` is treated as unfetched. INTERPRETATIONS I-4 says zero claims is a
**known 0** "provided the claims list itself was retrieved", and the deep query
did retrieve it. E17 flagged this ("Observed, not mine to fix") and nobody
fixed it.

Repro (4 real accounts, all `raw.records.Policy[0].data.claims = []`):

| Account | score now → correct | completeness | quality |
| --- | --- | --- | --- |
| SUB-2026-00007 | 45 → 55 | 88.9 → 100 | 47.7 → 61.2 |
| SUB-2026-00025 | 56 → 66 | 88.9 → 100 | 63.7 → 74.2 |
| SUB-2026-00028 | 61 → 71 | 88.9 → 100 | 59.6 → 71.1 |
| SUB-2026-00038 | 74 → 84 | 88.9 → 100 | 81.6 → 89.4 |

The explanation also says "missing loss history". Fix: `toBundles` should
emit `Claim: []` (or the flattened claims) when the hydrated policy carried a
`claims` array. Alternatively, rollup could read the nested array's presence.

### R2-3 MAJOR — Every decline explanation says all its knockout factors "cannot be changed", including premium and construction, which can

`template.ts:355` appends ", which the insured cannot change" to the list of
**every** out factor whenever `flip.blockedByImmovable` is non-empty. Premium
(component 4) and construction (component 7) are `immovable: false` (F-2).
Repro: 24 real explanations carry the phrase. At least 17 list premium or
construction, e.g. SUB-2024-00076: "knocked out on state and premium, which
the insured cannot change".

### R2-4 MINOR — A state value that is not a two-letter code becomes *missing* rather than out-of-list (G-7)

`rollup.ts:131` `normalizeState` returns `null` for anything that is not two
letters, so the building's state is dropped. G-7 says anything other than
absent or blank is out-of-list (tier 0). Repro: take SUB-2026-00081 and set
every `locations[].state` value to `"Texas"`. You get `primaryState null`,
state unknown, REFER, 88.9%. With `"TX"` you get tier 0, DOES_NOT_FIT. That
turns a knockout into a fixable-looking REFER. The real snapshot has only
codes, so the only way in is a broker reply or an answer. The differential
cannot catch it, because NaiveInput receives the code already made.

### R2-5 MINOR — The pre-1990 refer rule reports 6 points in `firedRules`

`evaluate.ts:404` computes `points = 100 × weight × TIER_VALUE.refer`, which
is 6 for `AG-AGE-REFER`, on top of the 6 from `AG-AGE-A`. G-10 says a refer
rule is a flag, not a score. On 6 real accounts (e.g. SUB-2025-00033),
`Σ firedRules.points` exceeds `appetiteScore` by 6. It is not rendered today,
but it sits in the stored result.

### R2-6 MINOR — The console fixture carries citation quotes that are not in the PDF

`apps/console/src/fixtures/dto.ts:51-55`: `'$50M - $100M'`, `'$75K - $100K'`
(spaced), `'JM, Masonry non-combustible, non-combustible/steel'` (reordered)
and `'< $100K'`. None of these appear in AG p2. Its header also claims "the
colocated test re-derives these numbers", but nothing imports the file. It is
dead code today, and it would put misquotes on screen if anyone wires it in.

## Not findings (checked, deliberate)

- The citation `section` for extension and tenant rules names Retrofit's own
  rulebook. That is correct labelling, not a missing PDF quote.
- Every real account carries an open HIGH contradiction on the received date.
  Real data causes it: `Submission.received_date` differs from
  `Policy.dates.submission_received`. It is not a rulebook defect.
