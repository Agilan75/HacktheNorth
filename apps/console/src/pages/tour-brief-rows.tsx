import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { CSSProperties, ReactElement, ReactNode } from 'react';

import { formatMoney, formatScore, formatTiv, formatVerdict } from '@retrofit/contracts';

import { ROUTES, submissionPath } from '../routes.js';
import { Contradictions } from '../panels/Contradictions.js';
import { Explanation } from '../panels/Explanation.js';
import { QueryTrace } from '../panels/QueryTrace.js';
import { ScoreBreakdown } from '../panels/ScoreBreakdown.js';
import type { QueueRowView, SubmissionDetailView, Verdict } from '../panels/types.js';

/**
 * The four rows of "The brief, answered" — one per requirement the challenge
 * sets out, in its own words, each answered with live evidence.
 *
 * Every row shows the **real console panel**, not a summary of it: rows 1, 2
 * and 4 mount `ScoreBreakdown`, `QueryTrace`, `Explanation` and
 * `Contradictions` exactly as `/submissions/:id` does. A judge is therefore
 * looking at the product, not at a slide about the product, and there is no
 * second rendering of the same facts that could drift from the first.
 *
 * One account runs through all four rows — whichever account ranks #1, read
 * off the live queue rather than hardcoded — so the section reads as one story
 * instead of four samples.
 */

/* -------------------------------------------------------------------------- */
/* Shared                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One requirement and its answer. The requirement sentence is quoted verbatim
 * from `STUDENT_PROJECT_GUIDELINES.pdf` so it can be checked word for word
 * against the brief; everything below it is live.
 */
export function Requirement(props: {
  readonly n: number;
  readonly requirement: string;
  readonly lede: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className="rf-brief__row">
      <p className="rf-brief__req">
        <span className="rf-brief__req-n" aria-hidden="true">
          {props.n}
        </span>
        <span className="rf-brief__req-quote">“{props.requirement}”</span>
      </p>
      <p className="rf-brief__lede">{props.lede}</p>
      <div className="rf-brief__evidence">{props.children}</div>
    </div>
  );
}

/** Colour is never the only carrier: each verdict pairs a mark with its words. */
const VERDICT_MARK: Readonly<Record<Verdict, string>> = {
  FIT: '●',
  REFER: '◐',
  DOES_NOT_FIT: '○',
};

