import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { formatPercent, pluralize, titleCase } from '@retrofit/contracts';
import { Badge } from '../components/atoms/Badge.js';
import { Card } from '../components/atoms/Card.js';
/** Mirrors `MIN_COVERAGE_PCT` in packages/engine/src/constants.ts (PRD 11: Finish at ≥ 75%). Label only. */
const MIN_COVERAGE_PCT = 75;
/** Mirrors the SweepDto contract: observations under 0.6 wait for the user to confirm. Label only. */
const CONFIRM_BELOW = 0.6;
function formatBearing(bearing) {
    if (bearing === null || !Number.isFinite(bearing))
        return '—';
    return `${Math.round(bearing)}°`;
}
/**
 * PRD 10 (l) Attached photo or sweep, if any.
 */
export function AttachedSweep(props) {
    const { sweep } = props;
    if (sweep === null) {
        return (_jsx(Card, { title: "Attached sweep", anchorId: "sweep", children: _jsx("p", { className: "rf-empty", children: "No photo or sweep is attached to this submission." }) }));
    }
    const sufficient = sweep.coverage >= MIN_COVERAGE_PCT;
    return (_jsxs(Card, { title: "Attached sweep", anchorId: "sweep", aside: _jsx(Badge, { label: titleCase(sweep.stage), tone: sweep.stage === 'failed' ? 'attention' : 'quiet' }), children: [_jsxs("dl", { className: "rf-stats", children: [_jsxs("div", { className: "rf-stat", "data-testid": "sweep-room", children: [_jsx("dt", { children: "Room" }), _jsx("dd", { children: sweep.roomLabel ?? 'Unlabelled' })] }), _jsxs("div", { className: "rf-stat", "data-testid": "sweep-coverage", children: [_jsx("dt", { children: "Coverage" }), _jsxs("dd", { children: [formatPercent(sweep.coverage, { from: 'percent' }), ' ', _jsx(Badge, { label: sufficient ? 'Sufficient' : `Below ${MIN_COVERAGE_PCT}%`, tone: sufficient ? 'quiet' : 'attention' })] })] }), _jsxs("div", { className: "rf-stat", "data-testid": "sweep-frames", children: [_jsx("dt", { children: "Frames" }), _jsx("dd", { children: pluralize(sweep.frameCount, 'frame') })] })] }), sweep.observations.length === 0 ? (_jsx("p", { className: "rf-empty", children: "Nothing was observed in this sweep." })) : (_jsxs("table", { className: "rf-table", "aria-label": "Observations", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { scope: "col", children: "Observed" }), _jsx("th", { scope: "col", children: "Bearing" }), _jsx("th", { scope: "col", children: "Confidence" }), _jsx("th", { scope: "col", children: "Note" })] }) }), _jsx("tbody", { children: sweep.observations.map((o) => (_jsxs("tr", { "data-testid": "sweep-observation", children: [_jsx("th", { scope: "row", children: o.label }), _jsx("td", { children: formatBearing(o.bearing) }), _jsxs("td", { children: [formatPercent(o.confidence), o.confidence < CONFIRM_BELOW ? (_jsxs(_Fragment, { children: [' ', _jsx(Badge, { label: "Needs confirmation", tone: "attention" })] })) : null] }), _jsx("td", { children: o.note ?? '—' })] }, o.id))) })] })), _jsx("p", { className: "rf-footnote", children: `Sweep ${sweep.sweepId}` })] }));
}
//# sourceMappingURL=AttachedSweep.js.map