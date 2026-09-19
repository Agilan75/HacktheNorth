import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useId, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { formatMoney, formatPercent, formatScore, pluralize, titleCase, } from '@retrofit/contracts';
import { submissionPath } from '../App.js';
import { useApi } from '../api/useApi.js';
import { Badge } from '../components/atoms/Badge.js';
import { VerdictPill } from '../components/atoms/VerdictPill.js';
import { DataTable } from '../components/DataTable.js';
import { Filters } from '../components/Filters.js';
/** Label PRD §10 fixes for the collapsed non-property group. */
const OUT_OF_APPETITE_LABEL = 'Out of appetite: line of business';
const EMPTY_FILTER = {
    line: null,
    verdict: null,
    state: null,
    underwriter: null,
    search: '',
};
/** Distinct, non-empty values, sorted for a stable dropdown. */
function distinct(values) {
    const set = new Set();
    for (const v of values) {
        if (typeof v === 'string' && v.trim().length > 0)
            set.add(v);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
}
/** Filter options come from the rows the API returned — never a hard-coded list. */
function buildOptions(rows) {
    return {
        lines: distinct(rows.map((r) => r.lineOfBusiness)),
        states: distinct(rows.map((r) => r.primaryState)),
        underwriters: distinct(rows.map((r) => r.assignedUnderwriter)),
    };
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
    if (q.length > 0) {
        const haystack = [row.insuredName, row.submissionId, row.explanationLine]
            .join(' ')
            .toLowerCase();
        if (!haystack.includes(q))
            return false;
    }
    return true;
}
function isActive(f) {
    return (f.line !== null ||
        f.verdict !== null ||
        f.state !== null ||
        f.underwriter !== null ||
        f.search.trim().length > 0);
}
/**
 * Order by the rank the API assigned (PRD §6.8 / INTERPRETATIONS P-6 are
 * applied server-side). The page never recomputes a rank; it only restores the
 * API's order after filtering, with the id as a deterministic tiebreak.
 */
function byRank(a, b) {
    if (a.rank !== b.rank)
        return a.rank - b.rank;
    return a.submissionId < b.submissionId ? -1 : a.submissionId > b.submissionId ? 1 : 0;
}
function premiumCell(row) {
    // No policy means no quoted or predicted premium; say so in words, not "— vs —".
    if (row.quotedPremium === null && row.predictedPremium === null)
        return 'No premium yet';
    return `${formatMoney(row.quotedPremium)} vs ${formatMoney(row.predictedPremium)}`;
}
function buildColumns() {
    return [
        {
            key: 'rank',
            header: 'Rank',
            align: 'right',
            render: (r) => String(r.rank),
            sortValue: (r) => r.rank,
        },
        {
            key: 'quality',
            header: 'Quality',
            headerTitle: 'Quality index, 0–100 (PRD §6.8)',
            align: 'right',
            render: (r) => formatScore(r.qualityIndex, { decimals: 1 }),
            sortValue: (r) => r.qualityIndex,
        },
        {
            key: 'verdict',
            header: 'Verdict',
            render: (r) => _jsx(VerdictPill, { verdict: r.verdict }),
            sortValue: (r) => r.verdict,
        },
        {
            key: 'insured',
            header: 'Insured',
            minWidth: 170,
            render: (r) => (_jsx(Link, { to: submissionPath(r.submissionId), "aria-label": `Open ${r.insuredName}`, children: r.insuredName })),
            sortValue: (r) => r.insuredName,
        },
        {
            key: 'appetite',
            header: 'Appetite',
            headerTitle: 'Appetite score, 0–100',
            align: 'right',
            render: (r) => formatScore(r.appetiteScore),
            sortValue: (r) => r.appetiteScore,
        },
        {
            key: 'premium',
            header: 'Quoted vs predicted',
            headerTitle: 'Quoted premium vs predicted premium (USD)',
            align: 'right',
            render: premiumCell,
            sortValue: (r) => r.quotedPremium,
        },
        {
            key: 'adequacy',
            header: 'Adequacy',
            headerTitle: 'Quoted premium ÷ predicted premium',
            align: 'right',
            render: (r) => (r.adequacy === null ? 'n/a' : formatPercent(r.adequacy)),
            sortValue: (r) => r.adequacy,
        },
        {
            key: 'completeness',
            header: 'Completeness',
            align: 'right',
            render: (r) => formatPercent(r.completeness, { from: 'percent' }),
            sortValue: (r) => r.completeness,
        },
        {
            key: 'contradictions',
            header: 'Contradictions',
            align: 'right',
            render: (r) => String(r.contradictionCount),
            sortValue: (r) => r.contradictionCount,
        },
        {
            key: 'flip',
            header: 'Flip',
            headerTitle: 'One movable change away from FIT',
            render: (r) => r.oneFlipFromFit ? (_jsx(Badge, { label: "1 flip from FIT", tone: "attention" })) : r.verdict === 'FIT' ? ('Not needed') : ('None'),
            sortValue: (r) => (r.oneFlipFromFit ? 1 : 0),
        },
        {
            key: 'underwriter',
            header: 'Underwriter',
            render: (r) => r.assignedUnderwriter ?? 'Unassigned',
            sortValue: (r) => r.assignedUnderwriter,
        },
        {
            key: 'pending',
            header: 'Pending action',
            render: (r) => (r.pendingAction === null ? 'None' : titleCase(r.pendingAction)),
            sortValue: (r) => r.pendingAction,
        },
        {
            key: 'explanation',
            header: 'Why',
            // Was crushed to one word per line: every row grew hundreds of px tall.
            minWidth: 340,
            clampLines: 3,
            title: (r) => r.explanationLine,
            render: (r) => r.explanationLine,
        },
    ];
}
/**
 * PRD 10 /queue - the ranked table, filters, and the collapsed 'Out of appetite: line of business' group.
 *
 * Stub frozen by W0-4. Unit C04 replaces this body only.
 * Route registration lives in src/App.tsx and is frozen.
 */
export function QueuePage() {
    const queue = useApi((client) => client.getQueue(), []);
    const navigate = useNavigate();
    const [filter, setFilter] = useState(EMPTY_FILTER);
    const [outOpen, setOutOpen] = useState(false);
    const groupId = useId();
    const rows = useMemo(() => queue.data ?? [], [queue.data]);
    const options = useMemo(() => buildOptions(rows), [rows]);
    const columns = useMemo(() => buildColumns(), []);
    const { inAppetite, outOfAppetite } = useMemo(() => {
        const visible = rows.filter((r) => matches(r, filter)).sort(byRank);
        return {
            inAppetite: visible.filter((r) => !r.outOfAppetiteLine),
            outOfAppetite: visible.filter((r) => r.outOfAppetiteLine),
        };
    }, [rows, filter]);
    const onRowClick = (row) => {
        void navigate(submissionPath(row.submissionId));
    };
    const shown = inAppetite.length + outOfAppetite.length;
    const filtered = isActive(filter);
    return (_jsxs("section", { className: "queue-page", "aria-labelledby": `${groupId}-title`, children: [_jsx("h1", { id: `${groupId}-title`, children: "Queue" }), _jsx(Filters, { value: filter, options: options, onChange: setFilter }), queue.error !== null ? (_jsxs("div", { role: "alert", className: "queue-error", children: [_jsxs("p", { children: ["Could not load the queue: ", queue.error.message] }), _jsx("button", { type: "button", onClick: queue.reload, children: "Retry" })] })) : null, _jsx("p", { role: "status", "aria-live": "polite", className: "queue-count", children: queue.loading && queue.data === null
                    ? 'Loading the queue…'
                    : filtered
                        ? `Showing ${shown} of ${pluralize(rows.length, 'submission')}`
                        : pluralize(rows.length, 'submission') }), _jsx(DataTable, { caption: "Ranked submissions, best first", columns: columns, rows: inAppetite, rowKey: (r) => r.submissionId, emptyLabel: filtered ? 'No submissions match these filters.' : 'No submissions in appetite.', loading: queue.loading && queue.data === null, onRowClick: onRowClick }), outOfAppetite.length > 0 ? (_jsxs("section", { className: "queue-out-of-appetite", "aria-labelledby": `${groupId}-out`, children: [_jsx("h2", { id: `${groupId}-out`, children: _jsx("button", { type: "button", "aria-expanded": outOpen, "aria-controls": `${groupId}-out-body`, onClick: () => setOutOpen((v) => !v), style: { minHeight: 44 }, children: `${OUT_OF_APPETITE_LABEL} (${outOfAppetite.length})` }) }), _jsx("div", { id: `${groupId}-out-body`, hidden: !outOpen, children: outOpen ? (_jsx(DataTable, { caption: OUT_OF_APPETITE_LABEL, columns: columns, rows: outOfAppetite, rowKey: (r) => r.submissionId, emptyLabel: "No out-of-appetite submissions.", onRowClick: onRowClick })) : null })] })) : null] }));
}
//# sourceMappingURL=QueuePage.js.map