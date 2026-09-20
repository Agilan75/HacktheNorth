import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { Link, useNavigate } from 'react-router';

import { formatMoney, formatPercent, formatScore, pluralize } from '@retrofit/contracts';
import { COLORS, cssVar, MIN_TOUCH_TARGET, RADIUS, SPACE, VERDICT_MARKS, VERDICT_STYLES } from '@retrofit/design';

import { ROUTES, submissionPath } from '../App.js';
import { useApi } from '../api/useApi.js';
import { Filters } from '../components/Filters.js';
import type { FilterOptions, QueueFilterValue } from '../components/Filters.js';
import type { QueueRowView, Verdict } from '../panels/types.js';
import { createExploreScene, webglAvailable } from './explore-scene.js';
import type { ExploreMode, ExploreScene, HoverInfo, HubHoverInfo } from './explore-scene.js';

const EMPTY_FILTER: QueueFilterValue = { line: null, verdict: null, state: null, underwriter: null, search: '' };

function distinct(values: readonly (string | null)[]): readonly string[] {
  const set = new Set<string>();
  for (const v of values) if (typeof v === 'string' && v.trim().length > 0) set.add(v);
  return [...set].sort((a, b) => a.localeCompare(b));
}

function matches(row: QueueRowView, f: QueueFilterValue): boolean {
  if (f.line !== null && row.lineOfBusiness !== f.line) return false;
  if (f.verdict !== null && row.verdict !== f.verdict) return false;
  if (f.state !== null && row.primaryState !== f.state) return false;
  if (f.underwriter !== null && row.assignedUnderwriter !== f.underwriter) return false;
  const q = f.search.trim().toLowerCase();
  if (q.length > 0 && ![row.insuredName, row.submissionId, row.explanationLine].join(' ').toLowerCase().includes(q)) {
    return false;
  }
  return true;
}

const stageStyle: CSSProperties = {
  position: 'relative',
  height: 'min(72vh, 760px)',
  minHeight: 420,
  border: `1px solid ${cssVar('mute-tint')}`,
  borderRadius: RADIUS.card,
  overflow: 'hidden',
  background: cssVar('bone'),
};

const tooltipStyle: CSSProperties = {
  position: 'absolute',
  pointerEvents: 'none',
  maxWidth: 280,
  padding: `${SPACE.sm}px ${SPACE.md}px`,
  background: cssVar('bone'),
  // A 2px ink edge on the card radius, the same surface the phone kit raises.
  border: `2px solid ${cssVar('ink')}`,
  borderRadius: RADIUS.card,
  fontSize: cssVar('size-micro'),
  lineHeight: 1.45,
  color: cssVar('ink'),
};

const toggleStyle = (active: boolean): CSSProperties => ({
  minHeight: MIN_TOUCH_TARGET,
  padding: `0 ${SPACE.lg}px`,
  borderRadius: RADIUS.pill,
  // The phone kit's ChoiceGroup: the chosen one fills with ink, the rest keep
  // a mute edge on bone. The 2px border is the kit's selected weight.
  border: `2px solid ${active ? cssVar('ink') : cssVar('mute')}`,
  background: active ? cssVar('ink') : cssVar('bone'),
  color: active ? cssVar('bone') : cssVar('ink'),
  font: 'inherit',
  cursor: 'pointer',
});

function Swatch({ verdict }: { readonly verdict: Verdict }): ReactElement {
  const s = VERDICT_STYLES[verdict];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: SPACE.xs }}>
      <span
        aria-hidden
        style={{
          width: 12,
          height: 12,
          borderRadius: '50%',
          background: s.fill,
          border: `1.5px solid ${s.border}`,
        }}
      />
      {VERDICT_MARKS[verdict]} {s.label}
    </span>
  );
}

function RowTip({ info }: { readonly info: HoverInfo }): ReactElement {
  const r = info.row;
  return (
    <>
      <strong style={{ fontFamily: cssVar('font-display'), fontSize: 15 }}>{r.insuredName}</strong>
      <div>
        {VERDICT_MARKS[r.verdict]} {VERDICT_STYLES[r.verdict].label}
        {r.synthetic ? ' · synthetic data' : ''}
      </div>
      <div>Appetite {formatScore(r.appetiteScore, { outOf: true })}</div>
      <div>
        Premium {r.quotedPremium === null ? 'none yet' : formatMoney(r.quotedPremium)}
        {r.adequacy === null ? '' : ` · adequacy ${formatPercent(r.adequacy)}`}
      </div>
      <div>TIV {r.totalTiv === null ? 'unknown' : formatMoney(r.totalTiv)}</div>
      <div style={{ color: cssVar('muted-deep') }}>
        {[r.primaryState, r.assignedUnderwriter].filter(Boolean).join(' · ') || 'No state or underwriter'}
      </div>
      <div style={{ color: cssVar('muted-deep'), marginTop: SPACE.xs }}>Click to open</div>
    </>
  );
}

function HubTip({ info }: { readonly info: HubHoverInfo }): ReactElement {
  return (
    <>
      <strong>{info.label.replace(/_/g, ' ')}</strong>
      <div style={{ color: cssVar('muted-deep') }}>
        {info.hubKind} · {pluralize(info.count, 'submission')}
      </div>
      <div style={{ color: cssVar('muted-deep'), marginTop: SPACE.xs }}>Click to highlight</div>
    </>
  );
}

