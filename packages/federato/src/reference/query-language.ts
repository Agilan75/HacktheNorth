/**
 * Notes transcribed from QUERY_REQUEST_BODY.pdf, so the mock and the planner
 * can be checked against the document. Body owned by Run 1 unit F06.
 */
import type { QueryStage } from '../types';

export interface QueryLanguageNote {
  readonly id: string;
  readonly stage: QueryStage | 'operators' | 'combinators' | 'references';
  readonly title: string;
  readonly quote: string;
  readonly page: number;
  /** How Retrofit implements it, or why it deviates (e.g. `over` is never emitted). */
  readonly implementation: string;
}

export function queryLanguageNotes(): readonly QueryLanguageNote[] {
  throw new Error('NOT_IMPLEMENTED:F06');
}
