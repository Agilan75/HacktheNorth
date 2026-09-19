/**
 * Checks Gemini's `narrate` output polished the wording only: every number and
 * the recommendation must survive unchanged, or the template text is kept.
 * Body owned by Run 1 unit F12.
 */
import type { Explanation, NarrateGuardResult } from '../types';

export function narrateGuard(
  _explanation: Explanation,
  _polished: string,
): NarrateGuardResult {
  throw new Error('NOT_IMPLEMENTED:F12');
}

/** Pulls every number out of prose, normalized ($1.2M and 1200000 match). */
export function extractNumbers(_text: string): readonly number[] {
  throw new Error('NOT_IMPLEMENTED:F12');
}
