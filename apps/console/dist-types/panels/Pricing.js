import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
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
/** Per-building multipliers keep up to three decimals (×0.981), never fewer than two. */
function formatBuildingMultiplier(multiplier) {
    if (!Number.isFinite(multiplier))
        return '—';
    return `×${multiplier.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}`;
}
/** A base rate per $100 of TIV is a fraction of a dollar; show up to four decimals. */
function formatRate(rate) {
    if (!Number.isFinite(rate))
        return '—';
    return `$${rate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}
/** Readable names for the engine's rating-factor keys (packages/engine/src/stages/price.ts). */
const FACTOR_LABEL = {
    construction: 'Construction',
    age: 'Age',
    protectionClass: 'Protection class',
    sprinkler: 'Sprinkler',
    lossHistory: 'Loss history',
};
function factorLabel(key) {
    return FACTOR_LABEL[key] ?? key;
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
    return (_jsx("div", { className: "rf-scroll-x", children: _jsxs("table", { className: "rf-table", "aria-label": "Account-level factors", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { scope: "col", children: "Factor" }), _jsx("th", { scope: "col", children: "Multiplier" }), _jsx("th", { scope: "col", children: "Effect" }), _jsx("th", { scope: "col", children: "Basis" })] }) }), _jsx("tbody", { children: props.factors.map((f, i) => (_jsxs("tr", { "data-testid": "pricing-factor", children: [_jsx("th", { scope: "row", children: factorLabel(f.label) }), _jsx("td", { children: formatMultiplier(f.multiplier) }), _jsx("td", { children: multiplierEffect(f.multiplier) }), _jsx("td", { children: f.basis ?? '—' })] }, `${f.label}-${i}`))) })] }) }));
}
/**
 * R5-7: one row per building, TIV ÷ 100 × base rate × each multiplier = building
 * premium. Every figure is the DTO's own; the subtotal is not in the DTO and is
 * not shown.
 */
function BuildingTable(props) {
    const columns = [];
    for (const b of props.buildings) {
        for (const f of b.factors)
            if (!columns.includes(f.label))
                columns.push(f.label);
    }
    return (_jsx("div", { className: "rf-scroll-x", children: _jsxs("table", { className: "rf-table", "aria-label": "Per-building rating", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { scope: "col", children: "Building" }), _jsx("th", { scope: "col", children: "TIV" }), _jsx("th", { scope: "col", children: "Base rate per $100" }), columns.map((c) => (_jsx("th", { scope: "col", children: factorLabel(c) }, c))), _jsx("th", { scope: "col", children: "Building premium" })] }) }), _jsx("tbody", { children: props.buildings.map((b, i) => (_jsxs("tr", { "data-testid": "pricing-building", children: [_jsx("th", { scope: "row", children: b.buildingExternalId }), _jsx("td", { children: formatMoney(b.tiv) }), _jsx("td", { children: formatRate(b.baseRate) }), columns.map((c) => {
                                const f = b.factors.find((x) => x.label === c);
                                if (f === undefined)
                                    return _jsx("td", { children: "\u2014" }, c);
                                return (_jsxs("td", { children: [formatBuildingMultiplier(f.multiplier), f.input !== null && f.input !== '' ? (_jsx("span", { className: "rf-stat__hint", children: ` (${f.input})` })) : null] }, c));
                            }), _jsx("td", { "data-testid": "pricing-building-premium", children: formatMoney(b.premium, { decimals: 2 }) })] }, `${b.buildingExternalId}-${i}`))) })] }) }));
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
                            : '(needs a quoted and a predicted premium)' }), _jsx(Stat, { testId: "pricing-expected-loss", label: "Expected annual loss", value: formatMoney(pricing.expectedLoss) }), _jsx(Stat, { testId: "pricing-rate", label: "Rate per $100 TIV", value: formatMoney(pricing.ratePer100Tiv, { decimals: 2 }) })] }), _jsx("h3", { className: "rf-card__subtitle", children: "Factor by factor" }), pricing.buildings !== undefined && pricing.buildings.length > 0 ? (_jsxs(_Fragment, { children: [_jsx("p", { className: "rf-footnote", children: "Each building: TIV \u00F7 100 \u00D7 base rate \u00D7 each multiplier = building premium. The account-level factors below then multiply the sum of the building premiums to give the predicted premium." }), _jsx(BuildingTable, { buildings: pricing.buildings }), _jsx("h4", { className: "rf-card__subtitle", children: "Account-level factors" })] })) : null, _jsx(FactorTable, { factors: pricing.factors }), pricing.notes.length > 0 ? (_jsx("ul", { className: "rf-notes", "aria-label": "Pricing notes", children: pricing.notes.map((note, i) => (_jsx("li", { children: note }, i))) })) : null, _jsxs("p", { className: "rf-footnote", children: ["All amounts in ", pricing.currency, "."] })] }));
}
//# sourceMappingURL=Pricing.js.map