import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Component, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { formatPercent, formatScore } from '@retrofit/contracts';
import { cssVar, MIN_TOUCH_TARGET, RADIUS, SPACE } from '@retrofit/design';
import { ROUTES, submissionPath } from '../routes.js';
import { useApi, useApiClient } from '../api/useApi.js';
import { Card } from '../components/atoms/Card.js';
import { Skeleton } from '../components/atoms/Skeleton.js';
import { VerdictPill } from '../components/atoms/VerdictPill.js';
import { Badge } from '../components/atoms/Badge.js';
import { AccountFacts, lineOfBusinessLabel } from '../panels/AccountFacts.js';
import { Actions } from '../panels/Actions.js';
import { AttachedSweep } from '../panels/AttachedSweep.js';
import { Buildings } from '../panels/Buildings.js';
import { Contradictions } from '../panels/Contradictions.js';
import { Enrichment } from '../panels/Enrichment.js';
import { Explanation } from '../panels/Explanation.js';
import { Flip } from '../panels/Flip.js';
import { IndependentChecks } from '../panels/IndependentChecks.js';
import { PeerBenchmark } from '../panels/PeerBenchmark.js';
import { Pricing } from '../panels/Pricing.js';
import { QueryTrace } from '../panels/QueryTrace.js';
import { ReplyBox } from '../panels/ReplyBox.js';
import { Schema } from '../panels/Schema.js';
import { ScoreBreakdown } from '../panels/ScoreBreakdown.js';
import { Vector } from '../panels/Vector.js';
const GROUPS = [
    { id: 'numbers', label: 'The numbers' },
    { id: 'evidence', label: 'The evidence' },
    { id: 'next', label: 'Next steps' },
];
/** Render order within a group is this order. The decision panel (a) is not in a group. */
const PANELS = [
    { letter: 'a', title: 'The decision', group: 'numbers', weight: 'normal' },
    { letter: 'b', title: 'Score breakdown', group: 'numbers', weight: 'normal' },
    { letter: 'd', title: 'Pricing and peers', group: 'numbers', weight: 'normal' },
    { letter: 'e', title: 'Buildings', group: 'numbers', weight: 'normal' },
    { letter: 'h', title: 'Feature vector', group: 'numbers', weight: 'quiet' },
    { letter: 'c', title: 'Agent trace', group: 'evidence', weight: 'normal' },
    { letter: 'f', title: 'Contradictions', group: 'evidence', weight: 'normal' },
    { letter: 'l', title: 'Attached sweep', group: 'evidence', weight: 'normal' },
    { letter: 'j', title: 'Enrichment', group: 'evidence', weight: 'quiet' },
    { letter: 'i', title: 'Discovered schema', group: 'evidence', weight: 'quiet' },
    { letter: 'g', title: 'Minimal flip', group: 'next', weight: 'normal' },
    { letter: 'k', title: 'Actions', group: 'next', weight: 'normal' },
];
/** (a) is the decision block above the groups, so it is never a grouped panel. */
const DECISION = 'a';
const PANEL_ORDER = {
    a: 0, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6, h: 7, i: 8, j: 9, k: 10, l: 11,
};
function panelAnchor(letter) {
    return `panel-${letter}`;
}
function sectionAnchor(group) {
    return `section-${group}`;
}
function messageOf(err) {
    if (err instanceof Error)
        return err.message;
    return String(err);
}
class PanelBoundary extends Component {
    state = { error: null, resetKey: undefined };
    static getDerivedStateFromError(error) {
        return { error: error instanceof Error ? error : new Error(String(error)) };
    }
    static getDerivedStateFromProps(props, state) {
        if (props.resetKey !== state.resetKey)
            return { error: null, resetKey: props.resetKey };
        return null;
    }
    componentDidCatch(_error, _info) {
        // Rendered inline below; Sentry's global handler already sees the error.
    }
    render() {
        if (this.state.error !== null) {
            return (_jsx("div", { role: "alert", className: "submission-panel-error", children: _jsx("p", { children: `${this.props.title} could not be shown: ${this.state.error.message}` }) }));
        }
        return this.props.children;
    }
}
function normalizeSearch(raw) {
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed === '?')
        return '';
    return trimmed.startsWith('?') ? trimmed : `?${trimmed}`;
}
function searchFromReferrer() {
    try {
        if (typeof document === 'undefined')
            return '';
        const ref = document.referrer;
        if (typeof ref !== 'string' || ref === '')
            return '';
        const url = new URL(ref, typeof window === 'undefined' ? 'http://localhost/' : window.location.href);
        return url.pathname === ROUTES.queue ? normalizeSearch(url.search) : '';
    }
    catch {
        return '';
    }
}
function readQueueOrigin(state) {
    const bag = typeof state === 'object' && state !== null ? state : {};
    const rawSearch = typeof bag.queueSearch === 'string' ? bag.queueSearch : typeof bag.search === 'string' ? bag.search : '';
    const search = normalizeSearch(rawSearch) || searchFromReferrer();
    const ids = Array.isArray(bag.queue)
        ? bag.queue.filter((value) => typeof value === 'string')
        : [];
    return { search, ids };
}
/* ---------------------------------------------------------------------------
 * Header: identity, the four headline numbers, queue navigation.
 * ------------------------------------------------------------------------- */
