import { Component, useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ErrorInfo, ReactElement, ReactNode } from 'react';
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
import type { ReplyResultView, RoutingView, SubmissionDetailView } from '../panels/types.js';

/* ---------------------------------------------------------------------------
 * PRD 10 panel table. The letters and titles are the PRD's; the order is the
 * PRD's. Every panel receives slices of the DTO untouched — this page never
 * computes a number the API already returned (PRD 10, 13).
 * ------------------------------------------------------------------------- */

type PanelLetter = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j' | 'k' | 'l';

interface PanelSpec {
  readonly letter: PanelLetter;
  readonly title: string;
}

const PANELS: readonly PanelSpec[] = [
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

function panelAnchor(letter: PanelLetter): string {
  return `panel-${letter}`;
}

function panelTitle(spec: PanelSpec): string {
  return `(${spec.letter}) ${spec.title}`;
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/* ---------------------------------------------------------------------------
 * One panel failing to render must never blank the other eleven.
 * ------------------------------------------------------------------------- */

interface PanelBoundaryProps {
  readonly title: string;
  /** Changing this key clears a previous failure (new data arrived). */
  readonly resetKey: unknown;
  readonly children: ReactNode;
}

interface PanelBoundaryState {
  readonly error: Error | null;
  readonly resetKey: unknown;
}

class PanelBoundary extends Component<PanelBoundaryProps, PanelBoundaryState> {
  override state: PanelBoundaryState = { error: null, resetKey: undefined };

  static getDerivedStateFromError(error: unknown): Partial<PanelBoundaryState> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(
    props: PanelBoundaryProps,
    state: PanelBoundaryState,
  ): Partial<PanelBoundaryState> | null {
    if (props.resetKey !== state.resetKey) return { error: null, resetKey: props.resetKey };
    return null;
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Rendered inline below; Sentry's global handler already sees the error.
  }

  override render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <div role="alert" className="submission-panel-error">
          <p>{`${this.props.title} could not be shown: ${this.state.error.message}`}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ---------------------------------------------------------------------------
 * Header: identity and the three headline numbers, all straight from the DTO.
 * ------------------------------------------------------------------------- */

interface HeaderProps {
  readonly detail: SubmissionDetailView;
  readonly headingId: string;
  readonly busy: boolean;
  readonly onRerun: () => void;
  readonly onEnrich: () => void;
}

function SubmissionHeader(props: HeaderProps): ReactElement {
  const { detail, headingId, busy } = props;
  return (
    <header className="submission-header">
      <p className="submission-breadcrumb">
        <Link to={ROUTES.queue}>Queue</Link>
        {' / '}
        <span>{detail.submissionId}</span>
      </p>
      <h1 id={headingId}>{detail.insuredName}</h1>
      <div className="submission-verdict">
        <VerdictPill verdict={detail.verdict} />
        {detail.accountKind !== 'scored' ? (
          <>
            {' '}
            <Badge label={KIND_BADGE[detail.accountKind]} tone="attention" />
          </>
        ) : null}
        {detail.synthetic ? (
          <>
            {' '}
            <Badge
              label="Synthetic data"
              tone="attention"
              title="Federato holds no policy for this account. Its location, building, premium and loss values were hand-authored for the demo; the engine scored them."
            />
          </>
        ) : null}
      </div>
      <dl className="submission-headline">
        <div>
          <dt>Line of business</dt>
          {/* Never `lineOfBusiness`: that is the scoring spec (commercial_property), not the submission's line. */}
          <dd data-field="lineOfBusiness">{lineOfBusinessLabel(detail.displayLineOfBusiness)}</dd>
        </div>
        <div>
          <dt>Appetite score</dt>
          <dd data-field="appetiteScore">{formatScore(detail.appetiteScore, { outOf: true })}</dd>
        </div>
        <div>
          <dt>Completeness</dt>
          <dd data-field="completeness">
            {formatPercent(detail.completeness, { from: 'percent', decimals: 1 })}
          </dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd data-field="confidence">{formatPercent(detail.confidence)}</dd>
        </div>
      </dl>
      <div className="submission-controls">
        <button type="button" onClick={props.onRerun} disabled={busy} style={{ minHeight: 44 }}>
          Re-run agent
        </button>
        <button type="button" onClick={props.onEnrich} disabled={busy} style={{ minHeight: 44 }}>
          Run enrichment
        </button>
      </div>
    </header>
  );
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

const ALWAYS_SHOWN: Readonly<Record<'triage_knockout' | 'no_policy', ReadonlySet<PanelLetter>>> = {
  triage_knockout: new Set<PanelLetter>(['a', 'c', 'k']),
  no_policy: new Set<PanelLetter>(['a', 'b', 'c', 'd', 'k']),
};

function hasData(letter: PanelLetter, detail: SubmissionDetailView): boolean {
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

function notApplicableReason(letter: PanelLetter, detail: SubmissionDetailView): string {
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

interface PanelPlan {
  readonly shown: readonly PanelSpec[];
  readonly hidden: readonly { readonly spec: PanelSpec; readonly reason: string }[];
}

function planPanels(detail: SubmissionDetailView): PanelPlan {
  if (detail.accountKind === 'scored') return { shown: PANELS, hidden: [] };
  const always = ALWAYS_SHOWN[detail.accountKind];
  const shown: PanelSpec[] = [];
  const hidden: { spec: PanelSpec; reason: string }[] = [];
  for (const spec of PANELS) {
    if (always.has(spec.letter) || hasData(spec.letter, detail)) {
      // A no-policy account has peers but nothing to price: its (d) is the benchmark alone.
      shown.push(
        spec.letter === 'd' && detail.accountKind === 'no_policy' ? { letter: 'd', title: 'Peer benchmark' } : spec,
      );
    } else {
      hidden.push({ spec, reason: notApplicableReason(spec.letter, detail) });
    }
  }
  return { shown, hidden };
}

const FACTS_ANCHOR = 'panel-facts';
const CHECKS_ANCHOR = 'panel-checks';
const CHECKS_TITLE = 'Independent checks';
const FACTS_TITLE = 'Submission facts';

function PanelIndex(props: {
  readonly shown: readonly PanelSpec[];
  readonly facts: boolean;
  readonly checks: boolean;
}): ReactElement {
  return (
    <nav aria-label="Panels on this page" className="submission-index">
      <ol>
        {props.facts ? (
          <li>
            <a href={`#${FACTS_ANCHOR}`}>{FACTS_TITLE}</a>
          </li>
        ) : null}
        {props.shown.map((p) => (
          <li key={p.letter}>
            <a href={`#${panelAnchor(p.letter)}`}>{panelTitle(p)}</a>
          </li>
        ))}
        {props.checks ? (
          <li>
            <a href={`#${CHECKS_ANCHOR}`}>{CHECKS_TITLE}</a>
          </li>
        ) : null}
      </ol>
    </nav>
  );
}

/** A knockout is never routed (PRD 7.6: "any account that is not knocked out"); say that, not "run the plan". */
function routingFor(detail: SubmissionDetailView): RoutingView {
  if (detail.accountKind === 'triage_knockout' && detail.routing.underwriter === null) {
    return {
      ...detail.routing,
      rationale: 'Not routed: a submission knocked out at triage is never routed to an underwriter.',
    };
  }
  return detail.routing;
}

const KIND_BADGE: Readonly<Record<'triage_knockout' | 'no_policy', string>> = {
  triage_knockout: 'Knocked out at triage',
  no_policy: 'No policy in Federato',
};

/* ---------------------------------------------------------------------------
 * The page.
 * ------------------------------------------------------------------------- */

type Mutation = 'rerun' | 'enrich' | 'approve' | 'reply';

const MUTATION_LABEL: Readonly<Record<Mutation, string>> = {
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
export function SubmissionPage(): ReactElement {
  const params = useParams();
  const id = params.id ?? '';
  const headingId = useId();

  const client = useApiClient();
  const loaded = useApi((c) => c.getSubmission(id), [id]);

  // A run/enrich call returns the whole detail; show it without a refetch.
  // Any later reload (approve, reply) supersedes it.
  const [fresh, setFresh] = useState<SubmissionDetailView | null>(null);
  const [reply, setReply] = useState<ReplyResultView | null>(null);
  const [pending, setPending] = useState<Mutation | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

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

  const run = useCallback(
    async (kind: Mutation, work: () => Promise<void>): Promise<void> => {
      setPending(kind);
      setMutationError(null);
      try {
        await work();
      } catch (err) {
        if (alive.current) setMutationError(`${MUTATION_LABEL[kind]} failed: ${messageOf(err)}`);
      } finally {
        if (alive.current) setPending(null);
      }
    },
    [],
  );

  const onRerun = useCallback((): void => {
    void run('rerun', async () => {
      const next = await client.runSubmission(id);
      if (alive.current) setFresh(next);
    });
  }, [client, id, run]);

  const onEnrich = useCallback((): void => {
    void run('enrich', async () => {
      const next = await client.enrich(id);
      if (alive.current) setFresh(next);
    });
  }, [client, id, run]);

  const onApprove = useCallback(
    (actionId: string): Promise<void> =>
      run('approve', async () => {
        await client.approveAction(actionId);
        reload();
      }),
    [client, reload, run],
  );

  const onSubmitText = useCallback(
    (text: string): Promise<void> =>
      run('reply', async () => {
        const result = await client.postReply(id, { text });
        if (alive.current) setReply(result);
        reload();
      }),
    [client, id, reload, run],
  );

  const onSubmitFile = useCallback(
    (file: File): Promise<void> =>
      run('reply', async () => {
        const result = await client.postReply(id, { file });
        if (alive.current) setReply(result);
        reload();
      }),
    [client, id, reload, run],
  );

  if (id === '') {
    return (
      <section className="submission-page">
        <h1>Submission not found</h1>
        <p>
          No submission id in the address. <Link to={ROUTES.queue}>Back to the queue</Link>
        </p>
      </section>
    );
  }

  const detail = fresh ?? loaded.data;

  if (detail === null) {
    if (loaded.error !== null) {
      return (
        <section className="submission-page">
          <h1>{`Submission ${id}`}</h1>
          <div role="alert" className="submission-error">
            <p>{`Could not load submission ${id}: ${loaded.error.message}`}</p>
            <button type="button" onClick={reload} style={{ minHeight: 44 }}>
              Retry
            </button>
          </div>
          <p>
            <Link to={ROUTES.queue}>Back to the queue</Link>
          </p>
        </section>
      );
    }
    return (
      <section className="submission-page">
        <h1>{`Submission ${id}`}</h1>
        <Skeleton label={`Loading submission ${id}`} lines={8} />
      </section>
    );
  }

  const bodies: Readonly<Record<PanelLetter, ReactNode>> = {
    a: (
      <Explanation
        explanation={detail.explanation}
        verdict={detail.verdict}
        appetiteScore={detail.appetiteScore}
      />
    ),
    b: (
      <ScoreBreakdown
        factors={detail.factors}
        appetiteScore={detail.appetiteScore}
        completeness={detail.completeness}
      />
    ),
    c: <QueryTrace entries={detail.queryTrace} />,
    d:
      detail.accountKind === 'no_policy' ? (
        <>
          <p data-testid="no-pricing">
            No premium to price: Federato holds no policy for this submission. The peers below are
            matched on what is known.
          </p>
          <PeerBenchmark benchmark={detail.peers} />
        </>
      ) : (
        <>
          <Pricing pricing={detail.pricing} />
          <PeerBenchmark benchmark={detail.peers} />
        </>
      ),
    e: <Buildings buildings={detail.buildings} rollup={detail.rollup} />,
    f: (
      <Contradictions
        contradictions={detail.contradictions}
        interpretations={detail.interpretations}
      />
    ),
    g: <Flip flip={detail.flip} />,
    h: <Vector vector={detail.vector} />,
    i: <Schema schema={detail.schema} />,
    j: <Enrichment cards={detail.enrichment} />,
    k: (
      <>
        <Actions
          submissionId={detail.submissionId}
          routing={routingFor(detail)}
          drafts={detail.drafts}
          log={detail.actionLog}
          onApprove={onApprove}
        />
        <ReplyBox
          submissionId={detail.submissionId}
          result={reply}
          pending={pending === 'reply'}
          onSubmitText={onSubmitText}
          onSubmitFile={onSubmitFile}
        />
      </>
    ),
    l: <AttachedSweep sweep={detail.sweep} />,
  };

  const busy = pending !== null;
  const plan = planPanels(detail);
  const sparse = detail.accountKind !== 'scored';

  return (
    <article className="submission-page" aria-labelledby={headingId} aria-busy={busy}>
      <SubmissionHeader
        detail={detail}
        headingId={headingId}
        busy={busy}
        onRerun={onRerun}
        onEnrich={onEnrich}
      />

      <p role="status" aria-live="polite" className="submission-status">
        {pending !== null ? `${MUTATION_LABEL[pending]}…` : loaded.loading ? 'Refreshing…' : ''}
      </p>
      {mutationError !== null ? (
        <div role="alert" className="submission-error">
          <p>{mutationError}</p>
        </div>
      ) : null}
      {loaded.error !== null ? (
        <div role="alert" className="submission-error">
          <p>{`Could not refresh: ${loaded.error.message}`}</p>
          <button type="button" onClick={reload} style={{ minHeight: 44 }}>
            Retry
          </button>
        </div>
      ) : null}

      {sparse ? (
        <Card title={FACTS_TITLE} anchorId={FACTS_ANCHOR}>
          <AccountFacts
            accountKind={detail.accountKind === 'triage_knockout' ? 'triage_knockout' : 'no_policy'}
            displayLineOfBusiness={detail.displayLineOfBusiness}
            facts={detail.facts}
            factors={detail.factors}
            traceAnchor={panelAnchor('c')}
          />
        </Card>
      ) : null}

      <PanelIndex shown={plan.shown} facts={sparse} checks={detail.verification !== null} />

      {plan.shown.map((spec) => (
        <Card key={spec.letter} title={panelTitle(spec)} anchorId={panelAnchor(spec.letter)}>
          <PanelBoundary title={panelTitle(spec)} resetKey={detail}>
            {bodies[spec.letter]}
          </PanelBoundary>
        </Card>
      ))}

      {detail.verification !== null ? (
        <Card title={CHECKS_TITLE} anchorId={CHECKS_ANCHOR}>
          <PanelBoundary title={CHECKS_TITLE} resetKey={detail}>
            <IndependentChecks verification={detail.verification} verificationPath={ROUTES.verification} />
          </PanelBoundary>
        </Card>
      ) : null}

      {plan.hidden.length > 0 ? (
        <Card title="Not applicable to this account" anchorId="panel-not-applicable">
          <p>
            These panels need a policy, buildings, premium or losses, which this submission does not
            have, so they are left out rather than shown empty.
          </p>
          <ul data-testid="not-applicable">
            {plan.hidden.map(({ spec, reason }) => (
              <li key={spec.letter} data-letter={spec.letter}>
                <strong>{panelTitle(spec)}</strong>
                {` — ${reason}`}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </article>
  );
}
