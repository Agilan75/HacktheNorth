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
 * change. It renders something in every state — loading, error and unknown
 * included — so it can never disappear from the header.
 */
export declare function AdapterBanner(props: AdapterBannerProps): ReactElement;
//# sourceMappingURL=AdapterBanner.d.ts.map