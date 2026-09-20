import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { formatMoney, formatPercent, formatTiv, pluralize, titleCase } from '@retrofit/contracts';
import { cssVar, MIN_TOUCH_TARGET, RADIUS, SPACE, TIER_LABELS } from '@retrofit/design';
import { useApi } from '../api/useApi.js';
import { Badge } from '../components/atoms/Badge.js';
import { Card } from '../components/atoms/Card.js';
import { CitationQuote } from '../components/atoms/CitationQuote.js';
import { Skeleton } from '../components/atoms/Skeleton.js';
/* -------------------------------------------------------------------------- */
/* Tiers — the matrix columns                                                 */
/* -------------------------------------------------------------------------- */
const TIER_ORDER = ['target', 'acceptable', 'refer', 'not_acceptable'];
/** The one gloss the page needs: what each column means for an account. */
const TIER_GLOSS = {
    target: 'Scores 1',
    acceptable: 'Scores 0.6',
    refer: 'Needs an underwriter',
    not_acceptable: 'Knocks the account out',
};
const TIER_EDGE = {
    target: cssVar('green'),
    acceptable: cssVar('muted'),
    refer: cssVar('blue'),
    not_acceptable: cssVar('red'),
};
const TIER_TONE = {
    target: 'positive',
    acceptable: 'neutral',
    refer: 'info',
    not_acceptable: 'attention',
};
function isTier(value) {
    return TIER_ORDER.includes(value);
}
/* -------------------------------------------------------------------------- */
/* Factors — the matrix rows                                                  */
/* -------------------------------------------------------------------------- */
/** PRD §6.6 appetite table order; any other factor follows in rulebook order. */
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
const FACTOR_LABELS = {
    tiv: 'TIV',
    line_of_business: 'Line of business',
    primary_risk_state: 'Primary risk state',
    submission_type: 'Submission type',
    total_premium: 'Total premium',
    building_age: 'Building age',
    construction_type: 'Construction type',
    loss_value: 'Loss value',
    sprinkler_protection: 'Sprinkler protection',
    protection_class: 'Public protection class',
    smoke_detection: 'Smoke detection',
    contents_limit: 'Contents limit',
    term: 'Policy term',
    hazard_portable_heater: 'Portable heater',
    hazard_heater_near_combustible: 'Heater near soft furnishings',
    hazard_extension_cord: 'Extension cord',
    hazard_power_bar_overload: 'Power bar',
    hazard_candle: 'Open flame',
    hazard_stove: 'Cooking appliance',
    hazard_blocked_exit: 'Exit',
    hazard_window_ac_unit: 'Window air conditioning',
    hazard_water_heater: 'Water heater',
    hazard_high_value_contents: 'High-value contents',
};
/** Sentence case, not Title Case: these sit beside `Building age`. */
function factorLabel(factor) {
    const known = FACTOR_LABELS[factor];
    if (known)
        return known;
    const words = factor.replace(/^hazard_/, '').split('_');
    const [first = '', ...rest] = words;
    return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ');
}
const FIELDS = {
    totalTiv: { label: 'Total insured value', kind: 'tiv' },
    quotedPremium: { label: 'Quoted premium', kind: 'money' },
    fiveYearLoss: { label: 'Losses over 5 years', kind: 'money' },
    contentsLimit: { label: 'Contents limit', kind: 'money' },
    pctTivPre1990: { label: 'of TIV built before 1990', kind: 'ratio' },
    pctTivPost2010: { label: 'of TIV built after 2010', kind: 'ratio' },
    pctTivAcceptableConstruction: { label: 'of TIV in an accepted class', kind: 'ratio' },
    pctTivSprinklered: { label: 'of TIV sprinklered', kind: 'ratio' },
    tivWeightedProtectionClass: { label: 'TIV-weighted', kind: 'count' },
    buildingYearBuilt: { label: 'Year built', kind: 'year' },
    'rollup.oldestYearBuilt': { label: 'oldest building', kind: 'year' },
    smokeDetectorCount: { label: 'seen in the room', kind: 'count' },
};
/** Fields the engine tests as 0/1. The phrase carries the whole meaning. */
const BOOLS = {
    isNewBusiness: ['New business', 'Renewal business'],
    isPropertyLine: ['Property', 'Any other line'],
    hazardPortableHeater: ['Portable heater in the room', 'No portable heater'],
    hazardHeaterNearCombustible: ['Heater within 20° of fabric', 'Heater clear of fabric'],
    hazardExtensionCord: ['Extension cord in use', 'No extension cord'],
    hazardPowerBarOverload: ['Power bar overloaded', 'Power bar not overloaded'],
    hazardCandle: ['Open-flame candle', 'No candle'],
    hazardStove: ['Cooking appliance in the room', 'No cooking appliance'],
    hazardBlockedExit: ['Exit blocked', 'Exit clear'],
    hazardWindowAcUnit: ['Window air-conditioning unit', 'No window unit'],
    hazardWaterHeater: ['Water heater inside the unit', 'No water heater'],
    hazardHighValueContents: ['High-value contents on show', 'No high-value contents'],
};
function fieldSpec(field) {
    return FIELDS[field] ?? { label: titleCase(field), kind: 'plain' };
}
function formatValue(kind, value) {
    if (typeof value !== 'number')
        return String(value ?? '');
    if (kind === 'money')
        return formatMoney(value);
    if (kind === 'tiv')
        return formatTiv(value);
    if (kind === 'ratio')
        return formatPercent(value);
    return String(value);
}
const LOWER_OPS = new Set(['gt', 'gte']);
const UPPER_OPS = new Set(['lt', 'lte']);
/** One condition on its own, as a phrase that reads under the factor name. */
function singlePhrase(kind, condition) {
    const v = formatValue(kind, condition.value);
    const n = typeof condition.value === 'number' ? condition.value : null;
    const whole = kind === 'year' || kind === 'count';
    switch (condition.op) {
        case 'lt':
            if (kind === 'year')
                return `before ${v}`;
            return whole && n !== null ? `${n - 1} or less` : `under ${v}`;
        case 'lte':
            return kind === 'year' ? `${v} or earlier` : `${v} or less`;
        case 'gt':
            if (kind === 'year')
                return `after ${v}`;
            return whole && n !== null ? `${n + 1} or more` : `over ${v}`;
        case 'gte':
            return kind === 'year' ? `${v} or later` : `${v} or more`;
        case 'eq':
            return kind === 'count' && n === 0 ? 'None' : v;
        case 'neq':
            return `not ${v}`;
        case 'in':
            return Array.isArray(condition.value) ? condition.value.map(String).join(', ') : v;
        case 'notin':
            return `not ${Array.isArray(condition.value) ? condition.value.map(String).join(', ') : v}`;
        case 'exists':
            return 'Present';
        case 'missing':
            return 'Missing';
        default:
            return `${condition.op} ${v}`;
    }
}
/** Two bounds on one field, collapsed into a range. */
function rangePhrase(kind, lower, upper) {
    const whole = kind === 'year' || kind === 'count';
    const lo = typeof lower.value === 'number' ? lower.value : null;
    const hi = typeof upper.value === 'number' ? upper.value : null;
    if (whole && lo !== null && hi !== null) {
        const from = lower.op === 'gt' ? lo + 1 : lo;
        const to = upper.op === 'lt' ? hi - 1 : hi;
        return `${from}–${to}`;
    }
    const a = formatValue(kind, lower.value);
    const b = formatValue(kind, upper.value);
    if (lower.op === 'gte' && upper.op === 'lte')
        return `${a}–${b}`;
    if (lower.op === 'gt' && upper.op === 'lte')
        return `over ${a}, up to ${b}`;
    if (lower.op === 'gte' && upper.op === 'lt')
        return `${a} to under ${b}`;
    return `over ${a}, under ${b}`;
}
/**
 * Turn a rule's `when` list into the criteria a reader can compare across a
 * row. Conditions on one field collapse into a single clause; a range becomes
 * one phrase rather than two inequalities.
 */
