import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { Link } from 'react-router';
import { formatDate, formatMoney, formatPercent, formatScore, pluralize, titleCase } from '@retrofit/contracts';
import { MIN_TOUCH_TARGET, SPACE, VERDICT_MARKS, VERDICT_STYLES, cssVar } from '@retrofit/design';
import { ROUTES, submissionPath } from '../routes.js';
import { useApi } from '../api/useApi.js';
import { Card } from '../components/atoms/Card.js';
import { Skeleton } from '../components/atoms/Skeleton.js';
import { Tile } from '../components/atoms/Tile.js';
import { VerdictPill } from '../components/atoms/VerdictPill.js';
import { AdequacyScale } from '../components/charts/AdequacyScale.js';
import { BarList } from '../components/charts/BarList.js';
import { Histogram } from '../components/charts/Histogram.js';
import { DataTable } from '../components/DataTable.js';
/** Display order of the three verdicts (PRD 13 styling, INTERPRETATIONS V-*). */
const VERDICT_ORDER = ['FIT', 'REFER', 'DOES_NOT_FIT'];
/** At most this many knockout factors are charted; the API already ranks them. */
const MAX_KNOCKOUT_FACTORS = 8;
/** Rows shown before the one-flip table collapses behind "Show all". */
const FLIP_PREVIEW_ROWS = 10;
/** The queue reads its filters from the URL; these are the param names. */
function queuePath(params) {
    if (params === undefined)
        return ROUTES.queue;
    const search = new URLSearchParams(params).toString();
    return search.length === 0 ? ROUTES.queue : `${ROUTES.queue}?${search}`;
}
const TILE_ROW = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))',
    gap: SPACE.lg,
    margin: 0,
};
/** The primary: the two charts that describe the book, side by side, full width. */
const PRIMARY_SPLIT = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))',
    gap: SPACE.xl,
    alignItems: 'start',
};
/** The secondary row: smaller type, muted, visibly a footnote to the primary. */
const SECONDARY_ROW = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))',
    gap: SPACE.lg,
    alignItems: 'start',
    fontSize: cssVar('size-small'),
    lineHeight: cssVar('leading-small'),
};
const SUBHEAD = {
    margin: 0,
    fontSize: cssVar('size-micro'),
    lineHeight: cssVar('leading-micro'),
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: cssVar('mutedDeep'),
};
const LINK_ROW = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: SPACE.sm,
    listStyle: 'none',
    margin: `${SPACE.md}px 0 0`,
    padding: 0,
};
const LINK_CHIP = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: SPACE.xs,
    minHeight: MIN_TOUCH_TARGET,
    padding: `0 ${SPACE.md}px`,
    border: `1px solid ${cssVar('mutedTint')}`,
    borderRadius: cssVar('radius-pill'),
    fontSize: cssVar('size-small'),
};
const ERROR_BOX = {
    border: `1px solid ${cssVar('mutedTint')}`,
    borderRadius: cssVar('radius-card'),
    padding: SPACE.lg,
};
/* -------------------------------------------------------------------------- */
/* Pure view builders (presentation only; no number here changes value)       */
/* -------------------------------------------------------------------------- */
function countOf(record, key) {
    const v = record[key];
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}
function verdictBars(counts) {
    return VERDICT_ORDER.map((v) => {
        const style = VERDICT_STYLES[v];
        return {
            key: v,
            label: style.label,
            mark: VERDICT_MARKS[v],
            count: countOf(counts, v),
            // REFER is an outlined bar, matching its outlined pill.
            fill: style.fill === 'transparent' ? 'var(--rf-red-tint)' : style.fill,
            stroke: style.border,
        };
    });
}
function knockoutBars(factors) {
    return factors.slice(0, MAX_KNOCKOUT_FACTORS).map((f) => ({
        key: f.factorId,
        label: f.label ?? titleCase(f.factorId),
        count: f.count,
        fill: 'var(--rf-blue)',
    }));
}
function asNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
/** `0.91–0.97` (the client's CI string) → `91%–97%`; anything else passes through. */
function formatCi(value) {
    if (typeof value !== 'string' || value.length === 0)
        return null;
    const parts = value.split('–').map((p) => Number(p.trim()));
    if (parts.length === 2 && parts.every((p) => Number.isFinite(p) && p >= 0 && p <= 1)) {
        return `${formatPercent(parts[0], { decimals: 1 })}–${formatPercent(parts[1], { decimals: 1 })}`;
    }
    return value;
}
function countText(value) {
    const n = asNumber(value);
    return n === null ? '—' : n.toLocaleString('en-US');
}
/** Headline tiles for the verification summary; empty when no run exists yet. */
function verificationTiles(v) {
    if (Object.keys(v).length === 0)
        return [];
    const ci = formatCi(v.llmAgreementCi95);
    const tiles = [
        { key: 'propertyCasesRun', label: 'Property cases run', value: countText(v.propertyCasesRun) },
        { key: 'differentialCasesRun', label: 'Differential cases run', value: countText(v.differentialCasesRun) },
        { key: 'disagreements', label: 'Disagreements', value: countText(v.disagreements) },
        { key: 'llmCasesRun', label: 'Second-opinion cases', value: countText(v.llmCasesRun) },
        {
            key: 'llmAgreementRate',
            label: 'Second-opinion agreement',
            value: formatPercent(asNumber(v.llmAgreementRate), { decimals: 1 }),
            ...(ci !== null ? { note: `95% CI ${ci}` } : {}),
        },
        {
            key: 'extractionFieldAccuracy',
            label: 'Extraction field accuracy',
            // Absent means the check has not produced a valid measurement; say so
            // rather than dropping the tile or showing a dash (DECISIONS CP2-3).
            value: asNumber(v.extractionFieldAccuracy) === null
                ? 'Not measured'
                : formatPercent(asNumber(v.extractionFieldAccuracy), { decimals: 1 }),
        },
    ];
    return tiles;
}
/* -------------------------------------------------------------------------- */
/* Small pieces                                                               */
/* -------------------------------------------------------------------------- */
/** The chart is an image; these are the same rows as links into the queue. */
function ChartLinks(props) {
    return (_jsx("ul", { style: LINK_ROW, "aria-label": props.label, "data-testid": props.testId, children: props.items.map((it) => (_jsx("li", { children: _jsxs(Link, { to: it.href, style: LINK_CHIP, "data-testid": `${props.testId}-${it.key}`, children: [_jsx("span", { children: it.label }), _jsx("strong", { children: it.count.toLocaleString('en-US') })] }) }, it.key))) }));
}
function flipRows(rows, moves) {
    return rows
        .map((row) => {
        // The engine's own move (C14); the queue sentence only when the API sent none.
        const move = moves?.[row.submissionId];
        return {
            row,
            moveLabel: move?.moveLabel ?? row.explanationLine,
            scoreAfter: move ? move.scoreAfter : null,
            premiumAfter: move?.premiumAfter ?? null,
        };
    })
        .slice()
        .sort((a, b) => (b.scoreAfter ?? -1) - (a.scoreAfter ?? -1));
}
const FLIP_COLUMNS = [
    {
        key: 'insured',
        header: 'Insured',
        render: (r) => (_jsx(Link, { to: submissionPath(r.row.submissionId), "aria-label": `Open ${r.row.insuredName}`, children: r.row.insuredName })),
        sortValue: (r) => r.row.insuredName,
    },
    {
        key: 'verdict',
        header: 'Verdict',
        render: (r) => r.row.incomplete ? (_jsx("span", { style: { color: cssVar('mutedDeep') }, children: "Not in current queue" })) : (_jsx(VerdictPill, { verdict: r.row.verdict })),
        sortValue: (r) => (r.row.incomplete ? null : r.row.verdict),
    },
    { key: 'appetite', header: 'Appetite', align: 'right', render: (r) => formatScore(r.row.appetiteScore), sortValue: (r) => r.row.appetiteScore },
    {
        key: 'predicted',
        header: 'Predicted premium',
        align: 'right',
        render: (r) => formatMoney(r.row.predictedPremium),
        sortValue: (r) => r.row.predictedPremium,
    },
    { key: 'move', header: 'What would flip it', minWidth: 280, clampLines: 2, title: (r) => r.moveLabel, render: (r) => r.moveLabel },
    {
        key: 'scoreAfter',
        header: 'Score after',
        align: 'right',
        render: (r) => (r.scoreAfter === null ? '—' : formatScore(r.scoreAfter)),
        sortValue: (r) => r.scoreAfter,
    },
    { key: 'premiumAfter', header: 'Premium after', align: 'right', render: (r) => formatMoney(r.premiumAfter), sortValue: (r) => r.premiumAfter },
];
function OneFlipTable(props) {
    const [showAll, setShowAll] = useState(false);
    const all = flipRows(props.rows, props.moves);
    const shown = showAll ? all : all.slice(0, FLIP_PREVIEW_ROWS);
    return (_jsxs(_Fragment, { children: [_jsx(DataTable, { caption: "By score after the change", columns: FLIP_COLUMNS, rows: shown, rowKey: (r) => r.row.submissionId, emptyLabel: "No submission is one change away from FIT." }), all.length > FLIP_PREVIEW_ROWS ? (_jsx("button", { type: "button", "data-testid": "flip-show-all", onClick: () => setShowAll((v) => !v), style: { minHeight: MIN_TOUCH_TARGET, marginTop: SPACE.md }, children: showAll ? 'Show fewer' : `Show all (${all.length})` })) : null] }));
}
function AggregateBody(props) {
    const { data } = props;
    const verdicts = verdictBars(data.countsByVerdict);
    // The API's counts when present (C14); the verdict / histogram sums only as a fallback.
    const counts = data.counts;
    const total = counts?.scored ?? verdicts.reduce((s, b) => s + b.count, 0);
    const fit = countOf(data.countsByVerdict, 'FIT');
    const scored = counts?.scored ?? data.scoreHistogram.reduce((s, b) => s + (Number.isFinite(b.count) ? b.count : 0), 0);
    const adequacy = data.bookAdequacyDetail;
    const median = adequacy?.median ?? data.bookAdequacy;
    const totalNote = counts
        ? `of ${counts.total.toLocaleString('en-US')} ingested · ${counts.knockedOut.toLocaleString('en-US')} knocked out`
        : undefined;
    const underpricedText = adequacy
        ? `${adequacy.underpricedCount.toLocaleString('en-US')} of ${pluralize(adequacy.n, 'priced submission')} quoted below predicted premium.`
        : null;
    const tiles = verificationTiles(data.verification);
    const generatedAt = typeof data.verification.generatedAt === 'string' ? data.verification.generatedAt : null;
    const knockouts = knockoutBars(data.topKnockoutFactors);
    return (_jsxs(_Fragment, { children: [_jsxs("dl", { style: TILE_ROW, "aria-label": "Book headline", children: [_jsx(Tile, { testId: "tile-total", label: "Submissions with a verdict", value: total.toLocaleString('en-US'), detail: totalNote, href: queuePath() }), _jsx(Tile, { testId: "tile-fit", label: "Fit appetite", tone: "positive", value: fit.toLocaleString('en-US'), detail: total > 0 ? `${formatPercent(fit / total, { decimals: 1 })} of the book` : undefined, href: queuePath({ verdict: 'FIT' }) }), _jsx(Tile, { testId: "tile-flip", label: "One change from FIT", tone: "info", value: data.oneFlipAway.length.toLocaleString('en-US'), href: "#rf-one-flip" }), _jsx(Tile, { testId: "tile-adequacy", label: "Median adequacy", value: formatPercent(median), detail: adequacy ? `${adequacy.underpricedCount.toLocaleString('en-US')} underpriced` : undefined })] }), _jsx(Card, { title: "The book", aside: `${pluralize(total, 'submission')} · ${scored.toLocaleString('en-US')} scored`, children: _jsxs("div", { style: PRIMARY_SPLIT, children: [_jsxs("div", { children: [_jsx("h3", { style: SUBHEAD, children: "By verdict" }), _jsx(BarList, { title: "Submissions by verdict", items: verdicts, countLabel: "Submissions", emptyLabel: "No verdicts yet." }), _jsx(ChartLinks, { label: "Open the queue filtered by verdict", testId: "verdict-links", items: verdicts.map((v) => ({ key: v.key, label: v.label, count: v.count, href: queuePath({ verdict: v.key }) })) })] }), _jsxs("div", { children: [_jsx("h3", { style: SUBHEAD, children: "Score distribution" }), _jsx(Histogram, { title: "Appetite score distribution", buckets: data.scoreHistogram.map((b) => ({ label: b.bucket, count: b.count })), xLabel: "Appetite score (0\u2013100)" })] })] }) }), _jsxs("div", { style: SECONDARY_ROW, children: [_jsxs(Card, { title: "Top knockout factors", children: [_jsx(BarList, { title: "Knockout factors by number of submissions", items: knockouts, countLabel: "Submissions knocked out", emptyLabel: "No knockouts in the book." }), knockouts.length > 0 ? (_jsx(ChartLinks, { label: "Open the queue filtered by knockout factor", testId: "knockout-links", items: knockouts.map((k) => ({ key: k.key, label: k.label, count: k.count, href: queuePath({ q: k.label }) })) })) : null] }), _jsxs(Card, { title: "Book adequacy", aside: adequacy ? pluralize(adequacy.n, 'priced submission') : undefined, children: [_jsx(AdequacyScale, { median: median }), underpricedText !== null ? (_jsx("p", { "data-testid": "adequacy-underpriced", style: { margin: `${SPACE.md}px 0 0` }, children: underpricedText })) : null] })] }), _jsx(Card, { title: "One flip away from FIT", anchorId: "rf-one-flip", aside: pluralize(data.oneFlipAway.length, 'submission'), children: _jsx(OneFlipTable, { rows: data.oneFlipAway, moves: data.oneFlipMoves }) }), _jsxs(Card, { title: "Verification", aside: generatedAt ? `Run ${formatDate(generatedAt)}` : undefined, children: [tiles.length === 0 ? (_jsx("p", { style: { margin: 0, color: cssVar('mutedDeep') }, "data-testid": "verification-empty", children: "No verification run yet." })) : (_jsx("dl", { style: TILE_ROW, "aria-label": "Verification headline", children: tiles.map((t) => (_jsx(Tile, { testId: `verify-${t.key}`, label: t.label, value: t.value, detail: t.note }, t.key))) })), _jsxs("p", { style: { margin: `${SPACE.lg}px 0 0` }, children: [_jsx(Link, { to: ROUTES.verification, "data-testid": "verification-link", children: "Verification" }), _jsx("span", { style: { color: cssVar('mutedDeep') }, children: ' — every check and disagreement' })] })] })] }));
}
/**
 * PRD 10 /aggregate - counts by verdict, score distribution, top knockout factors, one-flip-away list, book adequacy, verification headline.
 *
 * Stub frozen by W0-4. Unit C14 replaces this body only.
 * Route registration lives in src/App.tsx and is frozen.
 */
export function AggregatePage() {
    const state = useApi((client) => client.getAggregate(), []);
    return (_jsxs("section", { "aria-labelledby": "rf-aggregate-title", style: { display: 'flex', flexDirection: 'column', gap: SPACE.xl }, children: [_jsx("h1", { id: "rf-aggregate-title", style: { fontFamily: cssVar('font-display'), fontSize: cssVar('size-display'), lineHeight: cssVar('leading-display'), margin: 0 }, children: "Aggregate" }), state.error !== null ? (_jsxs("div", { role: "alert", style: ERROR_BOX, children: [_jsx("p", { style: { margin: 0 }, children: `Could not load the aggregate: ${state.error.message}` }), _jsx("button", { type: "button", onClick: state.reload, style: { minHeight: MIN_TOUCH_TARGET, marginTop: SPACE.md }, children: "Retry" })] })) : state.data === null ? (_jsx(Skeleton, { label: "Loading aggregate", lines: 8 })) : (_jsx(AggregateBody, { data: state.data }))] }));
}
//# sourceMappingURL=AggregatePage.js.map