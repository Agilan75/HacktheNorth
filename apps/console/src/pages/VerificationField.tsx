import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactElement } from 'react';

import { MIN_TOUCH_TARGET, SPACE, cssVar } from '@retrofit/design';

import { resolveBaseUrl } from '../api/useApi.js';
import { Card } from '../components/atoms/Card.js';
import { CitationQuote } from '../components/atoms/CitationQuote.js';
import { VerdictPill } from '../components/atoms/VerdictPill.js';
import type { Verdict } from '../panels/types.js';
import {
  COLOR_BY,
  FACTOR_COLORS,
  SURFACE,
  VERDICT_COLORS,
  cssColor,
  factorOf,
  fieldSide,
  groupedOrder,
  isFromSubmission,
  isOnThreshold,
  paintField,
  randomCase,
  scoreColor,
  verdictOf,
} from './verification-field.js';
import type { ColorBy, ExplainedCase, FieldLayers, FieldSummary, Highlight } from './verification-field.js';

/*
 * Every layer A+B case as one pixel, and any one of them worked in full on
 * click. The bytes come from GET /verification/field/:layer; the worked case
 * from GET /verification/cases/:index, which REBUILDS the case from the run's
 * seed and runs the engine, the naive implementation and every invariant on
 * it again. Nothing here decides anything: it draws and formats.
 */

const MUTED: CSSProperties = {
  fontSize: cssVar('size-small'),
  lineHeight: cssVar('leading-small'),
  color: cssVar('mutedDeep'),
  margin: 0,
};

const BOX: CSSProperties = {
  border: `1px solid ${cssVar('mutedTint')}`,
  borderRadius: cssVar('radius-card'),
  padding: SPACE.lg,
  margin: 0,
};

const ROW: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: SPACE.sm };

const LEGEND_BUTTON: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: SPACE.sm,
  minHeight: MIN_TOUCH_TARGET,
  font: 'inherit',
  fontSize: cssVar('size-small'),
  textAlign: 'left',
};

const TABLE: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: cssVar('size-small') };
const CELL: CSSProperties = {
  padding: `${SPACE.xs}px ${SPACE.sm}px`,
  borderBottom: `1px solid ${cssVar('mutedTint')}`,
  textAlign: 'left',
  verticalAlign: 'top',
};

const COLOR_BY_LABEL: Readonly<Record<ColorBy, string>> = {
  verdict: 'Verdict',
  factor: 'Deciding factor',
  score: 'Appetite score',
};

const MAX_CELL_PX = 28;

function count(n: number): string {
  return n.toLocaleString('en-US');
}

function share(n: number, total: number): string {
  if (total === 0) return '0%';
  const pct = (n / total) * 100;
  return `${pct >= 10 ? pct.toFixed(0) : pct >= 1 ? pct.toFixed(1) : pct.toFixed(2)}%`;
}

