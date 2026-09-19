import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Link } from 'react-router';
import { formatDate, formatMoney, formatPercent, formatScore, pluralize, titleCase } from '@retrofit/contracts';
import { VERDICT_MARKS, VERDICT_STYLES } from '@retrofit/design';
import { ROUTES, submissionPath } from '../App.js';
import { useApi } from '../api/useApi.js';
import { Card } from '../components/atoms/Card.js';
import { Skeleton } from '../components/atoms/Skeleton.js';
import { VerdictPill } from '../components/atoms/VerdictPill.js';
import { AdequacyScale } from '../components/charts/AdequacyScale.js';
import { BarList } from '../components/charts/BarList.js';
import { Histogram } from '../components/charts/Histogram.js';
/** Display order of the three verdicts (PRD 13 styling, INTERPRETATIONS V-*). */
const VERDICT_ORDER = ['FIT', 'REFER', 'DOES_NOT_FIT'];
/** At most this many knockout factors are charted; the API already ranks them. */
const MAX_KNOCKOUT_FACTORS = 8;
const GRID = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))',
    gap: 'var(--rf-space-xl)',
    alignItems: 'start',
};
const TILE_ROW = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: 'var(--rf-space-lg)',
    margin: 0,
};
const TILE = {
    border: 'var(--rf-border-width) solid var(--rf-border-color)',
    borderRadius: 'var(--rf-radius-card)',
    padding: 'var(--rf-space-lg)',
    margin: 0,
};
const TILE_VALUE = {
    fontFamily: 'var(--rf-font-display)',
    fontSize: 'var(--rf-size-title)',
    lineHeight: 'var(--rf-leading-title)',
    margin: 0,
};
const TILE_LABEL = {
    fontSize: 'var(--rf-size-micro)',
    lineHeight: 'var(--rf-leading-micro)',
    color: 'var(--rf-muted-deep)',
    margin: 0,
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
        fill: 'var(--rf-ink)',
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
function Tile(props) {
    return (_jsxs("div", { style: TILE, "data-testid": props.testId, children: [_jsx("dt", { style: TILE_LABEL, children: props.label }), _jsxs("dd", { style: { margin: 0 }, children: [_jsx("span", { style: TILE_VALUE, children: props.value }), props.note ? _jsx("span", { style: { ...TILE_LABEL, display: 'block' }, children: props.note }) : null] })] }));
}
function OneFlipTable(props) {
    if (props.rows.length === 0) {
        return _jsx("p", { style: { margin: 0, color: 'var(--rf-muted-deep)' }, children: "No submission is one change away from FIT." });
    }
    return (_jsx("div", { style: { overflowX: 'auto' }, children: _jsxs("table", { style: { width: '100%', borderCollapse: 'collapse' }, children: [_jsx("caption", { className: "rf-sr-only", children: "Submissions one change away from FIT" }), _jsx("thead", { children: _jsxs("tr", { style: { textAlign: 'left', fontSize: 'var(--rf-size-micro)', color: 'var(--rf-muted-deep)' }, children: [_jsx("th", { scope: "col", children: "Insured" }), _jsx("th", { scope: "col", children: "Verdict" }), _jsx("th", { scope: "col", style: { textAlign: 'right' }, children: "Appetite" }), _jsx("th", { scope: "col", style: { textAlign: 'right' }, children: "Predicted premium" }), _jsx("th", { scope: "col", style: { paddingLeft: 'var(--rf-space-md)' }, children: "What would flip it" }), _jsx("th", { scope: "col", style: { textAlign: 'right' }, children: "Score after" }), _jsx("th", { scope: "col", style: { textAlign: 'right' }, children: "Premium after" })] }) }), _jsx("tbody", { children: props.rows.map((r) => {
                        // The engine's own move (C14); the queue sentence only when the API sent none.
                        const move = props.moves?.[r.submissionId];
                        return (_jsxs("tr", { "data-testid": `flip-${r.submissionId}`, style: { borderTop: 'var(--rf-border-width) solid var(--rf-border-color)' }, children: [_jsx("th", { scope: "row", style: { textAlign: 'left', fontWeight: 500, padding: 'var(--rf-space-sm) var(--rf-space-sm) var(--rf-space-sm) 0' }, children: _jsx(Link, { to: submissionPath(r.submissionId), "aria-label": `Open ${r.insuredName}`, children: r.insuredName }) }), _jsx("td", { children: _jsx(VerdictPill, { verdict: r.verdict }) }), _jsx("td", { style: { textAlign: 'right' }, children: formatScore(r.appetiteScore) }), _jsx("td", { style: { textAlign: 'right' }, children: formatMoney(r.predictedPremium) }), _jsx("td", { style: { paddingLeft: 'var(--rf-space-md)' }, children: move?.moveLabel ?? r.explanationLine }), _jsx("td", { style: { textAlign: 'right' }, children: move ? formatScore(move.scoreAfter) : '—' }), _jsx("td", { style: { textAlign: 'right' }, children: formatMoney(move?.premiumAfter ?? null) })] }, r.submissionId));
                    }) })] }) }));
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
    return (_jsxs(_Fragment, { children: [_jsxs("dl", { style: TILE_ROW, "aria-label": "Book headline", children: [_jsx(Tile, { testId: "tile-total", label: "Submissions with a verdict", value: total.toLocaleString('en-US'), note: totalNote }), _jsx(Tile, { testId: "tile-fit", label: "Fit appetite", value: fit.toLocaleString('en-US'), note: total > 0 ? `${formatPercent(fit / total, { decimals: 1 })} of the book` : undefined }), _jsx(Tile, { testId: "tile-flip", label: "One change from FIT", value: data.oneFlipAway.length.toLocaleString('en-US') }), _jsx(Tile, { testId: "tile-adequacy", label: "Median adequacy", value: formatPercent(median), note: adequacy ? `${adequacy.underpricedCount.toLocaleString('en-US')} underpriced` : undefined })] }), _jsxs("div", { style: GRID, children: [_jsx(Card, { title: "Counts by verdict", aside: pluralize(total, 'submission'), children: _jsx(BarList, { title: "Submissions by verdict", items: verdicts, countLabel: "Submissions", emptyLabel: "No verdicts yet." }) }), _jsx(Card, { title: "Score distribution", aside: pluralize(scored, 'scored submission'), children: _jsx(Histogram, { title: "Appetite score distribution", buckets: data.scoreHistogram.map((b) => ({ label: b.bucket, count: b.count })), xLabel: "Appetite score (0\u2013100)" }) }), _jsx(Card, { title: "Top knockout factors", children: _jsx(BarList, { title: "Knockout factors by number of submissions", items: knockoutBars(data.topKnockoutFactors), countLabel: "Submissions knocked out", emptyLabel: "No knockouts in the book." }) }), _jsxs(Card, { title: "Book adequacy", aside: adequacy ? pluralize(adequacy.n, 'priced submission') : undefined, children: [_jsx(AdequacyScale, { median: median }), underpricedText !== null ? (_jsx("p", { "data-testid": "adequacy-underpriced", style: { margin: 'var(--rf-space-md) 0 0' }, children: underpricedText })) : null] })] }), _jsx(Card, { title: "One flip away from FIT", aside: pluralize(data.oneFlipAway.length, 'submission'), children: _jsx(OneFlipTable, { rows: data.oneFlipAway, moves: data.oneFlipMoves }) }), _jsxs(Card, { title: "Verification", aside: generatedAt ? `Run ${formatDate(generatedAt)}` : undefined, children: [tiles.length === 0 ? (_jsx("p", { style: { margin: 0, color: 'var(--rf-muted-deep)' }, "data-testid": "verification-empty", children: "No verification run yet. Run the verifier to populate these numbers." })) : (_jsx("dl", { style: TILE_ROW, "aria-label": "Verification headline", children: tiles.map((t) => (_jsx(Tile, { testId: `verify-${t.key}`, label: t.label, value: t.value, note: t.note }, t.key))) })), _jsx("p", { style: { margin: 'var(--rf-space-lg) 0 0' }, children: _jsx(Link, { to: ROUTES.verification, "data-testid": "verification-link", children: "See the full verification: every check, results by kind of case, each disagreement with both sides\u2019 reasoning, and what the testing found" }) })] })] }));
}
/**
 * PRD 10 /aggregate - counts by verdict, score distribution, top knockout factors, one-flip-away list, book adequacy, verification headline.
 *
 * Stub frozen by W0-4. Unit C14 replaces this body only.
 * Route registration lives in src/App.tsx and is frozen.
 */
export function AggregatePage() {
    const state = useApi((client) => client.getAggregate(), []);
    return (_jsxs("section", { "aria-labelledby": "rf-aggregate-title", style: { display: 'flex', flexDirection: 'column', gap: 'var(--rf-space-xl)' }, children: [_jsx("h1", { id: "rf-aggregate-title", style: { fontFamily: 'var(--rf-font-display)', fontSize: 'var(--rf-size-display)', lineHeight: 'var(--rf-leading-display)', margin: 0 }, children: "Aggregate" }), state.error !== null ? (_jsxs("div", { role: "alert", style: TILE, children: [_jsx("p", { style: { margin: 0 }, children: `Could not load the aggregate: ${state.error.message}` }), _jsx("button", { type: "button", onClick: state.reload, style: { minHeight: 'var(--rf-min-touch-target)', marginTop: 'var(--rf-space-md)' }, children: "Retry" })] })) : state.data === null ? (_jsx(Skeleton, { label: "Loading aggregate", lines: 8 })) : (_jsx(AggregateBody, { data: state.data }))] }));
}
//# sourceMappingURL=AggregatePage.js.map