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
  color: cssVar('ink'),
};

const errorStyle: CSSProperties = { ...noteStyle, color: cssVar('red-deep') };

const labelStyle: CSSProperties = { fontWeight: 600 };

const subListStyle: CSSProperties = {
  margin: `${SPACE.xs}px 0 0`,
  paddingLeft: SPACE.lg,
  fontSize: cssVar('size-small'),
  lineHeight: cssVar('leading-small'),
  color: cssVar('ink'),
};

const codeStyle: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.95em',
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

/**
 * Plain-language readings of the planner's adaptation kinds
 * (packages/federato/src/planner/adapt.ts). An unknown kind is shown verbatim.
 */
const ADAPTATION_TEXT: Readonly<Record<string, string>> = {
  elem_match_swap:
    'the previous attempt returned no rows through a dot-path into an array, so the planner retried with $elemMatch instead.',
  drop_narrowest_filter:
    'the previous attempt returned no rows, so the planner dropped its narrowest filter and retried.',
};

function adaptationText(kind: string): string {
  return ADAPTATION_TEXT[kind] ?? kind;
}

function hasText(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && value.trim() !== '';
}

function pathText(resource: string, path: readonly string[] | undefined): string {
  return [resource, ...(path ?? [])].join(' → ');
}

/** Ends a clause with a full stop unless it already carries terminal punctuation. */
function sentence(text: string): string {
  const t = text.trim();
  return /[.!?:]$/.test(t) ? t : `${t}.`;
}

function TraceEntry({ entry }: { readonly entry: QueryTraceEntryView }): ReactElement {
  const needs = entry.requiredBy;
  const rejected = entry.alternativesRejected ?? [];
  const adaptation = hasText(entry.adaptation) && entry.adaptation !== 'none' ? entry.adaptation : null;
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
      <p style={purposeStyle} data-testid="trace-goal">
        <span style={labelStyle}>Goal:</span> {entry.purpose}
      </p>
      {needs === undefined ? null : needs.length === 0 ? (
        <p style={noteStyle} data-testid="trace-needs-none">
          No scoring rule needed this query; it gathers context for the ones that do.
        </p>
      ) : (
        <>
          <p style={noteStyle}>
            <span style={labelStyle}>Needed by:</span>
          </p>
          <ul style={subListStyle} aria-label={`Rules that needed step ${entry.step}`}>
            {needs.map((n, i) => (
              <li key={`${n.ruleId}-${n.canonicalPath}-${i}`} data-testid="trace-need">
                Rule <code style={codeStyle}>{n.ruleId}</code>
                {n.factor !== null && n.factor !== '' ? ` (${n.factor})` : ''} needs{' '}
                <code style={codeStyle}>{n.canonicalPath}</code>
                {hasText(n.why) ? `: ${n.why}` : ''}
              </li>
            ))}
          </ul>
        </>
      )}
      {hasText(entry.why) || (entry.path !== undefined && entry.path.length > 0) ? (
        <p style={noteStyle} data-testid="trace-path">
          <span style={labelStyle}>Path chosen:</span> Went to {pathText(entry.resource, entry.path)}
          {hasText(entry.why) ? ` because ${sentence(entry.why)}` : '.'}
        </p>
      ) : null}
      {rejected.length > 0 ? (
        <>
          <p style={noteStyle}>
            <span style={labelStyle}>Considered and rejected:</span>
          </p>
          <ul style={subListStyle} aria-label={`Alternatives rejected at step ${entry.step}`}>
            {rejected.map((a, i) => (
              <li key={`${a.rootResource}-${i}`} data-testid="trace-rejected">
                {pathText(a.rootResource, a.path)}: {sentence(a.why)}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <p style={metaStyle} data-testid="trace-result">
        Returned {pluralize(entry.resultCount, 'row')} in {formatDuration(entry.durationMs)}.
      </p>
      {adaptation !== null ? (
        <p style={noteStyle} data-testid="trace-adaptation">
          <span style={labelStyle}>Adapted:</span> {adaptationText(adaptation)}
        </p>
      ) : null}
      {hasText(entry.note) ? (
        <p style={noteStyle} data-testid="trace-note">
          <span style={labelStyle}>Note:</span> {entry.note}
        </p>
      ) : null}
      {hasText(entry.error) ? (
        <p style={errorStyle} data-testid="trace-error">
          <span style={labelStyle}>Error:</span> {entry.error}
        </p>
      ) : null}
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
 * Each query reads as prose (R3-2, PRD 7.5 step 6): the goal, which rule needed
 * it, the path chosen and why, the alternatives rejected, the row count and
 * duration, and any adaptation. The raw payload stays behind a disclosure.
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
