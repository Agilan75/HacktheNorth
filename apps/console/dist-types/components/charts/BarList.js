import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useId } from 'react';
/** ViewBox geometry, in SVG user units. */
export const BAR_LIST_GEOMETRY = {
    width: 640,
    rowHeight: 32,
    barHeight: 18,
    labelWidth: 220,
    countWidth: 56,
    padTop: 4,
};
const MAX_LABEL_CHARS = 30;
function shorten(label) {
    return label.length <= MAX_LABEL_CHARS ? label : `${label.slice(0, MAX_LABEL_CHARS - 1)}…`;
}
function safeCount(n) {
    return Number.isFinite(n) && n > 0 ? n : 0;
}
/**
 * Width of one bar in user units: proportional to `count / max`, zero when
 * `max` is zero. Exported so the proportionality is testable.
 */
export function barWidth(count, max, plotWidth) {
    const c = safeCount(count);
    const m = safeCount(max);
    if (m === 0)
        return 0;
    return (Math.min(c, m) / m) * plotWidth;
}
/**
 * Hand-written SVG horizontal bar chart. Colour never carries meaning alone:
 * every bar prints its label (and optional mark) and its count, and the same
 * numbers are repeated in a visually hidden table for screen readers.
 */
export function BarList(props) {
    const { title, items, emptyLabel = 'Nothing to show yet.', countLabel = 'Count' } = props;
    const titleId = useId();
    if (items.length === 0) {
        return (_jsx("p", { className: "rf-chart-empty", style: { color: 'var(--rf-muted-deep)', margin: 0 }, children: emptyLabel }));
    }
    const g = BAR_LIST_GEOMETRY;
    const plotWidth = g.width - g.labelWidth - g.countWidth;
    const max = items.reduce((m, it) => Math.max(m, safeCount(it.count)), 0);
    const height = g.padTop * 2 + items.length * g.rowHeight;
    const summary = items.map((it) => `${it.label}: ${safeCount(it.count)}`).join(', ');
    return (_jsxs("figure", { className: "rf-chart rf-chart--bars", style: { margin: 0 }, children: [_jsxs("svg", { role: "img", "aria-labelledby": titleId, viewBox: `0 0 ${g.width} ${height}`, width: "100%", style: { display: 'block', maxWidth: '100%', height: 'auto' }, fontFamily: "var(--rf-font-body)", children: [_jsx("title", { id: titleId, children: `${title}. ${summary}.` }), items.map((it, i) => {
                        const y = g.padTop + i * g.rowHeight;
                        const w = barWidth(it.count, max, plotWidth);
                        const fill = it.fill ?? 'var(--rf-muted-deep)';
                        const stroke = it.stroke ?? fill;
                        const label = it.mark ? `${it.mark} ${it.label}` : it.label;
                        const barY = y + (g.rowHeight - g.barHeight) / 2;
                        return (_jsxs("g", { "data-testid": `bar-${it.key}`, "data-count": safeCount(it.count), children: [_jsxs("text", { x: g.labelWidth - 12, y: y + g.rowHeight / 2, textAnchor: "end", dominantBaseline: "central", fontSize: 14, fill: "var(--rf-ink)", children: [label.length > MAX_LABEL_CHARS ? _jsx("title", { children: label }) : null, shorten(label)] }), _jsx("rect", { x: g.labelWidth, y: barY, width: plotWidth, height: g.barHeight, rx: g.barHeight / 2, fill: "var(--rf-muted-tint)" }), w > 0 ? (_jsx("rect", { "data-role": "bar", x: g.labelWidth + 0.5, y: barY + 0.5, width: Math.max(w - 1, 1), height: g.barHeight - 1, rx: (g.barHeight - 1) / 2, fill: fill, stroke: stroke, strokeWidth: 1.5 })) : null, _jsx("text", { x: g.width - 4, y: y + g.rowHeight / 2, textAnchor: "end", dominantBaseline: "central", fontSize: 14, fontWeight: 600, fill: "var(--rf-ink)", children: safeCount(it.count).toLocaleString('en-US') })] }, it.key));
                    })] }), _jsxs("table", { className: "rf-sr-only", children: [_jsx("caption", { children: title }), _jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { scope: "col", children: "Item" }), _jsx("th", { scope: "col", children: countLabel })] }) }), _jsx("tbody", { children: items.map((it) => (_jsxs("tr", { children: [_jsx("th", { scope: "row", children: it.label }), _jsx("td", { children: safeCount(it.count) })] }, it.key))) })] })] }));
}
//# sourceMappingURL=BarList.js.map