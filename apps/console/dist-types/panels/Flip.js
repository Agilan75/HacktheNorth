import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { formatMoney, formatPercent, formatScore, pluralize } from '@retrofit/contracts';
import { Badge } from '../components/atoms/Badge.js';
import { VerdictPill } from '../components/atoms/VerdictPill.js';
const USD_KEYS = new Set(['totalTiv', 'quotedPremium', 'fiveYearLoss']);
/** A move's endpoint in the component's own unit. Formatting only. */
function formatValue(key, value) {
    if (value === null)
        return 'Missing';
    if (USD_KEYS.has(key))
        return formatMoney(value, { decimals: Number.isInteger(value) ? 0 : 2 });
    if (key.startsWith('pct'))
        return formatPercent(value, { decimals: 1 });
    return Number.isInteger(value) ? formatScore(value) : formatScore(value, { decimals: 2 });
}
function distanceLabel(distance) {
    if (distance === null)
        return 'No flip';
    if (distance === 0)
        return 'In appetite';
    return `${pluralize(distance, 'move')} from FIT`;
}
function Stat(props) {
    return (_jsxs("div", { className: "rf-stat", "data-testid": props.testId, children: [_jsx("dt", { children: props.label }), _jsxs("dd", { children: [_jsx("span", { className: "rf-stat__before", children: props.before }), _jsx("span", { "aria-hidden": "true", children: ' → ' }), _jsx("span", { className: "rf-sr-only", children: ' becomes ' }), _jsx("span", { className: "rf-stat__value", children: props.after })] })] }));
}
function MoveList(props) {
    return (_jsx("ol", { className: "rf-flip__moves", "aria-label": "Moves", children: props.moves.map((m, i) => (_jsxs("li", { "data-testid": "flip-move", children: [_jsx("p", { className: "rf-flip__human", children: m.humanText }), _jsxs("p", { className: "rf-flip__delta", children: [_jsx("span", { children: m.label }), ' ', _jsx("code", { className: "rf-code", style: { opacity: 0.7 }, children: m.componentKey }), ': ', _jsx("span", { "data-testid": "flip-move-from", children: formatValue(m.componentKey, m.from) }), ' → ', _jsx("span", { "data-testid": "flip-move-to", children: formatValue(m.componentKey, m.to) })] })] }, `${m.componentKey}-${i}`))) }));
}
function Unavailable(props) {
    const { flip } = props;
    const lead = flip.distanceToAppetite === 0
        ? 'No flip needed: this account is already in appetite.'
        : 'No flip reaches FIT within two movable components.';
    return (_jsxs("div", { "data-testid": "flip-unavailable", children: [_jsx("p", { children: lead }), flip.reason !== null && flip.reason.trim() !== '' ? (_jsx("p", { className: "rf-flip__reason", "data-testid": "flip-reason", children: flip.reason })) : null, _jsxs("dl", { className: "rf-stats", children: [_jsxs("div", { className: "rf-stat", "data-testid": "flip-score-before", children: [_jsx("dt", { children: "Appetite score" }), _jsx("dd", { children: formatScore(flip.scoreBefore, { decimals: 1 }) })] }), _jsxs("div", { className: "rf-stat", "data-testid": "flip-premium-before", children: [_jsx("dt", { children: "Predicted premium" }), _jsx("dd", { children: formatMoney(flip.premiumBefore) })] })] })] }));
}
/**
 * PRD 10 (g) Minimal flip with new score and price.
 *
 * The smallest move (at most two movable components, INTERPRETATIONS F-1, F-2)
 * that lands the account in FIT, with the score and premium after it. Every
 * number comes from `flip`; nothing is recomputed (PRD 10, 13).
 *
 * `premiumBefore` / `premiumAfter` are the engine's *predicted* premium (flip.ts
 * prices the vector, not the quote), so they are labelled "Predicted premium"
 * (R5-2). The quoted figure lives in panel (d).
 */
export function Flip(props) {
    const { flip } = props;
    const hasFlip = flip.available && flip.moves.length > 0;
    const distance = flip.distanceToAppetite;
    return (_jsxs("div", { className: "rf-panel rf-flip", "data-testid": "flip-panel", children: [_jsx("p", { className: "rf-flip__distance", children: _jsx(Badge, { label: distanceLabel(distance), tone: distance === 1 ? 'attention' : distance === null ? 'quiet' : 'neutral', title: "Distance to appetite: the number of moves in the minimal flip (0, 1 or 2), or none." }) }), hasFlip ? (_jsxs(_Fragment, { children: [_jsx(MoveList, { moves: flip.moves }), _jsxs("dl", { className: "rf-stats", children: [_jsx(Stat, { testId: "flip-score", label: "Appetite score", before: formatScore(flip.scoreBefore, { decimals: 1 }), after: formatScore(flip.scoreAfter, { decimals: 1 }) }), _jsx(Stat, { testId: "flip-premium", label: "Predicted premium", before: formatMoney(flip.premiumBefore), after: formatMoney(flip.premiumAfter) }), _jsxs("div", { className: "rf-stat", "data-testid": "flip-verdict-after", children: [_jsx("dt", { children: "Verdict after" }), _jsx("dd", { children: flip.verdictAfter !== null ? _jsx(VerdictPill, { verdict: flip.verdictAfter }) : '—' })] })] }), _jsx("p", { className: "rf-footnote", children: "Immovable components (state, building age, submission type, line, past losses, protection class) are never proposed." })] })) : (_jsx(Unavailable, { flip: flip }))] }));
}
//# sourceMappingURL=Flip.js.map