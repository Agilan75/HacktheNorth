/**
 * Turns a validated broker reply into `ExternalValue[]` with `answer`
 * provenance and reports what the underwriter still has to confirm.
 * Body owned by Run 1 unit F13.
 */
import type { CanonicalSubmission } from '@retrofit/engine';
import type { ReplyApplication, ScoreSnapshot, ValidatedFieldValue } from '../types';

export interface ApplyReplyInput {
  readonly submissionId: string;
  readonly sourceText: string;
  readonly validated: readonly ValidatedFieldValue[];
  readonly canonical: CanonicalSubmission;
  readonly before?: ScoreSnapshot | null;
}

export function applyReply(_input: ApplyReplyInput): ReplyApplication {
  throw new Error('NOT_IMPLEMENTED:F13');
}

/** Paths where the reply disagrees with what the broker first submitted. */
export function conflictingPaths(
  _validated: readonly ValidatedFieldValue[],
  _canonical: CanonicalSubmission,
): readonly string[] {
  throw new Error('NOT_IMPLEMENTED:F13');
}
