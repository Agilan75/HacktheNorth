/** The VOI question loop, with the skipped counter and its reasons. Unit A18. */
import type {
  NextQuestionResponseDto,
  SweepAnswersRequestDto,
  SweepDto,
} from '@retrofit/contracts';
import { MIN_OBSERVATION_CONFIDENCE, SOURCE_CONFIDENCE, math } from '@retrofit/engine';
import type { Observation, Question } from '@retrofit/engine';
import { createRepos } from '../db/repos';
import type { SweepRow } from '../db/schema';
import {
  askedQuestionIdsOf,
  loadTenantConfig,
  scoreSweep,
  sessionOf,
  toSweepDto,
} from './sweep';
import type { AnswerEvent, SessionEvent } from './sweep';
import type { Deps } from './types';

/** Confidence a sighting takes once the user confirms it: the user-answer source value. */
const CONFIRMED_CONFIDENCE = SOURCE_CONFIDENCE.answer ?? 0.8;

/** Stages at which a result exists and answers can re-score it. */
const SCORED_STAGES: ReadonlySet<SweepDto['stage']> = new Set(['scoring', 'questions', 'done']);

function loadRow(deps: Deps, sweepId: string): SweepRow {
  const row = createRepos(deps.db).sweeps.byId(sweepId);
  if (row === null) throw new Error(`no sweep "${sweepId}"`);
  return row;
}

function isPending(o: Observation): boolean {
  return o.derived !== true && math.clamp01(o.confidence) < MIN_OBSERVATION_CONFIDENCE;
}

/* -------------------------------------------------------------------------- */
/* Answer coercion — code checks every value against the question             */
/* -------------------------------------------------------------------------- */

const YES = new Set(['yes', 'y', 'true', '1']);
const NO = new Set(['no', 'n', 'false', '0']);

/** The typed value an answer carries, or null when it does not fit the question. */
function coerce(question: Question, value: string | number | boolean | null): string | number | boolean | null {
  if (value === null) return null;
  switch (question.inputType) {
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : null;
      const s = value.trim().toLowerCase();
      return YES.has(s) ? true : NO.has(s) ? false : null;
    }
    case 'number': {
      const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
      if (typeof value === 'string' && value.trim() === '') return null;
      return Number.isFinite(n) && n >= 0 ? n : null;
    }
    case 'single_select': {
      const options = question.options ?? [];
      const hit = options.find((o) => String(o.value) === String(value));
      return hit === undefined ? null : (hit.value as string | number | boolean);
    }
    default: {
      if (typeof value === 'string') return value.trim() === '' ? null : value.trim();
      return value;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Service                                                                    */
/* -------------------------------------------------------------------------- */

export async function nextQuestion(deps: Deps, sweepId: string): Promise<NextQuestionResponseDto> {
  const row = loadRow(deps, sweepId);
  const result = row.result ?? null;
  const asked = askedQuestionIdsOf(sessionOf(result));
  if (result === null) {
    // Not scored yet: nothing to ask, and not done either.
    return { question: null, askedCount: asked.length, skipped: [], done: row.stage === 'failed' };
  }
  const pending = row.observations.some(isPending);
  const question = result.voi.nextQuestion;
  return {
    question,
    askedCount: asked.length,
    skipped: result.voi.skipped.map((s) => ({ field: s.field, reason: s.reason })),
    done: question === null && !pending,
  };
}

export async function submitAnswers(
  deps: Deps,
  sweepId: string,
  request: SweepAnswersRequestDto,
): Promise<SweepDto> {
  const repos = createRepos(deps.db);
  const row = loadRow(deps, sweepId);
  const now = deps.clock.nowIso();

  // Confirmations (PRD 9.3 step 7): confirmed sightings rise to the user-answer
  // confidence; dismissed sightings go, with any relate hazard that leaned on them.
  let observations: readonly Observation[] = row.observations;
  const confirmations = request.confirmations ?? [];
  if (confirmations.length > 0) {
    const confirmed = new Set(confirmations.filter((c) => c.confirmed).map((c) => c.observationId));
    const dismissed = new Set(confirmations.filter((c) => !c.confirmed).map((c) => c.observationId));
    observations = observations
      .filter((o) => !dismissed.has(o.id))
      .filter((o) => {
        if (!o.id.startsWith('relate:')) return true;
        const ids = o.id.split(':')[3] ?? '';
        return ids.split('+').every((id) => !dismissed.has(id));
      })
      .map((o) =>
        confirmed.has(o.id) && o.derived !== true
          ? { ...o, confidence: Math.max(math.clamp01(o.confidence), CONFIRMED_CONFIDENCE) }
          : o,
      );
  }

  const scored = SCORED_STAGES.has(row.stage) && row.result !== null && row.result !== undefined;
  if (!scored) {
    if (request.answers.length > 0) {
      throw new Error(`sweep "${sweepId}" is at stage "${row.stage}" and cannot take answers yet`);
    }
    const saved = repos.sweeps.update(sweepId, { observations, updatedAt: now });
    return toSweepDto(saved);
  }

  const { questions } = await loadTenantConfig();
  const byId = new Map(questions.map((q) => [q.id, q] as const));
  const events: SessionEvent[] = sessionOf(row.result ?? null);
  for (const a of request.answers) {
    const question = byId.get(a.questionId);
    if (question === undefined) continue;
    const skipped = a.skipped === true;
    const event: AnswerEvent = {
      kind: 'answer',
      questionId: question.id,
      field: question.field,
      value: skipped ? null : coerce(question, a.value),
      skipped,
      at: now,
    };
    events.push(event);
  }

  const withObservations: SweepRow = { ...row, observations: [...observations] };
  const { result, stage } = await scoreSweep(deps, withObservations, events);
  const saved = repos.sweeps.update(sweepId, {
    observations,
    result,
    stage,
    error: null,
    updatedAt: now,
  });
  return toSweepDto(saved);
}
