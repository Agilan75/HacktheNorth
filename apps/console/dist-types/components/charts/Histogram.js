import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useId } from 'react';
/** ViewBox geometry, in SVG user units. */
export const HISTOGRAM_GEOMETRY = {
    width: 640,
    height: 260,
    padLeft: 8,
    padRight: 8,
    padTop: 24,
    padBottom: 48,
    gap: 6,
};
function safeCount(n) {
    return Number.isFinite(n) && n > 0 ? n : 0;
}
/** Column height in user units: proportional to `count / max`, zero when `max` is zero. */
export function columnHeight(count, max, plotHeight) {
    const c = safeCount(count);
    const m = safeCount(max);
    if (m === 0)
        return 0;
    return (Math.min(c, m) / m) * plotHeight;
}
/**
 * Hand-written SVG column histogram. Every column prints its count above it and
 * its bucket below it; a visually hidden table repeats the numbers.
 */
export function Histogram(props) {
    const { title, buckets, xLabel, emptyLabel = 'No scores yet.' } = props;
    const titleId = useId();
    const total = buckets.reduce((s, b) => s + safeCount(b.count), 0);
    if (buckets.length === 0 || total === 0) {
        return (_jsx("p", { className: "rf-chart-empty", style: { color: 'var(--rf-muted-deep)', margin: 0 }, children: emptyLabel }));
    }
    const g = HISTOGRAM_GEOMETRY;
    const plotWidth = g.width - g.padLeft - g.padRight;
    const plotHeight = g.height - g.padTop - g.padBottom;
    const slot = plotWidth / buckets.length;
    const colWidth = Math.max(slot - g.gap, 1);
    const max = buckets.reduce((m, b) => Math.max(m, safeCount(b.count)), 0);
    const baseline = g.padTop + plotHeight;
    const summary = buckets.map((b) => `${b.label}: ${safeCount(b.count)}`).join(', ');
    return (_jsxs("figure", { className: "rf-chart rf-chart--histogram", style: { margin: 0 }, children: [_jsxs("svg", { role: "img", "aria-labelledby": titleId, viewBox: `0 0 ${g.width} ${g.height}`, width: "100%", style: { display: 'block', maxWidth: '100%', height: 'auto' }, fontFamily: "var(--rf-font-body)", children: [_jsx("title", { id: titleId, children: `${title}. ${summary}.` }), _jsx("line", { x1: g.padLeft, x2: g.width - g.padRight, y1: baseline + 0.5, y2: baseline + 0.5, stroke: "var(--rf-muted)", strokeWidth: 1 }), buckets.map((b, i) => {
                        const h = columnHeight(b.count, max, plotHeight);
                        const x = g.padLeft + i * slot + g.gap / 2;
                        const cx = x + colWidth / 2;
                        return (_jsxs("g", { "data-testid": `column-${i}`, "data-count": safeCount(b.count), children: [h > 0 ? (_jsx("rect", { "data-role": "column", x: x, y: baseline - h, width: colWidth, height: h, rx: 4, fill: "var(--rf-ink)" })) : null, _jsx("text", { x: cx, y: baseline - h - 6, textAnchor: "middle", fontSize: 13, fontWeight: 600, fill: "var(--rf-ink)", children: safeCount(b.count).toLocaleString('en-US') }), _jsx("text", { x: cx, y: baseline + 18, textAnchor: "middle", fontSize: 12, fill: "var(--rf-muted-deep)", children: b.label })] }, `${i}-${b.label}`));
                    }), xLabel ? (_jsx("text", { x: g.width / 2, y: g.height - 8, textAnchor: "middle", fontSize: 13, fill: "var(--rf-muted-deep)", children: xLabel })) : null] }), _jsx("div", { className: "rf-sr-only", children: _jsxs("table", { children: [_jsx("caption", { children: title }), _jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { scope: "col", children: xLabel ?? 'Bucket' }), _jsx("th", { scope: "col", children: "Count" })] }) }), _jsx("tbody", { children: buckets.map((b, i) => (_jsxs("tr", { children: [_jsx("th", { scope: "row", children: b.label }), _jsx("td", { children: safeCount(b.count) })] }, `${i}-${b.label}`))) })] }) })] }));
}
//# sourceMappingURL=Histogram.js.map