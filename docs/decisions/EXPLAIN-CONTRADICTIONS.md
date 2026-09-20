# EXPLAIN-CONTRADICTIONS — contradictions in the explanation prose, at every severity

## Decision

The deterministic explanation template surfaces **every open contradiction**, not
only the HIGH ones. When a submission has an open contradiction, the prose names
the field, both competing values, where each one came from, and whether the
verdict holds under either.

Two things stay where they are. The engine still decides materiality —
`contradict.ts` writes the note (*"immaterial: the five-year loss is $0 / $0
under the competing dates, the same loss-value tier either way"*) and the
template quotes that note rather than recomputing it. And severity still drives
routing: only an open **HIGH** contradiction forces REFER and the `investigate`
recommendation. A LOW contradiction is now *said*, not *acted on*.

Files: `packages/federato/src/explain/template.ts` (the sentence), plus an
offline re-derivation of the 158 stored explanations. Neither is owned by this
record; this is the reasoning, not the patch.

## Why

The claim in README's requirements audit was *"Contradictions addressed
transparently — both sides shown with source and confidence"*. Half of that was
true. The `/submissions/:id` contradictions panel did show both sides with
source and confidence. The explanation prose never mentioned a contradiction at
all, in any of the 158 accounts.

The cause is a filter. `openHighContradictionPaths()` in `template.ts` narrows
to `status === 'open' && severity === 'HIGH'`, and every one of the three places
the template can mention a conflict — the out-of-appetite clause, the
`needs` list, the recommendation reason — reads from that one helper. So the
template could only ever talk about a HIGH contradiction.

Found by reading the stored results rather than the code. The book has exactly
one contradiction class:

    sqlite3 -readonly apps/api/data/retrofit.db \
      "select json_extract(c.value,'$.severity'), json_extract(c.value,'$.canonicalPath'), count(*)
       from submissions s, json_each(json_extract(s.result,'$.contradictions')) c group by 1,2;"
    LOW|receivedDate|27

27 of 158 accounts, all LOW, all on `receivedDate` — two competing submission
dates read from two places in the same Federato `Policy` record
(`Policy.submission.received_date` against `Policy.dates.submission_received`).
Severity is LOW because severity is earned: the paths feed `AG-LOSS-A` /
`AG-LOSS-NA`, and under both dates the five-year loss is $0, the same tier. So
zero of 158 explanations contained the word *contradiction* or *conflict*, while
27 accounts had a real one sitting in the panel beside the prose.

A reader who only reads the explanation — which is the whole point of the
explanation — was not told. That is the gap the rubric's "transparently" is
asking about, and an immaterial conflict is still a conflict worth one sentence.

## Why the engine's note, not a fresh computation

The template could work out for itself whether the verdict survives: re-run the
factor under each competing value and compare tiers. It does not, because that
is arithmetic, and arithmetic belongs to the engine (AGENTS house style: the
engine decides, prose reports). `contradict.ts` already does exactly this work
to assign severity, and it already writes the conclusion into `note`. Having the
template recompute it would be a second implementation of the same rule that can
drift from the first, and the drift would show up as an explanation contradicting
its own panel — the precise failure this change exists to fix.

## Alternatives rejected

- **Raise `receivedDate` to HIGH severity** so the existing code path picks it
  up. This is the one-line version and it is wrong twice. HIGH is not a label,
  it is a routing decision: an open HIGH contradiction forces REFER and sets the
  recommendation to `investigate` (`template.ts`, "REFER for missing data or an
  open HIGH contradiction"). It would push 27 clean accounts into an investigate
  queue over a date mismatch that changes nothing, and it would tell an
  underwriter that 27 immaterial date disagreements are blocking conflicts. It
  also destroys the property that makes severity worth having — that it is
  earned from whether a rule actually reads the path.
- **A second helper, `openContradictionPaths()`, used everywhere the HIGH one
  is.** Rejected for the same reason: the out-of-appetite clause and the
  recommendation reason are verdict-bearing text. A LOW contradiction should not
  appear in the reason a submission was referred. The mention needs its own
  sentence, separate from the clauses that explain the verdict.
- **Leave the code and soften the README row.** Cheaper and honest, but the
  rubric criterion is about the explanation, and the panel already holds
  everything the sentence needs. The data was there; only the prose was missing.

## Notes

- **The feature is exercised on exactly one real shape.** Every contradiction in
  the current book is the same two-received-dates mismatch, self-reported against
  self-reported, LOW, immaterial. Multi-value conflicts, conflicts between
  different provenance sources, and HIGH conflicts that do move a verdict all
  exist in the type and in the unit fixtures, and none of them occurs in the 158
  live accounts. The README row says so rather than claiming the general case.
- The 158 stored explanations were written at ingest, so the fix does not reach
  them by itself; they are re-derived offline against the same engine results.
  No re-score, no LLM call, no new Gemini spend — and the positional guard that
  rejects any polish changing a number or the recommendation is unaffected,
  since the new sentence carries values, not verdicts.
- The `close` path is untouched. A broker answer still closes a contradiction
  only by confirming the value that was scored on, and a closed contradiction is
  not mentioned.
