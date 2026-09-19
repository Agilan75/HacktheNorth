import { jsx as _jsx } from "react/jsx-runtime";
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Actions } from './Actions.js';
afterEach(cleanup);
const routing = {
    region: 'Midwest',
    underwriter: 'Dana Whitfield',
    authorityLimit: 200000000,
    withinAuthority: true,
    rationale: 'Primary state OH is in the Midwest region; TIV is within authority.',
};
const draft = {
    actionId: 'act-refer-request',
    status: 'draft',
    subject: 'Information request: Acme',
    body: 'Please confirm the year built for building B-1.',
    requestedFields: [{ path: 'buildings.B-1.yearBuilt', label: 'Year built (B-1)', voi: 4 }],
};
const logRow = (over) => ({
    actionId: 'a1',
    submissionId: 'sub-1',
    insuredName: 'Acme',
    type: 'ingest_reply',
    status: 'applied',
    createdAt: '2026-09-19T12:30:00.000Z',
    beforeScore: 84,
    afterScore: 92,
    beforeRank: 5,
    afterRank: 2,
    beforeVerdict: 'REFER',
    afterVerdict: 'FIT',
    ...over,
});
describe('Actions', () => {
    it('renders routing numbers from props', () => {
        render(_jsx(Actions, { submissionId: "sub-1", routing: routing, drafts: [], log: [], onApprove: () => { } }));
        expect(screen.getByTestId('routing-underwriter')).toHaveTextContent('Dana Whitfield');
        expect(screen.getByTestId('routing-region')).toHaveTextContent('Midwest');
        expect(screen.getByTestId('routing-authority')).toHaveTextContent('$200,000,000');
        expect(screen.getByText('Within authority')).toBeInTheDocument();
        expect(screen.getByText('No request is needed for this submission.')).toBeInTheDocument();
        expect(screen.getByText('No actions have been logged for this submission.')).toBeInTheDocument();
    });
    it('flags referral to senior authority in text (PRD 7.6)', () => {
        render(_jsx(Actions, { submissionId: "sub-1", routing: { ...routing, withinAuthority: false }, drafts: [], log: [], onApprove: () => { } }));
        expect(screen.getByText('Needs referral to senior authority')).toBeInTheDocument();
    });
    it('shows unassigned routing in words', () => {
        render(_jsx(Actions, { submissionId: "sub-1", routing: { region: null, underwriter: null, authorityLimit: null, withinAuthority: null, rationale: 'No state.' }, drafts: [], log: [], onApprove: () => { } }));
        expect(screen.getByTestId('routing-underwriter')).toHaveTextContent('Unassigned');
        expect(screen.getByTestId('routing-authority')).toHaveTextContent('Not routed');
        expect(screen.getByTestId('routing-region')).toHaveTextContent('Not routed');
        expect(screen.getByTestId('actions-routing').querySelector('.rf-badge')).toHaveTextContent('Not routed');
    });
    it('renders the draft with requested fields and approves by actionId', async () => {
        const onApprove = vi.fn(() => Promise.resolve());
        render(_jsx(Actions, { submissionId: "sub-1", routing: routing, drafts: [draft], log: [], onApprove: onApprove }));
        const card = screen.getByTestId('actions-draft');
        expect(within(card).getByText('Please confirm the year built for building B-1.')).toBeInTheDocument();
        const field = within(card).getByTestId('draft-field');
        expect(field).toHaveTextContent('Year built (B-1)');
        expect(field).toHaveTextContent('4.0 pts');
        expect(screen.getByText('1 awaiting approval')).toBeInTheDocument();
        await act(async () => {
            fireEvent.click(within(card).getByRole('button', { name: 'Approve request: Information request: Acme' }));
        });
        expect(onApprove).toHaveBeenCalledWith('act-refer-request');
    });
    it('offers no approve button for a sent request', () => {
        render(_jsx(Actions, { submissionId: "sub-1", routing: routing, drafts: [{ ...draft, status: 'sent' }], log: [], onApprove: () => { } }));
        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.getByText('Sent')).toBeInTheDocument();
    });
    it('surfaces an approve failure as an alert', async () => {
        const onApprove = vi.fn(() => Promise.reject(new Error('409 already sent')));
        render(_jsx(Actions, { submissionId: "sub-1", routing: routing, drafts: [draft], log: [], onApprove: onApprove }));
        await act(async () => {
            fireEvent.click(screen.getByRole('button'));
        });
        expect(screen.getByRole('alert')).toHaveTextContent('Approve failed: 409 already sent');
    });
    it('logs before and after numbers with rank movement', () => {
        render(_jsx(Actions, { submissionId: "sub-1", routing: routing, drafts: [], log: [
                logRow({}),
                logRow({ actionId: 'a2', type: 'request', status: 'draft', afterScore: null, afterRank: null, afterVerdict: null }),
                logRow({ actionId: 'a3', beforeRank: 2, afterRank: 4 }),
            ], onApprove: () => { } }));
        const rows = screen.getAllByTestId('action-log-row');
        expect(rows).toHaveLength(3);
        expect(within(rows[0]).getByTestId('log-score')).toHaveTextContent('84 → 92');
        expect(within(rows[0]).getByTestId('log-rank')).toHaveTextContent('5 → 2 (up 3)');
        expect(within(rows[0]).getByTestId('log-verdict')).toHaveTextContent('Refer → Fit');
        expect(rows[0]).toHaveTextContent('Sep 19, 2026');
        expect(rows[0]).toHaveTextContent('Ingest Reply');
        expect(within(rows[1]).getByTestId('log-score')).toHaveTextContent(/^84$/);
        expect(within(rows[1]).getByTestId('log-rank')).toHaveTextContent(/^5$/);
        expect(within(rows[2]).getByTestId('log-rank')).toHaveTextContent('2 → 4 (down 2)');
    });
});
//# sourceMappingURL=Actions.test.js.map