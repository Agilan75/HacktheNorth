import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RulesResponse } from '../api/client.js';
import type { AsyncState } from '../api/useApi.js';

let apiState: AsyncState<RulesResponse>;
const reload = vi.fn();

vi.mock('../api/useApi.js', () => ({
  useApi: () => apiState,
  useApiClient: () => {
    throw new Error('not used');
  },
}));

// The tooltip has its own test; here it only needs to render its children.
vi.mock('../components/Tooltip.js', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

const { RulesPage } = await import('./RulesPage');

const citation = (section: string, quote: string) => ({ doc: 'APPETITE_GUIDELINES.pdf', section, quote });

/* Shapes and values copied from packages/engine/rules/*.json (commercial weights: tiv 0.2, submission_type 0.1). */
const rulebooks: readonly unknown[] = [
  {
    id: 'commercial',
    label: 'Commercial property appetite',
    version: '1.0.0',
    isExtension: false,
    rules: [
      {
        id: 'AG-TIV-T',
        lineOfBusiness: 'commercial_property',
        factor: 'tiv',
        tier: 'target',
        when: [
          { field: 'tiv', op: 'gte', value: 50000000 },
          { field: 'tiv', op: 'lte', value: 100000000 },
        ],
        weight: 0.2,
        citation: citation('p2 "TIV"', '$50M–$100M'),
      },
      {
        id: 'AG-TIV-N',
        lineOfBusiness: 'commercial_property',
        factor: 'tiv',
        tier: 'not_acceptable',
        when: [{ field: 'tiv', op: 'gt', value: 150000000 }],
        weight: 0.2,
        citation: citation('p2 "TIV"', 'Over $150M'),
      },
      {
        id: 'AG-ST-A',
        lineOfBusiness: 'commercial_property',
        factor: 'submission_type',
        tier: 'acceptable',
        when: [{ field: 'isNewBusiness', op: 'eq', value: 1 }],
        weight: 0.1,
        citation: citation('p2 "Submission type"', 'New business'),
        interpretation: 'Target column is blank, so Acceptable scores 1 (INTERPRETATIONS T-BLANK).',
      },
      { id: 'BROKEN', factor: 'tiv' },
    ],
  },
  {
    id: 'extensions',
    label: 'Extensions',
    version: '1.0.0',
    isExtension: true,
    rules: [
      {
        id: 'X-SPRINKLER-MAJORITY',
        lineOfBusiness: 'commercial_property',
        factor: 'sprinkler_protection',
        tier: 'target',
        when: [{ field: 'pctTivSprinklered', op: 'gte', value: 0.5 }],
        citation: { doc: 'Retrofit extension rules', section: 'Sprinkler protection', quote: 'At least 50% of TIV sprinklered.' },
        ratingFactor: 'sprinkler.sprinklered',
        extension: true,
      },
    ],
  },
];

function ready(): AsyncState<RulesResponse> {
  return { data: { rulebooks }, loading: false, error: null, reload };
}

afterEach(cleanup);

describe('RulesPage', () => {
  it('groups appetite rules by factor in PRD 6.6 order with weight, citation and interpretation', () => {
    apiState = ready();
    render(<RulesPage />);
    const book = screen.getByRole('region', { name: 'Commercial property appetite' });
    expect(within(book).getByText('v1.0.0 · 3 rules')).toBeInTheDocument();

    const factors = within(book).getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    // submission_type precedes tiv in the appetite table even though tiv appears first in the file.
    expect(factors).toEqual(['Submission TypeWeight 10%1 rule', 'TivWeight 20%2 rules']);

    const st = within(book).getByRole('listitem', { name: 'Rule AG-ST-A' });
    expect(within(st).getByText('Acceptable')).toBeInTheDocument();
    expect(within(st).getByText('isNewBusiness = 1')).toBeInTheDocument();
    expect(within(st).getByText('10%')).toBeInTheDocument();
    expect(within(st).getByText('“New business”')).toBeInTheDocument();
    expect(within(st).getByText('APPETITE_GUIDELINES.pdf · p2 "Submission type"')).toBeInTheDocument();
    expect(st).toHaveTextContent('Interpretation: Target column is blank, so Acceptable scores 1');

    const tiv = within(book).getByRole('listitem', { name: 'Rule AG-TIV-T' });
    expect(within(tiv).getByText('tiv ≥ 50000000 AND tiv ≤ 100000000')).toBeInTheDocument();
    expect(within(tiv).getByText('20%')).toBeInTheDocument();
    expect(within(book).getByRole('listitem', { name: 'Rule AG-TIV-N' })).toHaveTextContent('Not acceptable');

    // A malformed rule is dropped rather than crashing the page.
    expect(screen.queryByRole('listitem', { name: 'Rule BROKEN' })).toBeNull();
  });

  it('puts extension rules in a separate, labelled group with no weight', () => {
    apiState = ready();
    render(<RulesPage />);
    const ext = screen.getByRole('region', { name: 'Retrofit extension rules (ours, not Federato’s)' });
    expect(ext).toHaveTextContent('they never touch the appetite score');
    const rule = within(ext).getByRole('listitem', { name: 'Rule X-SPRINKLER-MAJORITY' });
    expect(within(rule).getByText('Retrofit extension')).toBeInTheDocument();
    expect(within(rule).getByText('sprinkler.sprinklered')).toBeInTheDocument();
    expect(within(rule).queryByText('Weight')).toBeNull();

    const commercial = screen.getByRole('region', { name: 'Commercial property appetite' });
    expect(within(commercial).queryByRole('listitem', { name: 'Rule X-SPRINKLER-MAJORITY' })).toBeNull();
  });

  it('shows a skeleton while loading and a retry on error', () => {
    apiState = { data: null, loading: true, error: null, reload };
    const { unmount } = render(<RulesPage />);
    expect(screen.getByRole('status', { name: 'Loading the rulebooks' })).toBeInTheDocument();
    unmount();

    apiState = { data: null, loading: false, error: new Error('500'), reload };
    render(<RulesPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('The rulebooks could not be loaded: 500');
  });
});
