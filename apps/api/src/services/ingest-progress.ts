/**
 * Progress for an in-flight ingest run, so the console can show the agent
 * working instead of a spinner.
 *
 * `POST /ingest/federato` with `{"async": true}` returns a run id at once and
 * keeps going in the background; `GET /ingest/runs/:id` reports what has landed
 * so far. Each step is reported by the planner's own trace recorder the moment a
 * query finishes (`PlannerOptions.onQuery`), so every row count and duration
 * here is the real one — nothing is estimated or replayed.
 *
 * Deliberately a process-local `Map` and not a table: a run's progress is
 * meaningless once the run is over (the trace is stored on every submission
 * anyway), the API is a single long-running process, and a restart mid-run
 * should lose the progress rather than resurrect a run that is no longer
 * happening. Only the last `MAX_RUNS` runs are kept.
 */
import type { IngestResponseDto, IngestRunDto, IngestRunStepDto } from '@retrofit/contracts';
import type { QueryTraceEntry } from '@retrofit/federato';

/** Runs retained in memory. Small: nothing reads a run it did not just start. */
const MAX_RUNS = 5;

interface RunState {
  readonly id: string;
  readonly startedAt: string;
  readonly steps: IngestRunStepDto[];
  done: boolean;
  result: IngestResponseDto | null;
  error: string | null;
  finishedAt: string | null;
}

export interface IngestRunRecorder {
  readonly runId: string;
  /** Pass to `PlannerOptions.onQuery`. */
  readonly onQuery: (entry: QueryTraceEntry) => void;
  readonly succeed: (response: IngestResponseDto, nowIso: string) => void;
  readonly fail: (message: string, nowIso: string) => void;
}

const runs = new Map<string, RunState>();

/**
 * Drops the oldest runs once there are more than `MAX_RUNS`. Insertion order is
 * creation order, so the first keys are the oldest.
 */
function evict(): void {
  while (runs.size > MAX_RUNS) {
    const [oldest] = runs.keys();
    if (oldest === undefined) break;
    runs.delete(oldest);
  }
}

/**
 * One line per query, in the words the console shows. `rootResource` and
 * `goal` come straight off the plan, so the reason a query was chosen is
 * visible while it is still the newest thing on screen.
 */
function stepOf(entry: QueryTraceEntry): IngestRunStepDto {
  return {
    id: entry.id,
    seq: entry.seq,
    pass: entry.pass,
    goal: entry.goal,
    rootResource: entry.pathChosen.rootResource,
    rowCount: entry.rowCount,
    totalAvailable: entry.totalAvailable,
    durationMs: entry.durationMs,
    outcome: entry.outcome,
    adaptation: entry.adaptation,
    adaptedFrom: entry.adaptedFrom,
    error: entry.error === null ? null : entry.error.message,
  };
}

export function createIngestRun(runId: string, startedAt: string): IngestRunRecorder {
  const state: RunState = {
    id: runId,
    startedAt,
    steps: [],
    done: false,
    result: null,
    error: null,
    finishedAt: null,
  };
  runs.set(runId, state);
  evict();

  return {
    runId,
    onQuery: (entry) => {
      state.steps.push(stepOf(entry));
    },
    succeed: (response, nowIso) => {
      state.result = response;
      state.done = true;
      state.finishedAt = nowIso;
    },
    fail: (message, nowIso) => {
      state.error = message;
      state.done = true;
      state.finishedAt = nowIso;
    },
  };
}

/** `null` when the id is unknown — an old run that has been evicted, or a typo. */
export function readIngestRun(runId: string): IngestRunDto | null {
  const state = runs.get(runId);
  if (state === undefined) return null;
  return {
    runId: state.id,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    done: state.done,
    error: state.error,
    steps: [...state.steps],
    result: state.result,
  };
}

/** Test-only: forget every run so one test cannot see another's. */
export function resetIngestRuns(): void {
  runs.clear();
}
