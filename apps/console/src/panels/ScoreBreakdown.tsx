import type { CSSProperties, ReactElement } from 'react';

import { formatPercent, formatScore, pluralize } from '@retrofit/contracts';
import { SPACE, TIER_LABELS, cssVar } from '@retrofit/design';

import { Badge } from '../components/atoms/Badge.js';
import { Card } from '../components/atoms/Card.js';
import { CitationQuote } from '../components/atoms/CitationQuote.js';
import { DataTable } from '../components/DataTable.js';
import type { DataTableColumn } from '../components/DataTable.js';
import type { FactorRowView } from './types.js';
import type { ScoreBreakdownPanelProps } from './types.js';

/* Private styles — base.css belongs to C02. */

const summaryStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: `${SPACE.sm}px ${SPACE.xl}px`,
  margin: `0 0 ${SPACE.md}px`,
  padding: 0,
};

const summaryItemStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: SPACE.xs };

const summaryLabelStyle: CSSProperties = {
  margin: 0,
  fontSize: cssVar('size-micro'),
  lineHeight: cssVar('leading-micro'),
  color: cssVar('muted-deep'),
};

const summaryValueStyle: CSSProperties = {
  margin: 0,
  fontSize: cssVar('size-body'),
  lineHeight: cssVar('leading-body'),
  color: cssVar('ink'),
  fontVariantNumeric: 'tabular-nums',
};

const numberStyle: CSSProperties = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };

const tierCellStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: SPACE.xs };

const mutedStyle: CSSProperties = { color: cssVar('muted-deep') };

const noteStyle: CSSProperties = {
  margin: `${SPACE.md}px 0 0`,
  fontSize: cssVar('size-micro'),
  lineHeight: cssVar('leading-micro'),
  color: cssVar('muted-deep'),
};

/** The printed tier word. A missing factor says so in words; colour never carries it alone. */
function tierText(row: FactorRowView): string {
  if (!row.known) return 'Missing';
  if (row.tier === null) return '—';
  return TIER_LABELS[row.tier];
}

/** `0.6` -> `0.6`, `1` -> `1.0`: the tier value next to its label. */
function tierValueText(row: FactorRowView): string | null {
  if (!row.known || row.tierValue === null) return null;
  return formatScore(row.tierValue, { decimals: 1 });
}

const COLUMNS: readonly DataTableColumn<FactorRowView>[] = [
  {
    key: 'factor',
    header: 'Factor',
    render: (row) => row.label,
    sortValue: (row) => row.label,
  },
  {
    key: 'tier',
    header: 'Tier',
    headerTitle: 'Target 1.0, Acceptable 0.6, Not acceptable 0 (a knockout)',
    render: (row) => {
      const value = tierValueText(row);
      return (
        <span style={tierCellStyle} data-testid={`tier-${row.factorId}`}>
          <span>
            {tierText(row)}
            {value !== null ? <span style={mutedStyle}>{` (${value})`}</span> : null}
          </span>
          {row.knockout ? (
            <Badge label="Knockout" tone="attention" title="A Not acceptable tier decides DOES NOT FIT" />
          ) : null}
        </span>
      );
    },
    sortValue: (row) => (row.known ? row.tierValue : null),
  },
  {
    key: 'weight',
    header: 'Weight',
    align: 'right',
    render: (row) => (
      <span style={numberStyle} data-testid={`weight-${row.factorId}`}>
        {formatScore(row.weight, { decimals: 2 })}
      </span>
    ),
    sortValue: (row) => row.weight,
  },
  {
    key: 'points',
    header: 'Points',
    align: 'right',
    headerTitle: '100 × weight × tier value; a missing factor scores 0',
    render: (row) => (
      <span style={numberStyle} data-testid={`points-${row.factorId}`}>
        {formatScore(row.points, { decimals: 1 })}
      </span>
    ),
    sortValue: (row) => row.points,
  },
  {
    key: 'citation',
    header: 'Rule, citation and quote',
    render: (row) => {
      if (row.citation === null) {
        return (
          <span style={mutedStyle}>
            {row.ruleId !== null ? <code>{row.ruleId}</code> : null}
            {row.ruleId !== null ? ' · ' : null}
            {row.known ? 'No citation recorded' : 'Not scored: the input is missing'}
          </span>
        );
      }
      return (
        <div>
          {row.ruleId !== null ? <code>{row.ruleId}</code> : null}
          <CitationQuote citation={row.citation} compact />
        </div>
      );
    },
  },
];

/**
 * PRD 10 (b) Eight factors with tier, weight, points, citation and quote.
 *
 * Renders the engine's factor rows verbatim. The total is the `appetiteScore`
 * prop, never a re-sum of the rows (PRD 10: no panel recomputes a score). A
 * missing factor shows 0 points and the word "Missing" (INTERPRETATIONS G-2).
 */
export function ScoreBreakdown(props: ScoreBreakdownPanelProps): ReactElement {
  const { factors, appetiteScore, completeness } = props;
  const knownCount = factors.filter((f) => f.known).length;
  const knockoutCount = factors.filter((f) => f.knockout).length;
  const missingCount = factors.length - knownCount;

  return (
    <Card
      title="Score breakdown"
      anchorId="b"
      aside={
        <Badge
          label={`${knownCount} of ${pluralize(factors.length, 'factor')} known`}
          tone={missingCount > 0 ? 'attention' : 'neutral'}
        />
      }
    >
      <dl style={summaryStyle}>
        <div style={summaryItemStyle}>
          <dt style={summaryLabelStyle}>Appetite score</dt>
          <dd style={summaryValueStyle} data-testid="breakdown-score">
            {formatScore(appetiteScore, { decimals: 1, outOf: true })}
          </dd>
        </div>
        <div style={summaryItemStyle}>
          <dt style={summaryLabelStyle}>Completeness</dt>
          <dd style={summaryValueStyle} data-testid="breakdown-completeness">
            {formatPercent(completeness, { from: 'percent', decimals: 1 })}
          </dd>
        </div>
        <div style={summaryItemStyle}>
          <dt style={summaryLabelStyle}>Knockouts</dt>
          <dd style={summaryValueStyle} data-testid="breakdown-knockouts">
            {knockoutCount === 0 ? 'None' : pluralize(knockoutCount, 'knockout')}
          </dd>
        </div>
      </dl>

      <DataTable
        caption="Appetite factors"
        columns={COLUMNS}
        rows={factors}
        rowKey={(row) => row.factorId}
        emptyLabel="No appetite factors were evaluated."
      />

      <p style={noteStyle}>
        Points are 100 × weight × tier value. Missing factors score 0 and the other weights are not
        rescaled. A knockout decides the verdict but does not zero the score.
      </p>
    </Card>
  );
}
