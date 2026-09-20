import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Link } from 'react-router';
import { formatDate, formatPercent, formatScore, formatVerdict, pluralize } from '@retrofit/contracts';
import { SPACE, cssVar } from '@retrofit/design';
import { ROUTES } from '../App.js';
import { useApi } from '../api/useApi.js';
import { Card } from '../components/atoms/Card.js';
import { Skeleton } from '../components/atoms/Skeleton.js';
import { VerdictPill } from '../components/atoms/VerdictPill.js';
/*
 * /verification — the testing in full, rendered from GET /verification
 * (FILL-backend D7). Every number on this page is a DTO value, formatted only:
 * nothing is summed, divided or re-derived here (PRD 10, 13). A block the API
 * returns as null says in words that its file was not found.
 */
/* -------------------------------------------------------------------------- */
/* Styles                                                                      */
/* -------------------------------------------------------------------------- */
const PAGE = { display: 'flex', flexDirection: 'column', gap: SPACE.xl };
const TILE_ROW = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
    gap: SPACE.lg,
    margin: 0,
};
const TILE = {
    border: `1px solid ${cssVar('muted-tint')}`,
    borderRadius: cssVar('radius-card'),
    padding: SPACE.lg,
    margin: 0,
};
const TILE_VALUE = {
    fontFamily: cssVar('font-display'),
    fontSize: cssVar('size-title'),
    lineHeight: cssVar('leading-title'),
    display: 'block',
};
const MUTED = {
    fontSize: cssVar('size-small'),
    lineHeight: cssVar('leading-small'),
    color: cssVar('muted-deep'),
    margin: 0,
};
const LEAD = { maxWidth: '72ch', margin: 0 };
const SIDES = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
    gap: SPACE.lg,
    marginTop: SPACE.md,
};
const SIDE = { ...TILE, padding: SPACE.lg };
const QUOTE = {
    margin: `${SPACE.sm}px 0 0`,
    padding: `${SPACE.sm}px 0 ${SPACE.sm}px ${SPACE.lg}px`,
    borderLeft: `3px solid ${cssVar('muted-tint')}`,
    whiteSpace: 'pre-wrap',
};
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
function Tile(props) {
    return (_jsxs("div", { style: TILE, "data-testid": props.testId, children: [_jsx("dt", { style: MUTED, children: props.label }), _jsxs("dd", { style: { margin: 0 }, children: [_jsx("span", { style: TILE_VALUE, children: props.value }), props.note !== undefined ? _jsx("span", { style: { ...MUTED, display: 'block' }, children: props.note }) : null] })] }));
}
function Missing(props) {
    return (_jsx("p", { style: MUTED, "data-testid": "block-missing", children: `${props.what}: no result file was found (${props.file}), so there is nothing to show.` }));
}
/* -------------------------------------------------------------------------- */
/* Sections                                                                    */
/* -------------------------------------------------------------------------- */
function Headline(props) {
    const { layersAB, layerC, extraction } = props.data;
    return (_jsxs(Card, { title: "The headline", children: [_jsxs("dl", { style: TILE_ROW, "aria-label": "Verification headline", children: [layersAB !== null ? (_jsxs(_Fragment, { children: [_jsx(Tile, { testId: "v-cases", label: "Property + differential cases", value: count(layersAB.completed), note: `of ${count(layersAB.requested)} requested · ${pluralize(layersAB.workers, 'worker')} · seed ${layersAB.seed}` }), _jsx(Tile, { testId: "v-violations", label: "Invariant violations", value: count(layersAB.invariantViolations), note: "Layer A: the engine's own laws" }), _jsx(Tile, { testId: "v-disagreements", label: "Disagreements with the independent implementation", value: count(layersAB.disagreements), note: "Layer B: same input, same answer" }), _jsx(Tile, { testId: "v-errors", label: "Crashes or errors", value: count(layersAB.errors) })] })) : null, layerC !== null ? (_jsx(Tile, { testId: "v-agreement", label: "Second-opinion agreement", value: formatPercent(layerC.agreement.point, { decimals: 1 }), note: `${count(layerC.agreed)} of ${count(layerC.judged)} · ${formatPercent(layerC.agreement.confidence)} interval ${formatPercent(layerC.agreement.low, { decimals: 1 })}–${formatPercent(layerC.agreement.high, { decimals: 1 })}` })) : null, _jsx(Tile, { testId: "v-extraction", label: "Reply-extraction accuracy", value: extraction.status === 'measured' && extraction.fieldAccuracy !== null
                            ? formatPercent(extraction.fieldAccuracy, { decimals: 1 })
                            : 'Not measured' })] }), layersAB === null ? _jsx(Missing, { what: "Layers A and B", file: "packages/verify/out/run.json" }) : null, layerC === null ? _jsx(Missing, { what: "Layer C", file: "packages/verify/out/layer-c.json" }) : null, extraction.status !== 'measured' ? (_jsxs("div", { "data-testid": "extraction-reason", style: { marginTop: SPACE.lg }, children: [_jsx("h3", { style: { fontSize: cssVar('size-body'), margin: 0 }, children: "Why reply extraction is not measured" }), _jsx("p", { style: { ...LEAD, marginTop: SPACE.xs }, children: extraction.reason ?? 'The API gave no reason.' })] })) : null, layersAB !== null ? (_jsx("p", { style: { ...MUTED, marginTop: SPACE.lg }, children: `Run ${formatDate(layersAB.startedAt)} at ${formatScore(layersAB.casesPerSecond)} cases per second.` })) : null] }));
}
function RealAccounts(props) {
    const r = props.data.realAccounts;
    return (_jsx(Card, { title: "The real property accounts", children: r === null ? (_jsx(Missing, { what: "Per-account checks", file: "packages/verify/out/per-account.json" })) : (_jsxs(_Fragment, { children: [_jsxs("dl", { style: TILE_ROW, "aria-label": "Real account checks", children: [_jsx(Tile, { testId: "real-total", label: "Real property accounts checked", value: count(r.total) }), _jsx(Tile, { testId: "real-naive", label: "Independent implementation agrees on everything", value: `${count(r.naiveAgreedAll)} of ${count(r.total)}`, note: "Verdict, score, knockouts and deciding factor" }), _jsx(Tile, { testId: "real-second", label: "Second-opinion model agrees on the verdict", value: `${count(r.secondOpinionAgreed)} of ${count(r.secondOpinionAnswered)}`, note: `${count(r.secondOpinionAnswered)} of ${count(r.total)} answered` })] }), _jsxs("p", { style: { ...MUTED, marginTop: SPACE.md }, children: ["Each real property account shows its own result under \u201CIndependent checks\u201D on its page.", ` Checked ${formatDate(r.generatedAt)}.`] })] })) }));
}
function Strata(props) {
    const c = props.data.layerC;
    if (c === null)
        return null;
    return (_jsxs(Card, { title: "Second opinion by kind of case", aside: pluralize(c.byStratum.length, 'stratum', 'strata'), children: [_jsxs("p", { style: LEAD, children: ["Cases are chosen to sit on every threshold and every ambiguity in the guidelines, where a disagreement is most likely. ", `${count(c.unanswered)} cases were never answered and are left out of every count. Of the ${count(c.agreed)} agreeing cases, ${count(c.decidingFactorAgreed)} also named the same deciding factor.`] }), _jsx("div", { className: "rf-scroll-x", style: { marginTop: SPACE.md }, children: _jsxs("table", { "aria-label": "Second-opinion agreement by stratum", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { scope: "col", children: "Kind of case" }), _jsx("th", { scope: "col", style: { textAlign: 'right' }, children: "Cases" }), _jsx("th", { scope: "col", style: { textAlign: 'right' }, children: "Agreed" }), _jsx("th", { scope: "col", style: { textAlign: 'right' }, children: "Agreement" })] }) }), _jsx("tbody", { children: c.byStratum.map((s) => (_jsxs("tr", { "data-testid": `stratum-${s.stratum}`, children: [_jsx("th", { scope: "row", style: { fontWeight: 400, color: cssVar('ink') }, children: humanize(s.stratum) }), _jsx("td", { style: { textAlign: 'right' }, children: count(s.total) }), _jsx("td", { style: { textAlign: 'right' }, children: count(s.agreed) }), _jsx("td", { style: { textAlign: 'right' }, children: s.rate === null ? 'No answered cases' : formatPercent(s.rate, { decimals: 1 }) })] }, s.stratum))) })] }) })] }));
}
function Disagreement(props) {
    const { d } = props;
    const tiers = Object.entries(d.engine.tierValuesByFactor);
    return (_jsxs("article", { "data-testid": `disagreement-${d.caseId}`, "aria-labelledby": `dis-${d.caseId}`, style: { marginTop: SPACE.lg }, children: [_jsx("h3", { id: `dis-${d.caseId}`, style: { margin: 0, fontSize: cssVar('size-body') }, children: `Case ${d.caseId} · ${humanize(d.stratum)}` }), _jsxs("div", { style: SIDES, children: [_jsxs("section", { style: SIDE, "aria-label": "The engine's side", "data-side": "engine", children: [_jsx("h4", { style: { margin: 0 }, children: "The engine" }), _jsxs("p", { style: { margin: `${SPACE.sm}px 0 0` }, children: [_jsx(VerdictPill, { verdict: d.engine.verdict }), ' ', `${formatScore(d.engine.appetiteScore, { outOf: true })} · deciding factor: ${factor(d.engine.decidingFactorId)}`] }), _jsx("p", { style: { ...MUTED, marginTop: SPACE.sm }, children: `Knockouts: ${d.engine.knockoutFactorIds.length === 0 ? 'none' : d.engine.knockoutFactorIds.map(factor).join(', ')} · completeness ${formatPercent(d.engine.completeness, { from: 'percent', decimals: 1 })}` }), _jsx("p", { style: { ...MUTED, marginTop: SPACE.sm }, children: "Its reasoning is the tier it gave each factor (1 target, 0.6 acceptable, 0 not acceptable):" }), _jsx("table", { "aria-label": `Engine tier per factor, case ${d.caseId}`, children: _jsx("tbody", { children: tiers.map(([f, t]) => (_jsxs("tr", { children: [_jsx("th", { scope: "row", style: { fontWeight: 400 }, children: factor(f) }), _jsx("td", { style: { textAlign: 'right' }, children: t === null ? 'Unknown' : String(t) })] }, f))) }) })] }), _jsxs("section", { style: SIDE, "aria-label": "The second-opinion model's side", "data-side": "model", children: [_jsx("h4", { style: { margin: 0 }, children: "The second-opinion model" }), _jsxs("p", { style: { margin: `${SPACE.sm}px 0 0` }, children: [_jsx(VerdictPill, { verdict: d.model.verdict }), ' ', `deciding factor: ${factor(d.model.decidingFactor)}`] }), _jsx("p", { style: { ...MUTED, marginTop: SPACE.sm }, children: "Its written reasoning:" }), _jsx("blockquote", { style: QUOTE, children: d.model.reasoning })] })] }), _jsx("p", { style: { ...MUTED, marginTop: SPACE.sm }, children: `The engine says ${formatVerdict(d.engine.verdict)}; the model says ${formatVerdict(d.model.verdict)}. The model is the less reliable party: a disagreement is a lead, not proof the engine is wrong.` })] }));
}
function Disagreements(props) {
    const c = props.data.layerC;
    if (c === null)
        return null;
    return (_jsx(Card, { title: "Every disagreement, both sides", aside: pluralize(c.disagreements.length, 'disagreement'), children: c.disagreements.length === 0 ? (_jsx("p", { style: LEAD, children: "The second-opinion model agreed with the engine on every case it answered." })) : (c.disagreements.map((d) => _jsx(Disagreement, { d: d }, d.caseId))) }));
}
function Found(props) {
    const f = props.data.defectsFound;
    return (_jsxs(Card, { title: "What the testing found", aside: pluralize(f.defects.length, 'fix', 'fixes'), children: [_jsxs("p", { style: LEAD, "data-testid": "found-lead", children: ["The zeros above came after the testing found real bugs, which is the point of it.", f.cp1InvariantViolations !== null && f.cp1Disagreements !== null
                        ? ` The first differential run reported ${count(f.cp1InvariantViolations)} invariant violations and ${count(f.cp1Disagreements)} disagreements.`
                        : '', f.run2Confirmed !== null
                        ? ` A review over the real Federato data then confirmed ${count(f.run2Confirmed)} defects${f.run2Refuted !== null ? ` and refuted ${count(f.run2Refuted)}` : ''}.`
                        : '', ' All were fixed and are pinned by tests. The ones that mattered most:'] }), f.defects.length === 0 ? (_jsx("p", { style: MUTED, children: "No defect rows were found in DECISIONS.md." })) : (_jsx("ol", { style: { margin: `${SPACE.md}px 0 0`, paddingLeft: SPACE.xl }, children: f.defects.map((d) => (_jsxs("li", { "data-testid": `defect-${d.id}`, style: { marginBottom: SPACE.md }, children: [_jsx("strong", { children: d.title }), _jsx("span", { style: { ...MUTED, display: 'inline' }, children: ` (${d.id}, ${d.phase})` }), _jsx("p", { style: { margin: `${SPACE.xs}px 0 0`, maxWidth: '72ch' }, children: d.detail })] }, d.id))) }))] }));
}
function VerificationBody(props) {
    const { data } = props;
    return (_jsxs(_Fragment, { children: [_jsxs("p", { style: LEAD, children: ["Three independent checks stand behind every verdict. ", _jsx("strong", { children: "Layer A" }), " feeds the engine generated submissions and checks it obeys its own laws: the same input always gives the same answer, improving a factor never lowers the score, a knockout always declines.", ' ', _jsx("strong", { children: "Layer B" }), " runs the same cases through a second, deliberately naive implementation written straight from the guideline table with no shared code; any difference is a bug in one of them. ", _jsx("strong", { children: "Layer C" }), " asks a language model, given only the guideline text and the facts, what verdict it would reach."] }), _jsx(Headline, { data: data }), _jsx(RealAccounts, { data: data }), _jsx(Strata, { data: data }), _jsx(Disagreements, { data: data }), _jsx(Found, { data: data }), _jsxs("p", { style: MUTED, "data-testid": "sources", children: [`Read from: ${data.sources.join(', ')}.`, " ", _jsx(Link, { to: ROUTES.aggregate, children: "Back to the aggregate" })] })] }));
}
/** /verification: the testing in full, for a judge or an underwriter. */
export function VerificationPage() {
    const state = useApi((client) => client.getVerification(), []);
    return (_jsxs("section", { "aria-labelledby": "rf-verification-title", style: PAGE, children: [_jsx("h1", { id: "rf-verification-title", style: { margin: 0 }, children: "Verification" }), state.error !== null ? (_jsxs("div", { role: "alert", style: TILE, children: [_jsx("p", { style: { margin: 0 }, children: `Could not load the verification: ${state.error.message}` }), _jsx("button", { type: "button", onClick: state.reload, style: { marginTop: SPACE.md }, children: "Retry" })] })) : state.data === null ? (_jsx(Skeleton, { label: "Loading verification", lines: 8 })) : (_jsx(VerificationBody, { data: state.data }))] }));
}
//# sourceMappingURL=VerificationPage.js.map