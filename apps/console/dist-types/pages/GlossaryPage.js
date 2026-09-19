import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useId, useMemo, useState } from 'react';
import { pluralize } from '@retrofit/contracts';
import { cssVar, MIN_TOUCH_TARGET, RADIUS, SPACE } from '@retrofit/design';
import { useApi } from '../api/useApi.js';
import { Skeleton } from '../components/atoms/Skeleton.js';
function normalize(value) {
    return value
        .toLowerCase()
        .replace(/[_\-\s]+/g, ' ')
        .trim();
}
/** Stable anchor so other pages can link `/glossary#glossary-in-appetite`. */
function anchorFor(term) {
    const slug = term
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return `glossary-${slug || 'term'}`;
}
/**
 * Every whitespace-separated query word must appear in the term, definition
 * or source. Term matches rank above definition-only matches; ties stay
 * alphabetical.
 */
function filterEntries(entries, query) {
    const sorted = [...entries].sort((a, b) => a.term.localeCompare(b.term, 'en', { sensitivity: 'base' }));
    const words = normalize(query).split(' ').filter((w) => w.length > 0);
    if (words.length === 0)
        return sorted;
    const scored = [];
    sorted.forEach((entry, order) => {
        const term = normalize(entry.term);
        const haystack = `${term} ${normalize(entry.definition)} ${normalize(entry.source)}`;
        if (!words.every((w) => haystack.includes(w)))
            return;
        const rank = term === words.join(' ') ? 0 : words.every((w) => term.includes(w)) ? 1 : 2;
        scored.push({ entry, rank, order });
    });
    scored.sort((a, b) => a.rank - b.rank || a.order - b.order);
    return scored.map((s) => s.entry);
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
const leadStyle = {
    margin: `${SPACE.xs}px 0 0`,
    color: cssVar('muted-deep'),
    fontSize: cssVar('size-small'),
    lineHeight: cssVar('leading-small'),
};
const labelStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: SPACE.xs,
    maxWidth: 480,
    fontSize: cssVar('size-micro'),
    lineHeight: cssVar('leading-micro'),
    color: cssVar('muted-deep'),
};
const inputStyle = {
    minHeight: MIN_TOUCH_TARGET,
    padding: `0 ${SPACE.md}px`,
    border: `${cssVar('border-width')} solid ${cssVar('border-color')}`,
    borderRadius: RADIUS.card,
    background: cssVar('paper'),
    color: cssVar('ink'),
    fontFamily: cssVar('font-body'),
    fontSize: cssVar('size-body'),
};
const listStyle = {
    margin: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: SPACE.lg,
};
const itemStyle = {
    padding: SPACE.lg,
    border: `${cssVar('border-width')} solid ${cssVar('border-color')}`,
    borderRadius: RADIUS.card,
    scrollMarginTop: SPACE.xl,
};
const termStyle = {
    fontFamily: cssVar('font-display'),
    fontSize: cssVar('size-heading'),
    lineHeight: cssVar('leading-heading'),
    fontWeight: 600,
};
const definitionStyle = {
    margin: `${SPACE.sm}px 0 0`,
    fontSize: cssVar('size-body'),
    lineHeight: cssVar('leading-body'),
};
const sourceStyle = {
    display: 'block',
    marginTop: SPACE.sm,
    color: cssVar('muted-deep'),
    fontSize: cssVar('size-micro'),
    lineHeight: cssVar('leading-micro'),
};
/**
 * PRD 10 /glossary - searchable; also powers the tooltips.
 *
 * Stub frozen by W0-4. Unit C13 replaces this body only.
 * Route registration lives in src/App.tsx and is frozen.
 */
export function GlossaryPage() {
    const state = useApi((client) => client.getGlossary(), []);
    const [query, setQuery] = useState('');
    const searchId = useId();
    const statusId = useId();
    const entries = state.data?.entries ?? [];
    const visible = useMemo(() => filterEntries(entries, query), [entries, query]);
    const trimmed = query.trim();
    let body;
    if (state.data === null && state.loading) {
        body = _jsx(Skeleton, { label: "Loading the glossary", lines: 6 });
    }
    else if (state.data === null && state.error !== null) {
        body = (_jsxs("div", { role: "alert", children: [_jsxs("p", { style: { margin: 0 }, children: ["The glossary could not be loaded: ", state.error.message] }), _jsx("button", { type: "button", onClick: state.reload, style: { minHeight: MIN_TOUCH_TARGET, marginTop: SPACE.sm }, children: "Try again" })] }));
    }
    else if (entries.length === 0) {
        body = _jsx("p", { children: "The glossary is empty." });
    }
    else if (visible.length === 0) {
        body = _jsxs("p", { children: ["No glossary term matches \u201C", trimmed, "\u201D."] });
    }
    else {
        body = (_jsx("dl", { style: listStyle, "aria-label": "Glossary terms", children: visible.map((entry) => (_jsxs("div", { id: anchorFor(entry.term), style: itemStyle, children: [_jsx("dt", { style: termStyle, children: entry.term }), _jsxs("dd", { style: definitionStyle, children: [entry.definition, _jsx("cite", { style: sourceStyle, children: entry.source })] })] }, entry.term))) }));
    }
    const status = state.data === null
        ? ''
        : trimmed.length === 0
            ? pluralize(entries.length, 'term')
            : `${pluralize(visible.length, 'term')} of ${entries.length} match “${trimmed}”`;
    return (_jsxs("div", { style: pageStyle, children: [_jsxs("header", { children: [_jsx("h1", { style: titleStyle, children: "Glossary" }), _jsx("p", { style: leadStyle, children: "Terms from Federato\u2019s glossary. The same definitions appear as tooltips across the console." })] }), _jsxs("div", { role: "search", "aria-label": "Search the glossary", children: [_jsx("label", { htmlFor: searchId, style: labelStyle, children: "Search terms and definitions" }), _jsx("input", { id: searchId, type: "search", value: query, onChange: (event) => setQuery(event.target.value), "aria-describedby": statusId, autoComplete: "off", style: { ...inputStyle, marginTop: SPACE.xs, width: '100%', maxWidth: 480, boxSizing: 'border-box' } }), _jsx("p", { id: statusId, role: "status", "aria-live": "polite", style: leadStyle, children: status })] }), body] }));
}
//# sourceMappingURL=GlossaryPage.js.map