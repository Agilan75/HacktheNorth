import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ state: { data: null, loading: false, error: null, reload: () => { } }, client: {}, lastId: '' }));
vi.mock('../api/useApi.js', () => ({
    useApiClient: () => h.client,
    useApi: (select, deps) => { h.lastId = String(deps[0]); return h.state; },
}));
const panel = vi.hoisted(() => (name) => (p) => _jsx("div", { "data-testid": name, children: JSON.stringify(p, (_k, v) => typeof v === 'function' ? 'fn' : v) }));
vi.mock('../panels/Explanation.js', () => ({ Explanation: panel('a') }));
vi.mock('../panels/ScoreBreakdown.js', () => ({ ScoreBreakdown: panel('b') }));
vi.mock('../panels/QueryTrace.js', () => ({ QueryTrace: panel('c') }));
vi.mock('../panels/Pricing.js', () => ({ Pricing: panel('d-pricing') }));
vi.mock('../panels/PeerBenchmark.js', () => ({ PeerBenchmark: panel('d-peers') }));
vi.mock('../panels/Buildings.js', () => ({ Buildings: panel('e') }));
vi.mock('../panels/Contradictions.js', () => ({ Contradictions: panel('f') }));
vi.mock('../panels/Flip.js', () => ({ Flip: () => { throw new Error('NOT_IMPLEMENTED:C10'); } }));
vi.mock('../panels/Vector.js', () => ({ Vector: panel('h') }));
vi.mock('../panels/Schema.js', () => ({ Schema: panel('i') }));
vi.mock('../panels/Enrichment.js', () => ({ Enrichment: panel('j') }));
vi.mock('../panels/Actions.js', () => ({ Actions: (p) => _jsx("button", { "data-rationale": p.routing.rationale, onClick: () => void p.onApprove('act-1'), children: "approve" }) }));
vi.mock('../panels/ReplyBox.js', () => ({ ReplyBox: (p) => _jsxs("div", { "data-testid": "k-reply", "data-pending": String(p.pending), children: [JSON.stringify(p.result), _jsx("button", { onClick: () => void p.onSubmitText('sprinklered: yes'), children: "send" })] }) }));
vi.mock('../panels/AttachedSweep.js', () => ({ AttachedSweep: panel('l') }));
import { SubmissionPage } from './SubmissionPage.js';
function detail(over = {}) {
    const pricing = { quotedPremium: 41250, predictedPremium: 50000, adequacy: 0.825, expectedLoss: 12000, ratePer100Tiv: 0.31, currency: 'USD', factors: [], notes: [] };
    return {
        submissionId: 'SUB-7', insuredName: 'Harbor Freight Storage', lineOfBusiness: 'commercial_property',
        displayLineOfBusiness: 'commercial_property', accountKind: 'scored', synthetic: false, facts: null, verification: null, verdict: 'REFER',
        appetiteScore: 81, completeness: 88.88888888888889, confidence: 0.7,
        explanation: { verdict: 'REFER', headline: 'h', paragraphs: [], recommendation: 'r', decidingFactorId: null, decidingRuleId: null, confidence: 0.7 },
        factors: [{ factorId: 'tiv', label: 'TIV', tier: 'target', tierValue: 1, weight: 0.2, points: 20, known: true, knockout: false, ruleId: 'R1', citation: null }],
        queryTrace: [], schema: null, pricing,
        peers: { peers: [], medianRatePer100Tiv: 0.29, meanAnnualLoss: 9000, comparedComponentCount: 9 },
        buildings: [], rollup: { totalTiv: 13300000, buildingCount: 3, pctTivPre1990: 0.4, pctTivPost2010: 0.1, pctTivAcceptableConstruction: 1, primaryState: 'TX', fiveYearLoss: 0 },
        contradictions: [], interpretations: [],
        flip: { available: false, reason: null, moves: [], scoreBefore: 81, scoreAfter: null, premiumBefore: null, premiumAfter: null, verdictAfter: null, distanceToAppetite: null },
        vector: { lineOfBusiness: 'commercial_property', specVersion: '1', components: [], completeness: 88.88888888888889 },
        enrichment: [], routing: { region: null, underwriter: null, authorityLimit: null, withinAuthority: null, rationale: '' },
        drafts: [], actionLog: [], sweep: null, ...over,
    };
}
function mount(path = '/submissions/SUB-7') {
    const entry = typeof path === 'string' ? path : { pathname: path.pathname, state: path.state };
    return render(_jsx(MemoryRouter, { initialEntries: [entry], children: _jsxs(Routes, { children: [_jsx(Route, { path: "/submissions/:id", element: _jsx(SubmissionPage, {}) }), _jsx(Route, { path: "/queue", element: _jsx("p", { children: "queue" }) })] }) }));
}
/**
 * Surfaces the PAGE titles itself: the decision block, the facts card, the
 * demoted <details> and the not-applicable list. A normal panel is NOT here —
 * each one renders its own `.rf-card` with its own heading, so the page no
 * longer wraps it in a second card with a duplicate title. Panels are asserted
 * by their anchors via `panelOrder()`.
 */
