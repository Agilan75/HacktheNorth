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
/**
 * Console shell: skip link, header (brand, primary nav, adapter banner), main.
 * The banner is rendered unconditionally in the header on every route —
 * PRD §10 "Never hidden".
 */
export declare function Layout(props: LayoutProps): ReactElement;
//# sourceMappingURL=Layout.d.ts.map