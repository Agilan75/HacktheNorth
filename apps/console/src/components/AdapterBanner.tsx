import type { ReactElement } from 'react';

export type AdapterKind = 'live' | 'snapshot' | 'unknown';

export interface AdapterBannerProps {
  /** When omitted, C03 reads GET /health itself. */
  readonly kind?: AdapterKind;
}

/**
 * PRD §10 header: "Banner: live Federato or snapshot. Never hidden."
 *
 * The banner states the adapter in words ("Live Federato API" / "Snapshot"),
 * never by colour alone, and has role="status" so a screen reader announces a
 * change. Stub frozen by W0-4; unit C03 replaces this body only.
 */
export function AdapterBanner(_props: AdapterBannerProps): ReactElement {
  throw new Error('NOT_IMPLEMENTED:C03');
}
