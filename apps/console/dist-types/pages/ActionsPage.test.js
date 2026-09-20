import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
/*
 * useApi / DataTable / VerdictPill are replaced with signature-faithful
 * stand-ins (same approach as QueuePage.test.tsx). Under test: the outbox
 * selection, stage grouping, ordering, rank-movement text, the URL round trip,
 * approve and plan.
 */
let apiState;
const reload = vi.fn();
const approveAction = vi.fn();
const planActions = vi.fn();
vi.mock('../api/useApi.js', () => ({
    useApi: () => apiState,
    useApiClient: () => ({ approveAction, planActions }),
}));
vi.mock('../components/atoms/VerdictPill.js', () => ({
    VerdictPill: ({ verdict }) => _jsx("span", { "data-pill": true, children: verdict }),
}));
vi.mock('../components/DataTable.js', () => ({
    DataTable: (props) => (_jsxs("table", { children: [_jsx("caption", { children: props.caption }), _jsx("thead", { children: _jsx("tr", { children: props.columns.map((c) => (_jsx("th", { children: c.header }, c.key))) }) }), _jsx("tbody", { children: props.loading === true ? (_jsx("tr", { children: _jsx("td", { children: "loading" }) })) : props.rows.length === 0 ? (_jsx("tr", { children: _jsx("td", { children: props.emptyLabel }) })) : (props.rows.map((r) => (_jsx("tr", { "data-testid": `row-${props.rowKey(r)}`, children: props.columns.map((c) => (_jsx("td", { "data-col": c.key, children: c.render(r) }, c.key))) }, props.rowKey(r))))) })] })),
}));
const { ActionsPage } = await import('./ActionsPage.js');
function entry(overrides) {
    return {
        submissionId: `sub-${overrides.actionId}`,
        insuredName: `Insured ${overrides.actionId}`,
        type: 'route',
        status: 'applied',
        createdAt: '2026-09-01T10:00:00.000Z',
        beforeScore: null,
        afterScore: null,
        beforeRank: null,
        afterRank: null,
        beforeVerdict: null,
        afterVerdict: null,
        ...overrides,
    };
}
const ENTRIES = [
    entry({ actionId: 'A1', type: 'route', status: 'applied', createdAt: '2026-09-01T09:00:00.000Z' }),
    entry({
        actionId: 'A2',
        type: 'request',
        status: 'draft',
        insuredName: 'Acme Holdings',
        createdAt: '2026-09-02T09:00:00.000Z',
    }),
    entry({ actionId: 'A3', type: 'request', status: 'sent', createdAt: '2026-09-03T09:00:00.000Z' }),
    entry({
        actionId: 'A4',
        type: 'reply',
        status: 'applied',
        insuredName: 'Birch Lane',
        createdAt: '2026-09-04T09:00:00.000Z',
        beforeScore: 58,
        afterScore: 71.4,
        beforeRank: 7,
        afterRank: 3,
        beforeVerdict: 'REFER',
        afterVerdict: 'FIT',
    }),
    entry({
        actionId: 'A5',
        type: 'reply',
        status: 'replied',
        createdAt: '2026-09-05T09:00:00.000Z',
        beforeScore: 60,
        afterScore: 52,
        beforeRank: 2,
        afterRank: 5,
        beforeVerdict: 'REFER',
        afterVerdict: 'REFER',
    }),
    entry({ actionId: 'A6', type: 'request', status: 'failed', createdAt: '2026-09-06T09:00:00.000Z' }),
    // A draft route is not an underwriter approval item.
    entry({ actionId: 'A7', type: 'route', status: 'draft', createdAt: '2026-09-07T09:00:00.000Z' }),
];
function UrlProbe() {
    const location = useLocation();
    return _jsx("div", { "data-testid": "url", children: `${location.pathname}${location.search}` });
}
function renderPage(entryPath = '/actions') {
    render(_jsxs(MemoryRouter, { initialEntries: [entryPath], children: [_jsx(UrlProbe, {}), _jsx(ActionsPage, {})] }));
}
function url() {
    return screen.getByTestId('url').textContent ?? '';
}
function tableIds(caption) {
    const table = screen.getByRole('table', { name: caption });
    return within(table)
        .queryAllByRole('row')
        .map((tr) => tr.getAttribute('data-testid'))
        .filter((id) => id !== null)
        .map((id) => id.replace('row-', ''));
}
function cell(caption, id, col) {
    const table = screen.getByRole('table', { name: caption });
    return within(table).getByTestId(`row-${id}`).querySelector(`[data-col="${col}"]`)?.textContent ?? '';
}
const LOG = 'Every action across the book, newest first';
const OUTBOX = 'Broker requests awaiting approval';
beforeEach(() => {
    apiState = { data: ENTRIES, loading: false, error: null, reload };
    reload.mockReset();
    approveAction.mockReset();
    planActions.mockReset();
});
afterEach(() => cleanup());
describe('ActionsPage', () => {
    it('lists every action newest first and summarises stages', () => {
        renderPage();
        expect(tableIds(LOG)).toEqual(['A7', 'A6', 'A5', 'A4', 'A3', 'A2', 'A1']);
        expect(screen.getByRole('status').textContent).toBe('7 actions · 2 awaiting approval · 1 sent · 2 replied');
    });
    it('says sending is simulated in one short line beside the heading', () => {
        renderPage();
        const note = screen.getByText(/nothing is emailed/);
        expect(note.textContent).toBe('Approving marks it sent; nothing is emailed.');
        expect((note.textContent ?? '').split(/\s+/).length).toBeLessThanOrEqual(12);
        expect(screen.getByText('Simulated send')).toBeTruthy();
    });
    it('puts only drafted broker requests in the outbox', () => {
        renderPage();
        expect(tableIds(OUTBOX)).toEqual(['A2']);
        expect(cell(OUTBOX, 'A2', 'insured')).toBe('Acme Holdings');
        expect(cell(OUTBOX, 'A2', 'date')).toBe('Sep 2, 2026');
    });
    it('shows the score, verdict and rank movement each reply caused', () => {
        renderPage();
        expect(cell(LOG, 'A4', 'score')).toBe('58 → 71');
        expect(cell(LOG, 'A4', 'verdict')).toBe('REFER → FIT');
        expect(cell(LOG, 'A4', 'rank')).toBe('#7 → #3 (up 4 places)');
        expect(cell(LOG, 'A5', 'rank')).toBe('#2 → #5 (down 3 places)');
        expect(cell(LOG, 'A5', 'verdict')).toBe('REFER');
        expect(cell(LOG, 'A1', 'rank')).toBe('—');
        expect(cell(LOG, 'A1', 'score')).toBe('—');
        expect(cell(LOG, 'A3', 'type')).toBe('Request');
        expect(cell(LOG, 'A3', 'status')).toBe('Sent');
    });
    it('sorts the rank movements by size and links each one to its submission', () => {
        renderPage();
        const items = within(screen.getByRole('list')).getAllByRole('listitem');
        // A4 moved 4 places, A5 moved 3: biggest mover first, not newest first.
        expect(items.map((li) => li.getAttribute('data-testid'))).toEqual(['movement-A4', 'movement-A5']);
        expect(screen.getByTestId('movement-A4').textContent).toBe('Birch Lane#7 → #3 (up 4 places)');
        expect(within(screen.getByTestId('movement-A4')).getByRole('link').getAttribute('href')).toBe('/submissions/sub-A4');
        // Two movements is under the cap, so there is no disclosure.
        expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull();
    });
    it('caps the movement list and discloses the rest through the URL', () => {
        apiState = {
            data: Array.from({ length: 10 }, (_, i) => entry({
                actionId: `R${i}`,
                type: 'reply',
                status: 'replied',
                beforeRank: 20 - i,
                afterRank: 1,
            })),
            loading: false,
            error: null,
            reload,
        };
        renderPage();
        expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(8);
        fireEvent.click(screen.getByRole('button', { name: 'Show all (10)' }));
        expect(url()).toBe('/actions?moves=all');
        expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(10);
    });
    it('never quotes a spec section in a column header', () => {
        renderPage();
        for (const th of screen.getAllByRole('columnheader')) {
            expect(th.textContent ?? '').not.toMatch(/PRD|§/);
        }
    });
    it('filters the log by stage and round-trips the stage through the URL', () => {
        renderPage();
        fireEvent.click(screen.getByRole('button', { name: 'Awaiting approval (2)' }));
        expect(tableIds(LOG)).toEqual(['A7', 'A2']);
        expect(url()).toBe('/actions?stage=awaiting');
        fireEvent.click(screen.getByRole('button', { name: 'Replied (2)' }));
        expect(tableIds(LOG)).toEqual(['A5', 'A4']);
        fireEvent.click(screen.getByRole('button', { name: 'Failed (1)' }));
        expect(tableIds(LOG)).toEqual(['A6']);
        expect(screen.getByRole('button', { name: 'Failed (1)' }).getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(screen.getByRole('button', { name: 'Sent (1)' }));
        expect(tableIds(LOG)).toEqual(['A3']);
        // The default stage leaves the URL clean again.
        fireEvent.click(screen.getByRole('button', { name: 'All (7)' }));
        expect(tableIds(LOG)).toHaveLength(7);
        expect(url()).toBe('/actions');
        cleanup();
        renderPage('/actions?stage=failed');
        expect(tableIds(LOG)).toEqual(['A6']);
        expect(screen.getByRole('button', { name: 'Failed (1)' }).getAttribute('aria-pressed')).toBe('true');
    });
    it('approves a draft, reloads the log and keeps focus on the approved row', async () => {
        approveAction.mockResolvedValue({ ...ENTRIES[1], status: 'sent' });
        renderPage();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Approve request to Acme Holdings' }));
        });
        expect(approveAction).toHaveBeenCalledWith('A2');
        expect(reload).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('status').textContent).toBe('Request to Acme Holdings approved and marked sent.');
        expect(document.activeElement?.getAttribute('data-action-row')).toBe('A2');
    });
    it('reports an approve failure without reloading', async () => {
        approveAction.mockRejectedValue(new Error('HTTP 409'));
        renderPage();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Approve request to Acme Holdings' }));
        });
        expect(reload).not.toHaveBeenCalled();
        expect(screen.getByRole('alert').textContent).toContain('HTTP 409');
    });
    it('runs the action plan and reloads', async () => {
        planActions.mockResolvedValue([ENTRIES[0], ENTRIES[1], ENTRIES[2]]);
        renderPage();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Run action plan' }));
        });
        expect(planActions).toHaveBeenCalledTimes(1);
        expect(reload).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('status').textContent).toBe('Action plan ran: 3 actions routed or drafted.');
    });
    it('shows loading, short empty labels and an error state', () => {
        apiState = { data: null, loading: true, error: null, reload };
        renderPage();
        expect(screen.getByRole('status').textContent).toBe('Loading the action log…');
        cleanup();
        apiState = { data: [], loading: false, error: null, reload };
        renderPage();
        expect(screen.getByText('No actions yet.')).toBeTruthy();
        expect(screen.getByText('Nothing awaiting approval.')).toBeTruthy();
        expect(screen.queryByRole('heading', { name: 'Rank movement from replies' })).toBeNull();
        cleanup();
        apiState = { data: null, loading: false, error: new Error('HTTP 503'), reload };
        renderPage();
        const alert = screen.getByRole('alert');
        expect(alert.textContent).toContain('HTTP 503');
        fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
        expect(reload).toHaveBeenCalledTimes(1);
    });
});
//# sourceMappingURL=ActionsPage.test.js.map