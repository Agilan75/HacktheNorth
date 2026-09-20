import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { Link } from 'react-router';

import { formatDate, formatMoney, formatPercent, formatScore, pluralize, titleCase } from '@retrofit/contracts';
import { VERDICT_MARKS, VERDICT_STYLES } from '@retrofit/design';

import { ROUTES, submissionPath } from '../App.js';
import type { AggregateResponse } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { Card } from '../components/atoms/Card.js';
import { Skeleton } from '../components/atoms/Skeleton.js';
import { VerdictPill } from '../components/atoms/VerdictPill.js';
import { AdequacyScale } from '../components/charts/AdequacyScale.js';
import { BarList } from '../components/charts/BarList.js';
import type { BarListItem } from '../components/charts/BarList.js';
import { Histogram } from '../components/charts/Histogram.js';
import type { QueueRowView, Verdict } from '../panels/types.js';

/** Display order of the three verdicts (PRD 13 styling, INTERPRETATIONS V-*). */
const VERDICT_ORDER: readonly Verdict[] = ['FIT', 'REFER', 'DOES_NOT_FIT'];

/** At most this many knockout factors are charted; the API already ranks them. */
const MAX_KNOCKOUT_FACTORS = 8;

const GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))',
  gap: 'var(--rf-space-xl)',
  alignItems: 'start',
};

const TILE_ROW: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: 'var(--rf-space-lg)',
  margin: 0,
};

const TILE: CSSProperties = {
  border: 'var(--rf-border-width) solid var(--rf-border-color)',
  borderRadius: 'var(--rf-radius-card)',
  padding: 'var(--rf-space-lg)',
  margin: 0,
};

const TILE_VALUE: CSSProperties = {
  fontFamily: 'var(--rf-font-display)',
  fontSize: 'var(--rf-size-title)',
  lineHeight: 'var(--rf-leading-title)',
  margin: 0,
};

const TILE_LABEL: CSSProperties = {
  fontSize: 'var(--rf-size-micro)',
  lineHeight: 'var(--rf-leading-micro)',
  color: 'var(--rf-muted-deep)',
  margin: 0,
};

/* -------------------------------------------------------------------------- */
/* Pure view builders (presentation only; no number here changes value)       */
/* -------------------------------------------------------------------------- */

