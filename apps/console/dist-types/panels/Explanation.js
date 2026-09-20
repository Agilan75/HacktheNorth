import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { formatPercent, formatScore, titleCase } from '@retrofit/contracts';
import { SPACE, cssVar } from '@retrofit/design';
import { Card } from '../components/atoms/Card.js';
import { VerdictPill } from '../components/atoms/VerdictPill.js';
/* Private layout styles — base.css belongs to C02, so this panel styles inline from tokens. */
const headlineStyle = {
    margin: 0,
    fontFamily: cssVar('font-display'),
    fontSize: cssVar('size-heading'),
    lineHeight: cssVar('leading-heading'),
    color: cssVar('ink'),
};
const statsStyle = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: `${SPACE.sm}px ${SPACE.xl}px`,
    margin: `${SPACE.md}px 0 0`,
    padding: 0,
};
const statStyle = { display: 'flex', flexDirection: 'column', gap: SPACE.xs };
const statLabelStyle = {
    margin: 0,
    fontSize: cssVar('size-micro'),
    lineHeight: cssVar('leading-micro'),
    color: cssVar('muted-deep'),
};
const statValueStyle = {
    margin: 0,
    fontSize: cssVar('size-body'),
    lineHeight: cssVar('leading-body'),
    color: cssVar('ink'),
    fontVariantNumeric: 'tabular-nums',
};
const paragraphStyle = {
    margin: `${SPACE.md}px 0 0`,
    fontSize: cssVar('size-body'),
    lineHeight: cssVar('leading-body'),
    color: cssVar('ink'),
};
/**
 * What to do next is the one thing on this page worth raising, so it takes the
 * phone kit's emphasised surface: bone, with a 2px accent edge. The label
 * above it says "Recommendation", so the edge is never the only signal.
 */
const recommendationStyle = {
    margin: `${SPACE.lg}px 0 0`,
    padding: `${SPACE.md}px ${SPACE.lg}px`,
    border: `2px solid ${cssVar('accent')}`,
    borderRadius: cssVar('radius-card'),
};
const recommendationLabelStyle = {
    margin: 0,
    fontSize: cssVar('size-micro'),
    lineHeight: cssVar('leading-micro'),
    fontWeight: 600,
    color: cssVar('muted-deep'),
};
const recommendationTextStyle = {
    margin: `${SPACE.xs}px 0 0`,
    fontSize: cssVar('size-body'),
    lineHeight: cssVar('leading-body'),
    color: cssVar('ink'),
};
/** `building_age` -> `Building age`: sentence case for an in-line label. */
function factorLabel(factorId) {
    const title = titleCase(factorId);
    return title.length === 0 ? factorId : `${title.charAt(0)}${title.slice(1).toLowerCase()}`;
}
/**
 * PRD 10 (a) Explanation and recommendation.
 *
 * Every number here is read straight off the props (PRD 10 house rule): the
 * appetite score, the confidence and the deciding rule are rendered, never
 * recomputed. The verdict pill always carries its word (PRD 13).
 */
export function Explanation(props) {
    const { explanation, verdict, appetiteScore } = props;
    const deciding = explanation.decidingFactorId !== null ? factorLabel(explanation.decidingFactorId) : null;
    const paragraphs = explanation.paragraphs.filter((p) => p.trim().length > 0);
    const recommendation = explanation.recommendation.trim();
    return (_jsxs(Card, { title: "Explanation and recommendation", anchorId: "a", aside: _jsx(VerdictPill, { verdict: verdict, detail: deciding ?? undefined }), children: [_jsx("p", { style: headlineStyle, "data-testid": "explanation-headline", children: explanation.headline }), _jsxs("dl", { style: statsStyle, children: [_jsxs("div", { style: statStyle, children: [_jsx("dt", { style: statLabelStyle, children: "Appetite score" }), _jsx("dd", { style: statValueStyle, "data-testid": "explanation-score", children: formatScore(appetiteScore, { decimals: 1, outOf: true }) })] }), _jsxs("div", { style: statStyle, children: [_jsx("dt", { style: statLabelStyle, children: "Confidence" }), _jsx("dd", { style: statValueStyle, "data-testid": "explanation-confidence", children: formatPercent(explanation.confidence, { from: 'ratio' }) })] }), _jsxs("div", { style: statStyle, children: [_jsx("dt", { style: statLabelStyle, children: "Deciding factor" }), _jsx("dd", { style: statValueStyle, "data-testid": "explanation-deciding-factor", children: deciding ?? 'None: every appetite factor is missing' })] }), explanation.decidingRuleId !== null ? (_jsxs("div", { style: statStyle, children: [_jsx("dt", { style: statLabelStyle, children: "Deciding rule" }), _jsx("dd", { style: statValueStyle, "data-testid": "explanation-deciding-rule", children: _jsx("code", { children: explanation.decidingRuleId }) })] })) : null] }), paragraphs.map((text, index) => (_jsx("p", { style: paragraphStyle, className: "rf-explanation__paragraph", children: text }, index))), _jsxs("section", { style: recommendationStyle, "aria-label": "Recommendation", children: [_jsx("p", { style: recommendationLabelStyle, children: "Recommendation" }), _jsx("p", { style: recommendationTextStyle, "data-testid": "explanation-recommendation", children: recommendation.length > 0 ? recommendation : 'No recommendation recorded.' })] })] }));
}
//# sourceMappingURL=Explanation.js.map