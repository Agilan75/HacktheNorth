import type { ReactElement } from 'react';

import { truncateQuote } from '@retrofit/contracts';

import type { CitationView } from '../../panels/types.js';

export interface CitationQuoteProps {
  readonly citation: CitationView;
  readonly compact?: boolean;
}

/** Compact rows cut the quote here; the full text stays in the title attribute. */
const COMPACT_QUOTE_CHARS = 120;

function sourceLine(citation: CitationView): string {
  const parts: string[] = [citation.document];
  if (typeof citation.page === 'number') parts.push(`p. ${citation.page}`);
  if (citation.row) parts.push(`row ${citation.row}`);
  return parts.join(' · ');
}

/**
 * A quoted guideline row with its document, page and exact text.
 *
 * Stub frozen by W0-4. Unit C02 replaces this body only.
 */
export function CitationQuote(props: CitationQuoteProps): ReactElement {
  const { citation, compact = false } = props;
  const quote = compact ? truncateQuote(citation.quote, COMPACT_QUOTE_CHARS) : citation.quote;
  const truncated = compact && quote !== citation.quote.trim().replace(/\s+/g, ' ');
  const source = sourceLine(citation);
  return (
    <figure className={compact ? 'rf-citation rf-citation--compact' : 'rf-citation'}>
      <blockquote
        className="rf-citation__quote"
        title={truncated ? citation.quote : undefined}
      >
        {`“${quote}”`}
      </blockquote>
      <figcaption className="rf-citation__source">
        <cite>{source}</cite>
      </figcaption>
    </figure>
  );
}
