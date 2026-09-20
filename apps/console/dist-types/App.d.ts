import type { ReactElement } from 'react';
/**
 * FROZEN (W0-4) — the console route table (PRD §10).
 *
 * Run 1 units C01–C14 fill page and panel bodies. Nobody edits this file:
 * a new route or a changed path goes through docs/contracts/requests/.
 */
export declare const ROUTES: {
    readonly queue: "/queue";
    readonly submission: "/submissions/:id";
    readonly actions: "/actions";
    readonly rules: "/rules";
    readonly glossary: "/glossary";
    readonly aggregate: "/aggregate";
    /** The testing in full, from GET /verification (FILL-console). */
    readonly verification: "/verification";
    /** The book in 3D: scatter and network views. */
    readonly explore: "/explore";
};
export type RouteKey = keyof typeof ROUTES;
/** Build the concrete path for one submission. */
export declare function submissionPath(id: string): string;
/** Header navigation, in display order. Consumed by Layout (C03). */
export declare const NAV_ITEMS: readonly {
    readonly to: string;
    readonly label: string;
}[];
export declare function App(): ReactElement;
//# sourceMappingURL=App.d.ts.map