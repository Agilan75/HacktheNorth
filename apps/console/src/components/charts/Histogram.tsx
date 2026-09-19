import { useId } from 'react';
import type { ReactElement } from 'react';

export interface HistogramBucket {
  /** Axis label, e.g. `70–79`. */
  readonly label: string;
  readonly count: number;
}

export interface HistogramProps {
  readonly title: string;
  readonly buckets: readonly HistogramBucket[];
  /** Text under the axis, e.g. `Appetite score`. */
  readonly xLabel?: string;
  readonly emptyLabel?: string;
}

/** ViewBox geometry, in SVG user units. */
export const HISTOGRAM_GEOMETRY = {
  width: 640,
  height: 260,
  padLeft: 8,
  padRight: 8,
  padTop: 24,
  padBottom: 48,
  gap: 6,
} as const;

function safeCount(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Column height in user units: proportional to `count / max`, zero when `max` is zero. */
export function columnHeight(count: number, max: number, plotHeight: number): number {
  const c = safeCount(count);
  const m = safeCount(max);
  if (m === 0) return 0;
  return (Math.min(c, m) / m) * plotHeight;
}

/**
 * Hand-written SVG column histogram. Every column prints its count above it and
 * its bucket below it; a visually hidden table repeats the numbers.
 */
export function Histogram(props: HistogramProps): ReactElement {
  const { title, buckets, xLabel, emptyLabel = 'No scores yet.' } = props;
  const titleId = useId();
  const total = buckets.reduce((s, b) => s + safeCount(b.count), 0);
  if (buckets.length === 0 || total === 0) {
    return (
      <p className="rf-chart-empty" style={{ color: 'var(--rf-muted-deep)', margin: 0 }}>
        {emptyLabel}
      </p>
    );
  }
  const g = HISTOGRAM_GEOMETRY;
  const plotWidth = g.width - g.padLeft - g.padRight;
  const plotHeight = g.height - g.padTop - g.padBottom;
  const slot = plotWidth / buckets.length;
  const colWidth = Math.max(slot - g.gap, 1);
  const max = buckets.reduce((m, b) => Math.max(m, safeCount(b.count)), 0);
  const baseline = g.padTop + plotHeight;
  const summary = buckets.map((b) => `${b.label}: ${safeCount(b.count)}`).join(', ');

  return (
    <figure className="rf-chart rf-chart--histogram" style={{ margin: 0 }}>
      <svg
        role="img"
        aria-labelledby={titleId}
        viewBox={`0 0 ${g.width} ${g.height}`}
        width="100%"
        style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
        fontFamily="var(--rf-font-body)"
      >
        <title id={titleId}>{`${title}. ${summary}.`}</title>
        <line
          x1={g.padLeft}
          x2={g.width - g.padRight}
          y1={baseline + 0.5}
          y2={baseline + 0.5}
          stroke="var(--rf-muted)"
          strokeWidth={1}
        />
        {buckets.map((b, i) => {
          const h = columnHeight(b.count, max, plotHeight);
          const x = g.padLeft + i * slot + g.gap / 2;
          const cx = x + colWidth / 2;
          return (
            <g key={`${i}-${b.label}`} data-testid={`column-${i}`} data-count={safeCount(b.count)}>
              {h > 0 ? (
                <rect
                  data-role="column"
                  x={x}
                  y={baseline - h}
                  width={colWidth}
                  height={h}
                  rx={4}
                  fill="var(--rf-ink)"
                />
              ) : null}
              <text
                x={cx}
                y={baseline - h - 6}
                textAnchor="middle"
                fontSize={13}
                fontWeight={600}
                fill="var(--rf-ink)"
              >
                {safeCount(b.count).toLocaleString('en-US')}
              </text>
              <text
                x={cx}
                y={baseline + 18}
                textAnchor="middle"
                fontSize={12}
                fill="var(--rf-muted-deep)"
              >
                {b.label}
              </text>
            </g>
          );
        })}
        {xLabel ? (
          <text
            x={g.width / 2}
            y={g.height - 8}
            textAnchor="middle"
            fontSize={13}
            fill="var(--rf-muted-deep)"
          >
            {xLabel}
          </text>
        ) : null}
      </svg>
      <table className="rf-sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">{xLabel ?? 'Bucket'}</th>
            <th scope="col">Count</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b, i) => (
            <tr key={`${i}-${b.label}`}>
              <th scope="row">{b.label}</th>
              <td>{safeCount(b.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
