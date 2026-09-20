import { useCallback, useId, useMemo } from 'react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import {
  EM_DASH,
  formatMoney,
  formatPercent,
  formatScore,
  pluralize,
  titleCase,
} from '@retrofit/contracts';

import { cssVar, MIN_TOUCH_TARGET, RADIUS, SPACE } from '@retrofit/design';
import { submissionPath } from '../routes.js';
import { useApi } from '../api/useApi.js';
import { Badge } from '../components/atoms/Badge.js';
import { VerdictPill } from '../components/atoms/VerdictPill.js';
import { DataTable } from '../components/DataTable.js';
import type { DataTableColumn } from '../components/DataTable.js';
import { Filters } from '../components/Filters.js';
import type { FilterOptions, QueueFilterValue } from '../components/Filters.js';
import type { QueueRowView, Verdict } from '../panels/types.js';

/** Sibling views of the same rows. Literals: importing ROUTES from App.tsx is a cycle. */
const AGGREGATE_PATH = '/aggregate';
const EXPLORE_PATH = '/explore';

const OUT_OF_APPETITE_LABEL = 'Out of appetite: line of business';

const VERDICTS: readonly Verdict[] = ['FIT', 'REFER', 'DOES_NOT_FIT'];

/* ------------------------------------------------------------ URL state */

/** Every filter, the sort and the accordion live in the query string. */
const PARAM = {
  search: 'q',
  line: 'line',
  verdict: 'verdict',
  state: 'state',
  underwriter: 'uw',
  sort: 'sort',
  direction: 'dir',
  out: 'out',
} as const;

type SortKey =
  | 'rank'
  | 'quality'
  | 'insured'
  | 'verdict'
  | 'appetite'
  | 'completeness'
  | 'premium'
  | 'adequacy'
  | 'contradictions'
  | 'underwriter';

type SortDirection = 'asc' | 'desc';

interface SortSpec {
  readonly label: string;
  readonly value: (row: QueueRowView) => string | number | null;
}

const SORTS: Readonly<Record<SortKey, SortSpec>> = {
  rank: { label: 'Rank', value: (r) => r.rank },
  quality: { label: 'Quality', value: (r) => r.qualityIndex },
  insured: { label: 'Insured', value: (r) => r.insuredName },
  verdict: { label: 'Verdict', value: (r) => r.verdict },
  appetite: { label: 'Appetite', value: (r) => r.appetiteScore },
  completeness: { label: 'Completeness', value: (r) => r.completeness },
  premium: { label: 'Quoted premium', value: (r) => r.quotedPremium },
  adequacy: { label: 'Adequacy', value: (r) => r.adequacy },
  contradictions: { label: 'Contradictions', value: (r) => r.contradictionCount },
  underwriter: { label: 'Underwriter', value: (r) => r.assignedUnderwriter },
};

const SORT_ORDER: readonly SortKey[] = [
  'rank',
  'quality',
  'insured',
  'verdict',
  'appetite',
  'completeness',
  'premium',
  'adequacy',
  'contradictions',
  'underwriter',
];

const DEFAULT_SORT: SortKey = 'rank';
const DEFAULT_DIRECTION: SortDirection = 'asc';

function isSortKey(value: string | null): value is SortKey {
  return value !== null && Object.prototype.hasOwnProperty.call(SORTS, value);
}

function isVerdict(value: string | null): value is Verdict {
  return value !== null && (VERDICTS as readonly string[]).includes(value);
}

/* --------------------------------------------------------------- helpers */

