/**
 * Sweep observation handling and pair rules — pure. Body owned by Run 1 unit E12.
 * Implements PRD 9.3 steps 3, 4 and 5, then PRD 6.3's pair rules.
 *
 * Decision log: docs/decisions/E12.md. In short:
 * - Dedupe clusters greedily by confidence (highest first) with the shared
 *   `dedupeByBearing`; the cluster's best observation survives unchanged.
 * - Self-consistency matches each run-A object to the closest unmatched run-B
 *   object of the same label within DEDUPE_ANGLE_DEG. A match keeps the higher
 *   confidence (`runsSeen: 2`); anything unmatched is halved (`runsSeen: 1`).
 * - The ceiling share is the share of the sweep's frames that some observation
 *   marks `ceilingVisible`; negative evidence needs share >= 0.5.
 * - With a sufficient sweep (coverage >= 75%) a visible hazard that was not seen
 *   is recorded `false` at confidence = covered fraction. The smoke detector is
 *   the exception (PRD 9.3 step 5): its zero needs the ceiling share instead.
 */
import {
  CEILING_COVERAGE_REQUIRED,
  DEDUPE_ANGLE_DEG,
  DISTANCE_BAND_ORDER,
  HIGH_VALUE_LABELS,
  PAIR_RULES,
  RATIO_TOLERANCE,
  SINGLE_RUN_CONFIDENCE_FACTOR,
} from '../constants.js';
import type {
  CoverageResult,
  DistanceBand,
  ExternalValue,
  HazardKey,
  ObjectLabel,
  Observation,
  PairRuleHit,
  Provenance,
} from '../types.js';
import { angularSeparationDeg, clamp01, isFiniteNumber } from '../util/math.js';
import { dedupeByBearing, withinTolerance } from './geometry.js';

/* -------------------------------------------------------------------------- */
/* Private tables                                                             */
/* -------------------------------------------------------------------------- */

/** Labels whose sighting is itself the hazard fact (mirrors merge, E04 D4). */
const PRESENCE_LABELS: readonly { readonly label: ObjectLabel; readonly key: HazardKey }[] = [
  { label: 'portable_heater', key: 'portableHeater' },
  { label: 'extension_cord', key: 'extensionCord' },
  { label: 'candle', key: 'candle' },
  { label: 'stove', key: 'stove' },
  { label: 'blocked_exit', key: 'blockedExit' },
  { label: 'window_ac_unit', key: 'windowAcUnit' },
  { label: 'water_heater', key: 'waterHeater' },
];

/**
 * Every hazard slot the sweep speaks to, in `vectors/tenant.json` component
 * order. `smokeDetectorCount` is included because an unknown count becomes a
 * question exactly like an unknown hazard does.
 */
const HAZARD_ORDER: readonly HazardKey[] = [
  'portableHeater',
  'heaterNearCombustible',
  'extensionCord',
  'powerBarOverload',
  'candle',
  'stove',
  'blockedExit',
  'windowAcUnit',
  'waterHeater',
  'highValueContents',
  'smokeDetectorCount',
];

/** The path `negativeEvidence` reports for "no smoke detector". */
const NO_SMOKE_DETECTOR_PATH = 'hazards.smokeDetector';

/* -------------------------------------------------------------------------- */
/* Private helpers                                                            */
/* -------------------------------------------------------------------------- */

function conf(o: Observation): number {
  return isFiniteNumber(o.confidence) ? clamp01(o.confidence) : 0;
}

/** Stable sort by confidence descending; ties keep input order. */
function byConfidenceDesc(list: readonly Observation[]): Observation[] {
  return list
    .map((o, i) => ({ o, i }))
    .sort((a, b) => conf(b.o) - conf(a.o) || a.i - b.i)
    .map((x) => x.o);
}

function bandIndex(band: DistanceBand): number {
  const i = DISTANCE_BAND_ORDER.indexOf(band);
  return i < 0 ? DISTANCE_BAND_ORDER.indexOf('mid') : i;
}

function bandsCompatible(a: DistanceBand, b: DistanceBand): boolean {
  return Math.abs(bandIndex(a) - bandIndex(b)) <= 1;
}

