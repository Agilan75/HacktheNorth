import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MIN_TOUCH_TARGET, SPACE, cssVar } from '@retrofit/design';
import { resolveBaseUrl } from '../api/useApi.js';
import { Card } from '../components/atoms/Card.js';
import { CitationQuote } from '../components/atoms/CitationQuote.js';
import { VerdictPill } from '../components/atoms/VerdictPill.js';
import { COLOR_BY, FACTOR_COLORS, SURFACE, VERDICT_COLORS, cssColor, factorOf, fieldSide, groupedOrder, isFromSubmission, isOnThreshold, paintField, randomCase, scoreColor, verdictOf, } from './verification-field.js';
/*
 * Every layer A+B case as one pixel, and any one of them worked in full on
 * click. The bytes come from GET /verification/field/:layer; the worked case
 * from GET /verification/cases/:index, which REBUILDS the case from the run's
 * seed and runs the engine, the naive implementation and every invariant on
 * it again. Nothing here decides anything: it draws and formats.
 */
const MUTED = {
    fontSize: cssVar('size-small'),
    lineHeight: cssVar('leading-small'),
    color: cssVar('mutedDeep'),
    margin: 0,
};
const BOX = {
    border: `1px solid ${cssVar('mutedTint')}`,
    borderRadius: cssVar('radius-card'),
    padding: SPACE.lg,
    margin: 0,
};
const ROW = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: SPACE.sm };
const LEGEND_BUTTON = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: SPACE.sm,
    minHeight: MIN_TOUCH_TARGET,
    font: 'inherit',
    fontSize: cssVar('size-small'),
    textAlign: 'left',
};
const TABLE = { width: '100%', borderCollapse: 'collapse', fontSize: cssVar('size-small') };
const CELL = {
    padding: `${SPACE.xs}px ${SPACE.sm}px`,
    borderBottom: `1px solid ${cssVar('mutedTint')}`,
    textAlign: 'left',
    verticalAlign: 'top',
};
const COLOR_BY_LABEL = {
    verdict: 'Verdict',
    factor: 'Deciding factor',
    score: 'Appetite score',
};
const MAX_CELL_PX = 28;
function count(n) {
    return n.toLocaleString('en-US');
}
function share(n, total) {
    if (total === 0)
        return '0%';
    const pct = (n / total) * 100;
    return `${pct >= 10 ? pct.toFixed(0) : pct >= 1 ? pct.toFixed(1) : pct.toFixed(2)}%`;
}
function humanize(id) {
    const text = id.replace(/[_-]+/g, ' ').trim().replace(/\btiv\b/gi, 'TIV');
    return text.length === 0 ? id : `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
function sum(row) {
    return (row ?? []).reduce((a, b) => a + b, 0);
}
function Swatch(props) {
    return (_jsx("span", { "aria-hidden": "true", style: { width: 12, height: 12, borderRadius: 3, background: props.color, flex: '0 0 auto', border: `1px solid ${cssVar('mutedTint')}` } }));
}
/* -------------------------------------------------------------------------- */
/* Loading                                                                     */
/* -------------------------------------------------------------------------- */
async function fetchBytes(layer, signal) {
    const res = await fetch(`${resolveBaseUrl()}/verification/field/${layer}`, { signal });
    if (!res.ok)
        throw new Error(`field layer ${layer}: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
}
async function fetchJson(path, signal) {
    const res = await fetch(`${resolveBaseUrl()}${path}`, { headers: { accept: 'application/json' }, ...(signal ? { signal } : {}) });
    if (!res.ok)
        throw new Error(`${path}: HTTP ${res.status}`);
    return (await res.json());
}
/* -------------------------------------------------------------------------- */
/* The worked case                                                             */
/* -------------------------------------------------------------------------- */
function factValue(v) {
    if (v === null)
        return 'missing';
    if (typeof v === 'number')
        return Number.isInteger(v) ? count(v) : String(Number(v.toFixed(6)));
    return String(v);
}
const POSITION_WORDS = {
    at: 'placed exactly on the threshold',
    under: 'placed just under a threshold',
    over: 'placed just over a threshold',
    far_under: 'placed far under a threshold',
    far_over: 'placed far over a threshold',
};
function Side(props) {
    const { side } = props;
    return (_jsxs("div", { style: { ...BOX, flex: '1 1 260px' }, children: [_jsx("strong", { style: { display: 'block' }, children: props.title }), _jsx("p", { style: MUTED, children: props.gloss }), _jsx("div", { style: { marginTop: SPACE.sm }, children: _jsx(VerdictPill, { verdict: side.verdict }) }), _jsxs("dl", { style: { ...MUTED, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: `${SPACE.xs}px ${SPACE.md}px`, marginTop: SPACE.sm }, children: [_jsx("dt", { children: "Appetite score" }), _jsx("dd", { style: { margin: 0 }, children: side.appetiteScore.toFixed(2) }), _jsx("dt", { children: "Completeness" }), _jsx("dd", { style: { margin: 0 }, children: side.completeness.toFixed(0) }), _jsx("dt", { children: "Decided by" }), _jsx("dd", { style: { margin: 0 }, children: side.decidingFactorId === null ? 'no single factor' : humanize(side.decidingFactorId) }), _jsx("dt", { children: "Knockouts" }), _jsx("dd", { style: { margin: 0 }, children: side.knockoutFactorIds.length === 0 ? 'none' : side.knockoutFactorIds.map(humanize).join(', ') })] })] }));
}
function WorkedCase(props) {
    const c = props.data;
    const violated = c.invariants.filter((i) => i.violations.length > 0);
    const rule = c.engine.decidingRule;
    return (_jsxs("div", { "data-testid": "worked-case", style: { display: 'flex', flexDirection: 'column', gap: SPACE.lg }, children: [_jsxs("div", { style: ROW, children: [_jsx("h3", { style: { margin: 0 }, children: `Case ${count(c.index)}` }), _jsx(VerdictPill, { verdict: c.engine.verdict }), _jsxs("span", { style: MUTED, children: [`${c.caseId} · ${c.fromSubmission ? 'rolled up from a generated multi-building submission' : 'generated directly as rolled-up facts'}`, c.stratum !== null ? ` · ${humanize(c.stratum)}` : ''] })] }), _jsxs("div", { children: [_jsx("strong", { children: "1. What was generated" }), _jsx("p", { style: MUTED, children: `Rebuilt just now from seed ${c.seed} and index ${count(c.index)}. The same two numbers always give the same case.` }), _jsx("table", { style: { ...TABLE, marginTop: SPACE.sm }, children: _jsx("tbody", { children: Object.entries(c.input).map(([key, value]) => (_jsxs("tr", { children: [_jsx("th", { scope: "row", style: { ...CELL, fontWeight: 400 }, children: humanize(key.replace(/([A-Z0-9]+)/g, ' $1')) }), _jsx("td", { style: CELL, children: factValue(value) }), _jsx("td", { style: { ...CELL, ...MUTED }, children: POSITION_WORDS[c.boundaries[key] ?? ''] ?? '' })] }, key))) }) }), c.buildings !== null ? (_jsxs("details", { style: { marginTop: SPACE.sm }, children: [_jsx("summary", { style: { cursor: 'pointer', minHeight: MIN_TOUCH_TARGET }, children: `The ${c.buildings.length} buildings these facts were rolled up from` }), _jsxs("table", { style: TABLE, children: [_jsx("thead", { children: _jsx("tr", { children: ['State', 'Year built', 'Construction', 'TIV'].map((h) => (_jsx("th", { scope: "col", style: CELL, children: h }, h))) }) }), _jsx("tbody", { children: c.buildings.map((b) => (_jsxs("tr", { children: [_jsx("td", { style: CELL, children: b.state ?? 'missing' }), _jsx("td", { style: CELL, children: b.yearBuilt ?? 'missing' }), _jsx("td", { style: CELL, children: b.constructionType ?? 'missing' }), _jsx("td", { style: CELL, children: b.tiv === null ? 'missing' : `$${count(b.tiv)}` })] }, b.id))) })] })] })) : null] }), _jsxs("div", { children: [_jsx("strong", { children: "2. How the engine scored it" }), _jsx("p", { style: MUTED, children: "Each factor lands in a guideline tier; points are weight \u00D7 tier value \u00D7 100. The last column is the naive implementation's tier value for the same factor." }), _jsx("div", { style: { overflowX: 'auto', marginTop: SPACE.sm }, children: _jsxs("table", { style: TABLE, children: [_jsx("thead", { children: _jsx("tr", { children: ['Factor', 'Tier', 'Weight', 'Points', 'Guideline text', 'Naive'].map((h) => (_jsx("th", { scope: "col", style: CELL, children: h }, h))) }) }), _jsx("tbody", { children: c.factors.map((f) => (_jsxs("tr", { style: f.factor === c.engine.decidingFactorId ? { background: cssVar('redTint') } : undefined, children: [_jsxs("th", { scope: "row", style: { ...CELL, fontWeight: f.factor === c.engine.decidingFactorId ? 700 : 400 }, children: [humanize(f.factor), f.factor === c.engine.decidingFactorId ? ' (decided)' : ''] }), _jsx("td", { style: CELL, children: f.tier === null ? 'missing' : `${humanize(f.tier)}${f.knockout ? ', knockout' : f.refer ? ', refer' : ''}` }), _jsx("td", { style: CELL, children: f.weight }), _jsx("td", { style: CELL, children: f.points.toFixed(1) }), _jsx("td", { style: CELL, children: f.citation === null ? '' : `“${f.citation.quote}” (${f.citation.section})` }), _jsxs("td", { style: CELL, children: [f.naiveTierValue === null ? 'missing' : f.naiveTierValue, f.naiveTierValue === f.tierValue ? ' ✓' : ' ✗'] })] }, f.factor))) })] }) })] }), _jsxs("div", { children: [_jsx("strong", { children: "3. The rule that decided it" }), rule === null ? (_jsx("p", { style: MUTED, children: "No single rule decided this case." })) : (_jsxs("div", { style: { marginTop: SPACE.sm }, children: [_jsx(CitationQuote, { citation: { document: rule.citation.doc, row: rule.citation.section, quote: rule.citation.quote } }), _jsx("p", { style: MUTED, children: `Rule ${rule.ruleId}: ${humanize(rule.factor)} is ${humanize(rule.tier).toLowerCase()}.` })] })), _jsx("ol", { style: { margin: `${SPACE.sm}px 0 0`, paddingLeft: SPACE.xl }, children: c.engine.reasons.map((r) => (_jsx("li", { children: r }, r))) })] }), _jsxs("div", { children: [_jsx("strong", { children: `4. Two implementations, ${c.agreed ? 'one answer' : 'DIFFERENT answers'}` }), _jsxs("div", { style: { ...ROW, alignItems: 'stretch', marginTop: SPACE.sm }, children: [_jsx(Side, { title: "Engine", gloss: "The product's own pipeline.", side: c.engine }), _jsx(Side, { title: "Naive implementation", gloss: "Written from the guideline PDF by an agent that never saw the engine.", side: c.naive })] }), c.disagreements.length > 0 ? (_jsx("ul", { role: "alert", children: c.disagreements.map((d) => (_jsx("li", { children: `${d.field}: engine ${JSON.stringify(d.engine)}, naive ${JSON.stringify(d.naive)}` }, d.field))) })) : null] }), _jsxs("div", { children: [_jsx("strong", { children: `5. ${c.invariants.length} invariants checked, ${violated.length} violated` }), _jsxs("details", { style: { marginTop: SPACE.xs }, children: [_jsx("summary", { style: { cursor: 'pointer', minHeight: MIN_TOUCH_TARGET }, children: "Every law this case was held to" }), _jsx("ul", { style: { ...MUTED, columns: '2 260px', paddingLeft: SPACE.lg }, children: c.invariants.map((i) => (_jsxs("li", { children: [`${i.violations.length === 0 ? '✓' : '✗'} ${i.suite}: ${humanize(i.name.replace(/([A-Z])/g, ' $1'))}`, i.violations.map((v) => (_jsx("div", { children: v }, v)))] }, `${i.suite}.${i.name}`))) })] })] })] }));
}
function clampView(v, side, size) {
    const fit = size / side;
    const scale = Math.max(fit, Math.min(MAX_CELL_PX, v.scale));
    const span = size / scale;
    return {
        scale,
        x: Math.max(0, Math.min(side - span, v.x)),
        y: Math.max(0, Math.min(side - span, v.y)),
    };
}
export function VerificationField() {
    const [summary, setSummary] = useState(null);
    const [absent, setAbsent] = useState(false);
    const [layers, setLayers] = useState(null);
    const [loading, setLoading] = useState(null);
    const [error, setError] = useState(null);
    const [colorBy, setColorBy] = useState('factor');
    const [grouped, setGrouped] = useState(true);
    const [highlight, setHighlight] = useState({ kind: 'none' });
    const [size, setSize] = useState(720);
    const [view, setView] = useState({ scale: 0, x: 0, y: 0 });
    const [hover, setHover] = useState(null);
    const [selected, setSelected] = useState(null);
    const [worked, setWorked] = useState(null);
    const [workedError, setWorkedError] = useState(null);
    const wrapRef = useRef(null);
    const canvasRef = useRef(null);
    const fieldRef = useRef(null);
    const orderRef = useRef(null);
    const inverseRef = useRef(null);
    const drag = useRef(null);
    const [painted, setPainted] = useState(0);
    const total = summary?.total ?? 0;
    const side = fieldSide(total);
    useEffect(() => {
        const abort = new AbortController();
        fetchJson('/verification/field', abort.signal).then(setSummary, () => {
            if (!abort.signal.aborted)
                setAbsent(true);
        });
        return () => abort.abort();
    }, []);
    const load = useCallback(async (want) => {
        const abort = new AbortController();
        setError(null);
        try {
            let next = layers ?? { cases: new Uint8Array(0), scores: null, strata: null };
            for (const layer of want) {
                if (layer !== 'cases' && next[layer] !== null)
                    continue;
                if (layer === 'cases' && next.cases.length > 0)
                    continue;
                setLoading(layer);
                const bytes = await fetchBytes(layer, abort.signal);
                next = { ...next, [layer]: bytes };
            }
            setLayers(next);
            return true;
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            return false;
        }
        finally {
            setLoading(null);
        }
    }, [layers]);
    /* Size the canvas to its column. */
    useEffect(() => {
        const el = wrapRef.current;
        if (el === null || typeof ResizeObserver === 'undefined')
            return;
        const ro = new ResizeObserver(() => setSize(Math.max(280, Math.min(900, Math.floor(el.clientWidth)))));
        ro.observe(el);
        return () => ro.disconnect();
    }, [layers !== null]);
    /* Paint all the cases into the offscreen field whenever the encoding changes. */
    useEffect(() => {
        if (layers === null || layers.cases.length === 0)
            return;
        if (colorBy === 'score' && layers.scores === null)
            return;
        const field = fieldRef.current ?? document.createElement('canvas');
        fieldRef.current = field;
        field.width = side;
        field.height = side;
        const ctx = field.getContext('2d');
        if (ctx === null)
            return;
        const order = grouped ? groupedOrder(layers, colorBy) : null;
        orderRef.current = order;
        if (order === null)
            inverseRef.current = null;
        else {
            const inverse = new Uint32Array(order.length);
            for (let p = 0; p < order.length; p++)
                inverse[order[p]] = p;
            inverseRef.current = inverse;
        }
        const image = ctx.createImageData(side, side);
        paintField(new Uint32Array(image.data.buffer), layers, order, colorBy, highlight);
        ctx.putImageData(image, 0, 0);
        setPainted((n) => n + 1);
    }, [layers, colorBy, grouped, highlight, side]);
    const shown = useMemo(() => clampView(view, side, size), [view, side, size]);
    /* Draw the visible window of the field. */
    useEffect(() => {
        const canvas = canvasRef.current;
        const field = fieldRef.current;
        if (canvas === null || field === null || painted === 0)
            return;
        const dpr = typeof window === 'undefined' ? 1 : Math.min(2, window.devicePixelRatio || 1);
        canvas.width = size * dpr;
        canvas.height = size * dpr;
        const ctx = canvas.getContext('2d');
        if (ctx === null)
            return;
        ctx.fillStyle = SURFACE;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = shown.scale * dpr < 1;
        const span = size / shown.scale;
        ctx.drawImage(field, shown.x, shown.y, span, span, 0, 0, canvas.width, canvas.height);
        if (selected !== null) {
            const p = inverseRef.current === null ? selected : inverseRef.current[selected];
            const cx = ((p % side) + 0.5 - shown.x) * shown.scale * dpr;
            const cy = (Math.floor(p / side) + 0.5 - shown.y) * shown.scale * dpr;
            const r = Math.max(7, shown.scale * 0.9) * dpr;
            ctx.lineWidth = 2 * dpr;
            ctx.strokeStyle = SURFACE;
            ctx.beginPath();
            ctx.arc(cx, cy, r + 2 * dpr, 0, Math.PI * 2);
            ctx.stroke();
            ctx.strokeStyle = '#2C6E9E';
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.stroke();
        }
    }, [painted, shown, size, selected, side]);
    const caseAtPoint = useCallback((left, top) => {
        const fx = Math.floor(shown.x + left / shown.scale);
        const fy = Math.floor(shown.y + top / shown.scale);
        if (fx < 0 || fy < 0 || fx >= side || fy >= side)
            return null;
        const p = fy * side + fx;
        if (p >= total)
            return null;
        return orderRef.current === null ? p : orderRef.current[p];
    }, [shown, side, total]);
    const zoomAt = useCallback((factor, left, top) => {
        setView((prev) => {
            const cur = clampView(prev, side, size);
            const fx = cur.x + left / cur.scale;
            const fy = cur.y + top / cur.scale;
            const scale = Math.max(size / side, Math.min(MAX_CELL_PX, cur.scale * factor));
            return clampView({ scale, x: fx - left / scale, y: fy - top / scale }, side, size);
        });
    }, [side, size]);
    /* Wheel zoom needs a non-passive listener to stop the page scrolling. */
    useEffect(() => {
        const canvas = canvasRef.current;
        if (canvas === null)
            return;
        const onWheel = (e) => {
            /* Plain scrolling must still move the page past a canvas this tall; a pinch arrives with ctrlKey set. */
            if (!e.ctrlKey && !e.metaKey)
                return;
            e.preventDefault();
            const rect = canvas.getBoundingClientRect();
            zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - rect.left, e.clientY - rect.top);
        };
        canvas.addEventListener('wheel', onWheel, { passive: false });
        return () => canvas.removeEventListener('wheel', onWheel);
    }, [zoomAt, painted > 0]);
    const open = useCallback((index) => {
        setSelected(index);
        setWorked(null);
        setWorkedError(null);
        fetchJson(`/verification/cases/${index}`).then(setWorked, (err) => setWorkedError(err instanceof Error ? err.message : String(err)));
    }, []);
    /** Centre the view on a case, zooming in far enough to see it as a cell. */
    const reveal = useCallback((index) => {
        const p = inverseRef.current === null ? index : inverseRef.current[index];
        setView((prev) => {
            const cur = clampView(prev, side, size);
            const scale = Math.max(cur.scale, 6);
            const span = size / scale;
            return clampView({ scale, x: (p % side) - span / 2, y: Math.floor(p / side) - span / 2 }, side, size);
        });
        open(index);
    }, [open, side, size]);
    const pick = useCallback((test) => {
        const i = randomCase(total, test);
        if (i !== null)
            reveal(i);
    }, [reveal, total]);
    const onPointerDown = (e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { px: e.clientX, py: e.clientY, view: shown, moved: false };
    };
    const onPointerMove = (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const left = e.clientX - rect.left;
        const top = e.clientY - rect.top;
        const d = drag.current;
        if (d !== null) {
            const dx = e.clientX - d.px;
            const dy = e.clientY - d.py;
            if (Math.abs(dx) + Math.abs(dy) > 4)
                d.moved = true;
            if (d.moved) {
                setHover(null);
                setView(clampView({ scale: d.view.scale, x: d.view.x - dx / d.view.scale, y: d.view.y - dy / d.view.scale }, side, size));
                return;
            }
        }
        const index = caseAtPoint(left, top);
        setHover(index === null ? null : { index, left, top });
    };
    const onPointerUp = (e) => {
        const d = drag.current;
        drag.current = null;
        if (d === null || d.moved)
            return;
        const rect = e.currentTarget.getBoundingClientRect();
        const index = caseAtPoint(e.clientX - rect.left, e.clientY - rect.top);
        if (index !== null)
            open(index);
    };
    if (absent)
        return null;
    if (summary === null)
        return null;
    const cases = layers?.cases ?? null;
    const ready = cases !== null && cases.length > 0;
    const zoomed = shown.scale > (size / side) * 1.01;
    const perPixel = Math.max(1, Math.round(1 / (shown.scale * shown.scale)));
    const legend = colorBy === 'verdict'
        ? summary.verdicts.map((v, k) => ({
            label: humanize(v),
            color: VERDICT_COLORS[k] ?? '#000',
            n: summary.byVerdict[k] ?? 0,
            test: (i) => cases !== null && verdictOf(cases[i]) === k,
        }))
        : colorBy === 'factor'
            ? ['No single factor', ...summary.factors.map(humanize)].map((label, k) => ({
                label,
                color: FACTOR_COLORS[k] ?? '#000',
                n: sum(summary.byFactor[k]),
                test: (i) => cases !== null && factorOf(cases[i]) === k,
            }))
            : [];
    const hoverByte = hover !== null && cases !== null ? cases[hover.index] : null;
    return (_jsxs(Card, { title: "Every case, one pixel each", anchorId: "v-field", aside: `${count(total)} cases · seed ${summary.seed}`, children: [_jsx("p", { style: { ...MUTED, maxWidth: '72ch' }, children: `Each pixel is one generated case from the layer A+B run, coloured by the factor that decided it, the verdict, or the score. All ${count(total)} passed every invariant and matched the naive implementation, so there is no failure colour to find. Click any pixel and the case is rebuilt from the seed and worked in full: the facts, every factor's tier, the guideline text that decided it, and both implementations side by side.` }), !ready ? (_jsxs("div", { style: { ...ROW, marginTop: SPACE.md }, children: [_jsx("button", { type: "button", "data-testid": "field-load", disabled: loading !== null, onClick: () => void load(['cases']), children: loading !== null ? 'Loading 10 MB…' : `Draw all ${count(total)} cases` }), _jsx("span", { style: MUTED, children: "One byte per case, about 10 MB." }), error !== null ? _jsx("span", { role: "alert", children: error }) : null] })) : (_jsxs(_Fragment, { children: [_jsxs("div", { style: { ...ROW, marginTop: SPACE.md }, role: "group", "aria-label": "Field controls", children: [_jsx("span", { style: MUTED, children: "Colour by" }), COLOR_BY.map((mode) => (_jsx("button", { type: "button", "aria-pressed": colorBy === mode, disabled: loading !== null, onClick: () => {
                                    if (mode === 'score' && layers?.scores === null)
                                        void load(['scores']).then((ok) => ok && setColorBy(mode));
                                    else
                                        setColorBy(mode);
                                }, children: COLOR_BY_LABEL[mode] }, mode))), _jsx("span", { style: { ...MUTED, marginLeft: SPACE.md }, children: "Arrange" }), _jsx("button", { type: "button", "aria-pressed": grouped, onClick: () => setGrouped(true), children: "Like with like" }), _jsx("button", { type: "button", "aria-pressed": !grouped, onClick: () => setGrouped(false), children: "Run order" }), loading !== null ? _jsx("span", { style: MUTED, children: `Loading ${loading}…` }) : null, error !== null ? _jsx("span", { role: "alert", children: error }) : null] }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: SPACE.lg, marginTop: SPACE.md }, children: [_jsxs("div", { ref: wrapRef, style: { position: 'relative', minWidth: 0 }, children: [_jsx("canvas", { ref: canvasRef, "data-testid": "field-canvas", role: "img", "aria-label": `${count(total)} verification cases, one pixel each, coloured by ${COLOR_BY_LABEL[colorBy].toLowerCase()}. The legend beside it gives the counts.`, style: { width: size, height: size, display: 'block', cursor: 'crosshair', touchAction: 'none', borderRadius: cssVar('radius-card'), border: `1px solid ${cssVar('mutedTint')}` }, onPointerDown: onPointerDown, onPointerMove: onPointerMove, onPointerUp: onPointerUp, onPointerLeave: () => setHover(null) }), hover !== null && hoverByte !== null ? (_jsxs("div", { role: "status", style: {
                                            position: 'absolute',
                                            left: Math.min(size - 230, hover.left + 14),
                                            top: Math.max(0, hover.top - 64),
                                            width: 216,
                                            pointerEvents: 'none',
                                            background: cssVar('paper'),
                                            border: `1px solid ${cssVar('muted')}`,
                                            borderRadius: 6,
                                            padding: SPACE.sm,
                                            fontSize: cssVar('size-small'),
                                        }, children: [_jsx("strong", { children: `Case ${count(hover.index)}` }), _jsx("div", { children: humanize(summary.verdicts[verdictOf(hoverByte)] ?? '') }), _jsxs("div", { style: MUTED, children: [factorOf(hoverByte) === 0 ? 'No single deciding factor' : `Decided by ${humanize(summary.factors[factorOf(hoverByte) - 1] ?? '').toLowerCase()}`, layers?.scores ? ` · score ${layers.scores[hover.index]}` : ''] }), _jsx("div", { style: MUTED, children: [isOnThreshold(hoverByte) ? 'on a threshold' : null, isFromSubmission(hoverByte) ? 'full submission' : null].filter(Boolean).join(' · ') }), perPixel > 1 ? _jsx("div", { style: MUTED, children: `~${perPixel} cases under this pixel; zoom in to separate them` }) : null] })) : null, _jsxs("div", { style: { ...ROW, marginTop: SPACE.sm }, children: [_jsx("button", { type: "button", "aria-label": "Zoom in", onClick: () => zoomAt(2, size / 2, size / 2), children: "+" }), _jsx("button", { type: "button", "aria-label": "Zoom out", disabled: !zoomed, onClick: () => zoomAt(0.5, size / 2, size / 2), children: "\u2212" }), _jsx("button", { type: "button", disabled: !zoomed, onClick: () => setView({ scale: 0, x: 0, y: 0 }), children: "Show all" }), _jsx("button", { type: "button", "data-testid": "field-random", onClick: () => pick(() => true), children: "Open a random case" }), _jsx("span", { style: MUTED, children: "Pinch or \u2318-scroll to zoom, drag to pan, click to open." })] })] }), _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: SPACE.md, minWidth: 0 }, children: [_jsxs("div", { children: [_jsx("strong", { style: { fontSize: cssVar('size-small') }, children: COLOR_BY_LABEL[colorBy] }), colorBy === 'score' ? (_jsxs("div", { children: [_jsx("div", { "aria-hidden": "true", style: { height: 12, borderRadius: 3, marginTop: SPACE.xs, background: `linear-gradient(to right, ${cssColor(scoreColor(0))}, ${cssColor(scoreColor(100))})` } }), _jsxs("div", { style: { ...MUTED, display: 'flex', justifyContent: 'space-between' }, children: [_jsx("span", { children: "0" }), _jsx("span", { children: "appetite score" }), _jsx("span", { children: "100" })] })] })) : (_jsx("ul", { style: { listStyle: 'none', margin: 0, padding: 0 }, children: legend.map((g) => (_jsx("li", { children: _jsxs("button", { type: "button", style: LEGEND_BUTTON, disabled: g.n === 0, title: "Open a random case of this kind", onClick: () => pick(g.test), children: [_jsx(Swatch, { color: g.color }), _jsx("span", { children: g.label }), _jsx("span", { style: MUTED, children: `${count(g.n)} · ${share(g.n, total)}` })] }) }, g.label))) }))] }), _jsxs("div", { children: [_jsx("strong", { style: { fontSize: cssVar('size-small') }, children: "Pick out" }), _jsxs("div", { style: { ...ROW, marginTop: SPACE.xs }, children: [_jsx("button", { type: "button", "aria-pressed": highlight.kind === 'none', onClick: () => setHighlight({ kind: 'none' }), children: "Everything" }), _jsx("button", { type: "button", "aria-pressed": highlight.kind === 'threshold', onClick: () => setHighlight({ kind: 'threshold' }), children: `On a threshold (${share(summary.onThreshold, total)})` }), _jsx("button", { type: "button", "aria-pressed": highlight.kind === 'submission', onClick: () => setHighlight({ kind: 'submission' }), children: `Full submissions (${share(summary.fromSubmission, total)})` })] }), _jsxs("label", { style: { ...MUTED, display: 'block', marginTop: SPACE.sm }, children: ["A hard-case family", _jsxs("select", { style: { display: 'block', width: '100%', minHeight: MIN_TOUCH_TARGET, marginTop: SPACE.xs }, value: highlight.kind === 'stratum' ? String(highlight.index) : '', onChange: (e) => {
                                                            const index = Number(e.target.value);
                                                            if (e.target.value === '')
                                                                setHighlight({ kind: 'none' });
                                                            else
                                                                void load(['strata']).then((ok) => ok && setHighlight({ kind: 'stratum', index }));
                                                        }, children: [_jsx("option", { value: "", children: "None" }), summary.strata.map((s, k) => (_jsx("option", { value: k + 1, children: `${humanize(s.key)} (${count(sum(summary.byStratum[k + 1]))})` }, s.key)))] })] }), highlight.kind === 'stratum' ? (_jsxs("p", { style: { ...MUTED, marginTop: SPACE.xs }, children: [summary.strata[highlight.index - 1]?.description, ' ', _jsx("button", { type: "button", style: LEGEND_BUTTON, onClick: () => pick((i) => layers?.strata?.[i] === highlight.index), children: "Open one" })] })) : null] })] })] }), _jsx("div", { style: { ...BOX, marginTop: SPACE.lg }, "aria-live": "polite", children: selected === null ? (_jsx("p", { style: MUTED, children: "No case open. Click a pixel, a legend row, or \u201COpen a random case\u201D." })) : workedError !== null ? (_jsx("p", { role: "alert", style: { margin: 0 }, children: `Could not rebuild case ${count(selected)}: ${workedError}` })) : worked === null || worked.index !== selected ? (_jsx("p", { style: MUTED, children: `Rebuilding case ${count(selected)} from the seed…` })) : (_jsx(WorkedCase, { data: worked })) })] }))] }));
}
//# sourceMappingURL=VerificationField.js.map