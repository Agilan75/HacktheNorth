import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { formatMoney, formatPercent, formatScore, pluralize } from '@retrofit/contracts';
import { COLORS, cssVar, MIN_TOUCH_TARGET, RADIUS, SPACE, VERDICT_MARKS, VERDICT_STYLES } from '@retrofit/design';

import { ROUTES, submissionPath } from '../routes.js';
import { useApi, useApiClient } from '../api/useApi.js';
import { Filters } from '../components/Filters.js';
import type { FilterOptions, QueueFilterValue } from '../components/Filters.js';
import type { QueueRowView, SubmissionDetailView, Verdict } from '../panels/types.js';
import { appetiteBands } from './appetite-bands.js';
import { createExploreScene, webglAvailable } from './explore-scene.js';
import type { ExploreScene, HoverInfo, HubHoverInfo } from './explore-scene.js';
import { bandLabel, createTerrainScene, terrainAccountOf } from './explore-terrain.js';
import type { TerrainAccount, TerrainFootprint, TerrainHover, TerrainScene } from './explore-terrain.js';

type Mode = 'terrain' | 'scatter' | 'network';

const MODES: readonly Mode[] = ['terrain', 'scatter', 'network'];
const MODE_LABELS: Readonly<Record<Mode, string>> = {
  terrain: 'Appetite terrain',
  scatter: '3D scatter',
  network: 'Network',
};

/** One line, axes only. No methodology. */
const COPY: Readonly<Record<Mode, string>> = {
  terrain: 'Floor: insured value by premium. Height: appetite score.',
  scatter: 'Appetite score, pricing adequacy, insured value. Size is premium.',
  network: 'Submissions linked to underwriter, state, line and verdict.',
};

const VERDICTS: readonly Verdict[] = ['FIT', 'REFER', 'DOES_NOT_FIT'];

function isVerdict(value: string): value is Verdict {
  return (VERDICTS as readonly string[]).includes(value);
}

function isMode(value: string | null): value is Mode {
  return value !== null && (MODES as readonly string[]).includes(value);
}

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
  border: `1px solid ${cssVar('muted-tint')}`,
  borderRadius: RADIUS.card,
  overflow: 'hidden',
  background: cssVar('paper'),
};

const tooltipStyle: CSSProperties = {
  position: 'absolute',
  pointerEvents: 'none',
  maxWidth: 280,
  padding: `${SPACE.sm}px ${SPACE.md}px`,
  background: cssVar('paper'),
  border: `1px solid ${cssVar('ink')}`,
  borderRadius: 8,
  fontSize: cssVar('size-micro'),
  lineHeight: 1.45,
  color: cssVar('ink'),
};

/** One segmented control: shared border, no gaps, ends rounded. */
const segmentStyle = (active: boolean, first: boolean, last: boolean): CSSProperties => ({
  minHeight: MIN_TOUCH_TARGET,
  padding: `0 ${SPACE.md}px`,
  border: `1px solid ${cssVar('muted-tint')}`,
  borderLeftWidth: first ? 1 : 0,
  borderTopLeftRadius: first ? RADIUS.pill : 0,
  borderBottomLeftRadius: first ? RADIUS.pill : 0,
  borderTopRightRadius: last ? RADIUS.pill : 0,
  borderBottomRightRadius: last ? RADIUS.pill : 0,
  background: active ? cssVar('ink') : 'transparent',
  color: active ? cssVar('paper') : cssVar('ink'),
  font: 'inherit',
  fontSize: cssVar('size-small'),
  cursor: 'pointer',
});

const quietButtonStyle: CSSProperties = {
  minHeight: MIN_TOUCH_TARGET,
  padding: `0 ${SPACE.md}px`,
  borderRadius: RADIUS.pill,
  border: `1px solid ${cssVar('muted-tint')}`,
  background: 'transparent',
  color: cssVar('ink'),
  font: 'inherit',
  fontSize: cssVar('size-small'),
  cursor: 'pointer',
};

const asideTextStyle: CSSProperties = {
  color: cssVar('muted-deep'),
  fontSize: cssVar('size-micro'),
  lineHeight: cssVar('leading-micro'),
};

function LegendItem({ swatch, label }: { readonly swatch: ReactNode; readonly label: string }): ReactElement {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: SPACE.xs, whiteSpace: 'nowrap' }}>
      {swatch}
      {label}
    </span>
  );
}