/** Model sightings only: pair-rule products never count as an object seen. */
function sighted(observations: readonly Observation[]): Observation[] {
  return observations.filter((o) => o.derived !== true && isFiniteNumber(o.bearingDeg));
}

function maxConfidence(list: readonly Observation[]): number {
  return list.reduce((acc, o) => Math.max(acc, conf(o)), 0);
}

function best(list: readonly Observation[]): Observation {
  return list.reduce((a, b) => (conf(b) > conf(a) ? b : a));
}

function sweepProvenance(detail: string, confidence: number): Provenance {
  return { source: 'sweep', sourceDetail: detail, confidence: clamp01(confidence) };
}

/** Share of the sweep's frames in which some observation saw the ceiling, 0..1. */
function ceilingShare(observations: readonly Observation[], coverage: CoverageResult): number {
  if (!isFiniteNumber(coverage.frameCount) || coverage.frameCount <= 0) return 0;
  const frames = new Set<number>();
  for (const o of observations) {
    if (o.ceilingVisible === true && isFiniteNumber(o.frameIndex)) frames.add(o.frameIndex);
  }
  return clamp01(frames.size / coverage.frameCount);
}

function coveredFractionOf(coverage: CoverageResult): number {
  return isFiniteNumber(coverage.coveragePct) ? clamp01(coverage.coveragePct / 100) : 0;
}

type Assessment =
  | { readonly state: 'known'; readonly value: boolean | number; readonly confidence: number; readonly detail: string }
  | { readonly state: 'unknown' };

/**
 * The single source of truth for what the sweep says about every hazard slot,
 * shared by `toHazardValues` and `unknownHazards` so they can never disagree.
 */
