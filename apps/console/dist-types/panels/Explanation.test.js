import { jsx as _jsx } from "react/jsx-runtime";
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Explanation } from './Explanation.js';
afterEach(() => cleanup());
function view(overrides = {}) {
    return {
        verdict: 'REFER',
        headline: 'In appetite on TIV and state, out on premium.',
        paragraphs: [
            'Scores 81.0 of 100 with total premium missing.',
            '',
            'Completeness is 88.9%, so the account is referred.',
        ],
        recommendation: 'Investigate: request the quoted premium from the broker.',
        decidingFactorId: 'building_age',
        decidingRuleId: 'AG-building_age-acceptable',
        confidence: 0.7,
        ...overrides,
    };
}
describe('Explanation', () => {
    it('renders headline, non-empty paragraphs, recommendation and panel anchor', () => {
        const { container } = render(_jsx(Explanation, { explanation: view(), verdict: "REFER", appetiteScore: 81 }));
        expect(screen.getByRole('region', { name: 'Explanation and recommendation' }).id).toBe('a');
        expect(screen.getByTestId('explanation-headline').textContent).toBe('In appetite on TIV and state, out on premium.');
        const paras = container.querySelectorAll('.rf-explanation__paragraph');
        expect(paras).toHaveLength(2);
        expect(paras[0].textContent).toBe('Scores 81.0 of 100 with total premium missing.');
        expect(screen.getByTestId('explanation-recommendation').textContent).toBe('Investigate: request the quoted premium from the broker.');
    });
    it('prints the score, confidence and deciding rule from props without recomputing', () => {
        render(_jsx(Explanation, { explanation: view(), verdict: "REFER", appetiteScore: 81 }));
        expect(screen.getByTestId('explanation-score').textContent).toBe('81.0/100');
        // V-7: broker-typed field confidence 0.7.
        expect(screen.getByTestId('explanation-confidence').textContent).toBe('70%');
        expect(screen.getByTestId('explanation-deciding-factor').textContent).toBe('Building age');
        expect(screen.getByTestId('explanation-deciding-rule').textContent).toBe('AG-building_age-acceptable');
    });
    it('shows the verdict pill with its word and the deciding factor as detail', () => {
        const { container } = render(_jsx(Explanation, { explanation: view(), verdict: "REFER", appetiteScore: 81 }));
        const pill = container.querySelector('.rf-pill');
        expect(pill.getAttribute('data-verdict')).toBe('REFER');
        expect(pill.querySelector('.rf-pill__word').textContent).toBe('REFER');
        expect(pill.querySelector('.rf-pill__detail').textContent).toBe(' · Building age');
    });
    it('B1 FIT at 84.0 with confidence 1 and no deciding rule', () => {
        const { container } = render(_jsx(Explanation, { explanation: view({ verdict: 'FIT', decidingRuleId: null, confidence: 1 }), verdict: "FIT", appetiteScore: 84 }));
        expect(screen.getByTestId('explanation-score').textContent).toBe('84.0/100');
        expect(screen.getByTestId('explanation-confidence').textContent).toBe('100%');
        expect(screen.queryByTestId('explanation-deciding-rule')).toBeNull();
        expect(container.querySelector('.rf-pill--fit')).not.toBeNull();
    });
    it('V-8 (c): no deciding factor when every appetite factor is missing', () => {
        const { container } = render(_jsx(Explanation, { explanation: view({ decidingFactorId: null, decidingRuleId: null, recommendation: '  ' }), verdict: "DOES_NOT_FIT", appetiteScore: 0 }));
        expect(screen.getByTestId('explanation-deciding-factor').textContent).toBe('None: every appetite factor is missing');
        expect(container.querySelector('.rf-pill__detail')).toBeNull();
        expect(container.querySelector('.rf-pill__word').textContent).toBe('DOES NOT FIT');
        expect(screen.getByTestId('explanation-recommendation').textContent).toBe('No recommendation recorded.');
    });
});
//# sourceMappingURL=Explanation.test.js.map