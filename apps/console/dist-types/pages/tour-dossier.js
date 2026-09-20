import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatPercent } from '@retrofit/contracts';
import { useApi } from '../api/useApi.js';
import { READOUTS, createAgentScene } from './tour-agent.js';
import { NODES, STEP_IDS } from './tour-agent-graph.js';
import { webglAvailable } from './tour-house.js';
import { TestBench } from './tour-testbench.js';
/**
 * The dossier: everything on `/tour` past the 3D story. It covers the weighted
 * rulebook, the Federato planner, the testing and the limits. Architecture is
 * not here: the camera rail above tells that story. Panels are collapsed by
 * default so the page opens as a table of contents rather than a wall.
 *
 * Nothing here is decorative: the weights come from the live `GET /rules`, and
 * every prose number is one the README, VERIFICATION.md or the engine already
 * states. Where a number is fitted, invented or unmeasured, the panel says so.
 */
/* -------------------------------------------------------------------------- */
/* Primitives                                                                 */
/* -------------------------------------------------------------------------- */
/**
 * Arm one element for a scroll reveal and drop the observer again once it has
 * played. Everything is visible without this: the hidden state is only ever
 * applied by `rf-reveal`, which JS adds, and only when the reader has not asked
 * for reduced motion and the browser has an IntersectionObserver.
 *
 * Shared by the whole dossier — the group heads, the figure rows, the panels
 * and the rule sheets all arrive the same way, so the page reads as one pass
 * of a pen rather than four different animations.
 */
export function useReveal() {
    const observer = useRef(null);
    useEffect(() => () => observer.current?.disconnect(), []);
    return useCallback((node) => {
        if (node === null) {
            observer.current?.disconnect();
            observer.current = null;
            return;
        }
        if (typeof IntersectionObserver === 'undefined' || typeof window === 'undefined')
            return;
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true)
            return;
        node.classList.add('rf-reveal');
        const io = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting)
                    continue;
                entry.target.classList.add('is-in');
                io.unobserve(entry.target);
            }
        }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
        io.observe(node);
        observer.current = io;
    }, []);
}
/** One collapsible panel. Native `<details>`, so it survives with JS disabled. */
export function Panel(props) {
    const { onOpen } = props;
    const reveal = useReveal();
    const handleToggle = useCallback((event) => {
        if (event.currentTarget.open)
            onOpen?.();
    }, [onOpen]);
    return (_jsxs("details", { ref: reveal, className: props.active ? 'rf-tour__panel rf-tour__panel--active' : 'rf-tour__panel', open: props.open ?? false, onToggle: handleToggle, children: [_jsxs("summary", { children: [_jsx("span", { className: "rf-tour__caret", "aria-hidden": "true" }), _jsx("span", { children: props.title }), props.note ? _jsx("span", { className: "rf-tour__panel-note", children: props.note }) : null] }), _jsx("div", { className: "rf-tour__panel-body", children: props.children })] }));
}
/**
 * A titled group of panels, with one button that opens or closes all of them.
 * The button walks the group's own `<details>` elements rather than lifting
 * `open` into React state, so each panel keeps its own independent toggle.
 */