const headerRowStyle = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACE.md,
};
const stepStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: MIN_TOUCH_TARGET,
    padding: `0 ${SPACE.md}px`,
    border: `${cssVar('border-width')} solid ${cssVar('border-color')}`,
    borderRadius: RADIUS.pill,
    color: cssVar('ink'),
    textDecoration: 'none',
    fontSize: cssVar('size-small'),
};
function SubmissionHeader(props) {
    const { detail, headingId, busy, origin, navState } = props;
    const at = origin.ids.indexOf(detail.submissionId);
    const prev = at > 0 ? origin.ids[at - 1] ?? null : null;
    const next = at >= 0 && at < origin.ids.length - 1 ? origin.ids[at + 1] ?? null : null;
    return (_jsxs("header", { className: "submission-header", children: [_jsxs("div", { style: headerRowStyle, children: [_jsxs("p", { className: "submission-breadcrumb", style: { margin: 0 }, children: [_jsx(Link, { to: { pathname: ROUTES.queue, search: origin.search }, children: "Queue" }), ' / ', _jsx("span", { children: detail.submissionId })] }), prev !== null || next !== null ? (_jsxs("nav", { "aria-label": "Queue order", style: { display: 'flex', gap: SPACE.sm }, children: [prev !== null ? (_jsx(Link, { to: submissionPath(prev), state: navState, style: stepStyle, rel: "prev", children: "\u2190 Previous" })) : null, next !== null ? (_jsx(Link, { to: submissionPath(next), state: navState, style: stepStyle, rel: "next", children: "Next \u2192" })) : null] })) : null] }), _jsx("h1", { id: headingId, children: detail.insuredName }), _jsxs("div", { className: "submission-verdict", children: [_jsx(VerdictPill, { verdict: detail.verdict }), detail.accountKind !== 'scored' ? (_jsxs(_Fragment, { children: [' ', _jsx(Badge, { label: KIND_BADGE[detail.accountKind], tone: "attention" })] })) : null, detail.synthetic ? (_jsxs(_Fragment, { children: [' ', _jsx(Badge, { label: "Synthetic data", tone: "attention", title: "Values hand-authored, scored by the engine" })] })) : null] }), _jsxs("dl", { className: "submission-headline", children: [_jsxs("div", { children: [_jsx("dt", { children: "Line of business" }), _jsx("dd", { "data-field": "lineOfBusiness", children: lineOfBusinessLabel(detail.displayLineOfBusiness) })] }), _jsxs("div", { children: [_jsx("dt", { children: "Appetite score" }), _jsx("dd", { "data-field": "appetiteScore", children: formatScore(detail.appetiteScore, { outOf: true }) })] }), _jsxs("div", { children: [_jsx("dt", { children: "Completeness" }), _jsx("dd", { "data-field": "completeness", children: formatPercent(detail.completeness, { from: 'percent', decimals: 1 }) })] }), _jsxs("div", { children: [_jsx("dt", { children: "Confidence" }), _jsx("dd", { "data-field": "confidence", children: formatPercent(detail.confidence) })] })] }), _jsxs("div", { className: "submission-controls", children: [_jsx("button", { type: "button", onClick: props.onRerun, disabled: busy, style: { minHeight: MIN_TOUCH_TARGET }, children: "Re-run agent" }), _jsx("button", { type: "button", onClick: props.onEnrich, disabled: busy, style: { minHeight: MIN_TOUCH_TARGET }, children: "Run enrichment" })] })] }));
}
/* ---------------------------------------------------------------------------
 * Which panels apply (FILL-console D1). A fully scored account shows all
 * twelve. A triage knockout or a no-policy submission has no policy, buildings,
 * premium or losses behind it, so a panel built on those is left out and listed
 * with its reason. A panel whose data IS present always shows.
 * ------------------------------------------------------------------------- */
