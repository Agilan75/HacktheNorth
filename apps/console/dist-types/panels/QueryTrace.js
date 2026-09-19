import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { formatScore, pluralize } from '@retrofit/contracts';
import { cssVar, SPACE } from '@retrofit/design';
import { Badge } from '../components/atoms/Badge';
import { Card } from '../components/atoms/Card';
const listStyle = {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: SPACE.md,
};
const entryStyle = {
    borderLeft: `2px solid ${cssVar('muted-tint')}`,
    paddingLeft: SPACE.md,
};
const entryHeadStyle = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: SPACE.sm,
    fontFamily: cssVar('font-body'),
    fontSize: cssVar('size-small'),
    lineHeight: cssVar('leading-small'),
    color: cssVar('ink'),
};
const stepStyle = {
    fontWeight: 600,
    color: cssVar('muted-deep'),
    fontVariantNumeric: 'tabular-nums',
};
const resourceStyle = { fontWeight: 600 };
const metaStyle = {
    margin: `${SPACE.xs}px 0 0`,
    fontSize: cssVar('size-micro'),
    lineHeight: cssVar('leading-micro'),
    color: cssVar('muted-deep'),
    fontVariantNumeric: 'tabular-nums',
};
const purposeStyle = {
    margin: `${SPACE.xs}px 0 0`,
    fontSize: cssVar('size-small'),
    lineHeight: cssVar('leading-small'),
    color: cssVar('ink'),
};
const noteStyle = {
    margin: `${SPACE.xs}px 0 0`,
    fontSize: cssVar('size-small'),
    lineHeight: cssVar('leading-small'),
    color: cssVar('ink'),
};
const errorStyle = { ...noteStyle, color: cssVar('red-deep') };
const labelStyle = { fontWeight: 600 };
const subListStyle = {
    margin: `${SPACE.xs}px 0 0`,
    paddingLeft: SPACE.lg,
    fontSize: cssVar('size-small'),
    lineHeight: cssVar('leading-small'),
    color: cssVar('ink'),
};
const codeStyle = {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '0.95em',
};
const payloadStyle = {
    margin: `${SPACE.xs}px 0 0`,
    padding: SPACE.sm,
    background: cssVar('muted-tint'),
    borderRadius: 8,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: cssVar('size-micro'),
    lineHeight: cssVar('leading-micro'),
    overflowX: 'auto',
    whiteSpace: 'pre',
    maxWidth: '100%',
};
const emptyStyle = {
    margin: 0,
    fontSize: cssVar('size-small'),
    color: cssVar('muted-deep'),
};
/** Pretty-prints a query payload; never throws on a cyclic or BigInt value. */
function payloadText(payload) {
    if (payload === undefined)
        return 'undefined';
    try {
        const text = JSON.stringify(payload, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2);
        return text ?? String(payload);
    }
    catch {
        return String(payload);
    }
}
function formatDuration(ms) {
    if (!Number.isFinite(ms))
        return '—';
    if (ms >= 1000)
        return `${formatScore(ms / 1000, { decimals: 2 })} s`;
    return `${formatScore(ms)} ms`;
}
/**
 * Plain-language readings of the planner's adaptation kinds
 * (packages/federato/src/planner/adapt.ts). An unknown kind is shown verbatim.
 */
