import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
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
    color: cssVar('red-deep'),
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
function TraceEntry({ entry }) {
    return (_jsxs("li", { style: entryStyle, "data-testid": "query-trace-entry", "data-step": entry.step, children: [_jsxs("div", { style: entryHeadStyle, children: [_jsxs("span", { style: stepStyle, children: ["Step ", entry.step] }), _jsx(Badge, { label: entry.phase, tone: "quiet", title: "Planner pass" }), _jsx("span", { style: resourceStyle, children: entry.resource }), entry.adapted ? (_jsx(Badge, { label: "Adapted", tone: "attention", title: "The planner rewrote this query after a first attempt" })) : null] }), _jsx("p", { style: purposeStyle, children: entry.purpose }), _jsxs("p", { style: metaStyle, children: [pluralize(entry.resultCount, 'row'), " \u00B7 ", formatDuration(entry.durationMs)] }), entry.note !== null && entry.note !== '' ? _jsx("p", { style: noteStyle, children: entry.note }) : null, _jsxs("details", { children: [_jsx("summary", { style: metaStyle, children: "Query payload" }), _jsx("pre", { style: payloadStyle, children: _jsx("code", { children: payloadText(entry.payload) }) })] })] }));
}
/**
 * PRD 10 (c) How the agent got here: the query trace.
 *
 * Stub frozen by W0-4. Unit C07 replaces this body only — never the signature,
 * never the import list's shape, never this file's path.
 */
export function QueryTrace(props) {
    const entries = [...props.entries].sort((a, b) => a.step - b.step);
    const adaptedCount = entries.filter((e) => e.adapted).length;
    const aside = entries.length === 0 ? null : (_jsxs("span", { children: [pluralize(entries.length, 'query', 'queries'), adaptedCount > 0 ? ` · ${adaptedCount} adapted` : ''] }));
    return (_jsx(Card, { title: "How the agent got here", anchorId: "query-trace", aside: aside, children: entries.length === 0 ? (_jsx("p", { style: emptyStyle, children: "No queries were recorded for this submission." })) : (_jsx("ol", { style: listStyle, "aria-label": "Queries in the order the planner issued them", children: entries.map((entry) => (_jsx(TraceEntry, { entry: entry }, `${entry.step}-${entry.resource}`))) })) }));
}
//# sourceMappingURL=QueryTrace.js.map