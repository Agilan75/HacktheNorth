import type { ReactElement } from 'react';

import type { ReactNode } from 'react';

export interface CardProps {
  readonly title: string;
  /** Rendered next to the title, e.g. a count or a badge. */
  readonly aside?: ReactNode;
  readonly children: ReactNode;
  /** Panel letter from PRD 10, shown as an anchor id on the submission page. */
  readonly anchorId?: string;
}

/** Stable, DOM-safe id for the heading so the section is labelled by it. */
function headingId(title: string, anchorId: string | undefined): string {
  const base = (anchorId ?? title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `rf-card-${base || 'untitled'}-title`;
}

/**
 * Radius 16, 1px Muted-tint border, no shadow (PRD 13).
 *
 * Stub frozen by W0-4. Unit C02 replaces this body only.
 */
export function Card(props: CardProps): ReactElement {
  const { title, aside, children, anchorId } = props;
  const labelId = headingId(title, anchorId);
  return (
    <section className="rf-card" id={anchorId} aria-labelledby={labelId}>
      <header className="rf-card__header">
        <h2 className="rf-card__title" id={labelId}>
          {title}
        </h2>
        {aside !== undefined && aside !== null ? (
          <div className="rf-card__aside">{aside}</div>
        ) : null}
      </header>
      <div className="rf-card__body">{children}</div>
    </section>
  );
}
