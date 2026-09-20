import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { formatMoney, formatPercent, formatScore, pluralize } from '@retrofit/contracts';
import { COLORS, cssVar, MIN_TOUCH_TARGET, RADIUS, SPACE, VERDICT_MARKS, VERDICT_STYLES } from '@retrofit/design';
import { ROUTES, submissionPath } from '../App.js';
import { useApi } from '../api/useApi.js';
import { Filters } from '../components/Filters.js';
import { createExploreScene, webglAvailable } from './explore-scene.js';
const EMPTY_FILTER = { line: null, verdict: null, state: null, underwriter: null, search: '' };
function distinct(values) {
    const set = new Set();
    for (const v of values)
        if (typeof v === 'string' && v.trim().length > 0)
            set.add(v);
    return [...set].sort((a, b) => a.localeCompare(b));
}
function matches(row, f) {
    if (f.line !== null && row.lineOfBusiness !== f.line)
        return false;
    if (f.verdict !== null && row.verdict !== f.verdict)
        return false;
    if (f.state !== null && row.primaryState !== f.state)
        return false;
    if (f.underwriter !== null && row.assignedUnderwriter !== f.underwriter)
        return false;
    const q = f.search.trim().toLowerCase();
    if (q.length > 0 && ![row.insuredName, row.submissionId, row.explanationLine].join(' ').toLowerCase().includes(q)) {
        return false;
    }
    return true;
}
const stageStyle = {
    position: 'relative',
    height: 'min(72vh, 760px)',
    minHeight: 420,
    border: `1px solid ${cssVar('mute-tint')}`,
    borderRadius: RADIUS.card,
    overflow: 'hidden',
    background: cssVar('bone'),
};
const tooltipStyle = {
    position: 'absolute',
    pointerEvents: 'none',
    maxWidth: 280,
    padding: `${SPACE.sm}px ${SPACE.md}px`,
    background: cssVar('bone'),
    // A 2px ink edge on the card radius, the same surface the phone kit raises.
    border: `2px solid ${cssVar('ink')}`,
    borderRadius: RADIUS.card,
    fontSize: cssVar('size-micro'),
    lineHeight: 1.45,
    color: cssVar('ink'),
};
const toggleStyle = (active) => ({
    minHeight: MIN_TOUCH_TARGET,
    padding: `0 ${SPACE.lg}px`,
    borderRadius: RADIUS.pill,
    // The phone kit's ChoiceGroup: the chosen one fills with ink, the rest keep
    // a mute edge on bone. The 2px border is the kit's selected weight.
    border: `2px solid ${active ? cssVar('ink') : cssVar('mute')}`,
    background: active ? cssVar('ink') : cssVar('bone'),
    color: active ? cssVar('bone') : cssVar('ink'),
    font: 'inherit',
    cursor: 'pointer',
});
function Swatch({ verdict }) {
    const s = VERDICT_STYLES[verdict];
    return (_jsxs("span", { style: { display: 'inline-flex', alignItems: 'center', gap: SPACE.xs }, children: [_jsx("span", { "aria-hidden": true, style: {
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: s.fill,
                    border: `1.5px solid ${s.border}`,
                } }), VERDICT_MARKS[verdict], " ", s.label] }));
}
function RowTip({ info }) {
    const r = info.row;
    return (_jsxs(_Fragment, { children: [_jsx("strong", { style: { fontFamily: cssVar('font-display'), fontSize: 15 }, children: r.insuredName }), _jsxs("div", { children: [VERDICT_MARKS[r.verdict], " ", VERDICT_STYLES[r.verdict].label, r.synthetic ? ' · synthetic data' : ''] }), _jsxs("div", { children: ["Appetite ", formatScore(r.appetiteScore, { outOf: true })] }), _jsxs("div", { children: ["Premium ", r.quotedPremium === null ? 'none yet' : formatMoney(r.quotedPremium), r.adequacy === null ? '' : ` · adequacy ${formatPercent(r.adequacy)}`] }), _jsxs("div", { children: ["TIV ", r.totalTiv === null ? 'unknown' : formatMoney(r.totalTiv)] }), _jsx("div", { style: { color: cssVar('muted-deep') }, children: [r.primaryState, r.assignedUnderwriter].filter(Boolean).join(' · ') || 'No state or underwriter' }), _jsx("div", { style: { color: cssVar('muted-deep'), marginTop: SPACE.xs }, children: "Click to open" })] }));
}
function HubTip({ info }) {
    return (_jsxs(_Fragment, { children: [_jsx("strong", { children: info.label.replace(/_/g, ' ') }), _jsxs("div", { style: { color: cssVar('muted-deep') }, children: [info.hubKind, " \u00B7 ", pluralize(info.count, 'submission')] }), _jsx("div", { style: { color: cssVar('muted-deep'), marginTop: SPACE.xs }, children: "Click to highlight" })] }));
}
/** /explore: the book in 3D. A scatter of appetite × adequacy × TIV, or a network of who, where and what. */
export function ExplorePage() {
    const queue = useApi((client) => client.getQueue(), []);
    const navigate = useNavigate();
    const titleId = useId();
    const hostRef = useRef(null);
    const sceneRef = useRef(null);
    const [mode, setMode] = useState('scatter');
    const [includeOther, setIncludeOther] = useState(false);
    const [filter, setFilter] = useState(EMPTY_FILTER);
    const [hover, setHover] = useState(null);
    const [glOk] = useState(() => webglAvailable());
    const rows = useMemo(() => queue.data ?? [], [queue.data]);
    const options = useMemo(() => ({
        lines: distinct(rows.map((r) => r.lineOfBusiness)),
        states: distinct(rows.map((r) => r.primaryState)),
        underwriters: distinct(rows.map((r) => r.assignedUnderwriter)),
    }), [rows]);
    const visible = useMemo(() => rows.filter((r) => (includeOther || !r.outOfAppetiteLine) && matches(r, filter)), [rows, includeOther, filter]);
    // Latest navigate for the scene's click handler without rebuilding the scene.
    const openRef = useRef((row) => void navigate(submissionPath(row.submissionId)));
    openRef.current = (row) => void navigate(submissionPath(row.submissionId));
    useEffect(() => {
        const host = hostRef.current;
        if (host === null || !glOk)
            return undefined;
        const scene = createExploreScene(host, { onHover: setHover, onOpen: (row) => openRef.current(row) });
        sceneRef.current = scene;
        return () => {
            scene.dispose();
            sceneRef.current = null;
        };
    }, [glOk]);
    useEffect(() => {
        sceneRef.current?.setData(visible, mode);
    }, [visible, mode]);
    const otherCount = rows.filter((r) => r.outOfAppetiteLine).length;
    return (_jsxs("section", { "aria-labelledby": titleId, children: [_jsx("h1", { id: titleId, children: "Explore" }), _jsx("p", { style: { color: cssVar('muted-deep'), maxWidth: 760 }, children: mode === 'scatter'
                    ? 'Every submission placed by appetite score, pricing adequacy and total insured value. Sphere size is the quoted premium. Drag to orbit, scroll to zoom, click a sphere to open it.'
                    : 'Submissions linked to their underwriter, state, line of business and verdict. Click a hub to light up its submissions; click a sphere to open it.' }), _jsxs("div", { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: SPACE.sm, marginTop: SPACE.md }, children: [_jsxs("div", { role: "group", "aria-label": "View", style: { display: 'flex', gap: SPACE.xs }, children: [_jsx("button", { type: "button", "aria-pressed": mode === 'scatter', style: toggleStyle(mode === 'scatter'), onClick: () => setMode('scatter'), children: "3D scatter" }), _jsx("button", { type: "button", "aria-pressed": mode === 'network', style: toggleStyle(mode === 'network'), onClick: () => setMode('network'), children: "Network" })] }), _jsxs("label", { style: { display: 'inline-flex', alignItems: 'center', gap: SPACE.xs, minHeight: MIN_TOUCH_TARGET, marginLeft: SPACE.md }, children: [_jsx("input", { type: "checkbox", checked: includeOther, onChange: (e) => setIncludeOther(e.target.checked) }), "Include other lines (", otherCount, ")"] }), _jsx("button", { type: "button", style: { ...toggleStyle(false), marginLeft: 'auto' }, onClick: () => sceneRef.current?.resetView(), children: "Reset view" })] }), _jsx(Filters, { value: filter, options: options, onChange: setFilter }), _jsx("p", { role: "status", "aria-live": "polite", style: { margin: `0 0 ${SPACE.sm}px` }, children: queue.loading && queue.data === null
                    ? 'Loading the book…'
                    : queue.error !== null
                        ? `Could not load the queue: ${queue.error.message}`
                        : `Showing ${pluralize(visible.length, 'submission')}` }), glOk ? (_jsx("div", { ref: hostRef, style: stageStyle, "aria-label": "3D view of the submissions. The same rows are listed on the Queue page.", children: hover !== null ? (_jsx("div", { style: {
                        ...tooltipStyle,
                        left: Math.min(hover.x + 16, (hostRef.current?.clientWidth ?? 600) - 290),
                        top: Math.max(hover.y - 12, 8),
                    }, children: hover.kind === 'row' ? _jsx(RowTip, { info: hover }) : _jsx(HubTip, { info: hover }) })) : null })) : (_jsx("div", { role: "alert", style: { ...stageStyle, display: 'grid', placeItems: 'center', padding: SPACE.xl }, children: _jsxs("p", { children: ["This browser has no WebGL, so the 3D view cannot draw. The same data is on the", ' ', _jsx(Link, { to: ROUTES.queue, children: "Queue" }), "."] }) })), _jsxs("div", { style: { display: 'flex', flexWrap: 'wrap', gap: SPACE.lg, marginTop: SPACE.md, fontSize: cssVar('size-micro') }, children: [_jsx(Swatch, { verdict: "FIT" }), _jsx(Swatch, { verdict: "REFER" }), _jsx(Swatch, { verdict: "DOES_NOT_FIT" }), _jsxs("span", { style: { display: 'inline-flex', alignItems: 'center', gap: SPACE.xs }, children: [_jsx("span", { "aria-hidden": true, style: { width: 16, height: 8, borderRadius: 8, border: `2px solid ${COLORS.mutedDeep}` } }), "Ring: synthetic data (no Federato policy)"] }), mode === 'scatter' ? (_jsx("span", { style: { color: cssVar('muted-deep') }, children: "Red frame: 100% adequacy (quoted = predicted)" })) : (_jsx("span", { style: { color: cssVar('muted-deep') }, children: "Octahedrons: underwriter, state, line, verdict hubs" }))] })] }));
}
//# sourceMappingURL=ExplorePage.js.map