function describe(rule) {
    const byField = new Map();
    for (const condition of rule.when) {
        const list = byField.get(condition.field);
        if (list)
            list.push(condition);
        else
            byField.set(condition.field, [condition]);
    }
    if (byField.size === 0)
        return [{ text: 'Always', label: '' }];
    const single = byField.size === 1;
    const clauses = [];
    for (const [field, conditions] of byField) {
        // The guideline lists the states themselves; the vector tests a tier number,
        // so the citation's own wording is the readable criterion.
        if (field === 'stateTier') {
            clauses.push({ text: rule.citation.quote, label: '' });
            continue;
        }
        const bool = BOOLS[field];
        const first = conditions[0];
        if (bool && conditions.length === 1 && first && first.op === 'eq') {
            const truthy = first.value === 1 || first.value === true || first.value === '1';
            clauses.push({ text: truthy ? bool[0] : bool[1], label: '' });
            continue;
        }
        const spec = fieldSpec(field);
        const lower = conditions.find((c) => LOWER_OPS.has(c.op));
        const upper = conditions.find((c) => UPPER_OPS.has(c.op));
        const text = lower && upper && conditions.length === 2
            ? rangePhrase(spec.kind, lower, upper)
            : conditions.map((c) => singlePhrase(spec.kind, c)).join(' and ');
        // A percentage is meaningless without its denominator, so a ratio always
        // names it. A sum of money or a year reads fine under the factor heading.
        const needsLabel = spec.kind === 'ratio' || spec.kind === 'plain' || !single;
        clauses.push({ text, label: needsLabel ? spec.label : '' });
    }
    return clauses;
}
const OP_TEXT = {
    lt: '<',
    lte: '≤',
    gt: '>',
    gte: '≥',
    eq: '=',
    neq: '≠',
    in: 'in',
    notin: 'not in',
    exists: 'is present',
    missing: 'is missing',
};
/** The machine truth, kept verbatim under the plain-English phrase. */
function rawCondition(condition) {
    const op = OP_TEXT[condition.op] ?? condition.op;
    if (condition.op === 'exists' || condition.op === 'missing')
        return `${condition.field} ${op}`;
    const value = Array.isArray(condition.value)
        ? condition.value.map(String).join(', ')
        : String(condition.value ?? '');
    return `${condition.field} ${op} ${value}`;
}
/* -------------------------------------------------------------------------- */
/* Narrowing the untyped response                                             */
/* -------------------------------------------------------------------------- */
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
function isInterpretation(value) {
    return (isRecord(value) &&
        typeof value.id === 'string' &&
        typeof value.title === 'string' &&
        typeof value.decision === 'string');
}
function buildMatrix(rules) {
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
    const used = new Set();
    let maxWeight = 0;
    const rows = factors.map((factor) => {
        const list = byFactor.get(factor) ?? [];
        const cells = {
            target: [],
            acceptable: [],
            refer: [],
            not_acceptable: [],
        };
        for (const rule of list) {
            if (!isTier(rule.tier))
                continue;
            cells[rule.tier].push(rule);
            used.add(rule.tier);
        }
        const weights = new Set(list.map((r) => r.weight).filter((w) => typeof w === 'number'));
        const weight = weights.size === 1 ? [...weights][0] : null;
        if (weight !== null && weight > maxWeight)
            maxWeight = weight;
        return { factor, weight, cells, count: list.length };
    });
    return {
        rows,
        tiers: TIER_ORDER.filter((t) => used.has(t)),
        maxWeight,
        weighted: maxWeight > 0,
    };
}
/**
 * The interpretations that bear on one factor row: an interpretation names the
 * vector fields it `affects`, a rule names the fields it tests.
 */
