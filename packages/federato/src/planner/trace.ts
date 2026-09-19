/** The query trace recorder (PRD §7.5 step 6). Body owned by Run 1 unit F10. */
import type {
  AdapterKind,
  AdaptationKind,
  FederatoErrorShape,
  PlannerClock,
  QueryPass,
  QueryPayload,
  QueryTraceEntry,
  TracePathChoice,
  TraceRuleNeed,
} from '../types';

export interface TraceStart {
  readonly pass: QueryPass;
  readonly goal: string;
  readonly requiredBy: readonly TraceRuleNeed[];
  readonly pathChosen: TracePathChoice;
  readonly payload: QueryPayload;
  readonly adaptedFrom?: string | null;
  readonly adaptation?: AdaptationKind;
}

export interface TraceFinish {
  readonly rowCount: number;
  readonly totalAvailable: number | null;
  readonly error?: FederatoErrorShape | null;
  readonly notes?: readonly string[];
}

export interface TraceRecorder {
  /** Returns the new entry's id; the timer starts now. */
  begin(start: TraceStart): string;
  finish(id: string, finish: TraceFinish): void;
  note(id: string, note: string): void;
  entries(): readonly QueryTraceEntry[];
}

export interface TraceRecorderOptions {
  readonly adapterKind: AdapterKind;
  readonly clock?: PlannerClock | undefined;
  /** ISO-8601 base stamp. Injected so traces are reproducible in tests. */
  readonly now?: string | undefined;
  /** Deterministic id prefix, e.g. the submission id or the run id. */
  readonly idPrefix?: string | undefined;
}

export function createTraceRecorder(_options: TraceRecorderOptions): TraceRecorder {
  throw new Error('NOT_IMPLEMENTED:F10');
}
