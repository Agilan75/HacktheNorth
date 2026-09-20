import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const DEFAULT_LINES = 3;
const MAX_LINES = 50;
/**
 * PRD 13: skeleton loaders for every list and card.
 *
 * Stub frozen by W0-4. Unit C02 replaces this body only.
 */
export function Skeleton(props) {
    const requested = props.lines ?? DEFAULT_LINES;
    const count = Number.isFinite(requested)
        ? Math.min(MAX_LINES, Math.max(1, Math.floor(requested)))
        : DEFAULT_LINES;
    const lines = [];
    for (let i = 0; i < count; i += 1) {
        // The last line of a multi-line block is shorter, so it reads as a paragraph.
        const width = count > 1 && i === count - 1 ? '60%' : '100%';
        lines.push(_jsx("span", { className: "rf-skeleton__line", style: { width } }, i));
    }
    return (_jsxs("div", { className: "rf-skeleton", role: "status", "aria-live": "polite", "aria-busy": "true", "aria-label": props.label, style: props.width ? { width: props.width } : undefined, children: [_jsx("span", { className: "rf-sr-only", children: props.label }), _jsx("span", { "aria-hidden": "true", style: { display: 'contents' }, children: lines })] }));
}
//# sourceMappingURL=Skeleton.js.map