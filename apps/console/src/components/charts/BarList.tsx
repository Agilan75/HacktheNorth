import { useId } from 'react';
import type { ReactElement } from 'react';

/** One horizontal bar. The label and the count are always printed as text. */
export interface BarListItem {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  /** Optional non-colour mark printed before the label (e.g. a verdict glyph). */
  readonly mark?: string;
  /** Bar fill; defaults to Muted deep. */
  readonly fill?: string;
  /** Bar outline; defaults to the fill. */
  readonly stroke?: string;
}

export interface BarListProps {
  /** Accessible name of the chart, also the caption of the screen-reader table. */
  readonly title: string;
  readonly items: readonly BarListItem[];
  /** Shown instead of the chart when there are no items. */
  readonly emptyLabel?: string;
  /** Header for the count column of the screen-reader table. */
  readonly countLabel?: string;
}

/** ViewBox geometry, in SVG user units. */
export const BAR_LIST_GEOMETRY = {
  width: 640,
  rowHeight: 32,
  barHeight: 18,
  labelWidth: 220,
  countWidth: 56,
  padTop: 4,
} as const;

const MAX_LABEL_CHARS = 30;

function shorten(label: string): string {
  return label.length <= MAX_LABEL_CHARS ? label : `${label.slice(0, MAX_LABEL_CHARS - 1)}…`;
}

function safeCount(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Width of one bar in user units: proportional to `count / max`, zero when
 * `max` is zero. Exported so the proportionality is testable.
 */
export function barWidth(count: number, max: number, plotWidth: number): number {
  const c = safeCount(count);
  const m = safeCount(max);
  if (m === 0) return 0;
  return (Math.min(c, m) / m) * plotWidth;
}

/**
 * Hand-written SVG horizontal bar chart. Colour never carries meaning alone:
 * every bar prints its label (and optional mark) and its count, and the same
 * numbers are repeated in a visually hidden table for screen readers.
 */
export function BarList(props: BarListProps): ReactElement {
  const { title, items, emptyLabel = 'Nothing to show yet.', countLabel = 'Count' } = props;
  const titleId = useId();
  if (items.length === 0) {
    return (
      <p className="rf-chart-empty" style={{ color: 'var(--rf-muted-deep)', margin: 0 }}>
        {emptyLabel}
      </p>
    );
  }
  const g = BAR_LIST_GEOMETRY;
  const plotWidth = g.width - g.labelWidth - g.countWidth;
  const max = items.reduce((m, it) => Math.max(m, safeCount(it.count)), 0);
  const height = g.padTop * 2 + items.length * g.rowHeight;
  const summary = items.map((it) => `${it.label}: ${safeCount(it.count)}`).join(', ');

  return (
    <figure className="rf-chart rf-chart--bars" style={{ margin: 0 }}>
      <svg
        role="img"
        aria-labelledby={titleId}
        viewBox={`0 0 ${g.width} ${height}`}
        width="100%"
        style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
        fontFamily="var(--rf-font-body)"
      >
        <title id={titleId}>{`${title}. ${summary}.`}</title>
        {items.map((it, i) => {
          const y = g.padTop + i * g.rowHeight;
          const w = barWidth(it.count, max, plotWidth);
          const fill = it.fill ?? 'var(--rf-muted-deep)';
          const stroke = it.stroke ?? fill;
          const label = it.mark ? `${it.mark} ${it.label}` : it.label;
          const barY = y + (g.rowHeight - g.barHeight) / 2;
          return (
            <g key={it.key} data-testid={`bar-${it.key}`} data-count={safeCount(it.count)}>
              <text
                x={g.labelWidth - 12}
                y={y + g.rowHeight / 2}
                textAnchor="end"
                dominantBaseline="central"
                fontSize={14}
                fill="var(--rf-ink)"
              >
                {label.length > MAX_LABEL_CHARS ? <title>{label}</title> : null}
                {shorten(label)}
              </text>
              <rect
                x={g.labelWidth}
                y={barY}
                width={plotWidth}
                height={g.barHeight}
                rx={g.barHeight / 2}
                fill="var(--rf-muted-tint)"
              />
              {w > 0 ? (
                <rect
                  data-role="bar"
                  x={g.labelWidth + 0.5}
                  y={barY + 0.5}
                  width={Math.max(w - 1, 1)}
                  height={g.barHeight - 1}
                  rx={(g.barHeight - 1) / 2}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={1.5}
                />
              ) : null}
              <text
                x={g.width - 4}
                y={y + g.rowHeight / 2}
                textAnchor="end"
                dominantBaseline="central"
                fontSize={14}
                fontWeight={600}
                fill="var(--rf-ink)"
              >
                {safeCount(it.count).toLocaleString('en-US')}
              </text>
            </g>
          );
        })}
      </svg>
      <table className="rf-sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">{countLabel}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.key}>
              <th scope="row">{it.label}</th>
              <td>{safeCount(it.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
