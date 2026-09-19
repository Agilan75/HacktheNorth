import { useMemo, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactElement, ReactNode } from 'react';

import { cssVar, MIN_TOUCH_TARGET, SPACE } from '@retrofit/design';

export interface DataTableColumn<Row> {
  readonly key: string;
  readonly header: string;
  readonly align?: 'left' | 'right';
  readonly render: (row: Row) => ReactNode;
  /** Optional sort key; when absent the column is not sortable. */
  readonly sortValue?: (row: Row) => string | number | null;
  readonly headerTitle?: string;
  /** Minimum width in px, so a text-heavy column is never crushed to one word per line. */
  readonly minWidth?: number;
  /** Clamp the cell to this many lines; the full text stays available on hover. */
  readonly clampLines?: number;
  /** Full text for the hover title when the cell is clamped. */
  readonly title?: (row: Row) => string;
}

export interface DataTableProps<Row> {
  /** Required: read by screen readers as the table's <caption>. */
  readonly caption: string;
  readonly columns: readonly DataTableColumn<Row>[];
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row) => string;
  readonly emptyLabel: string;
  readonly loading?: boolean;
  readonly onRowClick?: (row: Row) => void;
}

type SortDirection = 'asc' | 'desc';

interface SortState {
  readonly key: string;
  readonly direction: SortDirection;
}

/** Number of placeholder rows rendered while loading (PRD §13: skeletons for every list). */
const LOADING_ROWS = 5;

/** Visually hidden but read by screen readers (private; base.css belongs to C02). */
const srOnly: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontFamily: cssVar('font-body'),
  fontSize: cssVar('size-small'),
  lineHeight: cssVar('leading-small'),
  color: cssVar('ink'),
};

const captionStyle: CSSProperties = {
  textAlign: 'left',
  padding: `${SPACE.sm}px 0`,
  fontFamily: cssVar('font-display'),
  fontSize: cssVar('size-heading'),
  lineHeight: cssVar('leading-heading'),
};

const cellBase: CSSProperties = {
  padding: `${SPACE.sm}px ${SPACE.md}px`,
  borderBottom: `1px solid ${cssVar('muted-tint')}`,
  verticalAlign: 'top',
};

const headerCellBase: CSSProperties = {
  ...cellBase,
  fontWeight: 600,
  color: cssVar('muted-deep'),
  fontSize: cssVar('size-micro'),
  lineHeight: cssVar('leading-micro'),
  whiteSpace: 'nowrap',
};

const sortButtonStyle: CSSProperties = {
  minHeight: MIN_TOUCH_TARGET,
  padding: 0,
  border: 'none',
  background: 'none',
  font: 'inherit',
  color: 'inherit',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: SPACE.xs,
};

const skeletonBarStyle: CSSProperties = {
  display: 'block',
  height: SPACE.md,
  borderRadius: 999,
  background: cssVar('muted-tint'),
};

/** Nulls always sort last, regardless of direction. Numbers before strings. */
function compareSortValues(
  a: string | number | null,
  b: string | number | null,
  direction: SortDirection,
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  let result: number;
  if (typeof a === 'number' && typeof b === 'number') {
    result = a - b;
  } else if (typeof a === 'number') {
    result = -1;
  } else if (typeof b === 'number') {
    result = 1;
  } else {
    result = a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true });
  }
  return direction === 'asc' ? result : -result;
}

/** Click cycle on a column header: none → ascending → descending → none. */
function nextSort(current: SortState | null, key: string): SortState | null {
  if (current === null || current.key !== key) return { key, direction: 'asc' };
  if (current.direction === 'asc') return { key, direction: 'desc' };
  return null;
}

/**
 * Accessible data table shared by every console list (PRD §10, §13).
 *
 * - `caption` is always rendered as the table's <caption>.
 * - Sortable headers are real buttons with `aria-sort` on the <th>.
 * - Row activation works by click, Enter and Space when `onRowClick` is set.
 * - `loading` renders skeleton rows and marks the table `aria-busy`.
 */
