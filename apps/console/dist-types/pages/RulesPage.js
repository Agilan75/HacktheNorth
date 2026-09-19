import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { formatPercent, pluralize, titleCase } from '@retrofit/contracts';
import { cssVar, RADIUS, SPACE, TIER_LABELS } from '@retrofit/design';
import { useApi } from '../api/useApi.js';
import { Badge } from '../components/atoms/Badge.js';
import { Card } from '../components/atoms/Card.js';
import { CitationQuote } from '../components/atoms/CitationQuote.js';
import { Skeleton } from '../components/atoms/Skeleton.js';
import { Tooltip } from '../components/Tooltip.js';
/** PRD 6.6 appetite table order; any other factor follows in rulebook order. */
const APPETITE_FACTOR_ORDER = [
    'submission_type',
    'line_of_business',
    'primary_risk_state',
    'tiv',
    'total_premium',
    'building_age',
    'construction_type',
    'loss_value',
];
const OP_TEXT = {
    lt: '<',
    lte: '≤',
    gt: '>',
    gte: '≥',
    eq: '=',
    neq: '≠',
    in: 'is one of',
    notin: 'is not one of',
    exists: 'is present',
    missing: 'is missing',
};
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function isRule(value) {
    if (!isRecord(value))
        return false;
    const c = value.citation;
    return (typeof value.id === 'string' &&
        typeof value.factor === 'string' &&
        typeof value.tier === 'string' &&
        Array.isArray(value.when) &&
        isRecord(c) &&
        typeof c.doc === 'string' &&
        typeof c.section === 'string' &&
        typeof c.quote === 'string');
}
/**
 * `getRules()` types rulebooks as `unknown[]`; narrow each one to the frozen
 * RulesResponseDto shape and drop malformed rules rather than crash the page.
 */
