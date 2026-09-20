import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from 'react';
import { cssVar, MIN_TOUCH_TARGET, SPACE } from '@retrofit/design';
/** Number of placeholder rows rendered while loading (PRD §13: skeletons for every list). */
const LOADING_ROWS = 5;
/** Visually hidden but read by screen readers (private; base.css belongs to C02). */
const srOnly = {
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
const tableStyle = {
    width: '100%',
    borderCollapse: 'collapse',
    fontFamily: cssVar('font-body'),
    fontSize: cssVar('size-small'),
    lineHeight: cssVar('leading-small'),
    color: cssVar('ink'),
};
const captionStyle = {
    textAlign: 'left',
    padding: `${SPACE.sm}px 0`,
    fontFamily: cssVar('font-display'),
    fontSize: cssVar('size-heading'),
    lineHeight: cssVar('leading-heading'),
};
const cellBase = {
    padding: `${SPACE.sm}px ${SPACE.md}px`,
    borderBottom: `1px solid ${cssVar('muted-tint')}`,
    verticalAlign: 'top',
    // A dense multi-column table left to auto-layout squeezes every column to
    // fit the viewport, so free text (an explanation sentence, a long insured
    // name) wraps one word per line and each row balloons to hundreds of
    // pixels tall. Cells stay on one line instead; the wrapper's own
    // `overflow-x: auto` (below) scrolls the rare wide table sideways.
    whiteSpace: 'nowrap',
};
const headerCellBase = {
    ...cellBase,
    fontWeight: 600,
    color: cssVar('muted-deep'),
    fontSize: cssVar('size-micro'),
    lineHeight: cssVar('leading-micro'),
    whiteSpace: 'nowrap',
};
const sortButtonStyle = {
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
const skeletonBarStyle = {
    display: 'block',
    height: SPACE.md,
    borderRadius: 999,
    background: cssVar('muted-tint'),
};
/** Nulls always sort last, regardless of direction. Numbers before strings. */
function compareSortValues(a, b, direction) {
    if (a === null && b === null)
        return 0;
    if (a === null)
        return 1;
    if (b === null)
        return -1;
    let result;
    if (typeof a === 'number' && typeof b === 'number') {
        result = a - b;
    }
    else if (typeof a === 'number') {
        result = -1;
    }
    else if (typeof b === 'number') {
        result = 1;
    }
    else {
        result = a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true });
    }
    return direction === 'asc' ? result : -result;
}
/** Click cycle on a column header: none → ascending → descending → none. */
function nextSort(current, key) {
    if (current === null || current.key !== key)
        return { key, direction: 'asc' };
    if (current.direction === 'asc')
        return { key, direction: 'desc' };
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
export function DataTable(props) {
    const { caption, columns, rows, rowKey, emptyLabel, loading = false, onRowClick } = props;
    const [ownSort, setOwnSort] = useState(null);
    const controlled = props.onSortChange !== undefined;
    const sort = controlled ? (props.sort ?? null) : ownSort;
    const applySort = (key) => {
        const next = nextSort(sort, key);
        if (props.onSortChange)
            props.onSortChange(next);
        else
            setOwnSort(next);
    };
    const sortedRows = useMemo(() => {
        // Controlled: the owner hands us the rows already in order.
        if (controlled || sort === null)
            return rows;
        const column = columns.find((c) => c.key === sort.key);
        const sortValue = column?.sortValue;
        if (!sortValue)
            return rows;
        // Stable: ties keep the incoming order.
        return rows
            .map((row, index) => ({ row, index, value: sortValue(row) }))
            .sort((a, b) => compareSortValues(a.value, b.value, sort.direction) || a.index - b.index)
            .map((entry) => entry.row);
    }, [rows, columns, sort, controlled]);
    const handleRowKeyDown = (event, row) => {
        if (!onRowClick)
            return;
        if (event.target !== event.currentTarget)
            return;
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onRowClick(row);
        }
    };
    let body;
    if (loading) {
        body = Array.from({ length: LOADING_ROWS }, (_, i) => (_jsx("tr", { "data-testid": "datatable-skeleton-row", "aria-hidden": "true", children: columns.map((column) => (_jsx("td", { style: cellBase, children: _jsx("span", { style: { ...skeletonBarStyle, width: i % 2 === 0 ? '80%' : '60%' } }) }, column.key))) }, `loading-${i}`)));
    }
    else if (sortedRows.length === 0) {
        body = (_jsx("tr", { children: _jsx("td", { colSpan: Math.max(columns.length, 1), style: { ...cellBase, color: cssVar('muted-deep') }, children: emptyLabel }) }));
    }
    else {
        body = sortedRows.map((row) => {
            const clickable = onRowClick !== undefined;
            return (_jsx("tr", { role: clickable ? 'button' : undefined, tabIndex: clickable ? 0 : undefined, onClick: clickable ? () => onRowClick(row) : undefined, onKeyDown: clickable ? (event) => handleRowKeyDown(event, row) : undefined, style: clickable ? { cursor: 'pointer' } : undefined, "data-clickable": clickable ? 'true' : undefined, children: columns.map((column) => (_jsx("td", { "data-align": column.align ?? 'left', style: {
                        ...cellBase,
                        textAlign: column.align ?? 'left',
                        ...(column.minWidth !== undefined ? { minWidth: column.minWidth } : {}),
                    }, title: column.title ? column.title(row) : undefined, children: column.clampLines !== undefined ? (_jsx("div", { style: {
                            display: '-webkit-box',
                            WebkitBoxOrient: 'vertical',
                            WebkitLineClamp: column.clampLines,
                            overflow: 'hidden',
                            // The cell itself defaults to nowrap so short columns
                            // never wrap; a clamped cell needs normal wrapping or
                            // -webkit-line-clamp has nothing to clamp across lines.
                            whiteSpace: 'normal',
                        }, children: column.render(row) })) : (column.render(row)) }, column.key))) }, rowKey(row)));
        });
    }
    return (_jsx("div", { className: "rf-ledger", style: { position: 'relative', width: '100%', maxWidth: '100%', overflowX: 'auto' }, children: _jsxs("table", { style: tableStyle, "aria-busy": loading ? 'true' : undefined, children: [_jsxs("caption", { style: captionStyle, children: [caption, loading ? _jsx("span", { style: srOnly, children: " (loading)" }) : null] }), _jsx("thead", { children: _jsx("tr", { children: columns.map((column) => {
                            const align = column.align ?? 'left';
                            const active = sort !== null && sort.key === column.key;
                            const ariaSort = !column.sortValue
                                ? undefined
                                : active
                                    ? sort.direction === 'asc'
                                        ? 'ascending'
                                        : 'descending'
                                    : 'none';
                            return (_jsx("th", { scope: "col", title: column.headerTitle, "aria-sort": ariaSort, style: { ...headerCellBase, textAlign: align }, children: column.sortValue ? (_jsxs("button", { type: "button", style: { ...sortButtonStyle, justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }, onClick: () => applySort(column.key), children: [column.header, _jsx("span", { "aria-hidden": "true", children: active ? (sort.direction === 'asc' ? '▲' : '▼') : '↕' })] })) : (column.header) }, column.key));
                        }) }) }), _jsx("tbody", { children: body })] }) }));
}
//# sourceMappingURL=DataTable.js.map