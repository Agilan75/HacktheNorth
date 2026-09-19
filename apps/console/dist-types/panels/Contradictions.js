import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { formatPercent, pluralize } from '@retrofit/contracts';
import { cssVar, SPACE } from '@retrofit/design';
import { Badge } from '../components/atoms/Badge.js';
import { Card } from '../components/atoms/Card.js';
import { CitationQuote } from '../components/atoms/CitationQuote.js';
/** Display order only: HIGH first. The severity itself comes from the engine. */
const SEVERITY_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const SOURCE_LABELS = {
    self_reported: 'Self-reported',
    enrichment: 'Enrichment',
    sweep: 'Sweep',
    answer: 'Broker answer',
};
const listStyle = {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'grid',
    gap: SPACE.lg,
};
const itemStyle = {
    borderTop: `1px solid ${cssVar('muted-tint')}`,
    paddingTop: SPACE.md,
};
const subheadingStyle = {
    fontFamily: cssVar('font-display'),
    fontSize: cssVar('size-body'),
    margin: `${SPACE.lg}px 0 ${SPACE.sm}px`,
};
const mutedStyle = { color: cssVar('muted-deep'), fontSize: cssVar('size-small') };
const cellStyle = {
    padding: `${SPACE.xs}px ${SPACE.sm}px`,
    borderBottom: `1px solid ${cssVar('muted-tint')}`,
    textAlign: 'left',
};
function isOpen(c) {
    return c.status.toLowerCase() === 'open';
}
function sortContradictions(list) {
    return list
        .map((c, index) => ({ c, index }))
        .sort((a, b) => {
        const byOpen = Number(!isOpen(a.c)) - Number(!isOpen(b.c));
        if (byOpen !== 0)
            return byOpen;
        const bySeverity = (SEVERITY_ORDER[a.c.severity] ?? 3) - (SEVERITY_ORDER[b.c.severity] ?? 3);
        return bySeverity !== 0 ? bySeverity : a.index - b.index;
    })
        .map((entry) => entry.c);
}
function ContradictionItem({ contradiction }) {
    const open = isOpen(contradiction);
    const highOpen = open && contradiction.severity === 'HIGH';
    return (_jsxs("li", { style: itemStyle, "data-testid": "contradiction", "data-severity": contradiction.severity, children: [_jsxs("div", { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: SPACE.sm }, children: [_jsx("code", { children: contradiction.field }), _jsx(Badge, { label: `${contradiction.severity} severity`, tone: contradiction.severity === 'LOW' ? 'quiet' : highOpen ? 'attention' : 'neutral' }), _jsx(Badge, { label: open ? 'Open' : 'Resolved', tone: open ? 'neutral' : 'quiet', title: `Status: ${contradiction.status}` })] }), _jsx("p", { style: { margin: `${SPACE.sm}px 0` }, children: contradiction.summary }), highOpen ? (_jsx("p", { style: { ...mutedStyle, margin: `0 0 ${SPACE.sm}px` }, children: "Open HIGH contradiction: the verdict is REFER unless a knockout already makes it DOES NOT FIT (INTERPRETATIONS V-3)." })) : null, contradiction.sides.length > 0 ? (_jsxs("table", { style: { borderCollapse: 'collapse', fontSize: cssVar('size-small') }, children: [_jsx("caption", { className: "rf-sr-only", children: `Conflicting values for ${contradiction.field}` }), _jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { scope: "col", style: cellStyle, children: "Value" }), _jsx("th", { scope: "col", style: cellStyle, children: "Source" }), _jsx("th", { scope: "col", style: { ...cellStyle, textAlign: 'right' }, children: "Confidence" })] }) }), _jsx("tbody", { children: contradiction.sides.map((side, i) => (_jsxs("tr", { children: [_jsx("td", { style: cellStyle, children: side.value }), _jsx("td", { style: cellStyle, children: SOURCE_LABELS[side.source] ?? side.source }), _jsx("td", { style: { ...cellStyle, textAlign: 'right' }, children: formatPercent(side.confidence) })] }, `${side.source}-${i}`))) })] })) : null] }));
}
function InterpretationItem({ interpretation }) {
    return (_jsxs("li", { style: itemStyle, "data-testid": "interpretation", children: [_jsxs("div", { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: SPACE.sm }, children: [_jsx("strong", { children: interpretation.title }), _jsx(Badge, { label: interpretation.id, tone: "quiet" })] }), _jsx("p", { style: { margin: `${SPACE.sm}px 0` }, children: interpretation.text }), interpretation.citation ? _jsx(CitationQuote, { citation: interpretation.citation, compact: true }) : null] }));
}
/**
 * PRD 10 (f) Contradictions and interpretations applied.
 *
 * Stub frozen by W0-4. Unit C09 replaces this body only — never the signature,
 * never the import list's shape, never this file's path.
 */
export function Contradictions(props) {
    const { contradictions, interpretations } = props;
    const sorted = sortContradictions(contradictions);
    const openCount = contradictions.filter(isOpen).length;
    const openHigh = contradictions.filter((c) => isOpen(c) && c.severity === 'HIGH').length;
    const asideLabel = contradictions.length === 0 ? 'No contradictions' : `${openCount} open of ${contradictions.length}`;
    return (_jsxs(Card, { title: "Contradictions and interpretations", anchorId: "f", aside: _jsx(Badge, { label: asideLabel, tone: openHigh > 0 ? 'attention' : 'quiet', title: openHigh > 0 ? pluralize(openHigh, 'open HIGH contradiction') : undefined }), children: [_jsx("h3", { style: { ...subheadingStyle, marginTop: 0 }, children: "Contradictions" }), sorted.length === 0 ? (_jsx("p", { style: mutedStyle, children: "No contradictions between sources." })) : (_jsx("ul", { style: listStyle, "aria-label": "Contradictions", children: sorted.map((c) => (_jsx(ContradictionItem, { contradiction: c }, c.id))) })), _jsx("h3", { style: subheadingStyle, children: "Interpretations applied" }), interpretations.length === 0 ? (_jsx("p", { style: mutedStyle, children: "No guideline interpretations were needed for this submission." })) : (_jsx("ul", { style: listStyle, "aria-label": "Interpretations applied", children: interpretations.map((i) => (_jsx(InterpretationItem, { interpretation: i }, i.id))) }))] }));
}
//# sourceMappingURL=Contradictions.js.map