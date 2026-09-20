import type { ReactElement } from 'react';

export interface SkeletonProps {
  readonly lines?: number;
  readonly width?: string;
  /** Announced to screen readers while the real content loads. */
  readonly label: string;
}

const DEFAULT_LINES = 3;
const MAX_LINES = 50;

/**
 * PRD 13: skeleton loaders for every list and card.
 *
 * Stub frozen by W0-4. Unit C02 replaces this body only.
 */
export function Skeleton(props: SkeletonProps): ReactElement {
  const requested = props.lines ?? DEFAULT_LINES;
  const count = Number.isFinite(requested)
    ? Math.min(MAX_LINES, Math.max(1, Math.floor(requested)))
    : DEFAULT_LINES;
  const lines: ReactElement[] = [];
  for (let i = 0; i < count; i += 1) {
    // The last line of a multi-line block is shorter, so it reads as a paragraph.
    const width = count > 1 && i === count - 1 ? '60%' : '100%';
    lines.push(<span key={i} className="rf-skeleton__line" style={{ width }} />);
  }
  return (
    <div
      className="rf-skeleton"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={props.label}
      style={props.width ? { width: props.width } : undefined}
    >
      <span className="rf-sr-only">{props.label}</span>
      <span aria-hidden="true" style={{ display: 'contents' }}>
        {lines}
      </span>
    </div>
  );
}