const ALWAYS_SHOWN = {
    triage_knockout: new Set(['a', 'c', 'k']),
    no_policy: new Set(['a', 'b', 'c', 'd', 'k']),
};
function hasData(letter, detail) {
    switch (letter) {
        case 'e':
            return detail.buildings.length > 0;
        case 'f':
            return detail.contradictions.length > 0 || detail.interpretations.length > 0;
        case 'g':
            return detail.flip.available;
        case 'j':
            return detail.enrichment.length > 0;
        case 'l':
            return detail.sweep !== null;
        default:
            return false;
    }
}
function notApplicableReason(letter, detail) {
    const knockout = detail.accountKind === 'triage_knockout';
    switch (letter) {
        case 'b':
            return 'Line of business alone decides a knockout.';
        case 'd':
            return 'No premium, buildings or losses were read.';
        case 'e':
            return knockout ? 'The deep query covers property policies only.' : 'No policy in Federato.';
        case 'f':
            return 'No conflicting sources, no interpretation applied.';
        case 'g': {
            const reason = detail.flip.reason?.trim() ?? '';
            return reason.length > 0 ? reason : 'No move reaches FIT.';
        }
        case 'h':
            return 'Building, premium and loss components all missing.';
        case 'i':
            return 'No policy or building fields to map.';
        case 'j':
            return 'No buildings to look up.';
        case 'l':
            return 'Nothing attached.';
        default:
            return 'Not applicable.';
    }
}
function planPanels(detail) {
    if (detail.accountKind === 'scored')
        return { shown: PANELS, hidden: [] };
    const always = ALWAYS_SHOWN[detail.accountKind];
    const shown = [];
    const hidden = [];
    for (const spec of PANELS) {
        if (always.has(spec.letter) || hasData(spec.letter, detail)) {
            // A no-policy account has peers but nothing to price: (d) is the benchmark alone.
            shown.push(spec.letter === 'd' && detail.accountKind === 'no_policy' ? { ...spec, title: 'Peer benchmark' } : spec);
        }
        else {
            hidden.push({ spec, reason: notApplicableReason(spec.letter, detail) });
        }
    }
    hidden.sort((x, y) => PANEL_ORDER[x.spec.letter] - PANEL_ORDER[y.spec.letter]);
    return { shown, hidden };
}
const FACTS_ANCHOR = 'panel-facts';
const CHECKS_ANCHOR = 'panel-checks';
const CHECKS_TITLE = 'Independent checks';
const FACTS_TITLE = 'Submission facts';
const NOT_APPLICABLE_ANCHOR = 'panel-not-applicable';
const NOT_APPLICABLE_TITLE = 'Not applicable to this account';
/* ---------------------------------------------------------------------------
 * The sticky index. Two tiers so it never becomes a wall of chips: the sections
 * always, and the panels of the section currently in view.
 * ------------------------------------------------------------------------- */
