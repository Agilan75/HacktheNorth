/** Reference index over the six Federato PDFs. Body owned by Run 1 unit F06. */
import type { Citation } from '@retrofit/engine';

export interface ReferenceDocument {
  readonly file: string;
  readonly title: string;
  readonly pages: number;
  readonly summary: string;
}

export function referenceDocuments(): readonly ReferenceDocument[] {
  throw new Error('NOT_IMPLEMENTED:F06');
}

/** Resolves `{ doc, section }` to the transcribed quote, for citation checks. */
export function resolveCitation(_citation: Citation): string | null {
  throw new Error('NOT_IMPLEMENTED:F06');
}
