import type { ReactElement } from 'react';

import { formatMoney, formatPercent, formatScore, pluralize } from '@retrofit/contracts';

import { Badge } from '../components/atoms/Badge.js';
import { VerdictPill } from '../components/atoms/VerdictPill.js';
import type { FlipMoveView, FlipPanelProps, FlipView } from './types.js';

const USD_KEYS: ReadonlySet<string> = new Set(['totalTiv', 'quotedPremium', 'fiveYearLoss']);

/** A move's endpoint in the component's own unit. Formatting only. */
function formatValue(key: string, value: number | null): string {
  if (value === null) return 'Missing';
  if (USD_KEYS.has(key)) return formatMoney(value, { decimals: Number.isInteger(value) ? 0 : 2 });
  if (key.startsWith('pct')) return formatPercent(value, { decimals: 1 });
  return Number.isInteger(value) ? formatScore(value) : formatScore(value, { decimals: 2 });
}

function distanceLabel(distance: number | null): string {
  if (distance === null) return 'No flip';
  if (distance === 0) return 'In appetite';
  return `${pluralize(distance, 'move')} from FIT`;
}

function Stat(props: {
  readonly label: string;
  readonly before: string;
  readonly after: string;
  readonly testId: string;
}): ReactElement {
  return (
    <div className="rf-stat" data-testid={props.testId}>
      <dt>{props.label}</dt>
      <dd>
        <span className="rf-stat__before">{props.before}</span>
        <span aria-hidden="true">{' → '}</span>
        <span className="rf-sr-only">{' becomes '}</span>
        <span className="rf-stat__value">{props.after}</span>
      </dd>
    </div>
  );
}

function MoveList(props: { readonly moves: readonly FlipMoveView[] }): ReactElement {
  return (
    <ol className="rf-flip__moves" aria-label="Moves">
      {props.moves.map((m, i) => (
        <li key={`${m.componentKey}-${i}`} data-testid="flip-move">
          <p className="rf-flip__human">{m.humanText}</p>
          <p className="rf-flip__delta">
            <span>{m.label}</span>{' '}
            <code className="rf-code" style={{ opacity: 0.7 }}>
              {m.componentKey}
            </code>
            {': '}
            <span data-testid="flip-move-from">{formatValue(m.componentKey, m.from)}</span>
            {' → '}
            <span data-testid="flip-move-to">{formatValue(m.componentKey, m.to)}</span>
          </p>
        </li>
      ))}
    </ol>
  );
}

function Unavailable(props: { readonly flip: FlipView }): ReactElement {
  const { flip } = props;
  const lead =
    flip.distanceToAppetite === 0
      ? 'No flip needed: this account is already in appetite.'
      : 'No flip reaches FIT within two movable components.';
  return (
    <div data-testid="flip-unavailable">
      <p>{lead}</p>
      {flip.reason !== null && flip.reason.trim() !== '' ? (
        <p className="rf-flip__reason" data-testid="flip-reason">
          {flip.reason}
        </p>
      ) : null}
      <dl className="rf-stats">
        <div className="rf-stat" data-testid="flip-score-before">
          <dt>Appetite score</dt>
          <dd>{formatScore(flip.scoreBefore, { decimals: 1 })}</dd>
        </div>
        <div className="rf-stat" data-testid="flip-premium-before">
          <dt>Quoted premium</dt>
          <dd>{formatMoney(flip.premiumBefore)}</dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * PRD 10 (g) Minimal flip with new score and price.
 *
 * The smallest move (at most two movable components, INTERPRETATIONS F-1, F-2)
 * that lands the account in FIT, with the score and premium after it. Every
 * number comes from `flip`; nothing is recomputed (PRD 10, 13).
 */
export function Flip(props: FlipPanelProps): ReactElement {
  const { flip } = props;
  const hasFlip = flip.available && flip.moves.length > 0;
  const distance = flip.distanceToAppetite;

  return (
    <div className="rf-panel rf-flip" data-testid="flip-panel">
      <p className="rf-flip__distance">
        <Badge
          label={distanceLabel(distance)}
          tone={distance === 1 ? 'attention' : distance === null ? 'quiet' : 'neutral'}
          title="Distance to appetite: the number of moves in the minimal flip (0, 1 or 2), or none."
        />
      </p>

      {hasFlip ? (
        <>
          <MoveList moves={flip.moves} />
          <dl className="rf-stats">
            <Stat
              testId="flip-score"
              label="Appetite score"
              before={formatScore(flip.scoreBefore, { decimals: 1 })}
              after={formatScore(flip.scoreAfter, { decimals: 1 })}
            />
            <Stat
              testId="flip-premium"
              label="Premium"
              before={formatMoney(flip.premiumBefore)}
              after={formatMoney(flip.premiumAfter)}
            />
            <div className="rf-stat" data-testid="flip-verdict-after">
              <dt>Verdict after</dt>
              <dd>{flip.verdictAfter !== null ? <VerdictPill verdict={flip.verdictAfter} /> : '—'}</dd>
            </div>
          </dl>
          <p className="rf-footnote">
            Immovable components (state, building age, submission type, line, past losses, protection
            class) are never proposed.
          </p>
        </>
      ) : (
        <Unavailable flip={flip} />
      )}
    </div>
  );
}
