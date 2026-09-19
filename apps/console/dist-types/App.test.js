import { jsx as _jsx } from "react/jsx-runtime";
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('./components/AdapterBanner.js', () => ({ AdapterBanner: () => _jsx("span", { children: "banner" }) }));
vi.mock('./pages/QueuePage.js', () => ({ QueuePage: () => _jsx("p", { children: "queue page" }) }));
vi.mock('./pages/SubmissionPage.js', () => ({ SubmissionPage: () => _jsx("p", { children: "submission page" }) }));
vi.mock('./pages/ActionsPage.js', () => ({ ActionsPage: () => _jsx("p", { children: "actions page" }) }));
vi.mock('./pages/RulesPage.js', () => ({ RulesPage: () => _jsx("p", { children: "rules page" }) }));
vi.mock('./pages/GlossaryPage.js', () => ({ GlossaryPage: () => _jsx("p", { children: "glossary page" }) }));
vi.mock('./pages/AggregatePage.js', () => ({ AggregatePage: () => _jsx("p", { children: "aggregate page" }) }));
vi.mock('./pages/VerificationPage.js', () => ({ VerificationPage: () => _jsx("p", { children: "verification page" }) }));
import { App, NAV_ITEMS, ROUTES } from './App.js';
afterEach(cleanup);
describe('App route table', () => {
    it('routes /verification to the Verification page and puts it in the header nav', () => {
        render(_jsx(MemoryRouter, { initialEntries: ['/verification'], children: _jsx(App, {}) }));
        expect(ROUTES.verification).toBe('/verification');
        expect(screen.getByText('verification page')).toBeInTheDocument();
        const nav = within(screen.getByRole('navigation', { name: 'Primary' }));
        expect(nav.getByRole('link', { name: 'Verification' })).toHaveAttribute('href', '/verification');
        expect(nav.getByRole('link', { name: 'Verification' })).toHaveAttribute('aria-current', 'page');
        expect(NAV_ITEMS.map((n) => n.label)).toEqual(['Queue', 'Actions', 'Rules', 'Glossary', 'Aggregate', 'Explore', 'Verification']);
    });
    it('still routes the existing pages', () => {
        render(_jsx(MemoryRouter, { initialEntries: ['/aggregate'], children: _jsx(App, {}) }));
        expect(screen.getByText('aggregate page')).toBeInTheDocument();
    });
    it('shows a not-found page with a way back for an unknown address, and still redirects / to the queue', () => {
        render(_jsx(MemoryRouter, { initialEntries: ['/s/does-not-exist'], children: _jsx(App, {}) }));
        expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
        expect(screen.getByText('/s/does-not-exist')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Back to the queue' })).toHaveAttribute('href', '/queue');
        expect(screen.queryByText('queue page')).toBeNull();
        cleanup();
        render(_jsx(MemoryRouter, { initialEntries: ['/'], children: _jsx(App, {}) }));
        expect(screen.getByText('queue page')).toBeInTheDocument();
    });
});
//# sourceMappingURL=App.test.js.map