/** Distinct, non-empty values, sorted for a stable dropdown. */
function distinct(values: readonly (string | null)[]): readonly string[] {
  const set = new Set<string>();
  for (const v of values) {
    if (typeof v === 'string' && v.trim().length > 0) set.add(v);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Filter options come from the rows the API returned — never a hard-coded list. */
function buildOptions(rows: readonly QueueRowView[]): FilterOptions {
  return {
    lines: distinct(rows.map((r) => r.lineOfBusiness)),
    states: distinct(rows.map((r) => r.primaryState)),
    underwriters: distinct(rows.map((r) => r.assignedUnderwriter)),
  };
}

function matches(row: QueueRowView, f: QueueFilterValue): boolean {
  if (f.line !== null && row.lineOfBusiness !== f.line) return false;
  if (f.verdict !== null && row.verdict !== f.verdict) return false;
  if (f.state !== null && row.primaryState !== f.state) return false;
  if (f.underwriter !== null && row.assignedUnderwriter !== f.underwriter) return false;
  const q = f.search.trim().toLowerCase();
  if (q.length > 0) {
    const haystack = [row.insuredName, row.submissionId, row.explanationLine]
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  return true;
}

function isActive(f: QueueFilterValue): boolean {
  return (
    f.line !== null ||
    f.verdict !== null ||
    f.state !== null ||
    f.underwriter !== null ||
    f.search.trim().length > 0
  );
}

/**
 * Order by the rank the API assigned. The page never recomputes a rank; it
 * only restores the API's order after filtering, with the id as a
 * deterministic tiebreak.
 */
function byRank(a: QueueRowView, b: QueueRowView): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  return a.submissionId < b.submissionId ? -1 : a.submissionId > b.submissionId ? 1 : 0;
}

/** Nulls last in both directions. Numbers before strings. */
function compareValues(
  a: string | number | null,
  b: string | number | null,
  direction: SortDirection,
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  let result: number;
  if (typeof a === 'number' && typeof b === 'number') result = a - b;
  else if (typeof a === 'number') result = -1;
  else if (typeof b === 'number') result = 1;
  else result = a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true });
  return direction === 'asc' ? result : -result;
}

function sortRows(
  rows: readonly QueueRowView[],
  key: SortKey,
  direction: SortDirection,
): readonly QueueRowView[] {
  if (key === DEFAULT_SORT && direction === DEFAULT_DIRECTION) return [...rows].sort(byRank);
  const value = SORTS[key].value;
  return [...rows].sort((a, b) => compareValues(value(a), value(b), direction) || byRank(a, b));
}

/* ---------------------------------------------------------------- styles */

const primaryNumber: CSSProperties = {
  fontFamily: cssVar('font-display'),
  fontSize: cssVar('size-body'),
  color: cssVar('ink'),
};

const primaryName: CSSProperties = {
  fontFamily: cssVar('font-display'),
  fontSize: cssVar('size-body'),
  fontWeight: 600,
};

const secondaryLine: CSSProperties = {
  display: 'block',
  color: cssVar('muted-deep'),
  fontSize: cssVar('size-micro'),
  lineHeight: cssVar('leading-micro'),
};

const mutedCell: CSSProperties = {
  color: cssVar('muted-deep'),
  fontSize: cssVar('size-micro'),
};

const toolbarStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: SPACE.md,
  padding: `${SPACE.sm}px 0`,
};

const fieldLabelStyle: CSSProperties = {
  color: cssVar('muted-deep'),
  fontSize: cssVar('size-micro'),
};

const controlStyle: CSSProperties = {
  minHeight: MIN_TOUCH_TARGET,
  padding: `0 ${SPACE.md}px`,
  border: `1px solid ${cssVar('muted-tint')}`,
  borderRadius: RADIUS.card,
  background: cssVar('paper'),
  color: cssVar('ink'),
  font: 'inherit',
  fontSize: cssVar('size-small'),
};

const crossLinkStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: SPACE.md,
  margin: `${SPACE.xs}px 0 ${SPACE.lg}px`,
  color: cssVar('muted-deep'),
  fontSize: cssVar('size-micro'),
};

const knockoutSectionStyle: CSSProperties = {
  marginTop: SPACE.xxl,
  paddingTop: SPACE.lg,
  borderTop: `1px solid ${cssVar('muted-tint')}`,
  color: cssVar('muted-deep'),
};

const knockoutToggleStyle: CSSProperties = {
  minHeight: MIN_TOUCH_TARGET,
  padding: `0 ${SPACE.md}px`,
  border: `1px solid ${cssVar('muted-tint')}`,
  borderRadius: RADIUS.pill,
  background: 'transparent',
  color: cssVar('muted-deep'),
  font: 'inherit',
  fontSize: cssVar('size-small'),
  cursor: 'pointer',
};

const knockoutHeadingStyle: CSSProperties = {
  margin: 0,
  fontSize: cssVar('size-small'),
  fontWeight: 400,
};

