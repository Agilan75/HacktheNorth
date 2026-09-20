import { Component, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ErrorInfo, ReactElement, ReactNode } from 'react';
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
import type { ReplyResultView, RoutingView, SubmissionDetailView } from '../panels/types.js';

/* ---------------------------------------------------------------------------
 * The page has one primary object — the decision — and everything else is
 * supporting material, grouped. The panel keys below are internal ids only:
 * they are the stable anchors other pages deep-link to (`#panel-c`) and never
 * appear in a title.
 * ------------------------------------------------------------------------- */

type PanelLetter = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j' | 'k' | 'l';

type GroupId = 'numbers' | 'evidence' | 'next';

/** `quiet` renders collapsed, borderless and muted: reference material, not reading. */
type PanelWeight = 'normal' | 'quiet';

interface PanelSpec {
  readonly letter: PanelLetter;
  readonly title: string;
  readonly group: GroupId;
  readonly weight: PanelWeight;
}

interface GroupSpec {
  readonly id: GroupId;
  readonly label: string;
}

const GROUPS: readonly GroupSpec[] = [
  { id: 'numbers', label: 'The numbers' },
  { id: 'evidence', label: 'The evidence' },
  { id: 'next', label: 'Next steps' },
];

/** Render order within a group is this order. The decision panel (a) is not in a group. */
const PANELS: readonly PanelSpec[] = [
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
const DECISION: PanelLetter = 'a';

const PANEL_ORDER: Readonly<Record<PanelLetter, number>> = {
  a: 0, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6, h: 7, i: 8, j: 9, k: 10, l: 11,
};

function panelAnchor(letter: PanelLetter): string {
  return `panel-${letter}`;
}

function sectionAnchor(group: GroupId): string {
  return `section-${group}`;
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/* ---------------------------------------------------------------------------
 * One panel failing to render must never blank the others.
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
 * Where the user came from. The queue puts its filter state in the URL; a link
 * out of it may hand us that search string and the ordered ids it was showing.
 * Both are optional — nothing here fetches, and nothing here breaks without it.
 * ------------------------------------------------------------------------- */

interface QueueOrigin {
  /** `?verdict=REFER&…` as the queue had it, or '' — appended to the breadcrumb. */
  readonly search: string;
  /** The queue's row order, when the link carried it. */
  readonly ids: readonly string[];
}

function normalizeSearch(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '?') return '';
  return trimmed.startsWith('?') ? trimmed : `?${trimmed}`;
}

function searchFromReferrer(): string {
  try {
    if (typeof document === 'undefined') return '';
    const ref = document.referrer;
    if (typeof ref !== 'string' || ref === '') return '';
    const url = new URL(ref, typeof window === 'undefined' ? 'http://localhost/' : window.location.href);
    return url.pathname === ROUTES.queue ? normalizeSearch(url.search) : '';
  } catch {
    return '';
  }
}

function readQueueOrigin(state: unknown): QueueOrigin {
  const bag = typeof state === 'object' && state !== null ? (state as Record<string, unknown>) : {};
  const rawSearch =
    typeof bag.queueSearch === 'string' ? bag.queueSearch : typeof bag.search === 'string' ? bag.search : '';
  const search = normalizeSearch(rawSearch) || searchFromReferrer();
  const ids = Array.isArray(bag.queue)
    ? bag.queue.filter((value): value is string => typeof value === 'string')
    : [];
  return { search, ids };
}

/* ---------------------------------------------------------------------------
 * Header: identity, the four headline numbers, queue navigation.
 * ------------------------------------------------------------------------- */

const headerRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: SPACE.md,
};