function notesFor(row, interpretations) {
    const fields = new Set();
    for (const tier of TIER_ORDER) {
        for (const rule of row.cells[tier]) {
            for (const condition of rule.when)
                fields.add(condition.field);
        }
    }
    return interpretations.filter((item) => (item.affects ?? []).some((field) => fields.has(field)));
}
/* -------------------------------------------------------------------------- */
/* Narrow-viewport switch                                                     */
/* -------------------------------------------------------------------------- */
const STACK_BELOW = 900;
/** True on a viewport too narrow for a four-column matrix. Wide in jsdom. */
function useStacked() {
    const [stacked, setStacked] = useState(false);
    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function')
            return;
        const query = window.matchMedia(`(max-width: ${STACK_BELOW - 1}px)`);
        const apply = () => setStacked(query.matches);
        apply();
        query.addEventListener('change', apply);
        return () => query.removeEventListener('change', apply);
    }, []);
    return stacked;
}
/* -------------------------------------------------------------------------- */
/* Styles                                                                     */
/* -------------------------------------------------------------------------- */
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
const microStyle = {
    color: cssVar('muted-deep'),
    fontSize: cssVar('size-micro'),
    lineHeight: cssVar('leading-micro'),
};
const tableStyle = {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: cssVar('size-small'),
    lineHeight: cssVar('leading-small'),
    tableLayout: 'fixed',
};
const cellBase = {
    borderTop: `${cssVar('border-width')} solid ${cssVar('border-color')}`,
    padding: SPACE.sm,
    verticalAlign: 'top',
    textAlign: 'left',
    minWidth: 0,
};
/** Ruled columns, as on a printed table; the tier is named in the head, not painted down the page. */
const columnRule = {
    borderLeft: '1px solid var(--rf-rule-faint)',
};
/** The ledger's double red rule, separating the printed table from the margin. */
const marginRule = {
    borderLeft: `1px solid ${cssVar('red')}`,
    boxShadow: `inset 3px 0 0 var(--rf-sheet), inset 4px 0 0 ${cssVar('red')}`,
    paddingLeft: SPACE.lg,
};
const rowHeadStyle = {
    ...cellBase,
    fontFamily: cssVar('font-display'),
    color: cssVar('ink'),
    fontWeight: 600,
    fontSize: cssVar('size-body'),
    lineHeight: cssVar('leading-body'),
    paddingLeft: 0,
    overflowWrap: 'anywhere',
};
const codeStyle = {
    fontSize: cssVar('size-micro'),
    overflowWrap: 'anywhere',
};
const ruleButtonStyle = {
    display: 'block',
    width: '100%',
    minHeight: MIN_TOUCH_TARGET,
    textAlign: 'left',
    background: 'transparent',
    border: `${cssVar('border-width')} solid transparent`,
    borderRadius: RADIUS.card,
    padding: `${SPACE.sm}px ${SPACE.sm}px`,
    font: 'inherit',
    color: 'inherit',
    cursor: 'pointer',
};
const detailStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: SPACE.sm,
    padding: `${SPACE.md}px ${SPACE.lg}px ${SPACE.lg}px`,
    maxWidth: 860,
    boxSizing: 'border-box',
    background: cssVar('paper'),
    border: '1px solid var(--rf-rule)',
    borderTop: `2px solid ${cssVar('ink')}`,
};
const metaStyle = {
    margin: 0,
    display: 'grid',
    gridTemplateColumns: 'max-content minmax(0, 1fr)',
    columnGap: SPACE.md,
    rowGap: SPACE.xs,
    fontSize: cssVar('size-small'),
    lineHeight: cssVar('leading-small'),
};
/* -------------------------------------------------------------------------- */
/* Pieces                                                                     */
/* -------------------------------------------------------------------------- */
function WeightBar(props) {
    const share = props.max > 0 ? Math.max(0.08, props.weight / props.max) : 0;
    return (_jsxs("span", { style: { display: 'block' }, children: [_jsx("span", { style: { display: 'block', fontVariantNumeric: 'tabular-nums' }, children: formatPercent(props.weight) }), _jsx("span", { "aria-hidden": "true", style: {
                    display: 'block',
                    height: 3,
                    marginTop: 2,
                    background: 'var(--rf-rule-faint)',
                }, children: _jsx("span", { style: {
                        display: 'block',
                        height: 3,
                        width: `${share * 100}%`,
                        background: cssVar('ink'),
                    } }) })] }));
}
/** One criterion in a cell: the threshold, what it measures, and its rule id. */
function Criterion(props) {
    const { rule, open, onToggle } = props;
    const clauses = describe(rule);
    return (_jsxs("button", { type: "button", "aria-expanded": open, "aria-controls": `rule-${rule.id}`, onClick: () => onToggle(rule.id), "data-rule-id": rule.id, style: {
            ...ruleButtonStyle,
            borderColor: 'transparent',
            background: open ? cssVar('paper') : 'transparent',
            boxShadow: open ? `inset 3px 0 0 ${cssVar('ink')}` : 'none',
        }, children: [clauses.map((clause, i) => (_jsxs("span", { style: { display: 'block' }, children: [_jsx("span", { style: { fontWeight: 600 }, children: clause.text }), clause.label ? _jsx("span", { style: { ...microStyle, display: 'block' }, children: clause.label }) : null] }, `${clause.text}-${i}`))), _jsx("span", { style: { display: 'block', marginTop: SPACE.xs }, children: _jsx("span", { className: "rf-rule-tab", children: rule.id }) })] }));
}
function RuleDetail(props) {
    const { rule } = props;
    const citation = rule.citation;
    const tier = isTier(rule.tier) ? rule.tier : null;
    return (_jsxs("div", { id: `rule-${rule.id}`, role: "group", style: detailStyle, "aria-label": `Rule ${rule.id}`, children: [_jsxs("div", { style: { display: 'flex', flexWrap: 'wrap', gap: SPACE.sm, alignItems: 'baseline' }, children: [_jsx("span", { className: "rf-rule-tab", children: rule.id }), _jsx(Badge, { label: tier ? TIER_LABELS[tier] : titleCase(rule.tier), tone: tier ? TIER_TONE[tier] : 'neutral' }), rule.extension === true ? _jsx(Badge, { label: "Ours, not Federato\u2019s", tone: "quiet" }) : null] }), _jsxs("dl", { style: metaStyle, children: [_jsx("dt", { style: { color: cssVar('muted-deep') }, children: "Tests" }), _jsx("dd", { style: { margin: 0, minWidth: 0 }, children: rule.when.length === 0 ? ('Always') : (_jsx("code", { style: codeStyle, children: rule.when.map(rawCondition).join(' AND ') })) }), typeof rule.weight === 'number' ? (_jsxs(_Fragment, { children: [_jsx("dt", { style: { color: cssVar('muted-deep') }, children: "Weight" }), _jsx("dd", { style: { margin: 0 }, children: formatPercent(rule.weight) })] })) : null, rule.ratingFactor ? (_jsxs(_Fragment, { children: [_jsx("dt", { style: { color: cssVar('muted-deep') }, children: "Rating factor" }), _jsx("dd", { style: { margin: 0, minWidth: 0 }, children: _jsx("code", { style: codeStyle, children: rule.ratingFactor }) })] })) : null] }), _jsx(CitationQuote, { citation: { document: `${citation.doc} · ${citation.section}`, quote: citation.quote } }), rule.interpretation ? (_jsxs("p", { style: mutedStyle, children: [_jsx("strong", { children: "Interpretation: " }), rule.interpretation] })) : null, rule.fixHint ? (_jsxs("p", { style: mutedStyle, children: [_jsx("strong", { children: "Fix: " }), rule.fixHint] })) : null] }));
}
/** Red-pen notes beside the row an interpretation changes; each links to the full decision. */
function MarginNotes(props) {
    if (props.notes.length === 0)
        return null;
    return (_jsx(_Fragment, { children: props.notes.map((note) => (_jsx("a", { className: "rf-margin-note", href: "#interpretations", title: note.decision, "data-interpretation-id": note.id, children: note.title }, note.id))) }));
}
function CellRules(props) {
    const { rules, openId, onToggle } = props;
    if (rules.length === 0) {
        return (_jsx("span", { style: microStyle, "aria-label": "No rule", children: "\u2014" }));
    }
    return (_jsx(_Fragment, { children: rules.map((rule) => (_jsx(Criterion, { rule: rule, open: openId === rule.id, onToggle: onToggle }, rule.id))) }));
}
/* -------------------------------------------------------------------------- */
/* The matrix, wide and stacked                                               */
/* -------------------------------------------------------------------------- */
function WideMatrix(props) {
    const { matrix, caption, interpretations, openId, onToggle } = props;
    const notes = matrix.rows.map((row) => notesFor(row, interpretations));
    const hasMargin = notes.some((list) => list.length > 0);
    const columns = 1 + (matrix.weighted ? 1 : 0) + matrix.tiers.length + (hasMargin ? 1 : 0);
    return (_jsxs("table", { style: tableStyle, children: [_jsx("caption", { className: "rf-sr-only", children: caption }), _jsxs("colgroup", { children: [_jsx("col", { style: { width: '18%' } }), matrix.weighted ? _jsx("col", { style: { width: '9%' } }) : null, matrix.tiers.map((tier) => (_jsx("col", {}, tier))), hasMargin ? _jsx("col", { style: { width: '17%' } }) : null] }), _jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { scope: "col", style: { ...cellBase, borderTop: 'none', paddingLeft: 0 }, children: _jsx("span", { style: microStyle, children: "Factor" }) }), matrix.weighted ? (_jsx("th", { scope: "col", style: { ...cellBase, borderTop: 'none' }, children: _jsx("span", { style: microStyle, children: "Weight" }) })) : null, matrix.tiers.map((tier) => (_jsxs("th", { scope: "col", style: {
                                ...cellBase,
                                ...columnRule,
                                borderTop: 'none',
                                borderBottom: `3px solid ${TIER_EDGE[tier]}`,
                            }, children: [_jsx("span", { style: { display: 'block', fontWeight: 600 }, children: TIER_LABELS[tier] }), _jsx("span", { style: { ...microStyle, display: 'block', textTransform: 'none', letterSpacing: 0, fontWeight: 400 }, children: TIER_GLOSS[tier] })] }, tier))), hasMargin ? (_jsx("th", { scope: "col", style: { ...cellBase, ...marginRule, borderTop: 'none' }, children: _jsx("span", { style: microStyle, children: "Margin" }) })) : null] }) }), _jsx("tbody", { children: matrix.rows.map((row, rowIndex) => {
                    const open = matrix.tiers
                        .flatMap((tier) => row.cells[tier])
                        .find((rule) => rule.id === openId);
                    return (_jsxs(Fragment, { children: [_jsxs("tr", { children: [_jsx("th", { scope: "row", style: rowHeadStyle, children: factorLabel(row.factor) }), matrix.weighted ? (_jsx("td", { style: { ...cellBase, fontSize: cssVar('size-small') }, children: row.weight === null ? (_jsx("span", { style: microStyle, children: "\u2014" })) : (_jsx(WeightBar, { weight: row.weight, max: matrix.maxWeight })) })) : null, matrix.tiers.map((tier) => (_jsx("td", { style: { ...cellBase, ...columnRule, padding: SPACE.xs }, children: _jsx(CellRules, { rules: row.cells[tier], openId: openId, onToggle: onToggle }) }, tier))), hasMargin ? (_jsx("td", { style: { ...cellBase, ...marginRule, verticalAlign: 'middle' }, children: _jsx(MarginNotes, { notes: notes[rowIndex] ?? [] }) })) : null] }), open ? (_jsxs("tr", { children: [_jsx("td", { colSpan: hasMargin ? columns - 1 : columns, style: { padding: `0 ${SPACE.lg}px ${SPACE.lg}px 0`, borderBottom: 'none' }, children: _jsx(RuleDetail, { rule: open }) }), hasMargin ? _jsx("td", { style: { ...marginRule, borderBottom: 'none' } }) : null] })) : null] }, row.factor));
                }) })] }));
}
function StackedMatrix(props) {
    const { matrix, interpretations, openId, onToggle } = props;
    return (_jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: SPACE.lg }, children: matrix.rows.map((row) => {
            const open = matrix.tiers
                .flatMap((tier) => row.cells[tier])
                .find((rule) => rule.id === openId);
            return (_jsxs("section", { "aria-label": factorLabel(row.factor), children: [_jsxs("h3", { style: {
                            margin: 0,
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'baseline',
                            gap: SPACE.sm,
                            fontSize: cssVar('size-body'),
                            lineHeight: cssVar('leading-body'),
                        }, children: [_jsx("span", { children: factorLabel(row.factor) }), matrix.weighted && row.weight !== null ? (_jsx("span", { style: microStyle, children: formatPercent(row.weight) })) : null] }), _jsx(MarginNotes, { notes: notesFor(row, interpretations) }), matrix.tiers.map((tier) => row.cells[tier].length === 0 ? null : (_jsxs("div", { style: {
                            marginTop: SPACE.sm,
                            padding: SPACE.sm,
                            borderLeft: `3px solid ${TIER_EDGE[tier]}`,
                        }, children: [_jsx("span", { style: { ...microStyle, display: 'block', fontWeight: 600 }, children: TIER_LABELS[tier] }), _jsx(CellRules, { rules: row.cells[tier], openId: openId, onToggle: onToggle })] }, tier))), open ? _jsx("div", { style: { marginTop: SPACE.sm }, children: _jsx(RuleDetail, { rule: open }) }) : null] }, row.factor));
        }) }));
}
function RulebookCard(props) {
    const { book, note, interpretations, stacked, openId, onToggle } = props;
    const matrix = useMemo(() => buildMatrix(book.rules), [book.rules]);
    const aside = [book.version ? `v${book.version}` : null, pluralize(book.rules.length, 'rule')]
        .filter(Boolean)
        .join(' · ');
    return (_jsxs(Card, { title: book.label, aside: aside, anchorId: `rulebook-${book.id}`, children: [note ?? null, matrix.rows.length === 0 ? (_jsx("p", { style: mutedStyle, children: "No rules in this rulebook." })) : stacked ? (_jsx(StackedMatrix, { matrix: matrix, interpretations: interpretations, openId: openId, onToggle: onToggle })) : (_jsx("div", { className: "rf-scroll-x", children: _jsx(WideMatrix, { matrix: matrix, caption: `${book.label}: every factor, with the criterion that puts an account in each tier.`, interpretations: interpretations, openId: openId, onToggle: onToggle }) }))] }));
}
function Interpretations(props) {
    const { items } = props;
    if (items.length === 0)
        return null;
    return (_jsx(Card, { title: "Where the guidelines were ambiguous", aside: pluralize(items.length, 'decision'), anchorId: "interpretations", children: _jsx("dl", { style: { margin: 0, display: 'flex', flexDirection: 'column', gap: SPACE.lg }, children: items.map((item) => (_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: SPACE.xs }, children: [_jsxs("dt", { style: { fontWeight: 600 }, children: [_jsx("code", { style: { ...codeStyle, marginRight: SPACE.sm }, children: item.id }), item.title] }), _jsxs("dd", { style: { margin: 0 }, children: [_jsx("p", { style: { ...mutedStyle, color: cssVar('ink') }, children: item.decision }), item.affects.length > 0 ? (_jsxs("p", { style: { ...microStyle, marginTop: SPACE.xs }, children: ["Affects ", _jsx("code", { style: codeStyle, children: item.affects.join(', ') })] })) : null] })] }, item.id))) }) }));
}
/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */
/**
 * PRD §10 /rules — the appetite guidelines as the criteria table they are:
 * one row per factor, one column per tier, the threshold in each cell, and the
 * rule id, raw condition, citation and interpretation behind each one.
 *
 * The open rule lives in `?rule=`, so a verdict elsewhere in the console can
 * link straight at the criterion that decided it.
 */
