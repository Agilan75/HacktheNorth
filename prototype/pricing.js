// All dollar figures live here. The vision model returns severity only;
// this file is the single source of every number shown in the quote.

export const BASE_PREMIUM = 25; // $/mo placeholder base rate
export const SEVERITY_DELTA = { high: 9, medium: 4, low: 1.5 }; // $/mo
export const CONFIDENCE_THRESHOLD = 0.5; // below this a hazard is shown but not priced

export function priceQuote(hazards) {
  const lineItems = hazards.map((h) => {
    const applied = h.confidence >= CONFIDENCE_THRESHOLD;
    return {
      id: h.id,
      label: h.label,
      severity: h.severity,
      delta: applied ? SEVERITY_DELTA[h.severity] ?? 0 : 0,
      applied,
    };
  });
  const total = lineItems.reduce((sum, item) => sum + item.delta, BASE_PREMIUM);
  return { base: BASE_PREMIUM, lineItems, total };
}

export function contentsTotal(contents) {
  return contents.reduce((sum, c) => sum + (c.est_value || 0), 0);
}

export function formatUSD(amount) {
  const cents = Math.round(amount * 100) % 100 !== 0;
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: 2,
  });
}
