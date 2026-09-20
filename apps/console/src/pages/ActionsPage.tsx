import { useId, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router';

import { EM_DASH, formatDate, formatScore, pluralize, titleCase } from '@retrofit/contracts';
import { MIN_TOUCH_TARGET } from '@retrofit/design';

import { submissionPath } from '../App.js';
import { useApi, useApiClient } from '../api/useApi.js';
import { VerdictPill } from '../components/atoms/VerdictPill.js';
import { DataTable } from '../components/DataTable.js';
import type { DataTableColumn } from '../components/DataTable.js';
import type { ActionLogEntryView } from '../panels/types.js';

/**
 * PRD §7.6 / §10 `/actions` stages: drafts awaiting approval, sent, replied,
 * plus failed. Routes, re-scores and log rows that are simply applied appear
 * under "All" only, so "Replied" never counts an action no broker answered.
 */
const STAGES = {
  all: { label: 'All', match: (): boolean => true },
  awaiting: { label: 'Awaiting approval', match: (e: ActionLogEntryView): boolean => e.status === 'draft' },
  sent: {
    label: 'Sent',
    match: (e: ActionLogEntryView): boolean => e.status === 'approved' || e.status === 'sent',
  },
  replied: {
    label: 'Replied',
    match: (e: ActionLogEntryView): boolean =>
      e.status === 'replied' || (e.type === 'reply' && e.status !== 'failed'),
  },
  failed: { label: 'Failed', match: (e: ActionLogEntryView): boolean => e.status === 'failed' },
} as const;

type StageKey = keyof typeof STAGES;

const STAGE_ORDER: readonly StageKey[] = ['all', 'awaiting', 'sent', 'replied', 'failed'];

/** PRD §14 risk row: say on screen that sending is simulated. */
const SIMULATED_NOTICE =
  'Broker contacts in this dataset are synthetic, so approving a request marks it sent and nothing is emailed. Reply extraction and re-scoring are real.';

function inStage(entry: ActionLogEntryView, stage: StageKey): boolean {
  return STAGES[stage].match(entry);
}

/** Only a drafted broker request is approved by the underwriter (PRD §7.6). */
function isApprovable(entry: ActionLogEntryView): boolean {
  return entry.type === 'request' && entry.status === 'draft';
}

/** Newest first; ISO timestamps compare lexically. Id breaks ties deterministically. */
function newestFirst(a: ActionLogEntryView, b: ActionLogEntryView): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.actionId < b.actionId ? -1 : a.actionId > b.actionId ? 1 : 0;
}

/**
 * Positions moved up the queue. Rank 1 is best, so moving from #7 to #3 is +4.
 * Display arithmetic only: both ranks come from the API.
 */
function rankDelta(entry: ActionLogEntryView): number | null {
  if (entry.beforeRank === null || entry.afterRank === null) return null;
  return entry.beforeRank - entry.afterRank;
}

function movementText(entry: ActionLogEntryView): string {
  const delta = rankDelta(entry);
  if (delta === null) {
    if (entry.beforeRank !== null) return `#${entry.beforeRank} → ${EM_DASH}`;
    if (entry.afterRank !== null) return `${EM_DASH} → #${entry.afterRank}`;
    return EM_DASH;
  }
  const change =
    delta > 0 ? `up ${pluralize(delta, 'place')}` : delta < 0 ? `down ${pluralize(-delta, 'place')}` : 'no change';
  return `#${entry.beforeRank} → #${entry.afterRank} (${change})`;
}

function scoreText(entry: ActionLogEntryView): string {
  if (entry.beforeScore === null && entry.afterScore === null) return EM_DASH;
  if (entry.afterScore === null) return formatScore(entry.beforeScore);
  return `${formatScore(entry.beforeScore)} → ${formatScore(entry.afterScore)}`;
}