function countOf(record: Readonly<Record<string, number>>, key: string): number {
  const v = record[key];
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

function verdictBars(counts: Readonly<Record<string, number>>): readonly BarListItem[] {
  return VERDICT_ORDER.map((v) => {
    const style = VERDICT_STYLES[v];
    return {
      key: v,
      label: style.label,
      mark: VERDICT_MARKS[v],
      count: countOf(counts, v),
      // REFER is an outlined bar, matching its outlined pill.
      fill: style.fill === 'transparent' ? 'var(--rf-red-tint)' : style.fill,
      stroke: style.border,
    };
  });
}

function knockoutBars(factors: AggregateResponse['topKnockoutFactors']): readonly BarListItem[] {
  return factors.slice(0, MAX_KNOCKOUT_FACTORS).map((f) => ({
    key: f.factorId,
    label: f.label ?? titleCase(f.factorId),
    count: f.count,
    fill: 'var(--rf-blue)',
  }));
}

function asNumber(value: number | string | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** `0.91–0.97` (the client's CI string) → `91%–97%`; anything else passes through. */
function formatCi(value: number | string | null | undefined): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const parts = value.split('–').map((p) => Number(p.trim()));
  if (parts.length === 2 && parts.every((p) => Number.isFinite(p) && p >= 0 && p <= 1)) {
    return `${formatPercent(parts[0], { decimals: 1 })}–${formatPercent(parts[1], { decimals: 1 })}`;
  }
  return value;
}

interface VerificationTile {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly note?: string;
}

function countText(value: number | string | null | undefined): string {
  const n = asNumber(value);
  return n === null ? '—' : n.toLocaleString('en-US');
}

/** Headline tiles for the verification summary; empty when no run exists yet. */
function verificationTiles(v: AggregateResponse['verification']): readonly VerificationTile[] {
  if (Object.keys(v).length === 0) return [];
  const ci = formatCi(v.llmAgreementCi95);
  const tiles: VerificationTile[] = [
    { key: 'propertyCasesRun', label: 'Property cases run', value: countText(v.propertyCasesRun) },
    { key: 'differentialCasesRun', label: 'Differential cases run', value: countText(v.differentialCasesRun) },
    { key: 'disagreements', label: 'Disagreements', value: countText(v.disagreements) },
    { key: 'llmCasesRun', label: 'Second-opinion cases', value: countText(v.llmCasesRun) },
    {
      key: 'llmAgreementRate',
      label: 'Second-opinion agreement',
      value: formatPercent(asNumber(v.llmAgreementRate), { decimals: 1 }),
      ...(ci !== null ? { note: `95% CI ${ci}` } : {}),
    },
    {
      key: 'extractionFieldAccuracy',
      label: 'Extraction field accuracy',
      // Absent means the check has not produced a valid measurement; say so
      // rather than dropping the tile or showing a dash (DECISIONS CP2-3).
      value:
        asNumber(v.extractionFieldAccuracy) === null
          ? 'Not measured'
          : formatPercent(asNumber(v.extractionFieldAccuracy), { decimals: 1 }),
    },
  ];
  return tiles;
}

/* -------------------------------------------------------------------------- */
/* Small pieces                                                               */
/* -------------------------------------------------------------------------- */

function Tile(props: { readonly label: string; readonly value: string; readonly note?: ReactNode; readonly testId?: string }): ReactElement {
  return (
    <div style={TILE} data-testid={props.testId}>
      <dt style={TILE_LABEL}>{props.label}</dt>
      <dd style={{ margin: 0 }}>
        <span style={TILE_VALUE}>{props.value}</span>
        {props.note ? <span style={{ ...TILE_LABEL, display: 'block' }}>{props.note}</span> : null}
      </dd>
    </div>
  );
}

type FlipMoves = NonNullable<AggregateResponse['oneFlipMoves']>;

function OneFlipTable(props: { readonly rows: readonly QueueRowView[]; readonly moves: FlipMoves | undefined }): ReactElement {
  if (props.rows.length === 0) {
    return <p style={{ margin: 0, color: 'var(--rf-muted-deep)' }}>No submission is one change away from FIT.</p>;
  }
  return (
    <div className="rf-scroll-x">
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <caption className="rf-sr-only">Submissions one change away from FIT</caption>
        <thead>
          <tr style={{ textAlign: 'left', fontSize: 'var(--rf-size-micro)', color: 'var(--rf-muted-deep)' }}>
            <th scope="col">Insured</th>
            <th scope="col">Verdict</th>
            <th scope="col" style={{ textAlign: 'right' }}>Appetite</th>
            <th scope="col" style={{ textAlign: 'right' }}>Predicted premium</th>
            <th scope="col" style={{ paddingLeft: 'var(--rf-space-md)' }}>What would flip it</th>
            <th scope="col" style={{ textAlign: 'right' }}>Score after</th>
            <th scope="col" style={{ textAlign: 'right' }}>Premium after</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((r) => {
            // The engine's own move (C14); the queue sentence only when the API sent none.
            const move = props.moves?.[r.submissionId];
            return (
              <tr key={r.submissionId} data-testid={`flip-${r.submissionId}`} style={{ borderTop: 'var(--rf-border-width) solid var(--rf-border-color)' }}>
                <th scope="row" style={{ textAlign: 'left', fontWeight: 500, padding: 'var(--rf-space-sm) var(--rf-space-sm) var(--rf-space-sm) 0' }}>
                  <Link to={submissionPath(r.submissionId)} aria-label={`Open ${r.insuredName}`}>
                    {r.insuredName}
                  </Link>
                </th>
                <td>
                  {r.incomplete ? (
                    <span style={{ color: 'var(--rf-muted-deep)' }}>Not in current queue</span>
                  ) : (
                    <VerdictPill verdict={r.verdict} />
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>{formatScore(r.appetiteScore)}</td>
                <td style={{ textAlign: 'right' }}>{formatMoney(r.predictedPremium)}</td>
                <td style={{ paddingLeft: 'var(--rf-space-md)' }}>{move?.moveLabel ?? r.explanationLine}</td>
                <td style={{ textAlign: 'right' }}>{move ? formatScore(move.scoreAfter) : '—'}</td>
                <td style={{ textAlign: 'right' }}>{formatMoney(move?.premiumAfter ?? null)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AggregateBody(props: { readonly data: AggregateResponse }): ReactElement {
  const { data } = props;
  const verdicts = verdictBars(data.countsByVerdict);
  // The API's counts when present (C14); the verdict / histogram sums only as a fallback.
  const counts = data.counts;
  const total = counts?.scored ?? verdicts.reduce((s, b) => s + b.count, 0);
  const fit = countOf(data.countsByVerdict, 'FIT');
  const scored = counts?.scored ?? data.scoreHistogram.reduce((s, b) => s + (Number.isFinite(b.count) ? b.count : 0), 0);
  const adequacy = data.bookAdequacyDetail;
  const median = adequacy?.median ?? data.bookAdequacy;
  const totalNote = counts
    ? `of ${counts.total.toLocaleString('en-US')} ingested · ${counts.knockedOut.toLocaleString('en-US')} knocked out`
    : undefined;
  const underpricedText = adequacy
    ? `${adequacy.underpricedCount.toLocaleString('en-US')} of ${pluralize(adequacy.n, 'priced submission')} quoted below predicted premium.`
    : null;
  const tiles = verificationTiles(data.verification);
  const generatedAt = typeof data.verification.generatedAt === 'string' ? data.verification.generatedAt : null;

  return (
    <>
      <dl style={TILE_ROW} aria-label="Book headline">
        <Tile testId="tile-total" label="Submissions with a verdict" value={total.toLocaleString('en-US')} note={totalNote} />
        <Tile
          testId="tile-fit"
          label="Fit appetite"
          value={fit.toLocaleString('en-US')}
          note={total > 0 ? `${formatPercent(fit / total, { decimals: 1 })} of the book` : undefined}
        />
        <Tile testId="tile-flip" label="One change from FIT" value={data.oneFlipAway.length.toLocaleString('en-US')} />
        <Tile
          testId="tile-adequacy"
          label="Median adequacy"
          value={formatPercent(median)}
          note={adequacy ? `${adequacy.underpricedCount.toLocaleString('en-US')} underpriced` : undefined}
        />
      </dl>

      <div style={GRID}>
        <Card title="Counts by verdict" aside={pluralize(total, 'submission')}>
          <BarList title="Submissions by verdict" items={verdicts} countLabel="Submissions" emptyLabel="No verdicts yet." />
        </Card>

        <Card title="Score distribution" aside={pluralize(scored, 'scored submission')}>
          <Histogram
            title="Appetite score distribution"
            buckets={data.scoreHistogram.map((b) => ({ label: b.bucket, count: b.count }))}
            xLabel="Appetite score (0–100)"
          />
        </Card>

        <Card title="Top knockout factors">
          <BarList
            title="Knockout factors by number of submissions"
            items={knockoutBars(data.topKnockoutFactors)}
            countLabel="Submissions knocked out"
            emptyLabel="No knockouts in the book."
          />
        </Card>

        <Card title="Book adequacy" aside={adequacy ? pluralize(adequacy.n, 'priced submission') : undefined}>
          <AdequacyScale median={median} />
          {underpricedText !== null ? (
            <p data-testid="adequacy-underpriced" style={{ margin: 'var(--rf-space-md) 0 0' }}>
              {underpricedText}
            </p>
          ) : null}
        </Card>
      </div>

      <Card title="One flip away from FIT" aside={pluralize(data.oneFlipAway.length, 'submission')}>
        <OneFlipTable rows={data.oneFlipAway} moves={data.oneFlipMoves} />
      </Card>

      <Card title="Verification" aside={generatedAt ? `Run ${formatDate(generatedAt)}` : undefined}>
        {tiles.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--rf-muted-deep)' }} data-testid="verification-empty">
            No verification run yet. Run the verifier to populate these numbers.
          </p>
        ) : (
          <dl style={TILE_ROW} aria-label="Verification headline">
            {tiles.map((t) => (
              <Tile key={t.key} testId={`verify-${t.key}`} label={t.label} value={t.value} note={t.note} />
            ))}
          </dl>
        )}
        <p style={{ margin: 'var(--rf-space-lg) 0 0' }}>
          <Link to={ROUTES.verification} data-testid="verification-link">
            See the full verification: every check, results by kind of case, each disagreement with both
            sides’ reasoning, and what the testing found
          </Link>
        </p>
      </Card>
    </>
  );
}

/**
 * PRD 10 /aggregate - counts by verdict, score distribution, top knockout factors, one-flip-away list, book adequacy, verification headline.
 *
 * Stub frozen by W0-4. Unit C14 replaces this body only.
 * Route registration lives in src/App.tsx and is frozen.
 */
export function AggregatePage(): ReactElement {
  const state = useApi((client) => client.getAggregate(), []);
  return (
    <section
      aria-labelledby="rf-aggregate-title"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rf-space-xl)' }}
    >
      <h1
        id="rf-aggregate-title"
        style={{ fontFamily: 'var(--rf-font-display)', fontSize: 'var(--rf-size-display)', lineHeight: 'var(--rf-leading-display)', margin: 0 }}
      >
        Aggregate
      </h1>
      {state.error !== null ? (
        <div role="alert" style={TILE}>
          <p style={{ margin: 0 }}>{`Could not load the aggregate: ${state.error.message}`}</p>
          <button
            type="button"
            onClick={state.reload}
            style={{ minHeight: 'var(--rf-min-touch-target)', marginTop: 'var(--rf-space-md)' }}
          >
            Retry
          </button>
        </div>
      ) : state.data === null ? (
        <Skeleton label="Loading aggregate" lines={8} />
      ) : (
        <AggregateBody data={state.data} />
      )}
    </section>
  );
}
