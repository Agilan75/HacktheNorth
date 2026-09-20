import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
let apiState;
const reload = vi.fn();
vi.mock('../api/useApi.js', () => ({
    useApi: () => apiState,
    useApiClient: () => {
        throw new Error('not used');
    },
}));
const { RulesPage } = await import('./RulesPage');
const citation = (section, quote) => ({
    doc: 'APPETITE_GUIDELINES.pdf',
    section,
    quote,
});
/* Shapes and values copied from packages/engine/rules/*.json. */
const rulebooks = [
    {
        id: 'commercial',
        label: 'Commercial property appetite',
        version: '1.0.0',
        isExtension: false,
        rules: [
            {
                id: 'AG-TIV-T',
                lineOfBusiness: 'commercial_property',
                factor: 'tiv',
                tier: 'target',
                when: [
                    { field: 'totalTiv', op: 'gte', value: 50000000 },
                    { field: 'totalTiv', op: 'lte', value: 100000000 },
                ],
                weight: 0.2,
                citation: citation('p2 "TIV"', '$50M-$100M'),
            },
            {
                id: 'AG-TIV-N',
                lineOfBusiness: 'commercial_property',
                factor: 'tiv',
                tier: 'not_acceptable',
                when: [{ field: 'totalTiv', op: 'gt', value: 150000000 }],
                weight: 0.2,
                citation: citation('p2 "TIV"', 'Over $150M'),
            },
            {
                id: 'AG-ST-A',
                lineOfBusiness: 'commercial_property',
                factor: 'submission_type',
                tier: 'acceptable',
                when: [{ field: 'isNewBusiness', op: 'eq', value: 1 }],
                weight: 0.1,
                citation: citation('p2 "Submission type"', 'New business'),
                interpretation: 'Target column is blank, so Acceptable scores 1 (INTERPRETATIONS T-BLANK).',
            },
            {
                id: 'AG-AGE-N',
                lineOfBusiness: 'commercial_property',
                factor: 'building_age',
                tier: 'not_acceptable',
                when: [{ field: 'pctTivPre1990', op: 'gt', value: 0.5 }],
                weight: 0.1,
                citation: citation('p2 "Building age"', 'Older than 1990'),
            },
            { id: 'BROKEN', factor: 'tiv' },
        ],
    },
    {
        id: 'extensions',
        label: 'Extensions',
        version: '1.0.0',
        isExtension: true,
        rules: [
            {
                id: 'X-SPRINKLER-MAJORITY',
                lineOfBusiness: 'commercial_property',
                factor: 'sprinkler_protection',
                tier: 'target',
                when: [{ field: 'pctTivSprinklered', op: 'gte', value: 0.5 }],
                citation: {
                    doc: 'Retrofit extension rules',
                    section: 'Sprinkler protection',
                    quote: 'At least 50% of TIV sprinklered.',
                },
                ratingFactor: 'sprinkler.sprinklered',
                extension: true,
            },
        ],
    },
];
const interpretations = [
    {
        id: 'I-2',
        title: 'Building age mirrors the construction wording',
        decision: 'Not Acceptable when more than 50% of TIV is in buildings built before 1990.',
        affects: ['pctTivPre1990'],
    },
];
function ready() {
    return { data: { rulebooks, interpretations }, loading: false, error: null, reload };
}
let lastSearch = '';
function Probe() {
    lastSearch = useLocation().search;
    return _jsx("span", { "data-testid": "search", children: lastSearch });
}
function renderPage() {
    render(_jsxs(MemoryRouter, { initialEntries: ['/rules'], children: [_jsx(RulesPage, {}), _jsx(Probe, {})] }));
}
afterEach(cleanup);
describe('RulesPage criteria matrix', () => {
    it('lays each rulebook out as factor rows against tier columns, in the appetite table order', () => {
        apiState = ready();
        renderPage();
        const book = screen.getByRole('region', { name: 'Commercial property appetite' });
        expect(within(book).getByText('v1.0.0 · 4 rules')).toBeInTheDocument();
        // Only the tiers this rulebook uses get a column; `refer` has no rule here.
        const columns = within(book)
            .getAllByRole('columnheader')
            .map((h) => h.textContent ?? '');
        expect(columns[0]).toBe('Factor');
        expect(columns[1]).toBe('Weight');
        expect(columns[2]).toContain('Target');
        expect(columns[3]).toContain('Acceptable');
        expect(columns[4]).toContain('Not acceptable');
        expect(columns.some((c) => c.startsWith('Refer'))).toBe(false);
        // submission_type precedes tiv in the appetite table even though tiv is first in the file.
        const rows = within(book)
            .getAllByRole('rowheader')
            .map((h) => h.textContent);
        expect(rows).toEqual(['Submission type', 'TIV', 'Building age']);
    });
    it('states each criterion as a threshold, not as a raw condition', () => {
        apiState = ready();
        renderPage();
        const book = screen.getByRole('region', { name: 'Commercial property appetite' });
        // A pair of bounds on one field collapses into a single range.
        expect(within(book).getByRole('button', { name: /AG-TIV-T/ })).toHaveTextContent('$50.0M–$100.0M');
        expect(within(book).getByRole('button', { name: /AG-TIV-N/ })).toHaveTextContent('over $150.0M');
        // A 0/1 field reads as the thing it means.
        expect(within(book).getByRole('button', { name: /AG-ST-A/ })).toHaveTextContent('New business');
        // A percentage always names what it is a percentage of.
        const age = within(book).getByRole('button', { name: /AG-AGE-N/ });
        expect(age).toHaveTextContent('over 50%');
        expect(age).toHaveTextContent('of TIV built before 1990');
        // The weight column carries the factor weight once, not once per rule.
        expect(within(book).getByText('20%')).toBeInTheDocument();
        // submission_type and building_age both weigh 10%; tiv's two rules share one 20% cell.
        expect(within(book).getAllByText('10%')).toHaveLength(2);
        // A malformed rule is dropped rather than crashing the page.
        expect(screen.queryByRole('button', { name: /BROKEN/ })).toBeNull();
    });
    it('opens one criterion at a time, into the URL, with its citation and interpretation', () => {
        apiState = ready();
        renderPage();
        expect(screen.queryByRole('group', { name: 'Rule AG-ST-A' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /AG-ST-A/ }));
        expect(lastSearch).toBe('?rule=AG-ST-A');
        const detail = screen.getByRole('group', { name: 'Rule AG-ST-A' });
        expect(within(detail).getByText('Acceptable')).toBeInTheDocument();
        expect(within(detail).getByText('isNewBusiness = 1')).toBeInTheDocument();
        expect(within(detail).getByText('“New business”')).toBeInTheDocument();
        expect(within(detail).getByText('APPETITE_GUIDELINES.pdf · p2 "Submission type"')).toBeInTheDocument();
        expect(detail).toHaveTextContent('Interpretation: Target column is blank');
        expect(screen.getByRole('button', { name: /AG-ST-A/ })).toHaveAttribute('aria-expanded', 'true');
        // Opening another closes the first.
        fireEvent.click(screen.getByRole('button', { name: /AG-TIV-T/ }));
        expect(lastSearch).toBe('?rule=AG-TIV-T');
        expect(screen.queryByRole('group', { name: 'Rule AG-ST-A' })).toBeNull();
        expect(screen.getByRole('group', { name: 'Rule AG-TIV-T' })).toBeInTheDocument();
        // Clicking the open one again closes it and clears the parameter.
        fireEvent.click(screen.getByRole('button', { name: /AG-TIV-T/ }));
        expect(lastSearch).toBe('');
        expect(screen.queryByRole('group', { name: 'Rule AG-TIV-T' })).toBeNull();
    });
    it('opens the rule named in the URL on arrival, so a verdict can link straight at it', () => {
        apiState = ready();
        render(_jsx(MemoryRouter, { initialEntries: ['/rules?rule=AG-TIV-N'], children: _jsx(RulesPage, {}) }));
        expect(screen.getByRole('group', { name: 'Rule AG-TIV-N' })).toBeInTheDocument();
    });
    it('keeps the extension rulebook separate, labelled, and without a weight column', () => {
        apiState = ready();
        renderPage();
        const ext = screen.getByRole('region', { name: 'Extensions' });
        expect(ext).toHaveTextContent('they never touch the appetite score');
        expect(within(ext)
            .getAllByRole('columnheader')
            .map((h) => h.textContent)).not.toContain('Weight');
        fireEvent.click(within(ext).getByRole('button', { name: /X-SPRINKLER-MAJORITY/ }));
        const detail = screen.getByRole('group', { name: 'Rule X-SPRINKLER-MAJORITY' });
        expect(within(detail).getByText('Ours, not Federato’s')).toBeInTheDocument();
        expect(within(detail).getByText('sprinkler.sprinklered')).toBeInTheDocument();
        const commercial = screen.getByRole('region', { name: 'Commercial property appetite' });
        expect(within(commercial).queryByRole('button', { name: /X-SPRINKLER/ })).toBeNull();
    });
    it('lists the interpretations the rulebooks applied', () => {
        apiState = ready();
        renderPage();
        const card = screen.getByRole('region', { name: 'Where the guidelines were ambiguous' });
        expect(card).toHaveTextContent('Building age mirrors the construction wording');
        expect(card).toHaveTextContent('pctTivPre1990');
    });
    it('shows a skeleton while loading and a retry on error', () => {
        apiState = { data: null, loading: true, error: null, reload };
        const { unmount } = render(_jsx(MemoryRouter, { children: _jsx(RulesPage, {}) }));
        expect(screen.getByRole('status', { name: 'Loading the rulebooks' })).toBeInTheDocument();
        unmount();
        apiState = { data: null, loading: false, error: new Error('500'), reload };
        render(_jsx(MemoryRouter, { children: _jsx(RulesPage, {}) }));
        expect(screen.getByRole('alert')).toHaveTextContent('The rulebooks could not be loaded: 500');
    });
});
//# sourceMappingURL=RulesPage.test.js.map