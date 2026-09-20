/** The sweep pipeline; it is what drives the `stage` column. Unit A18. */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import type {
  HazardCostDto,
  ObserveInput,
  ObserveOutput,
  RelateInput,
  SweepCreateRequestDto,
  SweepDto,
  SweepFrameDto,
  SweepStageDto,
  ScoreSnapshotDto,
} from '@retrofit/contracts';
import {
  MIN_OBSERVATION_CONFIDENCE,
  OBJECT_CATEGORY,
  OBJECT_VOCAB,
  SWEEP_FALLBACK_CONFIDENCE,
  applySelfConsistency,
  coverage as sweepCoverage,
  dataFilePath,
  dedupeObservations,
  math,
  pairRules,
  readQuestions,
  readRatingTable,
  readRulebook,
  readVectorSpec,
  runEngine,
  toHazardValues,
  unknownHazards,
  voi,
} from '@retrofit/engine';
import type {
  CanonicalSubmission,
  CoverageResult,
  EngineConfig,
  EngineResult,
  ExternalValue,
  Field,
  ObjectLabel,
  Observation,
  Question,
  RawRecord,
} from '@retrofit/engine';
import { createRepos } from '../db/repos';
import type { NewSweepRow, SweepRow } from '../db/schema';
import { imageMetrics } from '../images/metrics';
import type { ImageMetrics } from '../images/metrics';
import { gradeFrame } from '../images/quality';
import { observeCall, relateCall } from '../llm/index';
import type { LlmImagePart } from '../llm/index';
import { tablePrice } from '../pricing/table';
import type { PriceLabel } from '../pricing/table';
import type { Deps } from './types';

/*
 * Decision log: docs/decisions/A18.md. Everything below that is exported beyond
 * the three frozen functions is marked `@internal A18`: it exists so that
 * `questions.ts` and `verify-fix.ts` (same unit) re-score a sweep exactly the way
 * the pipeline does. It is not a shared helper and no other unit imports it.
 */

/* -------------------------------------------------------------------------- */
/* Constants private to the unit                                              */
/* -------------------------------------------------------------------------- */

/**
 * Horizontal field of view assumed for one phone frame, degrees. A phone main
 * camera is ~65° landscape / ~50° portrait; 60° is the middle. It sets both the
 * coverage arc of a frame and the bearing offset of an object from its box.
 */
export const FRAME_FOV_DEG = 60;

/** Frames are re-encoded to this long side before storage and before Gemini. */
const STORED_MAX_SIDE = 1024;
const STORED_JPEG_QUALITY = 80;

/** The `hazards.*` keys the `relate` call may add or adjust (relational only). */
const RELATIONAL_HAZARD_KEYS: readonly string[] = ['heaterNearCombustible', 'powerBarOverload'];

/** Raw-record resource that holds the sweep's answer and fix events. */
export const SESSION_RESOURCE = 'retrofit_sweep_session';

/** Building external id of the synthetic renter unit. */
const UNIT_BUILDING_ID = 'unit';

/** Id prefixes of the derived observations this unit writes. */
const RELATE_PREFIX = 'relate:';
const CEILING_PREFIX = 'ceiling:';
/** Carries the replacement value the phone priced during the sweep, in its id. */
const CONTENTS_PREFIX = 'contents:';

/** Applied when nothing asks for one; the phone no longer has a term screen. */
const DEFAULT_TERM_MONTHS = 12;
/** Applied when nothing names the room; the phone opens straight on the camera. */
const DEFAULT_ROOM_LABEL = 'Room';

/** `exposure.contentsLimit` rounds up to this step and never falls below the floor. */
const CONTENTS_STEP_USD = 5_000;
const CONTENTS_FLOOR_USD = 15_000;

/** At most one question is ever shown, and never about something the camera saw. */
export const MAX_QUESTIONS_PER_SWEEP = 1;

/**
 * Sweep labels that are the renter's own belongings, mapped to the live price
 * table's label for them. Fixed appliances (`stove`, `water_heater`) are the
 * landlord's and never counted. This is only the fallback: when the phone sends
 * its own `contentsEstimateUsd`, that wins, because `/price/identify` reads a
 * far wider vocabulary than the 21 labels the hazard sweep looks for.
 */
const CONTENTS_LABEL: Readonly<Partial<Record<ObjectLabel, PriceLabel>>> = {
  tv: 'tv',
  laptop: 'laptop',
  camera: 'camera',
  instrument: 'instrument',
  bike: 'bike',
  jewelry: 'other',
  portable_heater: 'portable_heater',
  window_ac_unit: 'window_ac_unit',
};

/* -------------------------------------------------------------------------- */
/* Session events (stored in the result's canonical `raw`)                    */
/* -------------------------------------------------------------------------- */

/** @internal A18 */
export interface AnswerEvent {
  readonly kind: 'answer';
  readonly questionId: string;
  readonly field: string;
  /** Already coerced to the question's input type; null when skipped or invalid. */
  readonly value: string | number | boolean | null;
  readonly skipped: boolean;
  readonly at: string;
}

/** @internal A18 */
export interface FixEvent {
  readonly kind: 'fix';
  readonly hazardKey: string;
  readonly stillPresent: boolean;
  readonly confidence: number;
  readonly reason: string;
  readonly capturedAt: string;
  readonly at: string;
}