/* ---------------------------------------------------------------- cells */

/** A single muted em dash with the reason on hover, for an absent value. */
function absent(reason: string): ReactNode {
  return (
    <span style={{ color: cssVar('muted') }} title={reason}>
      {EM_DASH}
    </span>
  );
}

function premiumCell(row: QueueRowView): ReactNode {
  if (row.quotedPremium === null && row.predictedPremium === null) {
    return absent('No quoted or predicted premium');
  }
  return (
    <>
      <span>{`${formatMoney(row.quotedPremium)} vs ${formatMoney(row.predictedPremium)}`}</span>
      <span style={secondaryLine}>
        {row.adequacy === null ? EM_DASH : `${formatPercent(row.adequacy)} adequacy`}
      </span>
    </>
  );
}

function appetiteCell(row: QueueRowView): ReactNode {
  return (
    <>
      <span style={primaryNumber}>{formatScore(row.appetiteScore)}</span>
      <span style={secondaryLine}>
        {`${formatPercent(row.completeness, { from: 'percent' })} complete`}
      </span>
    </>
  );
}

function signalsCell(row: QueueRowView): ReactNode {
  return (
    <>
      <span>
        {row.contradictionCount === 0
          ? absent('No contradictions')
          : pluralize(row.contradictionCount, 'contradiction')}
      </span>
      {row.oneFlipFromFit ? (
        <span style={{ display: 'block' }}>
          <Badge label="1 flip from FIT" tone="attention" />
        </span>
      ) : null}
    </>
  );
}

function underwriterCell(row: QueueRowView): ReactNode {
  const pending = row.pendingAction === null ? null : titleCase(row.pendingAction);
  return (
    <>
      {row.assignedUnderwriter === null ? (
        <Badge label="Unassigned" tone="quiet" />
      ) : row.underwriterSource === 'federato' ? (
        <span>
          <Badge label={row.assignedUnderwriter} tone="info" />{' '}
          <span style={{ color: cssVar('muted') }}>· Federato</span>
        </span>
      ) : (
        <Badge label={row.assignedUnderwriter} tone="info" />
      )}
      {pending === null ? null : <span style={secondaryLine}>{pending}</span>}
    </>
  );
}

function insuredCell(row: QueueRowView): ReactNode {
  return (
    <>
      <Link
        to={submissionPath(row.submissionId)}
        aria-label={`Open ${row.insuredName}`}
        style={primaryName}
      >
        {row.insuredName}
      </Link>
      {row.synthetic ? (
        <>
          {' '}
          <Badge label="Synthetic" tone="quiet" title="Values hand-authored for the demo" />
        </>
      ) : null}
      <span style={secondaryLine}>{`${row.submissionId} · ${titleCase(row.lineOfBusiness)}`}</span>
    </>
  );
}

/**
 * Nine columns, not thirteen: rank, insured and verdict carry full ink, the
 * paired numbers below them are muted and secondary.
 */
function buildColumns(): readonly DataTableColumn<QueueRowView>[] {
  return [
    {
      key: 'rank',
      sortValue: SORTS.rank.value,
      header: '#',
      align: 'right',
      render: (r) => <span style={primaryNumber}>{String(r.rank)}</span>,
    },
    {
      key: 'insured',
      sortValue: SORTS.insured.value,
      header: 'Insured',
      minWidth: 220,
      render: insuredCell,
    },
    {
      key: 'verdict',
      sortValue: SORTS.verdict.value,
      header: 'Verdict',
      render: (r) => <VerdictPill verdict={r.verdict} />,
    },
    {
      key: 'appetite',
      sortValue: SORTS.appetite.value,
      header: 'Appetite',
      align: 'right',
      render: appetiteCell,
    },
    {
      key: 'quality',
      sortValue: SORTS.quality.value,
      header: 'Quality',
      align: 'right',
      render: (r) => <span style={mutedCell}>{formatScore(r.qualityIndex, { decimals: 1 })}</span>,
    },
    {
      key: 'premium',
      sortValue: SORTS.premium.value,
      header: 'Quoted vs predicted',
      align: 'right',
      render: premiumCell,
    },
    {
      key: 'contradictions',
      sortValue: SORTS.contradictions.value,
      header: 'Signals',
      render: signalsCell,
    },
    {
      key: 'underwriter',
      sortValue: SORTS.underwriter.value,
      header: 'Underwriter',
      render: underwriterCell,
    },
    {
      key: 'explanation',
      header: 'Why',
      minWidth: 320,
      clampLines: 3,
      title: (r) => r.explanationLine,
      render: (r) => <span style={mutedCell}>{r.explanationLine}</span>,
    },
  ];
}

