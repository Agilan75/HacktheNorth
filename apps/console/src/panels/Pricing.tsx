import type { ReactElement } from 'react';

import { formatMoney, formatPercent, formatScore } from '@retrofit/contracts';

import { Badge } from '../components/atoms/Badge.js';
import { Card } from '../components/atoms/Card.js';
import type { PricingBuildingView, PricingFactorView, PricingPanelProps } from './types.js';

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

/** Per-building multipliers keep up to three decimals (×0.981), never fewer than two. */
function formatBuildingMultiplier(multiplier: number): string {
  if (!Number.isFinite(multiplier)) return '—';
  return `×${multiplier.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}`;
}

/** A base rate per $100 of TIV is a fraction of a dollar; show up to four decimals. */
function formatRate(rate: number): string {
  if (!Number.isFinite(rate)) return '—';
  return `$${rate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

/** Readable names for the engine's rating-factor keys (packages/engine/src/stages/price.ts). */
const FACTOR_LABEL: Readonly<Record<string, string>> = {
  construction: 'Construction',
  age: 'Age',
  protectionClass: 'Protection class',
  sprinkler: 'Sprinkler',
  lossHistory: 'Loss history',
};

function factorLabel(key: string): string {
  return FACTOR_LABEL[key] ?? key;
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
    <table className="rf-table" aria-label="Account-level factors">
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
            <th scope="row">{factorLabel(f.label)}</th>
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
 * R5-7: one row per building, TIV ÷ 100 × base rate × each multiplier = building
 * premium. Every figure is the DTO's own; the subtotal is not in the DTO and is
 * not shown.
 */
function BuildingTable(props: { readonly buildings: readonly PricingBuildingView[] }): ReactElement {
  const columns: string[] = [];
  for (const b of props.buildings) {
    for (const f of b.factors) if (!columns.includes(f.label)) columns.push(f.label);
  }
  return (
    <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
      <table className="rf-table" aria-label="Per-building rating">
        <thead>
          <tr>
            <th scope="col">Building</th>
            <th scope="col">TIV</th>
            <th scope="col">Base rate per $100</th>
            {columns.map((c) => (
              <th scope="col" key={c}>
                {factorLabel(c)}
              </th>
            ))}
            <th scope="col">Building premium</th>
          </tr>
        </thead>
        <tbody>
          {props.buildings.map((b, i) => (
            <tr key={`${b.buildingExternalId}-${i}`} data-testid="pricing-building">
              <th scope="row">{b.buildingExternalId}</th>
              <td>{formatMoney(b.tiv)}</td>
              <td>{formatRate(b.baseRate)}</td>
              {columns.map((c) => {
                const f = b.factors.find((x) => x.label === c);
                if (f === undefined) return <td key={c}>—</td>;
                return (
                  <td key={c}>
                    {formatBuildingMultiplier(f.multiplier)}
                    {f.input !== null && f.input !== '' ? (
                      <span className="rf-stat__hint">{` (${f.input})`}</span>
                    ) : null}
                  </td>
                );
              })}
              <td data-testid="pricing-building-premium">{formatMoney(b.premium, { decimals: 2 })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
      {pricing.buildings !== undefined && pricing.buildings.length > 0 ? (
        <>
          <p className="rf-footnote">
            Each building: TIV ÷ 100 × base rate × each multiplier = building premium. The
            account-level factors below then multiply the sum of the building premiums to give the
            predicted premium.
          </p>
          <BuildingTable buildings={pricing.buildings} />
          <h4 className="rf-card__subtitle">Account-level factors</h4>
        </>
      ) : null}
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
