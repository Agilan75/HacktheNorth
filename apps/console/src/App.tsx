import type { ReactElement } from 'react';
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
export type { RouteKey } from './routes.js';

/**
 * Everything that lives inside the console chrome. `/tour` does not: it is a
 * full-bleed 3D page, so it is routed above this shell rather than inside it.
 */
function ConsoleShell(): ReactElement {
  return (
    // The adapter banner slot is passed here and rendered by Layout inside the
    // header on every route. PRD §10: "Banner: live Federato or snapshot.
    // Never hidden." No route, state or media query may remove it.
    <Layout nav={NAV_ITEMS} banner={<AdapterBanner />}>
      <Routes>
        <Route path={ROUTES.home} element={<HomePage />} />
        <Route path={ROUTES.queue} element={<QueuePage />} />
        <Route path={ROUTES.submission} element={<SubmissionPage />} />
        <Route path={ROUTES.actions} element={<ActionsPage />} />
        <Route path={ROUTES.rules} element={<RulesPage />} />
        <Route path={ROUTES.glossary} element={<GlossaryPage />} />
        <Route path={ROUTES.aggregate} element={<AggregatePage />} />
        <Route path={ROUTES.verification} element={<VerificationPage />} />
        <Route path={ROUTES.explore} element={<ExplorePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Layout>
  );
}

export function App(): ReactElement {
  return (
    <Routes>
      <Route path={ROUTES.tour} element={<TourPage />} />
      <Route path="*" element={<ConsoleShell />} />
    </Routes>
  );
}
