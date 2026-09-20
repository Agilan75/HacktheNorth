import type { CSSProperties, ReactElement } from 'react';
import { Link } from 'react-router';

import { formatDate, formatPercent, formatScore, formatVerdict, pluralize } from '@retrofit/contracts';
import type { LayerCDisagreementDto, VerificationDto } from '@retrofit/contracts';
import { MIN_TOUCH_TARGET, SPACE, cssVar } from '@retrofit/design';

import { ROUTES, submissionPath } from '../routes.js';
import { useApi } from '../api/useApi.js';
import { Card } from '../components/atoms/Card.js';
import { CitationQuote } from '../components/atoms/CitationQuote.js';
import { Skeleton } from '../components/atoms/Skeleton.js';
import { Tile } from '../components/atoms/Tile.js';
import { VerdictPill } from '../components/atoms/VerdictPill.js';
import { DataTable } from '../components/DataTable.js';
import type { DataTableColumn } from '../components/DataTable.js';
import { VerificationField } from './VerificationField.js';

/*
 * /verification — the testing in full, rendered from GET /verification
 * (FILL-backend D7). Every number on this page is a DTO value, formatted only:
 * nothing is summed, divided or re-derived here (PRD 10, 13). A block the API
 * returns as null says in words that it has no run.
 */

/* -------------------------------------------------------------------------- */
/* Styles                                                                      */
/* -------------------------------------------------------------------------- */

const PAGE: CSSProperties = { display: 'flex', flexDirection: 'column', gap: SPACE.xl };

const TILE_ROW: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))',
  gap: SPACE.lg,
  margin: 0,
};

const BOX: CSSProperties = {
  border: `1px solid ${cssVar('mutedTint')}`,
  borderRadius: cssVar('radius-card'),
  padding: SPACE.lg,
  margin: 0,
};

const MUTED: CSSProperties = {
  fontSize: cssVar('size-small'),
  lineHeight: cssVar('leading-small'),
  color: cssVar('mutedDeep'),
  margin: 0,
};

const SIDES: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
  gap: SPACE.lg,
  marginTop: SPACE.md,
};

const SIDE: CSSProperties = { ...BOX, padding: SPACE.lg };

const INLINE_LIST: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: SPACE.md,
  listStyle: 'none',
  margin: 0,
  padding: 0,
};

const SUMMARY: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: SPACE.sm,
  minHeight: MIN_TOUCH_TARGET,
  cursor: 'pointer',
  padding: `${SPACE.sm}px 0`,
};

/* -------------------------------------------------------------------------- */
/* Page furniture                                                              */
/* -------------------------------------------------------------------------- */

/** The six sections, in render order; each id is the Card's anchor. */
const SECTIONS: readonly { readonly id: string; readonly label: string }[] = [
  { id: 'v-headline', label: 'Headline' },
  { id: 'v-field', label: 'Every case' },
  { id: 'v-real', label: 'Real accounts' },
  { id: 'v-strata', label: 'By kind of case' },
  { id: 'v-disagreements', label: 'Disagreements' },
  { id: 'v-found', label: 'What it found' },
];

/** The three layers, as a labelled strip rather than a paragraph. */
const LAYERS: readonly { readonly key: string; readonly label: string; readonly gloss: string }[] = [
  { key: 'A', label: 'Layer A', gloss: 'engine obeys its own laws' },
  { key: 'B', label: 'Layer B', gloss: 'naive implementation, same answer' },
  { key: 'C', label: 'Layer C', gloss: 'model asked the same question' },
];

function Breadcrumb(): ReactElement {
  return (
    <nav aria-label="Breadcrumb" data-testid="breadcrumb">
      <ol style={{ ...INLINE_LIST, ...MUTED, gap: SPACE.xs }}>
        <li>
          <Link to={ROUTES.aggregate}>Aggregate</Link>
        </li>
        <li aria-hidden="true">/</li>
        <li aria-current="page">Verification</li>
      </ol>
    </nav>
  );
}

