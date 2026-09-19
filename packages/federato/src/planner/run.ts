/**
 * The planner end to end: schema -> graph -> collect -> locate -> plan ->
 * execute with adaptation -> bundles + trace. Body owned by Run 1 unit F11.
 */
import type { RatingTable, Rulebook, VectorSpec } from '@retrofit/engine';
import type {
  FederatoAdapter,
  PlannerOptions,
  PlannerResult,
} from '../types';

export interface RunPlannerInput {
  readonly adapter: FederatoAdapter;
  readonly spec: VectorSpec;
  readonly rulebook: Rulebook;
  readonly extensions?: Rulebook | undefined;
  readonly ratingTable?: RatingTable | undefined;
  readonly options?: PlannerOptions | undefined;
}

export function runPlanner(_input: RunPlannerInput): Promise<PlannerResult> {
  throw new Error('NOT_IMPLEMENTED:F11');
}

/** Step 5's "high-scoring accounts get one further query" pass. */
export function runFollowUps(
  _input: RunPlannerInput,
  _result: PlannerResult,
  _highScorerExternalIds: readonly string[],
): Promise<PlannerResult> {
  throw new Error('NOT_IMPLEMENTED:F11');
}
