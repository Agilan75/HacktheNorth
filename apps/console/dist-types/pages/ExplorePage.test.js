import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
/*
 * WebGL cannot run in jsdom, so both scenes are replaced with inert stubs and
 * `webglAvailable` is forced true. What is under test is the page's chrome:
 * the mode segmented control, the search params it writes, and the key.
 */
const scene = { setData: vi.fn(), resetView: vi.fn(), dispose: vi.fn() };
// App.tsx is the route table and imports every page, so importing it from a
// page test is a cycle. Only the two constants this page uses are needed.
vi.mock('../App.js', () => ({
    ROUTES: { queue: '/queue' },
    submissionPath: (id) => `/submissions/${id}`,
}));
vi.mock('./explore-scene.js', () => ({
    createExploreScene: () => scene,
    webglAvailable: () => true,
}));
vi.mock('./explore-terrain.js', () => ({
    createTerrainScene: () => scene,
    terrainAccountOf: () => null,
    bandLabel: () => 'band',
}));
const ROWS = [
    {
        submissionId: 'SUB-1',
        insuredName: 'Northwind Mills',
        verdict: 'FIT',
        appetiteScore: 82,
        quotedPremium: 120_000,
        predictedPremium: 110_000,
        adequacy: 1.09,
        totalTiv: 42_000_000,
        lineOfBusiness: 'Property',
        primaryState: 'ON',
        assignedUnderwriter: 'A. Chen',
        explanationLine: 'Inside every band.',
        outOfAppetiteLine: false,
        synthetic: false,
    },
];
const queueState = {
    data: ROWS,
    loading: false,
    error: null,
    reload: () => undefined,
};
vi.mock('../api/useApi.js', () => ({
    useApi: (select) => {
        void select;
        return queueState;
    },
    useApiClient: () => ({
        getSubmission: () => new Promise(() => undefined),
    }),
}));
const { ExplorePage } = await import('./ExplorePage.js');
let search = '';
function Probe() {
    search = useLocation().search;
    return _jsx("span", { "data-testid": "search", children: search });
}
function renderPage(initial = '/explore') {
    render(_jsxs(MemoryRouter, { initialEntries: [initial], children: [_jsx(Probe, {}), _jsx(ExplorePage, {})] }));
}
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});
describe('ExplorePage', () => {
    it('renders the three modes as one segmented control, terrain pressed', () => {
        renderPage();
        const group = screen.getByRole('group', { name: 'View' });
        const buttons = within(group).getAllByRole('button');
        expect(buttons.map((b) => b.textContent)).toEqual(['Appetite terrain', '3D scatter', 'Network']);
        expect(buttons[0]?.getAttribute('aria-pressed')).toBe('true');
    });
    it('writes the mode to the search params, and the default mode clears it', () => {
        renderPage();
        const group = screen.getByRole('group', { name: 'View' });
        fireEvent.click(within(group).getByRole('button', { name: 'Network' }));
        expect(new URLSearchParams(search).get('mode')).toBe('network');
        expect(within(group).getByRole('button', { name: 'Network' }).getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(within(group).getByRole('button', { name: 'Appetite terrain' }));
        expect(new URLSearchParams(search).get('mode')).toBe(null);
    });
    it('reads the mode back out of the URL', () => {
        renderPage('/explore?mode=scatter');
        const group = screen.getByRole('group', { name: 'View' });
        expect(within(group).getByRole('button', { name: '3D scatter' }).getAttribute('aria-pressed')).toBe('true');
    });
    it('puts the selected account in the search params', () => {
        renderPage();
        expect(new URLSearchParams(search).get('account')).toBe('SUB-1');
    });
    it('writes includeOther as other=0 when unticked', () => {
        renderPage();
        fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
        const box = screen.getByRole('checkbox', { name: /Include other lines/ });
        fireEvent.click(box);
        expect(new URLSearchParams(search).get('other')).toBe('0');
    });
    it('renders a key with a verdict entry per verdict plus the terrain entries', () => {
        renderPage();
        const key = screen.getByRole('list', { name: 'Key' });
        const text = within(key)
            .getAllByRole('listitem')
            .map((li) => li.textContent ?? '');
        expect(text.some((t) => t.includes('Fits appetite'))).toBe(true);
        expect(text.some((t) => t.includes('Refer'))).toBe(true);
        for (const label of ['Appetite height', 'Nearest fit', 'Priced accounts']) {
            expect(text.some((t) => t.includes(label))).toBe(true);
        }
    });
    it('swaps in the scatter key entries with the mode', () => {
        renderPage('/explore?mode=scatter');
        const key = screen.getByRole('list', { name: 'Key' });
        const text = within(key)
            .getAllByRole('listitem')
            .map((li) => li.textContent ?? '');
        expect(text).toContain('Synthetic data');
        expect(text).toContain('100% adequacy');
        expect(text).not.toContain('Appetite height');
    });
});
//# sourceMappingURL=ExplorePage.test.js.map