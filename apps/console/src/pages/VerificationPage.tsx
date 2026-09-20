import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { Link } from 'react-router';

import { formatDate, formatPercent, formatScore, formatVerdict, pluralize } from '@retrofit/contracts';
import type { LayerCDisagreementDto, VerificationDto } from '@retrofit/contracts';
import { SPACE, cssVar } from '@retrofit/design';

import { ROUTES } from '../App.js';
import { useApi } from '../api/useApi.js';
import { Card } from '../components/atoms/Card.js';
import { Skeleton } from '../components/atoms/Skeleton.js';
import { VerdictPill } from '../components/atoms/VerdictPill.js';

/*
 * /verification — the testing in full, rendered from GET /verification
 * (FILL-backend D7). Every number on this page is a DTO value, formatted only:
 * nothing is summed, divided or re-derived here (PRD 10, 13). A block the API
 * returns as null says in words that its file was not found.
 */

/* -------------------------------------------------------------------------- */
/* Styles                                                                      */
/* -------------------------------------------------------------------------- */

const PAGE: CSSProperties = { display: 'flex', flexDirection: 'column', gap: SPACE.xl };

const TILE_ROW: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
  gap: SPACE.lg,
  margin: 0,
};

const TILE: CSSProperties = {
  border: `1px solid ${cssVar('muted-tint')}`,
  borderRadius: cssVar('radius-card'),
  padding: SPACE.lg,
  margin: 0,
};

const TILE_VALUE: CSSProperties = {
  fontFamily: cssVar('font-display'),
  fontSize: cssVar('size-title'),
  lineHeight: cssVar('leading-title'),
  display: 'block',
};

const MUTED: CSSProperties = {
  fontSize: cssVar('size-small'),
  lineHeight: cssVar('leading-small'),
  color: cssVar('muted-deep'),
  margin: 0,
};

const LEAD: CSSProperties = { maxWidth: '72ch', margin: 0 };

const SIDES: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
  gap: SPACE.lg,
  marginTop: SPACE.md,
};

const SIDE: CSSProperties = { ...TILE, padding: SPACE.lg };

const QUOTE: CSSProperties = {
  margin: `${SPACE.sm}px 0 0`,
  padding: `${SPACE.sm}px 0 ${SPACE.sm}px ${SPACE.lg}px`,
  borderLeft: `3px solid ${cssVar('muted-tint')}`,
  whiteSpace: 'pre-wrap',
};

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

function Tile(props: { readonly testId: string; readonly label: string; readonly value: string; readonly note?: ReactNode }): ReactElement {
  return (
    <div style={TILE} data-testid={props.testId}>
      <dt style={MUTED}>{props.label}</dt>
      <dd style={{ margin: 0 }}>
        <span style={TILE_VALUE}>{props.value}</span>
        {props.note !== undefined ? <span style={{ ...MUTED, display: 'block' }}>{props.note}</span> : null}
      </dd>
    </div>
  );
}

