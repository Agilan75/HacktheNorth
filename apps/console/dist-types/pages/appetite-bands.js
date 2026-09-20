/**
 * The TIV and premium appetite bands, read out of `GET /rules` rather than
 * hard-coded: the `AG-TIV-*` and `AG-PREM-*` rules carry their own edges, so
 * the terrain's cliffs sit exactly where the rulebook puts them and each one
 * can name the rule that made it.
 *
 * Nothing here scores anything. It turns a set of AND-ed numeric conditions
 * into the intervals they cut the axis into, with the tier and rule id of the
 * rule that owns each interval. `FALLBACK_BANDS` covers an API that predates
 * the rules route; it repeats the numbers in `packages/engine/src/constants.ts`
 * and is reported so the page can say the edges are built in.
 */
/** Tier value as the engine scores it (constants.ts TIER_VALUE). `refer` never reaches these two factors. */
export const TIER_VALUE = {
    not_acceptable: 0,
    acceptable: 0.6,
    refer: 0.6,
    target: 1,
};
const NUMERIC_OPS = new Set(['lt', 'lte', 'gt', 'gte']);
function isRuleLike(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const r = value;
    return (typeof r.id === 'string' &&
        typeof r.factor === 'string' &&
        typeof r.tier === 'string' &&
        Array.isArray(r.when) &&
        r.when.every((c) => typeof c === 'object' && c !== null && typeof c.field === 'string'));
}
function rulesOf(rulebooks) {
    const out = [];
    for (const book of rulebooks) {
        if (typeof book !== 'object' || book === null)
            continue;
        // Extensions never move the appetite score, so they never shape the terrain.
        if (book.isExtension === true)
            continue;
        const rules = book.rules;
        if (!Array.isArray(rules))
            continue;
        for (const rule of rules)
            if (isRuleLike(rule))
                out.push(rule);
    }
    return out;
}
/* -------------------------------------------------------------------------- */
/* Conditions -> intervals                                                    */
/* -------------------------------------------------------------------------- */
function satisfies(rule, field, value) {
    const conditions = rule.when.filter((c) => c.field === field && NUMERIC_OPS.has(c.op));
    if (conditions.length === 0)
        return false;
    return conditions.every((c) => {
        const edge = typeof c.value === 'number' ? c.value : Number.NaN;
        if (!Number.isFinite(edge))
            return false;
        switch (c.op) {
            case 'lt':
                return value < edge;
            case 'lte':
                return value <= edge;
            case 'gt':
                return value > edge;
            default:
                return value >= edge;
        }
    });
}
function tierOf(tier) {
    return tier === 'target' || tier === 'acceptable' || tier === 'not_acceptable' ? tier : null;
}
/** A point inside `(from, to)` that no edge sits on, so the owning rule is unambiguous. */
function probe(from, to) {
    if (Number.isFinite(from) && Number.isFinite(to))
        return (from + to) / 2;
    if (Number.isFinite(to))
        return to > 0 ? to / 2 : to - 1;
    if (Number.isFinite(from))
        return from > 0 ? from * 1.5 : from + 1;
    return 0;
}
/**
 * Cut one axis at every edge its rules name, then ask each rule which interval
 * it owns. Adjacent intervals with the same rule are merged.
 */
export function bandsFor(rules, factor, field) {
    const own = rules.filter((r) => r.factor === factor && tierOf(r.tier) !== null);
    const edges = new Set();
    for (const rule of own) {
        for (const c of rule.when) {
            if (c.field === field && NUMERIC_OPS.has(c.op) && typeof c.value === 'number' && Number.isFinite(c.value)) {
                edges.add(c.value);
            }
        }
    }
    const cuts = [...edges].sort((a, b) => a - b);
    if (cuts.length === 0)
        return [];
    const bounds = [Number.NEGATIVE_INFINITY, ...cuts, Number.POSITIVE_INFINITY];
    const bands = [];
    for (let i = 0; i < bounds.length - 1; i++) {
        const from = bounds[i];
        const to = bounds[i + 1];
        const at = probe(from, to);
        const rule = own.find((r) => satisfies(r, field, at));
        if (rule === undefined)
            continue;
        const tier = tierOf(rule.tier);
        const previous = bands[bands.length - 1];
        if (previous !== undefined && previous.ruleId === rule.id && previous.to === from) {
            bands[bands.length - 1] = { ...previous, to };
            continue;
        }
        bands.push({ from, to, tier, tierValue: TIER_VALUE[tier] ?? 0, ruleId: rule.id });
    }
    return bands;
}
/** The engine's own numbers (constants.ts), used only when `/rules` cannot be read. */
export const FALLBACK_BANDS = {
    tiv: [
        { from: Number.NEGATIVE_INFINITY, to: 50_000_000, tier: 'acceptable', tierValue: 0.6, ruleId: 'AG-TIV-A-LOW' },
        { from: 50_000_000, to: 100_000_000, tier: 'target', tierValue: 1, ruleId: 'AG-TIV-T' },
        { from: 100_000_000, to: 150_000_000, tier: 'acceptable', tierValue: 0.6, ruleId: 'AG-TIV-A-HIGH' },
        { from: 150_000_000, to: Number.POSITIVE_INFINITY, tier: 'not_acceptable', tierValue: 0, ruleId: 'AG-TIV-NA' },
    ],
    premium: [
        { from: Number.NEGATIVE_INFINITY, to: 50_000, tier: 'not_acceptable', tierValue: 0, ruleId: 'AG-PREM-NA-LOW' },
        { from: 50_000, to: 75_000, tier: 'acceptable', tierValue: 0.6, ruleId: 'AG-PREM-A-LOW' },
        { from: 75_000, to: 100_000, tier: 'target', tierValue: 1, ruleId: 'AG-PREM-T' },
        { from: 100_000, to: 175_000, tier: 'acceptable', tierValue: 0.6, ruleId: 'AG-PREM-A-HIGH' },
        { from: 175_000, to: Number.POSITIVE_INFINITY, tier: 'not_acceptable', tierValue: 0, ruleId: 'AG-PREM-NA-HIGH' },
    ],
    fallback: true,
};
/** Bands from the `/rules` payload, or the built-in ones when it yields too few to draw. */
export function appetiteBands(rulebooks) {
    const rules = rulesOf(rulebooks ?? []);
    const tiv = bandsFor(rules, 'tiv', 'totalTiv');
    const premium = bandsFor(rules, 'total_premium', 'quotedPremium');
    if (tiv.length < 2 || premium.length < 2)
        return FALLBACK_BANDS;
    return { tiv, premium, fallback: false };
}
/** The band a value falls in, or null when it is unknown. */
export function bandAt(bands, value) {
    if (value === null || !Number.isFinite(value))
        return null;
    return bands.find((b) => value >= b.from && value < b.to) ?? null;
}
//# sourceMappingURL=appetite-bands.js.map