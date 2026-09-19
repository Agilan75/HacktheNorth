import { Component, useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ErrorInfo, ReactElement, ReactNode } from 'react';
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
import type { ReplyResultView, SubmissionDetailView } from '../panels/types.js';

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
      </div>
      <dl className="submission-headline">
        <div>
          <dt>Line of business</dt>
          <dd data-field="lineOfBusiness">{titleCase(detail.lineOfBusiness)}</dd>
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

function PanelIndex(): ReactElement {
  return (
    <nav aria-label="Panels on this page" className="submission-index">
      <ol>
        {PANELS.map((p) => (
          <li key={p.letter}>
            <a href={`#${panelAnchor(p.letter)}`}>{panelTitle(p)}</a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

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
    d: (
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
          routing={detail.routing}
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

      <PanelIndex />

      {PANELS.map((spec) => (
        <Card key={spec.letter} title={panelTitle(spec)} anchorId={panelAnchor(spec.letter)}>
          <PanelBoundary title={panelTitle(spec)} resetKey={detail}>
            {bodies[spec.letter]}
          </PanelBoundary>
        </Card>
      ))}
    </article>
  );
}
