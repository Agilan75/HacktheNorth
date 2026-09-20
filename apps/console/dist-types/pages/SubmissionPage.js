import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Component, useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { formatPercent, formatScore } from '@retrofit/contracts';
import { ROUTES } from '../App.js';
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
const PANELS = [
    { letter: 'a', title: 'Explanation and recommendation' },
    { letter: 'b', title: 'Score breakdown' },
    { letter: 'c', title: 'How the agent got here' },
    { letter: 'd', title: 'Pricing and peer benchmark' },
    { letter: 'e', title: 'Buildings and rollup' },
    { letter: 'f', title: 'Contradictions and interpretations' },
    { letter: 'g', title: 'Minimal flip' },
    { letter: 'h', title: 'Feature vector' },
    { letter: 'i', title: 'Discovered schema' },
    { letter: 'j', title: 'Enrichment' },
    { letter: 'k', title: 'Actions' },
    { letter: 'l', title: 'Attached photo or sweep' },
];
function panelAnchor(letter) {
    return `panel-${letter}`;
}
function panelTitle(spec) {
    return `(${spec.letter}) ${spec.title}`;
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
function SubmissionHeader(props) {
    const { detail, headingId, busy } = props;
    return (_jsxs("header", { className: "submission-header", children: [_jsxs("p", { className: "submission-breadcrumb", children: [_jsx(Link, { to: ROUTES.queue, children: "Queue" }), ' / ', _jsx("span", { children: detail.submissionId })] }), _jsx("h1", { id: headingId, children: detail.insuredName }), _jsxs("div", { className: "submission-verdict", children: [_jsx(VerdictPill, { verdict: detail.verdict }), detail.accountKind !== 'scored' ? (_jsxs(_Fragment, { children: [' ', _jsx(Badge, { label: KIND_BADGE[detail.accountKind], tone: "attention" })] })) : null, detail.synthetic ? (_jsxs(_Fragment, { children: [' ', _jsx(Badge, { label: "Synthetic data", tone: "attention", title: "Federato holds no policy for this account. Its location, building, premium and loss values were hand-authored for the demo; the engine scored them." })] })) : null] }), _jsxs("dl", { className: "submission-headline", children: [_jsxs("div", { children: [_jsx("dt", { children: "Line of business" }), _jsx("dd", { "data-field": "lineOfBusiness", children: lineOfBusinessLabel(detail.displayLineOfBusiness) })] }), _jsxs("div", { children: [_jsx("dt", { children: "Appetite score" }), _jsx("dd", { "data-field": "appetiteScore", children: formatScore(detail.appetiteScore, { outOf: true }) })] }), _jsxs("div", { children: [_jsx("dt", { children: "Completeness" }), _jsx("dd", { "data-field": "completeness", children: formatPercent(detail.completeness, { from: 'percent', decimals: 1 }) })] }), _jsxs("div", { children: [_jsx("dt", { children: "Confidence" }), _jsx("dd", { "data-field": "confidence", children: formatPercent(detail.confidence) })] })] }), _jsxs("div", { className: "submission-controls", children: [_jsx("button", { type: "button", onClick: props.onRerun, disabled: busy, style: { minHeight: 44 }, children: "Re-run agent" }), _jsx("button", { type: "button", onClick: props.onEnrich, disabled: busy, style: { minHeight: 44 }, children: "Run enrichment" })] })] }));
}
/* ---------------------------------------------------------------------------
 * Which panels apply (FILL-console D1). A fully scored account shows all
 * twelve, exactly as before. A triage knockout or a no-policy submission has
 * no policy, buildings, premium or losses behind it, so a panel built on those
 * would be a card of dashes: it is left out and listed, with the reason in
 * words, under "Not applicable to this account". A panel whose data IS present
 * (a sweep, an enrichment card, a contradiction, an available flip) always
 * shows, whatever the kind.
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
            return 'Line of business alone decides a triage knockout. The other seven factors need policy and building data, which is never read for a line outside appetite.';
        case 'd':
            return 'No premium, buildings or losses were read, so there is nothing to price and no peers to compare against.';
        case 'e':
            return knockout
                ? 'No buildings were read: the deep query covers property policies only.'
                : 'Federato holds no policy for this submission, so there are no buildings.';
        case 'f':
            return 'No field on this account has two conflicting sources, and no interpretation was applied.';
        case 'g': {
            const reason = detail.flip.reason?.trim() ?? '';
            return reason.length > 0 ? `No minimal flip. ${reason}` : 'No minimal flip: no move reaches FIT.';
        }
        case 'h':
            return 'The building, premium and loss components of the feature vector are all missing, so it adds nothing to the facts above.';
        case 'i':
            return 'The discovered schema maps Federato’s policy and building fields; this submission has none.';
        case 'j':
            return 'Enrichment looks up flood zone and fire-station distance for building locations; this submission has no buildings.';
        case 'l':
            return 'No photo or sweep is attached.';
        default:
            return 'Not applicable to this account.';
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
            // A no-policy account has peers but nothing to price: its (d) is the benchmark alone.
            shown.push(spec.letter === 'd' && detail.accountKind === 'no_policy' ? { letter: 'd', title: 'Peer benchmark' } : spec);
        }
        else {
            hidden.push({ spec, reason: notApplicableReason(spec.letter, detail) });
        }
    }
    return { shown, hidden };
}
const FACTS_ANCHOR = 'panel-facts';
const CHECKS_ANCHOR = 'panel-checks';
const CHECKS_TITLE = 'Independent checks';
const FACTS_TITLE = 'Submission facts';
function PanelIndex(props) {
    return (_jsx("nav", { "aria-label": "Panels on this page", className: "submission-index", children: _jsxs("ol", { children: [props.facts ? (_jsx("li", { children: _jsx("a", { href: `#${FACTS_ANCHOR}`, children: FACTS_TITLE }) })) : null, props.shown.map((p) => (_jsx("li", { children: _jsx("a", { href: `#${panelAnchor(p.letter)}`, children: panelTitle(p) }) }, p.letter))), props.checks ? (_jsx("li", { children: _jsx("a", { href: `#${CHECKS_ANCHOR}`, children: CHECKS_TITLE }) })) : null] }) }));
}
/** A knockout is never routed (PRD 7.6: "any account that is not knocked out"); say that, not "run the plan". */
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
const MUTATION_LABEL = {
    rerun: 'Re-running the agent',
    enrich: 'Running enrichment',
    approve: 'Approving the request',
    reply: 'Reading the reply',
};
/**
 * PRD 10 /submissions/:id - composes panels (a) through (l).
 *
 * Stub frozen by W0-4. Unit C05 replaces this body only.
 * Route registration lives in src/App.tsx and is frozen.
 */
export function SubmissionPage() {
    const params = useParams();
    const id = params.id ?? '';
    const headingId = useId();
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
    const run = useCallback(async (kind, work) => {
        setPending(kind);
        setMutationError(null);
        try {
            await work();
        }
        catch (err) {
            if (alive.current)
                setMutationError(`${MUTATION_LABEL[kind]} failed: ${messageOf(err)}`);
        }
        finally {
            if (alive.current)
                setPending(null);
        }
    }, []);
    const onRerun = useCallback(() => {
        void run('rerun', async () => {
            const next = await client.runSubmission(id);
            if (alive.current)
                setFresh(next);
        });
    }, [client, id, run]);
    const onEnrich = useCallback(() => {
        void run('enrich', async () => {
            const next = await client.enrich(id);
            if (alive.current)
                setFresh(next);
        });
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
    if (id === '') {
        return (_jsxs("section", { className: "submission-page", children: [_jsx("h1", { children: "Submission not found" }), _jsxs("p", { children: ["No submission id in the address. ", _jsx(Link, { to: ROUTES.queue, children: "Back to the queue" })] })] }));
    }
    const detail = fresh ?? loaded.data;
    if (detail === null) {
        if (loaded.error !== null) {
            return (_jsxs("section", { className: "submission-page", children: [_jsx("h1", { children: `Submission ${id}` }), _jsxs("div", { role: "alert", className: "submission-error", children: [_jsx("p", { children: `Could not load submission ${id}: ${loaded.error.message}` }), _jsx("button", { type: "button", onClick: reload, style: { minHeight: 44 }, children: "Retry" })] }), _jsx("p", { children: _jsx(Link, { to: ROUTES.queue, children: "Back to the queue" }) })] }));
        }
        return (_jsxs("section", { className: "submission-page", children: [_jsx("h1", { children: `Submission ${id}` }), _jsx(Skeleton, { label: `Loading submission ${id}`, lines: 8 })] }));
    }
    const bodies = {
        a: (_jsx(Explanation, { explanation: detail.explanation, verdict: detail.verdict, appetiteScore: detail.appetiteScore })),
        b: (_jsx(ScoreBreakdown, { factors: detail.factors, appetiteScore: detail.appetiteScore, completeness: detail.completeness })),
        c: _jsx(QueryTrace, { entries: detail.queryTrace }),
        d: detail.accountKind === 'no_policy' ? (_jsxs(_Fragment, { children: [_jsx("p", { "data-testid": "no-pricing", children: "No premium to price: Federato holds no policy for this submission. The peers below are matched on what is known." }), _jsx(PeerBenchmark, { benchmark: detail.peers })] })) : (_jsxs(_Fragment, { children: [_jsx(Pricing, { pricing: detail.pricing }), _jsx(PeerBenchmark, { benchmark: detail.peers })] })),
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
    const plan = planPanels(detail);
    const sparse = detail.accountKind !== 'scored';
    return (_jsxs("article", { className: "submission-page", "aria-labelledby": headingId, "aria-busy": busy, children: [_jsx(SubmissionHeader, { detail: detail, headingId: headingId, busy: busy, onRerun: onRerun, onEnrich: onEnrich }), _jsx("p", { role: "status", "aria-live": "polite", className: "submission-status", children: pending !== null ? `${MUTATION_LABEL[pending]}…` : loaded.loading ? 'Refreshing…' : '' }), mutationError !== null ? (_jsx("div", { role: "alert", className: "submission-error", children: _jsx("p", { children: mutationError }) })) : null, loaded.error !== null ? (_jsxs("div", { role: "alert", className: "submission-error", children: [_jsx("p", { children: `Could not refresh: ${loaded.error.message}` }), _jsx("button", { type: "button", onClick: reload, style: { minHeight: 44 }, children: "Retry" })] })) : null, sparse ? (_jsx(Card, { title: FACTS_TITLE, anchorId: FACTS_ANCHOR, children: _jsx(AccountFacts, { accountKind: detail.accountKind === 'triage_knockout' ? 'triage_knockout' : 'no_policy', displayLineOfBusiness: detail.displayLineOfBusiness, facts: detail.facts, factors: detail.factors, traceAnchor: panelAnchor('c') }) })) : null, _jsx(PanelIndex, { shown: plan.shown, facts: sparse, checks: detail.verification !== null }), plan.shown.map((spec) => (_jsx(Card, { title: panelTitle(spec), anchorId: panelAnchor(spec.letter), children: _jsx(PanelBoundary, { title: panelTitle(spec), resetKey: detail, children: bodies[spec.letter] }) }, spec.letter))), detail.verification !== null ? (_jsx(Card, { title: CHECKS_TITLE, anchorId: CHECKS_ANCHOR, children: _jsx(PanelBoundary, { title: CHECKS_TITLE, resetKey: detail, children: _jsx(IndependentChecks, { verification: detail.verification, verificationPath: ROUTES.verification }) }) })) : null, plan.hidden.length > 0 ? (_jsxs(Card, { title: "Not applicable to this account", anchorId: "panel-not-applicable", children: [_jsx("p", { children: "These panels need a policy, buildings, premium or losses, which this submission does not have, so they are left out rather than shown empty." }), _jsx("ul", { "data-testid": "not-applicable", children: plan.hidden.map(({ spec, reason }) => (_jsxs("li", { "data-letter": spec.letter, children: [_jsx("strong", { children: panelTitle(spec) }), ` — ${reason}`] }, spec.letter))) })] })) : null] }));
}
//# sourceMappingURL=SubmissionPage.js.map