/** The knocked-out group fails on one factor; four columns say everything. */
function buildKnockoutColumns(): readonly DataTableColumn<QueueRowView>[] {
  return [
    { key: 'id', header: 'ID', render: (r) => <span style={mutedCell}>{r.submissionId}</span> },
    {
      key: 'insured',
      header: 'Insured',
      minWidth: 200,
      render: (r) => (
        <Link to={submissionPath(r.submissionId)} aria-label={`Open ${r.insuredName}`}>
          {r.insuredName}
        </Link>
      ),
    },
    {
      key: 'line',
      header: 'Line of business',
      render: (r) => <span style={mutedCell}>{r.lineOfBusiness}</span>,
    },
    {
      key: 'rule',
      header: 'Deciding rule',
      minWidth: 320,
      clampLines: 2,
      title: (r) => r.explanationLine,
      render: (r) => <span style={mutedCell}>{r.explanationLine}</span>,
    },
  ];
}

/** PRD §10 `/queue` — the ranked table and the collapsed out-of-appetite group. */
export function QueuePage(): ReactElement {
  const queue = useApi((client) => client.getQueue(), []);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const groupId = useId();

  const filter = useMemo<QueueFilterValue>(() => {
    const verdict = params.get(PARAM.verdict);
    return {
      line: params.get(PARAM.line),
      verdict: isVerdict(verdict) ? verdict : null,
      state: params.get(PARAM.state),
      underwriter: params.get(PARAM.underwriter),
      search: params.get(PARAM.search) ?? '',
    };
  }, [params]);

  const rawSort = params.get(PARAM.sort);
  const sortKey: SortKey = isSortKey(rawSort) ? rawSort : DEFAULT_SORT;
  const sortDirection: SortDirection = params.get(PARAM.direction) === 'desc' ? 'desc' : 'asc';
  const outOpen = params.get(PARAM.out) === '1';

  /** One writer for the query string: defaults are omitted so `/queue` stays clean. */
  const writeParams = useCallback(
    (next: {
      filter?: QueueFilterValue;
      sortKey?: SortKey;
      sortDirection?: SortDirection;
      outOpen?: boolean;
    }): void => {
      const f = next.filter ?? filter;
      const key = next.sortKey ?? sortKey;
      const direction = next.sortDirection ?? sortDirection;
      const open = next.outOpen ?? outOpen;
      const search = new URLSearchParams();
      if (f.search.trim().length > 0) search.set(PARAM.search, f.search);
      if (f.line !== null) search.set(PARAM.line, f.line);
      if (f.verdict !== null) search.set(PARAM.verdict, f.verdict);
      if (f.state !== null) search.set(PARAM.state, f.state);
      if (f.underwriter !== null) search.set(PARAM.underwriter, f.underwriter);
      if (key !== DEFAULT_SORT) search.set(PARAM.sort, key);
      if (direction !== DEFAULT_DIRECTION) search.set(PARAM.direction, direction);
      if (open) search.set(PARAM.out, '1');
      setParams(search, { replace: true });
    },
    [filter, sortKey, sortDirection, outOpen, setParams],
  );

  const rows = useMemo<readonly QueueRowView[]>(() => queue.data ?? [], [queue.data]);
  const options = useMemo(() => buildOptions(rows), [rows]);
  const columns = useMemo(() => buildColumns(), []);
  const knockoutColumns = useMemo(() => buildKnockoutColumns(), []);

  const { inAppetite, outOfAppetite } = useMemo(() => {
    const visible = sortRows(
      rows.filter((r) => matches(r, filter)),
      sortKey,
      sortDirection,
    );
    return {
      inAppetite: visible.filter((r) => !r.outOfAppetiteLine),
      outOfAppetite: visible.filter((r) => r.outOfAppetiteLine),
    };
  }, [rows, filter, sortKey, sortDirection]);

  const onRowClick = (row: QueueRowView): void => {
    void navigate(submissionPath(row.submissionId));
  };

  const shown = inAppetite.length + outOfAppetite.length;
  const filtered = isActive(filter);
  const sortId = `${groupId}-sort`;

  return (
    <section className="queue-page" aria-labelledby={`${groupId}-title`}>
      <h1 id={`${groupId}-title`}>Queue</h1>

      <p style={crossLinkStyle}>
        <span>Same rows:</span>
        <Link to={AGGREGATE_PATH}>Aggregate</Link>
        <Link to={EXPLORE_PATH}>Explore</Link>
      </p>

      <Filters
        value={filter}
        options={options}
        onChange={(nextFilter) => writeParams({ filter: nextFilter })}
      />

      <div style={toolbarStyle}>
        <label htmlFor={sortId} style={fieldLabelStyle}>
          Sort by
        </label>
        <select
          id={sortId}
          style={controlStyle}
          value={sortKey}
          onChange={(event) =>
            writeParams({
              sortKey: isSortKey(event.target.value) ? event.target.value : DEFAULT_SORT,
            })
          }
        >
          {SORT_ORDER.map((key) => (
            <option key={key} value={key}>
              {SORTS[key].label}
            </option>
          ))}
        </select>
        <button
          type="button"
          style={{ ...controlStyle, borderRadius: RADIUS.pill, cursor: 'pointer' }}
          aria-label={
            sortDirection === 'asc' ? 'Sort direction: ascending' : 'Sort direction: descending'
          }
          onClick={() =>
            writeParams({ sortDirection: sortDirection === 'asc' ? 'desc' : 'asc' })
          }
        >
          {sortDirection === 'asc' ? 'Ascending' : 'Descending'}
        </button>
      </div>

      {queue.error !== null ? (
        <div role="alert" className="queue-error">
          <p>Could not load the queue: {queue.error.message}</p>
          <button type="button" onClick={queue.reload}>
            Retry
          </button>
        </div>
      ) : null}

      <p role="status" aria-live="polite" className="queue-count">
        {queue.loading && queue.data === null
          ? 'Loading the queue…'
          : filtered
            ? `Showing ${shown} of ${pluralize(rows.length, 'submission')}`
            : pluralize(rows.length, 'submission')}
      </p>

      <DataTable<QueueRowView>
        caption="Ranked submissions, best first"
        columns={columns}
        rows={inAppetite}
        rowKey={(r) => r.submissionId}
        emptyLabel={
          filtered ? 'No submissions match these filters.' : 'No submissions in appetite.'
        }
        loading={queue.loading && queue.data === null}
        onRowClick={onRowClick}
        sort={{ key: sortKey, direction: sortDirection }}
        onSortChange={(next) =>
          writeParams(
            next === null
              ? { sortKey: DEFAULT_SORT, sortDirection: DEFAULT_DIRECTION }
              : {
                  sortKey: isSortKey(next.key) ? next.key : DEFAULT_SORT,
                  sortDirection: next.direction,
                },
          )
        }
      />

      {outOfAppetite.length > 0 ? (
        <section
          className="queue-out-of-appetite"
          style={knockoutSectionStyle}
          aria-labelledby={`${groupId}-out`}
        >
          <h2 id={`${groupId}-out`} style={knockoutHeadingStyle}>
            <button
              type="button"
              aria-expanded={outOpen}
              aria-controls={`${groupId}-out-body`}
              onClick={() => writeParams({ outOpen: !outOpen })}
              style={knockoutToggleStyle}
            >
              {`${OUT_OF_APPETITE_LABEL} (${outOfAppetite.length})`}
            </button>
          </h2>
          <div id={`${groupId}-out-body`} hidden={!outOpen}>
            {outOpen ? (
              <DataTable<QueueRowView>
                caption={OUT_OF_APPETITE_LABEL}
                columns={knockoutColumns}
                rows={outOfAppetite}
                rowKey={(r) => r.submissionId}
                emptyLabel="No out-of-appetite submissions."
                onRowClick={onRowClick}
              />
            ) : null}
          </div>
        </section>
      ) : null}
    </section>
  );
}
