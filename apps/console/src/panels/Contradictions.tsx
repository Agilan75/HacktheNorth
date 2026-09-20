import type { CSSProperties, ReactElement } from 'react';

import { formatPercent, pluralize } from '@retrofit/contracts';
import { cssVar, SPACE } from '@retrofit/design';

import { Badge } from '../components/atoms/Badge.js';
import { Card } from '../components/atoms/Card.js';
import { CitationQuote } from '../components/atoms/CitationQuote.js';
import type {
  ContradictionView,
  ContradictionsPanelProps,
  InterpretationView,
  Severity,
  SourceKind,
} from './types.js';

/** Display order only: HIGH first. The severity itself comes from the engine. */
const SEVERITY_ORDER: Readonly<Record<Severity, number>> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

const SOURCE_LABELS: Readonly<Record<SourceKind, string>> = {
  self_reported: 'Self-reported',
  enrichment: 'Enrichment',
  sweep: 'Sweep',
  answer: 'Broker answer',
};

const listStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'grid',
  gap: SPACE.lg,
};

const itemStyle: CSSProperties = {
  borderTop: `1px solid ${cssVar('muted-tint')}`,
  paddingTop: SPACE.md,
};

const subheadingStyle: CSSProperties = {
  fontFamily: cssVar('font-display'),
  fontSize: cssVar('size-body'),
  margin: `${SPACE.lg}px 0 ${SPACE.sm}px`,
};

const mutedStyle: CSSProperties = { color: cssVar('muted-deep'), fontSize: cssVar('size-small') };

const cellStyle: CSSProperties = {
  padding: `${SPACE.xs}px ${SPACE.sm}px`,
  borderBottom: `1px solid ${cssVar('muted-tint')}`,
  textAlign: 'left',
};

function isOpen(c: ContradictionView): boolean {
  return c.status.toLowerCase() === 'open';
}

function sortContradictions(list: readonly ContradictionView[]): readonly ContradictionView[] {
  return list
    .map((c, index) => ({ c, index }))
    .sort((a, b) => {
      const byOpen = Number(!isOpen(a.c)) - Number(!isOpen(b.c));
      if (byOpen !== 0) return byOpen;
      const bySeverity = (SEVERITY_ORDER[a.c.severity] ?? 3) - (SEVERITY_ORDER[b.c.severity] ?? 3);
      return bySeverity !== 0 ? bySeverity : a.index - b.index;
    })
    .map((entry) => entry.c);
}

function ContradictionItem({ contradiction }: { readonly contradiction: ContradictionView }): ReactElement {
  const open = isOpen(contradiction);
  const highOpen = open && contradiction.severity === 'HIGH';
  return (
    <li style={itemStyle} data-testid="contradiction" data-severity={contradiction.severity}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: SPACE.sm }}>
        <code>{contradiction.field}</code>
        <Badge
          label={`${contradiction.severity} severity`}
          tone={contradiction.severity === 'LOW' ? 'quiet' : highOpen ? 'attention' : 'neutral'}
        />
        <Badge label={open ? 'Open' : 'Resolved'} tone={open ? 'neutral' : 'quiet'} title={`Status: ${contradiction.status}`} />
      </div>
      <p style={{ margin: `${SPACE.sm}px 0` }}>{contradiction.summary}</p>
      {highOpen ? (
        <p style={{ ...mutedStyle, margin: `0 0 ${SPACE.sm}px` }}>
          Open HIGH contradiction: the verdict is REFER unless a knockout already makes it DOES NOT FIT (INTERPRETATIONS V-3).
        </p>
      ) : null}
      {contradiction.sides.length > 0 ? (
        <table style={{ borderCollapse: 'collapse', fontSize: cssVar('size-small') }}>
          <caption className="rf-sr-only">{`Conflicting values for ${contradiction.field}`}</caption>
          <thead>
            <tr>
              <th scope="col" style={cellStyle}>Value</th>
              <th scope="col" style={cellStyle}>Source</th>
              <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>Confidence</th>
            </tr>
          </thead>
          <tbody>
            {contradiction.sides.map((side, i) => (
              <tr key={`${side.source}-${i}`}>
                <td style={cellStyle}>{side.value}</td>
                <td style={cellStyle}>{SOURCE_LABELS[side.source] ?? side.source}</td>
                <td style={{ ...cellStyle, textAlign: 'right' }}>{formatPercent(side.confidence)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </li>
  );
}

function InterpretationItem({ interpretation }: { readonly interpretation: InterpretationView }): ReactElement {
  return (
    <li style={itemStyle} data-testid="interpretation">
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: SPACE.sm }}>
        <strong>{interpretation.title}</strong>
        <Badge label={interpretation.id} tone="quiet" />
      </div>
      <p style={{ margin: `${SPACE.sm}px 0` }}>{interpretation.text}</p>
      {interpretation.citation ? <CitationQuote citation={interpretation.citation} compact /> : null}
    </li>
  );
}

/**
 * PRD 10 (f) Contradictions and interpretations applied.
 *
 * Stub frozen by W0-4. Unit C09 replaces this body only — never the signature,
 * never the import list's shape, never this file's path.
 */
export function Contradictions(props: ContradictionsPanelProps): ReactElement {
  const { contradictions, interpretations } = props;
  const sorted = sortContradictions(contradictions);
  const openCount = contradictions.filter(isOpen).length;
  const openHigh = contradictions.filter((c) => isOpen(c) && c.severity === 'HIGH').length;
  const asideLabel =
    contradictions.length === 0 ? 'No contradictions' : `${openCount} open of ${contradictions.length}`;
  return (
    <Card
      title="Contradictions and interpretations"
      anchorId="f"
      aside={
        <Badge
          label={asideLabel}
          tone={openHigh > 0 ? 'attention' : 'quiet'}
          title={openHigh > 0 ? pluralize(openHigh, 'open HIGH contradiction') : undefined}
        />
      }
    >
      <h3 style={{ ...subheadingStyle, marginTop: 0 }}>Contradictions</h3>
      {sorted.length === 0 ? (
        <p style={mutedStyle}>No contradictions between sources.</p>
      ) : (
        <ul style={listStyle} aria-label="Contradictions">
          {sorted.map((c) => (
            <ContradictionItem key={c.id} contradiction={c} />
          ))}
        </ul>
      )}
      <h3 style={subheadingStyle}>Interpretations applied</h3>
      {interpretations.length === 0 ? (
        <p style={mutedStyle}>No guideline interpretations were needed for this submission.</p>
      ) : (
        <ul style={listStyle} aria-label="Interpretations applied">
          {interpretations.map((i) => (
            <InterpretationItem key={i.id} interpretation={i} />
          ))}
        </ul>
      )}
    </Card>
  );
}