function Missing(props: { readonly what: string; readonly file: string }): ReactElement {
  return (
    <p style={MUTED} data-testid="block-missing">
      {`${props.what}: no result file was found (${props.file}), so there is nothing to show.`}
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                    */
/* -------------------------------------------------------------------------- */

function Headline(props: { readonly data: VerificationDto }): ReactElement {
  const { layersAB, layerC, extraction } = props.data;
  return (
    <Card title="The headline">
      <dl style={TILE_ROW} aria-label="Verification headline">
        {layersAB !== null ? (
          <>
            <Tile
              testId="v-cases"
              label="Property + differential cases"
              value={count(layersAB.completed)}
              note={`of ${count(layersAB.requested)} requested · ${pluralize(layersAB.workers, 'worker')} · seed ${layersAB.seed}`}
            />
            <Tile testId="v-violations" label="Invariant violations" value={count(layersAB.invariantViolations)} note="Layer A: the engine's own laws" />
            <Tile
              testId="v-disagreements"
              label="Disagreements with the independent implementation"
              value={count(layersAB.disagreements)}
              note="Layer B: same input, same answer"
            />
            <Tile testId="v-errors" label="Crashes or errors" value={count(layersAB.errors)} />
          </>
        ) : null}
        {layerC !== null ? (
          <Tile
            testId="v-agreement"
            label="Second-opinion agreement"
            value={formatPercent(layerC.agreement.point, { decimals: 1 })}
            note={`${count(layerC.agreed)} of ${count(layerC.judged)} · ${formatPercent(layerC.agreement.confidence)} interval ${formatPercent(layerC.agreement.low, { decimals: 1 })}–${formatPercent(layerC.agreement.high, { decimals: 1 })}`}
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
      {layersAB === null ? <Missing what="Layers A and B" file="packages/verify/out/run.json" /> : null}
      {layerC === null ? <Missing what="Layer C" file="packages/verify/out/layer-c.json" /> : null}
      {extraction.status !== 'measured' ? (
        <div data-testid="extraction-reason" style={{ marginTop: SPACE.lg }}>
          <h3 style={{ fontSize: cssVar('size-body'), margin: 0 }}>Why reply extraction is not measured</h3>
          <p style={{ ...LEAD, marginTop: SPACE.xs }}>
            {extraction.reason ?? 'The API gave no reason.'}
          </p>
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
    <Card title="The real property accounts">
      {r === null ? (
        <Missing what="Per-account checks" file="packages/verify/out/per-account.json" />
      ) : (
        <>
          <dl style={TILE_ROW} aria-label="Real account checks">
            <Tile testId="real-total" label="Real property accounts checked" value={count(r.total)} />
            <Tile
              testId="real-naive"
              label="Independent implementation agrees on everything"
              value={`${count(r.naiveAgreedAll)} of ${count(r.total)}`}
              note="Verdict, score, knockouts and deciding factor"
            />
            <Tile
              testId="real-second"
              label="Second-opinion model agrees on the verdict"
              value={`${count(r.secondOpinionAgreed)} of ${count(r.secondOpinionAnswered)}`}
              note={`${count(r.secondOpinionAnswered)} of ${count(r.total)} answered`}
            />
          </dl>
          <p style={{ ...MUTED, marginTop: SPACE.md }}>
            Each real property account shows its own result under “Independent checks” on its page.
            {` Checked ${formatDate(r.generatedAt)}.`}
          </p>
        </>
      )}
    </Card>
  );
}

function Strata(props: { readonly data: VerificationDto }): ReactElement | null {
  const c = props.data.layerC;
  if (c === null) return null;
  return (
    <Card title="Second opinion by kind of case" aside={pluralize(c.byStratum.length, 'stratum', 'strata')}>
      <p style={LEAD}>
        Cases are chosen to sit on every threshold and every ambiguity in the guidelines, where a
        disagreement is most likely. {`${count(c.unanswered)} cases were never answered and are left out of every count. Of the ${count(c.agreed)} agreeing cases, ${count(c.decidingFactorAgreed)} also named the same deciding factor.`}
      </p>
      <div className="rf-scroll-x" style={{ marginTop: SPACE.md }}>
        <table aria-label="Second-opinion agreement by stratum">
          <thead>
            <tr>
              <th scope="col">Kind of case</th>
              <th scope="col" style={{ textAlign: 'right' }}>Cases</th>
              <th scope="col" style={{ textAlign: 'right' }}>Agreed</th>
              <th scope="col" style={{ textAlign: 'right' }}>Agreement</th>
            </tr>
          </thead>
          <tbody>
            {c.byStratum.map((s) => (
              <tr key={s.stratum} data-testid={`stratum-${s.stratum}`}>
                <th scope="row" style={{ fontWeight: 400, color: cssVar('ink') }}>
                  {humanize(s.stratum)}
                </th>
                <td style={{ textAlign: 'right' }}>{count(s.total)}</td>
                <td style={{ textAlign: 'right' }}>{count(s.agreed)}</td>
                <td style={{ textAlign: 'right' }}>
                  {s.rate === null ? 'No answered cases' : formatPercent(s.rate, { decimals: 1 })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Disagreement(props: { readonly d: LayerCDisagreementDto }): ReactElement {
  const { d } = props;
  const tiers = Object.entries(d.engine.tierValuesByFactor);
  return (
    <article data-testid={`disagreement-${d.caseId}`} aria-labelledby={`dis-${d.caseId}`} style={{ marginTop: SPACE.lg }}>
      <h3 id={`dis-${d.caseId}`} style={{ margin: 0, fontSize: cssVar('size-body') }}>
        {`Case ${d.caseId} · ${humanize(d.stratum)}`}
      </h3>
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
          <p style={{ ...MUTED, marginTop: SPACE.sm }}>Its reasoning is the tier it gave each factor (1 target, 0.6 acceptable, 0 not acceptable):</p>
          <table aria-label={`Engine tier per factor, case ${d.caseId}`}>
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
            <VerdictPill verdict={d.model.verdict} />{' '}
            {`deciding factor: ${factor(d.model.decidingFactor)}`}
          </p>
          <p style={{ ...MUTED, marginTop: SPACE.sm }}>Its written reasoning:</p>
          <blockquote style={QUOTE}>{d.model.reasoning}</blockquote>
        </section>
      </div>
      <p style={{ ...MUTED, marginTop: SPACE.sm }}>
        {`The engine says ${formatVerdict(d.engine.verdict)}; the model says ${formatVerdict(d.model.verdict)}. The model is the less reliable party: a disagreement is a lead, not proof the engine is wrong.`}
      </p>
    </article>
  );
}

function Disagreements(props: { readonly data: VerificationDto }): ReactElement | null {
  const c = props.data.layerC;
  if (c === null) return null;
  return (
    <Card title="Every disagreement, both sides" aside={pluralize(c.disagreements.length, 'disagreement')}>
      {c.disagreements.length === 0 ? (
        <p style={LEAD}>The second-opinion model agreed with the engine on every case it answered.</p>
      ) : (
        c.disagreements.map((d) => <Disagreement key={d.caseId} d={d} />)
      )}
    </Card>
  );
}

function Found(props: { readonly data: VerificationDto }): ReactElement {
  const f = props.data.defectsFound;
  return (
    <Card title="What the testing found" aside={pluralize(f.defects.length, 'fix', 'fixes')}>
      <p style={LEAD} data-testid="found-lead">
        The zeros above came after the testing found real bugs, which is the point of it.
        {f.cp1InvariantViolations !== null && f.cp1Disagreements !== null
          ? ` The first differential run reported ${count(f.cp1InvariantViolations)} invariant violations and ${count(f.cp1Disagreements)} disagreements.`
          : ''}
        {f.run2Confirmed !== null
          ? ` A review over the real Federato data then confirmed ${count(f.run2Confirmed)} defects${f.run2Refuted !== null ? ` and refuted ${count(f.run2Refuted)}` : ''}.`
          : ''}
        {' All were fixed and are pinned by tests. The ones that mattered most:'}
      </p>
      {f.defects.length === 0 ? (
        <p style={MUTED}>No defect rows were found in DECISIONS.md.</p>
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
      <p style={LEAD}>
        Three independent checks stand behind every verdict. <strong>Layer A</strong> feeds the engine
        generated submissions and checks it obeys its own laws: the same input always gives the same
        answer, improving a factor never lowers the score, a knockout always declines.{' '}
        <strong>Layer B</strong> runs the same cases through a second, deliberately naive implementation
        written straight from the guideline table with no shared code; any difference is a bug in one of
        them. <strong>Layer C</strong> asks a language model, given only the guideline text and the
        facts, what verdict it would reach.
      </p>
      <Headline data={data} />
      <RealAccounts data={data} />
      <Strata data={data} />
      <Disagreements data={data} />
      <Found data={data} />
      <p style={MUTED} data-testid="sources">
        {`Read from: ${data.sources.join(', ')}.`} <Link to={ROUTES.aggregate}>Back to the aggregate</Link>
      </p>
    </>
  );
}

/** /verification: the testing in full, for a judge or an underwriter. */
export function VerificationPage(): ReactElement {
  const state = useApi((client) => client.getVerification(), []);
  return (
    <section aria-labelledby="rf-verification-title" style={PAGE}>
      <h1 id="rf-verification-title" style={{ margin: 0 }}>
        Verification
      </h1>
      {state.error !== null ? (
        <div role="alert" style={TILE}>
          <p style={{ margin: 0 }}>{`Could not load the verification: ${state.error.message}`}</p>
          <button type="button" onClick={state.reload} style={{ marginTop: SPACE.md }}>
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
