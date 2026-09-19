/*
 * Every number below is fixed by docs/contracts/INTERPRETATIONS.md:
 *   - weights W-1 (0.10 / 0.15 x4 / 0.10 x3), points = 100 * weight * tierValue;
 *   - FIT       = worked case B1 -> 84.0, FIT;
 *   - REFER     = worked case B6 -> 84.0, building_age refer (R-AGE-REFER);
 *   - DNF       = worked case B2 -> TIV 150000000.01, `tiv` knockout, 75.0;
 *   - no-policy = a property submission with no Policy record (LIVE_DATA_FACTS:
 *     11 exist): only line of business is known -> 15.0, completeness 1/9 (V-6),
 *     REFER by V-2;
 *   - quality index per P-5 with null terms dropped and weights renormalised;
 *   - queue order per P-6 (knockouts last, by distanceToAppetite, nulls last).
 * The colocated test re-derives these numbers from the rows, so a drift fails.
 */
const AG = 'APPETITE_GUIDELINES.pdf';
function cite(factorLabel, quote) {
    return { document: AG, page: 2, row: `p2 "${factorLabel}"`, quote };
}
const FACTORS = [
    { factorId: 'submission_type', label: 'Submission type', weight: 0.1, quote: 'New business' },
    { factorId: 'line_of_business', label: 'Line of business', weight: 0.15, quote: 'Property' },
    { factorId: 'primary_risk_state', label: 'Primary risk state', weight: 0.15, quote: 'OH, PA, MD, CO, CA, FL' },
    { factorId: 'tiv', label: 'TIV (Total Insured Value)', weight: 0.15, quote: '$50M - $100M' },
    { factorId: 'total_premium', label: 'Total premium', weight: 0.15, quote: '$75K - $100K' },
    { factorId: 'building_age', label: 'Building age', weight: 0.1, quote: 'Newer than 2010' },
    { factorId: 'construction_type', label: 'Construction type', weight: 0.1, quote: 'JM, Masonry non-combustible, non-combustible/steel' },
    { factorId: 'loss_value', label: 'Loss value', weight: 0.1, quote: '< $100K' },
];
/** Pre-computed points, written as literals so the fixture never does arithmetic. */
const POINTS = {
    '0.1': { '1': 10, '0.6': 6, '0': 0 },
    '0.15': { '1': 15, '0.6': 9, '0': 0 },
};
function factorRows(cells, knockoutFactor, referFactor) {
    return FACTORS.map((f, i) => {
        const cell = cells[i] ?? null;
        if (cell === null) {
            return {
                factorId: f.factorId,
                label: f.label,
                tier: null,
                tierValue: null,
                weight: f.weight,
                points: 0,
                known: false,
                knockout: false,
                ruleId: null,
                citation: null,
            };
        }
        const [tier, tierValue] = cell;
        const tierForRow = f.factorId === referFactor ? 'refer' : tier;
        return {
            factorId: f.factorId,
            label: f.label,
            tier: tierForRow,
            tierValue,
            weight: f.weight,
            points: POINTS[String(f.weight)]?.[String(tierValue)] ?? 0,
            known: true,
            knockout: f.factorId === knockoutFactor,
            ruleId: `commercial.${f.factorId}.${tierForRow}`,
            citation: cite(f.label, f.quote),
        };
    });
}
const T = ['target', 1];
const A = ['acceptable', 0.6];
const N = ['not_acceptable', 0];
/** B1 tiers: 1, 1, 1, 0.6, 0.6, 0.6, 1, 1. */
const B1_CELLS = [T, T, T, A, A, A, T, T];
/** B2: as B1 but `tiv` -> 0. */
const B2_CELLS = [T, T, T, N, A, A, T, T];
/** No policy: only line of business is known. */
const NO_POLICY_CELLS = [null, T, null, null, null, null, null, null];
const COMMERCIAL_SPEC = [
    ['isNewBusiness', 'New business', true, true],
    ['isPropertyLine', 'Property line of business', true, true],
    ['stateTier', 'Primary risk state tier', true, true],
    ['totalTiv', 'Total insured value', false, true],
    ['quotedPremium', 'Quoted total premium', false, true],
    ['pctTivPre1990', 'Share of TIV built before 1990', true, true],
    ['pctTivPost2010', 'Share of TIV built in 2010 or later', true, true],
    ['pctTivAcceptableConstruction', 'Share of TIV in acceptable construction classes', false, true],
    ['fiveYearLoss', 'Five-year loss value', true, true],
    ['pctTivSprinklered', 'Share of TIV sprinklered', false, false],
    ['tivWeightedProtectionClass', 'TIV-weighted public protection class', true, false],
];
/** raw and tier per component; `null` raw means missing (mask 0, tier null). */
function vectorComponents(rows) {
    return COMMERCIAL_SPEC.map(([key, label, immovable, appetiteFactor], index) => {
        const [raw, tier] = rows[index] ?? [null, null];
        return {
            index,
            key,
            label,
            raw,
            tier: raw === null ? null : tier,
            mask: raw === null ? 0 : 1,
            scaled: null,
            immovable,
            appetiteFactor,
        };
    });
}
function building(id, yearBuilt, constructionType, tiv, flags) {
    return {
        id,
        address: `${id === 'B-1' ? 'Main plant' : 'Warehouse'}, Columbus`,
        state: 'OH',
        yearBuilt,
        constructionType,
        tiv,
        sprinklered: id === 'B-1',
        protectionClass: 4,
        flags,
    };
}
function queryTrace(root, rows) {
    return [
        {
            step: 1,
            phase: 'discover',
            resource: 'schema',
            purpose: 'Read the live schema to learn which resources hold premium, TIV and buildings.',
            payload: { schema: true },
            resultCount: 12,
            durationMs: 210,
            adapted: false,
            note: null,
        },
        {
            step: 2,
            phase: 'deep',
            resource: root,
            purpose: root === 'Policy'
                ? 'Hydrate the policy with insured, submission, claims and exposure_units -> location -> buildings.'
                : 'No policy exists for this submission; read the submission with insured.hq and broker.',
            payload: root === 'Policy'
                ? { resource: 'Policy', where: { line_of_business: 'property' }, expand: { insured: true, submission: true, claims: true } }
                : { resource: 'Submission', where: { status: { $in: ['lost', 'cleared', 'quoted', 'declined', 'received'] } } },
            resultCount: rows,
            durationMs: 1400,
            adapted: false,
            note: null,
        },
    ];
}
const EMPTY_ROLLUP = {
    totalTiv: null,
    buildingCount: 0,
    pctTivPre1990: null,
    pctTivPost2010: null,
    pctTivAcceptableConstruction: null,
    primaryState: null,
    fiveYearLoss: null,
};
const ENRICHMENT = [
    {
        source: 'openfema',
        title: 'Flood zone (OpenFEMA)',
        available: true,
        unavailableReason: null,
        fetchedAt: '2026-09-19T12:00:00.000Z',
        rows: [{ label: 'Flood zone', value: 'X (minimal hazard)' }],
    },
    {
        source: 'overpass',
        title: 'Nearest fire station (OpenStreetMap)',
        available: false,
        unavailableReason: 'Timed out after 6 s',
        fetchedAt: null,
        rows: [],
    },
];
function logEntry(submissionId, insuredName, actionId, type, status, before, after) {
    return {
        actionId,
        submissionId,
        insuredName,
        type,
        status,
        createdAt: '2026-09-19T12:30:00.000Z',
        beforeScore: before?.[0] ?? null,
        afterScore: after?.[0] ?? null,
        beforeRank: before?.[1] ?? null,
        afterRank: after?.[1] ?? null,
        beforeVerdict: before?.[2] ?? null,
        afterVerdict: after?.[2] ?? null,
    };
}
const ROUTING_OH = {
    region: 'Midwest',
    underwriter: 'Dana Whitfield',
    authorityLimit: 200000000,
    withinAuthority: true,
    rationale: 'Primary state OH is in the Midwest region; TIV is within Dana Whitfield\'s authority.',
};
/* -------------------------------------------------------------------------- */
/* The four submissions                                                        */
/* -------------------------------------------------------------------------- */
function fit() {
    const id = 'sub-fit';
    const name = 'Buckeye Tool & Die';
    return {
        submissionId: id,
        insuredName: name,
        lineOfBusiness: 'commercial_property',
        displayLineOfBusiness: 'commercial_property',
        accountKind: 'scored',
        synthetic: false,
        facts: null,
        verification: null,
        verdict: 'FIT',
        appetiteScore: 84,
        completeness: 100,
        confidence: 0.7,
        explanation: {
            verdict: 'FIT',
            headline: 'Fits appetite with a score of 84.',
            paragraphs: [
                'All eight appetite factors are known and none is a knockout.',
                'TIV of $150M is Acceptable, not Target: the Target band is $50M to $100M.',
            ],
            recommendation: 'Accept: quote within appetite.',
            decidingFactorId: 'tiv',
            decidingRuleId: 'commercial.tiv.acceptable',
            confidence: 0.7,
        },
        factors: factorRows(B1_CELLS, null, null),
        queryTrace: queryTrace('Policy', 27),
        schema: {
            resources: [
                { name: 'Policy', fieldCount: 14, mappedCount: 12 },
                { name: 'Building', fieldCount: 9, mappedCount: 9 },
            ],
            mapped: [
                { sourcePath: 'Policy.total_premium', canonicalPath: 'pricing.quotedPremium', method: 'exact', score: 1 },
                { sourcePath: 'Policy.business_type', canonicalPath: 'submissionType', method: 'synonym', score: 0.9 },
            ],
            unmapped: [
                { sourcePath: 'Policy.policy_number', sampleValue: 'POL-00017', reason: 'No canonical field for an identifier.' },
                { sourcePath: 'Policy.notes', sampleValue: null, reason: 'Free text; never scored.' },
            ],
        },
        pricing: {
            quotedPremium: 175000,
            predictedPremium: 160000,
            adequacy: 1.09375,
            expectedLoss: 20000,
            ratePer100Tiv: 0.10666666666666667,
            currency: 'USD',
            factors: [
                { label: 'Construction', multiplier: 1.05, basis: '50% Joisted Masonry, 50% Frame' },
                { label: 'Building age', multiplier: 1, basis: 'built 1990-2009' },
                { label: 'Protection class', multiplier: 0.95, basis: 'PPC 4' },
                { label: 'Loss history', multiplier: 1.02, basis: '$100,000 over 5 years' },
            ],
            notes: ['Rates fitted to the book.'],
        },
        peers: {
            peers: [
                { submissionId: 'sub-p1', insuredName: 'Scioto Castings', distance: 0.08, ratePer100Tiv: 0.11, annualLoss: 18000, verdict: 'FIT' },
                { submissionId: 'sub-p2', insuredName: 'Olentangy Foods', distance: 0.12, ratePer100Tiv: 0.1, annualLoss: 22000, verdict: 'FIT' },
                { submissionId: 'sub-p3', insuredName: 'Hocking Paper', distance: 0.19, ratePer100Tiv: 0.13, annualLoss: 30000, verdict: 'REFER' },
                { submissionId: 'sub-p4', insuredName: 'Maumee Glass', distance: 0.21, ratePer100Tiv: 0.09, annualLoss: 12000, verdict: 'FIT' },
                { submissionId: 'sub-p5', insuredName: 'Licking Valley Mills', distance: 0.27, ratePer100Tiv: 0.12, annualLoss: 40000, verdict: 'DOES_NOT_FIT' },
            ],
            medianRatePer100Tiv: 0.11,
            meanAnnualLoss: 24400,
            comparedComponentCount: 9,
        },
        buildings: [
            building('B-1', 1995, 'Joisted Masonry', 75000000, []),
            building('B-2', 2004, 'Frame', 75000000, ['unacceptable construction']),
        ],
        rollup: {
            totalTiv: 150000000,
            buildingCount: 2,
            pctTivPre1990: 0,
            pctTivPost2010: 0,
            pctTivAcceptableConstruction: 0.5,
            primaryState: 'OH',
            fiveYearLoss: 100000,
        },
        contradictions: [],
        interpretations: [
            {
                id: 'I-1',
                title: 'Primary risk state = largest TIV share',
                text: 'The state holding the largest share of TIV is the primary risk state.',
                citation: cite('Primary risk state', 'OH, PA, MD, CO, CA, FL'),
            },
        ],
        flip: {
            available: false,
            reason: 'Already FIT.',
            moves: [],
            scoreBefore: 84,
            scoreAfter: null,
            premiumBefore: 160000,
            premiumAfter: null,
            verdictAfter: null,
            distanceToAppetite: 0,
        },
        vector: {
            lineOfBusiness: 'commercial_property',
            specVersion: '1.0.0',
            completeness: 100,
            components: vectorComponents([
                [1, 1],
                [1, 1],
                [1, 1],
                [150000000, 0.6],
                [175000, 0.6],
                [0, 0.6],
                [0, 0.6],
                [0.5, 1],
                [100000, 1],
                [0.5, 0.5],
                [4, 4],
            ]),
        },
        enrichment: ENRICHMENT,
        routing: ROUTING_OH,
        drafts: [],
        actionLog: [logEntry(id, name, 'act-fit-route', 'route', 'applied', [84, 1, 'FIT'], [84, 1, 'FIT'])],
        sweep: null,
    };
}
function refer() {
    const base = fit();
    const id = 'sub-refer';
    const name = 'Cuyahoga Cold Storage';
    const draft = {
        actionId: 'act-refer-request',
        status: 'draft',
        subject: `Information request: ${name}`,
        body: 'Please confirm the year built and any retrofit work for building B-1 (recorded as 1989).',
        requestedFields: [{ path: 'buildings.B-1.yearBuilt', label: 'Year built (B-1)', voi: 4 }],
    };
    const contradiction = {
        id: 'ctr-1',
        field: 'buildings.B-1.yearBuilt',
        severity: 'MEDIUM',
        status: 'open',
        summary: 'Broker says 1989; county records say 1991.',
        sides: [
            { value: '1989', source: 'self_reported', confidence: 0.7 },
            { value: '1991', source: 'enrichment', confidence: 0.9 },
        ],
    };
    const sweep = {
        sweepId: 'swp-1',
        roomLabel: 'Loading dock',
        stage: 'done',
        coverage: 83,
        frameCount: 12,
        observations: [
            { id: 'obs-1', label: 'Sprinkler Head', bearing: 40, confidence: 0.92, note: null },
            { id: 'obs-2', label: 'Extension Cord', bearing: 215, confidence: 0.55, note: 'Partly occluded; awaiting confirmation.' },
        ],
    };
    return {
        ...base,
        submissionId: id,
        insuredName: name,
        verdict: 'REFER',
        appetiteScore: 84,
        explanation: {
            verdict: 'REFER',
            headline: 'Refer: building B-1 was built before 1990.',
            paragraphs: [
                'Half of TIV (exactly 50%) sits in a pre-1990 building. At 50% the factor stays Acceptable and a refer is raised; above 50% it would be a knockout.',
                'The score is unchanged at 84 because a refer is a flag, not a score.',
            ],
            recommendation: 'Review: an underwriter should look before quoting.',
            decidingFactorId: 'tiv',
            decidingRuleId: 'commercial.tiv.acceptable',
            confidence: 0.7,
        },
        factors: factorRows(B1_CELLS, null, 'building_age'),
        pricing: {
            ...base.pricing,
            predictedPremium: 190000,
            adequacy: 0.9210526315789473,
            expectedLoss: 30000,
            ratePer100Tiv: 0.12666666666666665,
            notes: ['Rates fitted to the book.'],
        },
        buildings: [
            building('B-1', 1989, 'Joisted Masonry', 75000000, ['pre-1990']),
            building('B-2', 2000, 'Frame', 75000000, ['unacceptable construction']),
        ],
        rollup: { ...base.rollup, pctTivPre1990: 0.5 },
        contradictions: [contradiction],
        interpretations: [
            ...base.interpretations,
            {
                id: 'I-2',
                title: 'Building age mirrors the construction wording',
                text: 'Up to 50% of TIV pre-1990 refers; more than 50% is Not Acceptable.',
                citation: cite('Building age', 'Newer than 2010'),
            },
        ],
        flip: {
            available: false,
            reason: 'The failing component (pctTivPre1990) is immovable.',
            moves: [],
            scoreBefore: 84,
            scoreAfter: null,
            premiumBefore: 190000,
            premiumAfter: null,
            verdictAfter: null,
            distanceToAppetite: null,
        },
        vector: {
            ...base.vector,
            components: vectorComponents([
                [1, 1],
                [1, 1],
                [1, 1],
                [150000000, 0.6],
                [175000, 0.6],
                [0.5, 0.6],
                [0, 0.6],
                [0.5, 1],
                [100000, 1],
                [0.5, 0.5],
                [4, 4],
            ]),
        },
        drafts: [draft],
        actionLog: [
            logEntry(id, name, 'act-refer-route', 'route', 'applied', [84, 2, 'REFER'], [84, 2, 'REFER']),
            logEntry(id, name, draft.actionId, 'request', 'draft', [84, 2, 'REFER'], null),
        ],
        sweep,
    };
}
function dnf() {
    const base = fit();
    const id = 'sub-dnf';
    const name = 'Great Lakes Logistics';
    return {
        ...base,
        submissionId: id,
        insuredName: name,
        verdict: 'DOES_NOT_FIT',
        appetiteScore: 75,
        explanation: {
            verdict: 'DOES_NOT_FIT',
            headline: 'Does not fit: TIV of $150,000,000.01 is above the $150M ceiling.',
            paragraphs: [
                'TIV above $150M is Not Acceptable, which is a knockout. The other seven factors still score 75 points.',
                'One move fixes it: bring TIV to $150,000,000.',
            ],
            recommendation: 'Decline: outside appetite.',
            decidingFactorId: 'tiv',
            decidingRuleId: 'commercial.tiv.not_acceptable',
            confidence: 0.7,
        },
        factors: factorRows(B2_CELLS, 'tiv', null),
        pricing: {
            ...base.pricing,
            predictedPremium: 205000,
            adequacy: 0.8536585365853658,
            expectedLoss: 25000,
            ratePer100Tiv: 0.13666666665755556,
            notes: ['Rates fitted to the book.', 'Underpriced: adequacy is under 0.9.'],
        },
        buildings: [
            building('B-1', 1995, 'Joisted Masonry', 75000000.01, []),
            building('B-2', 2004, 'Frame', 75000000, ['unacceptable construction']),
        ],
        rollup: { ...base.rollup, totalTiv: 150000000.01 },
        flip: {
            available: true,
            reason: null,
            moves: [
                {
                    componentKey: 'totalTiv',
                    label: 'Total insured value',
                    from: 150000000.01,
                    to: 150000000,
                    humanText: 'Reduce scheduled TIV to $150,000,000.',
                },
            ],
            scoreBefore: 75,
            scoreAfter: 84,
            premiumBefore: 205000,
            premiumAfter: 205000,
            verdictAfter: 'FIT',
            distanceToAppetite: 1,
        },
        vector: {
            ...base.vector,
            components: vectorComponents([
                [1, 1],
                [1, 1],
                [1, 1],
                [150000000.01, 0],
                [175000, 0.6],
                [0, 0.6],
                [0, 0.6],
                [0.5, 1],
                [100000, 1],
                [0.5, 0.5],
                [4, 4],
            ]),
        },
        actionLog: [logEntry(id, name, 'act-dnf-route', 'route', 'applied', [75, 4, 'DOES_NOT_FIT'], [75, 4, 'DOES_NOT_FIT'])],
    };
}
function noPolicy() {
    const id = 'sub-no-policy';
    const name = 'Mahoning Valley Printers';
    return {
        submissionId: id,
        insuredName: name,
        lineOfBusiness: 'commercial_property',
        displayLineOfBusiness: 'commercial_property',
        accountKind: 'no_policy',
        synthetic: false,
        facts: {
            source: 'federato_triage',
            traceId: 'q-1',
            federatoId: 115,
            submissionNumber: id,
            insuredName: name,
            brokerName: 'Highland Risk Partners',
            underwriterName: null,
            lineOfBusiness: 'property',
            status: 'declined',
            requestedLimit: 10000000,
            receivedDate: '2025-08-15',
            targetEffectiveDate: '2025-10-01',
            declineReason: 'loss_history',
            competitor: null,
        },
        verification: null,
        verdict: 'REFER',
        appetiteScore: 15,
        completeness: 11.11111111111111,
        confidence: 0.7,
        explanation: {
            verdict: 'REFER',
            headline: 'Refer: no policy record, so eight of nine required values are missing.',
            paragraphs: [
                'Only the line of business is known. Missing values score 0 points and are not a knockout.',
                'Request premium, TIV, state, buildings and loss history from the broker.',
            ],
            recommendation: 'Investigate: request the missing or conflicting information first.',
            decidingFactorId: 'line_of_business',
            decidingRuleId: 'commercial.line_of_business.target',
            confidence: 0.7,
        },
        factors: factorRows(NO_POLICY_CELLS, null, null),
        queryTrace: queryTrace('Submission', 11),
        schema: null,
        pricing: {
            quotedPremium: null,
            predictedPremium: null,
            adequacy: null,
            expectedLoss: null,
            ratePer100Tiv: null,
            currency: 'USD',
            factors: [],
            notes: ['No TIV, so no premium can be predicted.'],
        },
        peers: { peers: [], medianRatePer100Tiv: null, meanAnnualLoss: null, comparedComponentCount: 0 },
        buildings: [],
        rollup: EMPTY_ROLLUP,
        contradictions: [],
        interpretations: [],
        flip: {
            available: false,
            reason: 'Too many values are missing to propose a flip.',
            moves: [],
            scoreBefore: 15,
            scoreAfter: null,
            premiumBefore: null,
            premiumAfter: null,
            verdictAfter: null,
            distanceToAppetite: null,
        },
        vector: {
            lineOfBusiness: 'commercial_property',
            specVersion: '1.0.0',
            completeness: 11.11111111111111,
            components: vectorComponents([
                [null, null],
                [1, 1],
            ]),
        },
        enrichment: [
            {
                source: 'openfema',
                title: 'Flood zone (OpenFEMA)',
                available: false,
                unavailableReason: 'No location on file.',
                fetchedAt: null,
                rows: [],
            },
        ],
        routing: {
            region: null,
            underwriter: null,
            authorityLimit: null,
            withinAuthority: null,
            rationale: 'No primary state, so no region to route to.',
        },
        drafts: [
            {
                actionId: 'act-nopol-request',
                status: 'draft',
                subject: `Information request: ${name}`,
                body: 'Please send the schedule of values, the quoted premium and five years of loss runs.',
                requestedFields: [
                    { path: 'pricing.quotedPremium', label: 'Quoted premium', voi: 15 },
                    { path: 'buildings.*.tiv', label: 'Building TIV', voi: 15 },
                ],
            },
        ],
        actionLog: [logEntry(id, name, 'act-nopol-request', 'request', 'draft', [15, 3, 'REFER'], null)],
        sweep: null,
    };
}
/**
 * Typed console fixtures: one FIT, one REFER, one DOES_NOT_FIT and one account
 * with no policy record. Used by the C0x component tests so the console can be
 * tested without the API. Stub frozen by W0-4; unit C01 replaces these bodies.
 */
