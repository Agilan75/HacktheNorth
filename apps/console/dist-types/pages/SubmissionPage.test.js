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
    return render(_jsx(MemoryRouter, { initialEntries: [path], children: _jsxs(Routes, { children: [_jsx(Route, { path: "/submissions/:id", element: _jsx(SubmissionPage, {}) }), _jsx(Route, { path: "/queue", element: _jsx("p", { children: "queue" }) })] }) }));
}
beforeEach(() => { h.state = { data: detail(), loading: false, error: null, reload: vi.fn() }; h.client = {}; });
afterEach(() => cleanup());
describe('SubmissionPage', () => {
    it('renders twelve lettered panels a-l in PRD order with anchors', () => {
        mount();
        expect(h.lastId).toBe('SUB-7');
        const headings = screen.getAllByRole('heading', { level: 2 }).map((e) => e.textContent);
        expect(headings).toEqual(['(a) Explanation and recommendation', '(b) Score breakdown', '(c) How the agent got here', '(d) Pricing and peer benchmark', '(e) Buildings and rollup', '(f) Contradictions and interpretations', '(g) Minimal flip', '(h) Feature vector', '(i) Discovered schema', '(j) Enrichment', '(k) Actions', '(l) Attached photo or sweep']);
        for (const l of 'abcdefghijkl')
            expect(document.getElementById('panel-' + l)).not.toBeNull();
        expect(screen.getByRole('navigation', { name: 'Panels on this page' }).querySelectorAll('a')).toHaveLength(12);
    });
    it('header numbers are the DTO values, formatted only', () => {
        mount();
        expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Harbor Freight Storage');
        expect(document.querySelector('[data-field=appetiteScore]').textContent).toBe('81/100');
        expect(document.querySelector('[data-field=completeness]').textContent).toBe('88.9%');
        expect(document.querySelector('[data-field=confidence]').textContent).toBe('70%');
        expect(document.querySelector('[data-verdict=REFER]')).not.toBeNull();
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
function h2s() {
    return screen.getAllByRole('heading', { level: 2 }).map((e) => e.textContent);
}
describe('SubmissionPage for sparse accounts (FILL-console)', () => {
    it('a scored account keeps its twelve panels and shows no facts card or not-applicable list', () => {
        mount();
        expect(h2s()).toHaveLength(12);
        expect(screen.queryByTestId('account-facts')).toBeNull();
        expect(screen.queryByTestId('not-applicable')).toBeNull();
        expect(document.querySelector('[data-field=lineOfBusiness]').textContent).toBe('Commercial property');
    });
    it('a triage knockout leads with its facts and shows only the explanation, trace and actions', () => {
        h.state = { ...h.state, data: knockout() };
        mount('/submissions/SUB-2024-00008');
        expect(h2s()).toEqual(['Submission facts', '(a) Explanation and recommendation', '(c) How the agent got here', '(k) Actions', 'Not applicable to this account']);
        expect(document.querySelector('[data-field=lineOfBusiness]').textContent).toBe('Health');
        expect(document.body.textContent).not.toMatch(/commercial[ _]property/i);
        expect(screen.getByTestId('why-not-scored').textContent).toContain('Knocked out at triage: line of business is Health.');
        expect(screen.getByTestId('why-not-scored').textContent).toContain('appetite covers property only');
        expect(screen.getByText('Knocked out at triage')).toBeTruthy();
        const na = screen.getByTestId('not-applicable');
        expect([...na.querySelectorAll('li')].map((l) => l.getAttribute('data-letter'))).toEqual(['b', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'l']);
        // The flip reason is the engine's own sentence.
        expect(na.querySelector('[data-letter=g]').textContent).toContain('isNewBusiness, isPropertyLine cannot be changed');
        expect(screen.getByRole('navigation', { name: 'Panels on this page' }).querySelectorAll('a')).toHaveLength(4);
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
        expect(h2s()).toContain('(l) Attached photo or sweep');
        expect(screen.getByTestId('not-applicable').querySelector('[data-letter=l]')).toBeNull();
    });
    it('a no-policy account shows the score breakdown and the peer benchmark without pricing', () => {
        h.state = { ...h.state, data: noPolicyDetail() };
        mount('/submissions/SUB-2025-00115');
        expect(h2s()).toEqual(['Submission facts', '(a) Explanation and recommendation', '(b) Score breakdown', '(c) How the agent got here', '(d) Peer benchmark', '(k) Actions', 'Not applicable to this account']);
        expect(screen.getByTestId('why-not-scored').textContent).toContain('Federato holds no policy for this submission');
        expect(screen.getByTestId('no-pricing')).toBeTruthy();
        expect(screen.queryByTestId('d-pricing')).toBeNull();
        expect(screen.getByTestId('d-peers')).toBeTruthy();
        expect(document.querySelector('[data-fact=declineReason]').textContent).toContain('Loss history');
    });
    it('a scored account keeps the routing rationale the API gave', () => {
        mount();
        expect(screen.getByRole('button', { name: 'approve' }).getAttribute('data-rationale')).toBe('');
    });
    it('renders Independent checks after the panels, indexed and linked to /verification', () => {
        h.state = { ...h.state, data: detail({ verification: VERIFICATION }) };
        mount();
        const heads = h2s();
        expect(heads).toHaveLength(13);
        expect(heads[12]).toBe('Independent checks');
        expect(screen.getByRole('navigation', { name: 'Panels on this page' }).querySelectorAll('a')).toHaveLength(13);
        expect(screen.getByRole('link', { name: /How the testing works/ })).toHaveAttribute('href', '/verification');
    });
});
//# sourceMappingURL=SubmissionPage.test.js.map