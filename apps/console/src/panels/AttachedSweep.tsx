import type { ReactElement } from 'react';

import { formatPercent, pluralize, titleCase } from '@retrofit/contracts';

import { Badge } from '../components/atoms/Badge.js';
import { Card } from '../components/atoms/Card.js';
import type { AttachedSweepPanelProps } from './types.js';

/** Mirrors `MIN_COVERAGE_PCT` in packages/engine/src/constants.ts (PRD 11: Finish at ≥ 75%). Label only. */
const MIN_COVERAGE_PCT = 75;
/** Mirrors the SweepDto contract: observations under 0.6 wait for the user to confirm. Label only. */
const CONFIRM_BELOW = 0.6;

function formatBearing(bearing: number | null): string {
  if (bearing === null || !Number.isFinite(bearing)) return '—';
  return `${Math.round(bearing)}°`;
}

/**
 * PRD 10 (l) Attached photo or sweep, if any.
 */
export function AttachedSweep(props: AttachedSweepPanelProps): ReactElement {
  const { sweep } = props;
  if (sweep === null) {
    return (
      <Card title="Attached sweep" anchorId="sweep">
        <p className="rf-empty">No photo or sweep is attached to this submission.</p>
      </Card>
    );
  }

  const sufficient = sweep.coverage >= MIN_COVERAGE_PCT;
  return (
    <Card
      title="Attached sweep"
      anchorId="sweep"
      aside={<Badge label={titleCase(sweep.stage)} tone={sweep.stage === 'failed' ? 'attention' : 'quiet'} />}
    >
      <dl className="rf-stats">
        <div className="rf-stat" data-testid="sweep-room">
          <dt>Room</dt>
          <dd>{sweep.roomLabel ?? 'Unlabelled'}</dd>
        </div>
        <div className="rf-stat" data-testid="sweep-coverage">
          <dt>Coverage</dt>
          <dd>
            {formatPercent(sweep.coverage, { from: 'percent' })}{' '}
            <Badge
              label={sufficient ? 'Sufficient' : `Below ${MIN_COVERAGE_PCT}%`}
              tone={sufficient ? 'quiet' : 'attention'}
            />
          </dd>
        </div>
        <div className="rf-stat" data-testid="sweep-frames">
          <dt>Frames</dt>
          <dd>{pluralize(sweep.frameCount, 'frame')}</dd>
        </div>
      </dl>

      {sweep.observations.length === 0 ? (
        <p className="rf-empty">Nothing was observed in this sweep.</p>
      ) : (
        <div className="rf-scroll-x">
        <table className="rf-table" aria-label="Observations">
          <thead>
            <tr>
              <th scope="col">Observed</th>
              <th scope="col">Bearing</th>
              <th scope="col">Confidence</th>
              <th scope="col">Note</th>
            </tr>
          </thead>
          <tbody>
            {sweep.observations.map((o) => (
              <tr key={o.id} data-testid="sweep-observation">
                <th scope="row">{o.label}</th>
                <td>{formatBearing(o.bearing)}</td>
                <td>
                  {formatPercent(o.confidence)}
                  {o.confidence < CONFIRM_BELOW ? (
                    <>
                      {' '}
                      <Badge label="Needs confirmation" tone="attention" />
                    </>
                  ) : null}
                </td>
                <td>{o.note ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      <p className="rf-footnote">{`Sweep ${sweep.sweepId}`}</p>
    </Card>
  );
}
