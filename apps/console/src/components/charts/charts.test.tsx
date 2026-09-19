import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AggregateResponse } from '../../api/client.js';
import type { AsyncState } from '../../api/useApi.js';
import type { QueueRowView } from '../../panels/types.js';
import { ADEQUACY_GEOMETRY, AdequacyScale, adequacyReading, adequacyX } from './AdequacyScale.js';
import { BAR_LIST_GEOMETRY, BarList, barWidth } from './BarList.js';
import { HISTOGRAM_GEOMETRY, Histogram, columnHeight } from './Histogram.js';

let apiState: AsyncState<AggregateResponse>;
const reload = vi.fn();

vi.mock('../../api/useApi.js', () => ({
  useApi: () => apiState,
  useApiClient: () => {
    throw new Error('not used');
  },
}));

// Imported after the mock is registered (vi.mock is hoisted).
const { AggregatePage } = await import('../../pages/AggregatePage.js');

afterEach(() => cleanup());

function num(el: Element, attr: string): number {
  return Number(el.getAttribute(attr));
}

describe('barWidth / columnHeight / adequacyX', () => {
  it('scales linearly against the max and is zero when the max is zero', () => {
    expect(barWidth(5, 10, 300)).toBe(150);
    expect(barWidth(10, 10, 300)).toBe(300);
    expect(barWidth(3, 0, 300)).toBe(0);
    expect(barWidth(-2, 10, 300)).toBe(0);
    expect(barWidth(Number.NaN, 10, 300)).toBe(0);
    expect(columnHeight(1, 4, 188)).toBe(47);
    expect(columnHeight(4, 4, 188)).toBe(188);
    expect(columnHeight(0, 0, 188)).toBe(0);
  });

  it('places adequacy on the 0–2 clamp of INTERPRETATIONS P-5', () => {
    const { padX, width } = ADEQUACY_GEOMETRY;
    const plot = width - 2 * padX;
    expect(adequacyX(0)).toBe(padX);
    expect(adequacyX(1)).toBe(padX + plot / 2);
    expect(adequacyX(2)).toBe(padX + plot);
    expect(adequacyX(0.5)).toBe(padX + plot / 4);
    // clamped both ends
    expect(adequacyX(3.7)).toBe(padX + plot);
    expect(adequacyX(-1)).toBe(padX);
    expect(adequacyReading(0.92)).toBe('Quoted below predicted');
    expect(adequacyReading(1)).toBe('Quoted at predicted');
    expect(adequacyReading(1.3)).toBe('Quoted above predicted');
    expect(adequacyReading(null)).toBe('No priced submissions yet');
  });
});