function panelTitles() {
    return [...document.querySelectorAll('.rf-card__title')].map((e) => e.textContent ?? '');
}
/** The panel anchors in DOM order, as single letters. */
function panelOrder() {
    return [...document.querySelectorAll('[id^="panel-"]')]
        .map((e) => e.id.slice('panel-'.length))
        .filter((id) => id.length === 1);
}
/** The plain section spines: level-2 headings that are not a panel title. */
function sectionTitles() {
    return screen.getAllByRole('heading', { level: 2 })
        .filter((e) => !e.classList.contains('rf-card__title'))
        .map((e) => e.textContent ?? '');
}
function indexNav() {
    return screen.getByRole('navigation', { name: 'Panels on this page' });
}
beforeEach(() => { h.state = { data: detail(), loading: false, error: null, reload: vi.fn() }; h.client = {}; });
afterEach(() => cleanup());
describe('SubmissionPage', () => {
    it('leads with the decision, then groups the twelve panels under three plain sections', () => {
        mount();
        expect(h.lastId).toBe('SUB-7');
        // Panels, in group order. Each supplies its own heading; the page adds none.
        expect(panelOrder()).toEqual(['a', 'b', 'd', 'e', 'h', 'c', 'f', 'l', 'j', 'i', 'g', 'k']);
        expect(panelTitles()).toEqual([
            'The decision',
            'Feature vector',
            'Enrichment',
            'Discovered schema',
        ]);
        expect(sectionTitles()).toEqual(['The numbers', 'The evidence', 'Next steps']);
        // No PRD letter index survives in the copy.
        expect(document.body.textContent).not.toMatch(/\([a-l]\)\s/);
        // The anchors other pages deep-link to are unchanged.
        for (const l of 'abcdefghijkl')
            expect(document.getElementById('panel-' + l)).not.toBeNull();
    });
    it('demotes the low-information panels to collapsed details', () => {
        mount();
        for (const l of ['h', 'i', 'j']) {
            const el = document.getElementById('panel-' + l);
            expect(el.tagName).toBe('DETAILS');
            expect(el).not.toHaveAttribute('open');
        }
        // Still rendered, so a deep link or a find-in-page still reaches the content.
        expect(screen.getByTestId('h')).toBeTruthy();
    });
    it('indexes the sections, never twelve peers, and marks the one in view', () => {
        mount();
        const links = indexNav().querySelectorAll('a');
        expect([...links].map((a) => a.textContent)).toEqual(['Decision', 'The numbers', 'The evidence', 'Next steps']);
        expect(links[0]).toHaveAttribute('aria-current', 'true');
        expect(links[1]).toHaveAttribute('href', '#section-numbers');
        // No IntersectionObserver in jsdom: the hook feature-detects and leaves the first entry active.
        expect(links.length).toBeLessThanOrEqual(8);
    });
    it('header numbers are the DTO values, formatted only', () => {
        mount();
        expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Harbor Freight Storage');
        expect(document.querySelector('[data-field=appetiteScore]').textContent).toBe('81/100');
        expect(document.querySelector('[data-field=completeness]').textContent).toBe('88.9%');
        expect(document.querySelector('[data-field=confidence]').textContent).toBe('70%');
        expect(document.querySelector('[data-verdict=REFER]')).not.toBeNull();
    });
    it('the breadcrumb returns to the queue, carrying its filter state when the link brought it', () => {
        mount();
        expect(screen.getByRole('link', { name: 'Queue' })).toHaveAttribute('href', '/queue');
        cleanup();
        mount({ pathname: '/submissions/SUB-7', state: { queueSearch: 'verdict=REFER&sort=score' } });
        expect(screen.getByRole('link', { name: 'Queue' })).toHaveAttribute('href', '/queue?verdict=REFER&sort=score');
    });
    it('steps through the queue order when the link carried it, and shows nothing when it did not', () => {
        mount();
        expect(screen.queryByRole('navigation', { name: 'Queue order' })).toBeNull();
        cleanup();
        mount({ pathname: '/submissions/SUB-7', state: { queue: ['SUB-1', 'SUB-7', 'SUB-9'] } });
        const nav = screen.getByRole('navigation', { name: 'Queue order' });
        expect(within(nav).getByRole('link', { name: /Previous/ })).toHaveAttribute('href', '/submissions/SUB-1');
        expect(within(nav).getByRole('link', { name: /Next/ })).toHaveAttribute('href', '/submissions/SUB-9');
    });
    it('passes DTO slices to panels untouched', () => {
        mount();
        const d = detail();
        expect(JSON.parse(screen.getByTestId('d-pricing').textContent)).toEqual({ pricing: d.pricing });
        expect(JSON.parse(screen.getByTestId('d-peers').textContent)).toEqual({ benchmark: d.peers });
        expect(JSON.parse(screen.getByTestId('e').textContent)).toEqual({ buildings: d.buildings, rollup: d.rollup });
        expect(JSON.parse(screen.getByTestId('b').textContent)).toEqual({ factors: d.factors, appetiteScore: 81, completeness: 88.88888888888889 });
        expect(JSON.parse(screen.getByTestId('a').textContent)).toEqual({ explanation: d.explanation, verdict: 'REFER', appetiteScore: 81 });
        expect(JSON.parse(screen.getByTestId('h').textContent)).toEqual({ vector: d.vector });
        expect(JSON.parse(screen.getByTestId('l').textContent)).toEqual({ sweep: null });
    });
    it('one throwing panel does not blank the page', () => {
        vi.spyOn(console, 'error').mockImplementation(() => { });
        mount();
        const g = document.getElementById('panel-g');
        expect(within(g).getByRole('alert').textContent).toContain('NOT_IMPLEMENTED:C10');
        expect(screen.getByTestId('h')).toBeTruthy();
    });
    it('loading shows a skeleton, error shows retry', () => {
        h.state = { data: null, loading: true, error: null, reload: vi.fn() };
        mount();
        expect(screen.getByRole('status', { name: 'Loading submission SUB-7' })).toBeTruthy();
        cleanup();
        const reload = vi.fn();
        h.state = { data: null, loading: false, error: new Error('404'), reload };
        mount();
        expect(screen.getByRole('alert').textContent).toContain('Could not load submission SUB-7: 404');
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(reload).toHaveBeenCalledTimes(1);
    });
    it('approve calls the API then reloads; reply result is shown and reloads', async () => {
        const approveAction = vi.fn().mockResolvedValue({});
        const postReply = vi.fn().mockResolvedValue({ fields: [], before: null, after: null });
        h.client = { approveAction, postReply };
        mount();
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'approve' })); });
        expect(approveAction).toHaveBeenCalledWith('act-1');
        expect(h.state.reload).toHaveBeenCalledTimes(1);
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'send' })); });
        expect(postReply).toHaveBeenCalledWith('SUB-7', { text: 'sprinklered: yes' });
        await waitFor(() => expect(screen.getByTestId('k-reply').textContent).toContain('"fields":[]'));
        expect(h.state.reload).toHaveBeenCalledTimes(2);
    });
    it('re-run shows the returned detail; failures surface as alerts', async () => {
        const runSubmission = vi.fn().mockResolvedValue(detail({ appetiteScore: 96, verdict: 'FIT', completeness: 100 }));
        const enrich = vi.fn().mockRejectedValue(new Error('boom'));
        h.client = { runSubmission, enrich };
        mount();
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Re-run agent' })); });
        expect(runSubmission).toHaveBeenCalledWith('SUB-7');
        expect(document.querySelector('[data-field=appetiteScore]').textContent).toBe('96/100');
        expect(document.querySelector('[data-field=completeness]').textContent).toBe('100.0%');
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Run enrichment' })); });
        expect(screen.getAllByRole('alert').map((e) => e.textContent)).toContain('Running enrichment failed: boom');
    });
});
/* ---------------------------------------------------------------------------
 * FILL-console: sparse accounts, the Line of business label, independent checks.
 * The facts below are SUB-2024-00008 and SUB-2025-00115 as the API serves them
 * from the committed snapshot.
 * ------------------------------------------------------------------------- */
