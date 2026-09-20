import { jsx as _jsx } from "react/jsx-runtime";
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
let rulesState;
let verificationState;
vi.mock('../api/useApi.js', () => ({
    useApi: (select) => {
        // The selector names which endpoint it wants; we answer by probe.
        let asked = '';
        const probe = new Proxy({}, {
            get: (_t, prop) => {
                asked = prop;
                return () => Promise.resolve(null);
            },
        });
        void select(probe);
        return asked === 'getVerification' ? verificationState : rulesState;
    },
    useApiClient: () => ({}),
}));
const rule = (id, factor, tier, weight, quote) => ({
    id,
    factor,
    tier,
    weight,
    when: [{ field: factor, op: 'over', value: 150_000_000 }],
    citation: { doc: 'APPETITE_GUIDELINES.pdf', section: 'TIV', quote },
});
const RULES_PAYLOAD = {
    // Shaped like the deployed response: three books, plus the weights record the
    // API client's type drops.
    weights: { tiv: 0.15, building_age: 0.1 },
    rulebooks: [
        {
            id: 'commercial',
            label: 'Federato appetite guidelines — commercial property',
            rules: [
                rule('AG-TIV-T', 'tiv', 'target', 0.15, 'TIV between $50M and $100M'),
                rule('AG-TIV-NA', 'tiv', 'not_acceptable', 0.15, 'TIV over $150M'),
                rule('AG-AGE-A', 'building_age', 'acceptable', 0.1, 'Buildings 1990 or newer'),
                { id: 'MALFORMED' },
            ],
        },
        {
            id: 'tenant',
            label: 'Tenant rulebook (Retrofit)',
            rules: [
                rule('T-HZ-HEATER', 'hazard_portable_heater', 'acceptable', undefined, 'A portable heater'),
            ],
        },
        {
            id: 'extensions',
            label: 'Retrofit extensions (ours, not Federato’s)',
            isExtension: true,
            rules: [rule('RF-SPR-1', 'sprinkler', 'refer', undefined, 'Sprinklered: unknown')],
        },
    ],
    interpretations: [
        { id: 'I-1', title: 'Primary risk state', decision: 'The state with the largest share of TIV' },
    ],
};
import { TourPage } from './TourPage.js';
import { ANCHOR_IDS, webglAvailable } from './tour-house.js';
beforeEach(() => {
    rulesState = { data: RULES_PAYLOAD, loading: false, error: null, reload: () => { } };
    verificationState = { data: null, loading: true, error: null, reload: () => { } };
});
afterEach(cleanup);
const renderPage = () => {
    render(_jsx(MemoryRouter, { children: _jsx(TourPage, {}) }));
};
describe('TourPage story', () => {
    it('has no WebGL under jsdom, and is a plain readable document without it', () => {
        // The guarantee: the 3D is background. Nothing the page says depends on it.
        expect(webglAvailable()).toBe(false);
        renderPage();
        expect(screen.getByRole('heading', { level: 1, name: /Pan your camera around your room/ })).toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 2, name: 'Gemini sees and labels objects.' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 2, name: 'The engine deterministically decides.' })).toBeInTheDocument();
    });
    it('keeps exactly one h1, and labels every beat', () => {
        const { container } = render(_jsx(MemoryRouter, { children: _jsx(TourPage, {}) }));
        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
        const beats = container.querySelectorAll('.rf-tour__beat');
        // 7 in the apartment, then one that lifts out of it. The rail keeps three
        // stops past that; the story no longer uses them.
        expect(beats).toHaveLength(8);
        for (const beat of beats)
            expect(beat).toHaveAttribute('aria-labelledby');
    });
    it('carries a badge element for every anchor the scene knows, hidden from the reader', () => {
        const { container } = render(_jsx(MemoryRouter, { children: _jsx(TourPage, {}) }));
        expect(container.querySelectorAll('.rf-tour__badge')).toHaveLength(ANCHOR_IDS.length);
        expect(container.querySelector('.rf-tour__stage')).toHaveAttribute('aria-hidden', 'true');
    });
});
describe('TourPage dossier', () => {
    it('indexes the three sections and renders each as a region', () => {
        renderPage();
        const index = within(screen.getByRole('navigation', { name: 'Sections' }));
        expect(index.getByRole('link', { name: 'Rulebook & weights' })).toHaveAttribute('href', '#rules');
        // Architecture is gone: the camera rail above tells that story now.
        expect(index.queryByRole('link', { name: 'Architecture' })).toBeNull();
        expect(screen.queryByRole('region', { name: 'Architecture' })).toBeNull();
        for (const name of [
            'The rulebook, with its weights',
            'The Federato agent',
            'Testing, and what we did not prove',
        ]) {
            expect(screen.getByRole('region', { name })).toBeInTheDocument();
        }
    });
    it('collapses every panel except the deliberate ones, and opens them all on demand', async () => {
        const { container } = render(_jsx(MemoryRouter, { children: _jsx(TourPage, {}) }));
        const panels = [...container.querySelectorAll('.rf-tour__panel')];
        expect(panels.length).toBeGreaterThan(10);
        // Most of the page starts closed: that is the whole point of the dossier.
        expect(panels.filter((p) => p.open).length).toBeLessThan(panels.length / 2);
        const section = screen.getByRole('region', { name: 'The Federato agent' });
        const openAll = within(section).getByRole('button', { name: 'Open all' });
        openAll.click();
        const inSection = [...section.querySelectorAll('details')];
        expect(inSection.every((p) => p.open)).toBe(true);
        within(section).getByRole('button', { name: 'Close all' }).click();
        expect(inSection.some((p) => p.open)).toBe(false);
    });
    it('derives the weight matrix from the live rules response, not from the page', () => {
        renderPage();
        const rules = screen.getByRole('region', { name: 'The rulebook, with its weights' });
        // tiv carries 0.15 across both its rules; buildingAge 0.10. 25% accounted for.
        expect(within(rules).getByText('25%')).toBeInTheDocument();
        expect(within(rules).getByRole('row', { name: /Total insured value/ })).toHaveTextContent('15%');
        expect(within(rules).getByRole('row', { name: /Building age/ })).toHaveTextContent('10%');
        // The malformed rule is dropped rather than rendered or crashed on.
        expect(within(rules).queryByText('MALFORMED')).toBeNull();
        // Each rulebook stays in its own panel: only the commercial one scores.
        expect(within(rules).getByText(/never scores an account/)).toBeInTheDocument();
        expect(within(rules).getByText(/prices a room, never an account/)).toBeInTheDocument();
        // A hazard factor id is humanised rather than shown raw.
        expect(within(rules).getByText(/Portable Heater \(hazard\)/)).toBeInTheDocument();
    });
    it('shows the rulebook error state with a retry when the API is down', () => {
        rulesState = {
            data: null,
            loading: false,
            error: new Error('fetch failed'),
            reload: () => { },
        };
        renderPage();
        const rules = screen.getByRole('region', { name: 'The rulebook, with its weights' });
        expect(within(rules).getByText(/fetch failed/)).toBeInTheDocument();
        expect(within(rules).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    });
    it('leaves the agent section a readable document with no WebGL', () => {
        const { container } = render(_jsx(MemoryRouter, { children: _jsx(TourPage, {}) }));
        const agent = screen.getByRole('region', { name: 'The Federato agent' });
        // The six steps are the content, and they are here whether or not the
        // graph beside them can run.
        const steps = [...agent.querySelectorAll('.rf-tour__panel > summary')].map((s) => s.textContent?.trim());
        expect(steps.filter((t) => /^[1-6] · /.test(t ?? ''))).toHaveLength(6);
        expect(within(agent).getByText(/158 submissions for id, status and line of business/))
            .toBeInTheDocument();
        // jsdom has no WebGL, so the stage never mounts: no canvas, no badges, and
        // the section keeps its ordinary single-column shape.
        expect(container.querySelector('canvas')).toBeNull();
        expect(agent.querySelector('.rf-agent__stage--live')).toBeNull();
        expect(agent.querySelectorAll('.rf-agent__badge')).toHaveLength(0);
    });
    it('opens each agent step without a scene to drive', () => {
        const { container } = render(_jsx(MemoryRouter, { children: _jsx(TourPage, {}) }));
        const agent = screen.getByRole('region', { name: 'The Federato agent' });
        const panels = [...agent.querySelectorAll('.rf-tour__panel')];
        expect(panels).toHaveLength(6);
        // Opening a panel reports the step to a scene that does not exist here.
        // It must be a no-op rather than a crash, which is the whole fallback.
        for (const panel of panels) {
            panel.open = true;
            panel.dispatchEvent(new Event('toggle'));
        }
        expect(panels.every((p) => p.open)).toBe(true);
        expect(container.querySelector('canvas')).toBeNull();
    });
    it('leaves the agent panels closed and unhighlighted with no scene', async () => {
        render(_jsx(MemoryRouter, { children: _jsx(TourPage, {}) }));
        const agent = screen.getByRole('region', { name: 'The Federato agent' });
        const panels = [...agent.querySelectorAll('.rf-tour__panel')];
        for (const panel of panels)
            panel.open = false;
        window.dispatchEvent(new Event('scroll'));
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
        // Scrolling neither expands nor highlights: the film drives the highlight,
        // and jsdom has no WebGL, so there is no film and nothing moves.
        expect(panels.some((panel) => panel.open)).toBe(false);
        expect(agent.querySelector('.rf-tour__panel--active')).toBeNull();
    });
    it('ends on the ways into the console', () => {
        renderPage();
        expect(screen.getByRole('link', { name: 'The ranked book' })).toHaveAttribute('href', '/queue');
        expect(screen.getByRole('link', { name: 'Appetite terrain in 3D' })).toHaveAttribute('href', '/explore');
        expect(screen.getByRole('link', { name: 'Verification' })).toHaveAttribute('href', '/verification');
    });
});
//# sourceMappingURL=TourPage.test.js.map