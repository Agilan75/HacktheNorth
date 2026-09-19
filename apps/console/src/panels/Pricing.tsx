import type { ReactElement } from 'react';

import { formatMoney, formatPercent, formatScore } from '@retrofit/contracts';

import { Badge } from '../components/atoms/Badge.js';
import { Card } from '../components/atoms/Card.js';
import type { PricingFactorView, PricingPanelProps } from './types.js';

/**
 * Mirrors `ADEQUACY_UNDERPRICED` in packages/engine/src/constants.ts (PRD 6.7:
 * "Under 0.9 means underpriced for the risk"). `@retrofit/engine` is not a
 * console dependency, so the value is copied here, used only to pick a label.
 */
const ADEQUACY_UNDERPRICED = 0.9;

function adequacyLabel(adequacy: number | null): string | null {
  if (adequacy === null || !Number.isFinite(adequacy)) return null;
  return adequacy < ADEQUACY_UNDERPRICED ? 'Underpriced for the risk' : 'Adequate for the risk';
}

function formatMultiplier(multiplier: number): string {
  return `×${formatScore(multiplier, { decimals: 2 })}`;
}

function multiplierEffect(multiplier: number): string {
  if (!Number.isFinite(multiplier)) return 'Unknown';
  if (multiplier > 1) return 'Raises premium';
  if (multiplier < 1) return 'Lowers premium';
  return 'No effect';
}

function Stat(props: {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  readonly testId: string;
}): ReactElement {
  return (
    <div className="rf-stat" data-testid={props.testId}>
      <dt>{props.label}</dt>
      <dd>
        <span className="rf-stat__value">{props.value}</span>
        {props.hint !== undefined ? <span className="rf-stat__hint">{` ${props.hint}`}</span> : null}
      </dd>
    </div>
  );
}

function FactorTable(props: { readonly factors: readonly PricingFactorView[] }): ReactElement {
  if (props.factors.length === 0) {
    return <p className="rf-empty">No rating factors were applied to this account.</p>;
  }
  return (
    <table className="rf-table" aria-label="Rating factors">
      <thead>
        <tr>
          <th scope="col">Factor</th>
          <th scope="col">Multiplier</th>
          <th scope="col">Effect</th>
          <th scope="col">Basis</th>
        </tr>
      </thead>
      <tbody>
        {props.factors.map((f, i) => (
          <tr key={`${f.label}-${i}`} data-testid="pricing-factor">
            <th scope="row">{f.label}</th>
            <td>{formatMultiplier(f.multiplier)}</td>
            <td>{multiplierEffect(f.multiplier)}</td>
            <td>{f.basis ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * PRD 10 (d) Factor-by-factor premium, adequacy and expected loss.
 *
 * Every number comes from `pricing`; nothing is recomputed here (PRD 10, 13).
 */
export function Pricing(props: PricingPanelProps): ReactElement {
  const { pricing } = props;
  const label = adequacyLabel(pricing.adequacy);
  const underpriced = pricing.adequacy !== null && pricing.adequacy < ADEQUACY_UNDERPRICED;

  return (
    <Card
      title="Pricing"
      anchorId="pricing"
      aside={
        label !== null ? (
          <Badge
            label={label}
            tone={underpriced ? 'attention' : 'quiet'}
            title={`Price adequacy is quoted ÷ predicted premium; under ${formatScore(ADEQUACY_UNDERPRICED, { decimals: 1 })} is underpriced.`}
          />
        ) : undefined
      }
    >
      <dl className="rf-stats">
        <Stat testId="pricing-quoted" label="Quoted premium" value={formatMoney(pricing.quotedPremium)} />
        <Stat
          testId="pricing-predicted"
          label="Predicted premium"
          value={formatMoney(pricing.predictedPremium)}
        />
        <Stat
          testId="pricing-adequacy"
          label="Price adequacy"
          value={formatPercent(pricing.adequacy)}
          hint={
            pricing.adequacy !== null && Number.isFinite(pricing.adequacy)
              ? `(${formatScore(pricing.adequacy, { decimals: 2 })} quoted ÷ predicted)`
              : '(needs a quoted and a predicted premium)'
          }
        />
        <Stat
          testId="pricing-expected-loss"
          label="Expected annual loss"
          value={formatMoney(pricing.expectedLoss)}
        />
        <Stat
          testId="pricing-rate"
          label="Rate per $100 TIV"
          value={formatMoney(pricing.ratePer100Tiv, { decimals: 2 })}
        />
      </dl>

      <h3 className="rf-card__subtitle">Factor by factor</h3>
      <FactorTable factors={pricing.factors} />

      {pricing.notes.length > 0 ? (
        <ul className="rf-notes" aria-label="Pricing notes">
          {pricing.notes.map((note, i) => (
            <li key={i}>{note}</li>
          ))}
        </ul>
      ) : null}
      <p className="rf-footnote">All amounts in {pricing.currency}.</p>
    </Card>
  );
}
