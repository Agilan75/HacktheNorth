/**
 * The two validators that keep Gemini out of the numbers:
 *  - draft validator: every requested field appears, nothing else is asked for;
 *  - extraction validator: type, range, quote-exists and the 0.8 gate.
 * Body owned by Run 1 unit F13.
 */
import type { VectorSpec } from '@retrofit/engine';
import type {
  DraftValidation,
  ExtractedFieldValue,
  RequestSelection,
  ValidatedFieldValue,
} from '../types';

export function validateDraft(
  _selection: RequestSelection,
  _draft: string,
): DraftValidation {
  throw new Error('NOT_IMPLEMENTED:F13');
}

export interface ValidateExtractionInput {
  readonly extracted: readonly ExtractedFieldValue[];
  readonly requested: RequestSelection;
  readonly spec: VectorSpec;
  readonly sourceText: string;
}

export function validateExtraction(
  _input: ValidateExtractionInput,
): readonly ValidatedFieldValue[] {
  throw new Error('NOT_IMPLEMENTED:F13');
}
