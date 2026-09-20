import { jsx as _jsx } from "react/jsx-runtime";
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ScoreBreakdown } from './ScoreBreakdown.js';
afterEach(() => cleanup());
/** INTERPRETATIONS W-1 weights, in factor order. */
const WEIGHTS = [
    ['submission_type', 'Submission type', 0.1],
    ['line_of_business', 'Line of business', 0.15],
    ['primary_risk_state', 'Primary risk state', 0.15],
    ['tiv', 'TIV', 0.15],
    ['total_premium', 'Total premium', 0.15],
    ['building_age', 'Building age', 0.1],
    ['construction_type', 'Construction type', 0.1],
    ['loss_value', 'Loss value', 0.1],
];
function tierLabel(t) {
    if (t === 1)
        return 'target';
    if (t === 0.6)
        return 'acceptable';
    return 'not_acceptable';
}
/** Rows as the engine emits them: points = 100 × weight × tierValue (engine FiredRule). */
function rows(tiers) {
    return WEIGHTS.map(([factorId, label, weight], i) => {
        const t = tiers[i] ?? null;
        const known = t !== null;
        return {
            factorId,
            label,
            tier: known ? tierLabel(t) : null,
            tierValue: t,
            weight,
            points: known ? 100 * weight * t : 0,
            known,
            knockout: known && t === 0,
            ruleId: known ? `AG-${factorId}` : null,
            citation: known
                ? { document: 'APPETITE_GUIDELINES.pdf', page: 2, row: label, quote: `${label} quote.` }
                : null,
        };
    });
}
/** INTERPRETATIONS B1: tiers 1,1,1,0.6,0.6,0.6,1,1 → 84.0, FIT. */
const B1 = [1, 1, 1, 0.6, 0.6, 0.6, 1, 1];
function rowFor(factorId) {
    return screen.getByTestId(`points-${factorId}`).closest('tr');
}
describe('ScoreBreakdown', () => {
    it('B1: renders all eight factors with W-1 weights and 100·w·t points, total 84.0', () => {
        render(_jsx(ScoreBreakdown, { factors: rows(B1), appetiteScore: 84, completeness: 100 }));
        expect(screen.getByRole('region', { name: 'Score breakdown' }).id).toBe('b');
        expect(screen.getAllByRole('row')).toHaveLength(1 + 8);
        const expectedPoints = {
            submission_type: '10.0',
            line_of_business: '15.0',
            primary_risk_state: '15.0',
            tiv: '9.0',
            total_premium: '9.0',
            building_age: '6.0',
            construction_type: '10.0',
            loss_value: '10.0',
        };
        for (const [id, pts] of Object.entries(expectedPoints)) {
            expect(screen.getByTestId(`points-${id}`).textContent).toBe(pts);
        }
        expect(screen.getByTestId('weight-line_of_business').textContent).toBe('0.15');
        expect(screen.getByTestId('weight-building_age').textContent).toBe('0.10');
        expect(screen.getByTestId('tier-tiv').textContent).toBe('Acceptable (0.6)');
        expect(screen.getByTestId('tier-submission_type').textContent).toBe('Target (1.0)');
        expect(screen.getByTestId('breakdown-score').textContent).toBe('84.0/100');
        expect(screen.getByTestId('breakdown-completeness').textContent).toBe('100.0%');
        expect(screen.getByTestId('breakdown-knockouts').textContent).toBe('None');
        expect(screen.getByText('8 of 8 factors known')).toBeDefined();
    });
    it('renders each citation with document, page, row, rule id and quote', () => {
        render(_jsx(ScoreBreakdown, { factors: rows(B1), appetiteScore: 84, completeness: 100 }));
        const tr = rowFor('tiv');
        expect(within(tr).getByText('AG-tiv')).toBeDefined();
        expect(tr.querySelector('cite').textContent).toBe('APPETITE_GUIDELINES.pdf · p. 2 · row TIV');
        expect(tr.querySelector('blockquote').textContent).toBe('“TIV quote.”');
    });
    it('B11: a missing premium scores 0, says Missing, and the total is the 81.0 prop', () => {
        const tiers = [...B1];
        tiers[4] = null;
        render(_jsx(ScoreBreakdown, { factors: rows(tiers), appetiteScore: 81, completeness: (8 / 9) * 100 }));
        expect(screen.getByTestId('points-total_premium').textContent).toBe('0.0');
        expect(screen.getByTestId('tier-total_premium').textContent).toBe('Missing');
        expect(within(rowFor('total_premium')).getByText('Not scored: the input is missing')).toBeDefined();
        expect(screen.getByTestId('breakdown-score').textContent).toBe('81.0/100');
        expect(screen.getByTestId('breakdown-completeness').textContent).toBe('88.9%');
        expect(screen.getByText('7 of 8 factors known')).toBeDefined();
    });
    it('B12: a knockout is labelled in words and does not zero the 86.0 score', () => {
        const tiers = [0, 1, 1, 1, 0.6, 0.6, 1, 1];
        render(_jsx(ScoreBreakdown, { factors: rows(tiers), appetiteScore: 86, completeness: 100 }));
        const tier = screen.getByTestId('tier-submission_type');
        expect(tier.textContent).toContain('Not acceptable (0.0)');
        expect(within(tier).getByText('Knockout')).toBeDefined();
        expect(screen.getByTestId('points-submission_type').textContent).toBe('0.0');
        expect(screen.getByTestId('breakdown-knockouts').textContent).toBe('1 knockout');
        expect(screen.getByTestId('breakdown-score').textContent).toBe('86.0/100');
    });
    it('prints the score prop, never a re-sum of the rows', () => {
        // Rows sum to 84 but the prop says 84.5: the panel must show the prop.
        render(_jsx(ScoreBreakdown, { factors: rows(B1), appetiteScore: 84.5, completeness: 100 }));
        expect(screen.getByTestId('breakdown-score').textContent).toBe('84.5/100');
    });
    it('shows the empty label with no factors', () => {
        render(_jsx(ScoreBreakdown, { factors: [], appetiteScore: 0, completeness: 0 }));
        expect(screen.getByText('No appetite factors were evaluated.')).toBeDefined();
    });
});
//# sourceMappingURL=ScoreBreakdown.test.js.map