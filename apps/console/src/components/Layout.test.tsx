import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import { Layout } from './Layout';

const nav = [
  { to: '/queue', label: 'Queue' },
  { to: '/rules', label: 'Rules' },
];

afterEach(cleanup);

describe('Layout', () => {
  it('renders the banner inside the header, the nav and the main content', () => {
    render(
      <MemoryRouter initialEntries={['/rules']}>
        <Layout nav={nav} banner={<div role="status">Snapshot</div>}>
          <p>Page body</p>
        </Layout>
      </MemoryRouter>,
    );
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('status')).toHaveTextContent('Snapshot');
    const primary = within(header).getByRole('navigation', { name: 'Primary' });
    const links = within(primary).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Queue', 'Rules']);
    expect(links[0]).toHaveAttribute('href', '/queue');
    expect(within(primary).getByRole('link', { name: 'Rules' })).toHaveAttribute('aria-current', 'page');
    expect(within(primary).getByRole('link', { name: 'Queue' })).not.toHaveAttribute('aria-current');
    expect(within(screen.getByRole('main')).getByText('Page body')).toBeInTheDocument();
  });

  it('keeps the banner with an empty nav and has a skip link to main', () => {
    render(
      <MemoryRouter>
        <Layout nav={[]} banner={<span>Live Federato API</span>}>
          <p>x</p>
        </Layout>
      </MemoryRouter>,
    );
    expect(within(screen.getByRole('banner')).getByText('Live Federato API')).toBeInTheDocument();
    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(skip).toHaveAttribute('href', `#${screen.getByRole('main').id}`);
  });
});
