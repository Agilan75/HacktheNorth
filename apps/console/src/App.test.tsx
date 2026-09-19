import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./components/AdapterBanner.js', () => ({ AdapterBanner: () => <span>banner</span> }));
vi.mock('./pages/QueuePage.js', () => ({ QueuePage: () => <p>queue page</p> }));
vi.mock('./pages/SubmissionPage.js', () => ({ SubmissionPage: () => <p>submission page</p> }));
vi.mock('./pages/ActionsPage.js', () => ({ ActionsPage: () => <p>actions page</p> }));
vi.mock('./pages/RulesPage.js', () => ({ RulesPage: () => <p>rules page</p> }));
vi.mock('./pages/GlossaryPage.js', () => ({ GlossaryPage: () => <p>glossary page</p> }));
vi.mock('./pages/AggregatePage.js', () => ({ AggregatePage: () => <p>aggregate page</p> }));
vi.mock('./pages/VerificationPage.js', () => ({ VerificationPage: () => <p>verification page</p> }));

import { App, NAV_ITEMS, ROUTES } from './App.js';

afterEach(cleanup);

describe('App route table', () => {
  it('routes /verification to the Verification page and puts it in the header nav', () => {
    render(
      <MemoryRouter initialEntries={['/verification']}>
        <App />
      </MemoryRouter>,
    );
    expect(ROUTES.verification).toBe('/verification');
    expect(screen.getByText('verification page')).toBeInTheDocument();
    const nav = within(screen.getByRole('navigation', { name: 'Primary' }));
    expect(nav.getByRole('link', { name: 'Verification' })).toHaveAttribute('href', '/verification');
    expect(nav.getByRole('link', { name: 'Verification' })).toHaveAttribute('aria-current', 'page');
    expect(NAV_ITEMS.map((n) => n.label)).toEqual(['Queue', 'Actions', 'Rules', 'Glossary', 'Aggregate', 'Explore', 'Verification']);
  });

  it('still routes the existing pages', () => {
    render(
      <MemoryRouter initialEntries={['/aggregate']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByText('aggregate page')).toBeInTheDocument();
  });

  it('shows a not-found page with a way back for an unknown address, and still redirects / to the queue', () => {
    render(
      <MemoryRouter initialEntries={['/s/does-not-exist']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByText('/s/does-not-exist')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the queue' })).toHaveAttribute('href', '/queue');
    expect(screen.queryByText('queue page')).toBeNull();
    cleanup();
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByText('queue page')).toBeInTheDocument();
  });
});
