/** The query trace recorder (PRD §7.5 step 6). Body owned by Run 1 unit F10. */
import type {
  AdapterKind,
  AdaptationKind,
  FederatoErrorShape,
  PlannerClock,
  QueryOutcome,
  QueryPass,
  QueryPayload,
  QueryTraceEntry,
  TracePathChoice,
  TraceRuleNeed,
} from '../types';
import { OVER_DECLINED_NOTE } from './adapt';

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

interface OpenEntry {
  readonly id: string;
  readonly seq: number;
  readonly start: TraceStart;
  readonly payload: QueryPayload;
  readonly startedAt: string;
  readonly startMs: number;
  notes: string[];
  finished: {
    readonly rowCount: number;
    readonly totalAvailable: number | null;
    readonly durationMs: number;
    readonly error: FederatoErrorShape | null;
  } | null;
}

const UNFINISHED_ERROR: FederatoErrorShape = {
  code: 'UNFINISHED',
  message: 'The query was started but never reported a result.',
  httpStatus: null,
  raw: '',
};

function defaultClock(): PlannerClock {
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  return perf !== undefined ? () => perf.now() : () => Date.now();
}

function outcomeOf(rowCount: number, error: FederatoErrorShape | null): QueryOutcome {
  if (error !== null) return 'error';
  return rowCount > 0 ? 'ok' : 'empty';
}

function clonePayload(payload: QueryPayload): QueryPayload {
  return JSON.parse(JSON.stringify(payload)) as QueryPayload;
}

export function createTraceRecorder(options: TraceRecorderOptions): TraceRecorder {
  const clock = options.clock ?? defaultClock();
  const prefix = options.idPrefix ?? 'q';
  const baseIso = options.now ?? new Date().toISOString();
  const baseEpoch = Date.parse(baseIso);
  if (Number.isNaN(baseEpoch)) {
    throw new Error(`createTraceRecorder: "now" is not an ISO-8601 timestamp: ${baseIso}`);
  }
  const origin = clock();
  const open: OpenEntry[] = [];
  const byId = new Map<string, OpenEntry>();

  function get(id: string, op: string): OpenEntry {
    const entry = byId.get(id);
    if (entry === undefined) throw new Error(`trace.${op}: unknown trace id "${id}"`);
    return entry;
  }

  return {
    begin(start) {
      const seq = open.length;
      const id = `${prefix}-${String(seq).padStart(3, '0')}`;
      const startMs = clock();
      const offset = Math.max(0, Math.round(startMs - origin));
      const notes: string[] = [];
      if (start.payload.over !== undefined) notes.push(OVER_DECLINED_NOTE);
      const entry: OpenEntry = {
        id,
        seq,
        start,
        payload: clonePayload(start.payload),
        startedAt: new Date(baseEpoch + offset).toISOString(),
        startMs,
        notes,
        finished: null,
      };
      open.push(entry);
      byId.set(id, entry);
      return id;
    },

    finish(id, finish) {
      const entry = get(id, 'finish');
      if (entry.finished !== null) throw new Error(`trace.finish: "${id}" already finished`);
      if (!Number.isFinite(finish.rowCount) || finish.rowCount < 0) {
        throw new Error(`trace.finish: rowCount must be a non-negative number, got ${finish.rowCount}`);
      }
      const error = finish.error ?? null;
      entry.finished = {
        rowCount: finish.rowCount,
        totalAvailable: error !== null ? null : finish.totalAvailable,
        durationMs: Math.max(0, Math.round(clock() - entry.startMs)),
        error,
      };
      for (const n of finish.notes ?? []) if (!entry.notes.includes(n)) entry.notes.push(n);
    },

    note(id, note) {
      const entry = get(id, 'note');
      if (note.trim() === '' || entry.notes.includes(note)) return;
      entry.notes.push(note);
    },

    entries() {
      return open.map((e): QueryTraceEntry => {
        const f = e.finished;
        const error = f === null ? UNFINISHED_ERROR : f.error;
        const rowCount = f === null ? 0 : f.rowCount;
        return {
          id: e.id,
          seq: e.seq,
          pass: e.start.pass,
          goal: e.start.goal,
          requiredBy: [...e.start.requiredBy],
          pathChosen: e.start.pathChosen,
          payload: e.payload,
          rowCount,
          totalAvailable: f === null ? null : f.totalAvailable,
          durationMs: f === null ? 0 : f.durationMs,
          adapterKind: options.adapterKind,
          startedAt: e.startedAt,
          outcome: outcomeOf(rowCount, error),
          error,
          adaptedFrom: e.start.adaptedFrom ?? null,
          adaptation: e.start.adaptation ?? 'none',
          notes: [...e.notes],
        };
      });
    },
  };
}
