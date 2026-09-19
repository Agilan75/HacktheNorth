import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { formatMoney, formatPercent, formatScore } from '@retrofit/contracts';
import { Badge } from '../components/atoms/Badge.js';
import { Card } from '../components/atoms/Card.js';
/**
 * Mirrors `ADEQUACY_UNDERPRICED` in packages/engine/src/constants.ts (PRD 6.7:
 * "Under 0.9 means underpriced for the risk"). `@retrofit/engine` is not a
 * console dependency, so the value is copied here, used only to pick a label.
 */
const ADEQUACY_UNDERPRICED = 0.9;
function adequacyLabel(adequacy) {
    if (adequacy === null || !Number.isFinite(adequacy))
        return null;
    return adequacy < ADEQUACY_UNDERPRICED ? 'Underpriced for the risk' : 'Adequate for the risk';
}
function formatMultiplier(multiplier) {
    return `×${formatScore(multiplier, { decimals: 2 })}`;
}
function multiplierEffect(multiplier) {
    if (!Number.isFinite(multiplier))
        return 'Unknown';
    if (multiplier > 1)
        return 'Raises premium';
    if (multiplier < 1)
        return 'Lowers premium';
    return 'No effect';
}
function Stat(props) {
    return (_jsxs("div", { className: "rf-stat", "data-testid": props.testId, children: [_jsx("dt", { children: props.label }), _jsxs("dd", { children: [_jsx("span", { className: "rf-stat__value", children: props.value }), props.hint !== undefined ? _jsx("span", { className: "rf-stat__hint", children: ` ${props.hint}` }) : null] })] }));
}
function FactorTable(props) {
    if (props.factors.length === 0) {
        return _jsx("p", { className: "rf-empty", children: "No rating factors were applied to this account." });
    }
    return (_jsxs("table", { className: "rf-table", "aria-label": "Rating factors", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { scope: "col", children: "Factor" }), _jsx("th", { scope: "col", children: "Multiplier" }), _jsx("th", { scope: "col", children: "Effect" }), _jsx("th", { scope: "col", children: "Basis" })] }) }), _jsx("tbody", { children: props.factors.map((f, i) => (_jsxs("tr", { "data-testid": "pricing-factor", children: [_jsx("th", { scope: "row", children: f.label }), _jsx("td", { children: formatMultiplier(f.multiplier) }), _jsx("td", { children: multiplierEffect(f.multiplier) }), _jsx("td", { children: f.basis ?? '—' })] }, `${f.label}-${i}`))) })] }));
}
/**
 * PRD 10 (d) Factor-by-factor premium, adequacy and expected loss.
 *
 * Every number comes from `pricing`; nothing is recomputed here (PRD 10, 13).
 */
export function Pricing(props) {
    const { pricing } = props;
    const label = adequacyLabel(pricing.adequacy);
    const underpriced = pricing.adequacy !== null && pricing.adequacy < ADEQUACY_UNDERPRICED;
    return (_jsxs(Card, { title: "Pricing", anchorId: "pricing", aside: label !== null ? (_jsx(Badge, { label: label, tone: underpriced ? 'attention' : 'quiet', title: `Price adequacy is quoted ÷ predicted premium; under ${formatScore(ADEQUACY_UNDERPRICED, { decimals: 1 })} is underpriced.` })) : undefined, children: [_jsxs("dl", { className: "rf-stats", children: [_jsx(Stat, { testId: "pricing-quoted", label: "Quoted premium", value: formatMoney(pricing.quotedPremium) }), _jsx(Stat, { testId: "pricing-predicted", label: "Predicted premium", value: formatMoney(pricing.predictedPremium) }), _jsx(Stat, { testId: "pricing-adequacy", label: "Price adequacy", value: formatPercent(pricing.adequacy), hint: pricing.adequacy !== null && Number.isFinite(pricing.adequacy)
                            ? `(${formatScore(pricing.adequacy, { decimals: 2 })} quoted ÷ predicted)`
                            : '(needs a quoted and a predicted premium)' }), _jsx(Stat, { testId: "pricing-expected-loss", label: "Expected annual loss", value: formatMoney(pricing.expectedLoss) }), _jsx(Stat, { testId: "pricing-rate", label: "Rate per $100 TIV", value: formatMoney(pricing.ratePer100Tiv, { decimals: 2 }) })] }), _jsx("h3", { className: "rf-card__subtitle", children: "Factor by factor" }), _jsx(FactorTable, { factors: pricing.factors }), pricing.notes.length > 0 ? (_jsx("ul", { className: "rf-notes", "aria-label": "Pricing notes", children: pricing.notes.map((note, i) => (_jsx("li", { children: note }, i))) })) : null, _jsxs("p", { className: "rf-footnote", children: ["All amounts in ", pricing.currency, "."] })] }));
}
//# sourceMappingURL=Pricing.js.map