function toRulebooks(raw) {
    const books = [];
    for (const item of raw) {
        if (!isRecord(item) || typeof item.id !== 'string' || !Array.isArray(item.rules))
            continue;
        books.push({
            id: item.id,
            label: typeof item.label === 'string' && item.label.length > 0 ? item.label : titleCase(item.id),
            version: typeof item.version === 'string' ? item.version : '',
            isExtension: item.isExtension === true || item.id === 'extensions',
            rules: item.rules.filter(isRule),
        });
    }
    return books;
}
function formatConditionValue(value) {
    if (value === undefined)
        return '';
    if (Array.isArray(value))
        return value.map((v) => String(v)).join(', ');
    return String(value);
}
function formatCondition(condition) {
    const op = OP_TEXT[condition.op] ?? condition.op;
    if (condition.op === 'exists' || condition.op === 'missing')
        return `${condition.field} ${op}`;
    return `${condition.field} ${op} ${formatConditionValue(condition.value)}`;
}
function tierLabel(tier) {
    return TIER_LABELS[tier] ?? titleCase(tier);
}
function groupByFactor(rules) {
    const byFactor = new Map();
    for (const rule of rules) {
        const list = byFactor.get(rule.factor);
        if (list)
            list.push(rule);
        else
            byFactor.set(rule.factor, [rule]);
    }
    const rank = (factor) => {
        const i = APPETITE_FACTOR_ORDER.indexOf(factor);
        return i === -1 ? APPETITE_FACTOR_ORDER.length : i;
    };
    const factors = [...byFactor.keys()];
    const firstSeen = new Map(factors.map((f, i) => [f, i]));
    factors.sort((a, b) => rank(a) - rank(b) || (firstSeen.get(a) ?? 0) - (firstSeen.get(b) ?? 0));
    return factors.map((factor) => {
        const list = byFactor.get(factor) ?? [];
        const weights = new Set(list.map((r) => r.weight).filter((w) => typeof w === 'number'));
        return { factor, rules: list, weight: weights.size === 1 ? [...weights][0] : null };
    });
}
const pageStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: SPACE.xl,
    fontFamily: cssVar('font-body'),
    color: cssVar('ink'),
};
const titleStyle = {
    margin: 0,
    fontFamily: cssVar('font-display'),
    fontSize: cssVar('size-title'),
    lineHeight: cssVar('leading-title'),
};
const mutedStyle = {
    margin: 0,
    color: cssVar('muted-deep'),
    fontSize: cssVar('size-small'),
    lineHeight: cssVar('leading-small'),
};
const factorStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: SPACE.md,
    marginTop: SPACE.lg,
};
const factorHeadingStyle = {
    margin: 0,
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: SPACE.sm,
    fontSize: cssVar('size-body'),
    lineHeight: cssVar('leading-body'),
    fontWeight: 600,
};
const ruleListStyle = {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: SPACE.md,
};
const ruleStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: SPACE.sm,
    padding: SPACE.lg,
    border: `${cssVar('border-width')} solid ${cssVar('border-color')}`,
    borderRadius: RADIUS.card,
};
const metaStyle = {
    margin: 0,
    display: 'grid',
    gridTemplateColumns: 'max-content 1fr',
    columnGap: SPACE.md,
    rowGap: SPACE.xs,
    fontSize: cssVar('size-small'),
    lineHeight: cssVar('leading-small'),
};
const dtStyle = { color: cssVar('muted-deep') };
const ddStyle = { margin: 0 };
const codeStyle = { fontSize: cssVar('size-small') };
function RuleCard(props) {
    const { rule, showWeight } = props;
    const citation = rule.citation;
    return (_jsxs("li", { style: ruleStyle, "aria-label": `Rule ${rule.id}`, "data-rule-id": rule.id, children: [_jsxs("div", { style: { display: 'flex', flexWrap: 'wrap', gap: SPACE.sm, alignItems: 'baseline' }, children: [_jsx("code", { style: { ...codeStyle, fontWeight: 600 }, children: rule.id }), _jsx(Badge, { label: tierLabel(rule.tier), tone: rule.tier === 'not_acceptable' ? 'attention' : 'neutral' }), rule.extension === true ? _jsx(Badge, { label: "Retrofit extension", tone: "quiet" }) : null] }), _jsxs("dl", { style: metaStyle, children: [_jsx("dt", { style: dtStyle, children: "When" }), _jsx("dd", { style: ddStyle, children: rule.when.length === 0 ? ('Always') : (_jsx("code", { style: codeStyle, children: rule.when.map(formatCondition).join(' AND ') })) }), showWeight ? (_jsxs(_Fragment, { children: [_jsx("dt", { style: dtStyle, children: "Weight" }), _jsx("dd", { style: ddStyle, children: typeof rule.weight === 'number' ? formatPercent(rule.weight) : 'Not weighted' })] })) : null, rule.ratingFactor ? (_jsxs(_Fragment, { children: [_jsx("dt", { style: dtStyle, children: "Rating factor" }), _jsx("dd", { style: ddStyle, children: _jsx("code", { style: codeStyle, children: rule.ratingFactor }) })] })) : null] }), _jsx(CitationQuote, { citation: { document: `${citation.doc} · ${citation.section}`, quote: citation.quote } }), rule.interpretation ? (_jsxs("p", { style: { margin: 0, fontSize: cssVar('size-small'), lineHeight: cssVar('leading-small') }, children: [_jsx("strong", { children: "Interpretation: " }), rule.interpretation] })) : null, rule.fixHint ? (_jsxs("p", { style: mutedStyle, children: [_jsx("strong", { children: "Fix: " }), rule.fixHint] })) : null] }));
}
function FactorSection(props) {
    const { group, bookId, showWeight } = props;
    const headingId = `rf-rules-${bookId}-${group.factor}`.replace(/[^a-zA-Z0-9_-]+/g, '-');
    return (_jsxs("section", { style: factorStyle, "aria-labelledby": headingId, children: [_jsxs("h3", { id: headingId, style: factorHeadingStyle, children: [_jsx("span", { children: titleCase(group.factor) }), showWeight && group.weight !== null ? (_jsxs("span", { style: { ...mutedStyle, fontWeight: 400 }, children: ["Weight ", formatPercent(group.weight)] })) : null, _jsx("span", { style: { ...mutedStyle, fontWeight: 400 }, children: pluralize(group.rules.length, 'rule') })] }), _jsx("ul", { style: ruleListStyle, children: group.rules.map((rule) => (_jsx(RuleCard, { rule: rule, showWeight: showWeight }, rule.id))) })] }));
}
function RulebookCard(props) {
    const { id, title, version, rules, note, showWeight } = props;
    const groups = groupByFactor(rules);
    const aside = [version ? `v${version}` : null, pluralize(rules.length, 'rule')].filter(Boolean).join(' · ');
    return (_jsxs(Card, { title: title, aside: aside, anchorId: `rulebook-${id}`, children: [note ?? null, groups.length === 0 ? _jsx("p", { style: mutedStyle, children: "No rules in this rulebook." }) : null, groups.map((group) => (_jsx(FactorSection, { group: group, bookId: id, showWeight: showWeight }, group.factor)))] }));
}
/**
 * PRD 10 /rules - rule cards by factor with citation, quote, weight and interpretation; extension rules in a separate labelled group.
 *
 * Stub frozen by W0-4. Unit C13 replaces this body only.
 * Route registration lives in src/App.tsx and is frozen.
 */