export function DataTable<Row>(props: DataTableProps<Row>): ReactElement {
  const { caption, columns, rows, rowKey, emptyLabel, loading = false, onRowClick } = props;
  const [sort, setSort] = useState<SortState | null>(null);

  const sortedRows = useMemo<readonly Row[]>(() => {
    if (sort === null) return rows;
    const column = columns.find((c) => c.key === sort.key);
    const sortValue = column?.sortValue;
    if (!sortValue) return rows;
    // Stable: ties keep the incoming order.
    return rows
      .map((row, index) => ({ row, index, value: sortValue(row) }))
      .sort((a, b) => compareSortValues(a.value, b.value, sort.direction) || a.index - b.index)
      .map((entry) => entry.row);
  }, [rows, columns, sort]);

  const handleRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, row: Row): void => {
    if (!onRowClick) return;
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onRowClick(row);
    }
  };

  let body: ReactNode;
  if (loading) {
    body = Array.from({ length: LOADING_ROWS }, (_, i) => (
      <tr key={`loading-${i}`} data-testid="datatable-skeleton-row" aria-hidden="true">
        {columns.map((column) => (
          <td key={column.key} style={cellBase}>
            <span style={{ ...skeletonBarStyle, width: i % 2 === 0 ? '80%' : '60%' }} />
          </td>
        ))}
      </tr>
    ));
  } else if (sortedRows.length === 0) {
    body = (
      <tr>
        <td colSpan={Math.max(columns.length, 1)} style={{ ...cellBase, color: cssVar('muted-deep') }}>
          {emptyLabel}
        </td>
      </tr>
    );
  } else {
    body = sortedRows.map((row) => {
      const clickable = onRowClick !== undefined;
      return (
        <tr
          key={rowKey(row)}
          tabIndex={clickable ? 0 : undefined}
          onClick={clickable ? () => onRowClick(row) : undefined}
          onKeyDown={clickable ? (event) => handleRowKeyDown(event, row) : undefined}
          style={clickable ? { cursor: 'pointer' } : undefined}
          data-clickable={clickable ? 'true' : undefined}
        >
          {columns.map((column) => (
            <td
            key={column.key}
            style={{
              ...cellBase,
              textAlign: column.align ?? 'left',
              ...(column.minWidth !== undefined ? { minWidth: column.minWidth } : {}),
            }}
            title={column.title ? column.title(row) : undefined}
          >
              {column.clampLines !== undefined ? (
                <div
                  style={{
                    display: '-webkit-box',
                    WebkitBoxOrient: 'vertical',
                    WebkitLineClamp: column.clampLines,
                    overflow: 'hidden',
                  }}
                >
                  {column.render(row)}
                </div>
              ) : (
                column.render(row)
              )}
            </td>
          ))}
        </tr>
      );
    });
  }

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: '100%', overflowX: 'auto' }}>
      <table style={tableStyle} aria-busy={loading ? 'true' : undefined}>
        <caption style={captionStyle}>
          {caption}
          {loading ? <span style={srOnly}> (loading)</span> : null}
        </caption>
        <thead>
          <tr>
            {columns.map((column) => {
              const align = column.align ?? 'left';
              const active = sort !== null && sort.key === column.key;
              const ariaSort = !column.sortValue
                ? undefined
                : active
                  ? sort.direction === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : 'none';
              return (
                <th
                  key={column.key}
                  scope="col"
                  title={column.headerTitle}
                  aria-sort={ariaSort}
                  style={{ ...headerCellBase, textAlign: align }}
                >
                  {column.sortValue ? (
                    <button
                      type="button"
                      style={{ ...sortButtonStyle, justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }}
                      onClick={() => setSort((current) => nextSort(current, column.key))}
                    >
                      {column.header}
                      <span aria-hidden="true">
                        {active ? (sort.direction === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>{body}</tbody>
      </table>
    </div>
  );
}
