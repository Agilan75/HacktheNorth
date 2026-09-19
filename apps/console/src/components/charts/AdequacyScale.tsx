import { useId } from 'react';
import type { ReactElement } from 'react';

import { formatPercent } from '@retrofit/contracts';

export interface AdequacyScaleProps {
  /** Median of `quotedPremium ÷ predictedPremium` across the book; null when unknown. */
  readonly median: number | null;
  readonly title?: string;
}

/**
 * The scale runs 0 to 2 (0%–200%): the same clamp INTERPRETATIONS P-5 applies
 * to adequacy before it enters the quality index.
 */
export const ADEQUACY_DOMAIN_MAX = 2;

export const ADEQUACY_GEOMETRY = {
  width: 640,
  height: 96,
  padX: 24,
  trackY: 44,
  trackHeight: 12,
} as const;

/** x position, in user units, of an adequacy ratio on the clamped 0–2 scale. */
export function adequacyX(ratio: number): number {
  const g = ADEQUACY_GEOMETRY;
  const plot = g.width - g.padX * 2;
  const clamped = Math.min(Math.max(ratio, 0), ADEQUACY_DOMAIN_MAX);
  return g.padX + (clamped / ADEQUACY_DOMAIN_MAX) * plot;
}

/** Plain-language reading of a median adequacy ratio. Presentation only. */
export function adequacyReading(median: number | null): string {
  if (median === null || !Number.isFinite(median)) return 'No priced submissions yet';
  if (median < 1) return 'Quoted below predicted';
  if (median > 1) return 'Quoted above predicted';
  return 'Quoted at predicted';
}

const TICKS = [0, 0.5, 1, 1.5, 2] as const;

/**
 * Hand-written SVG number line: the book's median adequacy against the 100%
 * line where quoted premium equals predicted premium. The value is printed as
 * text next to the marker, so the position never carries meaning alone.
 */
export function AdequacyScale(props: AdequacyScaleProps): ReactElement {
  const { median, title = 'Median premium adequacy' } = props;
  const titleId = useId();
  const g = ADEQUACY_GEOMETRY;
  const known = median !== null && Number.isFinite(median);
  const reading = adequacyReading(median);
  const valueText = formatPercent(median);
  const markerX = known ? adequacyX(median) : null;
  const parX = adequacyX(1);
  const clipped = known && (median < 0 || median > ADEQUACY_DOMAIN_MAX);

  return (
    <figure className="rf-chart rf-chart--adequacy" style={{ margin: 0 }}>
      <svg
        role="img"
        aria-labelledby={titleId}
        viewBox={`0 0 ${g.width} ${g.height}`}
        width="100%"
        style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
        fontFamily="var(--rf-font-body)"
      >
        <title id={titleId}>{`${title}: ${valueText}. ${reading}.`}</title>
        <rect
          x={g.padX}
          y={g.trackY}
          width={g.width - g.padX * 2}
          height={g.trackHeight}
          rx={g.trackHeight / 2}
          fill="var(--rf-muted-tint)"
        />
        {TICKS.map((t) => (
          <g key={t}>
            <line
              x1={adequacyX(t)}
              x2={adequacyX(t)}
              y1={g.trackY + g.trackHeight}
              y2={g.trackY + g.trackHeight + 6}
              stroke="var(--rf-muted)"
            />
            <text
              x={adequacyX(t)}
              y={g.trackY + g.trackHeight + 22}
              textAnchor="middle"
              fontSize={12}
              fill="var(--rf-muted-deep)"
            >
              {formatPercent(t)}
            </text>
          </g>
        ))}
        <line
          data-role="par"
          x1={parX}
          x2={parX}
          y1={g.trackY - 8}
          y2={g.trackY + g.trackHeight + 2}
          stroke="var(--rf-ink)"
          strokeDasharray="3 3"
        />
        {markerX !== null ? (
          <g data-testid="adequacy-marker" data-x={markerX}>
            <circle
              cx={markerX}
              cy={g.trackY + g.trackHeight / 2}
              r={9}
              fill="var(--rf-red)"
              stroke="var(--rf-paper)"
              strokeWidth={2}
            />
            <text
              x={markerX}
              y={g.trackY - 14}
              textAnchor={markerX < g.width * 0.15 ? 'start' : markerX > g.width * 0.85 ? 'end' : 'middle'}
              fontSize={15}
              fontWeight={600}
              fill="var(--rf-ink)"
            >
              {clipped ? `${valueText} (off scale)` : valueText}
            </text>
          </g>
        ) : null}
      </svg>
      <figcaption style={{ fontSize: 'var(--rf-size-small)', color: 'var(--rf-muted-deep)' }}>
        {known ? `${valueText} median · ${reading}. ` : `${reading}. `}
        Adequacy is quoted premium ÷ predicted premium; the dashed line is 100%.
      </figcaption>
    </figure>
  );
}
