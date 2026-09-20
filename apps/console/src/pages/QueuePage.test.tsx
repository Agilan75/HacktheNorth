import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AsyncState } from '../api/useApi.js';
import type { DataTableProps } from '../components/DataTable.js';
import type { FiltersProps } from '../components/Filters.js';
import type { QueueRowView } from '../panels/types.js';

/*
 * The collaborators (C01 useApi, C02 atoms, C03 DataTable/Filters) are built in
 * parallel, so they are replaced with minimal stand-ins that honour their frozen
 * signatures. What is under test is QueuePage's own logic: order, filtering, the
 * collapsed out-of-appetite group, the formatting of every cell, the URL round
 * trip, and navigation.
 */

let apiState: AsyncState<readonly QueueRowView[]>;
const reload = vi.fn();
let lastFilters: FiltersProps | null = null;

vi.mock('../api/useApi.js', () => ({
  useApi: () => apiState,
  useApiClient: () => {
    throw new Error('not used');
  },
}));

vi.mock('../components/atoms/VerdictPill.js', () => ({
  VerdictPill: ({ verdict }: { verdict: string }) => <span data-pill>{verdict}</span>,
}));

vi.mock('../components/atoms/Badge.js', () => ({
  Badge: ({ label }: { label: string }) => <span data-badge>{label}</span>,
}));

vi.mock('../components/Filters.js', () => ({
  Filters: (props: FiltersProps) => {
    lastFilters = props;
    return <div data-testid="filters" />;
  },
}));

