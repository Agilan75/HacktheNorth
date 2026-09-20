import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { resolveBaseUrl } from '../api/useApi.js';
import type { ExplainedCase } from './verification-field.js';

/*
 * The test bench: one of the layer A+B cases, pulled at random and put through
 * the same five stations the run put all of them through -- generate, engine,
 * blind second implementation, compare, invariants -- live, from
 * GET /verification/cases/:index. Nothing is replayed from a recording: the
 * API rebuilds the case from the run's seed and runs everything again. Silent
 * when the API has no recorded field.
 */

interface FieldHead {
  readonly seed: number;
  readonly total: number;
}

const AUTO_LIMIT = 40;
const AUTO_EVERY_MS = 1500;

const count = (n: number): string => n.toLocaleString('en-US');

function words(id: string): string {
  const text = id.replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\btiv\b/gi, 'TIV').trim();
  return text.length === 0 ? id : `${text.charAt(0).toUpperCase()}${text.slice(1).toLowerCase()}`.replace(/\btiv\b/gi, 'TIV');
}

function money(n: number): string {
  if (n >= 1_000_000) return `$${Number((n / 1_000_000).toFixed(1))}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Number(n.toFixed(2)).toLocaleString('en-US')}`;
}

function fact(key: string, v: string | number | boolean | null): string {
  if (v === null) return 'missing';
  if (typeof v === 'number') {
    if (key.startsWith('pct')) return `${Number((v * 100).toFixed(2))}% of TIV`;
    return money(v);
  }
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (v.trim() === '') return 'empty text';
  return key === 'primaryState' ? v : words(v);
}

const FACT_LABELS: Readonly<Record<string, string>> = {
  totalTiv: 'TIV',
  pctTivPre1990: 'Built before 1990',
  pctTivPost2010: 'Built 2010 or later',
  pctTivAcceptableConstruction: 'Acceptable construction',
  fiveYearLoss: 'Five-year loss',
};

