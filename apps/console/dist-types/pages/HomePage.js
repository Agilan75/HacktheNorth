import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link } from 'react-router';
import { ROUTES } from '../routes.js';
/** The engine's stage chain, condensed to the six stages worth showing. */
const STAGES = [
    { name: 'normalize', gloss: 'one canonical record' },
    { name: 'rollup', gloss: 'TIV, states, ages, losses' },
    { name: 'merge', gloss: 'enrichment, answers, camera' },
    { name: 'vectorize', gloss: 'values become tiers' },
    { name: 'evaluate', gloss: 'tiers become a score' },
    { name: 'price + verdict', gloss: 'premium and deciding rule' },
];
const RAIL = [
    { to: ROUTES.queue, label: 'Queue', gloss: '158 accounts, ranked' },
    { to: ROUTES.rules, label: 'Rules', gloss: 'the guidelines, quoted' },
    { to: ROUTES.aggregate, label: 'Aggregate', gloss: 'the book in numbers' },
    { to: ROUTES.explore, label: 'Explore', gloss: 'appetite terrain in 3D' },
    { to: ROUTES.verification, label: 'Verification', gloss: 'three layers of testing' },
];
const SPEC = [
    { label: 'Language', value: 'TypeScript ESM end to end, Node 24' },
    {
        label: 'Workspaces',
        value: 'npm, 8 packages — engine, federato, contracts, design, verify, api, console, mobile',
    },
    {
        label: 'Engine',
        value: 'packages/engine is pure: zero I/O, no clock, no randomness, no LLM SDK. Same input, same output.',
    },
    { label: 'Server', value: 'Hono with better-sqlite3 and Drizzle, one SQLite file' },
    { label: 'Console', value: 'Vite and React 19' },
    { label: 'Phone', value: 'Expo' },
    { label: 'Model', value: 'Gemini, reached only through the API server' },
    { label: 'Secrets', value: 'root .env only — nothing secret reaches the console or the phone' },
];
/**
 * The landing page at `/`: what Retrofit is, how the pipeline runs, what it
 * runs on, and five ways into the console. One screen plus a little scroll.
 */
