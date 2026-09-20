import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatMoney, formatPercent, formatTiv, titleCase } from '@retrofit/contracts';
import { useApi } from '../api/useApi.js';
import { Defs, Figures, Group, Panel, useReveal } from './tour-dossier.js';
/**
 * The rulebook section of `/tour`, read live from `GET /rules`.
 *
 * It is drawn as the guideline table it came from — one row per factor, one
 * column per tier, the criterion in the cell, the interpretation in the red
 * margin — rather than as a stack of collapsible factor panels. A reader should
 * be able to compare Target against Not acceptable across a row without opening
 * anything.
 *
 * The API client types `rulebooks` as `unknown[]` and drops the top-level
 * `weights` record, so this file narrows the shape itself and derives each
 * factor's weight from its own rules when the record carries none. Every number
 * shown here is the deployed rulebook's; none of it is typed into this page.
 *
 * It does not import from `RulesPage`: the console's rules page owns that code
 * and exports none of it. The phrasing helpers below are deliberately private
 * to this file.
 */
/* -------------------------------------------------------------------------- */
/* Narrowing                                                                  */
/* -------------------------------------------------------------------------- */
const TIER_ORDER = ['target', 'acceptable', 'refer', 'not_acceptable'];
const TIER_LABEL = {
    target: 'Target',
    acceptable: 'Acceptable',
    refer: 'Refer',
    not_acceptable: 'Not acceptable',
};
/** What each column means for an account, in the guidelines' own three-point scale. */
const TIER_GLOSS = {
    target: 'Scores 1',
    acceptable: 'Scores 0.6',
    refer: 'Needs an underwriter',
    not_acceptable: 'Knocks the account out',
};
/** The rule that runs under the column head. */
const TIER_EDGE = {
    target: 'var(--rf-green)',
    acceptable: 'var(--rf-muted)',
    refer: 'var(--rf-blue)',
    not_acceptable: 'var(--rf-red)',
};
/** Display order for Federato's eight weighted factors; anything else sorts after. */
const FACTOR_ORDER = [
    'submission_type',
    'line_of_business',
    'primary_risk_state',
    'tiv',
    'total_premium',
    'building_age',
    'construction_type',
    'loss_value',
];
const FACTOR_LABEL = {
    line_of_business: 'Line of business',
    primary_risk_state: 'Primary risk state',
    tiv: 'Total insured value',
    total_premium: 'Total premium',
    submission_type: 'Submission type',
    building_age: 'Building age',
    construction_type: 'Construction class',
    loss_value: 'Loss history',
    sprinkler_protection: 'Sprinkler protection',
    protection_class: 'Protection class',
    smoke_detection: 'Smoke detection',
    contents_limit: 'Contents limit',
};
/** `hazard_heater_near_combustible` reads better as `Heater Near Combustible (hazard)`. */
function factorLabel(factor) {
    const known = FACTOR_LABEL[factor];
    if (known !== undefined)
        return known;
    const bare = factor.startsWith('hazard_') ? factor.slice('hazard_'.length) : factor;
    const words = titleCase(bare.replace(/_/g, ' '));
    return factor.startsWith('hazard_') ? `${words} (hazard)` : words;
}
const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isTier = (v) => typeof v === 'string' && TIER_ORDER.includes(v);
function toCondition(raw) {
    if (!isRecord(raw))
        return null;
    const field = typeof raw['field'] === 'string' ? raw['field'] : null;
    const op = typeof raw['op'] === 'string' ? raw['op'] : null;
    if (field === null || op === null)
        return null;
    return { field, op, value: raw['value'] };
}
function toRule(raw) {
    if (!isRecord(raw))
        return null;
    const { id, factor, tier, citation, when, weight, extension, fixHint, interpretation } = raw;
    if (typeof id !== 'string' || typeof factor !== 'string' || !isTier(tier))
        return null;
    if (!isRecord(citation))
        return null;
    const { doc, section, quote } = citation;
    if (typeof doc !== 'string' || typeof section !== 'string' || typeof quote !== 'string') {
        return null;
    }
    return {
        id,
        factor,
        tier,
        weight: typeof weight === 'number' ? weight : null,
        doc,
        section,
        quote,
        when: Array.isArray(when)
            ? when.map(toCondition).filter((c) => c !== null)
            : [],
        extension: extension === true,
        fixHint: typeof fixHint === 'string' ? fixHint : null,
        interpretation: typeof interpretation === 'string' ? interpretation : null,
    };
}
function toRulebooks(raw) {
    const books = [];
    for (const entry of raw) {
        if (!isRecord(entry))
            continue;
        const id = entry['id'];
        const rules = entry['rules'];
        if (typeof id !== 'string' || !Array.isArray(rules))
            continue;
        books.push({
            id,
            label: typeof entry['label'] === 'string' ? entry['label'] : titleCase(id),
            version: typeof entry['version'] === 'string' ? entry['version'] : '',
            isExtension: entry['isExtension'] === true || id === 'extensions',
            rules: rules.map(toRule).filter((r) => r !== null),
        });
    }
    return books;
}
function toInterpretations(raw) {
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const entry of raw) {
        if (!isRecord(entry))
            continue;
        const { id, title, decision, affects } = entry;
        if (typeof id !== 'string' || typeof title !== 'string' || typeof decision !== 'string') {
            continue;
        }
        out.push({
            id,
            title,
            decision,
            affects: Array.isArray(affects) ? affects.filter((a) => typeof a === 'string') : [],
        });
    }
    return out;
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
 * row. Conditions on one field collapse into a single clause, and a range
 * becomes one phrase rather than two inequalities.
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
        // The guideline lists the states themselves; the vector tests a tier
        // number, so the citation's own wording is the readable criterion.
        if (field === 'stateTier') {
            clauses.push({ text: rule.quote, label: '' });
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
function buildMatrix(rules, weights) {
    const byFactor = new Map();
    for (const rule of rules) {
        const list = byFactor.get(rule.factor);
        if (list)
            list.push(rule);
        else
            byFactor.set(rule.factor, [rule]);
    }
    const rank = (factor) => {
        const i = FACTOR_ORDER.indexOf(factor);
        return i === -1 ? FACTOR_ORDER.length : i;
    };
    const factors = [...byFactor.keys()];
    const firstSeen = new Map(factors.map((f, i) => [f, i]));
    factors.sort((a, b) => rank(a) - rank(b) || (firstSeen.get(a) ?? 0) - (firstSeen.get(b) ?? 0));
    const used = new Set();
    let maxWeight = 0;
    let totalWeight = 0;
    const rows = factors.map((factor) => {
        const list = byFactor.get(factor) ?? [];
        const cells = {
            target: [],
            acceptable: [],
            refer: [],
            not_acceptable: [],
        };
        for (const rule of list) {
            cells[rule.tier].push(rule);
            used.add(rule.tier);
        }
        for (const tier of TIER_ORDER)
            cells[tier].sort((a, b) => a.id.localeCompare(b.id));
        // The response's own weights record wins; otherwise the weight is the one
        // this factor's rules agree on, and nothing when they do not.
        const distinct = new Set(list.map((r) => r.weight).filter((w) => typeof w === 'number'));
        const declared = weights[factor];
        const weight = typeof declared === 'number' ? declared : distinct.size === 1 ? [...distinct][0] : null;
        if (weight !== null) {
            if (weight > maxWeight)
                maxWeight = weight;
            totalWeight += weight;
        }
        return { factor, label: factorLabel(factor), weight, cells, count: list.length };
    });
    return {
        rows,
        tiers: TIER_ORDER.filter((t) => used.has(t)),
        maxWeight,
        totalWeight,
        weighted: maxWeight > 0,
    };
}
/**
 * The interpretations that bear on one factor row: an interpretation names the
 * vector fields it `affects`, and a rule names the fields it tests.
 */
function notesFor(row, interpretations) {
    const fields = new Set();
    for (const tier of TIER_ORDER) {
        for (const rule of row.cells[tier]) {
            for (const condition of rule.when)
                fields.add(condition.field);
        }
    }
    return interpretations.filter((item) => item.affects.some((field) => fields.has(field)));
}
/* -------------------------------------------------------------------------- */
/* Reveal                                                                     */
/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- */
/* Pieces                                                                     */
/* -------------------------------------------------------------------------- */
/** The weight, and a rule under it sized by share of the heaviest factor. */
function WeightBar(props) {
    const share = props.max > 0 ? Math.max(0.08, props.weight / props.max) : 0;
    return (_jsxs("span", { className: "rf-tour__weight", children: [_jsx("span", { className: "rf-tour__weight-value", children: formatPercent(props.weight) }), _jsx("span", { className: "rf-tour__weight-track", "aria-hidden": "true", children: _jsx("span", { className: "rf-tour__weight-fill", style: { '--rf-share': share } }) })] }));
}
/** One criterion in a cell: the threshold, what it measures, and its rule id. */
function Criterion(props) {
    const { rule, open, onToggle } = props;
    const clauses = describe(rule);
    return (_jsxs("button", { type: "button", className: "rf-tour__crit", "aria-expanded": open, "aria-controls": `tour-rule-${rule.id}`, "data-open": open ? 'true' : undefined, "data-rule-id": rule.id, onClick: () => onToggle(rule.id), children: [clauses.map((clause, i) => (_jsxs("span", { className: "rf-tour__crit-line", children: [_jsx("span", { className: "rf-tour__crit-text", children: clause.text }), clause.label ? _jsx("span", { className: "rf-tour__crit-label", children: clause.label }) : null] }, `${clause.text}-${i}`))), _jsx("span", { className: "rf-tour__crit-tab", children: _jsx("span", { className: "rf-rule-tab", children: rule.id }) })] }));
}
/** The whole rule, unfolded under the row it sits in. */
function RuleDetail(props) {
    const { rule } = props;
    return (_jsxs("div", { id: `tour-rule-${rule.id}`, role: "group", "aria-label": `Rule ${rule.id}`, className: "rf-tour__detail", children: [_jsxs("p", { className: "rf-tour__detail-head", children: [_jsx("span", { className: "rf-rule-tab", children: rule.id }), _jsxs("span", { className: "rf-tour__detail-tier", children: [TIER_LABEL[rule.tier], " \u00B7 ", TIER_GLOSS[rule.tier]] }), rule.extension ? (_jsx("span", { className: "rf-tour__detail-flag", children: "Ours, not Federato\u2019s" })) : null] }), _jsxs("p", { className: "rf-tour__quote", children: ["\u201C", rule.quote, "\u201D", _jsx("br", {}), _jsxs("span", { className: "rf-tour__mono", children: [rule.doc, " \u00B7 ", rule.section] })] }), _jsxs("dl", { className: "rf-tour__detail-meta", children: [_jsxs("div", { children: [_jsx("dt", { children: "Tests" }), _jsx("dd", { children: _jsx("span", { className: "rf-tour__mono", children: rule.when.length === 0 ? 'Always' : rule.when.map(rawCondition).join(' AND ') }) })] }), rule.weight !== null ? (_jsxs("div", { children: [_jsx("dt", { children: "Weight" }), _jsx("dd", { children: formatPercent(rule.weight) })] })) : null, rule.interpretation !== null ? (_jsxs("div", { children: [_jsx("dt", { children: "Interpretation" }), _jsx("dd", { children: rule.interpretation })] })) : null, rule.fixHint !== null ? (_jsxs("div", { children: [_jsx("dt", { children: "Fix" }), _jsx("dd", { children: rule.fixHint })] })) : null] })] }));
}
/** Red-pen notes beside the row an interpretation changes. */
function MarginNotes(props) {
    if (props.notes.length === 0)
        return null;
    return (_jsx(_Fragment, { children: props.notes.map((note) => (_jsx("a", { className: "rf-margin-note", href: "#rules-interpretations", title: note.decision, "data-interpretation-id": note.id, children: note.title }, note.id))) }));
}
function CellRules(props) {
    if (props.rules.length === 0) {
        return (_jsx("span", { className: "rf-tour__cell-empty", "aria-label": "No rule", children: "\u2014" }));
    }
    return (_jsx(_Fragment, { children: props.rules.map((rule) => (_jsx(Criterion, { rule: rule, open: props.openId === rule.id, onToggle: props.onToggle }, rule.id))) }));
}
/* -------------------------------------------------------------------------- */
/* One rulebook, as a ruled sheet                                             */
/* -------------------------------------------------------------------------- */
/** A heading id a table can point at: `federato-appetite-guidelines`. */
function slug(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function Sheet(props) {
    const { matrix, title, aside, note, interpretations, openId, onToggle } = props;
    const reveal = useReveal();
    const headingId = `sheet-${slug(title)}`;
    const notes = matrix.rows.map((row) => notesFor(row, interpretations));
    const hasMargin = notes.some((list) => list.length > 0);
    const columns = 1 + (matrix.weighted ? 1 : 0) + matrix.tiers.length + (hasMargin ? 1 : 0);
    return (_jsxs("section", { className: "rf-tour__sheet", ref: reveal, "aria-labelledby": headingId, children: [_jsxs("header", { className: "rf-tour__sheet-head", children: [_jsx("h3", { id: headingId, children: title }), _jsx("span", { className: "rf-tour__sheet-aside", children: aside })] }), note ? _jsx("p", { className: "rf-tour__sheet-note", children: note }) : null, matrix.rows.length === 0 ? (_jsx("p", { className: "rf-tour__sheet-note", children: "No rules in this rulebook." })) : (_jsx("div", { className: "rf-scroll-x", children: _jsxs("table", { className: "rf-tour__matrix", children: [_jsxs("caption", { className: "rf-sr-only", children: [title, ": every factor, with the criterion that puts an account in each tier."] }), _jsxs("colgroup", { children: [_jsx("col", { className: "rf-tour__col-factor" }), matrix.weighted ? _jsx("col", { className: "rf-tour__col-weight" }) : null, matrix.tiers.map((tier) => (_jsx("col", {}, tier))), hasMargin ? _jsx("col", { className: "rf-tour__col-margin" }) : null] }), _jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { scope: "col", children: "Factor" }), matrix.weighted ? _jsx("th", { scope: "col", children: "Weight" }) : null, matrix.tiers.map((tier) => (_jsxs("th", { scope: "col", className: "rf-tour__tier-head", style: { '--rf-tier-edge': TIER_EDGE[tier] }, children: [_jsx("span", { className: "rf-tour__tier-name", children: TIER_LABEL[tier] }), _jsx("span", { className: "rf-tour__tier-gloss", children: TIER_GLOSS[tier] })] }, tier))), hasMargin ? (_jsx("th", { scope: "col", className: "rf-tour__margin-cell", children: "Margin" })) : null] }) }), _jsx("tbody", { children: matrix.rows.map((row, i) => {
                                const open = matrix.tiers
                                    .flatMap((tier) => row.cells[tier])
                                    .find((rule) => rule.id === openId);
                                return (_jsxs(Fragment, { children: [_jsxs("tr", { style: { '--rf-row': i }, children: [_jsx("th", { scope: "row", className: "rf-tour__row-head", children: row.label }), matrix.weighted ? (_jsx("td", { className: "rf-tour__cell-weight", children: row.weight === null ? (_jsx("span", { className: "rf-tour__cell-empty", children: "\u2014" })) : (_jsx(WeightBar, { weight: row.weight, max: matrix.maxWeight })) })) : null, matrix.tiers.map((tier) => (_jsx("td", { className: "rf-tour__cell", children: _jsx(CellRules, { rules: row.cells[tier], openId: openId, onToggle: onToggle }) }, tier))), hasMargin ? (_jsx("td", { className: "rf-tour__margin-cell", children: _jsx(MarginNotes, { notes: notes[i] ?? [] }) })) : null] }), open ? (_jsxs("tr", { className: "rf-tour__detail-row", children: [_jsx("td", { colSpan: hasMargin ? columns - 1 : columns, children: _jsx(RuleDetail, { rule: open }) }), hasMargin ? _jsx("td", { className: "rf-tour__margin-cell" }) : null] })) : null] }, row.factor));
                            }) })] }) }))] }));
}
/** `4 rules`, `1 rule`. */
const ruleCount = (n) => `${n} ${n === 1 ? 'rule' : 'rules'}`;
/** `v1.0.0 · 24 rules`, uppercased by the sheet's own type. */
function sheetAside(book) {
    if (book === undefined)
        return '';
    return [book.version ? `v${book.version}` : null, ruleCount(book.rules.length)]
        .filter((part) => part !== null)
        .join(' · ');
}
/**
 * The top-level `weights` record, when the response carries one. The API client
 * types it away, so it is narrowed back off the raw object; a factor's weight
 * falls back to the one its own rules agree on.
 */