const PLACED: Readonly<Record<string, string>> = {
  at: 'on the line',
  under: 'just under',
  over: 'just over',
};

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${resolveBaseUrl()}${path}`, { headers: { accept: 'application/json' }, ...(signal ? { signal } : {}) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

const tier = (label: string | null): string => (label === null ? 'missing' : words(label));

/** One row of the engine-versus-blind-copy table. `same` comes from the API's comparator where it reports the field. */
function Row(props: { readonly label: string; readonly engine: ReactNode; readonly naive: ReactNode; readonly same: boolean; readonly strong?: boolean; readonly title?: string }): ReactElement {
  return (
    <tr data-same={props.same} data-strong={props.strong ?? false}>
      <th scope="row" title={props.title}>{props.label}</th>
      <td>{props.engine}</td>
      <td>{props.naive}</td>
      <td className="rf-bench__eq" aria-label={props.same ? 'identical' : 'different'}>{props.same ? '=' : '≠'}</td>
    </tr>
  );
}

function Ledger(props: { readonly c: ExplainedCase }): ReactElement {
  const { c } = props;
  const facts = Object.entries(c.input).filter(([key]) => !['anyBuildingPre1990', 'hasOpenHighContradiction'].includes(key));
  const differs = new Set(c.disagreements.map((d) => d.field));
  const broken = c.invariants.filter((i) => i.violations.length > 0).length;
  const rule = c.engine.decidingRule;

  return (
    <div className="rf-bench__ledger" key={c.index}>
      <div className="rf-bench__caseline">
        <span className="rf-bench__caseid">{`Case ${count(c.index)}`}</span>
        <span>{`seed ${c.seed}`}</span>
        <span>{c.fromSubmission ? `rolled up from ${c.buildings?.length ?? 0} generated buildings` : 'generated as rolled-up facts'}</span>
        {c.stratum !== null ? <span>{words(c.stratum)}</span> : null}
      </div>

      <div className="rf-bench__split">
        <table className="rf-bench__table">
          <caption>Generated input</caption>
          <colgroup>
            <col />
            <col className="rf-bench__col-value" />
            <col className="rf-bench__col-edge" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Fact</th>
              <th scope="col" className="rf-bench__num">Value</th>
              <th scope="col">Aimed</th>
            </tr>
          </thead>
          <tbody>
            {facts.map(([key, v]) => {
              const placed = PLACED[c.boundaries[key] ?? ''];
              return (
                <tr key={key} data-edge={placed !== undefined}>
                  <th scope="row">{FACT_LABELS[key] ?? words(key)}</th>
                  <td className="rf-bench__num">{fact(key, v)}</td>
                  <td className="rf-bench__edge">{placed ?? ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <table className="rf-bench__table rf-bench__table--versus">
          <caption>Two implementations, compared field by field</caption>
          <colgroup>
            <col />
            <col className="rf-bench__col-side" />
            <col className="rf-bench__col-side" />
            <col className="rf-bench__col-eq" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Engine</th>
              <th scope="col">Blind copy</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            <Row strong label="Verdict" engine={words(c.engine.verdict)} naive={words(c.naive.verdict)} same={!differs.has('verdict')} />
            <Row strong label="Appetite score" engine={c.engine.appetiteScore.toFixed(2)} naive={c.naive.appetiteScore.toFixed(2)} same={!differs.has('appetiteScore')} />
            <Row label="Completeness" engine={c.engine.completeness.toFixed(0)} naive={c.naive.completeness.toFixed(0)} same={!differs.has('completeness')} />
            <Row label="Decided by" engine={words(c.engine.decidingFactorId ?? 'none')} naive={words(c.naive.decidingFactorId ?? 'none')} same={!differs.has('decidingFactorId')} />
            {c.factors.map((f) => (
              <Row
                key={f.factor}
                label={words(f.factor)}
                title={`Engine tier: ${tier(f.tier).toLowerCase()}`}
                engine={`${f.points.toFixed(1)} pts`}
                naive={f.naivePoints === null ? 'missing' : `${f.naivePoints.toFixed(1)} pts`}
                same={f.tierValue === f.naiveTierValue}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="rf-bench__foot">
        <div>
          <span className="rf-bench__label">Deciding rule</span>
          {rule !== null ? (
            <p className="rf-bench__rule">
              “{rule.citation.quote}”
              <span>{` ${rule.citation.doc}, ${rule.citation.section.replace(/"/g, '')} · ${rule.ruleId}`}</span>
            </p>
          ) : (
            <p className="rf-bench__rule"><span>No single rule decided this case.</span></p>
          )}
        </div>
        <div>
          <span className="rf-bench__label">{`Invariants · ${c.invariants.length - broken} of ${c.invariants.length} held`}</span>
          <ul className="rf-bench__laws">
            {c.invariants.map((i) => (
              <li key={`${i.suite}.${i.name}`} data-ok={i.violations.length === 0}>{words(i.name).toLowerCase()}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function TestBench(): ReactElement | null {
  const [head, setHead] = useState<FieldHead | null>(null);
  const [c, setC] = useState<ExplainedCase | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const [pulled, setPulled] = useState(0);
  const inFlight = useRef(false);

  useEffect(() => {
    const abort = new AbortController();
    getJson<FieldHead>('/verification/field', abort.signal).then(setHead, () => undefined);
    return () => abort.abort();
  }, []);

  const pull = useCallback(
    async (index?: number) => {
      if (head === null || inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      setFailed(null);
      try {
        const next = await getJson<ExplainedCase>(`/verification/cases/${index ?? Math.floor(Math.random() * head.total)}`);
        setC(next);
        setPulled((n) => n + 1);
      } catch (err) {
        setFailed(err instanceof Error ? err.message : String(err));
        setAuto(false);
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [head],
  );

  useEffect(() => {
    if (!auto) return;
    if (pulled >= AUTO_LIMIT) {
      setAuto(false);
      return;
    }
    const id = setTimeout(() => void pull(), c === null ? 0 : AUTO_EVERY_MS);
    return () => clearTimeout(id);
  }, [auto, pulled, pull, c]);

  if (head === null) return null;

  return (
    <section className="rf-bench" aria-label="Test bench" data-testid="test-bench">
      <div className="rf-bench__head">
        <div>
          <h3 className="rf-bench__heading">Don’t take the zeros on trust. Re-run one.</h3>
          <p className="rf-bench__lede">
            {`Every one of the ${count(head.total)} cases is rebuilt from two numbers, a seed and an index. Pull any of them and the API generates it again and puts it through the same five steps the run did, right now.`}
          </p>
        </div>
        <div className="rf-bench__controls">
          <button type="button" className="rf-tour__chip" data-testid="bench-pull" disabled={busy || auto} onClick={() => void pull()}>
            {c === null ? 'Pull a case' : 'Pull another'}
          </button>
          <button type="button" className="rf-tour__chip" aria-pressed={auto} onClick={() => setAuto((a) => !a)}>
            {auto ? 'Stop' : 'Keep pulling'}
          </button>
        </div>
      </div>

      {failed !== null ? <p role="alert">{`Could not rebuild a case: ${failed}`}</p> : null}

      {c === null ? (
        <p className="rf-bench__idle">Generate → engine → blind copy → compare → invariants. Nothing is replayed from a recording.</p>
      ) : (
        <Ledger c={c} />
      )}
    </section>
  );
}
