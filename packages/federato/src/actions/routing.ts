/**
 * Route: the underwriter whose `region` matches the primary state and whose
 * `authority_limit` covers the requested limit. Nobody qualifies -> flagged
 * "needs referral to senior authority". Body owned by Run 1 unit F13.
 */
import type { RoutingDecision, UnderwriterRecord } from '../types';

export interface RoutingInput {
  readonly submissionId: string;
  readonly primaryState: string | null;
  readonly requestedLimit: number | null;
  readonly underwriters: readonly UnderwriterRecord[];
}

/** Maps a two-letter state code onto an underwriter `region` value. */
export function regionForState(_state: string): string | null {
  throw new Error('NOT_IMPLEMENTED:F13');
}

export function route(_input: RoutingInput): RoutingDecision {
  throw new Error('NOT_IMPLEMENTED:F13');
}