function verdictCell(entry: ActionLogEntryView): ReactNode {
  const { beforeVerdict, afterVerdict } = entry;
  if (beforeVerdict === null && afterVerdict === null) return EM_DASH;
  if (afterVerdict === null || afterVerdict === beforeVerdict) {
    return <VerdictPill verdict={(beforeVerdict ?? afterVerdict)!} />;
  }
  return (
    <span className="actions-verdict-change">
      {beforeVerdict === null ? EM_DASH : <VerdictPill verdict={beforeVerdict} />}
      {' → '}
      <VerdictPill verdict={afterVerdict} />
    </span>
  );
}

function insuredCell(entry: ActionLogEntryView): ReactNode {
  return (
    <Link to={submissionPath(entry.submissionId)} aria-label={`Open ${entry.insuredName}`}>
      {entry.insuredName}
    </Link>
  );
}

function baseColumns(): DataTableColumn<ActionLogEntryView>[] {
  return [
    {
      key: 'date',
      header: 'Date',
      render: (e) => formatDate(e.createdAt),
      sortValue: (e) => e.createdAt,
    },
    {
      key: 'insured',
      header: 'Insured',
      render: insuredCell,
      sortValue: (e) => e.insuredName,
    },
    {
      key: 'type',
      header: 'Action',
      render: (e) => titleCase(e.type),
      sortValue: (e) => e.type,
    },
    {
      key: 'status',
      header: 'Status',
      render: (e) => titleCase(e.status),
      sortValue: (e) => e.status,
    },
  ];
}

function logColumns(): readonly DataTableColumn<ActionLogEntryView>[] {
  return [
    ...baseColumns(),
    {
      key: 'score',
      header: 'Appetite score',
      headerTitle: 'Appetite score before → after, 0–100',
      align: 'right',
      render: scoreText,
      sortValue: (e) => e.afterScore ?? e.beforeScore,
    },
    {
      key: 'verdict',
      header: 'Verdict',
      render: verdictCell,
      sortValue: (e) => e.afterVerdict ?? e.beforeVerdict,
    },
    {
      key: 'rank',
      header: 'Rank movement',
      headerTitle: 'Queue rank before → after; rank 1 is best',
      align: 'right',
      render: movementText,
      sortValue: (e) => rankDelta(e),
    },
  ];
}

/**
 * PRD 10 /actions - outbox and action log across the book, with the rank movement each reply caused.
 *
 * Stub frozen by W0-4. Unit C12 replaces this body only.
 * Route registration lives in src/App.tsx and is frozen.
 */
