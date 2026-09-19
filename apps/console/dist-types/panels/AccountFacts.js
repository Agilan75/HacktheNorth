import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { formatDate, formatMoney } from '@retrofit/contracts';
import { SPACE, cssVar } from '@retrofit/design';
import { CitationQuote } from '../components/atoms/CitationQuote.js';
/* -------------------------------------------------------------------------- */
/* Labels (presentation only)                                                  */
/* -------------------------------------------------------------------------- */
/** `loss_history` -> `Loss history`. Sentence case, underscores to spaces; `tiv` stays `TIV`. */
function humanize(value) {
    const text = value.replace(/[_-]+/g, ' ').trim().replace(/\btiv\b/gi, 'TIV');
    return text.length === 0 ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
/**
 * A line-of-business code as a reader sees it: `cyber` -> `Cyber`,
 * `commercial_property` -> `Commercial property`. Federato's short codes
 * (`cgl`, `lpl`) are shown upper-case as codes; nothing in the dataset or the
 * guidelines spells them out, so no expansion is guessed (FILL-console D4).
 */
export function lineOfBusinessLabel(line) {
    if (typeof line !== 'string' || line.trim().length === 0)
        return 'Not recorded';
    const trimmed = line.trim();
    if (/^[a-z]{1,3}$/i.test(trimmed))
        return trimmed.toUpperCase();
    return humanize(trimmed);
}
/* -------------------------------------------------------------------------- */
/* Styles                                                                      */
/* -------------------------------------------------------------------------- */
const reasonStyle = {
    margin: 0,
    padding: `${SPACE.md}px ${SPACE.lg}px`,
    border: `1px solid ${cssVar('muted-tint')}`,
    borderRadius: cssVar('radius-card'),
};
const reasonHeadStyle = {
    margin: 0,
    fontFamily: cssVar('font-display'),
    fontSize: cssVar('size-heading'),
    lineHeight: cssVar('leading-heading'),
};
const gridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: `${SPACE.md}px ${SPACE.xl}px`,
    margin: `${SPACE.lg}px 0 0`,
};
const termStyle = {
    margin: 0,
    fontSize: cssVar('size-micro'),
    lineHeight: cssVar('leading-micro'),
    color: cssVar('muted-deep'),
};
const valueStyle = { margin: 0 };
const absentStyle = { color: cssVar('muted-deep'), fontStyle: 'italic' };
const noteStyle = {
    margin: `${SPACE.md}px 0 0`,
    fontSize: cssVar('size-small'),
    lineHeight: cssVar('leading-small'),
    color: cssVar('muted-deep'),
};
/** Words for a fact Federato does not hold, or that was never read. Never a dash. */
function absentText(facts, whenNull) {
    if (facts === null || facts.source === 'not_fetched')
        return 'Not read yet';
    return whenNull;
}
function factRows(props) {
    const f = props.facts;
    const missing = (text) => absentText(f, text);
    const line = f?.lineOfBusiness ?? props.displayLineOfBusiness;
    return [
        { key: 'insuredName', term: 'Insured', value: f?.insuredName ?? null, absent: missing('Not recorded in Federato') },
        { key: 'lineOfBusiness', term: 'Line of business', value: lineOfBusinessLabel(line), absent: '' },
        { key: 'brokerName', term: 'Broker', value: f?.brokerName ?? null, absent: missing('Not recorded in Federato') },
        {
            key: 'requestedLimit',
            term: 'Requested limit',
            value: f?.requestedLimit !== null && f?.requestedLimit !== undefined ? formatMoney(f.requestedLimit) : null,
            absent: missing('Not recorded in Federato'),
        },
        {
            key: 'receivedDate',
            term: 'Received',
            value: f?.receivedDate ? formatDate(f.receivedDate, { fallback: f.receivedDate }) : null,
            absent: missing('Not recorded in Federato'),
        },
        {
            key: 'targetEffectiveDate',
            term: 'Target effective date',
            value: f?.targetEffectiveDate ? formatDate(f.targetEffectiveDate, { fallback: f.targetEffectiveDate }) : null,
            absent: missing('Not recorded in Federato'),
        },
        { key: 'status', term: 'Status in Federato', value: f?.status ? humanize(f.status) : null, absent: missing('Not recorded in Federato') },
        {
            key: 'declineReason',
            term: 'Decline reason',
            value: f?.declineReason ? humanize(f.declineReason) : null,
            absent: missing('None recorded'),
        },
        { key: 'competitor', term: 'Competitor', value: f?.competitor ?? null, absent: missing('None recorded') },
        {
            key: 'underwriterName',
            term: 'Underwriter in Federato',
            value: f?.underwriterName ?? null,
            absent: missing('No underwriter assigned in Federato'),
        },
        {
            key: 'submissionNumber',
            term: 'Federato submission',
            value: f?.submissionNumber ?? null,
            absent: missing('Not recorded in Federato'),
        },
    ];
}
function listText(labels) {
    if (labels.length === 0)
        return 'none';
    if (labels.length === 1)
        return labels[0] ?? '';
    return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1] ?? ''}`;
}
function WhyNotScored(props) {
    if (props.accountKind === 'triage_knockout') {
        const line = lineOfBusinessLabel(props.facts?.lineOfBusiness ?? props.displayLineOfBusiness);
        const lob = props.factors.find((f) => f.factorId === 'line_of_business');
        const citation = lob?.citation ?? null;
        return (_jsxs("div", { style: reasonStyle, "data-testid": "why-not-scored", "data-kind": "triage_knockout", children: [_jsx("p", { style: reasonHeadStyle, children: `Knocked out at triage: line of business is ${line}.` }), _jsx("p", { style: { margin: `${SPACE.sm}px 0 0` }, children: "The carrier's appetite covers property only; every other line is Not Acceptable. Because of that, the agent never queried this submission in depth, so Federato's policy, buildings, premium and losses were never read and there is nothing further to score." }), citation !== null ? _jsx(CitationQuote, { citation: citation, compact: true }) : null] }));
    }
    const assessed = props.factors.filter((f) => f.known).map((f) => humanize(f.factorId));
    const missing = props.factors.filter((f) => !f.known).map((f) => humanize(f.factorId));
    return (_jsxs("div", { style: reasonStyle, "data-testid": "why-not-scored", "data-kind": "no_policy", children: [_jsx("p", { style: reasonHeadStyle, children: "Not fully scored: Federato holds no policy for this submission." }), _jsxs("p", { style: { margin: `${SPACE.sm}px 0 0` }, children: ["With no policy there are no buildings, premium or loss history to score.", props.factors.length > 0
                        ? ` Assessed: ${listText(assessed)}. Missing: ${listText(missing)}.`
                        : ''] })] }));
}
/**
 * The lead of a sparse account page (a triage knockout or a no-policy
 * submission): who and what the submission is, from Federato's own Submission
 * record, and in plain words why it was not fully scored. Every value is the
 * DTO's; an absent one says so in words.
 */
export function AccountFacts(props) {
    const { facts } = props;
    const rows = factRows(props);
    let provenance;
    if (facts === null) {
        provenance = 'This API does not send Federato’s submission facts yet; they appear after it is redeployed.';
    }
    else if (facts.source === 'not_fetched') {
        provenance =
            'These facts have not been read yet: this account was stored before the triage query read them. They fill in on the next ingest.';
    }
    else {
        provenance = (_jsxs(_Fragment, { children: ['Read from Federato’s Submission record by the triage query', facts.traceId !== null ? (_jsxs(_Fragment, { children: [' ', _jsx("a", { href: `#${props.traceAnchor}`, children: facts.traceId })] })) : null, '. Display only: none of these values is scored.'] }));
    }
    return (_jsxs("div", { "data-testid": "account-facts", children: [_jsx(WhyNotScored, { ...props }), _jsx("dl", { style: gridStyle, "aria-label": "Submission facts", children: rows.map((r) => (_jsxs("div", { "data-fact": r.key, children: [_jsx("dt", { style: termStyle, children: r.term }), _jsx("dd", { style: valueStyle, children: r.value !== null ? r.value : _jsx("span", { style: absentStyle, children: r.absent }) })] }, r.key))) }), _jsx("p", { style: noteStyle, "data-testid": "facts-provenance", children: provenance })] }));
}
//# sourceMappingURL=AccountFacts.js.map