import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Route, Routes } from 'react-router';
import { AdapterBanner } from './components/AdapterBanner.js';
import { Layout } from './components/Layout.js';
import { ActionsPage } from './pages/ActionsPage.js';
import { AggregatePage } from './pages/AggregatePage.js';
import { ExplorePage } from './pages/ExplorePage.js';
import { GlossaryPage } from './pages/GlossaryPage.js';
import { HomePage } from './pages/HomePage.js';
import { NotFoundPage } from './pages/NotFoundPage.js';
import { QueuePage } from './pages/QueuePage.js';
import { RulesPage } from './pages/RulesPage.js';
import { SubmissionPage } from './pages/SubmissionPage.js';
import { TourPage } from './pages/TourPage.js';
import { VerificationPage } from './pages/VerificationPage.js';
import { NAV_ITEMS, ROUTES } from './routes.js';
/**
 * FROZEN (W0-4) — the console route table (PRD §10). It moved to
 * `./routes.js` to break the App → page → App import cycle, and is re-exported
 * here so every existing `from '../App.js'` import keeps working.
 */
export { NAV_ITEMS, ROUTES, submissionPath } from './routes.js';
/**
 * Everything that lives inside the console chrome. `/tour` does not: it is a
 * full-bleed 3D page, so it is routed above this shell rather than inside it.
 */
function ConsoleShell() {
    return (_jsx(Layout, { nav: NAV_ITEMS, banner: _jsx(AdapterBanner, {}), children: _jsxs(Routes, { children: [_jsx(Route, { path: ROUTES.home, element: _jsx(HomePage, {}) }), _jsx(Route, { path: ROUTES.queue, element: _jsx(QueuePage, {}) }), _jsx(Route, { path: ROUTES.submission, element: _jsx(SubmissionPage, {}) }), _jsx(Route, { path: ROUTES.actions, element: _jsx(ActionsPage, {}) }), _jsx(Route, { path: ROUTES.rules, element: _jsx(RulesPage, {}) }), _jsx(Route, { path: ROUTES.glossary, element: _jsx(GlossaryPage, {}) }), _jsx(Route, { path: ROUTES.aggregate, element: _jsx(AggregatePage, {}) }), _jsx(Route, { path: ROUTES.verification, element: _jsx(VerificationPage, {}) }), _jsx(Route, { path: ROUTES.explore, element: _jsx(ExplorePage, {}) }), _jsx(Route, { path: "*", element: _jsx(NotFoundPage, {}) })] }) }));
}
export function App() {
    return (_jsxs(Routes, { children: [_jsx(Route, { path: ROUTES.tour, element: _jsx(TourPage, {}) }), _jsx(Route, { path: "*", element: _jsx(ConsoleShell, {}) })] }));
}
//# sourceMappingURL=App.js.map