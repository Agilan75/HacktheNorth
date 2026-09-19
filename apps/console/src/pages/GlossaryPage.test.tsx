import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

afterEach(cleanup);

describe('GlossaryPage', () => {
  it('lists every term alphabetically with definition, source and a stable anchor', () => {
    apiState = ready(glossary);
    render(<GlossaryPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Glossary' })).toBeInTheDocument();
    expect(terms()).toEqual(['Appetite', 'Carrier', 'In-Appetite', 'Premium']);
    expect(screen.getByRole('status')).toHaveTextContent('4 terms');
    const item = document.getElementById('glossary-in-appetite');
    expect(item).not.toBeNull();
    expect(within(item!).getByText('A submission inside the appetite.', { exact: false })).toBeInTheDocument();
    expect(within(item!).getByText('Federato glossary, p. 2')).toBeInTheDocument();
  });

  it('searches terms and definitions, ranking term matches first', () => {
    apiState = ready(glossary);
    render(<GlossaryPage />);
    const search = screen.getByLabelText('Search terms and definitions');

    fireEvent.change(search, { target: { value: 'premium' } });
    // "Premium" is a term match; "Carrier" only mentions premium in its definition.
    expect(terms()).toEqual(['Premium', 'Carrier']);
    expect(screen.getByRole('status')).toHaveTextContent('2 terms of 4 match “premium”');

    fireEvent.change(search, { target: { value: 'in appetite' } });
    expect(terms()[0]).toBe('In-Appetite');

    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(terms()).toEqual([]);
    expect(screen.getByText('No glossary term matches “zzz”.')).toBeInTheDocument();
  });

  it('shows a skeleton while loading and a retry on error', () => {
    apiState = { data: null, loading: true, error: null, reload };
    const { unmount } = render(<GlossaryPage />);
    expect(screen.getByRole('status', { name: 'Loading the glossary' })).toBeInTheDocument();
    unmount();

    apiState = { data: null, loading: false, error: new Error('offline'), reload };
    render(<GlossaryPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('The glossary could not be loaded: offline');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
