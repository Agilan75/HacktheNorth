import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { EM_DASH, formatDate, formatScore, pluralize, titleCase } from '@retrofit/contracts';
import { MIN_TOUCH_TARGET } from '@retrofit/design';
import { submissionPath } from '../App.js';
import { useApi, useApiClient } from '../api/useApi.js';
import { VerdictPill } from '../components/atoms/VerdictPill.js';
import { DataTable } from '../components/DataTable.js';
/**
 * PRD §7.6 / §10 `/actions` stages: drafts awaiting approval, sent, replied,
 * plus failed. Routes, re-scores and log rows that are simply applied appear
 * under "All" only, so "Replied" never counts an action no broker answered.
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
/** PRD §14 risk row: say on screen that sending is simulated. */
const SIMULATED_NOTICE = 'Broker contacts in this dataset are synthetic, so approving a request marks it sent and nothing is emailed. Reply extraction and re-scoring are real.';
function inStage(entry, stage) {
    return STAGES[stage].match(entry);
}
/** Only a drafted broker request is approved by the underwriter (PRD §7.6). */
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
function insuredCell(entry) {
    return (_jsx(Link, { to: submissionPath(entry.submissionId), "aria-label": `Open ${entry.insuredName}`, children: entry.insuredName }));
}
function baseColumns() {
    return [
        {
            key: 'date',
            header: 'Date',
            render: (e) => formatDate(e.createdAt),
            sortValue: (e) => e.createdAt,
        },
        {
            key: 'insured',
            header: 'Insured',
            render: insuredCell,
            sortValue: (e) => e.insuredName,
        },
        {
            key: 'type',
            header: 'Action',
            render: (e) => titleCase(e.type),
            sortValue: (e) => e.type,
        },
        {
            key: 'status',
            header: 'Status',
            render: (e) => titleCase(e.status),
            sortValue: (e) => e.status,
        },
    ];
}
function logColumns() {
    return [
        ...baseColumns(),
        {
            key: 'score',
            header: 'Appetite score',
            headerTitle: 'Appetite score before → after, 0–100',
            align: 'right',
            render: scoreText,
            sortValue: (e) => e.afterScore ?? e.beforeScore,
        },
        {
            key: 'verdict',
            header: 'Verdict',
            render: verdictCell,
            sortValue: (e) => e.afterVerdict ?? e.beforeVerdict,
        },
        {
            key: 'rank',
            header: 'Rank movement',
            headerTitle: 'Queue rank before → after; rank 1 is best',
            align: 'right',
            render: movementText,
            sortValue: (e) => rankDelta(e),
        },
    ];
}
/**
 * PRD 10 /actions - outbox and action log across the book, with the rank movement each reply caused.
 *
 * Stub frozen by W0-4. Unit C12 replaces this body only.
 * Route registration lives in src/App.tsx and is frozen.
 */
export function ActionsPage() {
    const client = useApiClient();
    const actions = useApi((c) => c.getActions(), []);
    const [stage, setStage] = useState('all');
    const [busy, setBusy] = useState(null);
    const [mutationError, setMutationError] = useState(null);
    const [notice, setNotice] = useState(null);
    const ids = useId();
    const entries = useMemo(() => [...(actions.data ?? [])].sort(newestFirst), [actions.data]);
    const outbox = useMemo(() => entries.filter(isApprovable), [entries]);
    const counts = useMemo(() => {
        const out = {};
        for (const key of STAGE_ORDER)
            out[key] = entries.filter((e) => inStage(e, key)).length;
        return out;
    }, [entries]);
    const visible = useMemo(() => entries.filter((e) => inStage(e, stage)), [entries, stage]);
    const replies = useMemo(() => entries.filter((e) => e.type === 'reply' && rankDelta(e) !== null), [entries]);
    const approve = async (entry) => {
        setBusy(entry.actionId);
        setMutationError(null);
        setNotice(null);
        try {
            await client.approveAction(entry.actionId);
            setNotice(`Request to ${entry.insuredName} approved and marked sent.`);
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
    const outboxColumns = [
        ...baseColumns(),
        {
            key: 'approve',
            header: 'Approve',
            render: (e) => (_jsx("button", { type: "button", onClick: (event) => {
                    event.stopPropagation();
                    void approve(e);
                }, disabled: busy !== null, "aria-label": `Approve request to ${e.insuredName}`, style: { minHeight: MIN_TOUCH_TARGET }, children: busy === e.actionId ? 'Approving…' : 'Approve' })),
        },
    ];
    const firstLoad = actions.loading && actions.data === null;
    return (_jsxs("section", { className: "actions-page", "aria-labelledby": `${ids}-title`, children: [_jsx("h1", { id: `${ids}-title`, children: "Actions" }), _jsx("p", { className: "actions-notice", children: SIMULATED_NOTICE }), _jsx("div", { className: "actions-toolbar", children: _jsx("button", { type: "button", onClick: () => void plan(), disabled: busy !== null, style: { minHeight: MIN_TOUCH_TARGET }, children: busy === 'plan' ? 'Planning…' : 'Run action plan' }) }), actions.error !== null ? (_jsxs("div", { role: "alert", className: "actions-error", children: [_jsxs("p", { children: ["Could not load the action log: ", actions.error.message] }), _jsx("button", { type: "button", onClick: actions.reload, style: { minHeight: MIN_TOUCH_TARGET }, children: "Retry" })] })) : null, mutationError !== null ? (_jsx("p", { role: "alert", className: "actions-error", children: mutationError })) : null, _jsx("p", { role: "status", "aria-live": "polite", className: "actions-count", children: firstLoad
                    ? 'Loading the action log…'
                    : notice ??
                        `${pluralize(entries.length, 'action')} · ${counts.awaiting} awaiting approval · ${counts.sent} sent · ${counts.replied} replied` }), _jsxs("section", { className: "actions-outbox", "aria-labelledby": `${ids}-outbox`, children: [_jsx("h2", { id: `${ids}-outbox`, children: "Outbox" }), _jsx(DataTable, { caption: "Broker requests awaiting approval", columns: outboxColumns, rows: outbox, rowKey: (e) => e.actionId, emptyLabel: "No drafted requests awaiting approval.", loading: firstLoad })] }), replies.length > 0 ? (_jsxs("section", { className: "actions-movement", "aria-labelledby": `${ids}-movement`, children: [_jsx("h2", { id: `${ids}-movement`, children: "Rank movement from replies" }), _jsx("ul", { children: replies.map((e) => (_jsxs("li", { "data-testid": `movement-${e.actionId}`, children: [insuredCell(e), ": ", movementText(e)] }, e.actionId))) })] })) : null, _jsxs("section", { className: "actions-log", "aria-labelledby": `${ids}-log`, children: [_jsx("h2", { id: `${ids}-log`, children: "Action log" }), _jsx("div", { role: "group", "aria-label": "Filter by stage", className: "actions-stages", children: STAGE_ORDER.map((key) => (_jsx("button", { type: "button", "aria-pressed": stage === key, onClick: () => setStage(key), style: { minHeight: MIN_TOUCH_TARGET }, children: `${STAGES[key].label} (${counts[key]})` }, key))) }), _jsx(DataTable, { caption: "Every action across the book, newest first", columns: logColumns(), rows: visible, rowKey: (e) => e.actionId, emptyLabel: stage === 'all'
                            ? 'No actions yet. Run the action plan to route accounts and draft requests.'
                            : `No actions in "${STAGES[stage].label}".`, loading: firstLoad })] })] }));
}
//# sourceMappingURL=ActionsPage.js.map