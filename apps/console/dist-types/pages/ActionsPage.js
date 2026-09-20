import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { EM_DASH, formatDate, formatScore, pluralize, titleCase } from '@retrofit/contracts';
import { cssVar, MIN_TOUCH_TARGET, RADIUS, SPACE } from '@retrofit/design';
import { submissionPath } from '../routes.js';
import { useApi, useApiClient } from '../api/useApi.js';
import { Badge } from '../components/atoms/Badge.js';
import { VerdictPill } from '../components/atoms/VerdictPill.js';
import { DataTable } from '../components/DataTable.js';
/**
 * The action stages. Routes, re-scores and log rows that are simply applied
 * appear under "All" only, so "Replied" never counts an action no broker
 * answered.
 */
const STAGES = {
    all: { label: 'All', match: () => true },
    awaiting: { label: 'Awaiting approval', match: (e) => e.status === 'draft' },
    sent: {
        label: 'Sent',
        match: (e) => e.status === 'approved' || e.status === 'sent',
    },
    replied: {
        label: 'Replied',
        match: (e) => e.status === 'replied' || (e.type === 'reply' && e.status !== 'failed'),
    },
    failed: { label: 'Failed', match: (e) => e.status === 'failed' },
};
const STAGE_ORDER = ['all', 'awaiting', 'sent', 'replied', 'failed'];
const DEFAULT_STAGE = 'all';
/** Stage and the movement disclosure live in the query string. */
const PARAM = { stage: 'stage', moves: 'moves' };
/** How many rank movements show before the disclosure. */
const MOVEMENT_CAP = 8;
function isStage(value) {
    return value !== null && Object.prototype.hasOwnProperty.call(STAGES, value);
}
function inStage(entry, stage) {
    return STAGES[stage].match(entry);
}
/** Only a drafted broker request is approved by the underwriter. */
function isApprovable(entry) {
    return entry.type === 'request' && entry.status === 'draft';
}
/** Newest first; ISO timestamps compare lexically. Id breaks ties deterministically. */
function newestFirst(a, b) {
    if (a.createdAt !== b.createdAt)
        return a.createdAt < b.createdAt ? 1 : -1;
    return a.actionId < b.actionId ? -1 : a.actionId > b.actionId ? 1 : 0;
}
/**
 * Positions moved up the queue. Rank 1 is best, so moving from #7 to #3 is +4.
 * Display arithmetic only: both ranks come from the API.
 */