function assess(
  observations: readonly Observation[],
  hits: readonly PairRuleHit[],
  coverage: CoverageResult,
): Map<HazardKey, Assessment> {
  const seen = dedupeObservations(sighted(observations));
  const byLabel = new Map<ObjectLabel, Observation[]>();
  for (const o of seen) {
    const list = byLabel.get(o.label);
    if (list === undefined) byLabel.set(o.label, [o]);
    else list.push(o);
  }
  const has = (label: ObjectLabel): boolean => (byLabel.get(label)?.length ?? 0) > 0;
  const sufficient = coverage.sufficient === true;
  const coveredConf = coveredFractionOf(coverage);
  const absent: Assessment = sufficient
    ? {
        state: 'known',
        value: false,
        confidence: coveredConf,
        detail: `absent:coverage=${String(coverage.coveragePct)}`,
      }
    : { state: 'unknown' };

  const out = new Map<HazardKey, Assessment>();

  for (const { label, key } of PRESENCE_LABELS) {
    const list = byLabel.get(label) ?? [];
    if (list.length > 0) {
      const w = best(list);
      out.set(key, { state: 'known', value: true, confidence: conf(w), detail: `observation:${w.id}` });
    } else {
      out.set(key, absent);
    }
  }

  // heaterNearCombustible: geometry decides (TN-PAIR).
  const heaterHits = hits.filter((h) => h.hazardKey === 'heaterNearCombustible');
  if (heaterHits.length > 0) {
    const w = heaterHits.reduce((a, b) => (b.confidence > a.confidence ? b : a));
    out.set('heaterNearCombustible', {
      state: 'known',
      value: true,
      confidence: clamp01(w.confidence),
      detail: `pair:${w.aObservationId}+${w.bObservationId}`,
    });
  } else if (sufficient) {
    const detail = has('portable_heater')
      ? `no_pair:coverage=${String(coverage.coveragePct)}`
      : `absent:coverage=${String(coverage.coveragePct)}`;
    out.set('heaterNearCombustible', { state: 'known', value: false, confidence: coveredConf, detail });
  } else {
    out.set('heaterNearCombustible', { state: 'unknown' });
  }

  // powerBarOverload is relational and belongs to the `relate` call: the engine
  // can only say "no power bar, so no overload".
  out.set('powerBarOverload', has('power_bar') ? { state: 'unknown' } : absent);

  const valuables = HIGH_VALUE_LABELS.flatMap((l) => byLabel.get(l) ?? []);
  out.set(
    'highValueContents',
    valuables.length > 0
      ? {
          state: 'known',
          value: true,
          confidence: maxConfidence(valuables),
          detail: `observations:${valuables.map((o) => o.id).join('+')}`,
        }
      : absent,
  );

  const detectors = byLabel.get('smoke_detector') ?? [];
  if (detectors.length > 0) {
    out.set('smokeDetectorCount', {
      state: 'known',
      value: detectors.length,
      confidence: maxConfidence(detectors),
      detail: `observations:${detectors.map((o) => o.id).join('+')}`,
    });
  } else {
    const neg = negativeEvidence(observations, coverage);
    const first = neg[0];
    out.set(
      'smokeDetectorCount',
      first === undefined
        ? { state: 'unknown' }
        : {
            state: 'known',
            value: 0,
            confidence: first.confidence,
            detail: `ceiling_share=${String(ceilingShare(observations, coverage))}`,
          },
    );
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* PRD 9.3 step 3 — dedupe                                                    */
/* -------------------------------------------------------------------------- */

/** Same label within DEDUPE_ANGLE_DEG merges, keeping max confidence. */
export function dedupeObservations(observations: readonly Observation[]): Observation[] {
  const kept = dedupeByBearing(
    byConfidenceDesc(observations),
    DEDUPE_ANGLE_DEG,
    (a, b) => a.label === b.label,
  );
  // Carry the strongest self-consistency flag of each cluster onto its survivor.
  const keptSet = new Set(kept);
  const runs = new Map<Observation, 1 | 2>();
  for (const o of observations) {
    if (keptSet.has(o) || o.runsSeen !== 2) continue;
    const owner = kept.find(
      (k) => k.label === o.label && withinTolerance(k.bearingDeg, o.bearingDeg, DEDUPE_ANGLE_DEG),
    );
    if (owner !== undefined) runs.set(owner, 2);
  }
  // Return survivors in input order so the output is stable for callers.
  return observations
    .filter((o) => keptSet.has(o))
    .map((o) => (runs.get(o) === 2 && o.runsSeen !== 2 ? { ...o, runsSeen: 2 as const } : o));
}

/* -------------------------------------------------------------------------- */
/* PRD 9.3 step 4 — self-consistency                                          */
/* -------------------------------------------------------------------------- */

/** Objects seen in both shuffled runs keep their confidence; single-run objects are halved. */
export function applySelfConsistency(
  runA: readonly Observation[],
  runB: readonly Observation[],
): Observation[] {
  const a = dedupeObservations(runA);
  const b = dedupeObservations(runB);
  const usedB = new Set<number>();
  const matchOf = new Map<Observation, Observation>();

  // Strongest run-A objects claim their partner first.
  for (const oa of byConfidenceDesc(a)) {
    let bestIdx = -1;
    let bestSep = Infinity;
    for (let j = 0; j < b.length; j++) {
      const ob = b[j]!;
      if (usedB.has(j) || ob.label !== oa.label) continue;
      if (!withinTolerance(oa.bearingDeg, ob.bearingDeg, DEDUPE_ANGLE_DEG)) continue;
      const sep = angularSeparationDeg(oa.bearingDeg, ob.bearingDeg);
      if (sep < bestSep - RATIO_TOLERANCE || (Math.abs(sep - bestSep) <= RATIO_TOLERANCE && conf(ob) > conf(b[bestIdx]!))) {
        bestIdx = j;
        bestSep = sep;
      }
    }
    if (bestIdx >= 0) {
      usedB.add(bestIdx);
      matchOf.set(oa, b[bestIdx]!);
    }
  }

  const halve = (o: Observation): Observation => ({
    ...o,
    confidence: conf(o) * SINGLE_RUN_CONFIDENCE_FACTOR,
    runsSeen: 1,
  });

  const out: Observation[] = [];
  for (const oa of a) {
    const ob = matchOf.get(oa);
    if (ob === undefined) {
      out.push(halve(oa));
      continue;
    }
    const winner = conf(ob) > conf(oa) ? ob : oa;
    out.push({
      ...winner,
      confidence: conf(winner),
      ceilingVisible: oa.ceilingVisible === true || ob.ceilingVisible === true ? true : winner.ceilingVisible,
      runsSeen: 2,
    });
  }
  b.forEach((ob, j) => {
    if (!usedB.has(j)) out.push(halve(ob));
  });
  return out;
}

/* -------------------------------------------------------------------------- */
/* PRD 9.3 step 5 — negative evidence                                         */
/* -------------------------------------------------------------------------- */

/**
 * "No smoke detector" counts only when `ceilingVisible` held over at least
 * CEILING_COVERAGE_REQUIRED of the sweep. Otherwise the field stays unknown.
 */
export function negativeEvidence(
  observations: readonly Observation[],
  coverage: CoverageResult,
): { readonly path: string; readonly value: false; readonly confidence: number }[] {
  if (sighted(observations).some((o) => o.label === 'smoke_detector')) return [];
  const share = ceilingShare(observations, coverage);
  if (share + RATIO_TOLERANCE < CEILING_COVERAGE_REQUIRED) return [];
  return [{ path: NO_SMOKE_DETECTOR_PATH, value: false, confidence: share }];
}

/* -------------------------------------------------------------------------- */
/* PRD 6.3 — pair rules                                                       */
/* -------------------------------------------------------------------------- */

/** Engine pair rules from PAIR_RULES, run before the `relate` call. */
export function pairRules(observations: readonly Observation[]): PairRuleHit[] {
  const seen = sighted(observations);
  const hits: PairRuleHit[] = [];
  for (const rule of PAIR_RULES) {
    const as = seen.filter((o) => o.label === rule.a);
    const bs = seen.filter((o) => rule.b.includes(o.label));
    for (const oa of as) {
      for (const ob of bs) {
        if (ob === oa) continue;
        if (!withinTolerance(oa.bearingDeg, ob.bearingDeg, rule.maxSeparationDeg)) continue;
        if (rule.sameOrAdjacentBand && !bandsCompatible(oa.distanceBand, ob.distanceBand)) continue;
        hits.push({
          hazardKey: rule.hazardKey,
          aObservationId: oa.id,
          bObservationId: ob.id,
          separationDeg: angularSeparationDeg(oa.bearingDeg, ob.bearingDeg),
          // Both sightings must be real for the pair to be real.
          confidence: conf(oa) * conf(ob),
          reason: rule.reason,
        });
      }
    }
  }
  return hits;
}

/* -------------------------------------------------------------------------- */
/* hazards.* values                                                           */
/* -------------------------------------------------------------------------- */

/** Turn observations plus pair hits into `hazards.*` values with sweep provenance. */
export function toHazardValues(
  observations: readonly Observation[],
  hits: readonly PairRuleHit[],
  coverage: CoverageResult,
): ExternalValue[] {
  const facts = assess(observations, hits, coverage);
  const out: ExternalValue[] = [];
  for (const key of HAZARD_ORDER) {
    const a = facts.get(key);
    if (a === undefined || a.state !== 'known') continue;
    out.push({
      canonicalPath: `hazards.${key}`,
      value: a.value,
      provenance: sweepProvenance(a.detail, a.confidence),
    });
  }

  const sprinklers = dedupeObservations(sighted(observations).filter((o) => o.label === 'sprinkler_head'));
  if (sprinklers.length > 0) {
    out.push({
      canonicalPath: 'hazards.sprinklerHeadCount',
      value: sprinklers.length,
      provenance: sweepProvenance(
        `observations:${sprinklers.map((o) => o.id).join('+')}`,
        maxConfidence(sprinklers),
      ),
    });
  }

  if (isFiniteNumber(coverage.frameCount) && coverage.frameCount > 0) {
    const ceiling = observations.filter((o) => o.ceilingVisible === true);
    out.push({
      canonicalPath: 'hazards.ceilingObserved',
      value: ceiling.length > 0,
      provenance: sweepProvenance(
        `ceiling_share=${String(ceilingShare(observations, coverage))}`,
        ceiling.length > 0 ? maxConfidence(ceiling) : coveredFractionOf(coverage),
      ),
    });
  }
  return out;
}

/** Hazard keys the observation set leaves unknown, for the VOI loop. */
export function unknownHazards(
  observations: readonly Observation[],
  coverage: CoverageResult,
): HazardKey[] {
  const facts = assess(observations, pairRules(observations), coverage);
  return HAZARD_ORDER.filter((k) => facts.get(k)?.state !== 'known');
}