const ADAPTATION_TEXT = {
    elem_match_swap: 'the previous attempt returned no rows through a dot-path into an array, so the planner retried with $elemMatch instead.',
    drop_narrowest_filter: 'the previous attempt returned no rows, so the planner dropped its narrowest filter and retried.',
};
function adaptationText(kind) {
    return ADAPTATION_TEXT[kind] ?? kind;
}
function hasText(value) {
    return value !== null && value !== undefined && value.trim() !== '';
}
function pathText(resource, path) {
    return [resource, ...(path ?? [])].join(' → ');
}
/** Ends a clause with a full stop unless it already carries terminal punctuation. */
function sentence(text) {
    const t = text.trim();
    return /[.!?:]$/.test(t) ? t : `${t}.`;
}
function TraceEntry({ entry }) {
    const needs = entry.requiredBy;
    const rejected = entry.alternativesRejected ?? [];
    const adaptation = hasText(entry.adaptation) && entry.adaptation !== 'none' ? entry.adaptation : null;
    return (_jsxs("li", { style: entryStyle, "data-testid": "query-trace-entry", "data-step": entry.step, children: [_jsxs("div", { style: entryHeadStyle, children: [_jsxs("span", { style: stepStyle, children: ["Step ", entry.step] }), _jsx(Badge, { label: entry.phase, tone: "quiet", title: "Planner pass" }), _jsx("span", { style: resourceStyle, children: entry.resource }), entry.adapted ? (_jsx(Badge, { label: "Adapted", tone: "attention", title: "The planner rewrote this query after a first attempt" })) : null] }), _jsxs("p", { style: purposeStyle, "data-testid": "trace-goal", children: [_jsx("span", { style: labelStyle, children: "Goal:" }), " ", entry.purpose] }), needs === undefined ? null : needs.length === 0 ? (_jsx("p", { style: noteStyle, "data-testid": "trace-needs-none", children: "No scoring rule needed this query; it gathers context for the ones that do." })) : (_jsxs(_Fragment, { children: [_jsx("p", { style: noteStyle, children: _jsx("span", { style: labelStyle, children: "Needed by:" }) }), _jsx("ul", { style: subListStyle, "aria-label": `Rules that needed step ${entry.step}`, children: needs.map((n, i) => (_jsxs("li", { "data-testid": "trace-need", children: ["Rule ", _jsx("code", { style: codeStyle, children: n.ruleId }), n.factor !== null && n.factor !== '' ? ` (${n.factor})` : '', " needs", ' ', _jsx("code", { style: codeStyle, children: n.canonicalPath }), hasText(n.why) ? `: ${n.why}` : ''] }, `${n.ruleId}-${n.canonicalPath}-${i}`))) })] })), hasText(entry.why) || (entry.path !== undefined && entry.path.length > 0) ? (_jsxs("p", { style: noteStyle, "data-testid": "trace-path", children: [_jsx("span", { style: labelStyle, children: "Path chosen:" }), " Went to ", pathText(entry.resource, entry.path), hasText(entry.why) ? ` because ${sentence(entry.why)}` : '.'] })) : null, rejected.length > 0 ? (_jsxs(_Fragment, { children: [_jsx("p", { style: noteStyle, children: _jsx("span", { style: labelStyle, children: "Considered and rejected:" }) }), _jsx("ul", { style: subListStyle, "aria-label": `Alternatives rejected at step ${entry.step}`, children: rejected.map((a, i) => (_jsxs("li", { "data-testid": "trace-rejected", children: [pathText(a.rootResource, a.path), ": ", sentence(a.why)] }, `${a.rootResource}-${i}`))) })] })) : null, _jsxs("p", { style: metaStyle, "data-testid": "trace-result", children: ["Returned ", pluralize(entry.resultCount, 'row'), " in ", formatDuration(entry.durationMs), "."] }), adaptation !== null ? (_jsxs("p", { style: noteStyle, "data-testid": "trace-adaptation", children: [_jsx("span", { style: labelStyle, children: "Adapted:" }), " ", adaptationText(adaptation)] })) : null, hasText(entry.note) ? (_jsxs("p", { style: noteStyle, "data-testid": "trace-note", children: [_jsx("span", { style: labelStyle, children: "Note:" }), " ", entry.note] })) : null, hasText(entry.error) ? (_jsxs("p", { style: errorStyle, "data-testid": "trace-error", children: [_jsx("span", { style: labelStyle, children: "Error:" }), " ", entry.error] })) : null, _jsxs("details", { children: [_jsx("summary", { style: metaStyle, children: "Query payload" }), _jsx("pre", { style: payloadStyle, children: _jsx("code", { children: payloadText(entry.payload) }) })] })] }));
}
/**
 * PRD 10 (c) How the agent got here: the query trace.
 *
 * Each query reads as prose (R3-2, PRD 7.5 step 6): the goal, which rule needed
 * it, the path chosen and why, the alternatives rejected, the row count and
 * duration, and any adaptation. The raw payload stays behind a disclosure.
 */
export function QueryTrace(props) {
    const entries = [...props.entries].sort((a, b) => a.step - b.step);
    const adaptedCount = entries.filter((e) => e.adapted).length;
    const aside = entries.length === 0 ? null : (_jsxs("span", { children: [pluralize(entries.length, 'query', 'queries'), adaptedCount > 0 ? ` · ${adaptedCount} adapted` : ''] }));
    return (_jsx(Card, { title: "How the agent got here", anchorId: "query-trace", aside: aside, children: entries.length === 0 ? (_jsx("p", { style: emptyStyle, children: "No queries were recorded for this submission." })) : (_jsx("ol", { style: listStyle, "aria-label": "Queries in the order the planner issued them", children: entries.map((entry) => (_jsx(TraceEntry, { entry: entry }, `${entry.step}-${entry.resource}`))) })) }));
}
//# sourceMappingURL=QueryTrace.js.map