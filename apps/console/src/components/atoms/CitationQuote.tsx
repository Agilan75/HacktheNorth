import type { ReactElement } from 'react';

import type { CitationView } from '../../panels/types.js';

export interface CitationQuoteProps {
  readonly citation: CitationView;
  readonly compact?: boolean;
}

/**
 * A quoted guideline row with its document, page and exact text.
 *
 * Stub frozen by W0-4. Unit C02 replaces this body only.
 */
export function CitationQuote(_props: CitationQuoteProps): ReactElement {
  throw new Error('NOT_IMPLEMENTED:C02');
}