function toWeights(raw) {
    if (!isRecord(raw) || !isRecord(raw['weights']))
        return {};
    const out = {};
    for (const [key, value] of Object.entries(raw['weights'])) {
        if (typeof value === 'number')
            out[key] = value;
    }
    return out;
}
/**
 * The whole rulebook, drawn as the guideline table it came from and read live
 * so it cannot drift from the engine that scores the book. The three rulebooks
 * are kept apart on purpose: only the commercial one scores a Federato account.
 */
export function RulesGroup() {
    const state = useApi((client) => client.getRules(), []);
    const [openId, setOpenId] = useState(null);
    const onToggle = useCallback((id) => {
        setOpenId((current) => (current === id ? null : id));
    }, []);
    const books = useMemo(() => (state.data === null ? [] : toRulebooks(state.data.rulebooks)), [state.data]);
    const weights = useMemo(() => toWeights(state.data), [state.data]);
    const interpretations = useMemo(() => (state.data === null ? [] : toInterpretations(state.data.interpretations)), [state.data]);
    const commercial = books.find((b) => b.id === 'commercial') ?? books.find((b) => !b.isExtension);
    const tenant = books.find((b) => b.id === 'tenant');
    const extensions = books.find((b) => b.isExtension);
    const matrix = useMemo(() => buildMatrix(commercial?.rules ?? [], weights), [commercial, weights]);
    const tenantMatrix = useMemo(() => buildMatrix(tenant?.rules ?? [], {}), [tenant]);
    const extensionMatrix = useMemo(() => buildMatrix(extensions?.rules ?? [], {}), [extensions]);
    return (_jsx(Group, { id: "rules", title: "The rulebook, with its weights", lede: "Read live from GET /rules on every load, the same endpoint the console's rules page and the 3D appetite terrain use. Nothing here can disagree with the engine.", children: state.error !== null ? (_jsxs("p", { className: "rf-tour__state", children: ["The rulebook could not be loaded (", state.error.message, ").", ' ', _jsx("button", { type: "button", className: "rf-tour__chip", onClick: state.reload, children: "Try again" })] })) : state.data === null ? (_jsx("p", { className: "rf-tour__state", children: "Loading the rulebook from the API\u2026" })) : (_jsxs(_Fragment, { children: [_jsx(Figures, { items: [
                        { value: String(matrix.rows.length), label: 'weighted factors' },
                        { value: String(commercial?.rules.length ?? 0), label: 'appetite rules' },
                        {
                            value: formatPercent(matrix.totalWeight, { from: 'ratio' }),
                            label: 'of the score accounted for',
                        },
                        { value: String(tenant?.rules.length ?? 0), label: 'tenant rules' },
                        { value: String(extensions?.rules.length ?? 0), label: 'Retrofit extensions' },
                    ] }), _jsxs(Panel, { title: "How a submission becomes a score", note: "11 components, 8 factors", open: true, children: [_jsxs("p", { children: ["Each submission becomes an 11-component feature vector. The appetite score is", ' ', _jsx("span", { className: "rf-tour__mono", children: "100 \u00D7 (w \u00B7 t)" }), " over Federato\u2019s eight factors, with tiers 1.0 / 0.6 / 0. Any not-acceptable tier is a knockout regardless of the score. ", _jsx("strong", { children: "Missing data is never imputed" }), " \u2014 it forces REFER rather than guessing a tier."] }), _jsx("p", { children: "The table below is the guideline table itself: a row per factor, a column per tier, and the criterion that lands an account in it. Open any criterion for the rule id, the raw condition the engine tests, and the quoted line it came from." })] }), _jsxs("div", { className: "rf-tour__pair", children: [_jsx(Sheet, { matrix: matrix, title: commercial?.label ?? 'Federato appetite guidelines', aside: sheetAside(commercial), interpretations: interpretations, openId: openId, onToggle: onToggle }), tenant !== undefined && tenant.rules.length > 0 ? (_jsx(Sheet, { matrix: tenantMatrix, title: tenant.label, aside: `${sheetAside(tenant)} · prices a room, never an account`, note: "The rules the phone app runs. These are Retrofit\u2019s, not Federato\u2019s: they turn what the camera saw into a tenant verdict and an estimate, and they never touch a commercial appetite score. Tenant rates are invented and labelled \u201Cestimate\u201D.", interpretations: interpretations, openId: openId, onToggle: onToggle })) : null] }), extensions !== undefined && extensions.rules.length > 0 ? (_jsx(Sheet, { matrix: extensionMatrix, title: extensions.label, aside: `${sheetAside(extensions)} · never scores an account`, note: "Ours, not Federato\u2019s. They are labelled as extensions wherever they appear, and they feed the rating table rather than the appetite score.", interpretations: interpretations, openId: openId, onToggle: onToggle })) : null, interpretations.length > 0 ? (_jsx("div", { id: "rules-interpretations", children: _jsxs(Panel, { title: "Where the guidelines are ambiguous", note: `${interpretations.length} interpretations`, children: [_jsx("p", { children: "The PDF leaves real gaps. Each one was resolved once, in a written contract, and the reading is shown in the margin of every row it decides." }), _jsx(Defs, { rows: interpretations.map((i) => ({ term: i.title, value: i.decision })) })] }) })) : null] })) }));
}
//# sourceMappingURL=tour-rules.js.map