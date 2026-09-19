import { jsx as _jsx } from "react/jsx-runtime";
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { PeerBenchmark } from './PeerBenchmark.js';
afterEach(cleanup);
function renderPanel(benchmark) {
    const ui = (_jsx(MemoryRouter, { children: _jsx(PeerBenchmark, { benchmark: benchmark }) }));
    render(ui);
}
const full = {
    peers: [
        { submissionId: 'S-1', insuredName: 'Acme Storage', distance: 0.1234, ratePer100Tiv: 0.41, annualLoss: 12000, verdict: 'FIT' },
        { submissionId: 'S-2', insuredName: 'Birch Mills', distance: 0.2, ratePer100Tiv: 0.38, annualLoss: 50000, verdict: 'REFER' },
        { submissionId: 'S-3', insuredName: 'Cobalt Labs', distance: 0.2, ratePer100Tiv: 0.66, annualLoss: null, verdict: 'DOES_NOT_FIT' },
        { submissionId: 'S-4', insuredName: 'Dune Freight', distance: 0.31, ratePer100Tiv: 0.23, annualLoss: 40000, verdict: null },
        { submissionId: 'S-5', insuredName: 'Elm Offices', distance: 0.45, ratePer100Tiv: null, annualLoss: 50000, verdict: 'FIT' },
    ],
    medianRatePer100Tiv: 0.395,
    meanAnnualLoss: 38000,
    comparedComponentCount: 9,
};
describe('PeerBenchmark', () => {
    it('renders the five nearest accounts in the given order with distance, rate and loss', () => {
        renderPanel(full);
        const rows = screen.getAllByTestId('peer-row');
        expect(rows).toHaveLength(5);
        expect(rows.map((r) => within(r).getByRole('link').textContent)).toEqual([
            'Acme Storage',
            'Birch Mills',
            'Cobalt Labs',
            'Dune Freight',
            'Elm Offices',
        ]);
        expect(within(rows[0]).getByText('0.123')).toBeInTheDocument();
        expect(within(rows[0]).getByText('$0.41')).toBeInTheDocument();
        expect(within(rows[0]).getByText('$12,000')).toBeInTheDocument();
        expect(within(rows[0]).getByRole('link')).toHaveAttribute('href', '/submissions/S-1');
        expect(within(rows[2]).getByText('—')).toBeInTheDocument();
        expect(screen.getByTestId('peer-count')).toHaveTextContent('5 nearest accounts');
    });
    it('fills the Verdict column from each peer\'s stored verdict, and says so in words when there is none', () => {
        renderPanel(full);
        const cells = screen.getAllByTestId('peer-verdict');
        expect(cells.map((c) => c.querySelector('[data-verdict]')?.getAttribute('data-verdict') ?? null)).toEqual([
            'FIT',
            'REFER',
            'DOES_NOT_FIT',
            null,
            'FIT',
        ]);
        expect(cells[3]).toHaveTextContent('No stored result');
        expect(cells.some((c) => c.textContent === '—')).toBe(false);
    });
    it('shows the engine median rate and mean loss (P-3) without recomputing them', () => {
        renderPanel(full);
        expect(screen.getByTestId('peer-median-rate')).toHaveTextContent('$0.40');
        expect(screen.getByTestId('peer-mean-loss')).toHaveTextContent('$38,000');
        expect(screen.getByTestId('peer-compared')).toHaveTextContent('9');
        expect(screen.queryByTestId('peer-coarse')).toBeNull();
    });
    it('labels a reduced three-component match as coarse', () => {
        renderPanel({ ...full, peers: full.peers.slice(0, 2), comparedComponentCount: 3 });
        expect(screen.getByTestId('peer-coarse')).toBeInTheDocument();
        expect(screen.getByTestId('peer-count')).toHaveTextContent('2 nearest accounts · coarse match');
    });
    it('renders an empty state with dashes when there are no peers', () => {
        renderPanel({ peers: [], medianRatePer100Tiv: null, meanAnnualLoss: null, comparedComponentCount: 0 });
        expect(screen.queryAllByTestId('peer-row')).toHaveLength(0);
        expect(screen.getByText('No comparable accounts share enough known components.')).toBeInTheDocument();
        expect(screen.getByTestId('peer-median-rate')).toHaveTextContent('—');
        expect(screen.getByTestId('peer-count')).toHaveTextContent('0 nearest accounts');
    });
});
//# sourceMappingURL=PeerBenchmark.test.js.map