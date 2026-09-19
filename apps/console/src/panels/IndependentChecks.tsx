import type { CSSProperties, ReactElement } from 'react';
import { Link } from 'react-router';

import { formatDate, formatScore, formatVerdict } from '@retrofit/contracts';
import { SPACE, cssVar } from '@retrofit/design';

import { VerdictPill } from '../components/atoms/VerdictPill.js';
import type { AccountVerificationView } from './types.js';

type Outcome = AccountVerificationView['engine'];

/** `primary_risk_state` -> `Primary risk state`. */
function factorLabel(id: string | null): string {
  if (id === null || id.trim().length === 0) return 'None';
  const text = id.replace(/[_-]+/g, ' ').trim().replace(/\btiv\b/gi, 'TIV');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function knockoutText(ids: readonly string[]): string {
  return ids.length === 0 ? 'None' : ids.map(factorLabel).join(', ');
}

/* -------------------------------------------------------------------------- */
/* Styles                                                                      */
/* -------------------------------------------------------------------------- */

const summaryStyle: CSSProperties = {
  margin: 0,
  fontFamily: cssVar('font-display'),
  fontSize: cssVar('size-heading'),
  lineHeight: cssVar('leading-heading'),
};

const sectionHeadStyle: CSSProperties = {
  margin: `${SPACE.xl}px 0 ${SPACE.sm}px`,
  fontSize: cssVar('size-body'),
  lineHeight: cssVar('leading-body'),
};

const mutedStyle: CSSProperties = {
  margin: `${SPACE.xs}px 0 0`,
  fontSize: cssVar('size-small'),
  lineHeight: cssVar('leading-small'),
  color: cssVar('muted-deep'),
};

const warnStyle: CSSProperties = {
  margin: `${SPACE.md}px 0 0`,
  padding: `${SPACE.md}px ${SPACE.lg}px`,
  border: `1px solid ${cssVar('ink')}`,
  borderRadius: cssVar('radius-card'),
};

const reasoningStyle: CSSProperties = {
  margin: `${SPACE.sm}px 0 0`,
  padding: `${SPACE.sm}px 0 ${SPACE.sm}px ${SPACE.lg}px`,
  borderLeft: `3px solid ${cssVar('muted-tint')}`,
  whiteSpace: 'pre-wrap',
};

const markStyle: CSSProperties = { fontWeight: 600, whiteSpace: 'nowrap' };

/* -------------------------------------------------------------------------- */
/* Pieces                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Agree / disagree as a symbol AND a word (PRD 13: colour never carries
 * meaning alone; here there is no colour at all).
 */
export function AgreeMark(props: { readonly agrees: boolean }): ReactElement {
  const word = props.agrees ? 'Agrees' : 'Disagrees';
  return (
    <span style={markStyle} data-agrees={String(props.agrees)}>
      <span aria-hidden="true">{props.agrees ? '✓ ' : '✗ '}</span>
      {word}
    </span>
  );
}

function scoreText(o: Outcome): string {
  return formatScore(o.appetiteScore, { outOf: true });
}

interface CompareRow {
  readonly key: string;
  readonly label: string;
  readonly engine: ReactElement | string;
  readonly naive: ReactElement | string;
  readonly agrees: boolean;
}

function naiveRows(v: AccountVerificationView): readonly CompareRow[] {
  const { engine, naive } = v;
  return [
    { key: 'verdict', label: 'Verdict', engine: <VerdictPill verdict={engine.verdict} />, naive: <VerdictPill verdict={naive.verdict} />, agrees: naive.agrees.verdict },
    { key: 'appetiteScore', label: 'Appetite score', engine: scoreText(engine), naive: scoreText(naive), agrees: naive.agrees.appetiteScore },
    { key: 'knockouts', label: 'Knockout factors', engine: knockoutText(engine.knockoutFactorIds), naive: knockoutText(naive.knockoutFactorIds), agrees: naive.agrees.knockouts },
    { key: 'decidingFactor', label: 'Deciding factor', engine: factorLabel(engine.decidingFactorId), naive: factorLabel(naive.decidingFactorId), agrees: naive.agrees.decidingFactor },
  ];
}

function summaryText(v: AccountVerificationView): string {
  const naiveOk = v.naive.agrees.all;
  const second = v.secondOpinion;
  if (second === null) {
    return naiveOk
      ? 'The independent implementation reached the same result as the engine. The second-opinion model never answered.'
      : 'The independent implementation disagrees with the engine. The second-opinion model never answered.';
  }
  if (naiveOk && second.agreed) return 'Both independent checks reached the same verdict as the engine.';
  if (naiveOk) return 'The independent implementation agrees with the engine; the second-opinion model reached a different verdict.';
  if (second.agreed) return 'The second-opinion model agrees with the engine; the independent implementation does not.';
  return 'Neither independent check agrees with the engine.';
}

export interface IndependentChecksProps {
  readonly verification: AccountVerificationView;
  /** Path of the Verification page (App's route table). */
  readonly verificationPath: string;
}

/**
 * The two independent checks run on this real property account (PRD 12):
 * layer B's naive second implementation, written from the guideline table
 * with no shared code, and layer C's second-opinion model, given only the
 * guideline text and the facts. Every value is the DTO's.
 */
export function IndependentChecks(props: IndependentChecksProps): ReactElement {
  const v = props.verification;
  const second = v.secondOpinion;
  return (
    <div data-testid="independent-checks">
      <p style={summaryStyle} data-testid="checks-summary">
        {summaryText(v)}
      </p>
      <p style={mutedStyle}>
        {`Checked ${formatDate(v.generatedAt, { fallback: v.generatedAt })} against the engine’s result on this account: `}
        {`${formatVerdict(v.engine.verdict)}, ${scoreText(v.engine)}.`}
      </p>

      {!v.matchesCurrentResult ? (
        <p role="note" style={warnStyle} data-testid="checks-stale">
          This account has been re-scored since these checks ran (for example by a broker reply), so the
          result on this page is not the one they checked.
        </p>
      ) : null}

      <h3 style={sectionHeadStyle}>Independent implementation</h3>
      <p style={mutedStyle}>
        A second, deliberately naive implementation written straight from the guideline table,
        sharing no code with the engine, given the same facts.
      </p>
      <div className="rf-scroll-x">
      <table aria-label="Engine compared with the independent implementation" style={{ marginTop: SPACE.sm }}>
        <thead>
          <tr>
            <th scope="col">Outcome</th>
            <th scope="col">Engine</th>
            <th scope="col">Independent implementation</th>
            <th scope="col">Result</th>
          </tr>
        </thead>
        <tbody>
          {naiveRows(v).map((r) => (
            <tr key={r.key} data-testid={`naive-${r.key}`}>
              <th scope="row">{r.label}</th>
              <td>{r.engine}</td>
              <td>{r.naive}</td>
              <td>
                <AgreeMark agrees={r.agrees} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      <h3 style={sectionHeadStyle}>Second-opinion model</h3>
      <p style={mutedStyle}>
        A language model given only the guideline text and this account’s facts. It never saw the
        engine’s answer.
      </p>
      {second === null ? (
        <p data-testid="second-opinion-missing" style={{ margin: `${SPACE.sm}px 0 0` }}>
          The second-opinion model never answered for this account, so there is no second opinion to show.
        </p>
      ) : (
        <div data-testid="second-opinion">
          <dl style={{ display: 'flex', flexWrap: 'wrap', gap: `${SPACE.sm}px ${SPACE.xl}px`, margin: `${SPACE.sm}px 0 0` }}>
            <div>
              <dt style={mutedStyle}>Its verdict</dt>
              <dd style={{ margin: 0 }}>
                <VerdictPill verdict={second.verdict} /> <AgreeMark agrees={second.agreed} />
              </dd>
            </div>
            <div>
              <dt style={mutedStyle}>Its deciding factor</dt>
              <dd style={{ margin: 0 }}>
                {factorLabel(second.decidingFactor)}{' '}
                <AgreeMark agrees={second.decidingFactorAgreed} />
              </dd>
            </div>
          </dl>
          <p style={{ ...mutedStyle, marginTop: SPACE.md }}>Its written reasoning</p>
          <blockquote style={reasoningStyle} data-testid="second-opinion-reasoning">
            {second.reasoning}
          </blockquote>
        </div>
      )}

      <p style={{ margin: `${SPACE.lg}px 0 0` }}>
        <Link to={props.verificationPath}>How the testing works, and every result across the book</Link>
      </p>
    </div>
  );
}
