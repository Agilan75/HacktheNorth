import type { CSSProperties, ReactElement } from 'react';

import { formatPercent, formatScore, titleCase } from '@retrofit/contracts';
import { SPACE, cssVar } from '@retrofit/design';

import { Card } from '../components/atoms/Card.js';
import { VerdictPill } from '../components/atoms/VerdictPill.js';
import type { ExplanationPanelProps } from './types.js';

/* Private layout styles — base.css belongs to C02, so this panel styles inline from tokens. */

const headlineStyle: CSSProperties = {
  margin: 0,
  fontFamily: cssVar('font-display'),
  fontSize: cssVar('size-heading'),
  lineHeight: cssVar('leading-heading'),
  color: cssVar('ink'),
};

const statsStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: `${SPACE.sm}px ${SPACE.xl}px`,
  margin: `${SPACE.md}px 0 0`,
  padding: 0,
};

const statStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: SPACE.xs };

const statLabelStyle: CSSProperties = {
  margin: 0,
  fontSize: cssVar('size-micro'),
  lineHeight: cssVar('leading-micro'),
  color: cssVar('muted-deep'),
};

const statValueStyle: CSSProperties = {
  margin: 0,
  fontSize: cssVar('size-body'),
  lineHeight: cssVar('leading-body'),
  color: cssVar('ink'),
  fontVariantNumeric: 'tabular-nums',
};

const paragraphStyle: CSSProperties = {
  margin: `${SPACE.md}px 0 0`,
  fontSize: cssVar('size-body'),
  lineHeight: cssVar('leading-body'),
  color: cssVar('ink'),
};

const recommendationStyle: CSSProperties = {
  margin: `${SPACE.lg}px 0 0`,
  padding: `${SPACE.md}px ${SPACE.lg}px`,
  border: `1px solid ${cssVar('muted-tint')}`,
  borderRadius: cssVar('radius-card'),
};

const recommendationLabelStyle: CSSProperties = {
  margin: 0,
  fontSize: cssVar('size-micro'),
  lineHeight: cssVar('leading-micro'),
  fontWeight: 600,
  color: cssVar('muted-deep'),
};

const recommendationTextStyle: CSSProperties = {
  margin: `${SPACE.xs}px 0 0`,
  fontSize: cssVar('size-body'),
  lineHeight: cssVar('leading-body'),
  color: cssVar('ink'),
};

/** `building_age` -> `Building age`: sentence case for an in-line label. */
function factorLabel(factorId: string): string {
  const title = titleCase(factorId);
  return title.length === 0 ? factorId : `${title.charAt(0)}${title.slice(1).toLowerCase()}`;
}

/**
 * PRD 10 (a) Explanation and recommendation.
 *
 * Every number here is read straight off the props (PRD 10 house rule): the
 * appetite score, the confidence and the deciding rule are rendered, never
 * recomputed. The verdict pill always carries its word (PRD 13).
 */
export function Explanation(props: ExplanationPanelProps): ReactElement {
  const { explanation, verdict, appetiteScore } = props;
  const deciding =
    explanation.decidingFactorId !== null ? factorLabel(explanation.decidingFactorId) : null;
  const paragraphs = explanation.paragraphs.filter((p) => p.trim().length > 0);
  const recommendation = explanation.recommendation.trim();

  return (
    <Card
      title="Explanation and recommendation"
      anchorId="a"
      aside={<VerdictPill verdict={verdict} detail={deciding ?? undefined} />}
    >
      <p style={headlineStyle} data-testid="explanation-headline">
        {explanation.headline}
      </p>

      <dl style={statsStyle}>
        <div style={statStyle}>
          <dt style={statLabelStyle}>Appetite score</dt>
          <dd style={statValueStyle} data-testid="explanation-score">
            {formatScore(appetiteScore, { decimals: 1, outOf: true })}
          </dd>
        </div>
        <div style={statStyle}>
          <dt style={statLabelStyle}>Confidence</dt>
          <dd style={statValueStyle} data-testid="explanation-confidence">
            {formatPercent(explanation.confidence, { from: 'ratio' })}
          </dd>
        </div>
        <div style={statStyle}>
          <dt style={statLabelStyle}>Deciding factor</dt>
          <dd style={statValueStyle} data-testid="explanation-deciding-factor">
            {deciding ?? 'None: every appetite factor is missing'}
          </dd>
        </div>
        {explanation.decidingRuleId !== null ? (
          <div style={statStyle}>
            <dt style={statLabelStyle}>Deciding rule</dt>
            <dd style={statValueStyle} data-testid="explanation-deciding-rule">
              <code>{explanation.decidingRuleId}</code>
            </dd>
          </div>
        ) : null}
      </dl>

      {paragraphs.map((text, index) => (
        <p key={index} style={paragraphStyle} className="rf-explanation__paragraph">
          {text}
        </p>
      ))}

      <section style={recommendationStyle} aria-label="Recommendation">
        <p style={recommendationLabelStyle}>Recommendation</p>
        <p style={recommendationTextStyle} data-testid="explanation-recommendation">
          {recommendation.length > 0 ? recommendation : 'No recommendation recorded.'}
        </p>
      </section>
    </Card>
  );
}
