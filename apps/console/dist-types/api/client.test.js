import { describe, expect, it } from 'vitest';
import { createApiClient } from './client';
/** Routes `METHOD path` (query stripped) to a canned JSON body. */
function fakeFetch(routes) {
    const calls = [];
    const impl = (async (input, init) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
        const call = { url, method, body };
        calls.push(call);
        const path = new URL(url).pathname;
        const handler = routes[`${method} ${path}`];
        if (handler === undefined) {
            return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: `no route ${path}` } }), { status: 404 });
        }
        const { status, body: out } = typeof handler === 'function' ? handler(call) : { status: 200, body: handler };
        return new Response(JSON.stringify(out), { status });
    });
    return { impl, calls };
}
const citation = { doc: 'APPETITE_GUIDELINES.pdf', section: 'p2 "TIV (Total Insured Value)"', quote: '$50M - $100M' };
function snapshot(appetiteScore, verdict, rank) {
    return { appetiteScore, verdict, completeness: 100, confidence: 0.7, predictedPremium: 160000, qualityIndex: 79.7, rank };
}
function action(overrides = {}) {
    return {
        id: 'act-1',
        submissionId: 'sub-1',
        externalId: 'POL-1',
        insuredName: 'Buckeye Tool & Die',
        type: 'request',
        status: 'draft',
        actor: 'code',
        triggers: ['missing_data'],
        fields: [
            { canonicalPath: 'pricing.quotedPremium', componentKey: 'quotedPremium', label: 'Quoted premium', why: '', factor: 'total_premium', ruleId: null, currentValue: null, severity: 'HIGH' },
        ],
        draft: 'Please send the quoted premium.',
        recipient: null,
        routing: null,
        sourceText: null,
        extracted: [],
        before: snapshot(81, 'REFER', 7),
        after: null,
        rankBefore: 7,
        rankAfter: null,
        note: null,
        createdAt: '2026-09-19T12:00:00.000Z',
        ...overrides,
    };
}
/**
 * The active spec as GET /submissions/:id now carries it (C01). Only the
 * columns the console reads are filled; one label differs from the old
 * private copy so the test proves the label comes from the DTO.
 */