const stepStyle: CSSProperties = {
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

interface HeaderProps {
  readonly detail: SubmissionDetailView;
  readonly headingId: string;
  readonly busy: boolean;
  readonly origin: QueueOrigin;
  readonly navState: unknown;
  readonly onRerun: () => void;
  readonly onEnrich: () => void;
}

function SubmissionHeader(props: HeaderProps): ReactElement {
  const { detail, headingId, busy, origin, navState } = props;
  const at = origin.ids.indexOf(detail.submissionId);
  const prev = at > 0 ? origin.ids[at - 1] ?? null : null;
  const next = at >= 0 && at < origin.ids.length - 1 ? origin.ids[at + 1] ?? null : null;

  return (
    <header className="submission-header">
      <div style={headerRowStyle}>
        <p className="submission-breadcrumb" style={{ margin: 0 }}>
          <Link to={{ pathname: ROUTES.queue, search: origin.search }}>Queue</Link>
          {' / '}
          <span>{detail.submissionId}</span>
        </p>
        {prev !== null || next !== null ? (
          <nav aria-label="Queue order" style={{ display: 'flex', gap: SPACE.sm }}>
            {prev !== null ? (
              <Link to={submissionPath(prev)} state={navState} style={stepStyle} rel="prev">
                ← Previous
              </Link>
            ) : null}
            {next !== null ? (
              <Link to={submissionPath(next)} state={navState} style={stepStyle} rel="next">
                Next →
              </Link>
            ) : null}
          </nav>
        ) : null}
      </div>
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
              title="Values hand-authored, scored by the engine"
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
        <button type="button" onClick={props.onRerun} disabled={busy} style={{ minHeight: MIN_TOUCH_TARGET }}>
          Re-run agent
        </button>
        <button type="button" onClick={props.onEnrich} disabled={busy} style={{ minHeight: MIN_TOUCH_TARGET }}>
          Run enrichment
        </button>
      </div>
    </header>
  );
}

/* ---------------------------------------------------------------------------
 * Which panels apply (FILL-console D1). A fully scored account shows all
 * twelve. A triage knockout or a no-policy submission has no policy, buildings,
 * premium or losses behind it, so a panel built on those is left out and listed
 * with its reason. A panel whose data IS present always shows.
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
      // A no-policy account has peers but nothing to price: (d) is the benchmark alone.
      shown.push(
        spec.letter === 'd' && detail.accountKind === 'no_policy' ? { ...spec, title: 'Peer benchmark' } : spec,
      );
    } else {
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

const indexStyle: CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 2,
  background: cssVar('paper'),
  borderBottom: `${cssVar('border-width')} solid ${cssVar('border-color')}`,
  padding: `${SPACE.sm}px 0`,
  marginBottom: SPACE.lg,
};

const chipRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: `${SPACE.xs}px ${SPACE.sm}px`,
  margin: 0,
  padding: 0,
  listStyle: 'none',
};

function chipStyle(active: boolean, quiet: boolean): CSSProperties {
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

interface IndexEntry {
  readonly id: string;
  readonly label: string;
  readonly anchor: string;
  readonly children: readonly { readonly anchor: string; readonly label: string }[];
}

function PanelIndex(props: {
  readonly entries: readonly IndexEntry[];
  readonly active: string;
}): ReactElement | null {
  const current = props.entries.find((e) => e.id === props.active) ?? props.entries[0];
  if (current === undefined) return null;
  return (
    <nav aria-label="Panels on this page" className="submission-index" style={indexStyle}>
      <ul style={chipRowStyle}>
        {props.entries.map((entry) => (
          <li key={entry.id}>
            <a
              href={`#${entry.anchor}`}
              style={chipStyle(entry.id === current.id, false)}
              aria-current={entry.id === current.id ? 'true' : undefined}
            >
              {entry.label}
            </a>
          </li>
        ))}
      </ul>
      {current.children.length > 0 ? (
        <ul style={{ ...chipRowStyle, marginTop: SPACE.xs }} aria-label={`${current.label} panels`}>
          {current.children.map((child) => (
            <li key={child.anchor}>
              <a href={`#${child.anchor}`} style={chipStyle(false, true)}>
                {child.label}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </nav>
  );
}

/**
 * Highlights whichever indexed section is in view. `IntersectionObserver` is
 * absent in jsdom, so the hook feature-detects and leaves the first entry
 * active rather than shimming anything.
 */
function useActiveSection(anchors: readonly string[], fallback: string): string {
  const [active, setActive] = useState(fallback);
  const key = anchors.join('|');

  useEffect(() => {
    setActive(fallback);
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const ids = key.split('|').filter((a) => a.length > 0);
    const seen = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
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
        if (best !== '') setActive(best);
      },
      { rootMargin: '-72px 0px -55% 0px', threshold: [0, 0.25, 0.5, 1] },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el !== null) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [key, fallback]);

  return active;
}

/** A knockout is never routed (PRD 7.6); say that, not "run the plan". */
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
 * Surfaces: the decision block, a section heading, a demoted panel.
 * ------------------------------------------------------------------------- */

const decisionStyle: CSSProperties = {
  background: cssVar('muted-tint'),
  border: `${cssVar('border-width')} solid ${cssVar('border-color')}`,
  borderRadius: RADIUS.card,
  padding: SPACE.xl,
  scrollMarginTop: SPACE.xxl,
};

const decisionHeaderStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: SPACE.md,
  marginBottom: SPACE.lg,
};

const decisionTitleStyle: CSSProperties = {
  margin: 0,
  fontFamily: cssVar('font-display'),
  fontSize: cssVar('size-title'),
  lineHeight: cssVar('leading-title'),
  fontWeight: 600,
};

const sectionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: SPACE.lg,
  scrollMarginTop: SPACE.xxl,
};

