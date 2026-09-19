import type { ReactElement, ReactNode } from 'react';

export interface NavItem {
  readonly to: string;
  readonly label: string;
}

export interface LayoutProps {
  readonly nav: readonly NavItem[];
  /**
   * The adapter banner slot. App.tsx always passes it and Layout must always
   * render it inside the header — PRD §10: never hidden.
   */
  readonly banner: ReactNode;
  readonly children: ReactNode;
}

/** Stub frozen by W0-4. Unit C03 replaces this body only. */
export function Layout(_props: LayoutProps): ReactElement {
  throw new Error('NOT_IMPLEMENTED:C03');
}
