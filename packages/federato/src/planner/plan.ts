/**
 * Step 4 of PRD §7.5: the two-pass plan.
 *
 * TRIAGE  — one cheap `Submission` query selecting id, status and line of
 *           business. 120 of 158 are knocked out on line of business.
 * DEEP    — one `Policy` query (NOT a `Submission` query) that expands
 *           `submission`, `insured`, `claims` and
 *           `exposure_units.location.buildings`. `Submission` carries no
 *           premium, TIV, state, construction or building field and no reverse
 *           reference to `Policy`, so rooting the deep pass there returns
 *           nothing scoreable (LIVE_DATA_FACTS.md).
 * NO-POLICY — the 11 property submissions without a policy get their own
 *           `Submission -> insured -> hq` follow-up and resolve to REFER.
 *
 * Body owned by Run 1 unit F09.
 */
import type { LineOfBusiness } from '@retrofit/engine';
import type {
  DeepPlan,
  FollowUpPlan,
  LocateResult,
  NoPolicyPlan,
  QueryPlan,
  TriageKnockout,
  TriagePlan,
  TriageSurvivor,
} from '../types';

export interface PlanInput {
  readonly locate: LocateResult;
  readonly lineOfBusiness: LineOfBusiness;
  readonly pageLimit?: number | undefined;
}

export function planTriage(_input: PlanInput): TriagePlan {
  throw new Error('NOT_IMPLEMENTED:F09');
}

/** Splits the triage rows into knockouts and survivors, recording the reason. */
export function triageRows(
  _rows: readonly Readonly<Record<string, unknown>>[],
  _input: PlanInput,
): {
  readonly knockedOut: readonly TriageKnockout[];
  readonly survivors: readonly TriageSurvivor[];
} {
  throw new Error('NOT_IMPLEMENTED:F09');
}

/** The verified one-call hydrated Policy query. Never rooted at `Submission`. */
export function planDeep(
  _survivors: readonly TriageSurvivor[],
  _input: PlanInput,
): DeepPlan | null {
  throw new Error('NOT_IMPLEMENTED:F09');
}

/** Survivors with no policy row after the deep pass. */
export function planNoPolicy(
  _survivors: readonly TriageSurvivor[],
  _hydratedExternalIds: readonly string[],
  _input: PlanInput,
): NoPolicyPlan | null {
  throw new Error('NOT_IMPLEMENTED:F09');
}

/** Step 5's extra query for accounts that scored well. */
export function planFollowUps(
  _highScorerExternalIds: readonly string[],
  _input: PlanInput,
): readonly FollowUpPlan[] {
  throw new Error('NOT_IMPLEMENTED:F09');
}

export function buildPlan(_input: PlanInput): QueryPlan {
  throw new Error('NOT_IMPLEMENTED:F09');
}
