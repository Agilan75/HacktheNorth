import { jsx as _jsx } from "react/jsx-runtime";
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { QueryTrace } from './QueryTrace';
const triage = {
    step: 1,
    phase: 'triage',
    resource: 'Submission',
    purpose: 'Select id, status and line of business for every submission',
    payload: { select: ['id', 'status', 'line_of_business'] },
    resultCount: 158,
    durationMs: 412,
    adapted: false,
    note: null,
};
const deep = {
    step: 2,
    phase: 'deep',
    resource: 'Policy',
    purpose: 'Hydrate insured, claims and buildings for the 38 property survivors',
    payload: { expand: { insured: true, claims: true } },
    resultCount: 27,
    durationMs: 1830,
    adapted: true,
    note: 'Zero rows on a dot-path; retried with $elemMatch',
};
afterEach(cleanup);
describe('QueryTrace', () => {
    it('renders entries ordered by step regardless of input order', () => {
        render(_jsx(QueryTrace, { entries: [deep, triage] }));
        const items = screen.getAllByTestId('query-trace-entry');
        expect(items.map((li) => li.getAttribute('data-step'))).toEqual(['1', '2']);
        expect(within(items[0]).getByText('Submission')).toBeInTheDocument();
        expect(within(items[1]).getByText('Policy')).toBeInTheDocument();
    });
    it('shows row counts, durations, the adapted badge and the note', () => {
        render(_jsx(QueryTrace, { entries: [triage, deep] }));
        const [first, second] = screen.getAllByTestId('query-trace-entry');
        expect(first).toHaveTextContent('158 rows · 412 ms');
        expect(second).toHaveTextContent('27 rows · 1.83 s');
        expect(within(first).queryByText('Adapted')).toBeNull();
        expect(within(second).getByText('Adapted')).toBeInTheDocument();
        expect(within(second).getByText('Zero rows on a dot-path; retried with $elemMatch')).toBeInTheDocument();
        expect(screen.getByText('2 queries · 1 adapted')).toBeInTheDocument();
    });
    it('prints the payload as pretty JSON', () => {
        render(_jsx(QueryTrace, { entries: [triage] }));
        const code = screen.getByText(/"select"/);
        expect(code.textContent).toBe(JSON.stringify(triage.payload, null, 2));
    });
    it('does not throw on a cyclic payload', () => {
        const cyclic = { a: 1 };
        cyclic['self'] = cyclic;
        render(_jsx(QueryTrace, { entries: [{ ...triage, payload: cyclic }] }));
        expect(screen.getByText('[object Object]')).toBeInTheDocument();
    });
    it('renders an empty state', () => {
        render(_jsx(QueryTrace, { entries: [] }));
        expect(screen.getByRole('heading', { name: 'How the agent got here' })).toBeInTheDocument();
        expect(screen.getByText('No queries were recorded for this submission.')).toBeInTheDocument();
    });
});
//# sourceMappingURL=QueryTrace.test.js.map