const indexStyle = {
    position: 'sticky',
    top: 0,
    zIndex: 2,
    background: cssVar('paper'),
    borderBottom: `${cssVar('border-width')} solid ${cssVar('border-color')}`,
    padding: `${SPACE.sm}px 0`,
    marginBottom: SPACE.lg,
};
const chipRowStyle = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: `${SPACE.xs}px ${SPACE.sm}px`,
    margin: 0,
    padding: 0,
    listStyle: 'none',
};
function chipStyle(active, quiet) {
    return {
        display: 'inline-flex',
        alignItems: 'center',
        minHeight: 36,
        padding: `0 ${SPACE.md}px`,
        border: `${cssVar('border-width')} solid ${active ? cssVar('ink') : cssVar('border-color')}`,
        borderRadius: RADIUS.pill,
        fontSize: quiet ? cssVar('size-micro') : cssVar('size-small'),
        lineHeight: quiet ? cssVar('leading-micro') : cssVar('leading-small'),
        color: quiet && !active ? cssVar('muted-deep') : cssVar('ink'),
        background: active ? cssVar('muted-tint') : 'transparent',
        textDecoration: 'none',
        fontWeight: active ? 600 : 400,
    };
}
function PanelIndex(props) {
    const current = props.entries.find((e) => e.id === props.active) ?? props.entries[0];
    if (current === undefined)
        return null;
    return (_jsxs("nav", { "aria-label": "Panels on this page", className: "submission-index", style: indexStyle, children: [_jsx("ul", { style: chipRowStyle, children: props.entries.map((entry) => (_jsx("li", { children: _jsx("a", { href: `#${entry.anchor}`, style: chipStyle(entry.id === current.id, false), "aria-current": entry.id === current.id ? 'true' : undefined, children: entry.label }) }, entry.id))) }), current.children.length > 0 ? (_jsx("ul", { style: { ...chipRowStyle, marginTop: SPACE.xs }, "aria-label": `${current.label} panels`, children: current.children.map((child) => (_jsx("li", { children: _jsx("a", { href: `#${child.anchor}`, style: chipStyle(false, true), children: child.label }) }, child.anchor))) })) : null] }));
}
/**
 * Highlights whichever indexed section is in view. `IntersectionObserver` is
 * absent in jsdom, so the hook feature-detects and leaves the first entry
 * active rather than shimming anything.
 */
function useActiveSection(anchors, fallback) {
    const [active, setActive] = useState(fallback);
    const key = anchors.join('|');
    useEffect(() => {
        setActive(fallback);
        if (typeof IntersectionObserver === 'undefined')
            return undefined;
        const ids = key.split('|').filter((a) => a.length > 0);
        const seen = new Map();
        const observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                seen.set(entry.target.id, entry.isIntersecting ? entry.intersectionRatio : 0);
            }
            let best = '';
            let bestRatio = 0;
            for (const id of ids) {
                const ratio = seen.get(id) ?? 0;
                if (ratio > bestRatio) {
                    best = id;
                    bestRatio = ratio;
                }
            }
            if (best !== '')
                setActive(best);
        }, { rootMargin: '-72px 0px -55% 0px', threshold: [0, 0.25, 0.5, 1] });
        for (const id of ids) {
            const el = document.getElementById(id);
            if (el !== null)
                observer.observe(el);
        }
        return () => observer.disconnect();
    }, [key, fallback]);
    return active;
}
/** A knockout is never routed (PRD 7.6); say that, not "run the plan". */
function routingFor(detail) {
    if (detail.accountKind === 'triage_knockout' && detail.routing.underwriter === null) {
        return {
            ...detail.routing,
            rationale: 'Not routed: a submission knocked out at triage is never routed to an underwriter.',
        };
    }
    return detail.routing;
}
const KIND_BADGE = {
    triage_knockout: 'Knocked out at triage',
    no_policy: 'No policy in Federato',
};
/* ---------------------------------------------------------------------------
 * Surfaces: the decision block, a section heading, a demoted panel.
 * ------------------------------------------------------------------------- */
