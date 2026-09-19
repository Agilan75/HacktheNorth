import type { ReactElement } from 'react';

export interface SkeletonProps {
  readonly lines?: number;
  readonly width?: string;
  /** Announced to screen readers while the real content loads. */
  readonly label: string;
}

/**
 * PRD 13: skeleton loaders for every list and card.
 *
 * Stub frozen by W0-4. Unit C02 replaces this body only.
 */
export function Skeleton(_props: SkeletonProps): ReactElement {
  throw new Error('NOT_IMPLEMENTED:C02');
}
