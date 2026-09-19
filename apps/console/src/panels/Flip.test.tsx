import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Flip } from './Flip.js';
import type { FlipView } from './types.js';

afterEach(cleanup);

/**
 * INTERPRETATIONS B2: tiv 150,000,000.01 is Not Acceptable (tier 0, score 75).
 * The flip moves TIV to exactly the inclusive boundary 150,000,000 (F-5), which
 * restores tier 0.6 and the B1 score 84.0, verdict FIT (F-6), distance 1 (V-9).
 */
const B2_FLIP: FlipView = {
  available: true,
  reason: null,
  moves: [
    {
      componentKey: 'totalTiv',
      label: 'Total insured value',
      from: 150000000.01,
      to: 150000000,
      humanText: 'Reduce scheduled TIV to $150,000,000.',
    },
  ],
  scoreBefore: 75,
  scoreAfter: 84,
  premiumBefore: 205000,
  premiumAfter: 205000,
  verdictAfter: 'FIT',
  distanceToAppetite: 1,
};

describe('Flip', () => {
  it('B2: shows the one move with exact endpoints, score 75.0 → 84.0, premium and FIT', () => {
    render(<Flip flip={B2_FLIP} />);
    const moves = screen.getAllByTestId('flip-move');
    expect(moves).toHaveLength(1);
    const move = moves[0]!;
    expect(within(move).getByText('Reduce scheduled TIV to $150,000,000.')).toBeInTheDocument();
    expect(within(move).getByTestId('flip-move-from')).toHaveTextContent('$150,000,000.01');
    expect(within(move).getByTestId('flip-move-to')).toHaveTextContent('$150,000,000');
    expect(within(move).getByTestId('flip-move-to')).not.toHaveTextContent('.01');

    const score = screen.getByTestId('flip-score');
    expect(score).toHaveTextContent('75.0');
    expect(score).toHaveTextContent('84.0');
    const premium = screen.getByTestId('flip-premium');
    expect(premium).toHaveTextContent('$205,000');
    expect(screen.getByTestId('flip-verdict-after').querySelector('[data-verdict="FIT"]')).not.toBeNull();
    expect(screen.getByText('1 move from FIT')).toBeInTheDocument();
  });

  it('two-move flip reads "2 moves from FIT" and lists both moves in order', () => {
    const flip: FlipView = {
      ...B2_FLIP,
      moves: [
        B2_FLIP.moves[0]!,
        {
          componentKey: 'quotedPremium',
          label: 'Quoted total premium',
          from: 190000,
          to: 175000,
          humanText: 'Bring the quoted premium to $175,000.',
        },
      ],
      premiumBefore: 190000,
      premiumAfter: 175000,
      distanceToAppetite: 2,
    };
    render(<Flip flip={flip} />);
    const moves = screen.getAllByTestId('flip-move');
    expect(moves).toHaveLength(2);
    expect(within(moves[1]!).getByTestId('flip-move-to')).toHaveTextContent('$175,000');
    expect(screen.getByText('2 moves from FIT')).toBeInTheDocument();
    expect(screen.getByTestId('flip-premium')).toHaveTextContent('$190,000');
    expect(screen.getByTestId('flip-premium')).toHaveTextContent('$175,000');
  });

  it('F-3: an immovable-only failure shows the reason and no moves', () => {
    render(
      <Flip
        flip={{
          available: false,
          reason: 'The failing component (pctTivPre1990) is immovable.',
          moves: [],
          scoreBefore: 84,
          scoreAfter: null,
          premiumBefore: 190000,
          premiumAfter: null,
          verdictAfter: null,
          distanceToAppetite: null,
        }}
      />,
    );
    expect(screen.queryAllByTestId('flip-move')).toHaveLength(0);
    expect(screen.getByTestId('flip-reason')).toHaveTextContent('pctTivPre1990');
    expect(screen.getByText('No flip')).toBeInTheDocument();
    expect(screen.getByTestId('flip-score-before')).toHaveTextContent('84.0');
    expect(screen.getByTestId('flip-premium-before')).toHaveTextContent('$190,000');
  });

  it('V-9: a FIT account has distance 0 and says no flip is needed', () => {
    render(
      <Flip
        flip={{
          available: false,
          reason: 'Already FIT.',
          moves: [],
          scoreBefore: 84,
          scoreAfter: null,
          premiumBefore: 160000,
          premiumAfter: null,
          verdictAfter: null,
          distanceToAppetite: 0,
        }}
      />,
    );
    expect(screen.getByText('In appetite')).toBeInTheDocument();
    expect(screen.getByText(/already in appetite/)).toBeInTheDocument();
  });

  it('R5-2: names the flip premium "Predicted premium", never "Quoted premium"', () => {
    const unavailable = render(
      <Flip
        flip={{
          available: false,
          reason: 'No flip.',
          moves: [],
          scoreBefore: 40,
          scoreAfter: null,
          premiumBefore: 63835,
          premiumAfter: null,
          verdictAfter: null,
          distanceToAppetite: null,
        }}
      />,
    );
    const before = screen.getByTestId('flip-premium-before');
    expect(before).toHaveTextContent('Predicted premium');
    expect(before).toHaveTextContent('$63,835');
    expect(screen.queryByText(/Quoted premium/)).toBeNull();
    unavailable.unmount();

    render(<Flip flip={B2_FLIP} />);
    expect(screen.getByTestId('flip-premium')).toHaveTextContent('Predicted premium');
    expect(screen.queryByText(/Quoted premium/)).toBeNull();
  });
});
