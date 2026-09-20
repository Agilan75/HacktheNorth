import type { ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router';

import { AdapterBanner } from './components/AdapterBanner.js';
import { Layout } from './components/Layout.js';
import { ActionsPage } from './pages/ActionsPage.js';
import { AggregatePage } from './pages/AggregatePage.js';
import { ExplorePage } from './pages/ExplorePage.js';
import { GlossaryPage } from './pages/GlossaryPage.js';
import { NotFoundPage } from './pages/NotFoundPage.js';
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
  /** The book in 3D: scatter and network views. */
  explore: '/explore',
} as const;

export type RouteKey = keyof typeof ROUTES;

/** Build the concrete path for one submission. */
export function submissionPath(id: string): string {
  return `/submissions/${encodeURIComponent(id)}`;
}

/** Header navigation, in display order. Consumed by Layout (C03). */
export const NAV_ITEMS: readonly { readonly to: string; readonly label: string }[] = [
  { to: ROUTES.queue, label: 'Queue' },
  { to: ROUTES.actions, label: 'Actions' },
  { to: ROUTES.rules, label: 'Rules' },
  { to: ROUTES.glossary, label: 'Glossary' },
  { to: ROUTES.aggregate, label: 'Aggregate' },
  { to: ROUTES.explore, label: 'Explore' },
  { to: ROUTES.verification, label: 'Verification' },
];

export function App(): ReactElement {
  return (
    // The adapter banner slot is passed here and rendered by Layout inside the
    // header on every route. PRD §10: "Banner: live Federato or snapshot.
    // Never hidden." No route, state or media query may remove it.
    <Layout nav={NAV_ITEMS} banner={<AdapterBanner />}>
      <Routes>
        <Route path="/" element={<Navigate to={ROUTES.queue} replace />} />
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