const VECTOR_SPEC = {
    lineOfBusiness: 'commercial_property',
    version: '1.0.0',
    components: [
        ['isNewBusiness', 'New business', true, true],
        ['isPropertyLine', 'Property line of business', true, true],
        ['stateTier', 'Primary risk state tier', true, true],
        ['totalTiv', 'Total insured value (from the DTO)', false, true],
        ['quotedPremium', 'Quoted total premium', false, true],
        ['pctTivPre1990', 'Share of TIV built before 1990', true, true],
        ['pctTivPost2010', 'Share of TIV built in 2010 or later', true, true],
        ['pctTivAcceptableConstruction', 'Share of TIV in acceptable construction classes', false, true],
        ['fiveYearLoss', 'Five-year loss value', true, true],
        ['pctTivSprinklered', 'Share of TIV sprinklered', false, false],
        ['tivWeightedProtectionClass', 'TIV-weighted public protection class', true, false],
    ].map(([key, label, immovable, appetiteFactor], index) => ({ index, key, label, immovable, appetiteFactor })),
};
/** B1 (INTERPRETATIONS §8): tiers 1,1,1,0.6,0.6,0.6,1,1 -> 84, FIT. */
function detailDto() {
    const weights = [0.1, 0.15, 0.15, 0.15, 0.15, 0.1, 0.1, 0.1];
    const tiers = [1, 1, 1, 0.6, 0.6, 0.6, 1, 1];
    const ids = ['submission_type', 'line_of_business', 'primary_risk_state', 'tiv', 'total_premium', 'building_age', 'construction_type', 'loss_value'];
    const factors = ids.map((factor, i) => ({
        factor,
        componentKeys: [],
        tier: tiers[i] === 1 ? 'target' : 'acceptable',
        tierValue: tiers[i],
        weight: weights[i],
        points: 100 * weights[i] * tiers[i],
        known: true,
        knockout: false,
        refer: false,
        ruleId: `commercial.${factor}`,
        citation,
    }));
    const rollup = {
        totalTiv: 150000000,
        buildingCount: 2,
        tivKnownBuildingCount: 2,
        pctTivPre1990: 0,
        pctTivPost2010: 0,
        pctTivByConstruction: [],
        pctTivAcceptableConstruction: 0.5,
        pctTivSprinklered: 0.5,
        tivWeightedProtectionClass: 4,
        primaryState: 'OH',
        stateShares: [],
        fiveYearLoss: 100000,
        fiveYearClaimCount: 1,
        claimCount: 1,
        pre1990BuildingIds: [],
        oldestYearBuilt: 1995,
        newestYearBuilt: 2004,
        lossWindow: null,
    };
    const price = {
        lineOfBusiness: 'commercial_property',
        currency: 'USD',
        predictedPremium: 160000,
        predictedMonthlyPremium: null,
        termMonths: null,
        perBuilding: [],
        factors: [{ name: 'Construction', input: 'Joisted Masonry', factor: 1.05 }],
        lossHistoryFactor: 1.02,
        expectedAnnualLoss: 20000,
        expectedLossDetail: null,
        quotedPremium: 175000,
        adequacy: 1.09375,
        ratePer100: 0.10666666666666667,
        basis: 'fitted',
        fitError: null,
        estimate: false,
    };
    const vector = {
        lineOfBusiness: 'commercial_property',
        specVersion: '1.0.0',
        x: [1, 1, 1, 150000000, 175000, 0, 0, 0.5, 100000, null, 4],
        t: [1, 1, 1, 0.6, 0.6, 0.6, 0.6, 1, 1, null, 4],
        m: [1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1],
    };
    const flip = { flip: null, reason: 'Already FIT.', blockedByImmovable: [] };
    const result = {
        id: 'sub-1',
        lineOfBusiness: 'commercial_property',
        asOf: '2026-09-19',
        specVersion: '1.0.0',
        rulebookVersion: '1',
        ratingVersion: '1',
        canonical: {},
        rollup,
        vector,
        contradictions: [],
        evaluate: {
            appetiteScore: 84,
            factors,
            firedRules: [],
            knockout: false,
            knockoutFactors: [],
            referFactors: [],
            missingFields: [],
            completeness: 100,
            confidence: 0.7,
            interpretationsApplied: [],
        },
        price,
        verdict: {
            verdict: 'FIT',
            decidingRule: { ruleId: 'commercial.tiv', factor: 'tiv', tier: 'acceptable', citation },
            reasons: ['Fits appetite.'],
            distanceToAppetite: 0,
            openHighContradictionIds: [],
            missingComponentKeys: [],
        },
        flip,
        voi: {
            nextQuestion: null,
            ranked: [{ question: { id: 'q1', field: 'pricing.quotedPremium', prompt: '', inputType: 'number', accessibilityLabel: '' }, undeterminedRuleIds: [], expectedScoreSwing: 15, weight: 0.15, reason: '' }],
            skipped: [],
            askedCount: 0,
        },
        peers: null,
        qualityIndex: 79.72321428571428,
        qualityComponents: { appetite: 84, adequacy: 54.6875, lossRatio: 88.57, completeness: 100, confidence: 70 },
        interpretations: [],
        explanation: 'Template text.',
    };
    return {
        id: 'sub-1',
        externalId: 'POL-1',
        source: 'federato',
        lineOfBusiness: 'commercial_property',
        insuredName: 'Buckeye Tool & Die',
        rank: 1,
        result,
        rollup,
        vector,
        vectorSpec: VECTOR_SPEC,
        price,
        flip,
        voi: result.voi,
        peers: {
            k: 5,
            peers: [{ id: 'sub-2', label: 'Scioto Castings', distance: 0.08, comparedComponents: 9, ratePer100: 0.11, annualLoss: 18000, totalTiv: 1, quotedPremium: 1, coarse: false }],
            medianRatePer100: 0.11,
            meanAnnualLoss: 18000,
            coarse: false,
            componentsUsed: [2, 3, 4, 5, 6, 7, 8, 9, 10],
        },
        contradictions: [
            {
                id: 'ctr-1',
                canonicalPath: 'buildings.B-1.yearBuilt',
                values: [
                    { value: 1989, provenance: { source: 'self_reported' } },
                    { value: 1991, provenance: { source: 'enrichment', confidence: 0.95 } },
                ],
                severity: 'MEDIUM',
                affectedRules: [],
                status: 'open',
            },
        ],
        interpretations: [{ id: 'I-1', title: 'Primary state', decision: 'Largest TIV share.', citation, affects: [] }],
        buildings: [
            { externalId: 'B-1', name: 'Main plant', tiv: 75000000, yearBuilt: 1989, constructionType: 'Frame', sprinklered: true, stories: 1, protectionClass: 4, state: 'OH', city: 'Columbus', pre1990: true, post2010: false, acceptableConstruction: false, assumedAcceptableConstruction: false },
        ],
        explanation: {
            submissionId: 'sub-1',
            text: 'Fits appetite with a score of 84. TIV is Acceptable.',
            sentences: ['Fits appetite with a score of 84.', 'TIV is Acceptable.'],
            recommendation: 'accept',
            mixed: false,
            inAppetite: [],
            outOfAppetite: [],
            numbers: {},
            citations: [],
            template: 'fit',
            narrated: false,
        },
        queryTrace: [
            {
                id: 'q-1', seq: 1, pass: 'deep', goal: 'Hydrate policy', requiredBy: [],
                pathChosen: { rootResource: 'Policy', path: [], why: '', alternativesRejected: [] },
                payload: { resource: 'Policy' }, rowCount: 27, totalAvailable: 27, durationMs: 1400,
                adapterKind: 'live', startedAt: '2026-09-19T12:00:00.000Z', outcome: 'ok', error: null,
                adaptedFrom: 'q-0', adaptation: 'retried with $elemMatch', notes: [],
            },
        ],
        fieldMap: {
            entries: [{ rawPath: 'Policy.total_premium', canonicalPath: 'pricing.quotedPremium', confidence: 1, method: 'exact' }],
            unmapped: [{ rawPath: 'Policy.notes', sampleValues: ['n/a'], reason: 'free text' }],
        },
        enrichment: [
            { source: 'openfema', title: 'Flood zone', available: true, unavailableReason: null, fetchedAt: null, fields: [{ canonicalPath: 'locations.L1.floodZone', label: 'Flood zone', valueText: 'X', value: 'X' }], attribution: 'FEMA' },
        ],
        routing: {
            submissionId: 'sub-1', primaryState: 'OH', requestedLimit: 150000000,
            assigned: { id: 3, name: 'Dana Whitfield', email: 'x@example.com', team: 'P', region: 'Midwest', authorityLimit: 200000000 },
            needsSeniorReferral: false, reason: 'Region match.', candidates: [],
        },
        actions: [action()],
        attachedSweep: null,
        shareSlug: null,
        createdAt: '2026-09-19T12:00:00.000Z',
        updatedAt: '2026-09-19T12:00:00.000Z',
    };
}
function queueRow(id, rank, extra = {}) {
    return {
        id, externalId: `POL-${id}`, rank, qualityIndex: 79.72321428571428,
        qualityComponents: { appetite: 84, adequacy: 0, lossRatio: 0, completeness: 100, confidence: 70 },
        verdict: 'FIT', insuredName: null, lineOfBusiness: 'commercial_property', outOfAppetiteLine: false,
        appetiteScore: 84, primaryState: 'OH', totalTiv: 150000000, quotedPremium: 175000, predictedPremium: 160000,
        adequacy: 1.09375, completeness: 100, confidence: 0.7, contradictionCount: 0, openHighContradictionCount: 0,
        distanceToAppetite: 0, oneFlipFromFit: false,
        assignedUnderwriter: { id: 3, name: 'Dana Whitfield', email: 'x', team: 'P', region: 'Midwest', authorityLimit: 1 },
        federatoUnderwriter: null,
        pendingAction: { id: 'a', type: 'request', status: 'draft' }, explanation: 'Fits.', updatedAt: '2026-09-19T12:00:00.000Z',
        ...extra,
    };
}
const BASE = 'http://localhost:3000/';
describe('createApiClient', () => {
    it('maps /health and reports the mock adapter as "snapshot"', async () => {
        const { impl, calls } = fakeFetch({
            'GET /health': { ok: true, version: '0.1.0', adapter: 'mock', llmConfigured: false, submissionCount: 38, startedAt: 'x' },
        });
        const client = createApiClient({ baseUrl: BASE, fetchImpl: impl });
        await expect(client.health()).resolves.toEqual({ ok: true, adapter: 'snapshot', version: '0.1.0' });
        expect(calls[0].url).toBe('http://localhost:3000/health');
    });
    it('pages through the queue until page.total and flattens each row', async () => {
        const { impl, calls } = fakeFetch({
            'GET /submissions': (call) => {
                const offset = Number(new URL(call.url).searchParams.get('offset'));
                const rows = offset === 0 ? [queueRow('a', 1), queueRow('b', 2)] : [queueRow('c', 3, { verdict: 'DOES_NOT_FIT', oneFlipFromFit: true, insuredName: 'Erie' })];
                return { status: 200, body: { rows, page: { total: 3, limit: 2, offset }, adapter: 'live', filters: {} } };
            },
        });
        const queue = await createApiClient({ baseUrl: BASE, fetchImpl: impl }).getQueue();
        expect(calls).toHaveLength(2);
        expect(new URL(calls[0].url).searchParams.get('limit')).toBe('500');
        expect(queue.map((r) => r.submissionId)).toEqual(['a', 'b', 'c']);
        expect(queue[0]).toMatchObject({
            insuredName: 'POL-a',
            assignedUnderwriter: 'Dana Whitfield',
            pendingAction: 'Request (draft)',
            explanationLine: 'Fits.',
            appetiteScore: 84,
            adequacy: 1.09375,
        });
        expect(queue[2]).toMatchObject({ verdict: 'DOES_NOT_FIT', oneFlipFromFit: true, insuredName: 'Erie' });
    });
    it('maps the submission detail without changing any engine number', async () => {
        const { impl, calls } = fakeFetch({ 'GET /submissions/sub%201': detailDto() });
        const view = await createApiClient({ baseUrl: BASE, fetchImpl: impl }).getSubmission('sub 1');
        expect(calls[0].url).toBe('http://localhost:3000/submissions/sub%201');
        expect(view.verdict).toBe('FIT');
        expect(view.appetiteScore).toBe(84);
        const pointSum = view.factors.reduce((s, f) => s + f.points, 0);
        expect(pointSum).toBeCloseTo(84, 9);
        expect(view.factors.find((f) => f.factorId === 'tiv')).toMatchObject({ tier: 'acceptable', tierValue: 0.6, weight: 0.15 });
        expect(view.factors[0].citation).toEqual({ document: 'APPETITE_GUIDELINES.pdf', page: 2, row: citation.section, quote: '$50M - $100M' });
        expect(view.explanation).toMatchObject({
            verdict: 'FIT',
            headline: 'Fits appetite with a score of 84.',
            paragraphs: ['TIV is Acceptable.'],
            decidingFactorId: 'tiv',
            decidingRuleId: 'commercial.tiv',
            confidence: 0.7,
        });
        expect(view.explanation.recommendation).toMatch(/^Accept/);
        expect(view.pricing).toMatchObject({ quotedPremium: 175000, predictedPremium: 160000, adequacy: 1.09375, expectedLoss: 20000, ratePer100Tiv: 0.10666666666666667 });
        expect(view.pricing.factors).toEqual([{ label: 'Construction', multiplier: 1.05, basis: 'Joisted Masonry' }]);
        expect(view.peers).toMatchObject({ medianRatePer100Tiv: 0.11, meanAnnualLoss: 18000, comparedComponentCount: 9 });
        expect(view.peers.peers[0]).toMatchObject({ submissionId: 'sub-2', insuredName: 'Scioto Castings', distance: 0.08 });
        expect(view.rollup).toEqual({ totalTiv: 150000000, buildingCount: 2, pctTivPre1990: 0, pctTivPost2010: 0, pctTivAcceptableConstruction: 0.5, primaryState: 'OH', fiveYearLoss: 100000 });
        expect(view.buildings[0]).toMatchObject({ id: 'B-1', address: 'Main plant, Columbus', flags: ['pre-1990', 'unacceptable construction'] });
        expect(view.contradictions[0].sides).toEqual([
            { value: '1989', source: 'self_reported', confidence: 0.7 },
            { value: '1991', source: 'enrichment', confidence: 0.95 },
        ]);
        expect(view.interpretations[0]).toMatchObject({ id: 'I-1', text: 'Largest TIV share.' });
        expect(view.flip).toMatchObject({ available: false, reason: 'Already FIT.', scoreBefore: 84, distanceToAppetite: 0 });
        expect(view.vector.components).toHaveLength(11);
        expect(view.vector.components[3]).toMatchObject({ key: 'totalTiv', label: 'Total insured value (from the DTO)', raw: 150000000, tier: 0.6, mask: 1, immovable: false, appetiteFactor: true });
        expect(view.vector.components[9]).toMatchObject({ key: 'pctTivSprinklered', raw: null, tier: null, mask: 0 });
        expect(view.vector.components.filter((c) => c.immovable).map((c) => c.index)).toEqual([0, 1, 2, 5, 6, 8, 10]);
        expect(view.queryTrace[0]).toMatchObject({ step: 1, phase: 'deep', resource: 'Policy', resultCount: 27, adapted: true, note: null, adaptation: 'retried with $elemMatch' });
        expect(view.schema).toEqual({
            resources: [{ name: 'Policy', fieldCount: 2, mappedCount: 1 }],
            mapped: [{ sourcePath: 'Policy.total_premium', canonicalPath: 'pricing.quotedPremium', method: 'exact', score: 1 }],
            unmapped: [{ sourcePath: 'Policy.notes', sampleValue: 'n/a', reason: 'free text' }],
        });
        expect(view.enrichment[0].rows).toEqual([{ label: 'Flood zone', value: 'X' }]);
        expect(view.routing).toEqual({ region: 'Midwest', underwriter: 'Dana Whitfield', authorityLimit: 200000000, withinAuthority: true, rationale: 'Region match.' });
        expect(view.drafts).toEqual([
            {
                actionId: 'act-1',
                status: 'draft',
                subject: 'Information request: Buckeye Tool & Die',
                body: 'Please send the quoted premium.',
                requestedFields: [{ path: 'pricing.quotedPremium', label: 'Quoted premium', voi: 15 }],
            },
        ]);
        expect(view.actionLog[0]).toMatchObject({ actionId: 'act-1', beforeScore: 81, beforeRank: 7, beforeVerdict: 'REFER', afterScore: null });
        expect(view.sweep).toBeNull();
    });
    it('carries the account kind, display line, facts, verification and peer verdicts (FILL-console)', async () => {
        const base = detailDto();
        const facts = {
            source: 'federato_triage', traceId: 'q-000', federatoId: 8, submissionNumber: 'SUB-2024-00008',
            insuredName: 'Redline Logistics Inc', brokerName: 'Ashford Specialty Group', underwriterName: 'A. Delgado',
            lineOfBusiness: 'health', status: 'bound', requestedLimit: 1000000, receivedDate: '2024-07-10',
            targetEffectiveDate: '2024-10-01', declineReason: null, competitor: null,
        };
        const outcome = { verdict: 'FIT', appetiteScore: 84, knockoutFactorIds: [], decidingFactorId: 'tiv' };
        const verification = {
            caseId: 'POL-1', generatedAt: '2026-09-19T19:30:25.951Z', engine: outcome, matchesCurrentResult: true,
            naive: { ...outcome, agrees: { verdict: true, appetiteScore: true, knockouts: true, decidingFactor: true, all: true } },
            secondOpinion: null,
        };
        const dto = {
            ...base,
            insuredName: null,
            displayLineOfBusiness: 'health',
            accountKind: 'triage_knockout',
            facts,
            verification,
            peers: { ...base.peers, peers: [{ ...base.peers.peers[0], verdict: 'REFER' }, { ...base.peers.peers[0], id: 'sub-3', verdict: null }] },
        };
        const { impl } = fakeFetch({ 'GET /submissions/sub-1': dto });
        const view = await createApiClient({ baseUrl: BASE, fetchImpl: impl }).getSubmission('sub-1');
        expect(view.accountKind).toBe('triage_knockout');
        expect(view.displayLineOfBusiness).toBe('health');
        expect(view.lineOfBusiness).toBe('commercial_property');
        expect(view.facts).toEqual(facts);
        expect(view.verification).toEqual(verification);
        // The 120 knockouts have no broker insured record; the facts name them.
        expect(view.insuredName).toBe('Redline Logistics Inc');
        expect(view.peers.peers.map((p) => p.verdict)).toEqual(['REFER', null]);
    });
    it('an API deployed before the facts existed maps to the full scored view, with nothing guessed', async () => {
        const { impl } = fakeFetch({ 'GET /submissions/sub-1': detailDto() });
        const view = await createApiClient({ baseUrl: BASE, fetchImpl: impl }).getSubmission('sub-1');
        expect(view.accountKind).toBe('scored');
        expect(view.displayLineOfBusiness).toBe('commercial_property');
        expect(view.facts).toBeNull();
        expect(view.verification).toBeNull();
        expect(view.peers.peers[0].verdict).toBeNull();
    });
    it('getVerification returns GET /verification unchanged', async () => {
        const body = {
            layersAB: null, layerC: null, realAccounts: null,
            extraction: { status: 'not_measured', fieldAccuracy: null, reason: 'HTTP 402.' },
            defectsFound: { cp1InvariantViolations: 20662, cp1Disagreements: 1369, run2Confirmed: 39, run2Refuted: 11, defects: [] },
            sources: ['VERIFICATION.md'],
        };
        const { impl, calls } = fakeFetch({ 'GET /verification': body });
        const dto = await createApiClient({ baseUrl: BASE, fetchImpl: impl }).getVerification();
        expect(calls[0].url).toBe('http://localhost:3000/verification');
        expect(dto).toEqual(body);
    });
    it('reads vector labels only from the DTO: without vectorSpec it falls back to generic labels (C01)', async () => {
        const { vectorSpec: _spec, ...dto } = detailDto();
        const { impl } = fakeFetch({ 'GET /submissions/sub-1': dto });
        const view = await createApiClient({ baseUrl: BASE, fetchImpl: impl }).getSubmission('sub-1');
        expect(view.vector.components).toHaveLength(11);
        expect(view.vector.components[3]).toMatchObject({ key: 'c3', label: 'Component 3', raw: 150000000, tier: 0.6, immovable: false, appetiteFactor: false });
    });
    it('ignores a vectorSpec for another line of business', async () => {
        const dto = { ...detailDto(), vectorSpec: { ...VECTOR_SPEC, lineOfBusiness: 'tenant' } };
        const { impl } = fakeFetch({ 'GET /submissions/sub-1': dto });
        const view = await createApiClient({ baseUrl: BASE, fetchImpl: impl }).getSubmission('sub-1');
        expect(view.vector.components[3]).toMatchObject({ key: 'c3', label: 'Component 3' });
    });
    it('runSubmission POSTs then re-reads the detail', async () => {
        const { impl, calls } = fakeFetch({
            'POST /submissions/sub-1/run': { id: 'sub-1' },
            'GET /submissions/sub-1': detailDto(),
        });
        const view = await createApiClient({ baseUrl: 'http://localhost:3000', fetchImpl: impl }).runSubmission('sub-1');
        expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(['POST /submissions/sub-1/run', 'GET /submissions/sub-1']);
        expect(view.appetiteScore).toBe(84);
    });
    it('sends reply text as JSON and returns the before/after pair', async () => {
        const { impl, calls } = fakeFetch({
            'POST /submissions/sub-1/reply': {
                id: 'sub-1',
                action: action({ type: 'reply', status: 'applied' }),
                extracted: [
                    { canonicalPath: 'pricing.quotedPremium', value: 75000, confidence: 0.9, quote: 'premium of $75,000', accepted: true, quoteFound: true, typeOk: true, rangeOk: true, rejection: null, needsConfirmation: false },
                ],
                accepted: [], rejected: [], needsConfirmation: [], newContradictions: [],
                before: snapshot(81, 'REFER', 7),
                after: snapshot(96, 'FIT', 1),
                rankBefore: 7,
                rankAfter: 1,
                result: {},
            },
        });
        const out = await createApiClient({ baseUrl: BASE, fetchImpl: impl }).postReply('sub-1', { text: 'The premium is $75,000.' });
        expect(calls[0].body).toEqual({ text: 'The premium is $75,000.' });
        expect(out.fields).toEqual([
            { path: 'pricing.quotedPremium', label: 'Quoted Premium', value: '75000', confidence: 0.9, accepted: true, quote: 'premium of $75,000', rejectedReason: null },
        ]);
        expect(out.before).toMatchObject({ beforeScore: 81, beforeRank: 7, beforeVerdict: 'REFER' });
        expect(out.after).toMatchObject({ afterScore: 96, afterRank: 1, afterVerdict: 'FIT' });
    });
    it('uploads a file as base64', async () => {
        const { impl, calls } = fakeFetch({
            'POST /submissions/sub-1/reply': { id: 'sub-1', action: action(), extracted: [], before: snapshot(1, 'REFER', 1), after: snapshot(1, 'REFER', 1), rankBefore: 1, rankAfter: 1 },
        });
        const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'loss-run.pdf', { type: 'application/pdf' });
        await createApiClient({ baseUrl: BASE, fetchImpl: impl }).postReply('sub-1', { file });
        expect(calls[0].body).toEqual({ pdfBase64: 'JVBERg==', filename: 'loss-run.pdf' });
    });
    it('rejects an empty reply without calling the API', async () => {
        const { impl, calls } = fakeFetch({});
        await expect(createApiClient({ baseUrl: BASE, fetchImpl: impl }).postReply('sub-1', { text: '  ' })).rejects.toThrow(/text or a file/);
        expect(calls).toHaveLength(0);
    });
    it('maps actions, plan and approve', async () => {
        const { impl } = fakeFetch({
            'GET /actions': { actions: [action()], page: { total: 1, limit: 500, offset: 0 }, sendingIsSimulated: true },
            'POST /actions/plan': { routed: 1, needsSeniorReferral: 0, drafted: 1, skipped: 0, actions: [action(), action({ id: 'act-2' })] },
            'POST /actions/act-1/approve': { action: action({ status: 'sent' }) },
        });
        const client = createApiClient({ baseUrl: BASE, fetchImpl: impl });
        expect((await client.getActions()).map((a) => a.actionId)).toEqual(['act-1']);
        expect((await client.planActions()).map((a) => a.actionId)).toEqual(['act-1', 'act-2']);
        expect(await client.approveAction('act-1')).toMatchObject({ actionId: 'act-1', status: 'sent', insuredName: 'Buckeye Tool & Die' });
    });
    it('maps the aggregate and joins one-flip rows to the queue', async () => {
        const { impl } = fakeFetch({
            'GET /aggregate': {
                counts: { total: 38, byVerdict: { FIT: 5, REFER: 20, DOES_NOT_FIT: 13 }, byLine: {}, scored: 38, knockedOut: 13 },
                scoreHistogram: [0, 0, 1, 2, 3, 4, 5, 6, 7, 10],
                topKnockoutFactors: [{ factor: 'tiv', label: 'TIV', count: 4 }],
                oneFlipAway: [
                    { id: 'c', externalId: 'POL-c', insuredName: 'Erie', appetiteScore: 75, moveLabel: 'TIV to $150M', scoreAfter: 84, premiumAfter: 205000 },
                    { id: 'z', externalId: 'POL-z', insuredName: null, appetiteScore: 70, moveLabel: 'Premium to $50,000', scoreAfter: 79, premiumAfter: null },
                ],
                bookAdequacy: { median: 0.97, underpricedCount: 9, n: 27 },
                verification: { propertyCasesRun: 10000, differentialCasesRun: 10000, disagreements: 0, llmCasesRun: 50, llmAgreementRate: 0.96, llmAgreementCi95: [0.87, 0.99], extractionFieldAccuracy: null, generatedAt: '2026-09-19' },
            },
            'GET /submissions': { rows: [queueRow('c', 4, { verdict: 'DOES_NOT_FIT' })], page: { total: 1, limit: 500, offset: 0 }, adapter: 'live', filters: {} },
        });
        const agg = await createApiClient({ baseUrl: BASE, fetchImpl: impl }).getAggregate();
        expect(agg.countsByVerdict).toEqual({ FIT: 5, REFER: 20, DOES_NOT_FIT: 13 });
        expect(agg.scoreHistogram).toHaveLength(10);
        expect(agg.scoreHistogram[0]).toEqual({ bucket: '0–9', count: 0 });
        expect(agg.scoreHistogram[9]).toEqual({ bucket: '90–100', count: 10 });
        expect(agg.topKnockoutFactors).toEqual([{ factorId: 'tiv', label: 'TIV', count: 4 }]);
        expect(agg.counts).toEqual({ total: 38, scored: 38, knockedOut: 13, byLine: {} });
        expect(agg.bookAdequacyDetail).toEqual({ median: 0.97, underpricedCount: 9, n: 27 });
        expect(agg.oneFlipMoves).toEqual({
            c: { moveLabel: 'TIV to $150M', scoreAfter: 84, premiumAfter: 205000 },
            z: { moveLabel: 'Premium to $50,000', scoreAfter: 79, premiumAfter: null },
        });
        expect(agg.oneFlipAway[0]).toMatchObject({ submissionId: 'c', rank: 4, verdict: 'DOES_NOT_FIT' });
        expect(agg.oneFlipAway[1]).toMatchObject({ submissionId: 'z', insuredName: 'POL-z', appetiteScore: 70, oneFlipFromFit: true, explanationLine: 'Premium to $50,000' });
        expect(agg.bookAdequacy).toBe(0.97);
        expect(agg.verification).toMatchObject({ disagreements: 0, llmAgreementCi95: '0.87–0.99', extractionFieldAccuracy: null });
    });
    it('maps rules and glossary', async () => {
        const { impl } = fakeFetch({
            'GET /rules': { rulebooks: [{ id: 'commercial', label: 'Commercial', version: '1', isExtension: false, rules: [] }], interpretations: [], weights: {} },
            'GET /glossary': { entries: [{ term: 'TIV', definition: 'Total insured value.', page: 4, aliases: [] }], doc: 'GLOSSARY.pdf' },
        });
        const client = createApiClient({ baseUrl: BASE, fetchImpl: impl });
        expect((await client.getRules()).rulebooks).toHaveLength(1);
        expect(await client.getGlossary()).toEqual({ entries: [{ term: 'TIV', definition: 'Total insured value.', source: 'GLOSSARY.pdf, p. 4' }] });
    });
    it('never shows the adaptation kind "none" as a note, and carries the trace reasoning (R3-2)', async () => {
        const dto = detailDto();
        const base = dto.queryTrace[0];
        const requiredBy = [{ ruleId: 'commercial.tiv', factor: 'tiv', canonicalPath: 'buildings.*.tiv', why: 'TIV band rule' }];
        const alternativesRejected = [{ rootResource: 'Submission', path: [], why: 'Submission has no TIV field' }];
        const withReasons = {
            ...base,
            requiredBy,
            pathChosen: { rootResource: 'Policy', path: ['exposure_units'], why: 'Policy carries premium and TIV', alternativesRejected },
        };
        dto.queryTrace = [
            { ...withReasons, seq: 0, adaptedFrom: null, adaptation: 'none', notes: [] },
            { ...withReasons, seq: 1, adaptedFrom: null, adaptation: 'none', notes: ['Server-side aggregation declined.'] },
            { ...withReasons, seq: 2, adaptedFrom: 'q-0', adaptation: 'elem_match_swap', notes: [] },
        ];
        const { impl } = fakeFetch({ 'GET /submissions/sub-1': dto });
        const view = await createApiClient({ baseUrl: BASE, fetchImpl: impl }).getSubmission('sub-1');
        expect(view.queryTrace.map((e) => e.note)).toEqual([null, 'Server-side aggregation declined.', null]);
        expect(view.queryTrace.map((e) => e.adaptation)).toEqual([null, null, 'elem_match_swap']);
        expect(view.queryTrace[0].path).toEqual(['exposure_units']);
        expect(view.queryTrace[0].error).toBeNull();
        expect(view.queryTrace[0]).toMatchObject({
            why: 'Policy carries premium and TIV',
            alternativesRejected,
            requiredBy,
        });
    });
    it('maps a requested field with no VOI entry to null, never a fake 0 (R5-8)', async () => {
        const dto = detailDto();
        const voi = { ...dto.result.voi, ranked: [] };
        dto.result = { ...dto.result, voi };
        dto.voi = voi;
        const { impl } = fakeFetch({ 'GET /submissions/sub-1': dto });
        const view = await createApiClient({ baseUrl: BASE, fetchImpl: impl }).getSubmission('sub-1');
        expect(view.drafts[0].requestedFields).toEqual([{ path: 'pricing.quotedPremium', label: 'Quoted premium', voi: null }]);
    });
    it('carries the per-building rating steps behind the predicted premium (R5-7)', async () => {
        const dto = detailDto();
        const construction = { name: 'construction', input: 'steel', factor: 0.981 };
        const perBuilding = [{ buildingExternalId: 'B-1', tiv: 1_000_000, baseRate: 0.05, factors: [construction], premium: 490.5 }];
        dto.price = { ...dto.price, perBuilding };
        const { impl } = fakeFetch({ 'GET /submissions/sub-1': dto });
        const view = await createApiClient({ baseUrl: BASE, fetchImpl: impl }).getSubmission('sub-1');
        expect(view.pricing.buildings).toEqual([
            {
                buildingExternalId: 'B-1',
                tiv: 1_000_000,
                baseRate: 0.05,
                factors: [{ label: 'construction', multiplier: 0.981, input: 'steel' }],
                premium: 490.5,
            },
        ]);
    });
    it('throws the ErrorDto message on a non-2xx answer', async () => {
        const { impl } = fakeFetch({
            'GET /submissions/nope': () => ({ status: 404, body: { error: { code: 'NOT_FOUND', message: 'no submission "nope"' } } }),
        });
        const err = await createApiClient({ baseUrl: BASE, fetchImpl: impl }).getSubmission('nope').catch((e) => e);
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toBe('no submission "nope"');
        expect(err).toMatchObject({ status: 404, code: 'NOT_FOUND' });
    });
    it('reports an unreachable API as a NETWORK error', async () => {
        const impl = (async () => {
            throw new TypeError('Failed to fetch');
        });
        await expect(createApiClient({ baseUrl: BASE, fetchImpl: impl }).health()).rejects.toMatchObject({ code: 'NETWORK', status: 0 });
    });
});
//# sourceMappingURL=client.test.js.map