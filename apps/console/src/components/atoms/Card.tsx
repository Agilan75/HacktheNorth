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

/**
 * Radius 16, 1px Muted-tint border, no shadow (PRD 13).
 *
 * Stub frozen by W0-4. Unit C02 replaces this body only.
 */
export function Card(_props: CardProps): ReactElement {
  throw new Error('NOT_IMPLEMENTED:C02');
}