const decisionStyle = {
    background: cssVar('muted-tint'),
    border: `${cssVar('border-width')} solid ${cssVar('border-color')}`,
    borderRadius: RADIUS.card,
    padding: SPACE.xl,
    scrollMarginTop: SPACE.xxl,
};
const decisionHeaderStyle = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: SPACE.md,
    marginBottom: SPACE.lg,
};
const decisionTitleStyle = {
    margin: 0,
    fontFamily: cssVar('font-display'),
    fontSize: cssVar('size-title'),
    lineHeight: cssVar('leading-title'),
    fontWeight: 600,
};
const sectionStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: SPACE.lg,
    scrollMarginTop: SPACE.xxl,
};
const sectionHeadingStyle = {
    margin: 0,
    fontFamily: cssVar('font-body'),
    fontSize: cssVar('size-micro'),
    lineHeight: cssVar('leading-micro'),
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: cssVar('muted-deep'),
    fontWeight: 600,
};
const quietStyle = {
    border: 'none',
    padding: 0,
    scrollMarginTop: SPACE.xxl,
};
const quietSummaryStyle = {
    display: 'flex',
    alignItems: 'center',
    minHeight: MIN_TOUCH_TARGET,
    cursor: 'pointer',
    color: cssVar('muted-deep'),
};
const quietTitleStyle = {
    display: 'inline',
    margin: 0,
    fontFamily: cssVar('font-body'),
    fontSize: cssVar('size-small'),
    lineHeight: cssVar('leading-small'),
    fontWeight: 600,
    color: cssVar('muted-deep'),
};
function QuietPanel(props) {
    return (_jsxs("details", { id: props.anchorId, className: "submission-quiet", style: quietStyle, children: [_jsx("summary", { style: quietSummaryStyle, children: _jsx("h2", { className: "rf-card__title", style: quietTitleStyle, children: props.title }) }), _jsx("div", { style: { marginTop: SPACE.md }, children: props.children })] }));
}
const MUTATION_LABEL = {
    rerun: 'Re-running the agent',
    enrich: 'Running enrichment',
    approve: 'Approving the request',
    reply: 'Reading the reply',
};
/**
 * PRD 10 /submissions/:id — the decision, then the supporting panels grouped.
 *
 * Route registration lives in src/App.tsx and is frozen.
 */
