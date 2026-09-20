import type { ReactElement } from 'react';
import type { EnrichmentPanelProps } from './types.js';
/**
 * PRD 10 (j) Enrichment cards, including the unavailable ones.
 *
 * One card per plugin (PRD 8: flood zone via OpenFEMA, fire-station distance
 * via Overpass). A plugin that failed or timed out still gets a card that says
 * so; it is never hidden.
 */
export declare function Enrichment(props: EnrichmentPanelProps): ReactElement;
//# sourceMappingURL=Enrichment.d.ts.map