/**
 * An inline correction to a field the sweep derived or defaulted, made on the
 * verdict screen. It names the canonical field directly, because a derived
 * field (`exposure.contentsLimit`) has no question to answer.
 *
 * @internal A18
 */
export interface EditEvent {
  readonly kind: 'edit';
  /** A question's field spelling: a canonical path, or `buildings[0].yearBuilt`. */
  readonly field: string;
  /** Already coerced to the vector component's type; null when it did not fit. */
  readonly value: string | number | boolean | null;
  readonly at: string;
}

/** @internal A18 */
export type SessionEvent = AnswerEvent | FixEvent | EditEvent;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function parseEvent(data: unknown): SessionEvent | null {
  if (!isRecord(data)) return null;
  if (data.kind === 'answer' && typeof data.questionId === 'string' && typeof data.field === 'string') {
    const v = data.value;
    const value =
      typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : null;
    return {
      kind: 'answer',
      questionId: data.questionId,
      field: data.field,
      value,
      skipped: data.skipped === true,
      at: typeof data.at === 'string' ? data.at : '',
    };
  }
  if (data.kind === 'edit' && typeof data.field === 'string') {
    const v = data.value;
    return {
      kind: 'edit',
      field: data.field,
      value: typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : null,
      at: typeof data.at === 'string' ? data.at : '',
    };
  }
  if (data.kind === 'fix' && typeof data.hazardKey === 'string') {
    return {
      kind: 'fix',
      hazardKey: data.hazardKey,
      stillPresent: data.stillPresent !== false,
      confidence: typeof data.confidence === 'number' ? math.clamp01(data.confidence) : 0,
      reason: typeof data.reason === 'string' ? data.reason : '',
      capturedAt: typeof data.capturedAt === 'string' ? data.capturedAt : '',
      at: typeof data.at === 'string' ? data.at : '',
    };
  }
  return null;
}

/** @internal A18 — the answer and fix events recorded so far, oldest first. */
export function sessionOf(result: EngineResult | null): SessionEvent[] {
  const records = result?.canonical.raw?.records[SESSION_RESOURCE] ?? [];
  const out: SessionEvent[] = [];
  for (const record of records) {
    const event = parseEvent(record.data);
    if (event !== null) out.push(event);
  }
  return out;
}