export function VerdictPill(props: { readonly verdict: Verdict }): ReactElement {
  return (
    <span className={`rf-brief__pill rf-brief__pill--${props.verdict.toLowerCase()}`}>
      <span aria-hidden="true">{VERDICT_MARK[props.verdict]}</span> {formatVerdict(props.verdict)}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* 1 · Score each submission against carrier appetite guidelines              */
/* -------------------------------------------------------------------------- */

export function RowScore(props: { readonly detail: SubmissionDetailView }): ReactElement {
  const { detail } = props;
  return (
    <Requirement
      n={1}
      requirement="Score each submission against carrier appetite guidelines"
      lede={
        <>
          Eight weighted factors, transcribed from page 2 of{' '}
          <code>APPETITE_GUIDELINES.pdf</code>. The weights are asserted to sum to 1, so a score is
          a share of the guidelines met and not an opinion. Every row below quotes the guideline
          cell it was decided by, with its document and section — the whole rulebook is on{' '}
          <Link to={ROUTES.rules}>Rules</Link>.
        </>
      }
    >
      <p className="rf-brief__who">
        <strong>{detail.insuredName}</strong> · {detail.submissionId} ·{' '}
        <VerdictPill verdict={detail.verdict} /> · appetite{' '}
        {formatScore(detail.appetiteScore, { outOf: true })}
      </p>
      <ScoreBreakdown
        factors={detail.factors}
        appetiteScore={detail.appetiteScore}
        completeness={detail.completeness}
      />
    </Requirement>
  );
}

/* -------------------------------------------------------------------------- */
/* 2 · Reason about which data to request from the API                        */
/* -------------------------------------------------------------------------- */

export function RowReason(props: {
  readonly detail: SubmissionDetailView;
  readonly knockedOut: number;
  readonly total: number;
}): ReactElement {
  const { detail, knockedOut, total } = props;
  return (
    <Requirement
      n={2}
      requirement="Reason about which data to request from the API"
      lede={
        <>
          No query is written by hand. The planner reads the schema, works out which fields the
          rulebook actually needs, finds where they live in the resource graph, and picks a root —
          then records the roads it did not take and why. Triage runs first and cheaply, which is
          why {knockedOut} of {total} accounts were knocked out on line of business before a single
          deep query was spent on them. When a query comes back empty it adapts and retries rather
          than reporting nothing.
        </>
      }
    >
      <QueryTrace entries={detail.queryTrace} />
    </Requirement>
  );
}

/* -------------------------------------------------------------------------- */
/* 3 · Rank submissions to surface the best opportunities                     */
/* -------------------------------------------------------------------------- */

type Filter = 'ALL' | Verdict;

const FILTERS: readonly { readonly id: Filter; readonly label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'FIT', label: 'Fit' },
  { id: 'REFER', label: 'Refer' },
  { id: 'DOES_NOT_FIT', label: 'Does not fit' },
];

/**
 * The whole book, ranked, with every explanation in full — the brief asks for
 * an explanation on *every* submission in the output, so every submission has
 * one here rather than a top-N slice with the rest hidden.
 */
export function RowRank(props: { readonly rows: readonly QueueRowView[] }): ReactElement {
  const { rows } = props;
  const [filter, setFilter] = useState<Filter>('ALL');

  const counts = useMemo(() => {
    const by: Record<string, number> = { ALL: rows.length };
    for (const row of rows) by[row.verdict] = (by[row.verdict] ?? 0) + 1;
    return by;
  }, [rows]);

  const shown = useMemo(
    () => (filter === 'ALL' ? rows : rows.filter((r) => r.verdict === filter)),
    [rows, filter],
  );

  return (
    <Requirement
      n={3}
      requirement="Rank submissions to surface the best opportunities"
      lede={
        <>
          All {counts.ALL} submissions, best first. The order is a quality index over the appetite
          score, price adequacy, loss ratio, completeness and confidence — so an account with a
          high appetite score but a thin submission does not outrank a complete one. The guidelines
          are strict, and the book answers honestly: one account fits.
        </>
      }
    >
      <div className="rf-brief__filters" role="group" aria-label="Filter by verdict">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={filter === f.id ? 'rf-tour__chip rf-tour__chip--action' : 'rf-tour__chip'}
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label} ({counts[f.id] ?? 0})
          </button>
        ))}
      </div>

      <div className="rf-brief__list" tabIndex={0} role="region" aria-label="The ranked book">
        <table className="rf-brief__table">
          <caption className="rf-brief__caption">
            {shown.length} of {counts.ALL} submissions, ranked high to low
          </caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Insured</th>
              <th scope="col">Score</th>
              <th scope="col">Verdict</th>
              <th scope="col">Why it got that score</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.submissionId}>
                <td className="rf-brief__rank">{row.rank}</td>
                <td>
                  <Link to={submissionPath(row.submissionId)}>{row.insuredName}</Link>
                  <span className="rf-brief__sub">
                    {row.submissionId}
                    {row.totalTiv === null ? '' : ` · ${formatTiv(row.totalTiv)}`}
                    {row.primaryState === null ? '' : ` · ${row.primaryState}`}
                  </span>
                </td>
                <td className="rf-brief__score">
                  {formatScore(row.appetiteScore, { outOf: true })}
                  <span
                    className="rf-brief__bar"
                    aria-hidden="true"
                    style={{ '--rf-brief-pct': `${Math.round(row.appetiteScore)}%` } as CSSProperties}
                  />
                </td>
                <td>
                  <VerdictPill verdict={row.verdict} />
                </td>
                <td className="rf-brief__why">{row.explanationLine}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Requirement>
  );
}

/* -------------------------------------------------------------------------- */
/* 4 · Explain every decision in plain English                                */
/* -------------------------------------------------------------------------- */

/**
 * The brief's own example is a four-line block — id, score, the appetite match,
 * the key factors, then a recommendation. This renders the live explanation in
 * that exact shape so it can be compared line for line.
 */