function humanize(id: string): string {
  const text = id.replace(/[_-]+/g, ' ').trim().replace(/\btiv\b/gi, 'TIV');
  return text.length === 0 ? id : `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function sum(row: readonly number[] | undefined): number {
  return (row ?? []).reduce((a, b) => a + b, 0);
}

function Swatch(props: { readonly color: string }): ReactElement {
  return (
    <span
      aria-hidden="true"
      style={{ width: 12, height: 12, borderRadius: 3, background: props.color, flex: '0 0 auto', border: `1px solid ${cssVar('mutedTint')}` }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Loading                                                                     */
/* -------------------------------------------------------------------------- */

async function fetchBytes(layer: string, signal: AbortSignal): Promise<Uint8Array> {
  const res = await fetch(`${resolveBaseUrl()}/verification/field/${layer}`, { signal });
  if (!res.ok) throw new Error(`field layer ${layer}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${resolveBaseUrl()}${path}`, { headers: { accept: 'application/json' }, ...(signal ? { signal } : {}) });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/* -------------------------------------------------------------------------- */
/* The worked case                                                             */
/* -------------------------------------------------------------------------- */

function factValue(v: string | number | boolean | null): string {
  if (v === null) return 'missing';
  if (typeof v === 'number') return Number.isInteger(v) ? count(v) : String(Number(v.toFixed(6)));
  return String(v);
}

const POSITION_WORDS: Readonly<Record<string, string>> = {
  at: 'placed exactly on the threshold',
  under: 'placed just under a threshold',
  over: 'placed just over a threshold',
  far_under: 'placed far under a threshold',
  far_over: 'placed far over a threshold',
};

function Side(props: { readonly title: string; readonly gloss: string; readonly side: ExplainedCase['engine'] | ExplainedCase['naive'] }): ReactElement {
  const { side } = props;
  return (
    <div style={{ ...BOX, flex: '1 1 260px' }}>
      <strong style={{ display: 'block' }}>{props.title}</strong>
      <p style={MUTED}>{props.gloss}</p>
      <div style={{ marginTop: SPACE.sm }}>
        <VerdictPill verdict={side.verdict as Verdict} />
      </div>
      <dl style={{ ...MUTED, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: `${SPACE.xs}px ${SPACE.md}px`, marginTop: SPACE.sm }}>
        <dt>Appetite score</dt>
        <dd style={{ margin: 0 }}>{side.appetiteScore.toFixed(2)}</dd>
        <dt>Completeness</dt>
        <dd style={{ margin: 0 }}>{side.completeness.toFixed(0)}</dd>
        <dt>Decided by</dt>
        <dd style={{ margin: 0 }}>{side.decidingFactorId === null ? 'no single factor' : humanize(side.decidingFactorId)}</dd>
        <dt>Knockouts</dt>
        <dd style={{ margin: 0 }}>{side.knockoutFactorIds.length === 0 ? 'none' : side.knockoutFactorIds.map(humanize).join(', ')}</dd>
      </dl>
    </div>
  );
}

function WorkedCase(props: { readonly data: ExplainedCase }): ReactElement {
  const c = props.data;
  const violated = c.invariants.filter((i) => i.violations.length > 0);
  const rule = c.engine.decidingRule;
  return (
    <div data-testid="worked-case" style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
      <div style={ROW}>
        <h3 style={{ margin: 0 }}>{`Case ${count(c.index)}`}</h3>
        <VerdictPill verdict={c.engine.verdict as Verdict} />
        <span style={MUTED}>
          {`${c.caseId} · ${c.fromSubmission ? 'rolled up from a generated multi-building submission' : 'generated directly as rolled-up facts'}`}
          {c.stratum !== null ? ` · ${humanize(c.stratum)}` : ''}
        </span>
      </div>

      <div>
        <strong>1. What was generated</strong>
        <p style={MUTED}>{`Rebuilt just now from seed ${c.seed} and index ${count(c.index)}. The same two numbers always give the same case.`}</p>
        <table style={{ ...TABLE, marginTop: SPACE.sm }}>
          <tbody>
            {Object.entries(c.input).map(([key, value]) => (
              <tr key={key}>
                <th scope="row" style={{ ...CELL, fontWeight: 400 }}>{humanize(key.replace(/([A-Z0-9]+)/g, ' $1'))}</th>
                <td style={CELL}>{factValue(value)}</td>
                <td style={{ ...CELL, ...MUTED }}>{POSITION_WORDS[c.boundaries[key] ?? ''] ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {c.buildings !== null ? (
          <details style={{ marginTop: SPACE.sm }}>
            <summary style={{ cursor: 'pointer', minHeight: MIN_TOUCH_TARGET }}>{`The ${c.buildings.length} buildings these facts were rolled up from`}</summary>
            <table style={TABLE}>
              <thead>
                <tr>
                  {['State', 'Year built', 'Construction', 'TIV'].map((h) => (
                    <th key={h} scope="col" style={CELL}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {c.buildings.map((b) => (
                  <tr key={b.id}>
                    <td style={CELL}>{b.state ?? 'missing'}</td>
                    <td style={CELL}>{b.yearBuilt ?? 'missing'}</td>
                    <td style={CELL}>{b.constructionType ?? 'missing'}</td>
                    <td style={CELL}>{b.tiv === null ? 'missing' : `$${count(b.tiv)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ) : null}
      </div>

      <div>
        <strong>2. How the engine scored it</strong>
        <p style={MUTED}>Each factor lands in a guideline tier; points are weight × tier value × 100. The last column is the naive implementation's tier value for the same factor.</p>
        <div style={{ overflowX: 'auto', marginTop: SPACE.sm }}>
          <table style={TABLE}>
            <thead>
              <tr>
                {['Factor', 'Tier', 'Weight', 'Points', 'Guideline text', 'Naive'].map((h) => (
                  <th key={h} scope="col" style={CELL}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {c.factors.map((f) => (
                <tr key={f.factor} style={f.factor === c.engine.decidingFactorId ? { background: cssVar('redTint') } : undefined}>
                  <th scope="row" style={{ ...CELL, fontWeight: f.factor === c.engine.decidingFactorId ? 700 : 400 }}>
                    {humanize(f.factor)}
                    {f.factor === c.engine.decidingFactorId ? ' (decided)' : ''}
                  </th>
                  <td style={CELL}>{f.tier === null ? 'missing' : `${humanize(f.tier)}${f.knockout ? ', knockout' : f.refer ? ', refer' : ''}`}</td>
                  <td style={CELL}>{f.weight}</td>
                  <td style={CELL}>{f.points.toFixed(1)}</td>
                  <td style={CELL}>{f.citation === null ? '' : `“${f.citation.quote}” (${f.citation.section})`}</td>
                  <td style={CELL}>
                    {f.naiveTierValue === null ? 'missing' : f.naiveTierValue}
                    {f.naiveTierValue === f.tierValue ? ' ✓' : ' ✗'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <strong>3. The rule that decided it</strong>
        {rule === null ? (
          <p style={MUTED}>No single rule decided this case.</p>
        ) : (
          <div style={{ marginTop: SPACE.sm }}>
            <CitationQuote citation={{ document: rule.citation.doc, row: rule.citation.section, quote: rule.citation.quote }} />
            <p style={MUTED}>{`Rule ${rule.ruleId}: ${humanize(rule.factor)} is ${humanize(rule.tier).toLowerCase()}.`}</p>
          </div>
        )}
        <ol style={{ margin: `${SPACE.sm}px 0 0`, paddingLeft: SPACE.xl }}>
          {c.engine.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ol>
      </div>

      <div>
        <strong>{`4. Two implementations, ${c.agreed ? 'one answer' : 'DIFFERENT answers'}`}</strong>
        <div style={{ ...ROW, alignItems: 'stretch', marginTop: SPACE.sm }}>
          <Side title="Engine" gloss="The product's own pipeline." side={c.engine} />
          <Side title="Naive implementation" gloss="Written from the guideline PDF by an agent that never saw the engine." side={c.naive} />
        </div>
        {c.disagreements.length > 0 ? (
          <ul role="alert">
            {c.disagreements.map((d) => (
              <li key={d.field}>{`${d.field}: engine ${JSON.stringify(d.engine)}, naive ${JSON.stringify(d.naive)}`}</li>
            ))}
          </ul>
        ) : null}
      </div>

      <div>
        <strong>{`5. ${c.invariants.length} invariants checked, ${violated.length} violated`}</strong>
        <details style={{ marginTop: SPACE.xs }}>
          <summary style={{ cursor: 'pointer', minHeight: MIN_TOUCH_TARGET }}>Every law this case was held to</summary>
          <ul style={{ ...MUTED, columns: '2 260px', paddingLeft: SPACE.lg }}>
            {c.invariants.map((i) => (
              <li key={`${i.suite}.${i.name}`}>
                {`${i.violations.length === 0 ? '✓' : '✗'} ${i.suite}: ${humanize(i.name.replace(/([A-Z])/g, ' $1'))}`}
                {i.violations.map((v) => (
                  <div key={v}>{v}</div>
                ))}
              </li>
            ))}
          </ul>
        </details>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The field                                                                   */
/* -------------------------------------------------------------------------- */

interface View {
  /** Screen pixels per case. */
  readonly scale: number;
  /** Field coordinates (in cases) of the canvas's top-left corner. */
  readonly x: number;
  readonly y: number;
}

function clampView(v: View, side: number, size: number): View {
  const fit = size / side;
  const scale = Math.max(fit, Math.min(MAX_CELL_PX, v.scale));
  const span = size / scale;
  return {
    scale,
    x: Math.max(0, Math.min(side - span, v.x)),
    y: Math.max(0, Math.min(side - span, v.y)),
  };
}

export function VerificationField(): ReactElement | null {
  const [summary, setSummary] = useState<FieldSummary | null>(null);
  const [absent, setAbsent] = useState(false);
  const [layers, setLayers] = useState<FieldLayers | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [colorBy, setColorBy] = useState<ColorBy>('factor');
  const [grouped, setGrouped] = useState(true);
  const [highlight, setHighlight] = useState<Highlight>({ kind: 'none' });
  const [size, setSize] = useState(720);
  const [view, setView] = useState<View>({ scale: 0, x: 0, y: 0 });
  const [hover, setHover] = useState<{ readonly index: number; readonly left: number; readonly top: number } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [worked, setWorked] = useState<ExplainedCase | null>(null);
  const [workedError, setWorkedError] = useState<string | null>(null);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fieldRef = useRef<HTMLCanvasElement | null>(null);
  const orderRef = useRef<Uint32Array | null>(null);
  const inverseRef = useRef<Uint32Array | null>(null);
  const drag = useRef<{ readonly px: number; readonly py: number; readonly view: View; moved: boolean } | null>(null);
  const [painted, setPainted] = useState(0);

  const total = summary?.total ?? 0;
  const side = fieldSide(total);

  useEffect(() => {
    const abort = new AbortController();
    fetchJson<FieldSummary>('/verification/field', abort.signal).then(setSummary, () => {
      if (!abort.signal.aborted) setAbsent(true);
    });
    return () => abort.abort();
  }, []);

  const load = useCallback(
    async (want: readonly ('cases' | 'scores' | 'strata')[]): Promise<boolean> => {
      const abort = new AbortController();
      setError(null);
      try {
        let next: FieldLayers = layers ?? { cases: new Uint8Array(0), scores: null, strata: null };
        for (const layer of want) {
          if (layer !== 'cases' && next[layer] !== null) continue;
          if (layer === 'cases' && next.cases.length > 0) continue;
          setLoading(layer);
          const bytes = await fetchBytes(layer, abort.signal);
          next = { ...next, [layer]: bytes };
        }
        setLayers(next);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        setLoading(null);
      }
    },
    [layers],
  );

  /* Size the canvas to its column. */
  useEffect(() => {
    const el = wrapRef.current;
    if (el === null || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setSize(Math.max(280, Math.min(900, Math.floor(el.clientWidth)))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [layers !== null]);

  /* Paint all the cases into the offscreen field whenever the encoding changes. */
  useEffect(() => {
    if (layers === null || layers.cases.length === 0) return;
    if (colorBy === 'score' && layers.scores === null) return;
    const field = fieldRef.current ?? document.createElement('canvas');
    fieldRef.current = field;
    field.width = side;
    field.height = side;
    const ctx = field.getContext('2d');
    if (ctx === null) return;
    const order = grouped ? groupedOrder(layers, colorBy) : null;
    orderRef.current = order;
    if (order === null) inverseRef.current = null;
    else {
      const inverse = new Uint32Array(order.length);
      for (let p = 0; p < order.length; p++) inverse[order[p]!] = p;
      inverseRef.current = inverse;
    }
    const image = ctx.createImageData(side, side);
    paintField(new Uint32Array(image.data.buffer), layers, order, colorBy, highlight);
    ctx.putImageData(image, 0, 0);
    setPainted((n) => n + 1);
  }, [layers, colorBy, grouped, highlight, side]);

  const shown = useMemo(() => clampView(view, side, size), [view, side, size]);

  /* Draw the visible window of the field. */
  useEffect(() => {
    const canvas = canvasRef.current;
    const field = fieldRef.current;
    if (canvas === null || field === null || painted === 0) return;
    const dpr = typeof window === 'undefined' ? 1 : Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    ctx.fillStyle = SURFACE;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = shown.scale * dpr < 1;
    const span = size / shown.scale;
    ctx.drawImage(field, shown.x, shown.y, span, span, 0, 0, canvas.width, canvas.height);
    if (selected !== null) {
      const p = inverseRef.current === null ? selected : inverseRef.current[selected]!;
      const cx = ((p % side) + 0.5 - shown.x) * shown.scale * dpr;
      const cy = (Math.floor(p / side) + 0.5 - shown.y) * shown.scale * dpr;
      const r = Math.max(7, shown.scale * 0.9) * dpr;
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = SURFACE;
      ctx.beginPath();
      ctx.arc(cx, cy, r + 2 * dpr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#2C6E9E';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }, [painted, shown, size, selected, side]);

  const caseAtPoint = useCallback(
    (left: number, top: number): number | null => {
      const fx = Math.floor(shown.x + left / shown.scale);
      const fy = Math.floor(shown.y + top / shown.scale);
      if (fx < 0 || fy < 0 || fx >= side || fy >= side) return null;
      const p = fy * side + fx;
      if (p >= total) return null;
      return orderRef.current === null ? p : orderRef.current[p]!;
    },
    [shown, side, total],
  );

  const zoomAt = useCallback(
    (factor: number, left: number, top: number) => {
      setView((prev) => {
        const cur = clampView(prev, side, size);
        const fx = cur.x + left / cur.scale;
        const fy = cur.y + top / cur.scale;
        const scale = Math.max(size / side, Math.min(MAX_CELL_PX, cur.scale * factor));
        return clampView({ scale, x: fx - left / scale, y: fy - top / scale }, side, size);
      });
    },
    [side, size],
  );

  /* Wheel zoom needs a non-passive listener to stop the page scrolling. */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const onWheel = (e: WheelEvent): void => {
      /* Plain scrolling must still move the page past a canvas this tall; a pinch arrives with ctrlKey set. */
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - rect.left, e.clientY - rect.top);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [zoomAt, painted > 0]);

  const open = useCallback((index: number) => {
    setSelected(index);
    setWorked(null);
    setWorkedError(null);
    fetchJson<ExplainedCase>(`/verification/cases/${index}`).then(
      setWorked,
      (err: unknown) => setWorkedError(err instanceof Error ? err.message : String(err)),
    );
  }, []);

  /** Centre the view on a case, zooming in far enough to see it as a cell. */
  const reveal = useCallback(
    (index: number) => {
      const p = inverseRef.current === null ? index : inverseRef.current[index]!;
      setView((prev) => {
        const cur = clampView(prev, side, size);
        const scale = Math.max(cur.scale, 6);
        const span = size / scale;
        return clampView({ scale, x: (p % side) - span / 2, y: Math.floor(p / side) - span / 2 }, side, size);
      });
      open(index);
    },
    [open, side, size],
  );

  const pick = useCallback(
    (test: (i: number) => boolean) => {
      const i = randomCase(total, test);
      if (i !== null) reveal(i);
    },
    [reveal, total],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, view: shown, moved: false };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    const left = e.clientX - rect.left;
    const top = e.clientY - rect.top;
    const d = drag.current;
    if (d !== null) {
      const dx = e.clientX - d.px;
      const dy = e.clientY - d.py;
      if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
      if (d.moved) {
        setHover(null);
        setView(clampView({ scale: d.view.scale, x: d.view.x - dx / d.view.scale, y: d.view.y - dy / d.view.scale }, side, size));
        return;
      }
    }
    const index = caseAtPoint(left, top);
    setHover(index === null ? null : { index, left, top });
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const d = drag.current;
    drag.current = null;
    if (d === null || d.moved) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const index = caseAtPoint(e.clientX - rect.left, e.clientY - rect.top);
    if (index !== null) open(index);
  };

  if (absent) return null;
  if (summary === null) return null;

  const cases = layers?.cases ?? null;
  const ready = cases !== null && cases.length > 0;
  const zoomed = shown.scale > (size / side) * 1.01;
  const perPixel = Math.max(1, Math.round(1 / (shown.scale * shown.scale)));

  const legend: readonly { readonly label: string; readonly color: string; readonly n: number; readonly test: (i: number) => boolean }[] =
    colorBy === 'verdict'
      ? summary.verdicts.map((v, k) => ({
          label: humanize(v),
          color: VERDICT_COLORS[k] ?? '#000',
          n: summary.byVerdict[k] ?? 0,
          test: (i: number) => cases !== null && verdictOf(cases[i]!) === k,
        }))
      : colorBy === 'factor'
        ? ['No single factor', ...summary.factors.map(humanize)].map((label, k) => ({
            label,
            color: FACTOR_COLORS[k] ?? '#000',
            n: sum(summary.byFactor[k]),
            test: (i: number) => cases !== null && factorOf(cases[i]!) === k,
          }))
        : [];

  const hoverByte = hover !== null && cases !== null ? cases[hover.index]! : null;

  return (
    <Card title="Every case, one pixel each" anchorId="v-field" aside={`${count(total)} cases · seed ${summary.seed}`}>
      <p style={{ ...MUTED, maxWidth: '72ch' }}>
        {`Each pixel is one generated case from the layer A+B run, coloured by the factor that decided it, the verdict, or the score. All ${count(total)} passed every invariant and matched the naive implementation, so there is no failure colour to find. Click any pixel and the case is rebuilt from the seed and worked in full: the facts, every factor's tier, the guideline text that decided it, and both implementations side by side.`}
      </p>

      {!ready ? (
        <div style={{ ...ROW, marginTop: SPACE.md }}>
          <button type="button" data-testid="field-load" disabled={loading !== null} onClick={() => void load(['cases'])}>
            {loading !== null ? 'Loading 10 MB…' : `Draw all ${count(total)} cases`}
          </button>
          <span style={MUTED}>One byte per case, about 10 MB.</span>
          {error !== null ? <span role="alert">{error}</span> : null}
        </div>
      ) : (
        <>
          <div style={{ ...ROW, marginTop: SPACE.md }} role="group" aria-label="Field controls">
            <span style={MUTED}>Colour by</span>
            {COLOR_BY.map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={colorBy === mode}
                disabled={loading !== null}
                onClick={() => {
                  if (mode === 'score' && layers?.scores === null) void load(['scores']).then((ok) => ok && setColorBy(mode));
                  else setColorBy(mode);
                }}
              >
                {COLOR_BY_LABEL[mode]}
              </button>
            ))}
            <span style={{ ...MUTED, marginLeft: SPACE.md }}>Arrange</span>
            <button type="button" aria-pressed={grouped} onClick={() => setGrouped(true)}>
              Like with like
            </button>
            <button type="button" aria-pressed={!grouped} onClick={() => setGrouped(false)}>
              Run order
            </button>
            {loading !== null ? <span style={MUTED}>{`Loading ${loading}…`}</span> : null}
            {error !== null ? <span role="alert">{error}</span> : null}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: SPACE.lg, marginTop: SPACE.md }}>
            <div ref={wrapRef} style={{ position: 'relative', minWidth: 0 }}>
              <canvas
                ref={canvasRef}
                data-testid="field-canvas"
                role="img"
                aria-label={`${count(total)} verification cases, one pixel each, coloured by ${COLOR_BY_LABEL[colorBy].toLowerCase()}. The legend beside it gives the counts.`}
                style={{ width: size, height: size, display: 'block', cursor: 'crosshair', touchAction: 'none', borderRadius: cssVar('radius-card'), border: `1px solid ${cssVar('mutedTint')}` }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={() => setHover(null)}
              />
              {hover !== null && hoverByte !== null ? (
                <div
                  role="status"
                  style={{
                    position: 'absolute',
                    left: Math.min(size - 230, hover.left + 14),
                    top: Math.max(0, hover.top - 64),
                    width: 216,
                    pointerEvents: 'none',
                    background: cssVar('paper'),
                    border: `1px solid ${cssVar('muted')}`,
                    borderRadius: 6,
                    padding: SPACE.sm,
                    fontSize: cssVar('size-small'),
                  }}
                >
                  <strong>{`Case ${count(hover.index)}`}</strong>
                  <div>{humanize(summary.verdicts[verdictOf(hoverByte)] ?? '')}</div>
                  <div style={MUTED}>
                    {factorOf(hoverByte) === 0 ? 'No single deciding factor' : `Decided by ${humanize(summary.factors[factorOf(hoverByte) - 1] ?? '').toLowerCase()}`}
                    {layers?.scores ? ` · score ${layers.scores[hover.index]}` : ''}
                  </div>
                  <div style={MUTED}>
                    {[isOnThreshold(hoverByte) ? 'on a threshold' : null, isFromSubmission(hoverByte) ? 'full submission' : null].filter(Boolean).join(' · ')}
                  </div>
                  {perPixel > 1 ? <div style={MUTED}>{`~${perPixel} cases under this pixel; zoom in to separate them`}</div> : null}
                </div>
              ) : null}
              <div style={{ ...ROW, marginTop: SPACE.sm }}>
                <button type="button" aria-label="Zoom in" onClick={() => zoomAt(2, size / 2, size / 2)}>+</button>
                <button type="button" aria-label="Zoom out" disabled={!zoomed} onClick={() => zoomAt(0.5, size / 2, size / 2)}>−</button>
                <button type="button" disabled={!zoomed} onClick={() => setView({ scale: 0, x: 0, y: 0 })}>Show all</button>
                <button type="button" data-testid="field-random" onClick={() => pick(() => true)}>Open a random case</button>
                <span style={MUTED}>Pinch or ⌘-scroll to zoom, drag to pan, click to open.</span>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.md, minWidth: 0 }}>
              <div>
                <strong style={{ fontSize: cssVar('size-small') }}>{COLOR_BY_LABEL[colorBy]}</strong>
                {colorBy === 'score' ? (
                  <div>
                    <div
                      aria-hidden="true"
                      style={{ height: 12, borderRadius: 3, marginTop: SPACE.xs, background: `linear-gradient(to right, ${cssColor(scoreColor(0))}, ${cssColor(scoreColor(100))})` }}
                    />
                    <div style={{ ...MUTED, display: 'flex', justifyContent: 'space-between' }}>
                      <span>0</span>
                      <span>appetite score</span>
                      <span>100</span>
                    </div>
                  </div>
                ) : (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {legend.map((g) => (
                      <li key={g.label}>
                        <button type="button" style={LEGEND_BUTTON} disabled={g.n === 0} title="Open a random case of this kind" onClick={() => pick(g.test)}>
                          <Swatch color={g.color} />
                          <span>{g.label}</span>
                          <span style={MUTED}>{`${count(g.n)} · ${share(g.n, total)}`}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <strong style={{ fontSize: cssVar('size-small') }}>Pick out</strong>
                <div style={{ ...ROW, marginTop: SPACE.xs }}>
                  <button type="button" aria-pressed={highlight.kind === 'none'} onClick={() => setHighlight({ kind: 'none' })}>Everything</button>
                  <button type="button" aria-pressed={highlight.kind === 'threshold'} onClick={() => setHighlight({ kind: 'threshold' })}>
                    {`On a threshold (${share(summary.onThreshold, total)})`}
                  </button>
                  <button type="button" aria-pressed={highlight.kind === 'submission'} onClick={() => setHighlight({ kind: 'submission' })}>
                    {`Full submissions (${share(summary.fromSubmission, total)})`}
                  </button>
                </div>
                <label style={{ ...MUTED, display: 'block', marginTop: SPACE.sm }}>
                  A hard-case family
                  <select
                    style={{ display: 'block', width: '100%', minHeight: MIN_TOUCH_TARGET, marginTop: SPACE.xs }}
                    value={highlight.kind === 'stratum' ? String(highlight.index) : ''}
                    onChange={(e) => {
                      const index = Number(e.target.value);
                      if (e.target.value === '') setHighlight({ kind: 'none' });
                      else void load(['strata']).then((ok) => ok && setHighlight({ kind: 'stratum', index }));
                    }}
                  >
                    <option value="">None</option>
                    {summary.strata.map((s, k) => (
                      <option key={s.key} value={k + 1}>{`${humanize(s.key)} (${count(sum(summary.byStratum[k + 1]))})`}</option>
                    ))}
                  </select>
                </label>
                {highlight.kind === 'stratum' ? (
                  <p style={{ ...MUTED, marginTop: SPACE.xs }}>
                    {summary.strata[highlight.index - 1]?.description}{' '}
                    <button
                      type="button"
                      style={LEGEND_BUTTON}
                      onClick={() => pick((i) => layers?.strata?.[i] === highlight.index)}
                    >
                      Open one
                    </button>
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          <div style={{ ...BOX, marginTop: SPACE.lg }} aria-live="polite">
            {selected === null ? (
              <p style={MUTED}>No case open. Click a pixel, a legend row, or “Open a random case”.</p>
            ) : workedError !== null ? (
              <p role="alert" style={{ margin: 0 }}>{`Could not rebuild case ${count(selected)}: ${workedError}`}</p>
            ) : worked === null || worked.index !== selected ? (
              <p style={MUTED}>{`Rebuilding case ${count(selected)} from the seed…`}</p>
            ) : (
              <WorkedCase data={worked} />
            )}
          </div>
        </>
      )}
    </Card>
  );
}
