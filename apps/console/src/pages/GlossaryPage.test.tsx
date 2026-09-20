import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GlossaryResponse } from '../api/client.js';
import type { AsyncState } from '../api/useApi.js';

let apiState: AsyncState<GlossaryResponse>;
const reload = vi.fn();

vi.mock('../api/useApi.js', () => ({
  useApi: () => apiState,
  useApiClient: () => {
    throw new Error('not used');
  },
}));

const { GlossaryPage } = await import('./GlossaryPage');

const glossary: GlossaryResponse = {
  entries: [
    { term: 'Premium', definition: 'The price paid for the policy.', source: 'Federato glossary, p. 1' },
    { term: 'Appetite', definition: 'The kinds of risk a carrier wants to write.', source: 'Federato glossary, p. 2' },
    { term: 'In-Appetite', definition: 'A submission inside the appetite.', source: 'Federato glossary, p. 2' },
    { term: 'Carrier', definition: 'The insurance company that writes the premium.', source: 'Federato glossary, p. 1' },
  ],
};

function ready(data: GlossaryResponse): AsyncState<GlossaryResponse> {
  return { data, loading: false, error: null, reload };
}

function terms(): string[] {
  return screen.queryAllByRole('term').map((t) => t.textContent ?? '');
}

function mount(entry: string | { pathname: string; state: unknown } = '/glossary'): ReactElement {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/glossary" element={<GlossaryPage />} />
        <Route path="/queue" element={<p>queue</p>} />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(cleanup);

describe('GlossaryPage', () => {
  it('lists every term alphabetically with definition, source and a stable anchor', () => {
    apiState = ready(glossary);
    render(mount());
    expect(screen.getByRole('heading', { level: 1, name: 'Glossary' })).toBeInTheDocument();
    expect(terms()).toEqual(['Appetite', 'Carrier', 'In-Appetite', 'Premium']);
    expect(screen.getByRole('status')).toHaveTextContent('4 terms');
    const item = document.getElementById('glossary-in-appetite');
    expect(item).not.toBeNull();
    expect(within(item!).getByText('A submission inside the appetite.', { exact: false })).toBeInTheDocument();
    expect(within(item!).getByText('Federato glossary, p. 2')).toBeInTheDocument();
  });

  it('offers an A-Z jump bar, linking only the letters that have terms', () => {
    apiState = ready(glossary);
    render(mount());
    const bar = screen.getByRole('navigation', { name: 'Jump to a letter' });
    expect([...bar.querySelectorAll('a')].map((a) => a.textContent)).toEqual(['A', 'C', 'I', 'P']);
    expect(bar.querySelector('a[href="#glossary-letter-c"]')).not.toBeNull();
    // The letters with nothing behind them are still shown, muted and unlinked.
    expect(bar.querySelectorAll('span').length).toBe(23);
    expect(document.getElementById('glossary-letter-i')!.textContent).toBe('I');
  });

  it('keeps the search in the URL so a filtered glossary is shareable', () => {
    apiState = ready(glossary);
    render(mount('/glossary?q=premium'));
    expect(screen.getByLabelText('Search terms and definitions')).toHaveValue('premium');
    expect(terms()).toEqual(['Premium', 'Carrier']);
  });

  it('searches terms and definitions, ranking term matches first', () => {
    apiState = ready(glossary);
    render(mount());
    const search = screen.getByLabelText('Search terms and definitions');

    fireEvent.change(search, { target: { value: 'premium' } });
    // "Premium" is a term match; "Carrier" only mentions premium in its definition.
    expect(terms()).toEqual(['Premium', 'Carrier']);
    expect(screen.getByRole('status')).toHaveTextContent('2 terms of 4 match “premium”');
    // Ranked results are one flat list, so the alphabetical jump bar steps aside.
    expect(screen.queryByRole('navigation', { name: 'Jump to a letter' })).toBeNull();

    fireEvent.change(search, { target: { value: 'in appetite' } });
    expect(terms()[0]).toBe('In-Appetite');

    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(terms()).toEqual([]);
    expect(screen.getByText('No glossary term matches “zzz”.')).toBeInTheDocument();

    fireEvent.change(search, { target: { value: '' } });
    expect(terms()).toEqual(['Appetite', 'Carrier', 'In-Appetite', 'Premium']);
  });

  it('shows a way back only when the user came from another console page', () => {
    apiState = ready(glossary);
    const bare = render(mount());
    expect(screen.queryByRole('link', { name: /Back to/ })).toBeNull();
    bare.unmount();

    render(mount({ pathname: '/glossary', state: { from: '/queue?verdict=REFER' } }));
    expect(screen.getByRole('link', { name: '← Back to the queue' })).toHaveAttribute(
      'href',
      '/queue?verdict=REFER',
    );
  });

  it('states its source once, at the bottom, and never as a lead paragraph', () => {
    apiState = ready(glossary);
    render(mount());
    const source = screen.getByText(/Source: Federato’s glossary/);
    expect(source).toBeInTheDocument();
    const heading = screen.getByRole('heading', { level: 1, name: 'Glossary' });
    expect(heading.compareDocumentPosition(source) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows a skeleton while loading and a retry on error', () => {
    apiState = { data: null, loading: true, error: null, reload };
    const { unmount } = render(mount());
    expect(screen.getByRole('status', { name: 'Loading the glossary' })).toBeInTheDocument();
    unmount();

    apiState = { data: null, loading: false, error: new Error('offline'), reload };
    render(mount());
    expect(screen.getByRole('alert')).toHaveTextContent('The glossary could not be loaded: offline');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