function VerdictKey({ verdict }: { readonly verdict: Verdict }): ReactElement {
  const s = VERDICT_STYLES[verdict];
  return (
    <LegendItem
      swatch={
        <span
          aria-hidden
          style={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            background: verdict === 'REFER' ? COLORS.redTint : s.fill,
            border: `1.5px solid ${s.border}`,
          }}
        />
      }
      label={`${VERDICT_MARKS[verdict]} ${s.label}`}
    />
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
    </>
  );
}

function TerrainTip({ info }: { readonly info: TerrainHover }): ReactElement {
  if (info.cell !== undefined) {
    const { tivBand, premiumBand, score, verdict } = info.cell;
    return (
      <>
        <strong>Appetite {Math.round(score)}/100 here</strong>
        <div>
          {VERDICT_MARKS[verdict]} {VERDICT_STYLES[verdict].label}
        </div>
        <div>
          TIV {bandLabel(tivBand)} · {tivBand.ruleId}
        </div>
        <div>
          Premium {bandLabel(premiumBand)} · {premiumBand.ruleId}
        </div>
      </>
    );
  }
  const f = info.footprint;
  return (
    <>
      <strong style={{ fontFamily: cssVar('font-display'), fontSize: 15 }}>{f?.insuredName}</strong>
      <div>
        {f === undefined ? null : (
          <>
            {VERDICT_MARKS[f.verdict]} {VERDICT_STYLES[f.verdict].label}
          </>
        )}
      </div>
      <div>TIV {f?.tiv == null ? 'unknown' : formatMoney(f.tiv)}</div>
      <div>Premium {f?.premium == null ? 'none yet' : formatMoney(f.premium)}</div>
      {f?.otherLine === true ? (
        <div style={{ color: cssVar('muted-deep') }}>Scored on another line: these bands never applied to it.</div>
      ) : null}
      {f?.reason != null && f.reason !== '' ? (
        <div style={{ marginTop: SPACE.xs }}>{f.reason.length > 190 ? `${f.reason.slice(0, 190)}…` : f.reason}</div>
      ) : null}
    </>
  );
}