/** /explore: the book in 3D. A scatter of appetite × adequacy × TIV, or a network of who, where and what. */
export function ExplorePage(): ReactElement {
  const queue = useApi((client) => client.getQueue(), []);
  const navigate = useNavigate();
  const titleId = useId();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<ExploreScene | null>(null);
  const [mode, setMode] = useState<ExploreMode>('scatter');
  const [includeOther, setIncludeOther] = useState(false);
  const [filter, setFilter] = useState<QueueFilterValue>(EMPTY_FILTER);
  const [hover, setHover] = useState<HoverInfo | HubHoverInfo | null>(null);
  const [glOk] = useState(() => webglAvailable());

  const rows = useMemo<readonly QueueRowView[]>(() => queue.data ?? [], [queue.data]);
  const options = useMemo<FilterOptions>(
    () => ({
      lines: distinct(rows.map((r) => r.lineOfBusiness)),
      states: distinct(rows.map((r) => r.primaryState)),
      underwriters: distinct(rows.map((r) => r.assignedUnderwriter)),
    }),
    [rows],
  );
  const visible = useMemo(
    () => rows.filter((r) => (includeOther || !r.outOfAppetiteLine) && matches(r, filter)),
    [rows, includeOther, filter],
  );

  // Latest navigate for the scene's click handler without rebuilding the scene.
  const openRef = useRef((row: QueueRowView) => void navigate(submissionPath(row.submissionId)));
  openRef.current = (row: QueueRowView) => void navigate(submissionPath(row.submissionId));

  useEffect(() => {
    const host = hostRef.current;
    if (host === null || !glOk) return undefined;
    const scene = createExploreScene(host, { onHover: setHover, onOpen: (row) => openRef.current(row) });
    sceneRef.current = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, [glOk]);

  useEffect(() => {
    sceneRef.current?.setData(visible, mode);
  }, [visible, mode]);

  const otherCount = rows.filter((r) => r.outOfAppetiteLine).length;

  return (
    <section aria-labelledby={titleId}>
      <h1 id={titleId}>Explore</h1>
      <p style={{ color: cssVar('muted-deep'), maxWidth: 760 }}>
        {mode === 'scatter'
          ? 'Every submission placed by appetite score, pricing adequacy and total insured value. Sphere size is the quoted premium. Drag to orbit, scroll to zoom, click a sphere to open it.'
          : 'Submissions linked to their underwriter, state, line of business and verdict. Click a hub to light up its submissions; click a sphere to open it.'}
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: SPACE.sm, marginTop: SPACE.md }}>
        <div role="group" aria-label="View" style={{ display: 'flex', gap: SPACE.xs }}>
          <button type="button" aria-pressed={mode === 'scatter'} style={toggleStyle(mode === 'scatter')} onClick={() => setMode('scatter')}>
            3D scatter
          </button>
          <button type="button" aria-pressed={mode === 'network'} style={toggleStyle(mode === 'network')} onClick={() => setMode('network')}>
            Network
          </button>
        </div>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: SPACE.xs, minHeight: MIN_TOUCH_TARGET, marginLeft: SPACE.md }}>
          <input type="checkbox" checked={includeOther} onChange={(e) => setIncludeOther(e.target.checked)} />
          Include other lines ({otherCount})
        </label>
        <button type="button" style={{ ...toggleStyle(false), marginLeft: 'auto' }} onClick={() => sceneRef.current?.resetView()}>
          Reset view
        </button>
      </div>

      <Filters value={filter} options={options} onChange={setFilter} />

      <p role="status" aria-live="polite" style={{ margin: `0 0 ${SPACE.sm}px` }}>
        {queue.loading && queue.data === null
          ? 'Loading the book…'
          : queue.error !== null
            ? `Could not load the queue: ${queue.error.message}`
            : `Showing ${pluralize(visible.length, 'submission')}`}
      </p>

      {glOk ? (
        <div ref={hostRef} style={stageStyle} aria-label="3D view of the submissions. The same rows are listed on the Queue page.">
          {hover !== null ? (
            <div
              style={{
                ...tooltipStyle,
                left: Math.min(hover.x + 16, (hostRef.current?.clientWidth ?? 600) - 290),
                top: Math.max(hover.y - 12, 8),
              }}
            >
              {hover.kind === 'row' ? <RowTip info={hover} /> : <HubTip info={hover} />}
            </div>
          ) : null}
        </div>
      ) : (
        <div role="alert" style={{ ...stageStyle, display: 'grid', placeItems: 'center', padding: SPACE.xl }}>
          <p>
            This browser has no WebGL, so the 3D view cannot draw. The same data is on the{' '}
            <Link to={ROUTES.queue}>Queue</Link>.
          </p>
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.lg, marginTop: SPACE.md, fontSize: cssVar('size-micro') }}>
        <Swatch verdict="FIT" />
        <Swatch verdict="REFER" />
        <Swatch verdict="DOES_NOT_FIT" />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: SPACE.xs }}>
          <span aria-hidden style={{ width: 16, height: 8, borderRadius: 8, border: `2px solid ${COLORS.mutedDeep}` }} />
          Ring: synthetic data (no Federato policy)
        </span>
        {mode === 'scatter' ? (
          <span style={{ color: cssVar('muted-deep') }}>Red frame: 100% adequacy (quoted = predicted)</span>
        ) : (
          <span style={{ color: cssVar('muted-deep') }}>Octahedrons: underwriter, state, line, verdict hubs</span>
        )}
      </div>
    </section>
  );
}