const sectionHeadingStyle: CSSProperties = {
  margin: 0,
  fontFamily: cssVar('font-body'),
  fontSize: cssVar('size-micro'),
  lineHeight: cssVar('leading-micro'),
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: cssVar('muted-deep'),
  fontWeight: 600,
};

const quietStyle: CSSProperties = {
  border: 'none',
  padding: 0,
  scrollMarginTop: SPACE.xxl,
};

const quietSummaryStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  minHeight: MIN_TOUCH_TARGET,
  cursor: 'pointer',
  color: cssVar('muted-deep'),
};

const quietTitleStyle: CSSProperties = {
  display: 'inline',
  margin: 0,
  fontFamily: cssVar('font-body'),
  fontSize: cssVar('size-small'),
  lineHeight: cssVar('leading-small'),
  fontWeight: 600,
  color: cssVar('muted-deep'),
};

function QuietPanel(props: {
  readonly title: string;
  readonly anchorId: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <details id={props.anchorId} className="submission-quiet" style={quietStyle}>
      <summary style={quietSummaryStyle}>
        <h2 className="rf-card__title" style={quietTitleStyle}>
          {props.title}
        </h2>
      </summary>
      <div style={{ marginTop: SPACE.md }}>{props.children}</div>
    </details>
  );
}

/* ---------------------------------------------------------------------------
 * The page.
 * ------------------------------------------------------------------------- */

type Mutation = 'rerun' | 'enrich' | 'approve' | 'reply' | 'decide';

const MUTATION_LABEL: Readonly<Record<Mutation, string>> = {
  rerun: 'Re-running the agent',
  enrich: 'Running enrichment',
  approve: 'Approving the request',
  reply: 'Reading the reply',
  decide: 'Recording your decision',
};

/**
 * PRD 10 /submissions/:id — the decision, then the supporting panels grouped.
 *
 * Route registration lives in src/App.tsx and is frozen.
 */
