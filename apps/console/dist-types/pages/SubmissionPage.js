import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Component, useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { formatPercent, formatScore, titleCase } from '@retrofit/contracts';
import { ROUTES } from '../App.js';
import { useApi, useApiClient } from '../api/useApi.js';
import { Card } from '../components/atoms/Card.js';
import { Skeleton } from '../components/atoms/Skeleton.js';
import { VerdictPill } from '../components/atoms/VerdictPill.js';
import { Actions } from '../panels/Actions.js';
import { AttachedSweep } from '../panels/AttachedSweep.js';
import { Buildings } from '../panels/Buildings.js';
import { Contradictions } from '../panels/Contradictions.js';
import { Enrichment } from '../panels/Enrichment.js';
import { Explanation } from '../panels/Explanation.js';
import { Flip } from '../panels/Flip.js';
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
    return (_jsxs("header", { className: "submission-header", children: [_jsxs("p", { className: "submission-breadcrumb", children: [_jsx(Link, { to: ROUTES.queue, children: "Queue" }), ' / ', _jsx("span", { children: detail.submissionId })] }), _jsx("h1", { id: headingId, children: detail.insuredName }), _jsx("div", { className: "submission-verdict", children: _jsx(VerdictPill, { verdict: detail.verdict }) }), _jsxs("dl", { className: "submission-headline", children: [_jsxs("div", { children: [_jsx("dt", { children: "Line of business" }), _jsx("dd", { "data-field": "lineOfBusiness", children: titleCase(detail.lineOfBusiness) })] }), _jsxs("div", { children: [_jsx("dt", { children: "Appetite score" }), _jsx("dd", { "data-field": "appetiteScore", children: formatScore(detail.appetiteScore, { outOf: true }) })] }), _jsxs("div", { children: [_jsx("dt", { children: "Completeness" }), _jsx("dd", { "data-field": "completeness", children: formatPercent(detail.completeness, { from: 'percent', decimals: 1 }) })] }), _jsxs("div", { children: [_jsx("dt", { children: "Confidence" }), _jsx("dd", { "data-field": "confidence", children: formatPercent(detail.confidence) })] })] }), _jsxs("div", { className: "submission-controls", children: [_jsx("button", { type: "button", onClick: props.onRerun, disabled: busy, style: { minHeight: 44 }, children: "Re-run agent" }), _jsx("button", { type: "button", onClick: props.onEnrich, disabled: busy, style: { minHeight: 44 }, children: "Run enrichment" })] })] }));
}
function PanelIndex() {
    return (_jsx("nav", { "aria-label": "Panels on this page", className: "submission-index", children: _jsx("ol", { children: PANELS.map((p) => (_jsx("li", { children: _jsx("a", { href: `#${panelAnchor(p.letter)}`, children: panelTitle(p) }) }, p.letter))) }) }));
}
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
        d: (_jsxs(_Fragment, { children: [_jsx(Pricing, { pricing: detail.pricing }), _jsx(PeerBenchmark, { benchmark: detail.peers })] })),
        e: _jsx(Buildings, { buildings: detail.buildings, rollup: detail.rollup }),
        f: (_jsx(Contradictions, { contradictions: detail.contradictions, interpretations: detail.interpretations })),
        g: _jsx(Flip, { flip: detail.flip }),
        h: _jsx(Vector, { vector: detail.vector }),
        i: _jsx(Schema, { schema: detail.schema }),
        j: _jsx(Enrichment, { cards: detail.enrichment }),
        k: (_jsxs(_Fragment, { children: [_jsx(Actions, { submissionId: detail.submissionId, routing: detail.routing, drafts: detail.drafts, log: detail.actionLog, onApprove: onApprove }), _jsx(ReplyBox, { submissionId: detail.submissionId, result: reply, pending: pending === 'reply', onSubmitText: onSubmitText, onSubmitFile: onSubmitFile })] })),
        l: _jsx(AttachedSweep, { sweep: detail.sweep }),
    };
    const busy = pending !== null;
    return (_jsxs("article", { className: "submission-page", "aria-labelledby": headingId, "aria-busy": busy, children: [_jsx(SubmissionHeader, { detail: detail, headingId: headingId, busy: busy, onRerun: onRerun, onEnrich: onEnrich }), _jsx("p", { role: "status", "aria-live": "polite", className: "submission-status", children: pending !== null ? `${MUTATION_LABEL[pending]}…` : loaded.loading ? 'Refreshing…' : '' }), mutationError !== null ? (_jsx("div", { role: "alert", className: "submission-error", children: _jsx("p", { children: mutationError }) })) : null, loaded.error !== null ? (_jsxs("div", { role: "alert", className: "submission-error", children: [_jsx("p", { children: `Could not refresh: ${loaded.error.message}` }), _jsx("button", { type: "button", onClick: reload, style: { minHeight: 44 }, children: "Retry" })] })) : null, _jsx(PanelIndex, {}), PANELS.map((spec) => (_jsx(Card, { title: panelTitle(spec), anchorId: panelAnchor(spec.letter), children: _jsx(PanelBoundary, { title: panelTitle(spec), resetKey: detail, children: bodies[spec.letter] }) }, spec.letter)))] }));
}
//# sourceMappingURL=SubmissionPage.js.map