/** @internal A18 — question ids asked (answered or skipped), first-asked order. */
export function askedQuestionIdsOf(session: readonly SessionEvent[]): string[] {
  const out: string[] = [];
  for (const e of session) {
    if (e.kind === 'answer' && !out.includes(e.questionId)) out.push(e.questionId);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Engine config                                                              */
/* -------------------------------------------------------------------------- */

/** @internal A18 */
export interface TenantConfig {
  readonly config: EngineConfig;
  readonly questions: readonly Question[];
  /** Ids of the questions a camera sweep of the room can answer by itself. */
  readonly observableQuestionIds: ReadonlySet<string>;
}

/**
 * `observable` is a property of `questions/tenant.json`, not of the engine's
 * frozen `Question` type, so the engine's zod parse drops it. The one place
 * that needs it reads the file directly rather than widening a frozen type.
 */
async function readObservableQuestionIds(): Promise<ReadonlySet<string>> {
  const raw = JSON.parse(await readFile(dataFilePath('questions', 'tenant'), 'utf8')) as {
    readonly questions?: readonly { readonly id?: unknown; readonly observable?: unknown }[];
  };
  const out = new Set<string>();
  for (const q of raw.questions ?? []) {
    if (typeof q.id === 'string' && q.observable === true) out.add(q.id);
  }
  return out;
}

/**
 * The observable ids as a plain value, so the synchronous `toSweepDto` can read
 * them. It is written when the config loads, and every DTO that carries a
 * result is built after `scoreSweep` has already awaited that load, so it is
 * never read empty in a way that could surface a question the camera answered.
 */
let observableQuestionIdsNow: ReadonlySet<string> = new Set<string>();

let tenantConfigPromise: Promise<TenantConfig> | null = null;

/** @internal A18 — the tenant spec, rulebook, rating table and questions, read once. */
export function loadTenantConfig(): Promise<TenantConfig> {
  if (tenantConfigPromise === null) {
    tenantConfigPromise = (async () => {
      const [spec, rulebook, ratingTable, questions, observableQuestionIds] = await Promise.all([
        readVectorSpec('tenant'),
        readRulebook('tenant'),
        readRatingTable('tenant'),
        readQuestions('tenant'),
        readObservableQuestionIds(),
      ]);
      observableQuestionIdsNow = observableQuestionIds;
      return {
        config: { spec, rulebook, ratingTable, bookStats: null, questions },
        questions,
        observableQuestionIds,
      };
    })();
    // A failed read must not poison every later sweep.
    tenantConfigPromise.catch(() => {
      tenantConfigPromise = null;
    });
  }
  return tenantConfigPromise;
}

/* -------------------------------------------------------------------------- */
/* Images                                                                     */
/* -------------------------------------------------------------------------- */

/** @internal A18 — base64 (optionally a data URL) to bytes. */
export function decodeBase64Image(input: string): Uint8Array {
  const comma = input.startsWith('data:') ? input.indexOf(',') : -1;
  const b64 = comma >= 0 ? input.slice(comma + 1) : input;
  const buf = Buffer.from(b64.trim(), 'base64');
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function mimeOf(b64: string): string {
  if (b64.startsWith('/9j/')) return 'image/jpeg';
  if (b64.startsWith('iVBOR')) return 'image/png';
  if (b64.startsWith('UklGR')) return 'image/webp';
  return 'image/jpeg';
}

function toDataUrl(input: string): string {
  if (input.startsWith('data:')) return input;
  return `data:${mimeOf(input)};base64,${input}`;
}

/** @internal A18 — re-encode to a bounded JPEG, the only form stored or sent to Gemini. */
export async function normalizeImage(bytes: Uint8Array): Promise<string> {
  const out = await sharp(bytes)
    .autoOrient()
    .resize({ width: STORED_MAX_SIDE, height: STORED_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: STORED_JPEG_QUALITY })
    .toBuffer();
  return out.toString('base64');
}

function imagePart(dataUrl: string, label: string): LlmImagePart {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const mime = mimeOf(b64);
  return {
    kind: 'image',
    mimeType: mime === 'image/png' ? 'image/png' : mime === 'image/webp' ? 'image/webp' : 'image/jpeg',
    dataBase64: b64,
    label,
  };
}

/* -------------------------------------------------------------------------- */
/* Row <-> DTO                                                                */
/* -------------------------------------------------------------------------- */

function isPending(o: Observation): boolean {
  return o.derived !== true && math.clamp01(o.confidence) < MIN_OBSERVATION_CONFIDENCE;
}

/**
 * What each priced hazard adds to the monthly premium, dearest first.
 *
 * The engine composes a tenant premium as `base x PI(factors)` (stages/price.ts),
 * so the premium without one factor is exactly `monthly / factor` — a division,
 * not an estimate. It is done here, beside every other number, so the phone can
 * keep its rule of never doing arithmetic on money.
 */
function hazardCostsOf(result: EngineResult | null): HazardCostDto[] {
  if (result === null) return [];
  const monthly = result.price.predictedMonthlyPremium;
  const out: HazardCostDto[] = [];
  for (const f of result.price.factors) {
    if (!f.name.startsWith('hazard.')) continue;
    const factor = f.factor;
    const priced = monthly !== null && Number.isFinite(monthly) && Number.isFinite(factor) && factor > 0;
    out.push({
      hazardKey: f.name.slice('hazard.'.length),
      factor,
      monthlyDelta: priced ? math.roundTo(monthly - monthly / factor, 2) : null,
    });
  }
  return out.sort((a, b) => (b.monthlyDelta ?? 0) - (a.monthlyDelta ?? 0));
}

/** @internal A18 */
export function toSweepDto(row: SweepRow): SweepDto {
  const result = row.result ?? null;
  const asked = askedQuestionIdsOf(sessionOf(result));
  return {
    id: row.id,
    submissionId: row.submissionId ?? null,
    roomLabel: row.roomLabel,
    termMonths: row.term,
    stage: row.stage,
    frames: row.frames,
    coverage: row.coverage ?? null,
    observations: row.observations,
    needsConfirmation: row.observations.filter(isPending),
    result,
    hazardCosts: hazardCostsOf(result),
    pendingQuestion: qualifyingQuestion(result, asked, observableQuestionIdsNow),
    askedQuestionIds: asked,
    skippedCount: result?.voi.skipped.length ?? 0,
    error: row.error ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** @internal A18 */
export function snapshotOfResult(result: EngineResult): ScoreSnapshotDto {
  return {
    appetiteScore: result.evaluate.appetiteScore,
    verdict: result.verdict.verdict,
    completeness: result.evaluate.completeness,
    confidence: result.evaluate.confidence,
    predictedPremium: result.price.predictedPremium,
    qualityIndex: result.qualityIndex,
    rank: null,
  };
}

function update(deps: Deps, id: string, patch: Partial<NewSweepRow>): SweepRow {
  return createRepos(deps.db).sweeps.update(id, { ...patch, updatedAt: deps.clock.nowIso() });
}

/* -------------------------------------------------------------------------- */
/* Canonical submission for the engine                                        */
/* -------------------------------------------------------------------------- */

function sessionRecords(events: readonly SessionEvent[]): RawRecord[] {
  return events.map((e, i) => ({
    resource: SESSION_RESOURCE,
    id: i + 1,
    data: e as unknown as Readonly<Record<string, unknown>>,
  }));
}

function selfReported<T>(value: T, at: string): Field<T>[] {
  return [{ value, provenance: { source: 'self_reported', sourceDetail: 'sweep:new', observedAt: at } }];
}

/**
 * The submission the sweep is scored against. A sweep attached to a tenant
 * submission is scored on that submission; every other sweep is a renter quote
 * of its own (docs/decisions/A18.md D2).
 */
function baseCanonical(deps: Deps, row: SweepRow, events: readonly SessionEvent[]): CanonicalSubmission {
  if (row.submissionId !== null && row.submissionId !== undefined) {
    const sub = createRepos(deps.db).submissions.byId(row.submissionId);
    const canonical = sub?.canonical ?? null;
    if (canonical !== null && canonical.lineOfBusiness === 'tenant') {
      const raw = canonical.raw ?? { externalId: canonical.externalId ?? canonical.id, records: {} };
      return {
        ...canonical,
        raw: { ...raw, records: { ...raw.records, [SESSION_RESOURCE]: sessionRecords(events) } },
      };
    }
  }
  return {
    id: row.id,
    lineOfBusiness: 'tenant',
    insured: {},
    locations: [],
    buildings: [{ externalId: UNIT_BUILDING_ID, label: row.roomLabel }],
    hazards: { present: {} },
    exposure: {
      termMonths: selfReported(row.term, row.createdAt),
      roomLabel: selfReported(row.roomLabel, row.createdAt),
    },
    coverage: { lines: [] },
    history: [],
    pricing: {},
    raw: {
      externalId: row.id,
      lineOfBusiness: 'tenant',
      records: { [SESSION_RESOURCE]: sessionRecords(events) },
    },
  };
}

/**
 * Question fields use `list[i].leaf` (`buildings[0].yearBuilt`); merge writes
 * list entries by external id (`buildings.<externalId>.yearBuilt`).
 */
function canonicalPathFor(field: string, canonical: CanonicalSubmission): string | null {
  const m = /^(\w+)\[(\d+)\]\.(.+)$/.exec(field);
  if (m === null) return field;
  const list = (canonical as unknown as Record<string, unknown>)[m[1]!];
  if (!Array.isArray(list)) return null;
  const entry: unknown = list[Number(m[2])];
  if (!isRecord(entry) || typeof entry.externalId !== 'string') return null;
  return `${m[1]!}.${entry.externalId}.${m[3]!}`;
}

/** `portableHeater`, `hazards.portableHeater` and `hazards.present.portableHeater` are one key. */
export function hazardKeyOf(pathOrKey: string): string {
  return pathOrKey.replace(/^hazards\.(present\.)?/, '');
}

/**
 * What the renter said, keyed by canonical path so one path never carries two
 * competing answers. Latest answer per question wins; skipped and invalid
 * answers carry no value. Inline edits are applied last, because a correction
 * on the verdict screen is the newest thing the renter said about that field.
 */
function answerValues(events: readonly SessionEvent[], canonical: CanonicalSubmission): ExternalValue[] {
  const byPath = new Map<string, ExternalValue>();
  const put = (
    field: string,
    value: string | number | boolean,
    sourceDetail: string,
    at: string,
  ): void => {
    const path = canonicalPathFor(field, canonical);
    if (path === null) return;
    byPath.set(path, {
      canonicalPath: path,
      value,
      provenance: { source: 'answer', sourceDetail, observedAt: at },
    });
  };

  const latest = new Map<string, AnswerEvent>();
  for (const e of events) if (e.kind === 'answer') latest.set(e.questionId, e);
  for (const e of latest.values()) {
    if (e.skipped || e.value === null) continue;
    put(e.field, e.value, `question:${e.questionId}`, e.at);
  }

  for (const e of events) {
    if (e.kind !== 'edit' || e.value === null) continue;
    put(e.field, e.value, `edit:${e.field}`, e.at);
  }

  return [...byPath.values()];
}

/** Hazard keys whose latest verify-fix photo credibly showed the hazard gone. */
function creditedFixes(events: readonly SessionEvent[]): Map<string, FixEvent> {
  const latest = new Map<string, FixEvent>();
  for (const e of events) if (e.kind === 'fix') latest.set(e.hazardKey, e);
  const out = new Map<string, FixEvent>();
  for (const [key, e] of latest) {
    if (!e.stillPresent && e.confidence >= MIN_OBSERVATION_CONFIDENCE) out.set(key, e);
  }
  return out;
}

/**
 * The confidence the engine puts on its own negative evidence: the fraction of
 * the room the sweep covered (`sweep/observations.ts`, `assess`). A sweep that
 * covered nothing falls back to the engine's `SWEEP_FALLBACK_CONFIDENCE` rather
 * than claiming 0, which would read as "certainly unknown".
 */
function negativeEvidenceConfidence(coverage: CoverageResult): number {
  const covered = math.clamp01((coverage.coveragePct ?? 0) / 100);
  return covered > 0 ? covered : SWEEP_FALLBACK_CONFIDENCE;
}

/**
 * Every `hazards.*` value the sweep supports (PRD 9.3), assembled in code:
 * 1. E12 turns the sightings plus the engine pair rules into values. A sighting
 *    under MIN_OBSERVATION_CONFIDENCE is no longer held out: nothing asks the
 *    renter to confirm it any more, so it rides in carrying its own low
 *    confidence, which the engine already discounts (docs/decisions/mobile-rework.md).
 * 2. `relate` hazards whose supporting sightings are all still active add a
 *    hazard, or re-state an existing one's confidence. They never remove one.
 * 3. A credited verify-fix replaces the hazard's value with `false`.
 * 4. Every observable slot still unknown is recorded absent, so the renter is
 *    never asked about something the camera just looked at.
 */
function sweepHazardValues(
  observations: readonly Observation[],
  coverage: CoverageResult,
  fixes: ReadonlyMap<string, FixEvent>,
): ExternalValue[] {
  const active = observations.filter((o) => !o.id.startsWith(RELATE_PREFIX));
  const activeIds = new Set(active.filter((o) => o.derived !== true).map((o) => o.id));

  const byKey = new Map<string, ExternalValue>();
  const extra: ExternalValue[] = [];
  for (const v of toHazardValues(active, pairRules(active), coverage)) {
    const key = hazardKeyOf(v.canonicalPath);
    if (v.canonicalPath.startsWith('hazards.')) byKey.set(key, v);
    else extra.push(v);
  }

  for (const o of observations) {
    if (!o.id.startsWith(RELATE_PREFIX)) continue;
    const [, key = '', presence = '', ids = ''] = o.id.split(':');
    const support = ids.length > 0 ? ids.split('+') : [];
    if (!support.every((id) => activeIds.has(id))) continue;
    const existing = byKey.get(key);
    const confidence = math.clamp01(o.confidence);
    if (presence === 'present') {
      if (support.length === 0) continue;
      byKey.set(key, {
        canonicalPath: `hazards.${key}`,
        value: true,
        provenance: { source: 'sweep', sourceDetail: `relate:${ids}`, confidence },
      });
    } else if (existing !== undefined && existing.value === true) {
      // "Absent" only lowers the confidence of a hazard the engine found.
      const prior = existing.provenance.confidence ?? 1;
      byKey.set(key, {
        ...existing,
        provenance: { ...existing.provenance, confidence: Math.min(prior, 1 - confidence) },
      });
    }
  }

  for (const [key, fix] of fixes) {
    byKey.set(key, {
      canonicalPath: `hazards.${key}`,
      value: false,
      provenance: {
        source: 'sweep',
        sourceDetail: `verify-fix:${fix.capturedAt}`,
        confidence: fix.confidence,
        observedAt: fix.capturedAt,
      },
    });
  }

  // Nothing asks the renter about what the camera just looked at, so an
  // observable slot the sweep left unknown is recorded absent at the engine's
  // own negative-evidence confidence, never turned into a question.
  const absentConfidence = negativeEvidenceConfidence(coverage);
  for (const key of unknownHazards(active, coverage)) {
    if (byKey.has(key)) continue;
    byKey.set(key, {
      canonicalPath: `hazards.${key}`,
      value: key === 'smokeDetectorCount' ? 0 : false,
      provenance: {
        source: 'sweep',
        sourceDetail: `unseen:coverage=${String(coverage.coveragePct)}`,
        confidence: absentConfidence,
      },
    });
  }

  return [...byKey.values(), ...extra];
}

/* -------------------------------------------------------------------------- */
/* Contents                                                                   */
/* -------------------------------------------------------------------------- */

/** The replacement value the phone priced during the sweep, or null. */
function storedContentsEstimate(observations: readonly Observation[]): number | null {
  for (const o of observations) {
    if (!o.id.startsWith(CONTENTS_PREFIX)) continue;
    const n = Number(o.id.slice(CONTENTS_PREFIX.length));
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

/** The fallback estimate: table price of the belongings the sweep itself saw. */
function sightedContentsUsd(observations: readonly Observation[]): number {
  const seen = dedupeObservations(observations.filter((o) => o.derived !== true));
  let total = 0;
  for (const o of seen) {
    const label = CONTENTS_LABEL[o.label];
    if (label !== undefined) total += tablePrice(label);
  }
  return total;
}

/**
 * `exposure.contentsLimit` from an estimate: rounded up to the nearest $5,000,
 * never below the $15,000 floor. The renter is never asked to value their own
 * belongings — that is the thing the app exists to do.
 *
 * @internal A18
 */
export function contentsLimitFor(estimateUsd: number): number {
  const safe = Number.isFinite(estimateUsd) && estimateUsd > 0 ? estimateUsd : 0;
  return Math.max(CONTENTS_FLOOR_USD, Math.ceil(safe / CONTENTS_STEP_USD) * CONTENTS_STEP_USD);
}

/** The derived observation that carries a phone-sent contents estimate through the pipeline. */
function contentsMarker(estimateUsd: number): Observation {
  return {
    id: `${CONTENTS_PREFIX}${String(Math.round(estimateUsd))}`,
    label: 'unknown',
    category: OBJECT_CATEGORY.unknown,
    bearingDeg: 0,
    distanceBand: 'mid',
    confidence: 1,
    frameIndex: -1,
    notes: 'replacement value priced during the sweep',
    derived: true,
  };
}

/** `exposure.contentsLimit` as a sweep-sourced value, for the engine to price on. */
function contentsValue(
  observations: readonly Observation[],
  coverage: CoverageResult,
): ExternalValue {
  const estimate = storedContentsEstimate(observations) ?? sightedContentsUsd(observations);
  return {
    canonicalPath: 'exposure.contentsLimit',
    value: contentsLimitFor(estimate),
    provenance: {
      source: 'sweep',
      sourceDetail: `${CONTENTS_PREFIX}${String(Math.round(estimate))}`,
      confidence: negativeEvidenceConfidence(coverage),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Questions                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The one question this sweep may still show, or null.
 *
 * A question qualifies only when all three hold: the camera cannot answer it
 * (`observable: false` in `questions/tenant.json`); the VOI stage ranked it
 * worth asking at all, which is the existing threshold in `stages/voi.ts` —
 * a candidate reaches `ranked` only when it can move the appetite score or
 * leaves a rule undetermined; and fewer than MAX_QUESTIONS_PER_SWEEP have
 * already been shown. In practice this is at most one question, usually none.
 *
 * @internal A18
 */
export function qualifyingQuestion(
  result: EngineResult | null,
  askedQuestionIds: readonly string[],
  observableQuestionIds: ReadonlySet<string>,
): Question | null {
  if (result === null) return null;
  if (askedQuestionIds.length >= MAX_QUESTIONS_PER_SWEEP) return null;
  for (const candidate of result.voi.ranked) {
    if (observableQuestionIds.has(candidate.question.id)) continue;
    return candidate.question;
  }
  return null;
}

/** @internal A18 — run the engine over the sweep with the given session events. */
export async function scoreSweep(
  deps: Deps,
  row: SweepRow,
  events: readonly SessionEvent[],
): Promise<{ readonly result: EngineResult; readonly stage: SweepStageDto }> {
  const { config, questions, observableQuestionIds } = await loadTenantConfig();
  const submission = baseCanonical(deps, row, events);
  const coverage = row.coverage ?? sweepCoverage([], FRAME_FOV_DEG);
  const fixes = creditedFixes(events);
  const sweepFacts = [
    ...sweepHazardValues(row.observations, coverage, fixes),
    contentsValue(row.observations, coverage),
  ];
  const answers = answerValues(events, submission).filter(
    (a) => !fixes.has(hazardKeyOf(a.canonicalPath)),
  );

  const engine = runEngine(
    {
      submission,
      // Sweep facts ride in the pre-answer slot: merge appends them after the
      // broker's values and before answers, and their provenance stays `sweep`.
      enrichment: sweepFacts,
      answers,
      observations: [],
      asOf: deps.clock.today(),
    },
    config,
  );
  const asked = askedQuestionIdsOf(events);
  const information = voi(
    engine.vector,
    config.spec,
    config.rulebook,
    engine.evaluate,
    questions,
    asked,
  );
  const result: EngineResult = { ...engine, voi: information };
  const stage: SweepStageDto =
    qualifyingQuestion(result, asked, observableQuestionIds) !== null ? 'questions' : 'done';
  return { result, stage };
}

/* -------------------------------------------------------------------------- */
/* Stages                                                                     */
/* -------------------------------------------------------------------------- */

/** PRD 9.3 step 1: blur, exposure, clipping, resolution, duplicate — in code, before Gemini. */
async function runQualityGate(deps: Deps, row: SweepRow): Promise<SweepRow> {
  const frames: SweepFrameDto[] = [];
  const quality: (number | null)[] = [];
  let previous: ImageMetrics | undefined;
  /**
   * The best frame that decoded but graded under the bar, with its bytes. A
   * short or hand-held sweep can score every frame low; rather than strand the
   * scan, the best of them is reinstated below and the sweep carries on.
   */
  let fallback: { at: number; bytes: Uint8Array; quality: number } | null = null;

  for (const frame of row.frames) {
    if (frame.imageRef === null) {
      frames.push({ ...frame, quality: null, dropped: true, dropReason: frame.dropReason ?? 'no_image' });
      quality.push(null);
      continue;
    }
    let bytes: Uint8Array;
    let metrics: ImageMetrics;
    try {
      bytes = decodeBase64Image(frame.imageRef);
      metrics = await imageMetrics(bytes);
    } catch {
      frames.push({ ...frame, quality: 0, dropped: true, dropReason: 'undecodable', imageRef: null });
      quality.push(0);
      continue;
    }
    const verdict = gradeFrame(metrics, previous);
    previous = metrics;
    quality.push(verdict.quality);
    if (!verdict.pass) {
      if (fallback === null || verdict.quality > fallback.quality) {
        fallback = { at: frames.length, bytes, quality: verdict.quality };
      }
      frames.push({
        ...frame,
        quality: verdict.quality,
        dropped: true,
        dropReason: verdict.reason,
        imageRef: null,
      });
      continue;
    }
    const stored = await normalizeImage(bytes);
    frames.push({
      ...frame,
      quality: verdict.quality,
      dropped: false,
      dropReason: null,
      imageRef: `data:image/jpeg;base64,${stored}`,
    });
  }

  // Nothing cleared the bar: reinstate the best frame rather than end the scan
  // there. A soft photo still reads well enough to observe, and the verdict
  // carries the note that the room was seen poorly.
  if (!frames.some((f) => !f.dropped) && fallback !== null) {
    const at = fallback.at;
    const weak = frames[at];
    if (weak !== undefined) {
      const stored = await normalizeImage(fallback.bytes);
      frames[at] = {
        ...weak,
        dropped: false,
        dropReason: null,
        imageRef: `data:image/jpeg;base64,${stored}`,
      };
    }
  }

  const kept = frames.filter((f) => !f.dropped);
  if (kept.length === 0) {
    return update(deps, row.id, {
      frames,
      frameQuality: quality,
      coverage: sweepCoverage([], FRAME_FOV_DEG),
      stage: 'failed',
      error: 'No frame passed the photo-quality check. Please sweep the room again in better light.',
    });
  }
  return update(deps, row.id, {
    frames,
    frameQuality: quality,
    coverage: sweepCoverage(kept.map((f) => f.bearingDeg), FRAME_FOV_DEG),
    stage: 'quality_gate',
    error: null,
  });
}

/** Bearing of an object: the frame's bearing plus the box centre's offset across the FOV. */
function objectBearing(frameBearing: number, box: readonly [number, number, number, number]): number {
  const xCentre = (box[1] + box[3]) / 2 / 1000;
  const offset = (math.clamp01(xCentre) - 0.5) * FRAME_FOV_DEG;
  const b = (frameBearing + offset) % 360;
  return b < 0 ? b + 360 : b;
}

function observationsOf(
  output: ObserveOutput,
  frames: ReadonlyMap<number, SweepFrameDto>,
  run: 0 | 1,
): Observation[] {
  const out: Observation[] = [];
  for (const f of output.frames) {
    const frame = frames.get(f.index);
    if (frame === undefined || !f.usable) continue;
    f.objects.forEach((o, k) => {
      out.push({
        id: `r${run}-f${f.index}-${k}`,
        label: o.label,
        category: o.category,
        bearingDeg: objectBearing(frame.bearingDeg, o.box_2d),
        distanceBand: o.distanceBand,
        confidence: math.clamp01(o.confidence),
        frameIndex: f.index,
        box2d: o.box_2d,
        ceilingVisible: f.ceilingVisible,
        notes: o.notes,
      });
    });
  }
  return out;
}

/** PRD 9.3 steps 2-4: model gate, two shuffled `observe` runs, self-consistency. */
async function runObserve(deps: Deps, row: SweepRow): Promise<SweepRow> {
  // This stage replaces the observation list, so anything seeded at creation
  // (the phone's contents estimate) has to be carried across it.
  const carried = row.observations.filter((o) => o.id.startsWith(CONTENTS_PREFIX));
  const kept = row.frames.filter((f) => !f.dropped && f.imageRef !== null);
  const byIndex = new Map(kept.map((f) => [f.index, f] as const));
  const parts = kept.map((f) =>
    imagePart(f.imageRef!, `frame ${f.index}, bearing ${Math.round(f.bearingDeg)}°`),
  );
  const base: Omit<ObserveInput, 'runIndex'> = {
    roomLabel: row.roomLabel,
    frames: kept.map((f) => ({ index: f.index, bearingDeg: f.bearingDeg, quality: f.quality ?? 0 })),
    vocabulary: OBJECT_VOCAB,
  };
  const runA = await observeCall(deps.llm, { ...base, runIndex: 0 }, parts);
  const runB = await observeCall(deps.llm, { ...base, runIndex: 1 }, parts);

  // Model gate: a frame is usable when either run found it usable.
  const usable = new Map<number, { ceiling: number; reason: string }>();
  const reasons = new Map<number, string>();
  for (const run of [runA, runB]) {
    for (const f of run.frames) {
      if (f.usable) {
        const prior = usable.get(f.index);
        usable.set(f.index, {
          ceiling: (prior?.ceiling ?? 0) + (f.ceilingVisible ? 1 : 0),
          reason: f.reason,
        });
      } else if (!reasons.has(f.index)) {
        reasons.set(f.index, f.reason);
      }
    }
  }

  const frames = row.frames.map((f): SweepFrameDto => {
    if (f.dropped || usable.has(f.index)) return f;
    const why = reasons.get(f.index) ?? 'not usable';
    return { ...f, dropped: true, dropReason: `model: ${why}`.slice(0, 200) };
  });
  // The model read none of them. Rather than end the scan there, keep whatever
  // the quality gate passed: the later stages handle an empty observation set,
  // and the verdict says plainly that the room was seen poorly.
  const readable = frames.filter((f) => !f.dropped);
  const survivors = readable.length > 0 ? frames : row.frames;
  const usableFrames = survivors.filter((f) => !f.dropped);
  const coverage = sweepCoverage(usableFrames.map((f) => f.bearingDeg), FRAME_FOV_DEG);

  if (usableFrames.length === 0) {
    return update(deps, row.id, {
      frames,
      coverage,
      observations: carried,
      stage: 'failed',
      error: 'None of the photos showed a room we could check. Please sweep the room again.',
    });
  }

  const consistent = applySelfConsistency(
    observationsOf(runA, byIndex, 0),
    observationsOf(runB, byIndex, 1),
  ).filter((o) => usable.has(o.frameIndex));
  const sightings = consistent.map((o, i): Observation => ({ ...o, id: `obs-${i + 1}` }));

  // E12 D3: one ceiling marker per usable frame that saw the ceiling, so a
  // ceiling-only frame still counts toward the negative-evidence share.
  const markers: Observation[] = [];
  for (const f of usableFrames) {
    const u = usable.get(f.index);
    if (u === undefined || u.ceiling === 0) continue;
    markers.push({
      id: `${CEILING_PREFIX}f${f.index}`,
      label: 'unknown',
      category: OBJECT_CATEGORY.unknown,
      bearingDeg: f.bearingDeg,
      distanceBand: 'far',
      confidence: u.ceiling >= 2 ? 1 : 0.5,
      frameIndex: f.index,
      ceilingVisible: true,
      notes: 'ceiling visible in this frame',
      derived: true,
    });
  }

  return update(deps, row.id, {
    frames: survivors,
    coverage,
    observations: [...sightings, ...markers, ...carried],
    stage: 'observing',
    error: null,
  });
}

/** Engine pair rules first, then `relate` only adds or adjusts (PRD 9.2). */
async function runRelate(deps: Deps, row: SweepRow): Promise<SweepRow> {
  const base = row.observations.filter((o) => !o.id.startsWith(RELATE_PREFIX));
  const sightings = base.filter((o) => o.derived !== true);
  const engineHazards = new Map<string, number>();
  for (const hit of pairRules(sightings)) {
    engineHazards.set(hit.hazardKey, Math.max(engineHazards.get(hit.hazardKey) ?? 0, hit.confidence));
  }
  const input: RelateInput = {
    roomLabel: row.roomLabel,
    observations: sightings.map((o) => ({
      id: o.id,
      label: o.label,
      bearingDeg: o.bearingDeg,
      distanceBand: o.distanceBand,
      confidence: o.confidence,
    })),
    engineHazards: [...engineHazards].map(([hazardKey, confidence]) => ({ hazardKey, confidence })),
    allowedHazardKeys: RELATIONAL_HAZARD_KEYS,
  };
  const output = await relateCall(deps.llm, input);

  const byId = new Map(sightings.map((o) => [o.id, o] as const));
  const derived: Observation[] = output.hazards.map((h) => {
    const anchor = h.observationIds.map((id) => byId.get(id)).find((o) => o !== undefined);
    const label: ObjectLabel = anchor?.label ?? 'unknown';
    return {
      id: `${RELATE_PREFIX}${h.hazardKey}:${h.present ? 'present' : 'absent'}:${h.observationIds.join('+')}`,
      label,
      category: OBJECT_CATEGORY[label],
      bearingDeg: anchor?.bearingDeg ?? 0,
      distanceBand: anchor?.distanceBand ?? 'mid',
      confidence: math.clamp01(h.confidence),
      frameIndex: anchor?.frameIndex ?? -1,
      notes: h.reason,
      derived: true,
    };
  });

  return update(deps, row.id, { observations: [...base, ...derived], stage: 'relating', error: null });
}

async function runScore(deps: Deps, row: SweepRow): Promise<SweepRow> {
  const events = sessionOf(row.result ?? null);
  const { result } = await scoreSweep(deps, row, events);
  return update(deps, row.id, { result, stage: 'scoring', error: null });
}

async function afterScoring(deps: Deps, row: SweepRow): Promise<SweepRow> {
  const { observableQuestionIds } = await loadTenantConfig();
  const asked = askedQuestionIdsOf(sessionOf(row.result ?? null));
  const question = qualifyingQuestion(row.result ?? null, asked, observableQuestionIds);
  return update(deps, row.id, { stage: question === null ? 'done' : 'questions' });
}

/* -------------------------------------------------------------------------- */
/* Public service                                                             */
/* -------------------------------------------------------------------------- */

/** Persists the sweep at `received`; the route drives the stages (A15 D1). */
export async function createSweep(deps: Deps, request: SweepCreateRequestDto): Promise<SweepDto> {
  const now = deps.clock.nowIso();
  const frames: SweepFrameDto[] = request.frames.map((f, index) => ({
    index,
    bearingDeg: ((f.bearingDeg % 360) + 360) % 360,
    pitchDeg: f.pitchDeg ?? null,
    capturedAt: f.capturedAt,
    quality: null,
    dropped: false,
    dropReason: null,
    imageRef: toDataUrl(f.imageBase64),
  }));
  // The phone opens on the camera, so nothing asks for a room name or a term
  // before the sweep: both have a server-side default (mobile-rework A4).
  const estimate = request.contentsEstimateUsd;
  const seeded: Observation[] =
    typeof estimate === 'number' && Number.isFinite(estimate) && estimate > 0
      ? [contentsMarker(estimate)]
      : [];
  const row = createRepos(deps.db).sweeps.insert({
    id: `sweep_${randomUUID()}`,
    submissionId: request.submissionId ?? null,
    roomLabel: request.roomLabel?.trim() || DEFAULT_ROOM_LABEL,
    term: request.termMonths ?? DEFAULT_TERM_MONTHS,
    frames,
    frameQuality: frames.map(() => null),
    observations: seeded,
    coverage: null,
    result: null,
    stage: 'received',
    error: null,
    createdAt: now,
    updatedAt: now,
  });
  return toSweepDto(row);
}

/**
 * The same sweep with the frame images left out.
 *
 * Fifteen stored frames are about six megabytes of base64, and `/analyzing`
 * polls this every 1.2 s without ever drawing one: a minute of that is a
 * hundred megabytes through a phone, which is enough to end the app. The poll
 * asks for this form; the screens that actually show a photo do not.
 */
export function withoutFrameImages(sweep: SweepDto): SweepDto {
  return {
    ...sweep,
    frames: sweep.frames.map((f) => (f.imageRef === null ? f : { ...f, imageRef: null })),
  };
}

/** Advances one stage: quality gate -> observe -> relate -> score -> questions. */
export async function advanceSweep(deps: Deps, sweepId: string): Promise<SweepDto> {
  const repos = createRepos(deps.db);
  const row = repos.sweeps.byId(sweepId);
  if (row === null) throw new Error(`no sweep "${sweepId}"`);

  try {
    switch (row.stage) {
      case 'received':
        return toSweepDto(await runQualityGate(deps, row));
      case 'quality_gate':
        return toSweepDto(await runObserve(deps, row));
      case 'observing':
        return toSweepDto(await runRelate(deps, row));
      case 'relating':
        return toSweepDto(await runScore(deps, row));
      case 'scoring':
        return toSweepDto(await afterScoring(deps, row));
      default:
        return toSweepDto(row);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return toSweepDto(
      update(deps, row.id, { stage: 'failed', error: `${row.stage}: ${message}`.slice(0, 500) }),
    );
  }
}

export async function getSweep(deps: Deps, sweepId: string): Promise<SweepDto | null> {
  const row = createRepos(deps.db).sweeps.byId(sweepId);
  return row === null ? null : toSweepDto(row);
}