export function SubmissionPage(): ReactElement {
  const params = useParams();
  const id = params.id ?? '';
  const headingId = useId();
  const decisionHeadingId = `${headingId}-decision`;
  const location = useLocation();

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

  /**
   * Records the failure as `mutationError` (the page-level alert) and then
   * rethrows, so a caller that awaits `run` — DraftCard's approve button,
   * ReplyBox's paste-or-upload form — learns the mutation actually failed and
   * does not treat a caught, logged error as a success.
   */
  const run = useCallback(
    async (kind: Mutation, work: () => Promise<void>): Promise<void> => {
      setPending(kind);
      setMutationError(null);
      try {
        await work();
      } catch (err) {
        if (alive.current) setMutationError(`${MUTATION_LABEL[kind]} failed: ${messageOf(err)}`);
        throw err;
      } finally {
        if (alive.current) setPending(null);
      }
    },
    [],
  );

  // Neither button's caller awaits the result — the failure already lands in
  // `mutationError` above — so the rethrow from `run` is caught here and
  // dropped rather than becoming an unhandled rejection.
  const onRerun = useCallback((): void => {
    void run('rerun', async () => {
      const next = await client.runSubmission(id);
      if (alive.current) setFresh(next);
    }).catch(() => {});
  }, [client, id, run]);

  const onEnrich = useCallback((): void => {
    void run('enrich', async () => {
      const next = await client.enrich(id);
      if (alive.current) setFresh(next);
    }).catch(() => {});
  }, [client, id, run]);

  const onApprove = useCallback(
    (actionId: string): Promise<void> =>
      run('approve', async () => {
        await client.approveAction(actionId);
        reload();
      }),
    [client, reload, run],
  );

  /**
   * Record the underwriter's accept or decline. The engine is not re-run and
   * the verdict does not move, so this reloads only to pick up the new row in
   * the action log.
   */
  const onDecide = useCallback(
    (decision: 'accept' | 'decline', reason: string): Promise<void> =>
      run('decide', async () => {
        await client.decide(id, decision, reason);
        reload();
      }),
    [client, id, reload, run],
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

  const detail = fresh ?? loaded.data;
  const origin = useMemo(() => readQueueOrigin(location.state), [location.state]);

  const plan = useMemo(() => (detail === null ? null : planPanels(detail)), [detail]);
  const sparse = detail !== null && detail.accountKind !== 'scored';
  const hasChecks = detail !== null && detail.verification !== null;

  const entries = useMemo((): readonly IndexEntry[] => {
    if (plan === null) return [];
    const out: IndexEntry[] = [];
    if (sparse) out.push({ id: FACTS_ANCHOR, label: FACTS_TITLE, anchor: FACTS_ANCHOR, children: [] });
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
      if (children.length === 0) continue;
      out.push({ id: sectionAnchor(group.id), label: group.label, anchor: sectionAnchor(group.id), children });
    }
    return out;
  }, [plan, sparse, hasChecks]);

  const anchors = useMemo(() => entries.map((e) => e.id), [entries]);
  const fallbackAnchor = anchors[0] ?? '';
  const active = useActiveSection(anchors, fallbackAnchor);

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

  if (detail === null || plan === null) {
    if (loaded.error !== null) {
      return (
        <section className="submission-page">
          <h1>{`Submission ${id}`}</h1>
          <div role="alert" className="submission-error">
            <p>{`Could not load submission ${id}: ${loaded.error.message}`}</p>
            <button type="button" onClick={reload} style={{ minHeight: MIN_TOUCH_TARGET }}>
              Retry
            </button>
          </div>
          <p>
            <Link to={{ pathname: ROUTES.queue, search: origin.search }}>Back to the queue</Link>
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

  const noPolicy = detail.accountKind === 'no_policy';

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
    d: noPolicy ? (
      <PeerBenchmark benchmark={detail.peers} />
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
          engineVerdict={detail.verdict}
          onDecide={onDecide}
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
  const decisionShown = plan.shown.some((p) => p.letter === DECISION);
  const flipAvailable = detail.flip.available;

  const renderPanel = (spec: PanelSpec): ReactElement => {
    const anchor = panelAnchor(spec.letter);
    const body = (
      <PanelBoundary title={spec.title} resetKey={detail}>
        {bodies[spec.letter]}
      </PanelBoundary>
    );
    if (spec.weight === 'quiet') {
      return (
        <QuietPanel key={spec.letter} title={spec.title} anchorId={anchor}>
          {body}
        </QuietPanel>
      );
    }
    // No outer Card: every panel renders its own, so wrapping one in another
    // printed the same heading twice inside two nested bordered surfaces. The
    // anchor moves to a bare div so `#panel-b` still resolves.
    return (
      <div key={spec.letter} id={anchor} className="submission-panel">
        {spec.letter === 'd' && noPolicy ? (
          <p className="submission-panel-note" data-testid="no-pricing">
            No premium to price
          </p>
        ) : null}
        {body}
      </div>
    );
  };

  return (
    <article className="submission-page" aria-labelledby={headingId} aria-busy={busy}>
      <SubmissionHeader
        detail={detail}
        headingId={headingId}
        busy={busy}
        origin={origin}
        navState={location.state}
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
          <button type="button" onClick={reload} style={{ minHeight: MIN_TOUCH_TARGET }}>
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

      {decisionShown ? (
        <section id={panelAnchor(DECISION)} aria-labelledby={decisionHeadingId} style={decisionStyle}>
          <header style={decisionHeaderStyle}>
            <h2 id={decisionHeadingId} className="rf-card__title" style={decisionTitleStyle}>
              The decision
            </h2>
            {flipAvailable ? (
              <a href={`#${panelAnchor('g')}`} style={{ fontSize: cssVar('size-small') }}>
                One flip from FIT
              </a>
            ) : null}
          </header>
          <PanelBoundary title="The decision" resetKey={detail}>
            {bodies.a}
          </PanelBoundary>
        </section>
      ) : null}

      <PanelIndex entries={entries} active={active} />

      {GROUPS.map((group) => {
        const items = plan.shown.filter((p) => p.group === group.id && p.letter !== DECISION);
        const checksHere = group.id === 'evidence' && hasChecks;
        if (items.length === 0 && !checksHere) return null;
        const labelId = `${headingId}-${group.id}`;
        return (
          <section
            key={group.id}
            id={sectionAnchor(group.id)}
            aria-labelledby={labelId}
            className="submission-section"
            style={sectionStyle}
          >
            <h2 id={labelId} style={sectionHeadingStyle}>
              {group.label}
            </h2>
            {items.map(renderPanel)}
            {checksHere && detail.verification !== null ? (
              <Card title={CHECKS_TITLE} anchorId={CHECKS_ANCHOR}>
                <PanelBoundary title={CHECKS_TITLE} resetKey={detail}>
                  <IndependentChecks
                    verification={detail.verification}
                    verificationPath={ROUTES.verification}
                  />
                </PanelBoundary>
              </Card>
            ) : null}
          </section>
        );
      })}

      {plan.hidden.length > 0 ? (
        <QuietPanel title={NOT_APPLICABLE_TITLE} anchorId={NOT_APPLICABLE_ANCHOR}>
          <ul data-testid="not-applicable" style={{ margin: 0, paddingLeft: SPACE.lg }}>
            {plan.hidden.map(({ spec, reason }) => (
              <li key={spec.letter} data-letter={spec.letter}>
                <strong>{spec.title}</strong>
                {` — ${reason}`}
              </li>
            ))}
          </ul>
        </QuietPanel>
      ) : null}
    </article>
  );
}
