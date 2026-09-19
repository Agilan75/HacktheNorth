import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { truncateQuote } from '@retrofit/contracts';
/** Compact rows cut the quote here; the full text stays in the title attribute. */
const COMPACT_QUOTE_CHARS = 120;
function sourceLine(citation) {
    const parts = [citation.document];
    if (typeof citation.page === 'number')
        parts.push(`p. ${citation.page}`);
    if (citation.row)
        parts.push(`row ${citation.row}`);
    return parts.join(' · ');
}
/**
 * A quoted guideline row with its document, page and exact text.
 *
 * Stub frozen by W0-4. Unit C02 replaces this body only.
 */
export function CitationQuote(props) {
    const { citation, compact = false } = props;
    const quote = compact ? truncateQuote(citation.quote, COMPACT_QUOTE_CHARS) : citation.quote;
    const truncated = compact && quote !== citation.quote.trim().replace(/\s+/g, ' ');
    const source = sourceLine(citation);
    return (_jsxs("figure", { className: compact ? 'rf-citation rf-citation--compact' : 'rf-citation', children: [_jsx("blockquote", { className: "rf-citation__quote", title: truncated ? citation.quote : undefined, children: `“${quote}”` }), _jsx("figcaption", { className: "rf-citation__source", children: _jsx("cite", { children: source }) })] }));
}
//# sourceMappingURL=CitationQuote.js.map