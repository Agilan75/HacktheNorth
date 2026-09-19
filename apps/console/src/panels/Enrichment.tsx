import type { ReactElement } from 'react';

import { formatDate } from '@retrofit/contracts';

import { Badge } from '../components/atoms/Badge.js';
import type { EnrichmentCardView, EnrichmentPanelProps } from './types.js';

function EnrichmentCard(props: { readonly card: EnrichmentCardView }): ReactElement {
  const { card } = props;
  const titleId = `rf-enrichment-${card.source.replace(/[^a-zA-Z0-9]+/g, '-')}-title`;
  return (
    <li
      className={`rf-enrichment__card${card.available ? '' : ' rf-enrichment__card--unavailable'}`}
      data-testid={`enrichment-card-${card.source}`}
      data-available={card.available ? 'true' : 'false'}
      aria-labelledby={titleId}
    >
      <header className="rf-enrichment__header">
        <h3 id={titleId}>{card.title}</h3>{' '}
        <Badge
          label={card.available ? 'Available' : 'Unavailable'}
          tone={card.available ? 'quiet' : 'attention'}
        />
      </header>

      {card.available ? (
        card.rows.length > 0 ? (
          <dl className="rf-enrichment__rows">
            {card.rows.map((r, i) => (
              <div key={`${r.label}-${i}`} className="rf-stat">
                <dt>{r.label}</dt>
                <dd>{r.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="rf-empty">The source answered with no values for this location.</p>
        )
      ) : (
        <p className="rf-enrichment__reason" data-testid={`enrichment-reason-${card.source}`}>
          {card.unavailableReason !== null && card.unavailableReason.trim() !== ''
            ? card.unavailableReason
            : 'The source could not be reached.'}{' '}
          Broker values stand; nothing was imputed.
        </p>
      )}

      <p className="rf-footnote">
        <span>{`Source: ${card.source}`}</span>
        {card.fetchedAt !== null ? (
          <>
            {' · '}
            <time dateTime={card.fetchedAt} title={card.fetchedAt}>
              {`Fetched ${formatDate(card.fetchedAt)}`}
            </time>
          </>
        ) : null}
      </p>
    </li>
  );
}

/**
 * PRD 10 (j) Enrichment cards, including the unavailable ones.
 *
 * One card per plugin (PRD 8: flood zone via OpenFEMA, fire-station distance
 * via Overpass). A plugin that failed or timed out still gets a card that says
 * so; it is never hidden.
 */
export function Enrichment(props: EnrichmentPanelProps): ReactElement {
  const { cards } = props;
  if (cards.length === 0) {
    return (
      <div className="rf-panel rf-enrichment" data-testid="enrichment-panel">
        <p className="rf-empty">No enrichment has run for this submission yet.</p>
      </div>
    );
  }
  const available = cards.filter((c) => c.available).length;
  return (
    <div className="rf-panel rf-enrichment" data-testid="enrichment-panel">
      <p className="rf-enrichment__summary" data-testid="enrichment-summary">
        {`${available} of ${cards.length} ${cards.length === 1 ? 'source' : 'sources'} available`}
      </p>
      <ul className="rf-enrichment__cards" aria-label="Enrichment sources">
        {cards.map((card, i) => (
          <EnrichmentCard key={`${card.source}-${i}`} card={card} />
        ))}
      </ul>
      <p className="rf-footnote">
        Enriched values sit beside broker values with public-record provenance (confidence 0.9); they
        never overwrite them.
      </p>
    </div>
  );
}
