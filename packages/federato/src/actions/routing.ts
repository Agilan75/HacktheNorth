/**
 * Route: the underwriter whose `region` matches the primary state and whose
 * `authority_limit` covers the requested limit. Nobody qualifies -> flagged
 * "needs referral to senior authority". Body owned by Run 1 unit F13.
 */
import { formatMoney } from '@retrofit/contracts';
import type { RoutingCandidate, RoutingDecision, UnderwriterRecord } from '../types';

export interface RoutingInput {
  readonly submissionId: string;
  readonly primaryState: string | null;
  readonly requestedLimit: number | null;
  readonly underwriters: readonly UnderwriterRecord[];
}

/**
 * State -> region. The live `Underwriter.region` values are West, Midwest,
 * South and Southeast (Broker adds Northeast); Federato publishes no mapping,
 * so this one is Retrofit's (docs/decisions/F13.md D-1). South is the
 * south-central block (TX, OK, AR, LA); Southeast is the rest of the old South.
 */
const REGION_STATES: Readonly<Record<string, readonly string[]>> = {
  West: ['AK', 'AZ', 'CA', 'CO', 'HI', 'ID', 'MT', 'NM', 'NV', 'OR', 'UT', 'WA', 'WY'],
  Midwest: ['IA', 'IL', 'IN', 'KS', 'MI', 'MN', 'MO', 'ND', 'NE', 'OH', 'SD', 'WI'],
  South: ['AR', 'LA', 'OK', 'TX'],
  Southeast: ['AL', 'FL', 'GA', 'KY', 'MS', 'NC', 'SC', 'TN', 'VA', 'WV'],
  Northeast: ['CT', 'DC', 'DE', 'MA', 'MD', 'ME', 'NH', 'NJ', 'NY', 'PA', 'RI', 'VT'],
};

const STATE_REGION: ReadonlyMap<string, string> = new Map(
  Object.entries(REGION_STATES).flatMap(([region, states]) => states.map((s) => [s, region] as const)),
);

/** Maps a two-letter state code onto an underwriter `region` value. */
export function regionForState(state: string): string | null {
  if (typeof state !== 'string') return null;
  // INTERPRETATIONS G-7: upper-case two-letter codes after trimming.
  return STATE_REGION.get(state.trim().toUpperCase()) ?? null;
}

function sameRegion(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function limitKnown(limit: number | null): limit is number {
  return typeof limit === 'number' && Number.isFinite(limit) && limit >= 0;
}

export function route(input: RoutingInput): RoutingDecision {
  const state =
    typeof input.primaryState === 'string' && input.primaryState.trim().length > 0
      ? input.primaryState.trim().toUpperCase()
      : null;
  const region = state === null ? null : regionForState(state);
  const limit = limitKnown(input.requestedLimit) ? input.requestedLimit : null;

  const ordered = [...input.underwriters].sort((a, b) => a.id - b.id);
  const candidates: RoutingCandidate[] = ordered.map((uw) => {
    const regionMatches = region !== null && sameRegion(uw.region, region);
    // "Covers" is inclusive: an authority limit equal to the request covers it.
    const authorityCovers = limit !== null && Number.isFinite(uw.authorityLimit) && uw.authorityLimit >= limit;
    const regionText = regionMatches
      ? `region ${uw.region} matches ${state ?? ''}`
      : region === null
        ? 'primary state has no known region'
        : `region ${uw.region} is not ${region}`;
    const authorityText =
      limit === null
        ? 'requested limit is unknown'
        : authorityCovers
          ? `authority ${formatMoney(uw.authorityLimit)} covers ${formatMoney(limit)}`
          : `authority ${formatMoney(uw.authorityLimit)} is below ${formatMoney(limit)}`;
    return {
      underwriter: uw,
      regionMatches,
      authorityCovers,
      reason: `${regionText}; ${authorityText}.`,
    };
  });

  // Among the qualified, the tightest authority that still covers the limit
  // keeps larger authority free; ties go to the lower id.
  const qualified = candidates
    .filter((c) => c.regionMatches && c.authorityCovers)
    .sort((a, b) => a.underwriter.authorityLimit - b.underwriter.authorityLimit || a.underwriter.id - b.underwriter.id);
  const assigned = qualified[0]?.underwriter ?? null;

  let reason: string;
  if (assigned !== null) {
    reason = `Assigned to ${assigned.name} (${assigned.region}): the region matches ${state ?? ''} and authority ${formatMoney(
      assigned.authorityLimit,
    )} covers the requested ${formatMoney(limit)}.`;
  } else if (state === null) {
    reason = 'Needs referral to senior authority: the primary state is unknown, so no region can be matched.';
  } else if (region === null) {
    reason = `Needs referral to senior authority: ${state} maps to no underwriter region.`;
  } else if (limit === null) {
    reason = 'Needs referral to senior authority: the requested limit is unknown, so no authority can be shown to cover it.';
  } else {
    const inRegion = candidates.filter((c) => c.regionMatches);
    if (inRegion.length === 0) {
      reason = `Needs referral to senior authority: no underwriter covers the ${region} region (${state}).`;
    } else {
      const top = Math.max(...inRegion.map((c) => c.underwriter.authorityLimit));
      reason = `Needs referral to senior authority: the requested ${formatMoney(limit)} exceeds every ${region} underwriter's authority (highest ${formatMoney(
        top,
      )}).`;
    }
  }

  return {
    submissionId: input.submissionId,
    primaryState: state,
    requestedLimit: limit,
    assigned,
    needsSeniorReferral: assigned === null,
    reason,
    candidates,
  };
}