export function HomePage() {
    return (_jsxs("div", { className: "rf-home", children: [_jsxs("section", { className: "rf-home__hero", "aria-labelledby": "home-title", children: [_jsx("h1", { id: "home-title", children: "Retrofit" }), _jsx("p", { className: "rf-home__lede", children: "One deterministic underwriting engine with two front doors: a console that ranks Federato\u2019s live submission book against the carrier\u2019s appetite guidelines, and a phone app where the camera replaces most of the quote form." }), _jsx("p", { className: "rf-home__thesis", children: "Underwriting runs on what the broker typed. We built the camera that checks." }), _jsxs("p", { className: "rf-home__principle", children: [_jsx("strong", { children: "Gemini sees; the engine decides." }), " No model decides a verdict, a score, or a dollar amount."] }), _jsxs("p", { className: "rf-home__cta", children: [_jsx(Link, { to: ROUTES.queue, className: "rf-button rf-button--primary", children: "Open the queue" }), _jsx(Link, { to: ROUTES.explore, className: "rf-button", children: "See the book in 3D" }), _jsx(Link, { to: ROUTES.tour, className: "rf-button", children: "Walk the room" })] })] }), _jsxs("section", { className: "rf-home__section", "aria-labelledby": "home-pipeline-title", children: [_jsx("h2", { id: "home-pipeline-title", children: "The pipeline" }), _jsxs("div", { className: "rf-flow", children: [_jsxs("div", { className: "rf-flow__rail", children: [_jsxs("div", { className: "rf-flow__col", children: [_jsxs("div", { className: "rf-flow__node", children: [_jsx("span", { className: "rf-flow__node-name", children: "Federato API" }), _jsx("span", { className: "rf-flow__node-gloss", children: "schema first, then planned queries" })] }), _jsxs("div", { className: "rf-flow__node", children: [_jsx("span", { className: "rf-flow__node-name", children: "iPhone sweep" }), _jsx("span", { className: "rf-flow__node-gloss", children: "auto-capture as you turn" })] })] }), _jsxs("div", { className: "rf-flow__edge", children: [_jsxs("span", { className: "rf-flow__edge-line", children: [_jsx("span", { className: "rf-flow__arrow", "aria-hidden": "true" }), "records + query trace"] }), _jsxs("span", { className: "rf-flow__edge-line", children: [_jsx("span", { className: "rf-flow__arrow", "aria-hidden": "true" }), "photos + bearings"] })] }), _jsx("div", { className: "rf-flow__col rf-flow__col--hub", children: _jsxs("div", { className: "rf-flow__node rf-flow__node--api", children: [_jsx("span", { className: "rf-flow__node-name", children: "apps/api" }), _jsx("span", { className: "rf-flow__node-gloss", children: "enrichment, image quality gate, Gemini calls, storage" }), _jsxs("span", { className: "rf-flow__node rf-flow__node--engine", children: [_jsx("span", { className: "rf-flow__node-name", children: "packages/engine" }), _jsx("span", { className: "rf-flow__node-gloss", children: "pure, deterministic, numeric" })] })] }) }), _jsx("div", { className: "rf-flow__edge", children: _jsxs("span", { className: "rf-flow__edge-line", children: [_jsx("span", { className: "rf-flow__arrow", "aria-hidden": "true" }), "scores, verdicts, prices"] }) }), _jsxs("div", { className: "rf-flow__col", children: [_jsxs("div", { className: "rf-flow__node", children: [_jsx("span", { className: "rf-flow__node-name", children: "Console" }), _jsx("span", { className: "rf-flow__node-gloss", children: "the ranked book" })] }), _jsxs("div", { className: "rf-flow__node", children: [_jsx("span", { className: "rf-flow__node-name", children: "Phone" }), _jsx("span", { className: "rf-flow__node-gloss", children: "verdict, price, the fix" })] })] })] }), _jsx("ol", { className: "rf-stages", "aria-label": "Engine stages, in order", children: STAGES.map((stage) => (_jsx("li", { children: _jsxs("span", { className: "rf-stage", children: [_jsx("span", { className: "rf-stage__name", children: stage.name }), _jsx("span", { className: "rf-stage__gloss", children: stage.gloss })] }) }, stage.name))) })] })] }), _jsxs("section", { className: "rf-home__section", "aria-labelledby": "home-planner-title", children: [_jsx("h2", { id: "home-planner-title", children: "How the agent plans its queries" }), _jsxs("ol", { className: "rf-steps", children: [_jsx("li", { children: "Read the live schema into a resource graph and locate every field the rulebook needs." }), _jsx("li", { children: "Triage all 158 submissions in one query \u2014 120 knocked out on line of business, each citing the rule." }), _jsxs("li", { children: ["One deep hydrating ", _jsx("code", { children: "Policy" }), " query returns all 27 property policies."] }), _jsxs("li", { children: ["Adapt on zero results \u2014 rewrite to ", _jsx("code", { children: "$elemMatch" }), ", decline ", _jsx("code", { children: "over" }), " \u2014 and record every query in a", ' ', _jsx(Link, { to: ROUTES.queue, children: "trace" }), "."] })] }), _jsxs("p", { className: "rf-home__stat", children: [_jsx("span", { children: "4 planner queries" }), _jsx("span", { children: "9.2 s" }), _jsx("span", { children: "158 submissions stored and scored" })] })] }), _jsxs("section", { className: "rf-home__section", "aria-labelledby": "home-infra-title", children: [_jsx("h2", { id: "home-infra-title", children: "Infrastructure" }), _jsx("dl", { className: "rf-spec", children: SPEC.map((row) => (_jsxs("div", { className: "rf-spec__row", children: [_jsx("dt", { children: row.label }), _jsx("dd", { children: row.value })] }, row.label))) })] }), _jsxs("section", { className: "rf-home__section", "aria-labelledby": "home-rail-title", children: [_jsx("h2", { id: "home-rail-title", children: "In the console" }), _jsx("ul", { className: "rf-rail", children: RAIL.map((item) => (_jsx("li", { children: _jsxs(Link, { to: item.to, children: [_jsx("span", { className: "rf-rail__label", children: item.label }), _jsx("span", { className: "rf-rail__gloss", children: item.gloss })] }) }, item.to))) })] })] }));
}
//# sourceMappingURL=HomePage.js.map