export function RulesPage() {
    const state = useApi((client) => client.getRules(), []);
    const [params, setParams] = useSearchParams();
    const stacked = useStacked();
    const openId = params.get('rule');
    const onToggle = useCallback((id) => {
        const next = new URLSearchParams(params);
        if (next.get('rule') === id)
            next.delete('rule');
        else
            next.set('rule', id);
        setParams(next, { replace: true });
    }, [params, setParams]);
    // A deep link from a verdict lands on the rule, not the top of the page.
    useEffect(() => {
        if (openId === null || typeof document === 'undefined')
            return;
        const el = document.getElementById(`rule-${openId}`);
        if (el && typeof el.scrollIntoView === 'function')
            el.scrollIntoView({ block: 'center' });
    }, [openId]);
    const header = (_jsxs("header", { children: [_jsx("h1", { style: titleStyle, children: "Rules" }), _jsx("p", { style: { ...mutedStyle, marginTop: SPACE.xs }, children: "Every criterion the engine tests, in the shape of the guideline table it came from." })] }));
    if (state.data === null && state.loading) {
        return (_jsxs("div", { style: pageStyle, children: [header, _jsx(Skeleton, { label: "Loading the rulebooks", lines: 8 })] }));
    }
    if (state.data === null) {
        return (_jsxs("div", { style: pageStyle, children: [header, _jsxs("div", { role: "alert", children: [_jsxs("p", { style: { margin: 0 }, children: ["The rulebooks could not be loaded", state.error ? `: ${state.error.message}` : '.'] }), _jsx("button", { type: "button", onClick: state.reload, style: { minHeight: MIN_TOUCH_TARGET, marginTop: SPACE.sm }, children: "Try again" })] })] }));
    }
    const books = toRulebooks(state.data.rulebooks);
    const interpretations = (state.data.interpretations ?? []).filter(isInterpretation);
    // A rule flagged `extension` inside another rulebook still belongs with
    // Retrofit's own rules, which never touch the appetite score.
    const strays = [];
    const shown = [];
    for (const book of books) {
        if (book.isExtension) {
            shown.push(book);
            continue;
        }
        const own = book.rules.filter((r) => r.extension !== true);
        strays.push(...book.rules.filter((r) => r.extension === true));
        shown.push({ ...book, rules: own });
    }
    const ordered = shown.map((book) => book.isExtension ? { ...book, rules: [...book.rules, ...strays] } : book);
    return (_jsxs("div", { style: pageStyle, children: [header, ordered.length === 0 ? _jsx("p", { children: "No rulebooks are active." }) : null, ordered.map((book) => (_jsx(RulebookCard, { book: book, interpretations: interpretations, stacked: stacked, openId: openId, onToggle: onToggle, note: book.isExtension ? (_jsx("p", { style: { ...mutedStyle, marginBottom: SPACE.md }, children: "Retrofit\u2019s own rules. They can raise REFER or a contradiction and feed the premium, and they never touch the appetite score." })) : null }, book.id))), _jsx(Interpretations, { items: interpretations })] }));
}
//# sourceMappingURL=RulesPage.js.map