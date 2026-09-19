/**
 * Request: code picks the fields (Gemini only drafts the wording).
 * Triggers are REFER for missing data, an open HIGH contradiction, or an
 * account one flip from FIT. Body owned by Run 1 unit F13.
 */
import type { EngineResult } from '@retrofit/engine';
import type {
  BrokerRecord,
  ContactRecord,
  RequestSelection,
} from '../types';

export interface RequestSelectionInput {
  readonly submissionId: string;
  readonly result: EngineResult;
  readonly insuredName?: string | null;
  readonly broker?: BrokerRecord | null;
  readonly contact?: ContactRecord | null;
}

export function selectRequest(_input: RequestSelectionInput): RequestSelection {
  throw new Error('NOT_IMPLEMENTED:F13');
}
