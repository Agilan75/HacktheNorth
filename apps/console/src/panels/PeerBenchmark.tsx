import type { ReactElement } from 'react';
import { Link } from 'react-router';

import { formatMoney, formatScore, pluralize } from '@retrofit/contracts';

import { submissionPath } from '../App.js';
import { Card } from '../components/atoms/Card.js';
import { VerdictPill } from '../components/atoms/VerdictPill.js';
import type { PeerBenchmarkPanelProps } from './types.js';

/**
 * A full vector compares components 2–10 (nine); an account with no policy is
 * placed by a reduced vector of three (requested limit, insured revenue,
 * headquarters state) — PRD 6.4. At or under this many compared components the
 * benchmark is labelled a coarse match.
 */
const COARSE_MATCH_MAX_COMPONENTS = 3;

/**
 * PRD 10 (d) The five nearest accounts with distance, rate and losses.
 *
 * Rows render in the order the engine returned them (distance ascending, ties
 * by id — INTERPRETATIONS P-4); the median and mean are the engine's (P-3).
 */
export function PeerBenchmark(props: PeerBenchmarkPanelProps): ReactElement {
  const { benchmark } = props;
  const { peers } = benchmark;
  const coarse =
    benchmark.comparedComponentCount > 0 &&
    benchmark.comparedComponentCount <= COARSE_MATCH_MAX_COMPONENTS;

  return (
    <Card
      title="Peer benchmark"
      anchorId="peers"
      aside={
        <span data-testid="peer-count">
          {pluralize(peers.length, 'nearest account')}
          {coarse ? ' · coarse match' : ''}
        </span>
      }
    >
      <dl className="rf-stats">
        <div className="rf-stat" data-testid="peer-median-rate">
          <dt>Peer median rate per $100 TIV</dt>
          <dd>{formatMoney(benchmark.medianRatePer100Tiv, { decimals: 2 })}</dd>
        </div>
        <div className="rf-stat" data-testid="peer-mean-loss">
          <dt>Peer mean annual loss</dt>
          <dd>{formatMoney(benchmark.meanAnnualLoss)}</dd>
        </div>
        <div className="rf-stat" data-testid="peer-compared">
          <dt>Components compared</dt>
          <dd>{benchmark.comparedComponentCount}</dd>
        </div>
      </dl>

      {coarse ? (
        <p className="rf-footnote" data-testid="peer-coarse">
          Coarse match: this account has no policy, so it is placed by requested limit, insured
          revenue and headquarters state only.
        </p>
      ) : null}

      {peers.length === 0 ? (
        <p className="rf-empty">No comparable accounts share enough known components.</p>
      ) : (
        <div className="rf-scroll-x">
        <table className="rf-table" aria-label="Nearest accounts">
          <thead>
            <tr>
              <th scope="col">Account</th>
              <th scope="col">Distance</th>
              <th scope="col">Rate per $100 TIV</th>
              <th scope="col">Annual loss</th>
              <th scope="col">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {peers.map((p) => (
              <tr key={p.submissionId} data-testid="peer-row">
                <th scope="row">
                  <Link to={submissionPath(p.submissionId)}>{p.insuredName}</Link>
                </th>
                <td>{formatScore(p.distance, { decimals: 3 })}</td>
                <td>{formatMoney(p.ratePer100Tiv, { decimals: 2 })}</td>
                <td>{formatMoney(p.annualLoss)}</td>
                {/* The peer's own stored verdict (FILL-backend D8); absent is said in words, never a dash. */}
                <td data-testid="peer-verdict">
                  {p.verdict !== null ? <VerdictPill verdict={p.verdict} /> : 'No stored result'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      <p className="rf-footnote">
        A benchmark on rate and loss only. Every account with a full vector in this book was bound,
        so peers say nothing about bound versus declined.
      </p>
    </Card>
  );
}
