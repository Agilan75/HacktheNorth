import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DataTable } from './DataTable';
import type { DataTableColumn } from './DataTable';

interface Row {
  readonly id: string;
  readonly name: string;
  readonly score: number | null;
}

const rows: readonly Row[] = [
  { id: 'a', name: 'Beta Mills', score: 72 },
  { id: 'b', name: 'alpha Foods', score: null },
  { id: 'c', name: 'Gamma Co', score: 15 },
  { id: 'd', name: 'Delta 10', score: 72 },
];

const columns: readonly DataTableColumn<Row>[] = [
  { key: 'name', header: 'Insured', render: (r) => r.name, sortValue: (r) => r.name },
  { key: 'score', header: 'Score', align: 'right', render: (r) => (r.score === null ? '—' : String(r.score)), sortValue: (r) => r.score },
  { key: 'plain', header: 'Note', render: () => 'x', headerTitle: 'A note' },
];

function bodyNames(): string[] {
  const table = screen.getByRole('table');
  const bodyRows = within(table).getAllByRole('row').slice(1);
  return bodyRows.map((r) => within(r).getAllByRole('cell')[0]!.textContent ?? '');
}

afterEach(cleanup);

describe('DataTable', () => {
  it('renders the caption, headers and rows in incoming order', () => {
    render(<DataTable caption="Queue" columns={columns} rows={rows} rowKey={(r) => r.id} emptyLabel="Nothing" />);
    expect(screen.getByRole('table', { name: 'Queue' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')).toHaveLength(3);
    expect(bodyNames()).toEqual(['Beta Mills', 'alpha Foods', 'Gamma Co', 'Delta 10']);
    expect(screen.getByRole('columnheader', { name: 'Note' })).toHaveAttribute('title', 'A note');
    expect(screen.getByRole('columnheader', { name: 'Note' })).not.toHaveAttribute('aria-sort');
    expect(screen.getAllByRole('cell')[1]).toHaveStyle({ textAlign: 'right' });
  });

  it('cycles numeric sort asc → desc → none, nulls last, stable on ties', () => {
    render(<DataTable caption="Queue" columns={columns} rows={rows} rowKey={(r) => r.id} emptyLabel="Nothing" />);
    const header = screen.getByRole('columnheader', { name: /Score/ });
    const button = within(header).getByRole('button');
    expect(header).toHaveAttribute('aria-sort', 'none');

    fireEvent.click(button);
    expect(header).toHaveAttribute('aria-sort', 'ascending');
    expect(bodyNames()).toEqual(['Gamma Co', 'Beta Mills', 'Delta 10', 'alpha Foods']);

    fireEvent.click(button);
    expect(header).toHaveAttribute('aria-sort', 'descending');
    expect(bodyNames()).toEqual(['Beta Mills', 'Delta 10', 'Gamma Co', 'alpha Foods']);

    fireEvent.click(button);
    expect(header).toHaveAttribute('aria-sort', 'none');
    expect(bodyNames()).toEqual(['Beta Mills', 'alpha Foods', 'Gamma Co', 'Delta 10']);
  });

  it('sorts strings case-insensitively and resets when switching column', () => {
    render(<DataTable caption="Queue" columns={columns} rows={rows} rowKey={(r) => r.id} emptyLabel="Nothing" />);
    fireEvent.click(within(screen.getByRole('columnheader', { name: /Score/ })).getByRole('button'));
    fireEvent.click(within(screen.getByRole('columnheader', { name: /Insured/ })).getByRole('button'));
    expect(screen.getByRole('columnheader', { name: /Score/ })).toHaveAttribute('aria-sort', 'none');
    expect(bodyNames()).toEqual(['alpha Foods', 'Beta Mills', 'Delta 10', 'Gamma Co']);
  });

  it('shows the empty label spanning every column', () => {
    render(<DataTable caption="Queue" columns={columns} rows={[]} rowKey={(r) => r.id} emptyLabel="No submissions match." />);
    const cell = screen.getByRole('cell', { name: 'No submissions match.' });
    expect(cell).toHaveAttribute('colspan', '3');
  });

  it('renders five skeleton rows and aria-busy while loading, hiding real rows', () => {
    render(<DataTable caption="Queue" columns={columns} rows={rows} rowKey={(r) => r.id} emptyLabel="Nothing" loading />);
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getAllByTestId('datatable-skeleton-row')).toHaveLength(5);
    expect(screen.queryByText('Beta Mills')).not.toBeInTheDocument();
    expect(screen.queryByText('Nothing')).not.toBeInTheDocument();
  });

  it('activates rows by click, Enter and Space when onRowClick is set', () => {
    const onRowClick = vi.fn();
    render(<DataTable caption="Queue" columns={columns} rows={rows} rowKey={(r) => r.id} emptyLabel="Nothing" onRowClick={onRowClick} />);
    const row = screen.getByText('Gamma Co').closest('tr')!;
    expect(row).toHaveAttribute('tabindex', '0');
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: ' ' });
    fireEvent.keyDown(row, { key: 'a' });
    expect(onRowClick).toHaveBeenCalledTimes(3);
    expect(onRowClick).toHaveBeenCalledWith(rows[2]);
  });

  it('rows are not focusable without onRowClick', () => {
    render(<DataTable caption="Queue" columns={columns} rows={rows} rowKey={(r) => r.id} emptyLabel="Nothing" />);
    expect(screen.getByText('Gamma Co').closest('tr')).not.toHaveAttribute('tabindex');
  });
});