export function SubmissionPage() {
    const params = useParams();
    const id = params.id ?? '';
    const headingId = useId();
    const decisionHeadingId = `${headingId}-decision`;
    const location = useLocation();
    const client = useApiClient();
    const loaded = useApi((c) => c.getSubmission(id), [id]);
    // A run/enrich call returns the whole detail; show it without a refetch.
    // Any later reload (approve, reply) supersedes it.
    const [fresh, setFresh] = useState(null);
    const [reply, setReply] = useState(null);
    const [pending, setPending] = useState(null);
    const [mutationError, setMutationError] = useState(null);
    const alive = useRef(true);
    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
        };
    }, []);
    useEffect(() => {
        setFresh(null);
    }, [loaded.data]);
    useEffect(() => {
        setReply(null);
        setMutationError(null);
        setPending(null);
    }, [id]);
    const { reload } = loaded;
    /**
     * Records the failure as `mutationError` (the page-level alert) and then
     * rethrows, so a caller that awaits `run` — DraftCard's approve button,
     * ReplyBox's paste-or-upload form — learns the mutation actually failed and
     * does not treat a caught, logged error as a success.
     */
    const run = useCallback(async (kind, work) => {
        setPending(kind);
        setMutationError(null);
        try {
            await work();
        }
        catch (err) {
            if (alive.current)
                setMutationError(`${MUTATION_LABEL[kind]} failed: ${messageOf(err)}`);
            throw err;
        }
        finally {
            if (alive.current)
                setPending(null);
        }
    }, []);
    // Neither button's caller awaits the result — the failure already lands in
    // `mutationError` above — so the rethrow from `run` is caught here and
    // dropped rather than becoming an unhandled rejection.
    const onRerun = useCallback(() => {
        void run('rerun', async () => {
            const next = await client.runSubmission(id);
            if (alive.current)
                setFresh(next);
        }).catch(() => { });
    }, [client, id, run]);
    const onEnrich = useCallback(() => {
        void run('enrich', async () => {
            const next = await client.enrich(id);
            if (alive.current)
                setFresh(next);
        }).catch(() => { });
    }, [client, id, run]);
    const onApprove = useCallback((actionId) => run('approve', async () => {
        await client.approveAction(actionId);
        reload();
    }), [client, reload, run]);
    const onSubmitText = useCallback((text) => run('reply', async () => {
        const result = await client.postReply(id, { text });
        if (alive.current)
            setReply(result);
        reload();
    }), [client, id, reload, run]);
    const onSubmitFile = useCallback((file) => run('reply', async () => {
        const result = await client.postReply(id, { file });
        if (alive.current)
            setReply(result);
        reload();
    }), [client, id, reload, run]);
    const detail = fresh ?? loaded.data;
    const origin = useMemo(() => readQueueOrigin(location.state), [location.state]);
    const plan = useMemo(() => (detail === null ? null : planPanels(detail)), [detail]);
    const sparse = detail !== null && detail.accountKind !== 'scored';
    const hasChecks = detail !== null && detail.verification !== null;
    const entries = useMemo(() => {
        if (plan === null)
            return [];
        const out = [];
        if (sparse)
            out.push({ id: FACTS_ANCHOR, label: FACTS_TITLE, anchor: FACTS_ANCHOR, children: [] });
        if (plan.shown.some((p) => p.letter === DECISION)) {
            out.push({ id: panelAnchor(DECISION), label: 'Decision', anchor: panelAnchor(DECISION), children: [] });
        }
        for (const group of GROUPS) {
            const children = plan.shown
                .filter((p) => p.group === group.id && p.letter !== DECISION)
                .map((p) => ({ anchor: panelAnchor(p.letter), label: p.title }));
            if (group.id === 'evidence' && hasChecks) {
                children.push({ anchor: CHECKS_ANCHOR, label: CHECKS_TITLE });
            }
            if (children.length === 0)
                continue;
            out.push({ id: sectionAnchor(group.id), label: group.label, anchor: sectionAnchor(group.id), children });
        }
        return out;
    }, [plan, sparse, hasChecks]);
    const anchors = useMemo(() => entries.map((e) => e.id), [entries]);
    const fallbackAnchor = anchors[0] ?? '';
    const active = useActiveSection(anchors, fallbackAnchor);
    if (id === '') {
        return (_jsxs("section", { className: "submission-page", children: [_jsx("h1", { children: "Submission not found" }), _jsxs("p", { children: ["No submission id in the address. ", _jsx(Link, { to: ROUTES.queue, children: "Back to the queue" })] })] }));
    }
    if (detail === null || plan === null) {
        if (loaded.error !== null) {
            return (_jsxs("section", { className: "submission-page", children: [_jsx("h1", { children: `Submission ${id}` }), _jsxs("div", { role: "alert", className: "submission-error", children: [_jsx("p", { children: `Could not load submission ${id}: ${loaded.error.message}` }), _jsx("button", { type: "button", onClick: reload, style: { minHeight: MIN_TOUCH_TARGET }, children: "Retry" })] }), _jsx("p", { children: _jsx(Link, { to: { pathname: ROUTES.queue, search: origin.search }, children: "Back to the queue" }) })] }));
        }
        return (_jsxs("section", { className: "submission-page", children: [_jsx("h1", { children: `Submission ${id}` }), _jsx(Skeleton, { label: `Loading submission ${id}`, lines: 8 })] }));
    }
    const noPolicy = detail.accountKind === 'no_policy';
    const bodies = {
        a: (_jsx(Explanation, { explanation: detail.explanation, verdict: detail.verdict, appetiteScore: detail.appetiteScore })),
        b: (_jsx(ScoreBreakdown, { factors: detail.factors, appetiteScore: detail.appetiteScore, completeness: detail.completeness })),
        c: _jsx(QueryTrace, { entries: detail.queryTrace }),
        d: noPolicy ? (_jsx(PeerBenchmark, { benchmark: detail.peers })) : (_jsxs(_Fragment, { children: [_jsx(Pricing, { pricing: detail.pricing }), _jsx(PeerBenchmark, { benchmark: detail.peers })] })),
        e: _jsx(Buildings, { buildings: detail.buildings, rollup: detail.rollup }),
        f: (_jsx(Contradictions, { contradictions: detail.contradictions, interpretations: detail.interpretations })),
        g: _jsx(Flip, { flip: detail.flip }),
        h: _jsx(Vector, { vector: detail.vector }),
        i: _jsx(Schema, { schema: detail.schema }),
        j: _jsx(Enrichment, { cards: detail.enrichment }),
        k: (_jsxs(_Fragment, { children: [_jsx(Actions, { submissionId: detail.submissionId, routing: routingFor(detail), drafts: detail.drafts, log: detail.actionLog, onApprove: onApprove }), _jsx(ReplyBox, { submissionId: detail.submissionId, result: reply, pending: pending === 'reply', onSubmitText: onSubmitText, onSubmitFile: onSubmitFile })] })),
        l: _jsx(AttachedSweep, { sweep: detail.sweep }),
    };
    const busy = pending !== null;
    const decisionShown = plan.shown.some((p) => p.letter === DECISION);
    const flipAvailable = detail.flip.available;
    const renderPanel = (spec) => {
        const anchor = panelAnchor(spec.letter);
        const body = (_jsx(PanelBoundary, { title: spec.title, resetKey: detail, children: bodies[spec.letter] }));
        if (spec.weight === 'quiet') {
            return (_jsx(QuietPanel, { title: spec.title, anchorId: anchor, children: body }, spec.letter));
        }
        // No outer Card: every panel renders its own, so wrapping one in another
        // printed the same heading twice inside two nested bordered surfaces. The
        // anchor moves to a bare div so `#panel-b` still resolves.
        return (_jsxs("div", { id: anchor, className: "submission-panel", children: [spec.letter === 'd' && noPolicy ? (_jsx("p", { className: "submission-panel-note", "data-testid": "no-pricing", children: "No premium to price" })) : null, body] }, spec.letter));
    };
    return (_jsxs("article", { className: "submission-page", "aria-labelledby": headingId, "aria-busy": busy, children: [_jsx(SubmissionHeader, { detail: detail, headingId: headingId, busy: busy, origin: origin, navState: location.state, onRerun: onRerun, onEnrich: onEnrich }), _jsx("p", { role: "status", "aria-live": "polite", className: "submission-status", children: pending !== null ? `${MUTATION_LABEL[pending]}…` : loaded.loading ? 'Refreshing…' : '' }), mutationError !== null ? (_jsx("div", { role: "alert", className: "submission-error", children: _jsx("p", { children: mutationError }) })) : null, loaded.error !== null ? (_jsxs("div", { role: "alert", className: "submission-error", children: [_jsx("p", { children: `Could not refresh: ${loaded.error.message}` }), _jsx("button", { type: "button", onClick: reload, style: { minHeight: MIN_TOUCH_TARGET }, children: "Retry" })] })) : null, sparse ? (_jsx(Card, { title: FACTS_TITLE, anchorId: FACTS_ANCHOR, children: _jsx(AccountFacts, { accountKind: detail.accountKind === 'triage_knockout' ? 'triage_knockout' : 'no_policy', displayLineOfBusiness: detail.displayLineOfBusiness, facts: detail.facts, factors: detail.factors, traceAnchor: panelAnchor('c') }) })) : null, decisionShown ? (_jsxs("section", { id: panelAnchor(DECISION), "aria-labelledby": decisionHeadingId, style: decisionStyle, children: [_jsxs("header", { style: decisionHeaderStyle, children: [_jsx("h2", { id: decisionHeadingId, className: "rf-card__title", style: decisionTitleStyle, children: "The decision" }), flipAvailable ? (_jsx("a", { href: `#${panelAnchor('g')}`, style: { fontSize: cssVar('size-small') }, children: "One flip from FIT" })) : null] }), _jsx(PanelBoundary, { title: "The decision", resetKey: detail, children: bodies.a })] })) : null, _jsx(PanelIndex, { entries: entries, active: active }), GROUPS.map((group) => {
                const items = plan.shown.filter((p) => p.group === group.id && p.letter !== DECISION);
                const checksHere = group.id === 'evidence' && hasChecks;
                if (items.length === 0 && !checksHere)
                    return null;
                const labelId = `${headingId}-${group.id}`;
                return (_jsxs("section", { id: sectionAnchor(group.id), "aria-labelledby": labelId, className: "submission-section", style: sectionStyle, children: [_jsx("h2", { id: labelId, style: sectionHeadingStyle, children: group.label }), items.map(renderPanel), checksHere && detail.verification !== null ? (_jsx(Card, { title: CHECKS_TITLE, anchorId: CHECKS_ANCHOR, children: _jsx(PanelBoundary, { title: CHECKS_TITLE, resetKey: detail, children: _jsx(IndependentChecks, { verification: detail.verification, verificationPath: ROUTES.verification }) }) })) : null] }, group.id));
            }), plan.hidden.length > 0 ? (_jsx(QuietPanel, { title: NOT_APPLICABLE_TITLE, anchorId: NOT_APPLICABLE_ANCHOR, children: _jsx("ul", { "data-testid": "not-applicable", style: { margin: 0, paddingLeft: SPACE.lg }, children: plan.hidden.map(({ spec, reason }) => (_jsxs("li", { "data-letter": spec.letter, children: [_jsx("strong", { children: spec.title }), ` — ${reason}`] }, spec.letter))) }) })) : null] }));
}
//# sourceMappingURL=SubmissionPage.js.map