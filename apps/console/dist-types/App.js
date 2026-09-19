import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Navigate, Route, Routes } from 'react-router';
import { AdapterBanner } from './components/AdapterBanner.js';
import { Layout } from './components/Layout.js';
import { ActionsPage } from './pages/ActionsPage.js';
import { AggregatePage } from './pages/AggregatePage.js';
import { GlossaryPage } from './pages/GlossaryPage.js';
import { QueuePage } from './pages/QueuePage.js';
import { RulesPage } from './pages/RulesPage.js';
import { SubmissionPage } from './pages/SubmissionPage.js';
import { VerificationPage } from './pages/VerificationPage.js';
/**
 * FROZEN (W0-4) — the console route table (PRD §10).
 *
 * Run 1 units C01–C14 fill page and panel bodies. Nobody edits this file:
 * a new route or a changed path goes through docs/contracts/requests/.
 */
export const ROUTES = {
    queue: '/queue',
    submission: '/submissions/:id',
    actions: '/actions',
    rules: '/rules',
    glossary: '/glossary',
    aggregate: '/aggregate',
    /** The testing in full, from GET /verification (FILL-console). */
    verification: '/verification',
};
/** Build the concrete path for one submission. */
export function submissionPath(id) {
    return `/submissions/${encodeURIComponent(id)}`;
}
/** Header navigation, in display order. Consumed by Layout (C03). */
export const NAV_ITEMS = [
    { to: ROUTES.queue, label: 'Queue' },
    { to: ROUTES.actions, label: 'Actions' },
    { to: ROUTES.rules, label: 'Rules' },
    { to: ROUTES.glossary, label: 'Glossary' },
    { to: ROUTES.aggregate, label: 'Aggregate' },
    { to: ROUTES.verification, label: 'Verification' },
];
export function App() {
    return (_jsx(Layout, { nav: NAV_ITEMS, banner: _jsx(AdapterBanner, {}), children: _jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(Navigate, { to: ROUTES.queue, replace: true }) }), _jsx(Route, { path: ROUTES.queue, element: _jsx(QueuePage, {}) }), _jsx(Route, { path: ROUTES.submission, element: _jsx(SubmissionPage, {}) }), _jsx(Route, { path: ROUTES.actions, element: _jsx(ActionsPage, {}) }), _jsx(Route, { path: ROUTES.rules, element: _jsx(RulesPage, {}) }), _jsx(Route, { path: ROUTES.glossary, element: _jsx(GlossaryPage, {}) }), _jsx(Route, { path: ROUTES.aggregate, element: _jsx(AggregatePage, {}) }), _jsx(Route, { path: ROUTES.verification, element: _jsx(VerificationPage, {}) }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: ROUTES.queue, replace: true }) })] }) }));
}
//# sourceMappingURL=App.js.map