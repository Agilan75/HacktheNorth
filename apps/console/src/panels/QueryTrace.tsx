import type { CSSProperties, ReactElement } from 'react';

import { formatScore, pluralize } from '@retrofit/contracts';
import { cssVar, SPACE } from '@retrofit/design';

import { Badge } from '../components/atoms/Badge';
import { Card } from '../components/atoms/Card';
import type { QueryTraceEntryView, QueryTracePanelProps } from './types.js';

const listStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: SPACE.md,
};

const entryStyle: CSSProperties = {
  borderLeft: `2px solid ${cssVar('muted-tint')}`,
  paddingLeft: SPACE.md,
};

const entryHeadStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  gap: SPACE.sm,
  fontFamily: cssVar('font-body'),
  fontSize: cssVar('size-small'),
  lineHeight: cssVar('leading-small'),
  color: cssVar('ink'),
};

const stepStyle: CSSProperties = {
  fontWeight: 600,
  color: cssVar('muted-deep'),
  fontVariantNumeric: 'tabular-nums',
};

const resourceStyle: CSSProperties = { fontWeight: 600 };

const metaStyle: CSSProperties = {
  margin: `${SPACE.xs}px 0 0`,
  fontSize: cssVar('size-micro'),
  lineHeight: cssVar('leading-micro'),
  color: cssVar('muted-deep'),
  fontVariantNumeric: 'tabular-nums',
};

const purposeStyle: CSSProperties = {
  margin: `${SPACE.xs}px 0 0`,
  fontSize: cssVar('size-small'),
  lineHeight: cssVar('leading-small'),
  color: cssVar('ink'),
};

const noteStyle: CSSProperties = {
  margin: `${SPACE.xs}px 0 0`,
  fontSize: cssVar('size-small'),
  lineHeight: cssVar('leading-small'),
  color: cssVar('red-deep'),
};

const payloadStyle: CSSProperties = {
  margin: `${SPACE.xs}px 0 0`,
  padding: SPACE.sm,
  background: cssVar('muted-tint'),
  borderRadius: 8,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: cssVar('size-micro'),
  lineHeight: cssVar('leading-micro'),
  overflowX: 'auto',
  whiteSpace: 'pre',
  maxWidth: '100%',
};

const emptyStyle: CSSProperties = {
  margin: 0,
  fontSize: cssVar('size-small'),
  color: cssVar('muted-deep'),
};

/** Pretty-prints a query payload; never throws on a cyclic or BigInt value. */
function payloadText(payload: unknown): string {
  if (payload === undefined) return 'undefined';
  try {
    const text = JSON.stringify(
      payload,
      (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value),
      2,
    );
    return text ?? String(payload);
  } catch {
    return String(payload);
  }
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  if (ms >= 1000) return `${formatScore(ms / 1000, { decimals: 2 })} s`;
  return `${formatScore(ms)} ms`;
}

function TraceEntry({ entry }: { readonly entry: QueryTraceEntryView }): ReactElement {
  return (
    <li style={entryStyle} data-testid="query-trace-entry" data-step={entry.step}>
      <div style={entryHeadStyle}>
        <span style={stepStyle}>Step {entry.step}</span>
        <Badge label={entry.phase} tone="quiet" title="Planner pass" />
        <span style={resourceStyle}>{entry.resource}</span>
        {entry.adapted ? (
          <Badge label="Adapted" tone="attention" title="The planner rewrote this query after a first attempt" />
        ) : null}
      </div>
      <p style={purposeStyle}>{entry.purpose}</p>
      <p style={metaStyle}>
        {pluralize(entry.resultCount, 'row')} · {formatDuration(entry.durationMs)}
      </p>
      {entry.note !== null && entry.note !== '' ? <p style={noteStyle}>{entry.note}</p> : null}
      <details>
        <summary style={metaStyle}>Query payload</summary>
        <pre style={payloadStyle}>
          <code>{payloadText(entry.payload)}</code>
        </pre>
      </details>
    </li>
  );
}

/**
 * PRD 10 (c) How the agent got here: the query trace.
 *
 * Stub frozen by W0-4. Unit C07 replaces this body only — never the signature,
 * never the import list's shape, never this file's path.
 */
export function QueryTrace(props: QueryTracePanelProps): ReactElement {
  const entries = [...props.entries].sort((a, b) => a.step - b.step);
  const adaptedCount = entries.filter((e) => e.adapted).length;
  const aside =
    entries.length === 0 ? null : (
      <span>
        {pluralize(entries.length, 'query', 'queries')}
        {adaptedCount > 0 ? ` · ${adaptedCount} adapted` : ''}
      </span>
    );

  return (
    <Card title="How the agent got here" anchorId="query-trace" aside={aside}>
      {entries.length === 0 ? (
        <p style={emptyStyle}>No queries were recorded for this submission.</p>
      ) : (
        <ol style={listStyle} aria-label="Queries in the order the planner issued them">
          {entries.map((entry) => (
            <TraceEntry key={`${entry.step}-${entry.resource}`} entry={entry} />
          ))}
        </ol>
      )}
    </Card>
  );
}
