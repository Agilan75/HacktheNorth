import { jsx as _jsx } from "react/jsx-runtime";
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
let apiState;
vi.mock('../api/useApi.js', () => ({
    useApi: () => apiState,
    useApiClient: () => {
        throw new Error('not used');
    },
}));
import { AggregatePage } from './AggregatePage.js';
function flipRow(id, over = {}) {
    return {
        submissionId: id, rank: 4, qualityIndex: 70, verdict: 'DOES_NOT_FIT', insuredName: `Insured ${id}`,
        lineOfBusiness: 'commercial_property', primaryState: 'OH', appetiteScore: 75, quotedPremium: 150000,
        predictedPremium: 160000, adequacy: 0.9375, completeness: 100, contradictionCount: 0, oneFlipFromFit: true,
        assignedUnderwriter: null, underwriterSource: null, synthetic: false, totalTiv: null, pendingAction: null, explanationLine: 'Queue explanation sentence.', outOfAppetiteLine: false,
        ...over,
    };
}
/** The pre-C14 shape: no counts, no labels, no adequacy detail, no flip moves. */
const BASE = {
    countsByVerdict: { FIT: 5, REFER: 20, DOES_NOT_FIT: 13 },
    scoreHistogram: [0, 0, 1, 2, 3, 4, 5, 6, 7, 10].map((count, i) => ({ bucket: `${i * 10}`, count })),
    topKnockoutFactors: [{ factorId: 'total_premium', count: 4 }],
    oneFlipAway: [flipRow('c')],
    bookAdequacy: 0.97,
    verification: {},
};
/** The C14 shape, straight from AggregateDto. */
const RICH = {
    ...BASE,
    counts: { total: 41, scored: 38, knockedOut: 13, byLine: { commercial_property: 41 } },
    topKnockoutFactors: [{ factorId: 'total_premium', label: 'Total premium (guide label)', count: 4 }],
    bookAdequacyDetail: { median: 0.97, underpricedCount: 9, n: 27 },
    oneFlipMoves: { c: { moveLabel: 'Raise TIV to $150,000,000', scoreAfter: 84, premiumAfter: 205000 } },
};
function mount(data) {
    apiState = { data, loading: false, error: null, reload: vi.fn() };
    return render(_jsx(MemoryRouter, { children: _jsx(AggregatePage, {}) }));
}
function tileValue(testId) {
    return within(screen.getByTestId(testId)).getByRole('definition').textContent ?? '';
}
/** The one-flip DataTable no longer carries a per-row test id; find it by insured name. */
function flipCells(id) {
    const row = screen.getByRole('link', { name: `Open Insured ${id}` }).closest('tr');
    if (row === null)
        throw new Error(`no row for ${id}`);
    return within(row).getAllByRole('cell').map((c) => c.textContent);
}
afterEach(cleanup);
describe('AggregatePage with the C14 fields', () => {
    it('shows the engine counts, not a console sum', () => {
        mount(RICH);
        expect(tileValue('tile-total')).toContain('38');
        expect(tileValue('tile-total')).toContain('41 ingested');
        expect(tileValue('tile-total')).toContain('13 knocked out');
    });
    it('book adequacy shows the median and the underpriced count the API returned', () => {
        mount(RICH);
        expect(tileValue('tile-adequacy')).toContain('97%');
        expect(screen.getByTestId('adequacy-underpriced').textContent).toBe('9 of 27 priced submissions quoted below predicted premium.');
    });
    it('labels knockout factors with the API label', () => {
        mount(RICH);
        expect(screen.getAllByText('Total premium (guide label)').length).toBeGreaterThan(0);
    });
    it('one-flip list shows the specific move, score after and premium after', () => {
        mount(RICH);
        const cells = flipCells('c');
        expect(cells).toContain('Raise TIV to $150,000,000');
        expect(cells).toContain('84');
        expect(cells).toContain('$205,000');
        expect(cells).not.toContain('Queue explanation sentence.');
    });
});
describe('AggregatePage verification link (FILL-console)', () => {
    it('links the verification tiles to the full Verification page', () => {
        mount({ ...RICH, verification: { propertyCasesRun: 10000000, differentialCasesRun: 10000000, disagreements: 0, llmCasesRun: 1332, llmAgreementRate: 0.9992492492492493, llmAgreementCi95: null, extractionFieldAccuracy: null, generatedAt: '2026-09-19T16:38:04.459Z' } });
        expect(screen.getByTestId('verify-propertyCasesRun')).toBeInTheDocument();
        expect(screen.getByTestId('verification-link')).toHaveAttribute('href', '/verification');
    });
    it('keeps the link when no run exists yet', () => {
        mount(BASE);
        expect(screen.getByTestId('verification-empty')).toHaveTextContent('No verification run yet.');
        expect(screen.getByTestId('verification-link')).toHaveAttribute('href', '/verification');
    });
});
describe('AggregatePage without the C14 fields (fallback)', () => {
    it('falls back to the verdict sum, titleCase labels, median only and the queue explanation', () => {
        mount(BASE);
        expect(tileValue('tile-total')).toContain('38');
        expect(tileValue('tile-total')).not.toContain('ingested');
        expect(tileValue('tile-adequacy')).toContain('97%');
        expect(screen.queryByTestId('adequacy-underpriced')).toBeNull();
        expect(screen.getAllByText('Total Premium').length).toBeGreaterThan(0);
        const cells = flipCells('c');
        expect(cells).toContain('Queue explanation sentence.');
        expect(cells).toContain('—');
    });
});
describe('AggregatePage one-flip row not present in the queue (R5-12)', () => {
    it('never invents a verdict or a predicted premium for a row the queue never returned', () => {
        const row = flipRow('z', { predictedPremium: null, incomplete: true });
        mount({ ...BASE, oneFlipAway: [row] });
        const tr = screen.getByRole('link', { name: 'Open Insured z' }).closest('tr');
        expect(within(tr).queryByText('DOES NOT FIT')).toBeNull();
        expect(within(tr).getByText('Not in current queue')).toBeInTheDocument();
        const cells = within(tr).getAllByRole('cell').map((c) => c.textContent);
        expect(cells).toContain('—'); // Predicted premium: unknown, not the post-flip figure.
    });
});
describe('AggregatePage navigation (redesign)', () => {
    it('links the headline verdict tile and the verdict chart rows to the filtered queue', () => {
        mount(RICH);
        expect(within(screen.getByTestId('tile-fit')).getByRole('link')).toHaveAttribute('href', '/queue?verdict=FIT');
        expect(screen.getByTestId('verdict-links-FIT')).toHaveAttribute('href', '/queue?verdict=FIT');
        expect(screen.getByTestId('verdict-links-DOES_NOT_FIT')).toHaveAttribute('href', '/queue?verdict=DOES_NOT_FIT');
    });
    it('links each knockout factor row to the queue', () => {
        mount(RICH);
        expect(screen.getByTestId('knockout-links-total_premium')).toHaveAttribute('href', `/queue?${new URLSearchParams({ q: 'Total premium (guide label)' }).toString()}`);
    });
    it('caps the one-flip table and discloses the rest', () => {
        const rows = Array.from({ length: 12 }, (_, i) => flipRow(`f${i}`));
        mount({ ...BASE, oneFlipAway: rows });
        expect(screen.queryByRole('link', { name: 'Open Insured f11' })).toBeNull();
        fireEvent.click(screen.getByTestId('flip-show-all'));
        expect(screen.getByRole('link', { name: 'Open Insured f11' })).toBeInTheDocument();
    });
    it('sorts the one-flip table by score after, descending', () => {
        mount({
            ...BASE,
            oneFlipAway: [flipRow('low'), flipRow('high')],
            oneFlipMoves: {
                low: { moveLabel: 'Low move', scoreAfter: 71, premiumAfter: 1000 },
                high: { moveLabel: 'High move', scoreAfter: 92, premiumAfter: 2000 },
            },
        });
        const names = screen.getAllByRole('link', { name: /^Open Insured/ }).map((l) => l.textContent);
        expect(names).toEqual(['Insured high', 'Insured low']);
    });
    it('the verification link is short', () => {
        mount(RICH);
        expect(screen.getByTestId('verification-link').textContent).toBe('Verification');
    });
});
//# sourceMappingURL=AggregatePage.test.js.map