export function RulesPage() {
    const state = useApi((client) => client.getRules(), []);
    const header = (_jsxs("header", { children: [_jsx("h1", { style: titleStyle, children: "Rules" }), _jsxs("p", { style: { ...mutedStyle, marginTop: SPACE.xs }, children: ["Every active rule, grouped by factor, with the document, section and exact quote it comes from. Weights apply to the ", _jsx(Tooltip, { term: "Appetite", children: "appetite" }), " score; Retrofit\u2019s own extension rules are listed separately and never change it."] })] }));
    if (state.data === null && state.loading) {
        return (_jsxs("div", { style: pageStyle, children: [header, _jsx(Skeleton, { label: "Loading the rulebooks", lines: 8 })] }));
    }
    if (state.data === null) {
        return (_jsxs("div", { style: pageStyle, children: [header, _jsxs("div", { role: "alert", children: [_jsxs("p", { style: { margin: 0 }, children: ["The rulebooks could not be loaded", state.error ? `: ${state.error.message}` : '.'] }), _jsx("button", { type: "button", onClick: state.reload, style: { minHeight: 44, marginTop: SPACE.sm }, children: "Try again" })] })] }));
    }
    const books = toRulebooks(state.data.rulebooks);
    const primary = books.filter((b) => !b.isExtension);
    const extensionRules = [];
    const extensionVersions = [];
    for (const book of books) {
        if (book.isExtension) {
            extensionRules.push(...book.rules);
            if (book.version)
                extensionVersions.push(book.version);
        }
        else {
            // A rule flagged `extension` inside another rulebook still belongs with Retrofit's own rules.
            extensionRules.push(...book.rules.filter((r) => r.extension === true));
        }
    }
    return (_jsxs("div", { style: pageStyle, children: [header, books.length === 0 ? _jsx("p", { children: "No rulebooks are active." }) : null, primary.map((book) => (_jsx(RulebookCard, { id: book.id, title: book.label, version: book.version, rules: book.rules.filter((r) => r.extension !== true), showWeight: book.rules.some((r) => typeof r.weight === 'number') }, book.id))), extensionRules.length > 0 ? (_jsx(RulebookCard, { id: "extensions", title: "Retrofit extension rules (ours, not Federato\u2019s)", version: extensionVersions.length === 1 ? extensionVersions[0] : '', rules: extensionRules, showWeight: false, note: _jsx("p", { style: mutedStyle, children: "These rules are Retrofit\u2019s own, not from Federato\u2019s appetite guidelines. They can raise REFER or a contradiction and feed the premium, and they never touch the appetite score." }) })) : null] }));
}
//# sourceMappingURL=RulesPage.js.map