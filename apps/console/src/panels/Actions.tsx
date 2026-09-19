import { useState } from 'react';
import type { ReactElement } from 'react';

import { formatDate, formatMoney, formatScore, formatVerdict, titleCase } from '@retrofit/contracts';

import { Badge } from '../components/atoms/Badge.js';
import { Card } from '../components/atoms/Card.js';
import type {
  ActionLogEntryView,
  ActionsPanelProps,
  RequestDraftView,
  RoutingView,
} from './types.js';

/** PRD 7.6: a request is saved as a draft; only a draft can be approved. */
const APPROVABLE_STATUS = 'draft';

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
        <Badge label={titleCase(draft.status)} tone={approvable ? 'attention' : 'quiet'} />
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
          className="rf-button"
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
                {beforeAfter(formatScore(e.beforeRank), formatScore(e.afterRank), hasAfter) +
                  rankMovement(e.beforeRank, e.afterRank)}
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

/**
 * PRD 10 (k) Routing, the drafted request with approve, and the log.
 *
 * Every number comes from the props; nothing is recomputed (PRD 10, 13).
 */
export function Actions(props: ActionsPanelProps): ReactElement {
  const { routing, drafts, log, onApprove, submissionId } = props;
  const openDrafts = drafts.filter((d) => d.status === APPROVABLE_STATUS).length;
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

        <h3 className="rf-card__subtitle">Log</h3>
        <LogTable log={log} />
      </div>
    </Card>
  );
}