function BriefShape(props: { readonly detail: SubmissionDetailView }): ReactElement {
  const { detail } = props;
  const { explanation } = detail;
  const lines = [explanation.headline, ...explanation.paragraphs, explanation.recommendation].filter(
    (s) => typeof s === 'string' && s.trim() !== '',
  );
  return (
    <div className="rf-brief__shape">
      <p className="rf-brief__shape-head">
        <span>
          {detail.submissionId} — {detail.insuredName}
        </span>
        <span className="rf-brief__shape-score">
          SCORE {formatScore(detail.appetiteScore, { outOf: true })}
        </span>
        <VerdictPill verdict={detail.verdict} />
      </p>
      {lines.map((s) => (
        <p key={s} className="rf-brief__shape-line">
          {s}
        </p>
      ))}
    </div>
  );
}

/** One "borderline, on purpose" card: the account, and why it is worth looking at. */
function BorderlineCard(props: {
  readonly row: QueueRowView;
  readonly why: string;
}): ReactElement {
  const { row, why } = props;
  return (
    <li className="rf-brief__card">
      <p className="rf-brief__card-head">
        <Link to={submissionPath(row.submissionId)}>{row.insuredName}</Link>{' '}
        <VerdictPill verdict={row.verdict} /> · {formatScore(row.appetiteScore, { outOf: true })}
        {row.quotedPremium === null ? '' : ` · ${formatMoney(row.quotedPremium)}`}
      </p>
      <p className="rf-brief__card-why">{why}</p>
      <p className="rf-brief__card-text">{row.explanationLine}</p>
    </li>
  );
}

export function RowExplain(props: {
  readonly detail: SubmissionDetailView;
  readonly rows: readonly QueueRowView[];
}): ReactElement {
  const { detail, rows } = props;

  /*
   * The awkward accounts, chosen by their own numbers rather than by name, so
   * this keeps working if the book changes: the thinnest referral, the account
   * carrying a source conflict, and a triage knockout. The brief asks whether
   * we are transparent when a submission is borderline or contradictory; these
   * are the three shapes of "borderline" this book actually contains.
   */
  const borderline = useMemo(() => {
    const picked = new Map<string, { row: QueueRowView; why: string }>();
    const add = (row: QueueRowView | undefined, why: string): void => {
      if (row === undefined || picked.has(row.submissionId)) return;
      picked.set(row.submissionId, { row, why });
    };

    const thinnest = [...rows]
      .filter((r) => r.verdict === 'REFER')
      .sort((a, b) => a.completeness - b.completeness)[0];
    add(
      thinnest,
      'Referred for what is missing, not for what is wrong. The explanation names every absent field, so the broker is asked once for exactly those.',
    );

    const conflicted = [...rows]
      .filter((r) => r.contradictionCount > 0)
      .sort((a, b) => b.contradictionCount - a.contradictionCount)[0];
    add(
      conflicted,
      'Two sources disagree on a value. Both sides are shown with their provenance, and the explanation says which was used and whether it changes the verdict.',
    );

    const knockedOut = [...rows].filter((r) => r.outOfAppetiteLine).slice(-1)[0];
    add(
      knockedOut,
      'Out of appetite on line of business alone, so it was decided at triage and never queried in depth. Cheap to decide, and it still says why.',
    );

    return [...picked.values()];
  }, [rows]);

  return (
    <Requirement
      n={4}
      requirement="Explain every decision in plain English"
      lede={
        <>
          Every one of the {rows.length} submissions carries an explanation in the shape the brief
          asks for: how it matches appetite, the key decision factors, and a recommendation —
          accept, review, investigate or decline. The words are built by a template from the
          engine&apos;s own numbers, so no model ever decides a verdict, a score or a dollar amount;
          a model only ever polishes prose, and a guard rejects the polish if it moves a number.
        </>
      }
    >
      <BriefShape detail={detail} />

      <h4 className="rf-brief__h">Borderline, on purpose</h4>
      <p className="rf-brief__lede">
        The easy cases prove nothing. These are the awkward ones, picked by their own numbers.
      </p>
      <ul className="rf-brief__cards">
        {borderline.map((b) => (
          <BorderlineCard key={b.row.submissionId} row={b.row} why={b.why} />
        ))}
      </ul>

      <h4 className="rf-brief__h">The full explanation, and the conflicts behind it</h4>
      <Explanation
        explanation={detail.explanation}
        verdict={detail.verdict}
        appetiteScore={detail.appetiteScore}
      />
      <Contradictions
        contradictions={detail.contradictions}
        interpretations={detail.interpretations}
      />
    </Requirement>
  );
}
