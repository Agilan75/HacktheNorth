import { jsx as _jsx } from "react/jsx-runtime";
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Pricing } from './Pricing.js';
afterEach(cleanup);
const base = {
    quotedPremium: 88000,
    predictedPremium: 104762,
    adequacy: 0.84,
    expectedLoss: 38250,
    ratePer100Tiv: 0.29,
    currency: 'USD',
    factors: [
        { label: 'Construction', multiplier: 0.92, basis: 'Masonry non-combustible' },
        { label: 'Building age', multiplier: 1.15, basis: '62% of TIV pre-1990' },
        { label: 'Sprinkler', multiplier: 1, basis: null },
    ],
    notes: ['Fitted on 27 policies; mean absolute error 11%.'],
};
describe('Pricing', () => {
    it('renders every headline number from the props, unchanged', () => {
        render(_jsx(Pricing, { pricing: base }));
        expect(screen.getByTestId('pricing-quoted')).toHaveTextContent('$88,000');
        expect(screen.getByTestId('pricing-predicted')).toHaveTextContent('$104,762');
        expect(screen.getByTestId('pricing-adequacy')).toHaveTextContent('84%');
        expect(screen.getByTestId('pricing-adequacy')).toHaveTextContent('0.84 quoted ÷ predicted');
        expect(screen.getByTestId('pricing-expected-loss')).toHaveTextContent('$38,250');
        expect(screen.getByTestId('pricing-rate')).toHaveTextContent('$0.29');
    });
    it('flags adequacy under 0.9 as underpriced (PRD 6.7) in text, not colour alone', () => {
        render(_jsx(Pricing, { pricing: base }));
        expect(screen.getByText('Underpriced for the risk')).toBeInTheDocument();
    });
    it('treats exactly 0.9 as adequate (strict "under 0.9")', () => {
        render(_jsx(Pricing, { pricing: { ...base, adequacy: 0.9 } }));
        expect(screen.getByText('Adequate for the risk')).toBeInTheDocument();
        expect(screen.queryByText('Underpriced for the risk')).toBeNull();
    });
    it('lists each factor with multiplier, direction and basis', () => {
        render(_jsx(Pricing, { pricing: base }));
        const rows = screen.getAllByTestId('pricing-factor');
        expect(rows).toHaveLength(3);
        expect(within(rows[0]).getByText('×0.92')).toBeInTheDocument();
        expect(within(rows[0]).getByText('Lowers premium')).toBeInTheDocument();
        expect(within(rows[1]).getByText('×1.15')).toBeInTheDocument();
        expect(within(rows[1]).getByText('Raises premium')).toBeInTheDocument();
        expect(within(rows[1]).getByText('62% of TIV pre-1990')).toBeInTheDocument();
        expect(within(rows[2]).getByText('×1.00')).toBeInTheDocument();
        expect(within(rows[2]).getByText('No effect')).toBeInTheDocument();
        expect(within(rows[2]).getByText('—')).toBeInTheDocument();
        expect(screen.getByText('Fitted on 27 policies; mean absolute error 11%.')).toBeInTheDocument();
    });
    it('shows dashes and no adequacy label when numbers are missing', () => {
        render(_jsx(Pricing, { pricing: {
                ...base,
                quotedPremium: null,
                predictedPremium: null,
                adequacy: null,
                expectedLoss: null,
                ratePer100Tiv: null,
                factors: [],
                notes: [],
            } }));
        expect(screen.getByTestId('pricing-quoted')).toHaveTextContent('—');
        expect(screen.getByTestId('pricing-adequacy')).toHaveTextContent('needs a quoted and a predicted premium');
        expect(screen.queryByText(/for the risk/)).toBeNull();
        expect(screen.getByText('No rating factors were applied to this account.')).toBeInTheDocument();
        expect(screen.queryByRole('list', { name: 'Pricing notes' })).toBeNull();
    });
    describe('R5-7: per-building rating, factor by factor (PRD 10 d)', () => {
        const withBuildings = {
            ...base,
            factors: [{ label: 'lossHistory', multiplier: 1.09, basis: '$0 five-year loss' }],
            buildings: [
                {
                    buildingExternalId: 'B-109',
                    tiv: 13_800_000,
                    baseRate: 0.0425,
                    factors: [
                        { label: 'construction', multiplier: 0.981, input: 'steel' },
                        { label: 'age', multiplier: 1.1, input: 'built 1985' },
                        { label: 'protectionClass', multiplier: 1.05, input: 'class 4' },
                        { label: 'sprinkler', multiplier: 0.85, input: 'sprinklered' },
                    ],
                    premium: 5129.67,
                },
                {
                    buildingExternalId: 'B-110',
                    tiv: 4_700_000,
                    baseRate: 0.0425,
                    factors: [
                        { label: 'construction', multiplier: 1.2, input: 'wood_frame' },
                        { label: 'age', multiplier: 1, input: 'unknown' },
                        { label: 'protectionClass', multiplier: 1.05, input: 'class 4' },
                        { label: 'sprinkler', multiplier: 1.25, input: 'unsprinklered' },
                    ],
                    premium: 3146.06,
                },
            ],
        };
        it('renders one row per building with TIV, base rate, each multiplier and its input, and the premium from the DTO', () => {
            render(_jsx(Pricing, { pricing: withBuildings }));
            const table = screen.getByRole('table', { name: 'Per-building rating' });
            const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
            expect(headers).toEqual([
                'Building',
                'TIV',
                'Base rate per $100',
                'Construction',
                'Age',
                'Protection class',
                'Sprinkler',
                'Building premium',
            ]);
            const rows = screen.getAllByTestId('pricing-building');
            expect(rows).toHaveLength(2);
            const first = rows[0];
            expect(within(first).getByRole('rowheader')).toHaveTextContent('B-109');
            expect(first).toHaveTextContent('$13,800,000');
            expect(first).toHaveTextContent('$0.0425');
            expect(first).toHaveTextContent('×0.981');
            expect(first).toHaveTextContent('steel');
            expect(first).toHaveTextContent('×1.10');
            expect(first).toHaveTextContent('built 1985');
            expect(first).toHaveTextContent('class 4');
            expect(first).toHaveTextContent('×0.85');
            expect(first).toHaveTextContent('sprinklered');
            expect(within(first).getByTestId('pricing-building-premium')).toHaveTextContent('$5,129.67');
            expect(within(rows[1]).getByTestId('pricing-building-premium')).toHaveTextContent('$3,146.06');
        });
        it('explains the arithmetic in words and never prints a number the DTO does not carry', () => {
            render(_jsx(Pricing, { pricing: withBuildings }));
            expect(screen.getByText(/TIV ÷ 100 × base rate × each multiplier = building premium/)).toBeInTheDocument();
            // The subtotal of building premiums (8,275.73) is not in the DTO, so it is not shown.
            expect(screen.queryByText(/8,275/)).toBeNull();
            // Account-level factors keep their own table, with a readable label.
            const account = screen.getByRole('table', { name: 'Account-level factors' });
            expect(within(account).getByText('Loss history')).toBeInTheDocument();
            expect(within(account).getByText('×1.09')).toBeInTheDocument();
        });
        it('shows no building table when the view has no per-building rating', () => {
            render(_jsx(Pricing, { pricing: base }));
            expect(screen.queryByRole('table', { name: 'Per-building rating' })).toBeNull();
            render(_jsx(Pricing, { pricing: { ...base, buildings: [] } }));
            expect(screen.queryByRole('table', { name: 'Per-building rating' })).toBeNull();
        });
    });
});
//# sourceMappingURL=Pricing.test.js.map