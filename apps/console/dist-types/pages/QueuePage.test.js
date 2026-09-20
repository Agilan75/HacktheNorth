import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
/*
 * The collaborators (C01 useApi, C02 atoms, C03 DataTable/Filters) are built in
 * parallel, so they are replaced with minimal stand-ins that honour their frozen
 * signatures. What is under test is QueuePage's own logic: order, filtering, the
 * collapsed out-of-appetite group, the formatting of every cell, and navigation.
 */
let apiState;
const reload = vi.fn();
let lastFilters = null;
vi.mock('../api/useApi.js', () => ({
    useApi: () => apiState,
    useApiClient: () => {
        throw new Error('not used');
    },
}));
vi.mock('../components/atoms/VerdictPill.js', () => ({
    VerdictPill: ({ verdict }) => _jsx("span", { "data-pill": true, children: verdict }),
}));
vi.mock('../components/atoms/Badge.js', () => ({
    Badge: ({ label }) => _jsx("span", { "data-badge": true, children: label }),
}));
vi.mock('../components/Filters.js', () => ({
    Filters: (props) => {
        lastFilters = props;
        return _jsx("div", { "data-testid": "filters" });
    },
}));
vi.mock('../components/DataTable.js', () => ({
    DataTable: (props) => (_jsxs("table", { children: [_jsx("caption", { children: props.caption }), _jsx("thead", { children: _jsx("tr", { children: props.columns.map((c) => (_jsx("th", { children: c.header }, c.key))) }) }), _jsx("tbody", { children: props.loading === true ? (_jsx("tr", { children: _jsx("td", { children: "loading" }) })) : props.rows.length === 0 ? (_jsx("tr", { children: _jsx("td", { children: props.emptyLabel }) })) : (props.rows.map((r) => (_jsx("tr", { "data-testid": `row-${props.rowKey(r)}`, onClick: () => props.onRowClick?.(r), children: props.columns.map((c) => (_jsx("td", { "data-col": c.key, children: c.render(r) }, c.key))) }, props.rowKey(r))))) })] })),
}));
const { QueuePage } = await import('./QueuePage.js');
function row(overrides) {
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
const ROWS = [
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
function LocationProbe() {
    return _jsx("div", { "data-testid": "location", children: useLocation().pathname });
}
function renderPage() {
    render(_jsx(MemoryRouter, { initialEntries: ['/queue'], children: _jsxs(Routes, { children: [_jsx(Route, { path: "/queue", element: _jsx(QueuePage, {}) }), _jsx(Route, { path: "/submissions/:id", element: _jsx(LocationProbe, {}) })] }) }));
}
function mainRowIds() {
    const table = screen.getByRole('table', { name: 'Ranked submissions, best first' });
    return within(table)
        .queryAllByRole('row')
        .map((tr) => tr.getAttribute('data-testid'))
        .filter((id) => id !== null)
        .map((id) => id.replace('row-', ''));
}
function cell(id, col) {
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
            .filter((id) => id !== null);
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
        const base = lastFilters.value;
        act(() => lastFilters.onChange({ ...base, verdict: 'FIT' }));
        expect(mainRowIds()).toEqual(['S1']);
        expect(screen.queryByRole('button', { name: /Out of appetite/ })).toBeNull();
        expect(screen.getByRole('status').textContent).toBe('Showing 1 of 5 submissions');
        act(() => lastFilters.onChange({ ...base, state: 'TX' }));
        expect(mainRowIds()).toEqual(['S3']);
        act(() => lastFilters.onChange({ ...base, underwriter: 'Ada' }));
        expect(mainRowIds()).toEqual(['S2']);
        act(() => lastFilters.onChange({ ...base, line: 'cyber' }));
        expect(mainRowIds()).toEqual([]);
        expect(screen.getByText('No submissions match these filters.')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Out of appetite: line of business (1)' })).toBeTruthy();
        act(() => lastFilters.onChange({ ...base, search: '  acme ' }));
        expect(mainRowIds()).toEqual(['S1']);
        act(() => lastFilters.onChange({ ...base }));
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
//# sourceMappingURL=QueuePage.test.js.map