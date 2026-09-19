import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { formatDate, formatMoney, formatScore, formatVerdict, titleCase } from '@retrofit/contracts';
import { Badge } from '../components/atoms/Badge.js';
import { Card } from '../components/atoms/Card.js';
/** PRD 7.6: a request is saved as a draft; only a draft can be approved. */
const APPROVABLE_STATUS = 'draft';
function authorityLabel(withinAuthority, underwriter) {
    if (withinAuthority === true)
        return 'Within authority';
    if (withinAuthority === false)
        return 'Needs referral to senior authority';
    return underwriter === null ? 'Not routed' : 'Authority unknown';
}
function RoutingBlock(props) {
    const { routing } = props;
    const label = authorityLabel(routing.withinAuthority, routing.underwriter);
    return (_jsxs("div", { className: "rf-actions__routing", "data-testid": "actions-routing", children: [_jsxs("h3", { className: "rf-card__subtitle", children: ["Routing ", _jsx(Badge, { label: label, tone: routing.withinAuthority === false ? 'attention' : 'quiet' })] }), _jsxs("dl", { className: "rf-stats", children: [_jsxs("div", { className: "rf-stat", "data-testid": "routing-underwriter", children: [_jsx("dt", { children: "Underwriter" }), _jsx("dd", { children: routing.underwriter ?? 'Unassigned' })] }), _jsxs("div", { className: "rf-stat", "data-testid": "routing-region", children: [_jsx("dt", { children: "Region" }), _jsx("dd", { children: routing.region ?? '—' })] }), _jsxs("div", { className: "rf-stat", "data-testid": "routing-authority", children: [_jsx("dt", { children: "Authority limit" }), _jsx("dd", { children: formatMoney(routing.authorityLimit) })] })] }), _jsx("p", { className: "rf-actions__rationale", children: routing.rationale })] }));
}
function DraftCard(props) {
    const { draft, onApprove } = props;
    const [state, setState] = useState({ kind: 'idle' });
    const approvable = draft.status === APPROVABLE_STATUS;
    const pending = state.kind === 'pending';
    const approve = async () => {
        setState({ kind: 'pending' });
        try {
            await onApprove(draft.actionId);
            setState({ kind: 'idle' });
        }
        catch (err) {
            setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
        }
    };
    return (_jsxs("article", { className: "rf-draft", "data-testid": "actions-draft", "data-action-id": draft.actionId, children: [_jsxs("header", { className: "rf-draft__header", children: [_jsx("h4", { className: "rf-draft__subject", children: draft.subject }), _jsx(Badge, { label: titleCase(draft.status), tone: approvable ? 'attention' : 'quiet' })] }), _jsx("p", { className: "rf-draft__body", style: { whiteSpace: 'pre-wrap' }, children: draft.body }), draft.requestedFields.length > 0 ? (_jsxs("table", { className: "rf-table", "aria-label": "Requested fields", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { scope: "col", children: "Field" }), _jsx("th", { scope: "col", children: "Path" }), _jsx("th", { scope: "col", children: "Value of information" })] }) }), _jsx("tbody", { children: draft.requestedFields.map((f) => (_jsxs("tr", { "data-testid": "draft-field", children: [_jsx("th", { scope: "row", children: f.label }), _jsx("td", { children: _jsx("code", { children: f.path }) }), _jsx("td", { children: f.voi === null ? '—' : `${formatScore(f.voi, { decimals: 1 })} pts` })] }, f.path))) })] })) : null, approvable ? (_jsx("button", { type: "button", className: "rf-button", onClick: () => void approve(), disabled: pending, "aria-label": `Approve request: ${draft.subject}`, children: pending ? 'Approving…' : 'Approve and mark sent' })) : null, _jsx("p", { className: "rf-footnote", children: "Nothing is emailed; approving marks the request sent." }), state.kind === 'error' ? (_jsx("p", { role: "alert", className: "rf-error", children: `Approve failed: ${state.message}` })) : null] }));
}
/** Rank 1 is best, so a smaller number is a move up. Presentation only. */
function rankMovement(before, after) {
    if (before === null || after === null)
        return '';
    const delta = before - after;
    if (delta > 0)
        return ` (up ${delta})`;
    if (delta < 0)
        return ` (down ${-delta})`;
    return ' (no change)';
}
function beforeAfter(before, after, hasAfter) {
    return hasAfter ? `${before} → ${after}` : before;
}
function LogTable(props) {
    if (props.log.length === 0) {
        return _jsx("p", { className: "rf-empty", children: "No actions have been logged for this submission." });
    }
    return (_jsxs("table", { className: "rf-table", "aria-label": "Action log", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { scope: "col", children: "When" }), _jsx("th", { scope: "col", children: "Action" }), _jsx("th", { scope: "col", children: "Status" }), _jsx("th", { scope: "col", children: "Score" }), _jsx("th", { scope: "col", children: "Rank" }), _jsx("th", { scope: "col", children: "Verdict" })] }) }), _jsx("tbody", { children: props.log.map((e) => {
                    const hasAfter = e.afterScore !== null || e.afterRank !== null || e.afterVerdict !== null;
                    return (_jsxs("tr", { "data-testid": "action-log-row", children: [_jsx("td", { children: formatDate(e.createdAt) }), _jsx("th", { scope: "row", children: titleCase(e.type) }), _jsx("td", { children: titleCase(e.status) }), _jsx("td", { "data-testid": "log-score", children: beforeAfter(formatScore(e.beforeScore), formatScore(e.afterScore), hasAfter) }), _jsx("td", { "data-testid": "log-rank", children: beforeAfter(formatScore(e.beforeRank), formatScore(e.afterRank), hasAfter) +
                                    rankMovement(e.beforeRank, e.afterRank) }), _jsx("td", { "data-testid": "log-verdict", children: beforeAfter(formatVerdict(e.beforeVerdict), formatVerdict(e.afterVerdict), hasAfter) })] }, e.actionId));
                }) })] }));
}
/**
 * PRD 10 (k) Routing, the drafted request with approve, and the log.
 *
 * Every number comes from the props; nothing is recomputed (PRD 10, 13).
 */
export function Actions(props) {
    const { routing, drafts, log, onApprove, submissionId } = props;
    const openDrafts = drafts.filter((d) => d.status === APPROVABLE_STATUS).length;
    return (_jsx(Card, { title: "Actions", anchorId: "actions", aside: openDrafts > 0 ? _jsx(Badge, { label: `${openDrafts} awaiting approval`, tone: "attention" }) : undefined, children: _jsxs("div", { "data-submission-id": submissionId, children: [_jsx(RoutingBlock, { routing: routing }), _jsx("h3", { className: "rf-card__subtitle", children: "Requests to the broker" }), drafts.length === 0 ? (_jsx("p", { className: "rf-empty", children: "No request is needed for this submission." })) : (drafts.map((d) => _jsx(DraftCard, { draft: d, onApprove: onApprove }, d.actionId))), _jsx("h3", { className: "rf-card__subtitle", children: "Log" }), _jsx(LogTable, { log: log })] }) }));
}
//# sourceMappingURL=Actions.js.map