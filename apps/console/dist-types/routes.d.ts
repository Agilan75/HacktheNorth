/**
 * FROZEN (W0-4) — the console route table (PRD §10). A new route or a changed
 * path goes through docs/contracts/requests/.
 *
 * It lives here, not in App.tsx, because App.tsx imports every page and the
 * pages need these paths. Reading them from App.tsx is a cycle: a page module
 * that touched `ROUTES` at module scope saw `undefined` and threw before the
 * console could render. App.tsx re-exports everything below, so existing
 * imports from `./App.js` still resolve.
 */
export declare const ROUTES: {
    /** The landing page: what Retrofit is, the pipeline, the stack. */
    readonly home: "/";
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
    /**
     * The 3D walkthrough: one procedural apartment, scroll on the camera rail.
     * Additive (W0-4 route table is otherwise frozen). It sits OUTSIDE Layout —
     * no header, no nav, no banner — because it is a marketing surface, not a
     * console route, and it is deliberately absent from NAV_ITEMS for the same
     * reason. The only ways in are the homepage CTA and the address.
     */
    readonly tour: "/tour";
};
export type RouteKey = keyof typeof ROUTES;
/** Build the concrete path for one submission. */
export declare function submissionPath(id: string): string;
/** Header navigation, in display order. Consumed by Layout (C03). */
export declare const NAV_ITEMS: readonly {
    readonly to: string;
    readonly label: string;
}[];
//# sourceMappingURL=routes.d.ts.map