export function Group(props) {
    const ref = useRef(null);
    const reveal = useReveal();
    const setAll = useCallback((open) => {
        const root = ref.current;
        if (!root)
            return;
        for (const panel of root.querySelectorAll('details'))
            panel.open = open;
    }, []);
    return (_jsxs("section", { className: "rf-tour__group", id: props.id, ref: ref, "aria-labelledby": `${props.id}-title`, children: [_jsxs("div", { className: "rf-tour__group-head", ref: reveal, children: [_jsx("h2", { id: `${props.id}-title`, children: props.title }), _jsx("button", { type: "button", className: "rf-tour__chip", onClick: () => setAll(true), children: "Open all" }), _jsx("button", { type: "button", className: "rf-tour__chip", onClick: () => setAll(false), children: "Close all" })] }), _jsx("p", { className: "rf-tour__group-lede", children: props.lede }), props.children] }));
}
/** Big-number row. `value` is the number; `label` says what it counts. */
export function Figures(props) {
    const reveal = useReveal();
    return (_jsx("ul", { className: "rf-tour__figures", ref: reveal, children: props.items.map((item, i) => (_jsxs("li", { className: "rf-tour__figure", style: { '--rf-fig-i': i }, children: [_jsx("span", { className: "rf-tour__figure-value", children: item.value }), _jsx("span", { className: "rf-tour__figure-label", children: item.label })] }, item.label))) }));
}
/** Term/value grid. */
export function Defs(props) {
    return (_jsx("dl", { className: "rf-tour__defs", children: props.rows.map((row) => (_jsxs("div", { className: "rf-tour__def", children: [_jsx("dt", { children: row.term }), _jsx("dd", { children: row.value })] }, row.term))) }));
}
/* -------------------------------------------------------------------------- */
/* Architecture                                                               */
/* -------------------------------------------------------------------------- */
const WORKSPACES = [
    {
        term: 'packages/engine',
        value: 'Pure. Zero I/O, no clock, no randomness, no LLM SDK, no import from apps/*. Same input, same output, forever. Every verdict, score and dollar amount is decided here.',
    },
    {
        term: 'packages/federato',
        value: 'The agent: reads the live schema into a resource graph, plans its queries against it, and records a trace of every one.',
    },
    {
        term: 'packages/contracts',
        value: 'The DTOs and formatters shared by the API, the console and the phone. Zod at every boundary.',
    },
    { term: 'packages/design', value: 'The token source. Colour, type, spacing and radius, one definition, three consumers.' },
    { term: 'packages/verify', value: 'The differential harness: property tests and the independent second implementation.' },
    { term: 'apps/api', value: 'Hono + better-sqlite3 + Drizzle. Enrichment, the image quality gate, every Gemini call, and storage.' },
    { term: 'apps/console', value: 'Vite + React 19. The underwriter surface: the ranked book, the rules, the terrain.' },
    { term: 'apps/mobile', value: 'Expo. The renter surface: sweep, confirm, questions, verdict, verify my fix.' },
];
/* -------------------------------------------------------------------------- */
/* The Federato agent                                                         */
/* -------------------------------------------------------------------------- */
/**
 * Local to this file on purpose: `TourPage` has its own copy for the story
 * canvas, and the two surfaces are independent — neither should have to import
 * the other to ask the browser one question.
 */
function prefersReducedMotion() {
    return typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false;
}
/**
 * The schema graph, pinned beside the six steps. Opening a panel moves the
 * camera; the scene plays that step's beat.
 *
 * The 3D is an illustration of the prose next to it and never a replacement
 * for it: the canvas is `aria-hidden`, nothing here is a control, and with no
 * WebGL the stage never mounts and the section is an ordinary document.
 */
