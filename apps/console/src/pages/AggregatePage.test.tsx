import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AggregateResponse } from '../api/client.js';
import type { AsyncState } from '../api/useApi.js';
import type { QueueRowView } from '../panels/types.js';

let apiState: AsyncState<AggregateResponse>;

vi.mock('../api/useApi.js', () => ({
  useApi: () => apiState,
  useApiClient: () => {
    throw new Error('not used');
  },
}));

import { AggregatePage } from './AggregatePage.js';

function flipRow(id: string, over: Partial<QueueRowView> = {}): QueueRowView {
  return {
    submissionId: id, rank: 4, qualityIndex: 70, verdict: 'DOES_NOT_FIT', insuredName: `Insured ${id}`,
    lineOfBusiness: 'commercial_property', primaryState: 'OH', appetiteScore: 75, quotedPremium: 150000,
    predictedPremium: 160000, adequacy: 0.9375, completeness: 100, contradictionCount: 0, oneFlipFromFit: true,
    assignedUnderwriter: null, pendingAction: null, explanationLine: 'Queue explanation sentence.', outOfAppetiteLine: false,
    ...over,
  };
}

/** The pre-C14 shape: no counts, no labels, no adequacy detail, no flip moves. */
const BASE: AggregateResponse = {
  countsByVerdict: { FIT: 5, REFER: 20, DOES_NOT_FIT: 13 },
  scoreHistogram: [0, 0, 1, 2, 3, 4, 5, 6, 7, 10].map((count, i) => ({ bucket: `${i * 10}`, count })),
  topKnockoutFactors: [{ factorId: 'total_premium', count: 4 }],
  oneFlipAway: [flipRow('c')],
  bookAdequacy: 0.97,
  verification: {},
};

/** The C14 shape, straight from AggregateDto. */
const RICH: AggregateResponse = {
  ...BASE,
  counts: { total: 41, scored: 38, knockedOut: 13, byLine: { commercial_property: 41 } },
  topKnockoutFactors: [{ factorId: 'total_premium', label: 'Total premium (guide label)', count: 4 }],
  bookAdequacyDetail: { median: 0.97, underpricedCount: 9, n: 27 },
  oneFlipMoves: { c: { moveLabel: 'Raise TIV to $150,000,000', scoreAfter: 84, premiumAfter: 205000 } },
};

function mount(data: AggregateResponse) {
  apiState = { data, loading: false, error: null, reload: vi.fn() } as AsyncState<AggregateResponse>;
  return render(<MemoryRouter><AggregatePage /></MemoryRouter>);
}

function tileValue(testId: string): string {
  return within(screen.getByTestId(testId)).getByRole('definition').textContent ?? '';
}

afterEach(cleanup);

describe('AggregatePage with the C14 fields', () => {
  it('shows the engine counts, not a console sum', () => {
    mount(RICH);
    expect(tileValue('tile-total')).toContain('38');
    expect(tileValue('tile-total')).toContain('41 ingested');
    expect(tileValue('tile-total')).toContain('13 knocked out');
  });

  it('book adequacy shows the median and the underpriced count the API returned', () => {
    mount(RICH);
    expect(tileValue('tile-adequacy')).toContain('97%');
    expect(screen.getByTestId('adequacy-underpriced').textContent).toBe('9 of 27 priced submissions quoted below predicted premium.');
  });

  it('labels knockout factors with the API label', () => {
    mount(RICH);
    expect(screen.getAllByText('Total premium (guide label)').length).toBeGreaterThan(0);
  });

  it('one-flip list shows the specific move, score after and premium after', () => {
    mount(RICH);
    const cells = within(screen.getByTestId('flip-c')).getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toContain('Raise TIV to $150,000,000');
    expect(cells).toContain('84');
    expect(cells).toContain('$205,000');
    expect(cells).not.toContain('Queue explanation sentence.');
  });
});

describe('AggregatePage without the C14 fields (fallback)', () => {
  it('falls back to the verdict sum, titleCase labels, median only and the queue explanation', () => {
    mount(BASE);
    expect(tileValue('tile-total')).toContain('38');
    expect(tileValue('tile-total')).not.toContain('ingested');
    expect(tileValue('tile-adequacy')).toContain('97%');
    expect(screen.queryByTestId('adequacy-underpriced')).toBeNull();
    expect(screen.getAllByText('Total Premium').length).toBeGreaterThan(0);
    const cells = within(screen.getByTestId('flip-c')).getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toContain('Queue explanation sentence.');
    expect(cells).toContain('—');
  });
});
