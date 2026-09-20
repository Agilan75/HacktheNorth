import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { formatDate } from '@retrofit/contracts';
import { Badge } from '../components/atoms/Badge.js';
function EnrichmentCard(props) {
    const { card } = props;
    const titleId = `rf-enrichment-${card.source.replace(/[^a-zA-Z0-9]+/g, '-')}-title`;
    return (_jsxs("li", { className: `rf-enrichment__card${card.available ? '' : ' rf-enrichment__card--unavailable'}`, "data-testid": `enrichment-card-${card.source}`, "data-available": card.available ? 'true' : 'false', "aria-labelledby": titleId, children: [_jsxs("header", { className: "rf-enrichment__header", children: [_jsx("h3", { id: titleId, children: card.title }), ' ', _jsx(Badge, { label: card.available ? 'Available' : 'Unavailable', tone: card.available ? 'quiet' : 'attention' })] }), card.available ? (card.rows.length > 0 ? (_jsx("dl", { className: "rf-enrichment__rows", children: card.rows.map((r, i) => (_jsxs("div", { className: "rf-stat", children: [_jsx("dt", { children: r.label }), _jsx("dd", { children: r.value })] }, `${r.label}-${i}`))) })) : (_jsx("p", { className: "rf-empty", children: "The source answered with no values for this location." }))) : (_jsxs("p", { className: "rf-enrichment__reason", "data-testid": `enrichment-reason-${card.source}`, children: [card.unavailableReason !== null && card.unavailableReason.trim() !== ''
                        ? card.unavailableReason
                        : 'The source could not be reached.', ' ', "Broker values stand; nothing was imputed."] })), _jsxs("p", { className: "rf-footnote", children: [_jsx("span", { children: `Source: ${card.source}` }), card.fetchedAt !== null ? (_jsxs(_Fragment, { children: [' · ', _jsx("time", { dateTime: card.fetchedAt, title: card.fetchedAt, children: `Fetched ${formatDate(card.fetchedAt)}` })] })) : null] })] }));
}
/**
 * PRD 10 (j) Enrichment cards, including the unavailable ones.
 *
 * One card per plugin (PRD 8: flood zone via OpenFEMA, fire-station distance
 * via Overpass). A plugin that failed or timed out still gets a card that says
 * so; it is never hidden.
 */
export function Enrichment(props) {
    const { cards } = props;
    if (cards.length === 0) {
        return (_jsx("div", { className: "rf-panel rf-enrichment", "data-testid": "enrichment-panel", children: _jsx("p", { className: "rf-empty", children: "No enrichment has run for this submission yet." }) }));
    }
    const available = cards.filter((c) => c.available).length;
    return (_jsxs("div", { className: "rf-panel rf-enrichment", "data-testid": "enrichment-panel", children: [_jsx("p", { className: "rf-enrichment__summary", "data-testid": "enrichment-summary", children: `${available} of ${cards.length} ${cards.length === 1 ? 'source' : 'sources'} available` }), _jsx("ul", { className: "rf-enrichment__cards", "aria-label": "Enrichment sources", children: cards.map((card, i) => (_jsx(EnrichmentCard, { card: card }, `${card.source}-${i}`))) }), _jsx("p", { className: "rf-footnote", children: "Enriched values sit beside broker values with public-record provenance (confidence 0.9); they never overwrite them." })] }));
}
//# sourceMappingURL=Enrichment.js.map