import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
let client;
const getGlossary = vi.fn();
vi.mock('../api/useApi.js', () => ({
    useApiClient: () => client,
    useApi: () => {
        throw new Error('not used');
    },
}));
const { Tooltip } = await import('./Tooltip');
const glossary = {
    entries: [
        { term: 'In-Appetite', definition: 'A risk the carrier wants to write.', source: 'Federato glossary, p. 2' },
        { term: 'Premium', definition: 'The price of the policy.', source: 'Federato glossary, p. 1' },
    ],
};
async function flush() {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
}
beforeEach(() => {
    getGlossary.mockReset();
    getGlossary.mockResolvedValue(glossary);
    // A fresh client per test, so the per-client glossary cache starts empty.
    client = { getGlossary };
});
afterEach(cleanup);
describe('Tooltip', () => {
    it('is keyboard reachable and described by the glossary definition', async () => {
        render(_jsx(Tooltip, { term: "in appetite", children: "in appetite" }));
        await flush();
        const trigger = screen.getByText('in appetite');
        expect(trigger).toHaveAttribute('tabindex', '0');
        const tip = screen.getByRole('tooltip', { hidden: true });
        expect(trigger).toHaveAttribute('aria-describedby', tip.id);
        expect(tip).toHaveTextContent('A risk the carrier wants to write.');
        expect(tip).toHaveTextContent('Source: Federato glossary, p. 2.');
        expect(tip).toHaveAttribute('data-open', 'false');
        fireEvent.focus(trigger);
        expect(tip).toHaveAttribute('data-open', 'true');
        fireEvent.keyDown(trigger, { key: 'Escape' });
        expect(tip).toHaveAttribute('data-open', 'false');
        fireEvent.blur(trigger);
        fireEvent.focus(trigger);
        expect(tip).toHaveAttribute('data-open', 'true');
        fireEvent.blur(trigger);
        expect(tip).toHaveAttribute('data-open', 'false');
    });
    it('opens on hover as well as focus', async () => {
        render(_jsx(Tooltip, { term: "Premium", children: "premium" }));
        await flush();
        const tip = screen.getByRole('tooltip', { hidden: true });
        fireEvent.mouseEnter(screen.getByText('premium').parentElement);
        expect(tip).toHaveAttribute('data-open', 'true');
        fireEvent.mouseLeave(screen.getByText('premium').parentElement);
        expect(tip).toHaveAttribute('data-open', 'false');
    });
    it('matches plurals and fetches the glossary once for many tooltips', async () => {
        render(_jsxs(_Fragment, { children: [_jsx(Tooltip, { term: "Premiums", children: "a" }), _jsx(Tooltip, { term: "PREMIUM", children: "b" }), _jsx(Tooltip, { term: "In_Appetite", children: "c" })] }));
        await flush();
        const tips = screen.getAllByRole('tooltip', { hidden: true });
        expect(tips[0]).toHaveTextContent('The price of the policy.');
        expect(tips[1]).toHaveTextContent('The price of the policy.');
        expect(tips[2]).toHaveTextContent('A risk the carrier wants to write.');
        expect(getGlossary).toHaveBeenCalledTimes(1);
    });
    it('uses the fallback for an unknown term, and a plain message without one', async () => {
        render(_jsxs(_Fragment, { children: [_jsx(Tooltip, { term: "Adequacy", fallback: "Quoted premium divided by predicted premium.", children: "x" }), _jsx(Tooltip, { term: "Nonsense", children: "y" })] }));
        await flush();
        const tips = screen.getAllByRole('tooltip', { hidden: true });
        expect(tips[0]).toHaveTextContent('Quoted premium divided by predicted premium.');
        expect(tips[0]).toHaveAttribute('data-status', 'missing');
        expect(tips[1]).toHaveTextContent('No glossary entry for “Nonsense”.');
    });
    it('falls back when the glossary request fails, and retries on the next mount', async () => {
        getGlossary.mockRejectedValueOnce(new Error('down'));
        const first = render(_jsx(Tooltip, { term: "Premium", fallback: "Price", children: "p" }));
        await flush();
        expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent('Price');
        first.unmount();
        render(_jsx(Tooltip, { term: "Premium", children: "p" }));
        await flush();
        expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent('The price of the policy.');
        expect(getGlossary).toHaveBeenCalledTimes(2);
    });
});
//# sourceMappingURL=Tooltip.test.js.map