export function fixtureQueue() {
    const row = (s, rank, qualityIndex, extra = {}) => ({
        submissionId: s.submissionId,
        rank,
        qualityIndex,
        verdict: s.verdict,
        insuredName: s.insuredName,
        lineOfBusiness: s.lineOfBusiness,
        primaryState: s.rollup.primaryState,
        appetiteScore: s.appetiteScore,
        quotedPremium: s.pricing.quotedPremium,
        predictedPremium: s.pricing.predictedPremium,
        adequacy: s.pricing.adequacy,
        completeness: s.completeness,
        contradictionCount: s.contradictions.length,
        oneFlipFromFit: s.flip.distanceToAppetite === 1,
        assignedUnderwriter: s.routing.underwriter,
        underwriterSource: s.routing.underwriter === null ? null : 'routed',
        synthetic: false,
        totalTiv: null,
        pendingAction: s.drafts.length > 0 ? 'Request (draft)' : null,
        explanationLine: s.explanation.headline,
        outOfAppetiteLine: false,
        ...extra,
    });
    return [
        row(fixtureSubmission('fit'), 1, 79.72321428571428),
        row(fixtureSubmission('refer'), 2, 77.13909774436091),
        row(fixtureSubmission('no-policy'), 3, 18.63247863247863),
        row(fixtureSubmission('dnf'), 4, 72.39372822299651),
        {
            submissionId: 'sub-cyber',
            rank: 5,
            qualityIndex: 16.495726495726494,
            verdict: 'DOES_NOT_FIT',
            insuredName: 'Erie Data Systems',
            lineOfBusiness: 'cyber',
            primaryState: null,
            appetiteScore: 10,
            quotedPremium: null,
            predictedPremium: null,
            adequacy: null,
            completeness: 22.22222222222222,
            contradictionCount: 0,
            oneFlipFromFit: false,
            assignedUnderwriter: null,
            underwriterSource: null,
            synthetic: false,
            totalTiv: null,
            pendingAction: null,
            explanationLine: 'Does not fit: cyber is not a property line.',
            outOfAppetiteLine: true,
        },
    ];
}
export function fixtureSubmission(kind) {
    switch (kind) {
        case 'fit':
            return fit();
        case 'refer':
            return refer();
        case 'dnf':
            return dnf();
        case 'no-policy':
            return noPolicy();
    }
}
//# sourceMappingURL=dto.js.map