import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link } from 'react-router';
import { formatMoney, formatScore, pluralize } from '@retrofit/contracts';
import { submissionPath } from '../App.js';
import { Card } from '../components/atoms/Card.js';
import { VerdictPill } from '../components/atoms/VerdictPill.js';
/**
 * A full vector compares components 2–10 (nine); an account with no policy is
 * placed by a reduced vector of three (requested limit, insured revenue,
 * headquarters state) — PRD 6.4. At or under this many compared components the
 * benchmark is labelled a coarse match.
 */
const COARSE_MATCH_MAX_COMPONENTS = 3;
/**
 * PRD 10 (d) The five nearest accounts with distance, rate and losses.
 *
 * Rows render in the order the engine returned them (distance ascending, ties
 * by id — INTERPRETATIONS P-4); the median and mean are the engine's (P-3).
 */
export function PeerBenchmark(props) {
    const { benchmark } = props;
    const { peers } = benchmark;
    const coarse = benchmark.comparedComponentCount > 0 &&
        benchmark.comparedComponentCount <= COARSE_MATCH_MAX_COMPONENTS;
    return (_jsxs(Card, { title: "Peer benchmark", anchorId: "peers", aside: _jsxs("span", { "data-testid": "peer-count", children: [pluralize(peers.length, 'nearest account'), coarse ? ' · coarse match' : ''] }), children: [_jsxs("dl", { className: "rf-stats", children: [_jsxs("div", { className: "rf-stat", "data-testid": "peer-median-rate", children: [_jsx("dt", { children: "Peer median rate per $100 TIV" }), _jsx("dd", { children: formatMoney(benchmark.medianRatePer100Tiv, { decimals: 2 }) })] }), _jsxs("div", { className: "rf-stat", "data-testid": "peer-mean-loss", children: [_jsx("dt", { children: "Peer mean annual loss" }), _jsx("dd", { children: formatMoney(benchmark.meanAnnualLoss) })] }), _jsxs("div", { className: "rf-stat", "data-testid": "peer-compared", children: [_jsx("dt", { children: "Components compared" }), _jsx("dd", { children: benchmark.comparedComponentCount })] })] }), coarse ? (_jsx("p", { className: "rf-footnote", "data-testid": "peer-coarse", children: "Coarse match: this account has no policy, so it is placed by requested limit, insured revenue and headquarters state only." })) : null, peers.length === 0 ? (_jsx("p", { className: "rf-empty", children: "No comparable accounts share enough known components." })) : (_jsx("div", { className: "rf-scroll-x", children: _jsxs("table", { className: "rf-table", "aria-label": "Nearest accounts", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { scope: "col", children: "Account" }), _jsx("th", { scope: "col", children: "Distance" }), _jsx("th", { scope: "col", children: "Rate per $100 TIV" }), _jsx("th", { scope: "col", children: "Annual loss" }), _jsx("th", { scope: "col", children: "Verdict" })] }) }), _jsx("tbody", { children: peers.map((p) => (_jsxs("tr", { "data-testid": "peer-row", children: [_jsx("th", { scope: "row", children: _jsx(Link, { to: submissionPath(p.submissionId), children: p.insuredName }) }), _jsx("td", { children: formatScore(p.distance, { decimals: 3 }) }), _jsx("td", { children: formatMoney(p.ratePer100Tiv, { decimals: 2 }) }), _jsx("td", { children: formatMoney(p.annualLoss) }), _jsx("td", { "data-testid": "peer-verdict", children: p.verdict !== null ? _jsx(VerdictPill, { verdict: p.verdict }) : 'No stored result' })] }, p.submissionId))) })] }) })), _jsx("p", { className: "rf-footnote", children: "A benchmark on rate and loss only. Every account with a full vector in this book was bound, so peers say nothing about bound versus declined." })] }));
}
//# sourceMappingURL=PeerBenchmark.js.map