const LOB_CITATION = { document: 'APPETITE_GUIDELINES.pdf', page: 2, row: 'p2 "Line of business"', quote: 'All other lines' };
function knockout(over = {}) {
    const base = detail();
    return detail({
        submissionId: 'SUB-2024-00008', insuredName: 'Redline Logistics Inc', lineOfBusiness: 'commercial_property',
        displayLineOfBusiness: 'health', accountKind: 'triage_knockout', verdict: 'DOES_NOT_FIT', appetiteScore: 0,
        completeness: 11.11111111111111,
        facts: {
            source: 'federato_triage', traceId: 'q-000', federatoId: 8, submissionNumber: 'SUB-2024-00008',
            insuredName: 'Redline Logistics Inc', brokerName: 'Ashford Specialty Group', underwriterName: 'A. Delgado',
            lineOfBusiness: 'health', status: 'bound', requestedLimit: 1000000, receivedDate: '2024-07-10',
            targetEffectiveDate: '2024-10-01', declineReason: null, competitor: null,
        },
        factors: [
            { factorId: 'line_of_business', label: 'Line Of Business', tier: 'not_acceptable', tierValue: 0, weight: 0.15, points: 0, known: true, knockout: true, ruleId: 'AG-LOB-NA', citation: LOB_CITATION },
            { factorId: 'tiv', label: 'Tiv', tier: null, tierValue: null, weight: 0.15, points: 0, known: false, knockout: false, ruleId: null, citation: null },
        ],
        flip: { ...base.flip, reason: 'No move over at most two movable components reaches FIT; isNewBusiness, isPropertyLine cannot be changed.' },
        routing: { region: null, underwriter: null, authorityLimit: null, withinAuthority: null, rationale: 'Not routed yet. Run the action plan to assign an underwriter.' },
        ...over,
    });
}
function noPolicyDetail(over = {}) {
    return detail({
        submissionId: 'SUB-2025-00115', insuredName: 'Halcyon Metalworks Corp', accountKind: 'no_policy',
        displayLineOfBusiness: 'commercial_property', appetiteScore: 15,
        facts: {
            source: 'federato_triage', traceId: 'q-000', federatoId: 115, submissionNumber: 'SUB-2025-00115',
            insuredName: 'Halcyon Metalworks Corp', brokerName: 'Highland Risk Partners', underwriterName: 'O. Tanaka',
            lineOfBusiness: 'property', status: 'declined', requestedLimit: 10000000, receivedDate: '2025-08-15',
            targetEffectiveDate: '2025-10-01', declineReason: 'loss_history', competitor: null,
        },
        factors: [
            { factorId: 'line_of_business', label: 'Line Of Business', tier: 'acceptable', tierValue: 0.6, weight: 0.15, points: 9, known: true, knockout: false, ruleId: 'AG-LOB-A', citation: null },
            { factorId: 'tiv', label: 'TIV', tier: null, tierValue: null, weight: 0.15, points: 0, known: false, knockout: false, ruleId: null, citation: null },
        ],
        ...over,
    });
}
const VERIFICATION = {
    caseId: 'SUB-7', generatedAt: '2026-09-19T19:30:25.951Z',
    engine: { verdict: 'REFER', appetiteScore: 81, knockoutFactorIds: [], decidingFactorId: 'building_age' },
    matchesCurrentResult: true,
    naive: { verdict: 'REFER', appetiteScore: 81, knockoutFactorIds: [], decidingFactorId: 'building_age', agrees: { verdict: true, appetiteScore: true, knockouts: true, decidingFactor: true, all: true } },
    secondOpinion: null,
};
describe('SubmissionPage for sparse accounts (FILL-console)', () => {
    it('a scored account keeps its twelve panels and shows no facts card or not-applicable list', () => {
        mount();
        expect(panelOrder()).toHaveLength(12);
        expect(screen.queryByTestId('account-facts')).toBeNull();
        expect(screen.queryByTestId('not-applicable')).toBeNull();
        expect(document.querySelector('[data-field=lineOfBusiness]').textContent).toBe('Commercial property');
    });
    it('a triage knockout leads with its facts and shows only the decision, trace and actions', () => {
        h.state = { ...h.state, data: knockout() };
        mount('/submissions/SUB-2024-00008');
        expect(panelOrder()).toEqual(['a', 'c', 'k']);
        expect(panelTitles()).toEqual(['Submission facts', 'The decision', 'Not applicable to this account']);
        expect(sectionTitles()).toEqual(['The evidence', 'Next steps']);
        expect(document.querySelector('[data-field=lineOfBusiness]').textContent).toBe('Health');
        expect(document.body.textContent).not.toMatch(/commercial[ _]property/i);
        expect(screen.getByTestId('why-not-scored').textContent).toContain('Knocked out at triage: line of business is Health.');
        expect(screen.getByTestId('why-not-scored').textContent).toContain('appetite covers property only');
        expect(screen.getByText('Knocked out at triage')).toBeTruthy();
        const na = screen.getByTestId('not-applicable');
        expect([...na.querySelectorAll('li')].map((l) => l.getAttribute('data-letter'))).toEqual(['b', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'l']);
        // The flip reason is the engine's own sentence.
        expect(na.querySelector('[data-letter=g]').textContent).toContain('isNewBusiness, isPropertyLine cannot be changed');
        expect([...indexNav().querySelectorAll('a')].map((a) => a.textContent)).toEqual(['Submission facts', 'Decision', 'The evidence', 'Next steps']);
    });
    it('the not-applicable list is a demoted, collapsed panel with no preamble', () => {
        h.state = { ...h.state, data: knockout() };
        mount('/submissions/SUB-2024-00008');
        const block = document.getElementById('panel-not-applicable');
        expect(block.tagName).toBe('DETAILS');
        expect(block.textContent).not.toMatch(/left out rather than shown empty/);
    });
    it('a knockout is never told to "run the action plan"', () => {
        h.state = { ...h.state, data: knockout() };
        mount('/submissions/SUB-2024-00008');
        const rationale = screen.getByRole('button', { name: 'approve' }).getAttribute('data-rationale');
        expect(rationale).toBe('Not routed: a submission knocked out at triage is never routed to an underwriter.');
    });
    it('a knockout panel whose data IS present (a sweep) still shows', () => {
        h.state = { ...h.state, data: knockout({ sweep: { sweepId: 's1', roomLabel: 'Lobby', stage: 'done', coverage: 80, frameCount: 12, observations: [] } }) };
        mount('/submissions/SUB-2024-00008');
        expect(panelOrder()).toContain('l');
        expect(screen.getByTestId('not-applicable').querySelector('[data-letter=l]')).toBeNull();
    });
    it('a no-policy account shows the score breakdown and the peer benchmark without pricing', () => {
        h.state = { ...h.state, data: noPolicyDetail() };
        mount('/submissions/SUB-2025-00115');
        expect(panelOrder()).toEqual(['a', 'b', 'd', 'c', 'k']);
        expect(panelTitles()).toEqual(['Submission facts', 'The decision', 'Not applicable to this account']);
        expect(screen.getByTestId('why-not-scored').textContent).toContain('Federato holds no policy for this submission');
        // The "nothing to price" fact survives as a title-side clause, not a paragraph.
        expect(screen.getByTestId('no-pricing').textContent).toBe('No premium to price');
        expect(screen.queryByTestId('d-pricing')).toBeNull();
        expect(screen.getByTestId('d-peers')).toBeTruthy();
        expect(document.querySelector('[data-fact=declineReason]').textContent).toContain('Loss history');
    });
    it('a scored account keeps the routing rationale the API gave', () => {
        mount();
        expect(screen.getByRole('button', { name: 'approve' }).getAttribute('data-rationale')).toBe('');
    });
    it('renders Independent checks inside the evidence section, linked to /verification', () => {
        h.state = { ...h.state, data: detail({ verification: VERIFICATION }) };
        mount();
        // Independent checks is the page's own card, and it follows the last panel
        // of the evidence group.
        expect(panelTitles()).toContain('Independent checks');
        expect(panelOrder()).toHaveLength(12);
        expect(document.getElementById('section-evidence').contains(document.getElementById('panel-checks'))).toBe(true);
        expect(screen.getByRole('link', { name: /How the testing works/ })).toHaveAttribute('href', '/verification');
    });
});
//# sourceMappingURL=SubmissionPage.test.js.map