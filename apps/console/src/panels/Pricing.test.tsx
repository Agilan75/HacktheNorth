import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Pricing } from './Pricing.js';
import type { PricingView } from './types.js';

afterEach(cleanup);

const base: PricingView = {
  quotedPremium: 88000,
  predictedPremium: 104762,
  adequacy: 0.84,
  expectedLoss: 38250,
  ratePer100Tiv: 0.29,
  currency: 'USD',
  factors: [
    { label: 'Construction', multiplier: 0.92, basis: 'Masonry non-combustible' },
    { label: 'Building age', multiplier: 1.15, basis: '62% of TIV pre-1990' },
    { label: 'Sprinkler', multiplier: 1, basis: null },
  ],
  notes: ['Fitted on 27 policies; mean absolute error 11%.'],
};

describe('Pricing', () => {
  it('renders every headline number from the props, unchanged', () => {
    render(<Pricing pricing={base} />);
    expect(screen.getByTestId('pricing-quoted')).toHaveTextContent('$88,000');
    expect(screen.getByTestId('pricing-predicted')).toHaveTextContent('$104,762');
    expect(screen.getByTestId('pricing-adequacy')).toHaveTextContent('84%');
    expect(screen.getByTestId('pricing-adequacy')).toHaveTextContent('0.84 quoted ÷ predicted');
    expect(screen.getByTestId('pricing-expected-loss')).toHaveTextContent('$38,250');
    expect(screen.getByTestId('pricing-rate')).toHaveTextContent('$0.29');
  });

  it('flags adequacy under 0.9 as underpriced (PRD 6.7) in text, not colour alone', () => {
    render(<Pricing pricing={base} />);
    expect(screen.getByText('Underpriced for the risk')).toBeInTheDocument();
  });

  it('treats exactly 0.9 as adequate (strict "under 0.9")', () => {
    render(<Pricing pricing={{ ...base, adequacy: 0.9 }} />);
    expect(screen.getByText('Adequate for the risk')).toBeInTheDocument();
    expect(screen.queryByText('Underpriced for the risk')).toBeNull();
  });

  it('lists each factor with multiplier, direction and basis', () => {
    render(<Pricing pricing={base} />);
    const rows = screen.getAllByTestId('pricing-factor');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText('×0.92')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Lowers premium')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('×1.15')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Raises premium')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('62% of TIV pre-1990')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('×1.00')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('No effect')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Fitted on 27 policies; mean absolute error 11%.')).toBeInTheDocument();
  });

  it('shows dashes and no adequacy label when numbers are missing', () => {
    render(
      <Pricing
        pricing={{
          ...base,
          quotedPremium: null,
          predictedPremium: null,
          adequacy: null,
          expectedLoss: null,
          ratePer100Tiv: null,
          factors: [],
          notes: [],
        }}
      />,
    );
    expect(screen.getByTestId('pricing-quoted')).toHaveTextContent('—');
    expect(screen.getByTestId('pricing-adequacy')).toHaveTextContent('needs a quoted and a predicted premium');
    expect(screen.queryByText(/for the risk/)).toBeNull();
    expect(screen.getByText('No rating factors were applied to this account.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Pricing notes' })).toBeNull();
  });
});