function rankDelta(entry) {
    if (entry.beforeRank === null || entry.afterRank === null)
        return null;
    return entry.beforeRank - entry.afterRank;
}
function movementText(entry) {
    const delta = rankDelta(entry);
    if (delta === null) {
        if (entry.beforeRank !== null)
            return `#${entry.beforeRank} → ${EM_DASH}`;
        if (entry.afterRank !== null)
            return `${EM_DASH} → #${entry.afterRank}`;
        return EM_DASH;
    }
    const change = delta > 0 ? `up ${pluralize(delta, 'place')}` : delta < 0 ? `down ${pluralize(-delta, 'place')}` : 'no change';
    return `#${entry.beforeRank} → #${entry.afterRank} (${change})`;
}
function scoreText(entry) {
    if (entry.beforeScore === null && entry.afterScore === null)
        return EM_DASH;
    if (entry.afterScore === null)
        return formatScore(entry.beforeScore);
    return `${formatScore(entry.beforeScore)} → ${formatScore(entry.afterScore)}`;
}
function verdictCell(entry) {
    const { beforeVerdict, afterVerdict } = entry;
    if (beforeVerdict === null && afterVerdict === null)
        return EM_DASH;
    if (afterVerdict === null || afterVerdict === beforeVerdict) {
        return _jsx(VerdictPill, { verdict: (beforeVerdict ?? afterVerdict) });
    }
    return (_jsxs("span", { className: "actions-verdict-change", children: [beforeVerdict === null ? EM_DASH : _jsx(VerdictPill, { verdict: beforeVerdict }), ' → ', _jsx(VerdictPill, { verdict: afterVerdict })] }));
}
/* ---------------------------------------------------------------- styles */
const headerRowStyle = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: SPACE.md,
};
const asideNoteStyle = {
    color: cssVar('muted-deep'),
    fontSize: cssVar('size-micro'),
    lineHeight: cssVar('leading-micro'),
};
const outboxSectionStyle = {
    marginTop: SPACE.lg,
    padding: `${SPACE.lg}px`,
    border: `1px solid ${cssVar('muted-tint')}`,
    borderRadius: RADIUS.card,
    background: cssVar('paper'),
};
const logSectionStyle = {
    marginTop: SPACE.xxl,
    paddingTop: SPACE.lg,
    borderTop: `1px solid ${cssVar('muted-tint')}`,
    color: cssVar('muted-deep'),
    fontSize: cssVar('size-micro'),
};
const logHeadingStyle = {
    margin: 0,
    fontSize: cssVar('size-small'),
    fontWeight: 600,
    color: cssVar('muted-deep'),
};
const segmentedGroupStyle = {
    display: 'inline-flex',
    flexWrap: 'wrap',
    margin: `${SPACE.md}px 0`,
    border: `1px solid ${cssVar('muted-tint')}`,
    borderRadius: RADIUS.pill,
    overflow: 'hidden',
    background: cssVar('paper'),
};
function segmentStyle(selected, first) {
    return {
        minHeight: MIN_TOUCH_TARGET,
        padding: `0 ${SPACE.lg}px`,
        border: 'none',
        borderLeft: first ? 'none' : `1px solid ${cssVar('muted-tint')}`,
        background: selected ? cssVar('blue-tint') : 'transparent',
        color: selected ? cssVar('blue-deep') : cssVar('muted-deep'),
        fontWeight: selected ? 600 : 400,
        fontFamily: 'inherit',
        fontSize: cssVar('size-small'),
        cursor: 'pointer',
    };
}
const movementListStyle = {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: SPACE.xs,
};
const movementRowStyle = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: SPACE.sm,
    paddingBottom: SPACE.xs,
    borderBottom: `1px solid ${cssVar('muted-tint')}`,
};
const disclosureStyle = {
    minHeight: MIN_TOUCH_TARGET,
    padding: `0 ${SPACE.md}px`,
    marginTop: SPACE.sm,
    border: `1px solid ${cssVar('muted-tint')}`,
    borderRadius: RADIUS.pill,
    background: 'transparent',
    color: cssVar('muted-deep'),
    font: 'inherit',
    fontSize: cssVar('size-small'),
    cursor: 'pointer',
};
/** PRD §10 `/actions` — the outbox, the rank movement replies caused, the log. */
export function ActionsPage() {
    const client = useApiClient();
    const actions = useApi((c) => c.getActions(), []);
    const [params, setParams] = useSearchParams();
    const [busy, setBusy] = useState(null);
    const [mutationError, setMutationError] = useState(null);
    const [notice, setNotice] = useState(null);
    /** The action whose log row should take focus once the reloaded log renders. */
    const focusActionId = useRef(null);
    const ids = useId();
    const rawStage = params.get(PARAM.stage);
    const stage = isStage(rawStage) ? rawStage : DEFAULT_STAGE;
    const showAllMovements = params.get(PARAM.moves) === 'all';
    const writeParams = useCallback((next) => {
        const nextStage = next.stage ?? stage;
        const nextMoves = next.showAllMovements ?? showAllMovements;
        const search = new URLSearchParams();
        if (nextStage !== DEFAULT_STAGE)
            search.set(PARAM.stage, nextStage);
        if (nextMoves)
            search.set(PARAM.moves, 'all');
        setParams(search, { replace: true });
    }, [stage, showAllMovements, setParams]);
    const entries = useMemo(() => [...(actions.data ?? [])].sort(newestFirst), [actions.data]);
    const outbox = useMemo(() => entries.filter(isApprovable), [entries]);
    const counts = useMemo(() => {
        const out = {};
        for (const key of STAGE_ORDER)
            out[key] = entries.filter((e) => inStage(e, key)).length;
        return out;
    }, [entries]);
    const visible = useMemo(() => entries.filter((e) => inStage(e, stage)), [entries, stage]);
    /** Biggest mover first; the ties keep the newest-first order they arrived in. */
    const replies = useMemo(() => {
        const withDelta = entries.filter((e) => e.type === 'reply' && rankDelta(e) !== null);
        return withDelta
            .map((entry, index) => ({ entry, index, size: Math.abs(rankDelta(entry) ?? 0) }))
            .sort((a, b) => b.size - a.size || a.index - b.index)
            .map((item) => item.entry);
    }, [entries]);
    const shownReplies = showAllMovements ? replies : replies.slice(0, MOVEMENT_CAP);
    const approve = async (entry) => {
        setBusy(entry.actionId);
        setMutationError(null);
        setNotice(null);
        try {
            await client.approveAction(entry.actionId);
            setNotice(`Request to ${entry.insuredName} approved and marked sent.`);
            focusActionId.current = entry.actionId;
            actions.reload();
        }
        catch (thrown) {
            setMutationError(`Could not approve the request for ${entry.insuredName}: ${thrown instanceof Error ? thrown.message : String(thrown)}`);
        }
        finally {
            setBusy(null);
        }
    };
    const plan = async () => {
        setBusy('plan');
        setMutationError(null);
        setNotice(null);
        try {
            const planned = await client.planActions();
            setNotice(`Action plan ran: ${pluralize(planned.length, 'action')} routed or drafted.`);
            actions.reload();
        }
        catch (thrown) {
            setMutationError(`Could not run the action plan: ${thrown instanceof Error ? thrown.message : String(thrown)}`);
        }
        finally {
            setBusy(null);
        }
    };
    /**
     * The approved row keeps the user's place: once the reloaded log paints, its
     * insured link scrolls into view and takes focus instead of the page jumping
     * back to the top.
     */
    const insuredCell = useCallback((entry) => {
        const attach = (node) => {
            if (node === null || focusActionId.current !== entry.actionId)
                return;
            focusActionId.current = null;
            if (typeof node.scrollIntoView === 'function') {
                node.scrollIntoView({ block: 'center' });
            }
            node.focus();
        };
        return (_jsx(Link, { ref: attach, to: submissionPath(entry.submissionId), "aria-label": `Open ${entry.insuredName}`, "data-action-row": entry.actionId, children: entry.insuredName }));
    }, []);
    const baseColumns = useCallback(() => [
        { key: 'date', header: 'Date', render: (e) => formatDate(e.createdAt), sortValue: (e) => e.createdAt },
        { key: 'insured', header: 'Insured', render: insuredCell, sortValue: (e) => e.insuredName },
        { key: 'type', header: 'Action', render: (e) => titleCase(e.type), sortValue: (e) => e.type },
        { key: 'status', header: 'Status', render: (e) => titleCase(e.status), sortValue: (e) => e.status },
    ], [insuredCell]);
    const logColumns = [
        ...baseColumns(),
        { key: 'score', header: 'Appetite', align: 'right', render: scoreText, sortValue: (e) => e.afterScore ?? e.beforeScore },
        { key: 'verdict', header: 'Verdict', render: verdictCell, sortValue: (e) => e.afterVerdict ?? e.beforeVerdict },
        { key: 'rank', header: 'Rank movement', align: 'right', render: movementText, sortValue: (e) => rankDelta(e) },
    ];
    const outboxColumns = [
        ...baseColumns(),
        {
            key: 'approve',
            header: 'Approve',
            render: (e) => (_jsx("button", { type: "button", className: "rf-button--primary", onClick: (event) => {
                    event.stopPropagation();
                    void approve(e);
                }, disabled: busy !== null, "aria-label": `Approve request to ${e.insuredName}`, style: { minHeight: MIN_TOUCH_TARGET }, children: busy === e.actionId ? 'Approving…' : 'Approve' })),
        },
    ];
    const firstLoad = actions.loading && actions.data === null;
    return (_jsxs("section", { className: "actions-page", "aria-labelledby": `${ids}-title`, children: [_jsxs("div", { style: headerRowStyle, children: [_jsx("h1", { id: `${ids}-title`, style: { margin: 0 }, children: "Actions" }), _jsx(Badge, { label: "Simulated send", tone: "info" }), _jsx("span", { className: "actions-notice", style: asideNoteStyle, children: "Approving marks it sent; nothing is emailed." })] }), _jsx("div", { className: "actions-toolbar", style: { marginTop: SPACE.md }, children: _jsx("button", { type: "button", onClick: () => void plan(), disabled: busy !== null, style: { minHeight: MIN_TOUCH_TARGET }, children: busy === 'plan' ? 'Planning…' : 'Run action plan' }) }), actions.error !== null ? (_jsxs("div", { role: "alert", className: "actions-error", children: [_jsxs("p", { children: ["Could not load the action log: ", actions.error.message] }), _jsx("button", { type: "button", onClick: actions.reload, style: { minHeight: MIN_TOUCH_TARGET }, children: "Retry" })] })) : null, mutationError !== null ? (_jsx("p", { role: "alert", className: "actions-error", children: mutationError })) : null, _jsx("p", { role: "status", "aria-live": "polite", className: "actions-count", children: firstLoad
                    ? 'Loading the action log…'
                    : notice ??
                        `${pluralize(entries.length, 'action')} · ${counts.awaiting} awaiting approval · ${counts.sent} sent · ${counts.replied} replied` }), _jsxs("section", { className: "actions-outbox", style: outboxSectionStyle, "aria-labelledby": `${ids}-outbox`, children: [_jsx("h2", { id: `${ids}-outbox`, style: { margin: 0 }, children: "Outbox" }), _jsx(DataTable, { caption: "Broker requests awaiting approval", columns: outboxColumns, rows: outbox, rowKey: (e) => e.actionId, emptyLabel: "Nothing awaiting approval.", loading: firstLoad })] }), replies.length > 0 ? (_jsxs("section", { className: "actions-movement", "aria-labelledby": `${ids}-movement`, style: { marginTop: SPACE.xl }, children: [_jsx("h2", { id: `${ids}-movement`, children: "Rank movement from replies" }), _jsx("ul", { style: movementListStyle, children: shownReplies.map((e) => (_jsxs("li", { "data-testid": `movement-${e.actionId}`, style: movementRowStyle, children: [_jsx(Link, { to: submissionPath(e.submissionId), "aria-label": `Open ${e.insuredName}`, children: e.insuredName }), _jsx("span", { style: asideNoteStyle, children: movementText(e) })] }, e.actionId))) }), replies.length > MOVEMENT_CAP ? (_jsx("button", { type: "button", style: disclosureStyle, "aria-expanded": showAllMovements, onClick: () => writeParams({ showAllMovements: !showAllMovements }), children: showAllMovements ? 'Show fewer' : `Show all (${replies.length})` })) : null] })) : null, _jsxs("section", { className: "actions-log", style: logSectionStyle, "aria-labelledby": `${ids}-log`, children: [_jsx("h2", { id: `${ids}-log`, style: logHeadingStyle, children: "Action log" }), _jsx("div", { role: "group", "aria-label": "Filter by stage", className: "actions-stages", style: segmentedGroupStyle, children: STAGE_ORDER.map((key, index) => (_jsx("button", { type: "button", "aria-pressed": stage === key, onClick: () => writeParams({ stage: key }), style: segmentStyle(stage === key, index === 0), children: `${STAGES[key].label} (${counts[key]})` }, key))) }), _jsx(DataTable, { caption: "Every action across the book, newest first", columns: logColumns, rows: visible, rowKey: (e) => e.actionId, emptyLabel: stage === 'all' ? 'No actions yet.' : `No ${STAGES[stage].label.toLowerCase()} actions.`, loading: firstLoad })] })] }));
}
//# sourceMappingURL=ActionsPage.js.map