import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Link } from 'react-router';
import { formatDate, formatPercent, formatScore, formatVerdict, pluralize } from '@retrofit/contracts';
import { MIN_TOUCH_TARGET, SPACE, cssVar } from '@retrofit/design';
import { ROUTES, submissionPath } from '../routes.js';
import { useApi } from '../api/useApi.js';
import { Card } from '../components/atoms/Card.js';
import { CitationQuote } from '../components/atoms/CitationQuote.js';
import { Skeleton } from '../components/atoms/Skeleton.js';
import { Tile } from '../components/atoms/Tile.js';
import { VerdictPill } from '../components/atoms/VerdictPill.js';
import { DataTable } from '../components/DataTable.js';
import { VerificationField } from './VerificationField.js';
/*
 * /verification — the testing in full, rendered from GET /verification
 * (FILL-backend D7). Every number on this page is a DTO value, formatted only:
 * nothing is summed, divided or re-derived here (PRD 10, 13). A block the API
 * returns as null says in words that it has no run.
 */
/* -------------------------------------------------------------------------- */
/* Styles                                                                      */
/* -------------------------------------------------------------------------- */
const PAGE = { display: 'flex', flexDirection: 'column', gap: SPACE.xl };
const TILE_ROW = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))',
    gap: SPACE.lg,
    margin: 0,
};
const BOX = {
    border: `1px solid ${cssVar('mutedTint')}`,
    borderRadius: cssVar('radius-card'),
    padding: SPACE.lg,
    margin: 0,
};
const MUTED = {
    fontSize: cssVar('size-small'),
    lineHeight: cssVar('leading-small'),
    color: cssVar('mutedDeep'),
    margin: 0,
};
const SIDES = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
    gap: SPACE.lg,
    marginTop: SPACE.md,
};
const SIDE = { ...BOX, padding: SPACE.lg };
const INLINE_LIST = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: SPACE.md,
    listStyle: 'none',
    margin: 0,
    padding: 0,
};
const SUMMARY = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: SPACE.sm,
    minHeight: MIN_TOUCH_TARGET,
    cursor: 'pointer',
    padding: `${SPACE.sm}px 0`,
};
/* -------------------------------------------------------------------------- */
/* Page furniture                                                              */
/* -------------------------------------------------------------------------- */
/** The six sections, in render order; each id is the Card's anchor. */
const SECTIONS = [
    { id: 'v-headline', label: 'Headline' },
    { id: 'v-field', label: 'Every case' },
    { id: 'v-real', label: 'Real accounts' },
    { id: 'v-strata', label: 'By kind of case' },
    { id: 'v-disagreements', label: 'Disagreements' },
    { id: 'v-found', label: 'What it found' },
];
/** The three layers, as a labelled strip rather than a paragraph. */
const LAYERS = [
    { key: 'A', label: 'Layer A', gloss: 'engine obeys its own laws' },
    { key: 'B', label: 'Layer B', gloss: 'naive implementation, same answer' },
    { key: 'C', label: 'Layer C', gloss: 'model asked the same question' },
];
function Breadcrumb() {
    return (_jsx("nav", { "aria-label": "Breadcrumb", "data-testid": "breadcrumb", children: _jsxs("ol", { style: { ...INLINE_LIST, ...MUTED, gap: SPACE.xs }, children: [_jsx("li", { children: _jsx(Link, { to: ROUTES.aggregate, children: "Aggregate" }) }), _jsx("li", { "aria-hidden": "true", children: "/" }), _jsx("li", { "aria-current": "page", children: "Verification" })] }) }));
}
function SectionIndex() {
    return (_jsx("nav", { "aria-label": "Sections", "data-testid": "section-index", children: _jsx("ul", { style: INLINE_LIST, children: SECTIONS.map((s) => (_jsx("li", { children: _jsx("a", { href: `#${s.id}`, style: { display: 'inline-flex', alignItems: 'center', minHeight: MIN_TOUCH_TARGET }, children: s.label }) }, s.id))) }) }));
}
function LayerStrip() {
    return (_jsx("ul", { style: { ...INLINE_LIST, marginTop: SPACE.lg }, "aria-label": "The three layers", "data-testid": "layer-strip", children: LAYERS.map((l) => (_jsxs("li", { style: { ...BOX, padding: SPACE.md, flex: '1 1 200px' }, children: [_jsx("strong", { style: { display: 'block', fontSize: cssVar('size-small') }, children: l.label }), _jsx("span", { style: MUTED, children: l.gloss })] }, l.key))) }));
}
/* -------------------------------------------------------------------------- */
/* Formatting (presentation only)                                              */
/* -------------------------------------------------------------------------- */
function count(n) {
    return n.toLocaleString('en-US');
}
/** `construction_exact_half` -> `Construction exact half`; `tiv_at_150m` -> `TIV at 150M`. */
function humanize(id) {
    const text = id
        .replace(/[_-]+/g, ' ')
        .trim()
        .replace(/\btiv\b/gi, 'TIV')
        .replace(/\b(\d+)m\b/g, '$1M');
    return text.length === 0 ? id : `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
function factor(id) {
    return id === null ? 'None' : humanize(id);
}
function Missing() {
    return (_jsx("p", { style: MUTED, "data-testid": "block-missing", children: "No verification run found." }));
}
/* -------------------------------------------------------------------------- */
/* Sections                                                                    */
/* -------------------------------------------------------------------------- */
function Headline(props) {
    const { layersAB, layerC, extraction } = props.data;
    return (_jsxs(Card, { title: "The headline", anchorId: "v-headline", children: [_jsxs("dl", { style: TILE_ROW, "aria-label": "Verification headline", children: [layersAB !== null ? (_jsxs(_Fragment, { children: [_jsx(Tile, { testId: "v-cases", label: "Property + differential cases", value: count(layersAB.completed), detail: `of ${count(layersAB.requested)} requested · ${pluralize(layersAB.workers, 'worker')} · seed ${layersAB.seed}` }), _jsx(Tile, { testId: "v-violations", label: "Invariant violations", tone: layersAB.invariantViolations === 0 ? 'positive' : 'attention', value: count(layersAB.invariantViolations), detail: "Layer A" }), _jsx(Tile, { testId: "v-disagreements", label: "Disagreements with the independent implementation", tone: layersAB.disagreements === 0 ? 'positive' : 'attention', value: count(layersAB.disagreements), detail: "Layer B" }), _jsx(Tile, { testId: "v-errors", label: "Crashes or errors", value: count(layersAB.errors) })] })) : null, layerC !== null ? (_jsx(Tile, { testId: "v-agreement", label: "Second-opinion agreement", tone: "info", value: formatPercent(layerC.agreement.point, { decimals: 1 }), detail: `${count(layerC.agreed)} of ${count(layerC.judged)} · ${formatPercent(layerC.agreement.confidence)} interval ${formatPercent(layerC.agreement.low, { decimals: 1 })}–${formatPercent(layerC.agreement.high, { decimals: 1 })}` })) : null, _jsx(Tile, { testId: "v-extraction", label: "Reply-extraction accuracy", value: extraction.status === 'measured' && extraction.fieldAccuracy !== null
                            ? formatPercent(extraction.fieldAccuracy, { decimals: 1 })
                            : 'Not measured' })] }), layersAB === null ? _jsx(Missing, {}) : null, layerC === null ? _jsx(Missing, {}) : null, _jsx(LayerStrip, {}), extraction.status !== 'measured' ? (_jsxs("div", { "data-testid": "extraction-reason", style: { marginTop: SPACE.lg }, children: [_jsx("h3", { style: { fontSize: cssVar('size-body'), margin: 0 }, children: "Why reply extraction is not measured" }), _jsx("p", { style: { maxWidth: '72ch', marginTop: SPACE.xs }, children: extraction.reason ?? 'The API gave no reason.' })] })) : null, layersAB !== null ? (_jsx("p", { style: { ...MUTED, marginTop: SPACE.lg }, children: `Run ${formatDate(layersAB.startedAt)} at ${formatScore(layersAB.casesPerSecond)} cases per second.` })) : null] }));
}
function RealAccounts(props) {
    const r = props.data.realAccounts;
    return (_jsx(Card, { title: "The real property accounts", anchorId: "v-real", children: r === null ? (_jsx(Missing, {})) : (_jsxs(_Fragment, { children: [_jsxs("dl", { style: TILE_ROW, "aria-label": "Real account checks", children: [_jsx(Tile, { testId: "real-total", label: "Real property accounts checked", value: count(r.total) }), _jsx(Tile, { testId: "real-naive", label: "Independent implementation agrees on everything", value: `${count(r.naiveAgreedAll)} of ${count(r.total)}`, detail: "Verdict, score, knockouts and deciding factor" }), _jsx(Tile, { testId: "real-second", label: "Second-opinion model agrees on the verdict", value: `${count(r.secondOpinionAgreed)} of ${count(r.secondOpinionAnswered)}`, detail: `${count(r.secondOpinionAnswered)} of ${count(r.total)} answered` })] }), _jsx("p", { style: { ...MUTED, marginTop: SPACE.md }, children: `Checked ${formatDate(r.generatedAt)}.` })] })) }));
}
const STRATUM_COLUMNS = [
    { key: 'stratum', header: 'Kind of case', render: (s) => humanize(s.stratum), sortValue: (s) => humanize(s.stratum) },
    { key: 'total', header: 'Cases', align: 'right', render: (s) => count(s.total), sortValue: (s) => s.total },
    { key: 'agreed', header: 'Agreed', align: 'right', render: (s) => count(s.agreed), sortValue: (s) => s.agreed },
    {
        key: 'rate',
        header: 'Agreement',
        align: 'right',
        render: (s) => (s.rate === null ? 'No answered cases' : formatPercent(s.rate, { decimals: 1 })),
        sortValue: (s) => s.rate,
    },
];
function Strata(props) {
    const c = props.data.layerC;
    if (c === null)
        return null;
    return (_jsxs(Card, { title: "Second opinion by kind of case", anchorId: "v-strata", aside: pluralize(c.byStratum.length, 'stratum', 'strata'), children: [_jsx("p", { style: MUTED, "data-testid": "strata-note", children: `${count(c.unanswered)} unanswered, left out of every count · ${count(c.decidingFactorAgreed)} of ${count(c.agreed)} agreeing cases also named the same deciding factor.` }), _jsx(DataTable, { caption: "Second-opinion agreement by stratum", columns: STRATUM_COLUMNS, rows: c.byStratum, rowKey: (s) => s.stratum, emptyLabel: "No strata." })] }));
}
function Disagreement(props) {
    const { d, open } = props;
    const tiers = Object.entries(d.engine.tierValuesByFactor);
    const delta = `The engine says ${formatVerdict(d.engine.verdict)}; the model says ${formatVerdict(d.model.verdict)}.`;
    return (_jsxs("details", { "data-testid": `disagreement-${d.caseId}`, open: open, style: { borderTop: `1px solid ${cssVar('mutedTint')}`, padding: `${SPACE.xs}px 0` }, children: [_jsxs("summary", { style: SUMMARY, children: [_jsx(Link, { to: submissionPath(d.caseId), "data-testid": `disagreement-link-${d.caseId}`, children: d.caseId }), _jsx("span", { style: MUTED, children: humanize(d.stratum) }), _jsx("span", { children: delta })] }), _jsxs("div", { style: SIDES, children: [_jsxs("section", { style: SIDE, "aria-label": "The engine's side", "data-side": "engine", children: [_jsx("h4", { style: { margin: 0 }, children: "The engine" }), _jsxs("p", { style: { margin: `${SPACE.sm}px 0 0` }, children: [_jsx(VerdictPill, { verdict: d.engine.verdict }), ' ', `${formatScore(d.engine.appetiteScore, { outOf: true })} · deciding factor: ${factor(d.engine.decidingFactorId)}`] }), _jsx("p", { style: { ...MUTED, marginTop: SPACE.sm }, children: `Knockouts: ${d.engine.knockoutFactorIds.length === 0 ? 'none' : d.engine.knockoutFactorIds.map(factor).join(', ')} · completeness ${formatPercent(d.engine.completeness, { from: 'percent', decimals: 1 })}` }), _jsxs("table", { "aria-label": `Engine tier per factor, case ${d.caseId}`, children: [_jsx("caption", { style: { ...MUTED, textAlign: 'left' }, children: "Tier per factor" }), _jsx("tbody", { children: tiers.map(([f, t]) => (_jsxs("tr", { children: [_jsx("th", { scope: "row", style: { fontWeight: 400 }, children: factor(f) }), _jsx("td", { style: { textAlign: 'right' }, children: t === null ? 'Unknown' : String(t) })] }, f))) })] })] }), _jsxs("section", { style: SIDE, "aria-label": "The second-opinion model's side", "data-side": "model", children: [_jsx("h4", { style: { margin: 0 }, children: "The second-opinion model" }), _jsxs("p", { style: { margin: `${SPACE.sm}px 0 0` }, children: [_jsx(VerdictPill, { verdict: d.model.verdict }), " ", `deciding factor: ${factor(d.model.decidingFactor)}`] }), _jsx(CitationQuote, { citation: { document: 'Second-opinion model', quote: d.model.reasoning } })] })] })] }));
}
function Disagreements(props) {
    const c = props.data.layerC;
    if (c === null)
        return null;
    return (_jsx(Card, { title: "Every disagreement, both sides", anchorId: "v-disagreements", aside: pluralize(c.disagreements.length, 'disagreement'), children: c.disagreements.length === 0 ? (_jsx("p", { style: MUTED, children: "No disagreements." })) : (c.disagreements.map((d, i) => _jsx(Disagreement, { d: d, open: i === 0 }, d.caseId))) }));
}
function Found(props) {
    const f = props.data.defectsFound;
    return (_jsxs(Card, { title: "What the testing found", anchorId: "v-found", aside: pluralize(f.defects.length, 'fix', 'fixes'), children: [_jsxs("p", { style: MUTED, "data-testid": "found-lead", children: [f.cp1InvariantViolations !== null && f.cp1Disagreements !== null
                        ? `The first differential run reported ${count(f.cp1InvariantViolations)} invariant violations and ${count(f.cp1Disagreements)} disagreements.`
                        : '', f.run2Confirmed !== null
                        ? ` A review over the real Federato data then confirmed ${count(f.run2Confirmed)} defects${f.run2Refuted !== null ? ` and refuted ${count(f.run2Refuted)}` : ''}.`
                        : '', ' All were fixed and are pinned by tests.'] }), f.defects.length === 0 ? (_jsx("p", { style: MUTED, children: "No defects listed." })) : (_jsx("ol", { style: { margin: `${SPACE.md}px 0 0`, paddingLeft: SPACE.xl }, children: f.defects.map((d) => (_jsxs("li", { "data-testid": `defect-${d.id}`, style: { marginBottom: SPACE.md }, children: [_jsx("strong", { children: d.title }), _jsx("span", { style: { ...MUTED, display: 'inline' }, children: ` (${d.id}, ${d.phase})` }), _jsx("p", { style: { margin: `${SPACE.xs}px 0 0`, maxWidth: '72ch' }, children: d.detail })] }, d.id))) }))] }));
}
function VerificationBody(props) {
    const { data } = props;
    return (_jsxs(_Fragment, { children: [_jsx(SectionIndex, {}), _jsx(Headline, { data: data }), data.layersAB !== null ? _jsx(VerificationField, {}) : null, _jsx(RealAccounts, { data: data }), _jsx(Strata, { data: data }), _jsx(Disagreements, { data: data }), _jsx(Found, { data: data }), _jsx("p", { style: MUTED, "data-testid": "sources", children: `Read from: ${data.sources.join(', ')}.` })] }));
}
/** /verification: the testing in full, for a judge or an underwriter. */
export function VerificationPage() {
    const state = useApi((client) => client.getVerification(), []);
    return (_jsxs("section", { "aria-labelledby": "rf-verification-title", style: PAGE, children: [_jsx(Breadcrumb, {}), _jsx("h1", { id: "rf-verification-title", style: { margin: 0 }, children: "Verification" }), state.error !== null ? (_jsxs("div", { role: "alert", style: BOX, children: [_jsx("p", { style: { margin: 0 }, children: `Could not load the verification: ${state.error.message}` }), _jsx("button", { type: "button", onClick: state.reload, style: { minHeight: MIN_TOUCH_TARGET, marginTop: SPACE.md }, children: "Retry" })] })) : state.data === null ? (_jsx(Skeleton, { label: "Loading verification", lines: 8 })) : (_jsx(VerificationBody, { data: state.data }))] }));
}
//# sourceMappingURL=VerificationPage.js.map