function AgentStage(props) {
    const hostRef = useRef(null);
    const frameRef = useRef(null);
    const { sceneRef, onStep, onEnd } = props;
    const badgeRefs = useRef(new Map());
    const [live, setLive] = useState(false);
    const bindBadge = useCallback((id, el) => {
        if (el)
            badgeRefs.current.set(id, el);
        else
            badgeRefs.current.delete(id);
        sceneRef.current?.bindBadge(id, el);
    }, []);
    useEffect(() => {
        const host = hostRef.current;
        const frame = frameRef.current;
        if (!host || !frame || !webglAvailable())
            return;
        const scene = createAgentScene(host, {
            reducedMotion: prefersReducedMotion(),
            onStep,
            onEnd,
        });
        sceneRef.current = scene;
        for (const [id, el] of badgeRefs.current)
            scene.bindBadge(id, el);
        setLive(true);
        // The tour already runs the house scene above this one. Only the section
        // actually on screen should be spinning a render loop.
        const observer = new IntersectionObserver((entries) => {
            for (const entry of entries)
                scene.setActive(entry.isIntersecting);
        }, { rootMargin: '10% 0px' });
        observer.observe(frame);
        return () => {
            observer.disconnect();
            sceneRef.current = null;
            setLive(false);
            scene.dispose();
        };
        // Built once and alive until unmount: `sceneRef` is a ref and `onStep` is
        // a stable state setter, so neither can invalidate this effect.
    }, [sceneRef, onStep, onEnd]);
    const readout = READOUTS[props.step ?? STEP_IDS[0]];
    return (_jsxs("div", { className: live ? 'rf-agent__stage rf-agent__stage--live' : 'rf-agent__stage', ref: frameRef, "aria-hidden": "true", children: [_jsx("div", { className: "rf-agent__canvas", ref: hostRef }), live ? (_jsxs("div", { className: "rf-agent__badges", children: [NODES.map((node) => (_jsx("span", { className: "rf-agent__badge", ref: (el) => bindBadge(node.id, el), children: node.label }, node.id))), _jsxs("span", { className: "rf-agent__badge rf-agent__badge--readout", ref: (el) => bindBadge('readout', el), children: [_jsx("span", { className: "rf-agent__readout-label", children: readout.label }), _jsx("span", { className: "rf-agent__readout-value", children: readout.value })] })] })) : null] }));
}
export function AgentGroup() {
    // Null until a scene exists and reports its first step. Nothing is playing
    // before that, so nothing should be highlighted as playing.
    const [step, setStep] = useState(null);
    const sceneRef = useRef(null);
    const trackRef = useRef(null);
    /**
     * The scene plays itself and tells us where it got to; this is only the
     * echo of that, used to highlight the step being drawn and to label the
     * readout. Scroll does not scrub the film — it only starts and pauses it,
     * through the stage's own intersection observer.
     */
    const onStep = useCallback((next) => {
        setStep((was) => (was === next ? was : next));
    }, []);
    /**
     * The film has finished, so stop holding the reader here.
     *
     * The track is 500vh so the section can pin while the film plays, but once
     * it has played that height is just distance to nowhere. Rather than
     * collapsing it — which would yank everything below up the page — the track
     * is frozen at exactly the height already scrolled through, so the pin
     * releases from this point on and nothing above the fold moves at all.
     */
    const onEnd = useCallback(() => {
        const track = trackRef.current;
        if (!track)
            return;
        const top = track.getBoundingClientRect().top + window.scrollY;
        const used = window.scrollY - top + window.innerHeight;
        track.style.height = `${Math.round(Math.max(window.innerHeight, used))}px`;
    }, []);
    // Clicking a step scrubs the film to that chapter, which then carries on.
    const onOpen = useRef(new Map(STEP_IDS.map((id) => [id, () => sceneRef.current?.setStep(id)]))).current;
    return (_jsx(Group, { id: "agent", title: "The Federato agent", lede: "The planner builds its queries from the live schema and records why it chose each one.", children: _jsx("div", { className: step !== null ? 'rf-agent__track rf-agent__track--live' : 'rf-agent__track', ref: trackRef, children: _jsxs("div", { className: "rf-agent", children: [_jsx(AgentStage, { step: step, sceneRef: sceneRef, onStep: onStep, onEnd: onEnd }), _jsxs("div", { className: "rf-agent__steps", children: [_jsx(Figures, { items: [
                                    { value: '4', label: 'planner queries' },
                                    { value: '9.2 s', label: 'to seed the book' },
                                    { value: '158', label: 'submissions stored and scored' },
                                    { value: '158', label: 'with a query trace' },
                                ] }), _jsxs("div", { className: "rf-agent__panels", children: [_jsx(Panel, { title: "1 \u00B7 Read and collect", onOpen: onOpen.get('read'), active: step === 'read', children: _jsx("p", { children: "The schema is read into a resource graph, and every field the rulebook and the rating table need is collected up front." }) }), _jsxs(Panel, { title: "2 \u00B7 Locate each field", note: "synonyms, then graph search", onOpen: onOpen.get('locate'), active: step === 'locate', children: [_jsxs("p", { children: ["A synonym table first, then a shortest-path search through the graph. Anything the table cannot place stays ", _jsx("strong", { children: "visibly unmapped" }), " in the trace rather than silently dropped."] }), _jsxs("p", { children: ["The planner also accepts an injected Gemini ", _jsx("span", { className: "rf-tour__mono", children: "schema-assist" }), ' ', "(matches accepted only at 0.8 confidence or higher), but it is", ' ', _jsx("strong", { children: "not enabled in the shipped ingest path" }), ": on this dataset the synonym table and graph search place every field the rulebook needs except building-level protection class, which Federato stores on the location."] })] }), _jsx(Panel, { title: "3 \u00B7 Triage", note: "158 \u2192 38 in one query", onOpen: onOpen.get('triage'), active: step === 'triage', children: _jsx("p", { children: "One query over all 158 submissions for id, status and line of business. 120 are knocked out on line of business, each citing the rule that did it." }) }), _jsx(Panel, { title: "4 \u00B7 Deep pass", note: "27 policies, one query", onOpen: onOpen.get('deep'), active: step === 'deep', children: _jsxs("p", { children: ["One ", _jsx("span", { className: "rf-tour__mono", children: "Policy" }), " query expanding insured, claims and exposure units down to buildings returns all 27 property policies fully hydrated. The trace records why ", _jsx("span", { className: "rf-tour__mono", children: "Submission" }), " was rejected as root: no premium, TIV or building fields."] }) }), _jsxs(Panel, { title: "5 \u00B7 Adapt on zero results", note: "rewrites and retries", onOpen: onOpen.get('adapt'), active: step === 'adapt', children: [_jsxs("p", { children: ["On the live handler a dot-path through an array silently matches nothing \u2014", ' ', _jsx("span", { className: "rf-tour__mono", children: "exposure_units.location.state: CA" }), " returns 0 rows, while the ", _jsx("span", { className: "rf-tour__mono", children: "$elemMatch" }), " form returns 47. On zero results the planner rewrites the clause into ", _jsx("span", { className: "rf-tour__mono", children: "$elemMatch" }), ' ', "form, or drops the narrowest filter, and records which."] }), _jsxs("p", { children: ["It also ", _jsxs("strong", { children: ["declines ", _jsx("span", { className: "rf-tour__mono", children: "over" })] }), ": the docs call it a GROUP BY, but the deployed handler returns one row per record and a constant", ' ', _jsx("span", { className: "rf-tour__mono", children: "$sum" }), ". The planner strips it, writes the reason into the trace, and the engine does every rollup itself."] })] }), _jsx(Panel, { title: "6 \u00B7 Trace", note: "shown as \u201CHow the agent got here\u201D", onOpen: onOpen.get('trace'), active: step === 'trace', children: _jsx("p", { children: "Each query is stored with its goal, the rule that needed it, the path and why, the payload, the row count and the duration. The console shows the whole chain on the account it produced." }) })] })] })] }) }) }));
}
/* -------------------------------------------------------------------------- */
/* Testing and limits                                                         */
/* -------------------------------------------------------------------------- */
/**
 * The verification counts, read live from `GET /verification` — the same
 * numbers the console's verification page reports. Silent when the API is
 * unreachable: the prose panels below still say what was run.
 */