export function ActionsPage(): ReactElement {
  const client = useApiClient();
  const actions = useApi((c) => c.getActions(), []);
  const [stage, setStage] = useState<StageKey>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const ids = useId();

  const entries = useMemo(
    () => [...(actions.data ?? [])].sort(newestFirst),
    [actions.data],
  );
  const outbox = useMemo(() => entries.filter(isApprovable), [entries]);
  const counts = useMemo(() => {
    const out = {} as Record<StageKey, number>;
    for (const key of STAGE_ORDER) out[key] = entries.filter((e) => inStage(e, key)).length;
    return out;
  }, [entries]);
  const visible = useMemo(() => entries.filter((e) => inStage(e, stage)), [entries, stage]);
  const replies = useMemo(
    () => entries.filter((e) => e.type === 'reply' && rankDelta(e) !== null),
    [entries],
  );

  const approve = async (entry: ActionLogEntryView): Promise<void> => {
    setBusy(entry.actionId);
    setMutationError(null);
    setNotice(null);
    try {
      await client.approveAction(entry.actionId);
      setNotice(`Request to ${entry.insuredName} approved and marked sent.`);
      actions.reload();
    } catch (thrown) {
      setMutationError(
        `Could not approve the request for ${entry.insuredName}: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
      );
    } finally {
      setBusy(null);
    }
  };

  const plan = async (): Promise<void> => {
    setBusy('plan');
    setMutationError(null);
    setNotice(null);
    try {
      const planned = await client.planActions();
      setNotice(`Action plan ran: ${pluralize(planned.length, 'action')} routed or drafted.`);
      actions.reload();
    } catch (thrown) {
      setMutationError(`Could not run the action plan: ${thrown instanceof Error ? thrown.message : String(thrown)}`);
    } finally {
      setBusy(null);
    }
  };

  const outboxColumns: readonly DataTableColumn<ActionLogEntryView>[] = [
    ...baseColumns(),
    {
      key: 'approve',
      header: 'Approve',
      render: (e) => (
        <button
          type="button"
          className="rf-button--primary"
          onClick={(event) => {
            event.stopPropagation();
            void approve(e);
          }}
          disabled={busy !== null}
          aria-label={`Approve request to ${e.insuredName}`}
          style={{ minHeight: MIN_TOUCH_TARGET }}
        >
          {busy === e.actionId ? 'Approving…' : 'Approve'}
        </button>
      ),
    },
  ];

  const firstLoad = actions.loading && actions.data === null;

  return (
    <section className="actions-page" aria-labelledby={`${ids}-title`}>
      <h1 id={`${ids}-title`}>Actions</h1>

      <p className="actions-notice">{SIMULATED_NOTICE}</p>

      <div className="actions-toolbar">
        <button
          type="button"
          onClick={() => void plan()}
          disabled={busy !== null}
          style={{ minHeight: MIN_TOUCH_TARGET }}
        >
          {busy === 'plan' ? 'Planning…' : 'Run action plan'}
        </button>
      </div>

      {actions.error !== null ? (
        <div role="alert" className="actions-error">
          <p>Could not load the action log: {actions.error.message}</p>
          <button type="button" onClick={actions.reload} style={{ minHeight: MIN_TOUCH_TARGET }}>
            Retry
          </button>
        </div>
      ) : null}

      {mutationError !== null ? (
        <p role="alert" className="actions-error">
          {mutationError}
        </p>
      ) : null}

      <p role="status" aria-live="polite" className="actions-count">
        {firstLoad
          ? 'Loading the action log…'
          : notice ??
            `${pluralize(entries.length, 'action')} · ${counts.awaiting} awaiting approval · ${counts.sent} sent · ${counts.replied} replied`}
      </p>

      <section className="actions-outbox" aria-labelledby={`${ids}-outbox`}>
        <h2 id={`${ids}-outbox`}>Outbox</h2>
        <DataTable<ActionLogEntryView>
          caption="Broker requests awaiting approval"
          columns={outboxColumns}
          rows={outbox}
          rowKey={(e) => e.actionId}
          emptyLabel="No drafted requests awaiting approval."
          loading={firstLoad}
        />
      </section>

      {replies.length > 0 ? (
        <section className="actions-movement" aria-labelledby={`${ids}-movement`}>
          <h2 id={`${ids}-movement`}>Rank movement from replies</h2>
          <ul>
            {replies.map((e) => (
              <li key={e.actionId} data-testid={`movement-${e.actionId}`}>
                {insuredCell(e)}: {movementText(e)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="actions-log" aria-labelledby={`${ids}-log`}>
        <h2 id={`${ids}-log`}>Action log</h2>
        <div role="group" aria-label="Filter by stage" className="actions-stages">
          {STAGE_ORDER.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={stage === key}
              onClick={() => setStage(key)}
              style={{ minHeight: MIN_TOUCH_TARGET }}
            >
              {`${STAGES[key].label} (${counts[key]})`}
            </button>
          ))}
        </div>
        <DataTable<ActionLogEntryView>
          caption="Every action across the book, newest first"
          columns={logColumns()}
          rows={visible}
          rowKey={(e) => e.actionId}
          emptyLabel={
            stage === 'all'
              ? 'No actions yet. Run the action plan to route accounts and draft requests.'
              : `No actions in "${STAGES[stage].label}".`
          }
          loading={firstLoad}
        />
      </section>
    </section>
  );
}
