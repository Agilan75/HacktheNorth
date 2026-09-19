import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { formatMoney, formatPercent, formatScore } from '@retrofit/contracts';
import { Badge } from '../components/atoms/Badge.js';
/** Component keys whose raw value is US dollars (PRD 6.4 components 3, 4, 8). */
const USD_KEYS = new Set(['totalTiv', 'quotedPremium', 'fiveYearLoss']);
/** Component keys whose raw value is a 0/1 flag (PRD 6.4 components 0, 1). */
const FLAG_KEYS = new Set(['isNewBusiness', 'isPropertyLine']);
/** PRD 6.4 component 2: 0 out, 1 acceptable, 2 target. */
const STATE_TIER_LABEL = {
    0: 'out of appetite',
    1: 'acceptable',
    2: 'target',
};
/** INTERPRETATIONS T-SPAN: the only multi-component factor in vectors/commercial.json. */
const BUILDING_AGE_KEYS = ['pctTivPre1990', 'pctTivPost2010'];
/** Raw value in its own unit. Formatting only; the value is never changed. */
function formatRaw(c) {
    if (c.raw === null || c.mask === 0)
        return 'Missing';
    const raw = c.raw;
    if (USD_KEYS.has(c.key))
        return formatMoney(raw);
    if (FLAG_KEYS.has(c.key))
        return raw === 1 ? '1 (yes)' : raw === 0 ? '0 (no)' : formatScore(raw, { decimals: 2 });
    if (c.key === 'stateTier') {
        const label = STATE_TIER_LABEL[raw];
        return label !== undefined ? `${formatScore(raw)} (${label})` : formatScore(raw, { decimals: 2 });
    }
    if (c.key.startsWith('pct'))
        return formatPercent(raw, { decimals: 1 });
    if (c.key === 'tivWeightedProtectionClass')
        return formatScore(raw, { decimals: 1 });
    return Number.isInteger(raw) ? formatScore(raw) : formatScore(raw, { decimals: 3 });
}
function tierName(tier) {
    if (tier === 1)
        return 'Target';
    if (tier === 0.6)
        return 'Acceptable';
    if (tier === 0)
        return 'Not acceptable';
    return null;
}
function formatTier(c) {
    if (!c.appetiteFactor)
        return 'Not scored';
    if (c.tier === null || c.mask === 0)
        return '—';
    const name = tierName(c.tier);
    const value = formatScore(c.tier, { decimals: c.tier === 0 || c.tier === 1 ? 0 : 1 });
    return name !== null ? `${value} · ${name}` : value;
}
/** INTERPRETATIONS G-3: a known appetite component with tier 0 sets the knockout mask. */
function isKnockout(c) {
    return c.appetiteFactor && c.mask === 1 && c.tier === 0;
}
/**
 * PRD 10 (h) The feature vector itself: raw, tier and mask.
 *
 * Renders the three parallel arrays of PRD 6.4 (`x`, `t`, `m`) plus the scaled
 * value peers and flip read. Every number comes from `vector`; nothing is
 * recomputed (PRD 10, 13).
 */
export function Vector(props) {
    const { vector } = props;
    const components = [...vector.components].sort((a, b) => a.index - b.index);
    const known = components.filter((c) => c.mask === 1).length;
    const keys = new Set(components.map((c) => c.key));
    const spansBuildingAge = BUILDING_AGE_KEYS.every((k) => keys.has(k));
    return (_jsxs("div", { className: "rf-panel rf-vector", "data-testid": "vector-panel", children: [_jsxs("dl", { className: "rf-stats", children: [_jsxs("div", { className: "rf-stat", "data-testid": "vector-lob", children: [_jsx("dt", { children: "Line of business" }), _jsx("dd", { children: vector.lineOfBusiness })] }), _jsxs("div", { className: "rf-stat", "data-testid": "vector-spec", children: [_jsx("dt", { children: "Vector spec" }), _jsx("dd", { children: `v${vector.specVersion}` })] }), _jsxs("div", { className: "rf-stat", "data-testid": "vector-completeness", children: [_jsx("dt", { children: "Completeness" }), _jsx("dd", { children: formatPercent(vector.completeness, { from: 'percent', decimals: 1 }) })] }), _jsxs("div", { className: "rf-stat", "data-testid": "vector-known", children: [_jsx("dt", { children: "Components known" }), _jsx("dd", { children: `${known} of ${components.length}` })] })] }), components.length === 0 ? (_jsx("p", { className: "rf-empty", children: "No feature vector was built for this submission." })) : (_jsx("div", { className: "rf-table-wrap", style: { overflowX: 'auto' }, children: _jsxs("table", { className: "rf-table", "aria-label": "Feature vector", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { scope: "col", children: "#" }), _jsx("th", { scope: "col", children: "Component" }), _jsx("th", { scope: "col", children: "Raw (x)" }), _jsx("th", { scope: "col", children: "Tier (t)" }), _jsx("th", { scope: "col", children: "Mask (m)" }), _jsx("th", { scope: "col", children: "Scaled" }), _jsx("th", { scope: "col", children: "Movable" })] }) }), _jsx("tbody", { children: components.map((c) => {
                                const knockout = isKnockout(c);
                                return (_jsxs("tr", { "data-testid": `vector-row-${c.key}`, "data-mask": c.mask, "data-knockout": knockout ? 'true' : 'false', children: [_jsx("td", { children: c.index }), _jsxs("th", { scope: "row", children: [_jsx("span", { children: c.label }), ' ', _jsx("code", { className: "rf-code", style: { opacity: 0.7 }, children: c.key })] }), _jsx("td", { "data-testid": `vector-raw-${c.key}`, title: c.raw !== null ? String(c.raw) : undefined, children: formatRaw(c) }), _jsxs("td", { "data-testid": `vector-tier-${c.key}`, children: [formatTier(c), knockout ? (_jsxs(_Fragment, { children: [' ', _jsx(Badge, { label: "Knockout", tone: "attention", title: "A known appetite component at tier 0 sets the knockout (DOES_NOT_FIT)." })] })) : null] }), _jsx("td", { "data-testid": `vector-mask-${c.key}`, children: c.mask === 1 ? '1 · known' : '0 · missing' }), _jsx("td", { "data-testid": `vector-scaled-${c.key}`, children: formatScore(c.scaled, { decimals: 3 }) }), _jsx("td", { "data-testid": `vector-movable-${c.key}`, children: c.immovable ? 'Immovable' : 'Movable' })] }, `${c.index}-${c.key}`));
                            }) })] }) })), _jsxs("ul", { className: "rf-notes", "aria-label": "How to read the vector", children: [_jsx("li", { children: "Tier values are 0 (Not acceptable), 0.6 (Acceptable) and 1 (Target). A missing component is never imputed: it scores 0 points, lowers completeness and forces REFER." }), spansBuildingAge ? (_jsx("li", { "data-testid": "vector-tspan-note", children: "Components 5 and 6 both carry the building-age tier; the appetite score counts that factor once, over eight factors, not eleven components." })) : null, _jsx("li", { children: "Immovable components are never proposed by the flip. \u201CNot scored\u201D components feed pricing and peers only." })] })] }));
}
//# sourceMappingURL=Vector.js.map