function VerificationFigures() {
    const state = useApi((client) => client.getVerification(), []);
    const data = state.data;
    if (data === null)
        return null;
    const items = [];
    if (data.layersAB !== null) {
        items.push({ value: data.layersAB.completed.toLocaleString('en-US'), label: 'A+B cases run' });
        items.push({
            value: String(data.layersAB.invariantViolations),
            label: 'invariant violations',
        });
        items.push({ value: String(data.layersAB.disagreements), label: 'disagreements' });
    }
    if (data.layerC !== null) {
        items.push({
            value: formatPercent(data.layerC.agreement.point, { from: 'ratio', decimals: 1 }),
            label: `layer C agreement (${data.layerC.agreed} of ${data.layerC.judged})`,
        });
    }
    if (items.length === 0)
        return null;
    return _jsx(Figures, { items: items });
}
export function TestingGroup() {
    return (_jsxs(Group, { id: "testing", title: "Testing, and what we did not prove", lede: "Three layers of testing, and a list of what is still unverified. One layer was written by an agent that never saw the engine.", children: [_jsx(VerificationFigures, {}), _jsx(TestBench, {}), _jsx(Panel, { title: "Layers A and B \u2014 property tests and a second implementation", open: true, children: _jsxs("p", { children: ["Property tests, plus a naive second implementation written by an agent that never saw the engine code, working only from the guideline PDF and the shared interpretation contract. Because both implement the same contract, layer B catches arithmetic and logic errors but cannot catch an interpretation both sides share \u2014 which is what layer C is for. The counts above are the final run, live from the API: ", _jsx("strong", { children: "zero invariant violations and zero disagreements" }), " across every case."] }) }), _jsxs(Panel, { title: "Layer C \u2014 a model that was never shown the answer", note: "99.9% agreement", children: [_jsxs("p", { children: ["A Gemini second opinion given only the guideline text and each account\u2019s rolled-up facts \u2014 never the engine\u2019s score, tier or verdict. ", _jsx("strong", { children: "1,331 of 1,332 agreed" }), " (99.9%, 95% CI 99.6\u2013100.0%), and all 38 real property accounts agreed."] }), _jsx("p", { children: "The single disagreement is exactly-50% acceptable construction, which the PDF genuinely leaves open: Acceptable needs \u201C>50%\u201D, Not Acceptable is \u201C>50% other types\u201D, and at exactly 50% neither holds. 706 of the planned 2,038 cases went unanswered when the Gemini credits ran out mid-run." })] }), _jsx(Panel, { title: "The tests found real bugs", note: "39 confirmed defects", children: _jsx("p", { children: "The differential started at 20,662 invariant violations and 1,369 disagreements, caused by a hole in our own interpretation contract and a peer-distance overflow. A review of the real data then found 39 confirmed defects, including every building assigned the first location\u2019s id (wrong state on 11 of 27 accounts), only 38 of 158 submissions stored, broker answers silently dropped, and zero FIT accounts because a date conflict present on all 27 accounts was wrongly treated as blocking. All are fixed and logged." }) }), _jsx(Panel, { title: "What is still not proven", children: _jsxs("ul", { className: "rf-tour__list", children: [_jsxs("li", { children: [_jsx("strong", { children: "No one has run the phone app on an iPhone." }), " The camera sweep and its Skia coverage ring are unverified on real hardware. Every other screen has been driven end to end in a browser against the live API."] }), _jsxs("li", { children: [_jsx("strong", { children: "The Gemini key\u2019s prepaid credits are depleted" }), " (HTTP 402). Vision, broker-reply extraction, request drafting and narration fall back or fail until it is topped up. Scoring, ranking, template explanations and the whole engine are unaffected."] }), _jsxs("li", { children: [_jsx("strong", { children: "Broker-reply extraction accuracy is unmeasured" }), " \u2014 the 30-fixture check ran after the credits ran out."] }), _jsxs("li", { children: [_jsx("strong", { children: "Tenant rates are invented" }), " and labelled \u201Cestimate\u201D everywhere they appear, including on this page."] }), _jsxs("li", { children: [_jsx("strong", { children: "Enrichment is display-only." }), " FEMA flood zones and fire-station distance are fetched and shown, but no rule, rating factor or contradiction reads them yet, so they move neither a score nor a price."] }), _jsxs("li", { children: [_jsx("strong", { children: "The 3D coverage dome was cut" }), " from the phone app; it uses the 2D Skia ring, the PRD\u2019s named fallback."] }), _jsxs("li", { children: [_jsx("strong", { children: "Broker contacts are synthetic" }), ", so approving a request marks it sent. Nothing is emailed."] })] }) })] }));
}
//# sourceMappingURL=tour-dossier.js.map