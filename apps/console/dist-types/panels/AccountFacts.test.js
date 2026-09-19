import { jsx as _jsx } from "react/jsx-runtime";
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountFacts, lineOfBusinessLabel } from './AccountFacts.js';
afterEach(cleanup);
/** SUB-2024-00008 as the API serves it from the committed snapshot. */
const KNOCKOUT_FACTS = {
    source: 'federato_triage',
    traceId: 'q-000',
    federatoId: 8,
    submissionNumber: 'SUB-2024-00008',
    insuredName: 'Redline Logistics Inc',
    brokerName: 'Ashford Specialty Group',
    underwriterName: 'A. Delgado',
    lineOfBusiness: 'health',
    status: 'bound',
    requestedLimit: 1000000,
    receivedDate: '2024-07-10',
    targetEffectiveDate: '2024-10-01',
    declineReason: null,
    competitor: null,
};
const LOB_NA = {
    factorId: 'line_of_business', label: 'Line of business', tier: 'not_acceptable', tierValue: 0, weight: 0.15, points: 0,
    known: true, knockout: true, ruleId: 'AG-LOB-NA',
    citation: { document: 'APPETITE_GUIDELINES.pdf', page: 2, row: 'p2 "Line of business"', quote: 'All other lines' },
};
function fact(key) {
    return document.querySelector(`[data-fact=${key}] dd`)?.textContent ?? '';
}
describe('lineOfBusinessLabel', () => {
    it('labels Federato lines and the scoring spec, and never guesses an acronym', () => {
        expect(lineOfBusinessLabel('cyber')).toBe('Cyber');
        expect(lineOfBusinessLabel('health')).toBe('Health');
        expect(lineOfBusinessLabel('commercial_property')).toBe('Commercial property');
        expect(lineOfBusinessLabel('cgl')).toBe('CGL');
        expect(lineOfBusinessLabel('lpl')).toBe('LPL');
        expect(lineOfBusinessLabel(null)).toBe('Not recorded');
    });
});
describe('AccountFacts', () => {
    it('a triage knockout says why in words, with the guideline quote, and lists every fact', () => {
        render(_jsx(AccountFacts, { accountKind: "triage_knockout", displayLineOfBusiness: "health", facts: KNOCKOUT_FACTS, factors: [LOB_NA], traceAnchor: "panel-c" }));
        const why = screen.getByTestId('why-not-scored');
        expect(why).toHaveTextContent('Knocked out at triage: line of business is Health.');
        expect(why).toHaveTextContent("The carrier's appetite covers property only");
        expect(why).toHaveTextContent('“All other lines”');
        expect(fact('insuredName')).toBe('Redline Logistics Inc');
        expect(fact('lineOfBusiness')).toBe('Health');
        expect(fact('brokerName')).toBe('Ashford Specialty Group');
        expect(fact('requestedLimit')).toBe('$1,000,000');
        expect(fact('receivedDate')).toBe('Jul 10, 2024');
        expect(fact('targetEffectiveDate')).toBe('Oct 1, 2024');
        expect(fact('status')).toBe('Bound');
        expect(fact('underwriterName')).toBe('A. Delgado');
        expect(fact('submissionNumber')).toBe('SUB-2024-00008');
        // Absent facts are said in words, never a dash.
        expect(fact('declineReason')).toBe('None recorded');
        expect(fact('competitor')).toBe('None recorded');
        expect(document.body.textContent).not.toContain('—');
        expect(document.body.textContent).not.toMatch(/commercial[ _]property/i);
        expect(screen.getByRole('link', { name: 'q-000' })).toHaveAttribute('href', '#panel-c');
    });
    it('a no-policy account names what was assessed and what is missing, from the factor rows', () => {
        const factors = [
            { ...LOB_NA, tier: 'acceptable', tierValue: 0.6, knockout: false, points: 9, label: 'Line of business' },
            { ...LOB_NA, factorId: 'tiv', label: 'TIV', tier: null, tierValue: null, known: false, knockout: false, points: 0 },
            { ...LOB_NA, factorId: 'total_premium', label: 'Premium', tier: null, tierValue: null, known: false, knockout: false, points: 0 },
        ];
        render(_jsx(AccountFacts, { accountKind: "no_policy", displayLineOfBusiness: "commercial_property", facts: { ...KNOCKOUT_FACTS, lineOfBusiness: 'property', status: 'declined', declineReason: 'loss_history', underwriterName: null }, factors: factors, traceAnchor: "panel-c" }));
        const why = screen.getByTestId('why-not-scored');
        expect(why).toHaveTextContent('Not fully scored: Federato holds no policy for this submission.');
        expect(why).toHaveTextContent('no buildings, premium or loss history to score');
        expect(why).toHaveTextContent('Assessed: Line of business. Missing: TIV and Total premium.');
        expect(fact('lineOfBusiness')).toBe('Property');
        expect(fact('declineReason')).toBe('Loss history');
        expect(fact('underwriterName')).toBe('No underwriter assigned in Federato');
    });
    it('facts stored before they were read say so, and every value reads "Not read yet"', () => {
        const empty = {
            source: 'not_fetched', traceId: null, federatoId: null, submissionNumber: 'SUB-2024-00008', insuredName: null,
            brokerName: null, underwriterName: null, lineOfBusiness: null, status: null, requestedLimit: null, receivedDate: null,
            targetEffectiveDate: null, declineReason: null, competitor: null,
        };
        render(_jsx(AccountFacts, { accountKind: "triage_knockout", displayLineOfBusiness: "cyber", facts: empty, factors: [], traceAnchor: "panel-c" }));
        expect(screen.getByTestId('facts-provenance')).toHaveTextContent('have not been read yet');
        expect(fact('brokerName')).toBe('Not read yet');
        expect(fact('lineOfBusiness')).toBe('Cyber');
        expect(screen.getByTestId('why-not-scored')).toHaveTextContent('line of business is Cyber.');
    });
    it('an API without facts still names the line and says the facts are not sent', () => {
        render(_jsx(AccountFacts, { accountKind: "triage_knockout", displayLineOfBusiness: "auto", facts: null, factors: [], traceAnchor: "panel-c" }));
        expect(screen.getByTestId('facts-provenance')).toHaveTextContent('does not send');
        expect(fact('lineOfBusiness')).toBe('Auto');
        expect(fact('insuredName')).toBe('Not read yet');
    });
});
//# sourceMappingURL=AccountFacts.test.js.map