vi.mock('../components/DataTable.js', () => ({
  DataTable: <Row,>(props: DataTableProps<Row>) => (
    <table>
      <caption>{props.caption}</caption>
      <thead>
        <tr>
          {props.columns.map((c) => (
            <th key={c.key}>{c.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {props.loading === true ? (
          <tr>
            <td>loading</td>
          </tr>
        ) : props.rows.length === 0 ? (
          <tr>
            <td>{props.emptyLabel}</td>
          </tr>
        ) : (
          props.rows.map((r) => (
            <tr
              key={props.rowKey(r)}
              data-testid={`row-${props.rowKey(r)}`}
              onClick={() => props.onRowClick?.(r)}
            >
              {props.columns.map((c) => (
                <td key={c.key} data-col={c.key}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  ),
}));

const { QueuePage } = await import('./QueuePage.js');

function row(overrides: Partial<QueueRowView> & Pick<QueueRowView, 'submissionId' | 'rank'>): QueueRowView {
  return {
    qualityIndex: 70,
    verdict: 'REFER',
    insuredName: `Insured ${overrides.submissionId}`,
    lineOfBusiness: 'property',
    primaryState: 'CA',
    appetiteScore: 60,
    quotedPremium: 10_000,
    predictedPremium: 10_000,
    adequacy: 1,
    completeness: 80,
    contradictionCount: 0,
    oneFlipFromFit: false,
    assignedUnderwriter: 'Ada',
    underwriterSource: 'routed',
    synthetic: false,
    totalTiv: null,
    pendingAction: null,
    explanationLine: 'Line.',
    outOfAppetiteLine: false,
    ...overrides,
  };
}

// Deliberately out of order: the page must restore the API's rank order.
const ROWS: readonly QueueRowView[] = [
  row({ submissionId: 'S3', rank: 3, verdict: 'DOES_NOT_FIT', primaryState: 'TX', assignedUnderwriter: 'Bo' }),
  row({
    submissionId: 'S1',
    rank: 1,
    qualityIndex: 83.96,
    verdict: 'FIT',
    insuredName: 'Acme Holdings',
    appetiteScore: 84,
    quotedPremium: 88_000,
    predictedPremium: 95_652,
    adequacy: 0.92,
    completeness: 88.9,
    contradictionCount: 2,
    assignedUnderwriter: null,
    pendingAction: 'request_info',
    explanationLine: 'All eight factors in appetite.',
  }),
  row({ submissionId: 'S2', rank: 2, oneFlipFromFit: true, quotedPremium: null, adequacy: null }),
  row({ submissionId: 'X9', rank: 9, lineOfBusiness: 'cyber', verdict: 'DOES_NOT_FIT', outOfAppetiteLine: true }),
  row({ submissionId: 'X8', rank: 8, lineOfBusiness: 'auto', verdict: 'DOES_NOT_FIT', outOfAppetiteLine: true }),
];

function PathProbe(): ReactElement {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function UrlProbe(): ReactElement {
  const location = useLocation();
  return <div data-testid="url">{`${location.pathname}${location.search}`}</div>;
}

function renderPage(entry = '/queue'): void {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <UrlProbe />
      <Routes>
        <Route path="/queue" element={<QueuePage />} />
        <Route path="/submissions/:id" element={<PathProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

function url(): string {
  return screen.getByTestId('url').textContent ?? '';
}

function mainRowIds(): string[] {
  const table = screen.getByRole('table', { name: 'Ranked submissions, best first' });
  return within(table)
    .queryAllByRole('row')
    .map((tr) => tr.getAttribute('data-testid'))
    .filter((id): id is string => id !== null)
    .map((id) => id.replace('row-', ''));
}

function cell(id: string, col: string): string {
  const tr = screen.getByTestId(`row-${id}`);
  const td = tr.querySelector(`[data-col="${col}"]`);
  return td?.textContent ?? '';
}

beforeEach(() => {
  apiState = { data: ROWS, loading: false, error: null, reload };
  lastFilters = null;
  reload.mockClear();
});

afterEach(() => cleanup());

describe('QueuePage', () => {
  it('renders in-appetite rows in API rank order and keeps non-property rows out of the main table', () => {
    renderPage();
    expect(mainRowIds()).toEqual(['S1', 'S2', 'S3']);
    expect(screen.queryByTestId('row-X8')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('5 submissions');
    // A clean /queue URL stays clean: nothing is at a non-default value.
    expect(url()).toBe('/queue');
  });

  it('pairs the numbers into promoted and demoted columns without dropping one', () => {
    renderPage();
    expect(cell('S1', 'rank')).toBe('1');
    expect(cell('S1', 'insured')).toBe('Acme HoldingsS1 · Property');
    expect(cell('S1', 'verdict')).toBe('FIT');
    // Appetite carries completeness; premium carries adequacy.
    expect(cell('S1', 'appetite')).toBe('8489% complete');
    expect(cell('S1', 'quality')).toBe('84.0');
    expect(cell('S1', 'premium')).toBe('$88,000 vs $95,65292% adequacy');
    expect(cell('S1', 'contradictions')).toBe('2 contradictions');
    expect(cell('S1', 'underwriter')).toBe('UnassignedRequest Info');
    expect(cell('S1', 'explanation')).toBe('All eight factors in appetite.');

    expect(cell('S2', 'premium')).toContain('— vs $10,000');
    // No contradictions is one muted em dash, not a counted zero.
    expect(cell('S2', 'contradictions')).toBe('—1 flip from FIT');
    // An absent pending action renders nothing at all.
    expect(cell('S2', 'underwriter')).toBe('Ada');
  });

  it('shows one em dash with a reason when a row has no premium at all', () => {
    apiState = {
      data: [row({ submissionId: 'S0', rank: 1, quotedPremium: null, predictedPremium: null, adequacy: null })],
      loading: false,
      error: null,
      reload,
    };
    renderPage();
    const td = screen.getByTestId('row-S0').querySelector('[data-col="premium"]');
    expect(td?.textContent).toBe('—');
    expect(td?.querySelector('[title]')?.getAttribute('title')).toBe('No quoted or predicted premium');
  });

  it('never quotes a spec section in a column header', () => {
    renderPage();
    const table = screen.getByRole('table', { name: 'Ranked submissions, best first' });
    for (const th of within(table).getAllByRole('columnheader')) {
      expect(th.textContent ?? '').not.toMatch(/PRD|§/);
    }
  });

  it('collapses the out-of-appetite group by default, expands it, and round-trips through the URL', () => {
    renderPage();
    const toggle = screen.getByRole('button', { name: 'Out of appetite: line of business (2)' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('table', { name: 'Out of appetite: line of business' })).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(url()).toBe('/queue?out=1');
    const outTable = screen.getByRole('table', { name: 'Out of appetite: line of business' });
    const ids = within(outTable)
      .getAllByRole('row')
      .map((tr) => tr.getAttribute('data-testid'))
      .filter((id): id is string => id !== null);
    expect(ids).toEqual(['row-X8', 'row-X9']);
    // A secondary listing: four columns, not the main table's nine.
    const headers = within(outTable)
      .getAllByRole('columnheader')
      .map((th) => th.textContent);
    expect(headers).toEqual(['ID', 'Insured', 'Line of business', 'Deciding rule']);

    cleanup();
    renderPage('/queue?out=1');
    expect(
      screen.getByRole('button', { name: 'Out of appetite: line of business (2)' }).getAttribute('aria-expanded'),
    ).toBe('true');
    expect(screen.getByRole('table', { name: 'Out of appetite: line of business' })).toBeTruthy();
  });

  it('derives filter options from the data', () => {
    renderPage();
    expect(lastFilters?.options).toEqual({
      lines: ['auto', 'cyber', 'property'],
      states: ['CA', 'TX'],
      underwriters: ['Ada', 'Bo'],
    });
  });

  it('filters by verdict, state, underwriter, line and search', () => {
    renderPage();
    const base = lastFilters!.value;

    act(() => lastFilters!.onChange({ ...base, verdict: 'FIT' }));
    expect(mainRowIds()).toEqual(['S1']);
    expect(screen.queryByRole('button', { name: /Out of appetite/ })).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Showing 1 of 5 submissions');

    act(() => lastFilters!.onChange({ ...base, state: 'TX' }));
    expect(mainRowIds()).toEqual(['S3']);

    act(() => lastFilters!.onChange({ ...base, underwriter: 'Ada' }));
    expect(mainRowIds()).toEqual(['S2']);

    act(() => lastFilters!.onChange({ ...base, line: 'cyber' }));
    expect(mainRowIds()).toEqual([]);
    expect(screen.getByText('No submissions match these filters.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Out of appetite: line of business (1)' })).toBeTruthy();

    act(() => lastFilters!.onChange({ ...base, search: '  acme ' }));
    expect(mainRowIds()).toEqual(['S1']);

    act(() => lastFilters!.onChange({ ...base }));
    expect(mainRowIds()).toEqual(['S1', 'S2', 'S3']);
    expect(screen.getByRole('status').textContent).toBe('5 submissions');
  });

  it('writes every filter to the URL and restores it from there', () => {
    renderPage();
    const base = lastFilters!.value;

    act(() => lastFilters!.onChange({ ...base, verdict: 'FIT', state: 'CA', search: 'acme' }));
    expect(url()).toBe('/queue?q=acme&verdict=FIT&state=CA');

    // Back to the defaults leaves no params behind.
    act(() => lastFilters!.onChange(base));
    expect(url()).toBe('/queue');

    cleanup();
    renderPage('/queue?verdict=FIT&uw=Ada');
    expect(lastFilters?.value).toEqual({
      line: null,
      verdict: 'FIT',
      state: null,
      underwriter: 'Ada',
      search: '',
    });
    expect(mainRowIds()).toEqual([]);
  });

  it('keeps the sort column and direction in the URL', () => {
    renderPage();
    expect(screen.getByLabelText('Sort by')).toHaveProperty('value', 'rank');

    fireEvent.click(screen.getByRole('button', { name: /Sort direction/ }));
    expect(url()).toBe('/queue?dir=desc');
    expect(mainRowIds()).toEqual(['S3', 'S2', 'S1']);

    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'insured' } });
    expect(url()).toBe('/queue?sort=insured&dir=desc');

    cleanup();
    renderPage('/queue?sort=rank&dir=desc');
    expect(mainRowIds()).toEqual(['S3', 'S2', 'S1']);
    expect(screen.getByRole('button', { name: 'Sort direction: descending' })).toBeTruthy();
  });

  it('cross-links the other views of the same rows', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'Aggregate' }).getAttribute('href')).toBe('/aggregate');
    expect(screen.getByRole('link', { name: 'Explore' }).getAttribute('href')).toBe('/explore');
  });

  it('navigates to the submission on row click', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('row-S2'));
    expect(screen.getByTestId('location').textContent).toBe('/submissions/S2');
  });

  it('shows loading, then an error with retry', () => {
    apiState = { data: null, loading: true, error: null, reload };
    renderPage();
    expect(screen.getByRole('status').textContent).toBe('Loading the queue…');
    expect(screen.getByText('loading')).toBeTruthy();
    cleanup();

    apiState = { data: null, loading: false, error: new Error('HTTP 503'), reload };
    renderPage();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('HTTP 503');
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
