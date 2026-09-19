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
 * collapsed out-of-appetite group, the formatting of every cell, and navigation.
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

function LocationProbe(): ReactElement {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={['/queue']}>
      <Routes>
        <Route path="/queue" element={<QueuePage />} />
        <Route path="/submissions/:id" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
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
  });

  it('formats every PRD §10 column from the row, never recomputing', () => {
    renderPage();
    expect(cell('S1', 'rank')).toBe('1');
    expect(cell('S1', 'quality')).toBe('84.0');
    expect(cell('S1', 'verdict')).toBe('FIT');
    expect(cell('S1', 'insured')).toBe('Acme Holdings');
    expect(cell('S1', 'appetite')).toBe('84');
    expect(cell('S1', 'premium')).toBe('$88,000 vs $95,652');
    expect(cell('S1', 'adequacy')).toBe('92%');
    expect(cell('S1', 'completeness')).toBe('89%');
    expect(cell('S1', 'contradictions')).toBe('2');
    // A FIT row says so; a blank cell read as broken (queue diagnostics).
    expect(cell('S1', 'flip')).toBe('Not needed');
    expect(cell('S1', 'underwriter')).toBe('Unassigned');
    expect(cell('S1', 'pending')).toBe('Request Info');
    expect(cell('S1', 'explanation')).toBe('All eight factors in appetite.');
    // Missing numbers print an em dash, not 0.
    expect(cell('S2', 'premium')).toBe('— vs $10,000');
    expect(cell('S2', 'adequacy')).toBe('n/a');
    expect(cell('S2', 'flip')).toBe('1 flip from FIT');
    expect(cell('S2', 'pending')).toBe('None');
  });

  it('collapses the out-of-appetite group by default and expands it on click', () => {
    renderPage();
    const toggle = screen.getByRole('button', { name: 'Out of appetite: line of business (2)' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('table', { name: 'Out of appetite: line of business' })).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const outTable = screen.getByRole('table', { name: 'Out of appetite: line of business' });
    const ids = within(outTable)
      .getAllByRole('row')
      .map((tr) => tr.getAttribute('data-testid'))
      .filter((id): id is string => id !== null);
    expect(ids).toEqual(['row-X8', 'row-X9']);
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
