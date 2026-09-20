import type { ReactElement } from 'react';
/**
 * FROZEN (W0-4) — the console route table (PRD §10). It moved to
 * `./routes.js` to break the App → page → App import cycle, and is re-exported
 * here so every existing `from '../App.js'` import keeps working.
 */
export { NAV_ITEMS, ROUTES, submissionPath } from './routes.js';
export type { RouteKey } from './routes.js';
export declare function App(): ReactElement;
//# sourceMappingURL=App.d.ts.map