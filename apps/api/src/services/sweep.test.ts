/**
 * A18 — the sweep pipeline, the VOI loop and verify-fix, end to end against
 * `:memory:` SQLite, real sharp-generated frames, the real tenant spec,
 * rulebook, rating table and questions, the real engine and the deterministic
 * fake LLM. `runEngine` is wrapped (not replaced) so every test can assert the
 * exact facts this unit hands the engine.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SweepCreateRequestDto, SweepDto } from '@retrofit/contracts';
import { nextQuestionResponseSchema, sweepSchema } from '@retrofit/contracts';
import type { EngineInput, ExternalValue } from '@retrofit/engine';
import type { FederatoAdapter } from '@retrofit/federato';
import { createDb } from '../db/client';
import type { DbHandle } from '../db/client';
import { migrate } from '../db/migrate';
import { createFakeLlm } from '../llm/fake-provider';
import type { FakeLlmOptions } from '../llm/fake-provider';
import type { AnyGenerateJsonRequest } from '../llm/types';
import { nextQuestion, submitAnswers } from './questions';
import { FRAME_FOV_DEG, advanceSweep, createSweep, getSweep } from './sweep';
import { fixedClock } from './types';
import type { Deps } from './types';
import { verifyFix } from './verify-fix';

/* The engine's JSON loaders belong to E13; the test reads the same files directly. */
function engineJson(rel: string): unknown {
  const url = new URL(`../../../../packages/engine/${rel}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
}

const engineInputs = vi.hoisted(() => [] as EngineInput[]);

vi.mock('@retrofit/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@retrofit/engine')>();
  return {
    ...actual,
    runEngine: (input: EngineInput, config: Parameters<typeof actual.runEngine>[1]) => {
      engineInputs.push(input);
      return actual.runEngine(input, config);
    },
    readVectorSpec: () => Promise.resolve(engineJson('vectors/tenant.json')),
    readRulebook: () => Promise.resolve(engineJson('rules/tenant.json')),
    readRatingTable: () => Promise.resolve(engineJson('rating/tenant.json')),
    readQuestions: () =>
      Promise.resolve((engineJson('questions/tenant.json') as { questions: unknown[] }).questions),
  };
});

/** The sweep facts of the last engine run, by canonical path. */
function lastSweepFacts(): Map<string, ExternalValue> {
  const input = engineInputs[engineInputs.length - 1]!;
  return new Map((input.enrichment ?? []).map((v) => [v.canonicalPath, v] as const));
}

function lastAnswers(): readonly ExternalValue[] {
  return engineInputs[engineInputs.length - 1]!.answers ?? [];
}

const NOW = '2026-09-19T12:00:00.000Z';

const adapter: FederatoAdapter = {
  kind: 'mock',
  getSchema: () => Promise.reject(new Error('unused')),
  query: () => Promise.reject(new Error('unused')),
  getGuidelines: () => Promise.reject(new Error('unused')),
  getGlossary: () => Promise.reject(new Error('unused')),
};

/* -------------------------------------------------------------------------- */
/* Frames                                                                     */
/* -------------------------------------------------------------------------- */

/** A sharp, mid-exposure textured frame whose low-frequency layout depends on `seed`. */
async function frameJpeg(seed: number): Promise<string> {
  const w = 640;
  const h = 480;
  const buf = Buffer.alloc(w * h * 3);
  let s = (seed * 7919 + 17) >>> 0;
  const cell = 40 + (seed % 5) * 24;
  const angle = (seed * 47) % 360;
  const cos = Math.cos((angle * Math.PI) / 180);
  const sin = Math.sin((angle * Math.PI) / 180);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const noise = (s >>> 24) - 128;
      const grad = ((x - w / 2) * cos + (y - h / 2) * sin) / w;
      const checker = ((Math.floor((x + seed * 13) / cell) + Math.floor((y + seed * 29) / cell)) % 2) * 50;
      const v = Math.max(20, Math.min(235, 100 + Math.round(grad * 90) + checker + Math.round(noise * 0.3)));
      const i = (y * w + x) * 3;
      buf[i] = v;
      buf[i + 1] = Math.max(20, v - 10);
      buf[i + 2] = Math.min(235, v + 10);
    }
  }
  const jpeg = await sharp(buf, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
  return jpeg.toString('base64');
}

async function blackJpeg(): Promise<string> {
  const out = await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .jpeg()
    .toBuffer();
  return out.toString('base64');
}

/* -------------------------------------------------------------------------- */
/* The fake `observe`                                                          */
/* -------------------------------------------------------------------------- */

interface Obj {
  label: string;
  box_2d: [number, number, number, number];
  distanceBand: 'near' | 'mid' | 'far';
  confidence: number;
  notes: string;
}

const HEATER: Obj = { label: 'portable_heater', box_2d: [620, 140, 880, 360], distanceBand: 'near', confidence: 0.86, notes: 'free-standing electric heater' };
const CURTAIN: Obj = { label: 'curtain', box_2d: [120, 180, 720, 340], distanceBand: 'near', confidence: 0.81, notes: 'floor-length curtain' };
const DETECTOR: Obj = { label: 'smoke_detector', box_2d: [40, 460, 120, 560], distanceBand: 'far', confidence: 0.74, notes: 'ceiling detector' };
const CANDLE: Obj = { label: 'candle', box_2d: [500, 480, 560, 520], distanceBand: 'mid', confidence: 0.9, notes: 'lit candle on the shelf' };

/** Frame index -> objects, per run. Frames 1..5 see the ceiling (5 of 8 >= 50%). */
function observeAnswer(frameIndices: readonly number[], run: 0 | 1) {
  return {
    frames: frameIndices.map((index) => {
      const objects: Obj[] = [];
      if (index === 0) objects.push(HEATER, CURTAIN);
      if (index === 1) objects.push(DETECTOR);
      if (index === 2 && run === 0) objects.push(CANDLE); // seen once -> halved
      return {
        index,
        usable: true,
        reason: 'clear view',
        ceilingVisible: index >= 1 && index <= 5,
        objects,
      };
    }),
  };
}

function frameIndicesOf(request: AnyGenerateJsonRequest): number[] {
  const out: number[] = [];
  for (const part of request.parts ?? []) {
    if (part.kind !== 'text') continue;
    const m = /Frame index=(\d+)/.exec(part.text);
    if (m) out.push(Number(m[1]));
  }
  return out.sort((a, b) => a - b);
}

function llmWith(extra: FakeLlmOptions = {}) {
  let observeRuns = 0;
  return createFakeLlm({
    ...extra,
    handler: (request) => {
      if (request.callName === 'observe') {
        const run = (observeRuns++ % 2) as 0 | 1;
        return observeAnswer(frameIndicesOf(request), run);
      }
      return extra.handler?.(request);
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

let handle: DbHandle;

beforeEach(() => {
  handle = createDb({ url: ':memory:' });
  migrate(handle);
});
afterEach(() => handle.close());

function depsWith(llm = llmWith()): Deps {
  return { db: handle.db, adapter, llm, clock: fixedClock(NOW) };
}

async function eightFrameRequest(): Promise<SweepCreateRequestDto> {
  const frames = [];
  for (let i = 0; i < 8; i++) {
    frames.push({ bearingDeg: i * 45, capturedAt: NOW, imageBase64: await frameJpeg(i + 1) });
  }
  return { roomLabel: 'Bedroom', termMonths: 12, frames };
}

async function driveToRest(deps: Deps, sweep: SweepDto): Promise<SweepDto[]> {
  const seen: SweepDto[] = [];
  let current = sweep;
  for (let i = 0; i < 10 && !['questions', 'done', 'failed'].includes(current.stage); i++) {
    current = await advanceSweep(deps, current.id);
    seen.push(current);
  }
  return seen;
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

beforeEach(() => {
  engineInputs.length = 0;
});

describe('sweep pipeline', () => {
  it('drives received -> quality_gate -> observing -> relating -> scoring -> questions', async () => {
    const deps = depsWith();
    const created = await createSweep(deps, await eightFrameRequest());
    expect(created.stage).toBe('received');
    expect(created.result).toBeNull();
    expect(sweepSchema.safeParse(created).success).toBe(true);

    const stages = (await driveToRest(deps, created)).map((s) => s.stage);
    expect(stages).toEqual(['quality_gate', 'observing', 'relating', 'scoring', 'questions']);

    const sweep = (await getSweep(deps, created.id))!;
    expect(sweepSchema.safeParse(sweep).success).toBe(true);
    expect(sweep.error).toBeNull();

    // Quality gate: all eight distinct, sharp frames pass and are re-encoded.
    expect(sweep.frames.filter((f) => f.dropped)).toEqual([]);
    for (const f of sweep.frames) {
      expect(f.quality).toBeGreaterThanOrEqual(0.4);
      expect(f.imageRef?.startsWith('data:image/jpeg;base64,')).toBe(true);
    }

    // Eight frames 45° apart at a 60° FOV cover all 36 panels.
    expect(FRAME_FOV_DEG).toBe(60);
    expect(sweep.coverage?.coveragePct).toBe(100);
    expect(sweep.coverage?.sufficient).toBe(true);

    // Self-consistency: seen in both runs keeps confidence; seen once is halved.
    const byLabel = (label: string) => sweep.observations.find((o) => o.label === label && o.derived !== true)!;
    expect(byLabel('portable_heater')).toMatchObject({ id: 'obs-1', confidence: 0.86, runsSeen: 2 });
    expect(byLabel('curtain')).toMatchObject({ id: 'obs-2', confidence: 0.81, runsSeen: 2 });
    expect(byLabel('smoke_detector')).toMatchObject({ id: 'obs-3', confidence: 0.74, runsSeen: 2 });
    expect(byLabel('candle').confidence).toBeCloseTo(0.45, 12);
    expect(byLabel('candle').runsSeen).toBe(1);
    // Box centre x = 250/1000 is 15° left of centre on a 60° frame at bearing 0.
    expect(byLabel('portable_heater').bearingDeg).toBeCloseTo(345, 9);
    // Frame 1 is at 45°; the detector's box centre x = 510 -> +0.6°.
    expect(byLabel('smoke_detector').bearingDeg).toBeCloseTo(45.6, 9);

    // The halved candle is still reported as low-confidence, but it no longer
    // holds the sweep open: nothing asks the renter to confirm it. The one
    // stage left is the single optional question, which is the year built.
    expect(sweep.needsConfirmation.map((o) => o.id)).toEqual([byLabel('candle').id]);
    expect(sweep.stage).toBe('questions');
    expect(sweep.result!.voi.nextQuestion?.id).toBe('q-year-built');

    // One ceiling marker per ceiling-visible frame (frames 1..5 of 8 = 0.625).
    expect(sweep.observations.filter((o) => o.id.startsWith('ceiling:')).map((o) => o.frameIndex)).toEqual([1, 2, 3, 4, 5]);
    // relate's hazard is kept as a derived observation naming its support.
    expect(sweep.observations.filter((o) => o.id.startsWith('relate:')).map((o) => [o.id, o.confidence])).toEqual([
      ['relate:heaterNearCombustible:present:obs-1+obs-2', 0.78],
    ]);

    // The facts handed to the engine.
    const facts = lastSweepFacts();
    // relate re-stated the engine pair (0.86 × 0.81 = 0.6966) at its own 0.78.
    expect(facts.get('hazards.heaterNearCombustible')).toMatchObject({
      value: true,
      provenance: { source: 'sweep', sourceDetail: 'relate:obs-1+obs-2', confidence: 0.78 },
    });
    expect(facts.get('hazards.portableHeater')).toMatchObject({ value: true, provenance: { confidence: 0.86 } });
    expect(facts.get('hazards.smokeDetectorCount')).toMatchObject({ value: 1, provenance: { confidence: 0.74 } });
    // A 100% sweep records an unseen stove as absent at coverage confidence 1.
    expect(facts.get('hazards.stove')).toMatchObject({ value: false, provenance: { confidence: 1 } });
    // The halved candle is scored at its own confidence rather than held out:
    // with no confirmation step, holding it out would record "no candle".
    expect(facts.get('hazards.candle')).toMatchObject({ value: true });
    expect(facts.get('hazards.candle')?.provenance.confidence).toBeCloseTo(0.45, 12);
    expect(facts.get('hazards.ceilingObserved')?.value).toBe(true);
    // Contents are derived from the sweep, never asked: nothing was priced here,
    // so the limit sits on the $15,000 floor.
    expect(facts.get('exposure.contentsLimit')).toMatchObject({
      value: 15_000,
      provenance: { source: 'sweep' },
    });
    // Observations never reach merge directly (no double counting), and asOf is the clock's day.
    const input = engineInputs[engineInputs.length - 1]!;
    expect(input.observations).toEqual([]);
    expect(input.asOf).toBe('2026-09-19');
    expect(input.submission).toMatchObject({ id: created.id, lineOfBusiness: 'tenant' });
    expect(input.submission.exposure.termMonths?.[0]).toMatchObject({ value: 12, provenance: { source: 'self_reported' } });

    // The stored result is the engine's, with merge having written those facts.
    const result = sweep.result!;
    expect(result.canonical.hazards.present.heaterNearCombustible?.map((f) => f.value)).toEqual([true]);
    expect(result.canonical.hazards.present.candle?.map((f) => f.value)).toEqual([true]);
    expect(result.canonical.exposure.contentsLimit?.map((f) => f.value)).toEqual([15_000]);
    expect(result.voi.askedCount).toBe(0);
    expect(sweep.skippedCount).toBe(result.voi.skipped.length);
  });

  it('marks the sweep failed when no frame passes the quality gate, and drops a duplicate frame', async () => {
    const deps = depsWith();
    const dark = await blackJpeg();
    const failed = await createSweep(deps, {
      roomLabel: 'Hall',
      termMonths: 4,
      frames: [
        { bearingDeg: 0, capturedAt: NOW, imageBase64: dark },
        { bearingDeg: 90, capturedAt: NOW, imageBase64: dark },
      ],
    });
    const after = await advanceSweep(deps, failed.id);
    expect(after.stage).toBe('failed');
    expect(after.error).toMatch(/quality/);
    expect(after.frames.every((f) => f.dropped && f.imageRef === null)).toBe(true);
    // A failed sweep does not advance further.
    expect((await advanceSweep(deps, failed.id)).stage).toBe('failed');

    const same = await frameJpeg(3);
    const dup = await createSweep(deps, {
      roomLabel: 'Hall',
      termMonths: 4,
      frames: [
        { bearingDeg: 0, capturedAt: NOW, imageBase64: same },
        { bearingDeg: 30, capturedAt: NOW, imageBase64: same },
      ],
    });
    const gated = await advanceSweep(deps, dup.id);
    expect(gated.stage).toBe('quality_gate');
    expect(gated.frames[0]!.dropped).toBe(false);
    expect(gated.frames[1]).toMatchObject({ dropped: true, dropReason: 'duplicate' });
    // Coverage counts only the kept frame: 60° = 6 of 36 panels.
    expect(gated.coverage?.coveragePct).toBeCloseTo((6 * 100) / 36, 9);
    expect(gated.coverage?.sufficient).toBe(false);
  });

  it('on an insufficient sweep still records unseen hazards absent, at the covered fraction', async () => {
    const deps = depsWith();
    const req = await eightFrameRequest();
    // Frames 0 and 1 only: [-30°, 30°) and [15°, 75°) -> panels 33..35 + 0..7 = 11 of 36.
    const created = await createSweep(deps, { ...req, frames: req.frames.slice(0, 2) });
    await driveToRest(deps, created);
    const sweep = (await getSweep(deps, created.id))!;
    expect(sweep.coverage?.coveragePct).toBeCloseTo((11 * 100) / 36, 9);
    expect(sweep.coverage?.sufficient).toBe(false);
    const facts = lastSweepFacts();
    // Nothing asks the renter about what the camera looked at, so a slot the
    // sweep could not settle is recorded absent at the confidence the engine
    // gives its own negative evidence: the fraction of the room covered.
    expect(facts.get('hazards.stove')).toMatchObject({ value: false });
    expect(facts.get('hazards.stove')?.provenance.confidence).toBeCloseTo(11 / 36, 9);
    expect(facts.get('hazards.stove')?.provenance.sourceDetail).toMatch(/^unseen:coverage=/);
    expect(facts.get('hazards.portableHeater')?.value).toBe(true);
    // The smoke detector's zero rides the same rule, as a count rather than a flag.
    expect(facts.get('hazards.smokeDetectorCount')?.value).toBe(1);
    // Not one hazard question survives, even on a sweep this short: the only
    // thing left to ask about is the year built, which no camera can see.
    const askable = sweep.result!.voi.ranked.map((c) => c.question.id);
    expect(askable.filter((id) => id.startsWith('q-') && id !== 'q-year-built')).toEqual([]);
  });

  it('derives the contents limit from the sweep, rounded up to $5,000 over a $15,000 floor', async () => {
    const deps = depsWith();
    const req = await eightFrameRequest();
    const created = await createSweep(deps, { ...req, contentsEstimateUsd: 21_300 });
    await driveToRest(deps, created);
    const facts = lastSweepFacts();
    expect(facts.get('exposure.contentsLimit')).toMatchObject({
      value: 25_000,
      provenance: { source: 'sweep', sourceDetail: 'contents:21300' },
    });
    // The estimate survives the observe stage, which replaces the observation list.
    const sweep = (await getSweep(deps, created.id))!;
    expect(sweep.observations.some((o) => o.id === 'contents:21300')).toBe(true);
  });

  it('defaults the room label and the term when the phone sends neither', async () => {
    const deps = depsWith();
    const req = await eightFrameRequest();
    const { roomLabel: _label, termMonths: _term, ...bare } = req;
    const created = await createSweep(deps, bare);
    expect(created.roomLabel).toBe('Room');
    expect(created.termMonths).toBe(12);
  });

  it('fails the sweep with the stage named when the observe call errors', async () => {
    const deps = depsWith(createFakeLlm({ failFor: ['observe'] }));
    const created = await createSweep(deps, await eightFrameRequest());
    const seen = await driveToRest(deps, created);
    expect(seen.map((s) => s.stage)).toEqual(['quality_gate', 'failed']);
    expect(seen[1]!.error).toMatch(/^quality_gate: /);
  });
});

describe('questions and verify-fix', () => {
  async function scoredSweep(deps: Deps): Promise<SweepDto> {
    const created = await createSweep(deps, await eightFrameRequest());
    const seen = await driveToRest(deps, created);
    return seen[seen.length - 1]!;
  }

  it('refuses answers before the sweep is scored', async () => {
    const deps = depsWith();
    const created = await createSweep(deps, await eightFrameRequest());
    await expect(
      submitAnswers(deps, created.id, {
        answers: [{ questionId: 'q-year-built', field: 'buildings[0].yearBuilt', value: 1995 }],
      }),
    ).rejects.toThrow(/cannot take answers/);
    const next = await nextQuestion(deps, created.id);
    expect(next).toEqual({ question: null, askedCount: 0, skipped: [], done: false });
  });

  it('a confirmed sighting rises to the user-answer confidence 0.8 and fills its slot', async () => {
    const deps = depsWith();
    const sweep = await scoredSweep(deps);
    const candle = sweep.needsConfirmation[0]!;
    const out = await submitAnswers(deps, sweep.id, {
      answers: [],
      confirmations: [{ observationId: candle.id, confirmed: true }],
    });
    expect(out.needsConfirmation).toEqual([]);
    expect(out.observations.find((o) => o.id === candle.id)?.confidence).toBe(0.8);
    expect(lastSweepFacts().get('hazards.candle')).toMatchObject({ value: true, provenance: { confidence: 0.8 } });
  });

  it('dismissing the heater drops the relate hazard that leaned on it', async () => {
    const deps = depsWith();
    const sweep = await scoredSweep(deps);
    const out = await submitAnswers(deps, sweep.id, {
      answers: [],
      confirmations: [{ observationId: 'obs-1', confirmed: false }],
    });
    expect(out.observations.some((o) => o.id === 'obs-1' || o.id.startsWith('relate:'))).toBe(false);
    const facts = lastSweepFacts();
    // Full coverage and no heater: both heater slots are now absent.
    expect(facts.get('hazards.portableHeater')?.value).toBe(false);
    expect(facts.get('hazards.heaterNearCombustible')?.value).toBe(false);
  });

  it('asks at most one question, and never one the camera answered', async () => {
    const deps = depsWith();
    const sweep = await scoredSweep(deps);

    const first = await nextQuestion(deps, sweep.id);
    expect(nextQuestionResponseSchema.safeParse(first).success).toBe(true);
    expect(first.askedCount).toBe(0);
    // Year built is the only field a camera cannot settle and the engine still
    // wants: the term has its default and every hazard came from the sweep.
    expect(first.question?.id).toBe('q-year-built');
    expect(first.done).toBe(false);
    expect(first.skipped.every((s) => s.reason.length > 0)).toBe(true);
    expect(sweep.skippedCount).toBe(sweep.result!.voi.skipped.length);

    const answered = await submitAnswers(deps, sweep.id, {
      answers: [
        { questionId: 'q-year-built', field: 'buildings[0].yearBuilt', value: '1995' },
        { questionId: 'q-candle', field: 'hazards.candle', value: 'nope' },
        { questionId: 'q-no-such-question', field: 'x', value: 1 },
      ],
    });
    // Unknown question ids are ignored; an uncoercible answer still counts as asked.
    expect(answered.askedQuestionIds).toEqual(['q-year-built', 'q-candle']);
    expect(lastAnswers().map((a) => [a.canonicalPath, a.value, a.provenance.source, a.provenance.sourceDetail])).toEqual([
      ['buildings.unit.yearBuilt', 1995, 'answer', 'question:q-year-built'],
    ]);
    expect(answered.result!.canonical.buildings[0]!.yearBuilt?.map((f) => f.value)).toEqual([1995]);

    // One question has now been shown, so there is never another.
    const after = await nextQuestion(deps, sweep.id);
    expect(after.question).toBeNull();
    expect(after.done).toBe(true);
    expect(answered.stage).toBe('done');

    // A re-answer replaces the earlier answer for the same question.
    await submitAnswers(deps, sweep.id, {
      answers: [{ questionId: 'q-year-built', field: 'buildings[0].yearBuilt', value: 1962 }],
    });
    expect(lastAnswers().find((a) => a.canonicalPath === 'buildings.unit.yearBuilt')?.value).toBe(1962);
  });

  it('edits correct a derived field inline and rescore, latest edit winning', async () => {
    const deps = depsWith();
    const sweep = await scoredSweep(deps);
    expect(sweep.result!.canonical.exposure.contentsLimit?.map((f) => f.value)).toEqual([15_000]);
    const contentsOf = (s: SweepDto) => s.result!.canonical.exposure.contentsLimit ?? [];

    const edited = await submitAnswers(deps, sweep.id, {
      answers: [],
      edits: [
        { field: 'exposure.contentsLimit', value: '48000' },
        // A component key addresses the same field, and the later edit wins.
        { field: 'contentsLimit', value: 52_000 },
        // Uncoercible and unknown edits are dropped rather than stored.
        { field: 'buildings[0].yearBuilt', value: 'not a year' },
        { field: 'no.such.field', value: 1 },
      ],
    });
    const answerFacts = lastAnswers();
    expect(answerFacts.map((a) => [a.canonicalPath, a.value, a.provenance.sourceDetail])).toEqual([
      ['exposure.contentsLimit', 52_000, 'edit:exposure.contentsLimit'],
    ]);
    // Nothing overwrites anything (PRD §6.2): the sweep's own figure is still
    // on the field, with the renter's correction after it and outranking it.
    expect(contentsOf(edited).map((f) => [f.value, f.provenance.source])).toEqual([
      [15_000, 'sweep'],
      [52_000, 'answer'],
    ]);
    // An edit is not a question, so it never uses up the one question allowed.
    expect(edited.askedQuestionIds).toEqual([]);
    expect((await nextQuestion(deps, sweep.id)).question?.id).toBe('q-year-built');
  });

  it('a credited fix replaces the hazard with false, persists, and reports before and after', async () => {
    const llm = llmWith();
    const deps = depsWith(llm);
    const sweep = await scoredSweep(deps);
    const before = sweep.result!;

    // Canned verify-fix: stillPresent false @ 0.88.
    const fixed = await verifyFix(deps, sweep.id, {
      hazardKey: 'hazards.heaterNearCombustible',
      imageBase64: await frameJpeg(42),
      capturedAt: NOW,
    });
    expect(fixed).toMatchObject({ sweepId: sweep.id, hazardKey: 'heaterNearCombustible', stillPresent: false, confidence: 0.88 });
    expect(fixed.before).toEqual({
      appetiteScore: before.evaluate.appetiteScore,
      verdict: before.verdict.verdict,
      completeness: before.evaluate.completeness,
      confidence: before.evaluate.confidence,
      predictedPremium: before.price.predictedPremium,
      qualityIndex: before.qualityIndex,
      rank: null,
    });
    expect(fixed.after.appetiteScore).toBe(fixed.result.evaluate.appetiteScore);
    expect(fixed.after.verdict).toBe(fixed.result.verdict.verdict);

    // Replaced, not appended: no competing value, so no contradiction.
    expect(lastSweepFacts().get('hazards.heaterNearCombustible')).toMatchObject({
      value: false,
      provenance: { source: 'sweep', sourceDetail: `verify-fix:${NOW}`, confidence: 0.88 },
    });
    const value = fixed.result.canonical.hazards.present.heaterNearCombustible ?? [];
    expect(value.map((f) => f.value)).toEqual([false]);
    expect(fixed.result.contradictions.filter((c) => c.canonicalPath.includes('heaterNearCombustible'))).toEqual([]);
    // Only the pair was fixed; the heater itself is still seen.
    expect(lastSweepFacts().get('hazards.portableHeater')?.value).toBe(true);

    // The prompt names what the sweep saw.
    const prompt = llm.callsFor('verify-fix')[0]!.prompt;
    expect(prompt).toContain('portable heater (free-standing electric heater)');
    expect(prompt).toContain('curtain (floor-length curtain)');

    // The fix survives a later re-score (answers re-run from the stored session).
    await submitAnswers(deps, sweep.id, {
      answers: [{ questionId: 'q-year-built', field: 'buildings[0].yearBuilt', value: 1995 }],
    });
    expect(lastSweepFacts().get('hazards.heaterNearCombustible')?.value).toBe(false);
    const stored = (await getSweep(deps, sweep.id))!;
    expect(stored.askedQuestionIds).toEqual(['q-year-built']);
  });

  it('does not credit a fix the model is unsure of (< 0.6)', async () => {
    const llm = llmWith({
      overrides: { 'verify-fix': { stillPresent: false, confidence: 0.4, reason: 'hard to tell' } },
    });
    const deps = depsWith(llm);
    const sweep = await scoredSweep(deps);
    const fixed = await verifyFix(deps, sweep.id, {
      hazardKey: 'heaterNearCombustible',
      imageBase64: await frameJpeg(42),
      capturedAt: NOW,
    });
    expect(fixed).toMatchObject({ stillPresent: false, confidence: 0.4, reason: 'hard to tell' });
    expect(fixed.after).toEqual(fixed.before);
    expect(lastSweepFacts().get('hazards.heaterNearCombustible')).toMatchObject({ value: true, provenance: { confidence: 0.78 } });
  });

  it('never calls the model for a photo that fails the quality gate', async () => {
    const llm = llmWith();
    const deps = depsWith(llm);
    const sweep = await scoredSweep(deps);
    const fixed = await verifyFix(deps, sweep.id, {
      hazardKey: 'heaterNearCombustible',
      imageBase64: await blackJpeg(),
      capturedAt: NOW,
    });
    expect(llm.callsFor('verify-fix')).toHaveLength(0);
    expect(fixed).toMatchObject({ stillPresent: true, confidence: 0 });
    expect(fixed.after).toEqual(fixed.before);
  });

  it('rejects a hazard key a photo cannot clear, and a sweep with no verdict', async () => {
    const deps = depsWith();
    const sweep = await scoredSweep(deps);
    await expect(
      verifyFix(deps, sweep.id, { hazardKey: 'smokeDetectorCount', imageBase64: await frameJpeg(5), capturedAt: NOW }),
    ).rejects.toThrow(/not a hazard/);
    const fresh = await createSweep(deps, await eightFrameRequest());
    await expect(
      verifyFix(deps, fresh.id, { hazardKey: 'candle', imageBase64: await frameJpeg(5), capturedAt: NOW }),
    ).rejects.toThrow(/no verdict/);
  });
});
