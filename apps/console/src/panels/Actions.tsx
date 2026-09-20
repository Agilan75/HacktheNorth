import { useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';

import { formatDate, formatMoney, formatScore, formatVerdict, titleCase } from '@retrofit/contracts';

import { Badge } from '../components/atoms/Badge.js';
import { Card } from '../components/atoms/Card.js';
import type {
  ActionLogEntryView,
  ActionsPanelProps,
  RequestDraftView,
  RoutingView,
  Verdict,
} from './types.js';

/** PRD 7.6: a request is saved as a draft; only a draft can be approved. */
const APPROVABLE_STATUS = 'draft';

/** Positive completion states, so "sent" reads as done, not as a leftover "quiet" grey next to "failed". */
const POSITIVE_STATUSES: ReadonlySet<string> = new Set(['approved', 'sent', 'replied', 'applied']);

/** Decoration only — the label text (`titleCase(status)`) always carries the meaning. */
function statusTone(status: string): 'attention' | 'positive' | 'quiet' {
  if (status === APPROVABLE_STATUS || status === 'failed') return 'attention';
  if (POSITIVE_STATUSES.has(status)) return 'positive';
  return 'quiet';
}

function authorityLabel(withinAuthority: boolean | null, underwriter: string | null): string {
  if (withinAuthority === true) return 'Within authority';
  if (withinAuthority === false) return 'Needs referral to senior authority';
  return underwriter === null ? 'Not routed' : 'Authority unknown';
}

/** What a blank routing field means: nothing routed yet, or a routed account missing that field. */
function unroutedText(routing: RoutingView): string {
  return routing.underwriter === null ? 'Not routed' : 'Not recorded';
}

function RoutingBlock(props: { readonly routing: RoutingView }): ReactElement {
  const { routing } = props;
  const label = authorityLabel(routing.withinAuthority, routing.underwriter);
  return (
    <div className="rf-actions__routing" data-testid="actions-routing">
      <h3 className="rf-card__subtitle">
        Routing <Badge label={label} tone={routing.withinAuthority === false ? 'attention' : 'quiet'} />
      </h3>
      <dl className="rf-stats">
        <div className="rf-stat" data-testid="routing-underwriter">
          <dt>Underwriter</dt>
          <dd>{routing.underwriter ?? 'Unassigned'}</dd>
        </div>
        <div className="rf-stat" data-testid="routing-region">
          <dt>Region</dt>
          <dd>{routing.region ?? unroutedText(routing)}</dd>
        </div>
        <div className="rf-stat" data-testid="routing-authority">
          <dt>Authority limit</dt>
          <dd>{routing.authorityLimit === null ? unroutedText(routing) : formatMoney(routing.authorityLimit)}</dd>
        </div>
      </dl>
      <p className="rf-actions__rationale">{routing.rationale}</p>
    </div>
  );
}

type ApproveState = { readonly kind: 'idle' } | { readonly kind: 'pending' } | { readonly kind: 'error'; readonly message: string };

function DraftCard(props: {
  readonly draft: RequestDraftView;
  readonly onApprove: ActionsPanelProps['onApprove'];
}): ReactElement {
  const { draft, onApprove } = props;
  const [state, setState] = useState<ApproveState>({ kind: 'idle' });
  const approvable = draft.status === APPROVABLE_STATUS;
  const pending = state.kind === 'pending';

  const approve = async (): Promise<void> => {
    setState({ kind: 'pending' });
    try {
      await onApprove(draft.actionId);
      setState({ kind: 'idle' });
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <article className="rf-draft" data-testid="actions-draft" data-action-id={draft.actionId}>
      <header className="rf-draft__header">
        <h4 className="rf-draft__subject">{draft.subject}</h4>
        <Badge label={titleCase(draft.status)} tone={statusTone(draft.status)} />
      </header>
      <p className="rf-draft__body" style={{ whiteSpace: 'pre-wrap' }}>
        {draft.body}
      </p>
      {draft.requestedFields.length > 0 ? (
        <div className="rf-scroll-x">
        <table className="rf-table" aria-label="Requested fields">
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Path</th>
              <th scope="col">Value of information</th>
            </tr>
          </thead>
          <tbody>
            {draft.requestedFields.map((f) => (
              <tr key={f.path} data-testid="draft-field">
                <th scope="row">{f.label}</th>
                <td>
                  <code>{f.path}</code>
                </td>
                <td>{f.voi === null ? 'Not ranked' : `${formatScore(f.voi, { decimals: 1 })} pts`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      ) : null}
      {approvable ? (
        <button
          type="button"
          className="rf-button rf-button--primary"
          onClick={() => void approve()}
          disabled={pending}
          aria-label={`Approve request: ${draft.subject}`}
        >
          {pending ? 'Approving…' : 'Approve and mark sent'}
        </button>
      ) : null}
      <p className="rf-footnote">Nothing is emailed; approving marks the request sent.</p>
      {state.kind === 'error' ? (
        <p role="alert" className="rf-error">
          {`Approve failed: ${state.message}`}
        </p>
      ) : null}
    </article>
  );
}

/** Rank 1 is best, so a smaller number is a move up. Presentation only. */
function rankMovement(before: number | null, after: number | null): string {
  if (before === null || after === null) return '';
  const delta = before - after;
  if (delta > 0) return ` (up ${delta})`;
  if (delta < 0) return ` (down ${-delta})`;
  return ' (no change)';
}

/** The words always carry the meaning; green only highlights a genuine improvement. */
function rankMovementStyle(before: number | null, after: number | null): CSSProperties | undefined {
  if (before === null || after === null || before <= after) return undefined;
  return { color: 'var(--rf-green-deep)', fontWeight: 600 };
}

function beforeAfter(before: string, after: string, hasAfter: boolean): string {
  return hasAfter ? `${before} → ${after}` : before;
}

function LogTable(props: { readonly log: readonly ActionLogEntryView[] }): ReactElement {
  if (props.log.length === 0) {
    return <p className="rf-empty">No actions have been logged for this submission.</p>;
  }
  return (
    <div className="rf-scroll-x">
    <table className="rf-table" aria-label="Action log">
      <thead>
        <tr>
          <th scope="col">When</th>
          <th scope="col">Action</th>
          <th scope="col">Status</th>
          <th scope="col">Score</th>
          <th scope="col">Rank</th>
          <th scope="col">Verdict</th>
        </tr>
      </thead>
      <tbody>
        {props.log.map((e) => {
          const hasAfter = e.afterScore !== null || e.afterRank !== null || e.afterVerdict !== null;
          return (
            <tr key={e.actionId} data-testid="action-log-row">
              <td>{formatDate(e.createdAt)}</td>
              <th scope="row">{titleCase(e.type)}</th>
              <td>{titleCase(e.status)}</td>
              <td data-testid="log-score">
                {beforeAfter(formatScore(e.beforeScore), formatScore(e.afterScore), hasAfter)}
              </td>
              <td data-testid="log-rank">
                {beforeAfter(formatScore(e.beforeRank), formatScore(e.afterRank), hasAfter)}
                <span style={rankMovementStyle(e.beforeRank, e.afterRank)}>
                  {rankMovement(e.beforeRank, e.afterRank)}
                </span>
              </td>
              <td data-testid="log-verdict">
                {beforeAfter(formatVerdict(e.beforeVerdict), formatVerdict(e.afterVerdict), hasAfter)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}


/* -------------------------------------------------------------------------- */
/* The underwriter's decision                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Accept or decline, recorded **beside** the engine's verdict rather than over
 * it. The engine's answer, its deciding rule and its score are untouched by
 * this: the point of the whole system is that a number traces to a guideline
 * row, and a verdict a person could overwrite would trace to nothing. So the
 * block shows both — what the rulebook concluded, and what the underwriter did.
 *
 * A reason is optional but asked for, because the decision that is worth
 * reading later is the one that disagreed with the engine and said why.
 */
function DecisionBlock(props: {
  readonly engineVerdict: Verdict | null;
  readonly decisions: readonly ActionLogEntryView[];
  readonly onDecide: NonNullable<ActionsPanelProps['onDecide']>;
}): ReactElement {
  const { engineVerdict, decisions, onDecide } = props;
  const [reason, setReason] = useState('');
  const [state, setState] = useState<ApproveState>({ kind: 'idle' });
  const pending = state.kind === 'pending';
  const latest = decisions[0] ?? null;

  const decide = async (decision: 'accept' | 'decline'): Promise<void> => {
    setState({ kind: 'pending' });
    try {
      await onDecide(decision, reason);
      setReason('');
      setState({ kind: 'idle' });
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div data-testid="actions-decision">
      <h3 className="rf-card__subtitle">Your decision</h3>
      {latest === null ? (
        <p className="rf-empty">
          No decision has been recorded. The engine said{' '}
          <strong>{formatVerdict(engineVerdict)}</strong>; recording a decision does not change that.
        </p>
      ) : (
        <p data-testid="actions-decision-recorded">
          <Badge
            label={latest.decision === 'accept' ? 'Accepted' : latest.decision === 'decline' ? 'Declined' : titleCase(latest.status)}
            tone={latest.decision === 'decline' ? 'quiet' : 'positive'}
          />{' '}
          by the underwriter on {formatDate(latest.createdAt, { style: 'long' })}. The engine said{' '}
          <strong>{formatVerdict(latest.beforeVerdict ?? engineVerdict)}</strong>, and still does.
          {latest.note === null || latest.note === undefined ? null : (
            <span className="rf-actions__rationale"> {latest.note}</span>
          )}
        </p>
      )}

      <label className="rf-field">
        <span className="rf-field__label">Why (optional, and worth writing if you disagree)</span>
        <textarea
          className="rf-field__input"
          rows={2}
          value={reason}
          disabled={pending}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <div className="rf-draft__actions">
        <button type="button" className="rf-button rf-button--primary" disabled={pending} onClick={() => void decide('accept')}>
          {pending ? 'Recording…' : 'Accept'}
        </button>
        <button type="button" className="rf-button" disabled={pending} onClick={() => void decide('decline')}>
          Decline
        </button>
      </div>
      {state.kind === 'error' ? (
        <p role="alert" className="rf-inline-error">
          The decision was not recorded: {state.message}
        </p>
      ) : null}
    </div>
  );
}

/**
 * PRD 10 (k) Routing, the drafted request with approve, and the log.
 *
 * Every number comes from the props; nothing is recomputed (PRD 10, 13).
 */
export function Actions(props: ActionsPanelProps): ReactElement {
  const { routing, drafts, log, onApprove, onDecide, engineVerdict, submissionId } = props;
  const openDrafts = drafts.filter((d) => d.status === APPROVABLE_STATUS).length;
  // Newest first: the log is already ordered that way by the API.
  const decisions = log.filter((e) => e.type === 'decision');
  return (
    <Card
      title="Actions"
      anchorId="actions"
      aside={openDrafts > 0 ? <Badge label={`${openDrafts} awaiting approval`} tone="attention" /> : undefined}
    >
      <div data-submission-id={submissionId}>
        <RoutingBlock routing={routing} />

        <h3 className="rf-card__subtitle">Requests to the broker</h3>
        {drafts.length === 0 ? (
          <p className="rf-empty">No request is needed for this submission.</p>
        ) : (
          drafts.map((d) => <DraftCard key={d.actionId} draft={d} onApprove={onApprove} />)
        )}

        {onDecide === undefined ? null : (
          <DecisionBlock
            engineVerdict={engineVerdict ?? decisions[0]?.beforeVerdict ?? null}
            decisions={decisions}
            onDecide={onDecide}
          />
        )}

        <h3 className="rf-card__subtitle">Log</h3>
        <LogTable log={log} />
      </div>
    </Card>
  );
}
