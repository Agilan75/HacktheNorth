import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link } from 'react-router';
import { formatDate, formatScore, formatVerdict } from '@retrofit/contracts';
import { SPACE, cssVar } from '@retrofit/design';
import { VerdictPill } from '../components/atoms/VerdictPill.js';
/** `primary_risk_state` -> `Primary risk state`. */
function factorLabel(id) {
    if (id === null || id.trim().length === 0)
        return 'None';
    const text = id.replace(/[_-]+/g, ' ').trim().replace(/\btiv\b/gi, 'TIV');
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
function knockoutText(ids) {
    return ids.length === 0 ? 'None' : ids.map(factorLabel).join(', ');
}
/* -------------------------------------------------------------------------- */
/* Styles                                                                      */
/* -------------------------------------------------------------------------- */
const summaryStyle = {
    margin: 0,
    fontFamily: cssVar('font-display'),
    fontSize: cssVar('size-heading'),
    lineHeight: cssVar('leading-heading'),
};
const sectionHeadStyle = {
    margin: `${SPACE.xl}px 0 ${SPACE.sm}px`,
    fontSize: cssVar('size-body'),
    lineHeight: cssVar('leading-body'),
};
const mutedStyle = {
    margin: `${SPACE.xs}px 0 0`,
    fontSize: cssVar('size-small'),
    lineHeight: cssVar('leading-small'),
    color: cssVar('muted-deep'),
};
const warnStyle = {
    margin: `${SPACE.md}px 0 0`,
    padding: `${SPACE.md}px ${SPACE.lg}px`,
    border: `1px solid ${cssVar('ink')}`,
    borderRadius: cssVar('radius-card'),
};
const reasoningStyle = {
    margin: `${SPACE.sm}px 0 0`,
    padding: `${SPACE.sm}px 0 ${SPACE.sm}px ${SPACE.lg}px`,
    borderLeft: `3px solid ${cssVar('muted-tint')}`,
    whiteSpace: 'pre-wrap',
};
const markStyle = { fontWeight: 600, whiteSpace: 'nowrap' };
/* -------------------------------------------------------------------------- */
/* Pieces                                                                      */
/* -------------------------------------------------------------------------- */
/**
 * Agree / disagree as a symbol AND a word (PRD 13: colour never carries
 * meaning alone; here there is no colour at all).
 */
export function AgreeMark(props) {
    const word = props.agrees ? 'Agrees' : 'Disagrees';
    return (_jsxs("span", { style: markStyle, "data-agrees": String(props.agrees), children: [_jsx("span", { "aria-hidden": "true", children: props.agrees ? '✓ ' : '✗ ' }), word] }));
}
function scoreText(o) {
    return formatScore(o.appetiteScore, { outOf: true });
}
function naiveRows(v) {
    const { engine, naive } = v;
    return [
        { key: 'verdict', label: 'Verdict', engine: _jsx(VerdictPill, { verdict: engine.verdict }), naive: _jsx(VerdictPill, { verdict: naive.verdict }), agrees: naive.agrees.verdict },
        { key: 'appetiteScore', label: 'Appetite score', engine: scoreText(engine), naive: scoreText(naive), agrees: naive.agrees.appetiteScore },
        { key: 'knockouts', label: 'Knockout factors', engine: knockoutText(engine.knockoutFactorIds), naive: knockoutText(naive.knockoutFactorIds), agrees: naive.agrees.knockouts },
        { key: 'decidingFactor', label: 'Deciding factor', engine: factorLabel(engine.decidingFactorId), naive: factorLabel(naive.decidingFactorId), agrees: naive.agrees.decidingFactor },
    ];
}
function summaryText(v) {
    const naiveOk = v.naive.agrees.all;
    const second = v.secondOpinion;
    if (second === null) {
        return naiveOk
            ? 'The independent implementation reached the same result as the engine. The second-opinion model never answered.'
            : 'The independent implementation disagrees with the engine. The second-opinion model never answered.';
    }
    if (naiveOk && second.agreed)
        return 'Both independent checks reached the same verdict as the engine.';
    if (naiveOk)
        return 'The independent implementation agrees with the engine; the second-opinion model reached a different verdict.';
    if (second.agreed)
        return 'The second-opinion model agrees with the engine; the independent implementation does not.';
    return 'Neither independent check agrees with the engine.';
}
/**
 * The two independent checks run on this real property account (PRD 12):
 * layer B's naive second implementation, written from the guideline table
 * with no shared code, and layer C's second-opinion model, given only the
 * guideline text and the facts. Every value is the DTO's.
 */
export function IndependentChecks(props) {
    const v = props.verification;
    const second = v.secondOpinion;
    return (_jsxs("div", { "data-testid": "independent-checks", children: [_jsx("p", { style: summaryStyle, "data-testid": "checks-summary", children: summaryText(v) }), _jsxs("p", { style: mutedStyle, children: [`Checked ${formatDate(v.generatedAt, { fallback: v.generatedAt })} against the engine’s result on this account: `, `${formatVerdict(v.engine.verdict)}, ${scoreText(v.engine)}.`] }), !v.matchesCurrentResult ? (_jsx("p", { role: "note", style: warnStyle, "data-testid": "checks-stale", children: "This account has been re-scored since these checks ran (for example by a broker reply), so the result on this page is not the one they checked." })) : null, _jsx("h3", { style: sectionHeadStyle, children: "Independent implementation" }), _jsx("p", { style: mutedStyle, children: "A second, deliberately naive implementation written straight from the guideline table, sharing no code with the engine, given the same facts." }), _jsx("div", { className: "rf-scroll-x", children: _jsxs("table", { "aria-label": "Engine compared with the independent implementation", style: { marginTop: SPACE.sm }, children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { scope: "col", children: "Outcome" }), _jsx("th", { scope: "col", children: "Engine" }), _jsx("th", { scope: "col", children: "Independent implementation" }), _jsx("th", { scope: "col", children: "Result" })] }) }), _jsx("tbody", { children: naiveRows(v).map((r) => (_jsxs("tr", { "data-testid": `naive-${r.key}`, children: [_jsx("th", { scope: "row", children: r.label }), _jsx("td", { children: r.engine }), _jsx("td", { children: r.naive }), _jsx("td", { children: _jsx(AgreeMark, { agrees: r.agrees }) })] }, r.key))) })] }) }), _jsx("h3", { style: sectionHeadStyle, children: "Second-opinion model" }), _jsx("p", { style: mutedStyle, children: "A language model given only the guideline text and this account\u2019s facts. It never saw the engine\u2019s answer." }), second === null ? (_jsx("p", { "data-testid": "second-opinion-missing", style: { margin: `${SPACE.sm}px 0 0` }, children: "The second-opinion model never answered for this account, so there is no second opinion to show." })) : (_jsxs("div", { "data-testid": "second-opinion", children: [_jsxs("dl", { style: { display: 'flex', flexWrap: 'wrap', gap: `${SPACE.sm}px ${SPACE.xl}px`, margin: `${SPACE.sm}px 0 0` }, children: [_jsxs("div", { children: [_jsx("dt", { style: mutedStyle, children: "Its verdict" }), _jsxs("dd", { style: { margin: 0 }, children: [_jsx(VerdictPill, { verdict: second.verdict }), " ", _jsx(AgreeMark, { agrees: second.agreed })] })] }), _jsxs("div", { children: [_jsx("dt", { style: mutedStyle, children: "Its deciding factor" }), _jsxs("dd", { style: { margin: 0 }, children: [factorLabel(second.decidingFactor), ' ', _jsx(AgreeMark, { agrees: second.decidingFactorAgreed })] })] })] }), _jsx("p", { style: { ...mutedStyle, marginTop: SPACE.md }, children: "Its written reasoning" }), _jsx("blockquote", { style: reasoningStyle, "data-testid": "second-opinion-reasoning", children: second.reasoning })] })), _jsx("p", { style: { margin: `${SPACE.lg}px 0 0` }, children: _jsx(Link, { to: props.verificationPath, children: "How the testing works, and every result across the book" }) })] }));
}
//# sourceMappingURL=IndependentChecks.js.map