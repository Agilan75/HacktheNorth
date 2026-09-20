import { jsx as _jsx } from "react/jsx-runtime";
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Filters } from './Filters';
const empty = { line: null, verdict: null, state: null, underwriter: null, search: '' };
const options = {
    lines: ['Property', 'Auto', 'Property', 'General Liability'],
    states: ['TX', 'CA', 'NY'],
    underwriters: ['Riley', 'Ana'],
};
afterEach(cleanup);
function optionLabels(select) {
    return within(select).getAllByRole('option').map((o) => o.textContent ?? '');
}
describe('Filters', () => {
    it('renders a labelled search landmark with every PRD §10 filter', () => {
        render(_jsx(Filters, { value: empty, options: options, onChange: () => { } }));
        expect(screen.getByRole('search', { name: 'Filter the queue' })).toBeInTheDocument();
        expect(screen.getByLabelText('Search')).toHaveValue('');
        expect(optionLabels(screen.getByLabelText('Line of business'))).toEqual([
            'All lines',
            'Auto',
            'General Liability',
            'Property',
        ]);
        expect(optionLabels(screen.getByLabelText('Verdict'))).toEqual(['All verdicts', 'Fit', 'Refer', 'Does not fit']);
        expect(optionLabels(screen.getByLabelText('State'))).toEqual(['All states', 'CA', 'NY', 'TX']);
        expect(optionLabels(screen.getByLabelText('Underwriter'))).toEqual(['All underwriters', 'Ana', 'Riley']);
        expect(screen.getByRole('button', { name: 'Clear filters' })).toBeDisabled();
    });
    it('emits the full next value on each change, with null for "All"', () => {
        const onChange = vi.fn();
        const value = { ...empty, state: 'TX' };
        render(_jsx(Filters, { value: value, options: options, onChange: onChange }));
        fireEvent.change(screen.getByLabelText('Verdict'), { target: { value: 'DOES_NOT_FIT' } });
        expect(onChange).toHaveBeenLastCalledWith({ ...value, verdict: 'DOES_NOT_FIT' });
        fireEvent.change(screen.getByLabelText('Line of business'), { target: { value: 'Property' } });
        expect(onChange).toHaveBeenLastCalledWith({ ...value, line: 'Property' });
        fireEvent.change(screen.getByLabelText('State'), { target: { value: '__all__' } });
        expect(onChange).toHaveBeenLastCalledWith({ ...value, state: null });
        fireEvent.change(screen.getByLabelText('Underwriter'), { target: { value: 'Ana' } });
        expect(onChange).toHaveBeenLastCalledWith({ ...value, underwriter: 'Ana' });
        fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'mills' } });
        expect(onChange).toHaveBeenLastCalledWith({ ...value, search: 'mills' });
    });
    it('reflects the current value and clears everything', () => {
        const onChange = vi.fn();
        const value = { line: 'Auto', verdict: 'REFER', state: 'NY', underwriter: 'Riley', search: 'x' };
        render(_jsx(Filters, { value: value, options: options, onChange: onChange }));
        expect(screen.getByLabelText('Verdict')).toHaveValue('REFER');
        expect(screen.getByLabelText('Line of business')).toHaveValue('Auto');
        fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
        expect(onChange).toHaveBeenCalledWith(empty);
    });
    it('keeps a selected value visible even when it is missing from the options', () => {
        render(_jsx(Filters, { value: { ...empty, state: 'ON' }, options: options, onChange: () => { } }));
        expect(screen.getByLabelText('State')).toHaveValue('ON');
    });
});
//# sourceMappingURL=Filters.test.js.map