/** /explore: the book in 3D — the appetite terrain, a scatter, or a network of who, where and what. */
export function ExplorePage(): ReactElement {
  const queue = useApi((client) => client.getQueue(), []);
  const rules = useApi((client) => client.getRules(), []);
  const client = useApiClient();
  const navigate = useNavigate();
  const titleId = useId();
  const filtersId = useId();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<ExploreScene | null>(null);
  const terrainRef = useRef<TerrainScene | null>(null);
  const [params, setParams] = useSearchParams();
  const [hover, setHover] = useState<HoverInfo | HubHoverInfo | null>(null);
  const [terrainHover, setTerrainHover] = useState<TerrainHover | null>(null);
  const [sceneReady, setSceneReady] = useState(false);
  const [detail, setDetail] = useState<SubmissionDetailView | null>(null);
  const [detailError, setDetailError] = useState<Error | null>(null);
  const [glOk] = useState(() => webglAvailable());

  /*
   * Every control lives in the URL, so Back from a submission restores the
   * exact view. Filter param names match the queue page (q, line, verdict,
   * state, underwriter) so links between the two pages carry their filters.
   */
  const modeParam = params.get('mode');
  const mode: Mode = isMode(modeParam) ? modeParam : 'terrain';
  const includeOther = params.get('other') !== '0';
  const selectedId = params.get('account');
  const verdictParam = params.get('verdict');
  const filter = useMemo<QueueFilterValue>(
    () => ({
      line: params.get('line'),
      verdict: verdictParam !== null && isVerdict(verdictParam) ? verdictParam : null,
      state: params.get('state'),
      underwriter: params.get('underwriter'),
      search: params.get('q') ?? '',
    }),
    [params, verdictParam],
  );

  const patch = useCallback(
    (next: Readonly<Record<string, string | null>>, replace = false): void => {
      setParams(
        (prev) => {
          const out = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(next)) {
            if (value === null || value === '') out.delete(key);
            else out.set(key, value);
          }
          return out;
        },
        { replace },
      );
    },
    [setParams],
  );

  const setMode = useCallback((m: Mode): void => patch({ mode: m === 'terrain' ? null : m }), [patch]);
  const setSelectedId = useCallback((id: string): void => patch({ account: id }), [patch]);
  const setFilter = useCallback(
    (next: QueueFilterValue): void =>
      patch({
        q: next.search.trim() === '' ? null : next.search,
        line: next.line,
        verdict: next.verdict,
        state: next.state,
        underwriter: next.underwriter,
      }),
    [patch],
  );

  const filtersActive =
    filter.line !== null ||
    filter.verdict !== null ||
    filter.state !== null ||
    filter.underwriter !== null ||
    filter.search.trim() !== '' ||
    !includeOther;
  const [filtersOpen, setFiltersOpen] = useState(filtersActive);

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
  const bands = useMemo(() => appetiteBands(rules.data?.rulebooks), [rules.data]);

  /*
   * The terrain shows the whole book: accounts with a TIV and a premium stand
   * on the floor, the rest wait in the tray beside it. `includeOther` drops the
   * rows scored on another line of business, which is most of that tray.
   */
  const terrainRows = useMemo(
    () => rows.filter((r) => (includeOther || !r.outOfAppetiteLine) && matches(r, filter)),
    [rows, includeOther, filter],
  );
  const standable = useMemo(
    () => terrainRows.filter((r) => r.totalTiv !== null && r.quotedPremium !== null),
    [terrainRows],
  );
  const footprints = useMemo<readonly TerrainFootprint[]>(
    () =>
      terrainRows.map((r) => ({
        submissionId: r.submissionId,
        insuredName: r.insuredName,
        verdict: r.verdict,
        tiv: r.totalTiv,
        premium: r.quotedPremium,
        reason: r.explanationLine,
        otherLine: r.outOfAppetiteLine,
      })),
    [terrainRows],
  );

  /** The account picker, grouped so 158 rows stay navigable. */
  const groups = useMemo(() => {
    const on = terrainRows.filter((r) => r.totalTiv !== null && r.quotedPremium !== null);
    const off = terrainRows.filter((r) => r.totalTiv === null || r.quotedPremium === null);
    return [
      { label: 'Fits appetite', rows: on.filter((r) => r.verdict === 'FIT') },
      { label: 'Refer', rows: on.filter((r) => r.verdict === 'REFER') },
      { label: 'Outside appetite', rows: on.filter((r) => r.verdict === 'DOES_NOT_FIT') },
      { label: 'No TIV or premium yet', rows: off },
    ].filter((g) => g.rows.length > 0);
  }, [terrainRows]);

  // Keep a selection that is still on screen; default to the best-ranked account
  // with a floor position. Replace, so the default never adds a history entry.
  useEffect(() => {
    if (terrainRows.length === 0) return;
    if (selectedId !== null && terrainRows.some((r) => r.submissionId === selectedId)) return;
    patch({ account: (standable[0] ?? terrainRows[0]!).submissionId }, true);
  }, [terrainRows, standable, selectedId, patch]);

  /* One detail fetch per account, cached, since the terrain needs its factor points. */
  const cache = useRef(new Map<string, SubmissionDetailView>());
  useEffect(() => {
    if (selectedId === null) return undefined;
    const cached = cache.current.get(selectedId);
    if (cached !== undefined) {
      setDetail(cached);
      setDetailError(null);
      return undefined;
    }
    let live = true;
    client
      .getSubmission(selectedId)
      .then((d) => {
        cache.current.set(selectedId, d);
        if (!live) return;
        setDetail(d);
        setDetailError(null);
      })
      .catch((e: unknown) => {
        if (live) setDetailError(e instanceof Error ? e : new Error(String(e)));
      });
    return () => {
      live = false;
    };
  }, [selectedId, client]);

  const terrainAccount = useMemo<TerrainAccount | null>(
    () => (detail === null ? null : terrainAccountOf(detail)),
    [detail],
  );

  // Latest handlers for the scenes' callbacks, without rebuilding a scene.
  const openRef = useRef((id: string) => void navigate(submissionPath(id)));
  openRef.current = (id: string) => void navigate(submissionPath(id));
  const selectRef = useRef(setSelectedId);
  selectRef.current = setSelectedId;

  useEffect(() => {
    const host = hostRef.current;
    if (host === null || !glOk) return undefined;
    setSceneReady(false);
    if (mode === 'terrain') {
      const scene = createTerrainScene(host, {
        onHover: setTerrainHover,
        onSelect: (id) => selectRef.current(id),
        onOpen: (id) => openRef.current(id),
      });
      terrainRef.current = scene;
      setSceneReady(true);
      return () => {
        scene.dispose();
        terrainRef.current = null;
      };
    }
    const scene = createExploreScene(host, { onHover: setHover, onOpen: (row) => openRef.current(row.submissionId) });
    sceneRef.current = scene;
    setSceneReady(true);
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, [glOk, mode]);

  useEffect(() => {
    if (mode === 'terrain') terrainRef.current?.setData(terrainAccount, footprints, bands);
    else sceneRef.current?.setData(visible, mode);
  }, [mode, visible, terrainAccount, footprints, bands]);

  const otherCount = rows.filter((r) => r.outOfAppetiteLine).length;
  /** The factors that knocked the selected account out, named plainly. */
  const knockoutReason = useMemo(() => {
    const out = (detail?.factors ?? []).filter(
      (f) => f.knockout && f.factorId !== 'tiv' && f.factorId !== 'total_premium',
    );
    if (out.length === 0) return 'another factor';
    return out.map((f) => f.label.toLowerCase()).join(' and ');
  }, [detail]);
  const knockedOut =
    mode === 'terrain' && terrainAccount !== null && terrainAccount.knockedOutElsewhere ? terrainAccount : null;
  const tip = mode === 'terrain' ? terrainHover : hover;

  const status =
    queue.loading && queue.data === null
      ? 'Loading the book…'
      : queue.error !== null
        ? `Could not load the queue: ${queue.error.message}`
        : detailError !== null && mode === 'terrain'
          ? `Could not load that account: ${detailError.message}`
          : mode === 'terrain'
            ? `${standable.length} on the floor · ${terrainRows.length - standable.length} with no TIV or premium${bands.fallback ? ' · built-in band edges' : ''}`
            : `${pluralize(visible.length, 'submission')}`;

  return (
    <section aria-labelledby={titleId}>
      <h1 id={titleId} style={{ marginBottom: SPACE.sm }}>
        Explore
      </h1>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: SPACE.sm,
          padding: `${SPACE.sm}px 0`,
          borderTop: `1px solid ${cssVar('muted-tint')}`,
          borderBottom: `1px solid ${cssVar('muted-tint')}`,
        }}
      >
        <div role="group" aria-label="View" style={{ display: 'flex' }}>
          {MODES.map((m, i) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              style={segmentStyle(mode === m, i === 0, i === MODES.length - 1)}
              onClick={() => setMode(m)}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
        <span style={{ ...asideTextStyle, flex: '1 1 200px' }}>{COPY[mode]}</span>
        {mode === 'terrain' ? (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: SPACE.xs, ...asideTextStyle }}>
            Account
            <select
              value={selectedId ?? ''}
              onChange={(e) => setSelectedId(e.target.value)}
              style={{
                minHeight: MIN_TOUCH_TARGET,
                maxWidth: 220,
                borderRadius: RADIUS.pill,
                border: `1px solid ${cssVar('muted-tint')}`,
                background: cssVar('paper'),
                color: cssVar('ink'),
                padding: `0 ${SPACE.sm}px`,
                font: 'inherit',
                fontSize: cssVar('size-small'),
              }}
            >
              {groups.map((g) => (
                <optgroup key={g.label} label={`${g.label} (${g.rows.length})`}>
                  {g.rows.map((r) => (
                    <option key={r.submissionId} value={r.submissionId}>
                      {r.insuredName} · {VERDICT_STYLES[r.verdict].short} · {Math.round(r.appetiteScore)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        ) : null}
        <button
          type="button"
          aria-expanded={filtersOpen}
          aria-controls={filtersId}
          style={{ ...quietButtonStyle, borderColor: filtersActive ? cssVar('ink') : cssVar('muted-tint') }}
          onClick={() => setFiltersOpen((open) => !open)}
        >
          Filters{filtersActive ? ' ·' : ''}
        </button>
        <button
          type="button"
          style={quietButtonStyle}
          onClick={() => (mode === 'terrain' ? terrainRef.current?.resetView() : sceneRef.current?.resetView())}
        >
          Reset view
        </button>
      </div>

      <div
        id={filtersId}
        hidden={!filtersOpen}
        style={{ display: filtersOpen ? 'block' : 'none', borderBottom: `1px solid ${cssVar('muted-tint')}` }}
      >
        <Filters value={filter} options={options} onChange={setFilter} />
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: SPACE.xs,
            minHeight: MIN_TOUCH_TARGET,
            paddingBottom: SPACE.sm,
            ...asideTextStyle,
          }}
        >
          <input type="checkbox" checked={includeOther} onChange={(e) => patch({ other: e.target.checked ? null : '0' })} />
          Include other lines ({otherCount})
        </label>
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: SPACE.sm,
          alignItems: 'baseline',
          padding: `${SPACE.xs}px 0 ${SPACE.sm}px`,
        }}
      >
        <span role="status" aria-live="polite" style={asideTextStyle}>
          {status}
        </span>
        {knockedOut !== null ? (
          <span style={{ ...asideTextStyle, color: cssVar('red-deep') }}>
            {knockedOut.insuredName} knocked out on {knockoutReason} — not plotted.
          </span>
        ) : null}
      </div>

      {glOk ? (
        <div ref={hostRef} style={stageStyle} aria-label="3D view of the submissions. The same rows are listed on the Queue page.">
          {sceneReady ? null : (
            <div
              aria-hidden
              style={{
                position: 'absolute',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
                background: cssVar('paper'),
                color: cssVar('muted-deep'),
                fontSize: cssVar('size-micro'),
              }}
            >
              Drawing…
            </div>
          )}
          {tip !== null ? (
            <div
              style={{
                ...tooltipStyle,
                left: Math.min(tip.x + 16, (hostRef.current?.clientWidth ?? 600) - 290),
                // Keep the whole card inside the canvas, even when hovering near an edge.
                top: Math.max(Math.min(tip.y - 12, (hostRef.current?.clientHeight ?? 600) - 230), 8),
              }}
            >
              {mode === 'terrain' ? (
                <TerrainTip info={tip as TerrainHover} />
              ) : (tip as HoverInfo | HubHoverInfo).kind === 'row' ? (
                <RowTip info={tip as HoverInfo} />
              ) : (
                <HubTip info={tip as HubHoverInfo} />
              )}
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

      <ul
        aria-label="Key"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: `${SPACE.xs}px ${SPACE.md}px`,
          listStyle: 'none',
          margin: `${SPACE.sm}px 0 0`,
          padding: 0,
          fontSize: cssVar('size-micro'),
          color: cssVar('muted-deep'),
        }}
      >
        {[
          <VerdictKey key="fit" verdict="FIT" />,
          <VerdictKey key="refer" verdict="REFER" />,
          <VerdictKey key="out" verdict="DOES_NOT_FIT" />,
          ...(mode === 'terrain'
            ? [
                <LegendItem
                  key="height"
                  label="Appetite height"
                  swatch={
                    <span aria-hidden style={{ width: 6, height: 14, background: cssVar('muted-deep'), borderRadius: 1 }} />
                  }
                />,
                <LegendItem
                  key="arrow"
                  label="Nearest fit"
                  swatch={
                    <span aria-hidden style={{ color: cssVar('ink'), fontSize: 13, lineHeight: 1 }}>
                      ↗
                    </span>
                  }
                />,
                <LegendItem
                  key="dots"
                  label="Priced accounts"
                  swatch={
                    <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: COLORS.mutedDeep }} />
                  }
                />,
              ]
            : [
                <LegendItem
                  key="ring"
                  label="Synthetic data"
                  swatch={
                    <span aria-hidden style={{ width: 16, height: 8, borderRadius: 8, border: `2px solid ${COLORS.mutedDeep}` }} />
                  }
                />,
                mode === 'scatter' ? (
                  <LegendItem
                    key="frame"
                    label="100% adequacy"
                    swatch={
                      <span aria-hidden style={{ width: 12, height: 12, border: `1.5px solid ${cssVar('red-deep')}` }} />
                    }
                  />
                ) : (
                  <LegendItem
                    key="hubs"
                    label="Hubs"
                    swatch={
                      <span
                        aria-hidden
                        style={{ width: 10, height: 10, background: COLORS.mutedDeep, transform: 'rotate(45deg)' }}
                      />
                    }
                  />
                ),
              ]),
        ].map((entry) => (
          <li key={entry.key}>{entry}</li>
        ))}
      </ul>
    </section>
  );
}
