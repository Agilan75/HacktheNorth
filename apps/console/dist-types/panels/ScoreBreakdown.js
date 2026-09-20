import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { formatPercent, formatScore, pluralize } from '@retrofit/contracts';
import { SPACE, TIER_LABELS, cssVar } from '@retrofit/design';
import { Badge } from '../components/atoms/Badge.js';
import { Card } from '../components/atoms/Card.js';
import { CitationQuote } from '../components/atoms/CitationQuote.js';
import { DataTable } from '../components/DataTable.js';
/* Private styles — base.css belongs to C02. */
const summaryStyle = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: `${SPACE.sm}px ${SPACE.xl}px`,
    margin: `0 0 ${SPACE.md}px`,
    padding: 0,
};
const summaryItemStyle = { display: 'flex', flexDirection: 'column', gap: SPACE.xs };
const summaryLabelStyle = {
    margin: 0,
    fontSize: cssVar('size-micro'),
    lineHeight: cssVar('leading-micro'),
    color: cssVar('muted-deep'),
};
const summaryValueStyle = {
    margin: 0,
    fontSize: cssVar('size-body'),
    lineHeight: cssVar('leading-body'),
    color: cssVar('ink'),
    fontVariantNumeric: 'tabular-nums',
};
const numberStyle = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const tierCellStyle = { display: 'flex', flexWrap: 'wrap', gap: SPACE.xs };
const mutedStyle = { color: cssVar('muted-deep') };
const noteStyle = {
    margin: `${SPACE.md}px 0 0`,
    fontSize: cssVar('size-micro'),
    lineHeight: cssVar('leading-micro'),
    color: cssVar('muted-deep'),
};
/** The printed tier word. A missing factor says so in words; colour never carries it alone. */
function tierText(row) {
    if (!row.known)
        return 'Missing';
    if (row.tier === null)
        return '—';
    return TIER_LABELS[row.tier];
}
/** `0.6` -> `0.6`, `1` -> `1.0`: the tier value next to its label. */
function tierValueText(row) {
    if (!row.known || row.tierValue === null)
        return null;
    return formatScore(row.tierValue, { decimals: 1 });
}
const COLUMNS = [
    {
        key: 'factor',
        header: 'Factor',
        render: (row) => row.label,
        sortValue: (row) => row.label,
    },
    {
        key: 'tier',
        header: 'Tier',
        headerTitle: 'Target 1.0, Acceptable 0.6, Not acceptable 0 (a knockout)',
        render: (row) => {
            const value = tierValueText(row);
            return (_jsxs("span", { style: tierCellStyle, "data-testid": `tier-${row.factorId}`, children: [_jsxs("span", { children: [tierText(row), value !== null ? _jsx("span", { style: mutedStyle, children: ` (${value})` }) : null] }), row.knockout ? (_jsx(Badge, { label: "Knockout", tone: "attention", title: "A Not acceptable tier decides DOES NOT FIT" })) : null] }));
        },
        sortValue: (row) => (row.known ? row.tierValue : null),
    },
    {
        key: 'weight',
        header: 'Weight',
        align: 'right',
        render: (row) => (_jsx("span", { style: numberStyle, "data-testid": `weight-${row.factorId}`, children: formatScore(row.weight, { decimals: 2 }) })),
        sortValue: (row) => row.weight,
    },
    {
        key: 'points',
        header: 'Points',
        align: 'right',
        headerTitle: '100 × weight × tier value; a missing factor scores 0',
        render: (row) => (_jsx("span", { style: numberStyle, "data-testid": `points-${row.factorId}`, children: formatScore(row.points, { decimals: 1 }) })),
        sortValue: (row) => row.points,
    },
    {
        key: 'citation',
        header: 'Rule, citation and quote',
        render: (row) => {
            if (row.citation === null) {
                return (_jsxs("span", { style: mutedStyle, children: [row.ruleId !== null ? _jsx("code", { children: row.ruleId }) : null, row.ruleId !== null ? ' · ' : null, row.known ? 'No citation recorded' : 'Not scored: the input is missing'] }));
            }
            return (_jsxs("div", { children: [row.ruleId !== null ? _jsx("code", { children: row.ruleId }) : null, _jsx(CitationQuote, { citation: row.citation, compact: true })] }));
        },
    },
];
/**
 * PRD 10 (b) Eight factors with tier, weight, points, citation and quote.
 *
 * Renders the engine's factor rows verbatim. The total is the `appetiteScore`
 * prop, never a re-sum of the rows (PRD 10: no panel recomputes a score). A
 * missing factor shows 0 points and the word "Missing" (INTERPRETATIONS G-2).
 */
export function ScoreBreakdown(props) {
    const { factors, appetiteScore, completeness } = props;
    const knownCount = factors.filter((f) => f.known).length;
    const knockoutCount = factors.filter((f) => f.knockout).length;
    const missingCount = factors.length - knownCount;
    return (_jsxs(Card, { title: "Score breakdown", anchorId: "b", aside: _jsx(Badge, { label: `${knownCount} of ${pluralize(factors.length, 'factor')} known`, tone: missingCount > 0 ? 'attention' : 'neutral' }), children: [_jsxs("dl", { style: summaryStyle, children: [_jsxs("div", { style: summaryItemStyle, children: [_jsx("dt", { style: summaryLabelStyle, children: "Appetite score" }), _jsx("dd", { style: summaryValueStyle, "data-testid": "breakdown-score", children: formatScore(appetiteScore, { decimals: 1, outOf: true }) })] }), _jsxs("div", { style: summaryItemStyle, children: [_jsx("dt", { style: summaryLabelStyle, children: "Completeness" }), _jsx("dd", { style: summaryValueStyle, "data-testid": "breakdown-completeness", children: formatPercent(completeness, { from: 'percent', decimals: 1 }) })] }), _jsxs("div", { style: summaryItemStyle, children: [_jsx("dt", { style: summaryLabelStyle, children: "Knockouts" }), _jsx("dd", { style: summaryValueStyle, "data-testid": "breakdown-knockouts", children: knockoutCount === 0 ? 'None' : pluralize(knockoutCount, 'knockout') })] })] }), _jsx(DataTable, { caption: "Appetite factors", columns: COLUMNS, rows: factors, rowKey: (row) => row.factorId, emptyLabel: "No appetite factors were evaluated." }), _jsx("p", { style: noteStyle, children: "Points are 100 \u00D7 weight \u00D7 tier value. Missing factors score 0 and the other weights are not rescaled. A knockout decides the verdict but does not zero the score." })] }));
}
//# sourceMappingURL=ScoreBreakdown.js.map