function SectionIndex(): ReactElement {
  return (
    <nav aria-label="Sections" data-testid="section-index">
      <ul style={INLINE_LIST}>
        {SECTIONS.map((s) => (
          <li key={s.id}>
            <a href={`#${s.id}`} style={{ display: 'inline-flex', alignItems: 'center', minHeight: MIN_TOUCH_TARGET }}>
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function LayerStrip(): ReactElement {
  return (
    <ul style={{ ...INLINE_LIST, marginTop: SPACE.lg }} aria-label="The three layers" data-testid="layer-strip">
      {LAYERS.map((l) => (
        <li key={l.key} style={{ ...BOX, padding: SPACE.md, flex: '1 1 200px' }}>
          <strong style={{ display: 'block', fontSize: cssVar('size-small') }}>{l.label}</strong>
          <span style={MUTED}>{l.gloss}</span>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Formatting (presentation only)                                              */
/* -------------------------------------------------------------------------- */

function count(n: number): string {
  return n.toLocaleString('en-US');
}

/** `construction_exact_half` -> `Construction exact half`; `tiv_at_150m` -> `TIV at 150M`. */
function humanize(id: string): string {
  const text = id
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\btiv\b/gi, 'TIV')
    .replace(/\b(\d+)m\b/g, '$1M');
  return text.length === 0 ? id : `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function factor(id: string | null): string {
  return id === null ? 'None' : humanize(id);
}

function Missing(): ReactElement {
  return (
    <p style={MUTED} data-testid="block-missing">
      No verification run found.
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                    */
/* -------------------------------------------------------------------------- */

function Headline(props: { readonly data: VerificationDto }): ReactElement {
  const { layersAB, layerC, extraction } = props.data;
  return (
    <Card title="The headline" anchorId="v-headline">
      <dl style={TILE_ROW} aria-label="Verification headline">
        {layersAB !== null ? (
          <>
            <Tile
              testId="v-cases"
              label="Property + differential cases"
              value={count(layersAB.completed)}
              detail={`of ${count(layersAB.requested)} requested · ${pluralize(layersAB.workers, 'worker')} · seed ${layersAB.seed}`}
            />
            <Tile
              testId="v-violations"
              label="Invariant violations"
              tone={layersAB.invariantViolations === 0 ? 'positive' : 'attention'}
              value={count(layersAB.invariantViolations)}
              detail="Layer A"
            />
            <Tile
              testId="v-disagreements"
              label="Disagreements with the independent implementation"
              tone={layersAB.disagreements === 0 ? 'positive' : 'attention'}
              value={count(layersAB.disagreements)}
              detail="Layer B"
            />
            <Tile testId="v-errors" label="Crashes or errors" value={count(layersAB.errors)} />
          </>
        ) : null}
        {layerC !== null ? (
          <Tile
            testId="v-agreement"
            label="Second-opinion agreement"
            tone="info"
            value={formatPercent(layerC.agreement.point, { decimals: 1 })}
            detail={`${count(layerC.agreed)} of ${count(layerC.judged)} · ${formatPercent(layerC.agreement.confidence)} interval ${formatPercent(layerC.agreement.low, { decimals: 1 })}–${formatPercent(layerC.agreement.high, { decimals: 1 })}`}
          />
        ) : null}
        <Tile
          testId="v-extraction"
          label="Reply-extraction accuracy"
          value={
            extraction.status === 'measured' && extraction.fieldAccuracy !== null
              ? formatPercent(extraction.fieldAccuracy, { decimals: 1 })
              : 'Not measured'
          }
        />
      </dl>
      {layersAB === null ? <Missing /> : null}
      {layerC === null ? <Missing /> : null}
      <LayerStrip />
      {extraction.status !== 'measured' ? (
        <div data-testid="extraction-reason" style={{ marginTop: SPACE.lg }}>
          <h3 style={{ fontSize: cssVar('size-body'), margin: 0 }}>Why reply extraction is not measured</h3>
          <p style={{ maxWidth: '72ch', marginTop: SPACE.xs }}>{extraction.reason ?? 'The API gave no reason.'}</p>
        </div>
      ) : null}
      {layersAB !== null ? (
        <p style={{ ...MUTED, marginTop: SPACE.lg }}>
          {`Run ${formatDate(layersAB.startedAt)} at ${formatScore(layersAB.casesPerSecond)} cases per second.`}
        </p>
      ) : null}
    </Card>
  );
}

function RealAccounts(props: { readonly data: VerificationDto }): ReactElement {
  const r = props.data.realAccounts;
  return (
    <Card title="The real property accounts" anchorId="v-real">
      {r === null ? (
        <Missing />
      ) : (
        <>
          <dl style={TILE_ROW} aria-label="Real account checks">
            <Tile testId="real-total" label="Real property accounts checked" value={count(r.total)} />
            <Tile
              testId="real-naive"
              label="Independent implementation agrees on everything"
              value={`${count(r.naiveAgreedAll)} of ${count(r.total)}`}
              detail="Verdict, score, knockouts and deciding factor"
            />
            <Tile
              testId="real-second"
              label="Second-opinion model agrees on the verdict"
              value={`${count(r.secondOpinionAgreed)} of ${count(r.secondOpinionAnswered)}`}
              detail={`${count(r.secondOpinionAnswered)} of ${count(r.total)} answered`}
            />
          </dl>
          <p style={{ ...MUTED, marginTop: SPACE.md }}>{`Checked ${formatDate(r.generatedAt)}.`}</p>
        </>
      )}
    </Card>
  );
}

interface StratumRow {
  readonly stratum: string;
  readonly total: number;
  readonly agreed: number;
  readonly rate: number | null;
}

const STRATUM_COLUMNS: readonly DataTableColumn<StratumRow>[] = [
  { key: 'stratum', header: 'Kind of case', render: (s) => humanize(s.stratum), sortValue: (s) => humanize(s.stratum) },
  { key: 'total', header: 'Cases', align: 'right', render: (s) => count(s.total), sortValue: (s) => s.total },
  { key: 'agreed', header: 'Agreed', align: 'right', render: (s) => count(s.agreed), sortValue: (s) => s.agreed },
  {
    key: 'rate',
    header: 'Agreement',
    align: 'right',
    render: (s) => (s.rate === null ? 'No answered cases' : formatPercent(s.rate, { decimals: 1 })),
    sortValue: (s) => s.rate,
  },
];

function Strata(props: { readonly data: VerificationDto }): ReactElement | null {
  const c = props.data.layerC;
  if (c === null) return null;
  return (
    <Card
      title="Second opinion by kind of case"
      anchorId="v-strata"
      aside={pluralize(c.byStratum.length, 'stratum', 'strata')}
    >
      <p style={MUTED} data-testid="strata-note">
        {`${count(c.unanswered)} unanswered, left out of every count · ${count(c.decidingFactorAgreed)} of ${count(c.agreed)} agreeing cases also named the same deciding factor.`}
      </p>
      <DataTable
        caption="Second-opinion agreement by stratum"
        columns={STRATUM_COLUMNS}
        rows={c.byStratum}
        rowKey={(s) => s.stratum}
        emptyLabel="No strata."
      />
    </Card>
  );
}

function Disagreement(props: { readonly d: LayerCDisagreementDto; readonly open: boolean }): ReactElement {
  const { d, open } = props;
  const tiers = Object.entries(d.engine.tierValuesByFactor);
  const delta = `The engine says ${formatVerdict(d.engine.verdict)}; the model says ${formatVerdict(d.model.verdict)}.`;
  return (
    <details
      data-testid={`disagreement-${d.caseId}`}
      open={open}
      style={{ borderTop: `1px solid ${cssVar('mutedTint')}`, padding: `${SPACE.xs}px 0` }}
    >
      <summary style={SUMMARY}>
        <Link to={submissionPath(d.caseId)} data-testid={`disagreement-link-${d.caseId}`}>
          {d.caseId}
        </Link>
        <span style={MUTED}>{humanize(d.stratum)}</span>
        <span>{delta}</span>
      </summary>
      <div style={SIDES}>
        <section style={SIDE} aria-label="The engine's side" data-side="engine">
          <h4 style={{ margin: 0 }}>The engine</h4>
          <p style={{ margin: `${SPACE.sm}px 0 0` }}>
            <VerdictPill verdict={d.engine.verdict} />{' '}
            {`${formatScore(d.engine.appetiteScore, { outOf: true })} · deciding factor: ${factor(d.engine.decidingFactorId)}`}
          </p>
          <p style={{ ...MUTED, marginTop: SPACE.sm }}>
            {`Knockouts: ${d.engine.knockoutFactorIds.length === 0 ? 'none' : d.engine.knockoutFactorIds.map(factor).join(', ')} · completeness ${formatPercent(d.engine.completeness, { from: 'percent', decimals: 1 })}`}
          </p>
          <table aria-label={`Engine tier per factor, case ${d.caseId}`}>
            <caption style={{ ...MUTED, textAlign: 'left' }}>Tier per factor</caption>
            <tbody>
              {tiers.map(([f, t]) => (
                <tr key={f}>
                  <th scope="row" style={{ fontWeight: 400 }}>{factor(f)}</th>
                  <td style={{ textAlign: 'right' }}>{t === null ? 'Unknown' : String(t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section style={SIDE} aria-label="The second-opinion model's side" data-side="model">
          <h4 style={{ margin: 0 }}>The second-opinion model</h4>
          <p style={{ margin: `${SPACE.sm}px 0 0` }}>
            <VerdictPill verdict={d.model.verdict} /> {`deciding factor: ${factor(d.model.decidingFactor)}`}
          </p>
          <CitationQuote citation={{ document: 'Second-opinion model', quote: d.model.reasoning }} />
        </section>
      </div>
    </details>
  );
}

function Disagreements(props: { readonly data: VerificationDto }): ReactElement | null {
  const c = props.data.layerC;
  if (c === null) return null;
  return (
    <Card
      title="Every disagreement, both sides"
      anchorId="v-disagreements"
      aside={pluralize(c.disagreements.length, 'disagreement')}
    >
      {c.disagreements.length === 0 ? (
        <p style={MUTED}>No disagreements.</p>
      ) : (
        c.disagreements.map((d, i) => <Disagreement key={d.caseId} d={d} open={i === 0} />)
      )}
    </Card>
  );
}

function Found(props: { readonly data: VerificationDto }): ReactElement {
  const f = props.data.defectsFound;
  return (
    <Card title="What the testing found" anchorId="v-found" aside={pluralize(f.defects.length, 'fix', 'fixes')}>
      <p style={MUTED} data-testid="found-lead">
        {f.cp1InvariantViolations !== null && f.cp1Disagreements !== null
          ? `The first differential run reported ${count(f.cp1InvariantViolations)} invariant violations and ${count(f.cp1Disagreements)} disagreements.`
          : ''}
        {f.run2Confirmed !== null
          ? ` A review over the real Federato data then confirmed ${count(f.run2Confirmed)} defects${f.run2Refuted !== null ? ` and refuted ${count(f.run2Refuted)}` : ''}.`
          : ''}
        {' All were fixed and are pinned by tests.'}
      </p>
      {f.defects.length === 0 ? (
        <p style={MUTED}>No defects listed.</p>
      ) : (
        <ol style={{ margin: `${SPACE.md}px 0 0`, paddingLeft: SPACE.xl }}>
          {f.defects.map((d) => (
            <li key={d.id} data-testid={`defect-${d.id}`} style={{ marginBottom: SPACE.md }}>
              <strong>{d.title}</strong>
              <span style={{ ...MUTED, display: 'inline' }}>{` (${d.id}, ${d.phase})`}</span>
              <p style={{ margin: `${SPACE.xs}px 0 0`, maxWidth: '72ch' }}>{d.detail}</p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function VerificationBody(props: { readonly data: VerificationDto }): ReactElement {
  const { data } = props;
  return (
    <>
      <SectionIndex />
      <Headline data={data} />
      {data.layersAB !== null ? <VerificationField /> : null}
      <RealAccounts data={data} />
      <Strata data={data} />
      <Disagreements data={data} />
      <Found data={data} />
      <p style={MUTED} data-testid="sources">
        {`Read from: ${data.sources.join(', ')}.`}
      </p>
    </>
  );
}

/** /verification: the testing in full, for a judge or an underwriter. */
export function VerificationPage(): ReactElement {
  const state = useApi((client) => client.getVerification(), []);
  return (
    <section aria-labelledby="rf-verification-title" style={PAGE}>
      <Breadcrumb />
      <h1 id="rf-verification-title" style={{ margin: 0 }}>
        Verification
      </h1>
      {state.error !== null ? (
        <div role="alert" style={BOX}>
          <p style={{ margin: 0 }}>{`Could not load the verification: ${state.error.message}`}</p>
          <button type="button" onClick={state.reload} style={{ minHeight: MIN_TOUCH_TARGET, marginTop: SPACE.md }}>
            Retry
          </button>
        </div>
      ) : state.data === null ? (
        <Skeleton label="Loading verification" lines={8} />
      ) : (
        <VerificationBody data={state.data} />
      )}
    </section>
  );
}