describe('BarList', () => {
  it('draws bars proportional to count and prints every count as text', () => {
    render(
      <BarList
        title="Demo"
        items={[
          { key: 'a', label: 'Alpha', count: 8 },
          { key: 'b', label: 'Beta', count: 2 },
          { key: 'c', label: 'Gamma', count: 0 },
        ]}
      />,
    );
    const plot = BAR_LIST_GEOMETRY.width - BAR_LIST_GEOMETRY.labelWidth - BAR_LIST_GEOMETRY.countWidth;
    const a = screen.getByTestId('bar-a').querySelector('[data-role="bar"]');
    const b = screen.getByTestId('bar-b').querySelector('[data-role="bar"]');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(num(a!, 'width')).toBeCloseTo(plot - 1, 6);
    // 2/8 of the plot, minus the 1-unit stroke inset
    expect(num(b!, 'width')).toBeCloseTo(plot / 4 - 1, 6);
    expect(screen.getByTestId('bar-c').querySelector('[data-role="bar"]')).toBeNull();
    expect(screen.getByRole('img').textContent).toContain('Demo. Alpha: 8, Beta: 2, Gamma: 0.');
    const table = screen.getByRole('table');
    expect(within(table).getByRole('rowheader', { name: 'Beta' }).nextSibling?.textContent).toBe('2');
  });

  it('shows the empty label with no items', () => {
    render(<BarList title="Demo" items={[]} emptyLabel="Nothing here" />);
    expect(screen.getByText('Nothing here')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('Histogram', () => {
  it('draws ten columns with heights proportional to the tallest', () => {
    const counts = [0, 0, 1, 2, 4, 3, 0, 0, 0, 0];
    render(
      <Histogram
        title="Scores"
        buckets={counts.map((c, i) => ({ label: `${i * 10}`, count: c }))}
        xLabel="Score"
      />,
    );
    const g = HISTOGRAM_GEOMETRY;
    const plotHeight = g.height - g.padTop - g.padBottom;
    const col = (i: number) => screen.getByTestId(`column-${i}`).querySelector('[data-role="column"]');
    expect(col(0)).toBeNull();
    expect(num(col(4)!, 'height')).toBe(plotHeight);
    expect(num(col(3)!, 'height')).toBe(plotHeight / 2);
    expect(num(col(2)!, 'height')).toBe(plotHeight / 4);
    // column bottom sits on the baseline
    expect(num(col(5)!, 'y') + num(col(5)!, 'height')).toBe(g.padTop + plotHeight);
    expect(screen.getAllByTestId(/^column-/)).toHaveLength(10);
  });

  it('shows the empty label when every bucket is zero', () => {
    render(<Histogram title="Scores" buckets={[{ label: '0', count: 0 }]} emptyLabel="No scores" />);
    expect(screen.getByText('No scores')).toBeTruthy();
  });
});

describe('AdequacyScale', () => {
  it('puts the marker at the median and prints it', () => {
    render(<AdequacyScale median={0.92} />);
    const marker = screen.getByTestId('adequacy-marker');
    expect(num(marker, 'data-x')).toBeCloseTo(adequacyX(0.92), 9);
    expect(marker.textContent).toBe('92%');
    expect(screen.getByRole('img').textContent).toContain('92%. Quoted below predicted.');
  });

  it('draws no marker when the median is unknown', () => {
    render(<AdequacyScale median={null} />);
    expect(screen.queryByTestId('adequacy-marker')).toBeNull();
    expect(screen.getByRole("img").textContent).toContain("No priced submissions yet");
  });

  it('flags a median off the 0–200% scale', () => {
    render(<AdequacyScale median={2.5} />);
    expect(screen.getByTestId('adequacy-marker').textContent).toBe('250% (off scale)');
  });
});

/* -------------------------------------------------------------------------- */
/* AggregatePage                                                              */
/* -------------------------------------------------------------------------- */

function flipRow(id: string, name: string): QueueRowView {
  return {
    submissionId: id,
    rank: 3,
    qualityIndex: 70,
    verdict: 'REFER',
    insuredName: name,
    lineOfBusiness: 'commercial_property',
    primaryState: 'OH',
    appetiteScore: 81,
    quotedPremium: 175000,
    predictedPremium: 180000,
    adequacy: 0.97,
    completeness: 88.9,
    contradictionCount: 0,
    oneFlipFromFit: true,
    assignedUnderwriter: null,
    underwriterSource: null,
    synthetic: false,
    totalTiv: null,
    pendingAction: null,
    explanationLine: 'Confirm quoted premium',
    outOfAppetiteLine: false,
  };
}

const AGG: AggregateResponse = {
  countsByVerdict: { FIT: 3, REFER: 9, DOES_NOT_FIT: 28 },
  scoreHistogram: [0, 0, 1, 2, 4, 6, 10, 9, 6, 2].map((count, i) => ({
    bucket: i === 9 ? '90–100' : `${i * 10}–${i * 10 + 9}`,
    count,
  })),
  topKnockoutFactors: [
    { factorId: 'building_age', count: 12 },
    { factorId: 'tiv', count: 6 },
  ],
  oneFlipAway: [flipRow('s-1', 'Acme Storage LLC')],
  bookAdequacy: 0.92,
  verification: {
    propertyCasesRun: 100000,
    differentialCasesRun: 10000000,
    disagreements: 0,
    llmCasesRun: 200,
    llmAgreementRate: 0.935,
    llmAgreementCi95: '0.9–0.96',
    extractionFieldAccuracy: 0.981,
    generatedAt: '2026-09-18T12:00:00.000Z',
  },
};

function renderPage() {
  return render(
    <MemoryRouter>
      <AggregatePage />
    </MemoryRouter>,
  );
}

describe('AggregatePage', () => {
  it('renders the headline, charts, flip list and verification numbers', () => {
    apiState = { data: AGG, loading: false, error: null, reload };
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Aggregate' })).toBeTruthy();
    expect(screen.getByTestId('tile-total').textContent).toContain('40');
    // 3 of 40 = 7.5%
    expect(screen.getByTestId('tile-fit').textContent).toContain('7.5% of the book');
    expect(screen.getByTestId('tile-flip').textContent).toContain('1');
    expect(screen.getByTestId('tile-adequacy').textContent).toContain('92%');

    // Verdict bars: DOES_NOT_FIT is the max, FIT is 3/28 of it.
    expect(screen.getByTestId('bar-DOES_NOT_FIT').getAttribute('data-count')).toBe('28');
    expect(screen.getByTestId('bar-FIT').getAttribute('data-count')).toBe('3');
    expect(screen.getByTestId('bar-REFER').textContent).toContain('◐');

    // Knockout labels are title-cased factor ids.
    expect(screen.getByTestId('bar-building_age').textContent).toContain('Building Age');

    // 40 scored submissions across ten buckets
    expect(screen.getByText('40 scored submissions')).toBeTruthy();
    expect(screen.getAllByTestId(/^column-/)).toHaveLength(10);

    const flip = screen.getByTestId('flip-s-1');
    expect(within(flip).getByRole('link', { name: 'Open Acme Storage LLC' }).getAttribute('href')).toBe('/submissions/s-1');
    expect(flip.textContent).toContain('$180,000');
    expect(flip.textContent).toContain('Confirm quoted premium');

    expect(screen.getByTestId('verify-differentialCasesRun').textContent).toContain('10,000,000');
    expect(screen.getByTestId('verify-disagreements').textContent).toContain('0');
    expect(screen.getByTestId('verify-llmAgreementRate').textContent).toContain('93.5%');
    expect(screen.getByTestId('verify-llmAgreementRate').textContent).toContain('95% CI 90.0%–96.0%');
    expect(screen.getByTestId('verify-extractionFieldAccuracy').textContent).toContain('98.1%');
  });

  it('says so when no verification run exists and nothing is one flip away', () => {
    apiState = {
      data: { ...AGG, verification: {}, oneFlipAway: [], topKnockoutFactors: [], bookAdequacy: null },
      loading: false,
      error: null,
      reload,
    };
    renderPage();
    expect(screen.getByTestId('verification-empty')).toBeTruthy();
    expect(screen.getByText('No submission is one change away from FIT.')).toBeTruthy();
    expect(screen.getByText('No knockouts in the book.')).toBeTruthy();
    expect(screen.getByTestId('tile-adequacy').textContent).toContain('—');
  });

  it('shows a skeleton while loading and a retry on error', () => {
    apiState = { data: null, loading: true, error: null, reload };
    const { unmount } = renderPage();
    expect(screen.getByRole('status', { name: 'Loading aggregate' })).toBeTruthy();
    unmount();

    apiState = { data: null, loading: false, error: new Error('boom'), reload };
    renderPage();
    expect(screen.getByRole('alert').textContent).toContain('boom');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
