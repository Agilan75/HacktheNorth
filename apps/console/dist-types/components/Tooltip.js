import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useId, useState } from 'react';
import { cssVar, SPACE } from '@retrofit/design';
import { useApiClient } from '../api/useApi.js';
/*
 * One GET /glossary per client for the whole console, however many tooltips
 * are on screen. A failed request is evicted so the next tooltip retries.
 */
const glossaryCache = new WeakMap();
function loadGlossary(client) {
    const cached = glossaryCache.get(client);
    if (cached)
        return cached;
    let promise;
    try {
        promise = client.getGlossary();
    }
    catch (thrown) {
        promise = Promise.reject(thrown);
    }
    promise.catch(() => {
        if (glossaryCache.get(client) === promise)
            glossaryCache.delete(client);
    });
    glossaryCache.set(client, promise);
    return promise;
}
/** `In-Appetite`, `in appetite` and `IN_APPETITE` all compare equal. */
function normalizeTerm(value) {
    return value
        .toLowerCase()
        .replace(/[_\-\s]+/g, ' ')
        .trim();
}
/** Exact normalised match first, then a trailing plural `s` on either side. */
function findEntry(entries, term) {
    const key = normalizeTerm(term);
    if (key.length === 0)
        return null;
    const exact = entries.find((e) => normalizeTerm(e.term) === key);
    if (exact)
        return exact;
    const singular = key.endsWith('s') ? key.slice(0, -1) : key;
    return (entries.find((e) => {
        const t = normalizeTerm(e.term);
        return t === singular || `${t}s` === key || (t.endsWith('s') && t.slice(0, -1) === key);
    }) ?? null);
}
const wrapperStyle = {
    position: 'relative',
    display: 'inline',
};
const triggerStyle = {
    textDecorationLine: 'underline',
    textDecorationStyle: 'dotted',
    textUnderlineOffset: '3px',
    cursor: 'help',
};
const bubbleStyle = {
    position: 'absolute',
    left: 0,
    top: '100%',
    zIndex: 10,
    marginTop: SPACE.xs,
    width: 'max-content',
    maxWidth: 320,
    padding: `${SPACE.sm}px ${SPACE.md}px`,
    background: cssVar('paper'),
    color: cssVar('ink'),
    border: `${cssVar('border-width')} solid ${cssVar('ink')}`,
    borderRadius: SPACE.sm,
    fontFamily: cssVar('font-body'),
    fontSize: cssVar('size-small'),
    lineHeight: cssVar('leading-small'),
    fontWeight: 400,
    textAlign: 'left',
    whiteSpace: 'normal',
};
const sourceStyle = {
    display: 'block',
    marginTop: SPACE.xs,
    color: cssVar('muted-deep'),
    fontSize: cssVar('size-micro'),
    lineHeight: cssVar('leading-micro'),
};
/**
 * Glossary-powered tooltip (PRD §10 /glossary: "also powers tooltips").
 * Keyboard reachable and described by aria-describedby, never hover-only.
 *
 * The description element is always in the DOM so screen readers get the
 * definition on focus; the visual bubble opens on hover or focus and closes
 * on blur, mouse leave, or Escape.
 */
export function Tooltip(props) {
    const { term, children, fallback } = props;
    const client = useApiClient();
    const tipId = useId();
    const [resolution, setResolution] = useState({ status: 'loading' });
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const [dismissed, setDismissed] = useState(false);
    useEffect(() => {
        let active = true;
        setResolution({ status: 'loading' });
        loadGlossary(client).then((glossary) => {
            if (!active)
                return;
            const entry = findEntry(glossary.entries, term);
            setResolution(entry ? { status: 'found', entry } : { status: 'missing' });
        }, () => {
            if (active)
                setResolution({ status: 'missing' });
        });
        return () => {
            active = false;
        };
    }, [client, term]);
    const open = (hovered || focused) && !dismissed;
    let definition;
    let source = null;
    if (resolution.status === 'found') {
        definition = resolution.entry.definition;
        source = resolution.entry.source;
    }
    else if (resolution.status === 'loading') {
        definition = fallback ?? `Loading the glossary definition of “${term}”…`;
    }
    else {
        definition = fallback ?? `No glossary entry for “${term}”.`;
    }
    const onKeyDown = (event) => {
        if (event.key === 'Escape') {
            setDismissed(true);
            event.stopPropagation();
        }
    };
    return (_jsxs("span", { className: "rf-tooltip", style: wrapperStyle, onMouseEnter: () => {
            setHovered(true);
            setDismissed(false);
        }, onMouseLeave: () => setHovered(false), children: [_jsx("span", { className: "rf-tooltip__trigger", style: triggerStyle, role: "button", tabIndex: 0, "aria-describedby": tipId, "data-term": term, onFocus: () => {
                    setFocused(true);
                    setDismissed(false);
                }, onBlur: () => setFocused(false), onKeyDown: onKeyDown, children: children }), _jsxs("span", { id: tipId, role: "tooltip", className: open ? 'rf-tooltip__bubble' : 'rf-tooltip__bubble rf-sr-only', style: open ? bubbleStyle : undefined, "data-open": open ? 'true' : 'false', "data-status": resolution.status, children: [definition, source !== null ? _jsx("span", { style: open ? sourceStyle : undefined, children: ` Source: ${source}.` }) : null] })] }));
}
//# sourceMappingURL=Tooltip.js.map