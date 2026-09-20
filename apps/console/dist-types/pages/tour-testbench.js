import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveBaseUrl } from '../api/useApi.js';
const AUTO_LIMIT = 40;
const AUTO_EVERY_MS = 1500;
const count = (n) => n.toLocaleString('en-US');
function words(id) {
    const text = id.replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\btiv\b/gi, 'TIV').trim();
    return text.length === 0 ? id : `${text.charAt(0).toUpperCase()}${text.slice(1).toLowerCase()}`.replace(/\btiv\b/gi, 'TIV');
}
function money(n) {
    if (n >= 1_000_000)
        return `$${Number((n / 1_000_000).toFixed(1))}M`;
    if (n >= 1_000)
        return `$${Math.round(n / 1_000)}K`;
    return `$${Number(n.toFixed(2)).toLocaleString('en-US')}`;
}
function fact(key, v) {
    if (v === null)
        return 'missing';
    if (typeof v === 'number') {
        if (key.startsWith('pct'))
            return `${Number((v * 100).toFixed(2))}% of TIV`;
        return money(v);
    }
    if (typeof v === 'boolean')
        return v ? 'yes' : 'no';
    if (v.trim() === '')
        return 'empty text';
    return key === 'primaryState' ? v : words(v);
}
const FACT_LABELS = {
    totalTiv: 'TIV',
    pctTivPre1990: 'Built before 1990',
    pctTivPost2010: 'Built 2010 or later',
    pctTivAcceptableConstruction: 'Acceptable construction',
    fiveYearLoss: 'Five-year loss',
};
const PLACED = {
    at: 'on the line',
    under: 'just under',
    over: 'just over',
};
async function getJson(path, signal) {
    const res = await fetch(`${resolveBaseUrl()}${path}`, { headers: { accept: 'application/json' }, ...(signal ? { signal } : {}) });
    if (!res.ok)
        throw new Error(`HTTP ${res.status}`);
    return (await res.json());
}
const tier = (label) => (label === null ? 'missing' : words(label));
/** One row of the engine-versus-blind-copy table. `same` comes from the API's comparator where it reports the field. */
function Row(props) {
    return (_jsxs("tr", { "data-same": props.same, "data-strong": props.strong ?? false, children: [_jsx("th", { scope: "row", title: props.title, children: props.label }), _jsx("td", { children: props.engine }), _jsx("td", { children: props.naive }), _jsx("td", { className: "rf-bench__eq", "aria-label": props.same ? 'identical' : 'different', children: props.same ? '=' : '≠' })] }));
}
function Ledger(props) {
    const { c } = props;
    const facts = Object.entries(c.input).filter(([key]) => !['anyBuildingPre1990', 'hasOpenHighContradiction'].includes(key));
    const differs = new Set(c.disagreements.map((d) => d.field));
    const broken = c.invariants.filter((i) => i.violations.length > 0).length;
    const rule = c.engine.decidingRule;
    return (_jsxs("div", { className: "rf-bench__ledger", children: [_jsxs("div", { className: "rf-bench__caseline", children: [_jsx("span", { className: "rf-bench__caseid", children: `Case ${count(c.index)}` }), _jsx("span", { children: `seed ${c.seed}` }), _jsx("span", { children: c.fromSubmission ? `rolled up from ${c.buildings?.length ?? 0} generated buildings` : 'generated as rolled-up facts' }), c.stratum !== null ? _jsx("span", { children: words(c.stratum) }) : null] }), _jsxs("div", { className: "rf-bench__split", children: [_jsxs("table", { className: "rf-bench__table", children: [_jsx("caption", { children: "Generated input" }), _jsxs("colgroup", { children: [_jsx("col", {}), _jsx("col", { className: "rf-bench__col-value" }), _jsx("col", { className: "rf-bench__col-edge" })] }), _jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { scope: "col", children: "Fact" }), _jsx("th", { scope: "col", className: "rf-bench__num", children: "Value" }), _jsx("th", { scope: "col", children: "Aimed" })] }) }), _jsx("tbody", { children: facts.map(([key, v]) => {
                                    const placed = PLACED[c.boundaries[key] ?? ''];
                                    return (_jsxs("tr", { "data-edge": placed !== undefined, children: [_jsx("th", { scope: "row", children: FACT_LABELS[key] ?? words(key) }), _jsx("td", { className: "rf-bench__num", children: fact(key, v) }), _jsx("td", { className: "rf-bench__edge", children: placed ?? '' })] }, key));
                                }) })] }), _jsxs("table", { className: "rf-bench__table rf-bench__table--versus", children: [_jsx("caption", { children: "Two implementations, compared field by field" }), _jsxs("colgroup", { children: [_jsx("col", {}), _jsx("col", { className: "rf-bench__col-side" }), _jsx("col", { className: "rf-bench__col-side" }), _jsx("col", { className: "rf-bench__col-eq" })] }), _jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { scope: "col", children: "Field" }), _jsx("th", { scope: "col", children: "Engine" }), _jsx("th", { scope: "col", children: "Blind copy" }), _jsx("th", { scope: "col" })] }) }), _jsxs("tbody", { children: [_jsx(Row, { strong: true, label: "Verdict", engine: words(c.engine.verdict), naive: words(c.naive.verdict), same: !differs.has('verdict') }), _jsx(Row, { strong: true, label: "Appetite score", engine: c.engine.appetiteScore.toFixed(2), naive: c.naive.appetiteScore.toFixed(2), same: !differs.has('appetiteScore') }), _jsx(Row, { label: "Completeness", engine: c.engine.completeness.toFixed(0), naive: c.naive.completeness.toFixed(0), same: !differs.has('completeness') }), _jsx(Row, { label: "Decided by", engine: words(c.engine.decidingFactorId ?? 'none'), naive: words(c.naive.decidingFactorId ?? 'none'), same: !differs.has('decidingFactorId') }), c.factors.map((f) => (_jsx(Row, { label: words(f.factor), title: `Engine tier: ${tier(f.tier).toLowerCase()}`, engine: `${f.points.toFixed(1)} pts`, naive: f.naivePoints === null ? 'missing' : `${f.naivePoints.toFixed(1)} pts`, same: f.tierValue === f.naiveTierValue }, f.factor)))] })] })] }), _jsxs("div", { className: "rf-bench__foot", children: [_jsxs("div", { children: [_jsx("span", { className: "rf-bench__label", children: "Deciding rule" }), rule !== null ? (_jsxs("p", { className: "rf-bench__rule", children: ["\u201C", rule.citation.quote, "\u201D", _jsx("span", { children: ` ${rule.citation.doc}, ${rule.citation.section.replace(/"/g, '')} · ${rule.ruleId}` })] })) : (_jsx("p", { className: "rf-bench__rule", children: _jsx("span", { children: "No single rule decided this case." }) }))] }), _jsxs("div", { children: [_jsx("span", { className: "rf-bench__label", children: `Invariants · ${c.invariants.length - broken} of ${c.invariants.length} held` }), _jsx("ul", { className: "rf-bench__laws", children: c.invariants.map((i) => (_jsx("li", { "data-ok": i.violations.length === 0, children: words(i.name).toLowerCase() }, `${i.suite}.${i.name}`))) })] })] })] }, c.index));
}
export function TestBench() {
    const [head, setHead] = useState(null);
    const [c, setC] = useState(null);
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(null);
    const [auto, setAuto] = useState(false);
    const [pulled, setPulled] = useState(0);
    const inFlight = useRef(false);
    useEffect(() => {
        const abort = new AbortController();
        getJson('/verification/field', abort.signal).then(setHead, () => undefined);
        return () => abort.abort();
    }, []);
    const pull = useCallback(async (index) => {
        if (head === null || inFlight.current)
            return;
        inFlight.current = true;
        setBusy(true);
        setFailed(null);
        try {
            const next = await getJson(`/verification/cases/${index ?? Math.floor(Math.random() * head.total)}`);
            setC(next);
            setPulled((n) => n + 1);
        }
        catch (err) {
            setFailed(err instanceof Error ? err.message : String(err));
            setAuto(false);
        }
        finally {
            inFlight.current = false;
            setBusy(false);
        }
    }, [head]);
    useEffect(() => {
        if (!auto)
            return;
        if (pulled >= AUTO_LIMIT) {
            setAuto(false);
            return;
        }
        const id = setTimeout(() => void pull(), c === null ? 0 : AUTO_EVERY_MS);
        return () => clearTimeout(id);
    }, [auto, pulled, pull, c]);
    if (head === null)
        return null;
    return (_jsxs("section", { className: "rf-bench", "aria-label": "Test bench", "data-testid": "test-bench", children: [_jsxs("div", { className: "rf-bench__head", children: [_jsxs("div", { children: [_jsx("h3", { className: "rf-bench__heading", children: "Don\u2019t take the zeros on trust. Re-run one." }), _jsx("p", { className: "rf-bench__lede", children: `Every one of the ${count(head.total)} cases is rebuilt from two numbers, a seed and an index. Pull any of them and the API generates it again and puts it through the same five steps the run did, right now.` })] }), _jsxs("div", { className: "rf-bench__controls", children: [_jsx("button", { type: "button", className: "rf-tour__chip", "data-testid": "bench-pull", disabled: busy || auto, onClick: () => void pull(), children: c === null ? 'Pull a case' : 'Pull another' }), _jsx("button", { type: "button", className: "rf-tour__chip", "aria-pressed": auto, onClick: () => setAuto((a) => !a), children: auto ? 'Stop' : 'Keep pulling' })] })] }), failed !== null ? _jsx("p", { role: "alert", children: `Could not rebuild a case: ${failed}` }) : null, c === null ? (_jsx("p", { className: "rf-bench__idle", children: "Generate \u2192 engine \u2192 blind copy \u2192 compare \u2192 invariants. Nothing is replayed from a recording." })) : (_jsx(Ledger, { c: c }))] }));
}
//# sourceMappingURL=tour-testbench.js.map