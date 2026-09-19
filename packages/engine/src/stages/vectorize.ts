/** Stage 6 — vectorize, plus the book statistics it scales against. Body owned by Run 1 unit E05. */
import type {
  BookStats,
  CanonicalSubmission,
  ComponentStats,
  Field,
  FeatureVector,
  Rulebook,
  Sourced,
  VectorComponentSpec,
  VectorSpec,
} from '../types.js';
import {
  ACCEPTABLE_STATES,
  LOSS_ACCEPTABLE_MAX,
  LOSS_WINDOW_YEARS,
  MAJORITY_SHARE,
  PREMIUM_ACCEPTABLE_MAX,
  PREMIUM_ACCEPTABLE_MIN,
  PREMIUM_TARGET_MAX,
  PREMIUM_TARGET_MIN,
  RATIO_TOLERANCE,
  SOURCE_CONFIDENCE,
  SWEEP_FALLBACK_CONFIDENCE,
  TARGET_STATES,
  TIER_ACCEPTABLE,
  TIER_NOT_ACCEPTABLE,
  TIER_TARGET,
  TIV_ACCEPTABLE_MAX,
  TIV_TARGET_MAX,
  TIV_TARGET_MIN,
} from '../constants.js';
import {
  clamp01,
  isFiniteNumber,
  log1pScale,
  logScale,
  mean,
  median,
  safeDiv,
} from '../util/math.js';
import {
  canonicalLineOfBusiness,
  canonicalStateCode,
  canonicalSubmissionType,
} from './normalize.js';

/* -------------------------------------------------------------------------- */
/* Private helpers (HELPERS.md: private to this file, never exported)          */
/* -------------------------------------------------------------------------- */

/**
 * The highest-confidence value in a canonical slot.
 *
 * TODO(contract): this duplicates `bestValue` in `util/fields.ts` (unit E01,
 * still `NOT_IMPLEMENTED` when E05 ran). The rule implemented here is the one
 * its docstring states, so the two agree; swap this for the import at the
 * checkpoint. Recorded in `docs/decisions/E05.md`.
 */
const SOURCE_ORDER: readonly string[] = ['enrichment', 'answer', 'sweep', 'self_reported'];

function fieldConfidence(field: Field<unknown>): number {
  const stated = field.provenance.confidence;
  if (isFiniteNumber(stated)) return clamp01(stated);
  const table = SOURCE_CONFIDENCE[field.provenance.source];
  if (isFiniteNumber(table)) return table;
  return SWEEP_FALLBACK_CONFIDENCE;
}

function pickValue<T>(slot: Sourced<T> | undefined): T | null {
  if (slot === undefined || slot.length === 0) return null;
  let best: Field<T> | null = null;
  let bestConfidence = -1;
  let bestRank = Number.POSITIVE_INFINITY;
  let bestObservedAt = '';
  for (const candidate of slot) {
    const confidence = fieldConfidence(candidate);
    const rank = SOURCE_ORDER.indexOf(candidate.provenance.source);
    const observedAt = candidate.provenance.observedAt ?? '';
    if (best === null) {
      best = candidate;
      bestConfidence = confidence;
      bestRank = rank < 0 ? Number.POSITIVE_INFINITY : rank;
      bestObservedAt = observedAt;
      continue;
    }
    const normalizedRank = rank < 0 ? Number.POSITIVE_INFINITY : rank;
    const better =
      confidence > bestConfidence ||
      (confidence === bestConfidence &&
        (normalizedRank < bestRank ||
          (normalizedRank === bestRank && observedAt > bestObservedAt)));
    if (better) {
      best = candidate;
      bestConfidence = confidence;
      bestRank = normalizedRank;
      bestObservedAt = observedAt;
    }
  }
  return best === null ? null : best.value;
}

/** G-1: only a finite double is a known measurement. Everything else is missing. */
function asNumber(v: unknown): number | null {
  if (typeof v === 'boolean') return v ? 1 : 0;
  return isFiniteNumber(v) ? v : null;
}

/** Read a dotted path out of the submission, unwrapping any canonical slot. */
function readSource(submission: CanonicalSubmission, path: string): unknown {
  let cursor: unknown = submission;
  for (const segment of path.split('.')) {
    if (cursor === null || cursor === undefined || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  if (Array.isArray(cursor) && cursor.length > 0 && isCanonicalSlot(cursor)) {
    return pickValue(cursor as Sourced<unknown>);
  }
  return cursor;
}

function isCanonicalSlot(value: readonly unknown[]): boolean {
  const first = value[0];
  return (
    typeof first === 'object' &&
    first !== null &&
    'value' in (first as Record<string, unknown>) &&
    'provenance' in (first as Record<string, unknown>)
  );
}

/** G-7 / G-11: state codes compare as trimmed upper-case strings; blank is missing. */
function stateTierOf(state: unknown): number | null {
  const code = canonicalStateCode(state);
  if (code === null) return null;
  if (TARGET_STATES.includes(code)) return 2;
  if (ACCEPTABLE_STATES.includes(code)) return 1;
  return 0;
}

/** The raw measured value for one component. `null` means missing (m = 0). */
function rawComponent(
  submission: CanonicalSubmission,
  component: VectorComponentSpec,
): number | null {
  switch (component.key) {
    // G-11: trimmed and case-folded; empty or whitespace-only is missing (G-2).
    case 'isNewBusiness': {
      const value: unknown = pickValue(submission.submissionType);
      if (value === null || value === undefined) return null;
      if (typeof value === 'string' && value.trim() === '') return null;
      return canonicalSubmissionType(value) === 'new_business' ? 1 : 0;
    }
    case 'isPropertyLine': {
      const value: unknown = submission.lineOfBusiness;
      if (value === null || value === undefined) return null;
      if (typeof value !== 'string') return 0;
      const line = canonicalLineOfBusiness(value);
      if (line === null) return null;
      return line === 'commercial_property' ? 1 : 0;
    }
    case 'stateTier':
      return stateTierOf(readSource(submission, component.source));
    default:
      return asNumber(readSource(submission, component.source));
  }
}

/** INTERPRETATIONS 3.4: the building_age factor tier from both TIV shares. */
function buildingAgeTier(pre1990: number | null, post2010: number | null): number | null {
  if (pre1990 === null && post2010 === null) return null;
  if (pre1990 !== null && pre1990 > MAJORITY_SHARE) return TIER_NOT_ACCEPTABLE;
  if (post2010 !== null && post2010 > MAJORITY_SHARE) return TIER_TARGET;
  return TIER_ACCEPTABLE;
}

/** The tier value for one component, given the whole raw vector. */
function tierForComponent(
  component: VectorComponentSpec,
  x: readonly (number | null)[],
  byKey: ReadonlyMap<string, number>,
): number | null {
  if (!component.appetiteFactor) return null;
  const value = x[component.index] ?? null;

  switch (component.key) {
    // T-BLANK: Acceptable is the best outcome the document allows, so it is 1.
    case 'isNewBusiness':
    case 'isPropertyLine':
      return value === null ? null : value === 1 ? TIER_TARGET : TIER_NOT_ACCEPTABLE;

    case 'stateTier': {
      if (value === null) return null;
      if (value >= 2) return TIER_TARGET;
      if (value >= 1) return TIER_ACCEPTABLE;
      return TIER_NOT_ACCEPTABLE;
    }

    // 3.1 — Target iff 50e6 <= tiv <= 100e6; Not Acceptable iff tiv > 150e6.
    case 'totalTiv': {
      if (value === null) return null;
      if (value > TIV_ACCEPTABLE_MAX) return TIER_NOT_ACCEPTABLE;
      if (value >= TIV_TARGET_MIN && value <= TIV_TARGET_MAX) return TIER_TARGET;
      return TIER_ACCEPTABLE;
    }

    // 3.2 — Not Acceptable iff p < 50000 or p > 175000; Target iff 75000 <= p <= 100000.
    case 'quotedPremium': {
      if (value === null) return null;
      if (value < PREMIUM_ACCEPTABLE_MIN || value > PREMIUM_ACCEPTABLE_MAX) {
        return TIER_NOT_ACCEPTABLE;
      }
      if (value >= PREMIUM_TARGET_MIN && value <= PREMIUM_TARGET_MAX) return TIER_TARGET;
      return TIER_ACCEPTABLE;
    }

    // 3.4 + T-SPAN — both components carry the same building_age tier.
    case 'pctTivPre1990':
    case 'pctTivPost2010': {
      const preIndex = byKey.get('pctTivPre1990');
      const postIndex = byKey.get('pctTivPost2010');
      const pre = preIndex === undefined ? null : (x[preIndex] ?? null);
      const post = postIndex === undefined ? null : (x[postIndex] ?? null);
      return buildingAgeTier(pre, post);
    }

    // 3.5 — exactly 50% acceptable construction is Acceptable, and T-BLANK makes it 1.
    case 'pctTivAcceptableConstruction':
      if (value === null) return null;
      return value >= MAJORITY_SHARE ? TIER_TARGET : TIER_NOT_ACCEPTABLE;

    // 3.3 — Not Acceptable iff loss > 100000; exactly 100000 is Acceptable, so T-BLANK gives 1.
    case 'fiveYearLoss': {
      if (value === null) return null;
      const floored = value < 0 ? 0 : value;
      return floored > LOSS_ACCEPTABLE_MAX ? TIER_NOT_ACCEPTABLE : TIER_TARGET;
    }

    default:
      return null;
  }
}

function indexByKey(spec: VectorSpec): Map<string, number> {
  const byKey = new Map<string, number>();
  for (const component of spec.components) byKey.set(component.key, component.index);
  return byKey;
}

/** The component's value in scaling space, before the min-max against the book. */
function transform(value: number, component: VectorComponentSpec): number {
  switch (component.scaling.rule) {
    case 'log_minmax':
      return logScale(value);
    case 'log1p_minmax':
      return log1pScale(value);
    default:
      return value;
  }
}

function statsByIndex(stats: BookStats | null): Map<number, ComponentStats> {
  const map = new Map<number, ComponentStats>();
  if (stats === null) return map;
  for (const entry of stats.components) map.set(entry.index, entry);
  return map;
}

/** Every known, finite value of one component across the book, in raw space. */
function rawColumn(
  vectors: readonly FeatureVector[],
  index: number,
): number[] {
  const out: number[] = [];
  for (const vector of vectors) {
    if (vector.m[index] !== 1) continue;
    const value = vector.x[index];
    if (isFiniteNumber(value)) out.push(value);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Stage 6                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Pure function of the merged submission. `bookStats` only affects the scaled
 * space used by peers and flip; `x`, `t` and `m` are independent of it.
 */
export function vectorize(
  submission: CanonicalSubmission,
  spec: VectorSpec,
  rulebook: Rulebook,
): FeatureVector {
  const x: (number | null)[] = [];
  for (const component of spec.components) {
    x[component.index] = rawComponent(submission, component);
  }
  for (let i = 0; i < spec.components.length; i += 1) {
    if (x[i] === undefined) x[i] = null;
  }

  const t = tiersFor(x, spec, rulebook);
  const m: (0 | 1)[] = x.map((value) => (value === null ? 0 : 1));

  return {
    lineOfBusiness: spec.lineOfBusiness,
    specVersion: spec.version,
    x,
    t,
    m,
  };
}

/**
 * The tier vector alone, for tests that build `x` directly.
 *
 * The boundaries are the frozen constants of INTERPRETATIONS §3, which
 * `rules/commercial.json` (E13) encodes as data; the rulebook is carried on the
 * signature so a later rule-driven tiering can replace this without a contract
 * change. See `docs/decisions/E05.md`.
 */
export function tiersFor(
  x: readonly (number | null)[],
  spec: VectorSpec,
  _rulebook: Rulebook,
): (number | null)[] {
  const byKey = indexByKey(spec);
  const t: (number | null)[] = new Array<number | null>(spec.components.length).fill(null);
  for (const component of spec.components) {
    t[component.index] = tierForComponent(component, x, byKey);
  }
  return t;
}

/**
 * PRD 12: clamp into [0, 1]. Unlike `clamp01`, +Infinity maps to 1 (not 0), and
 * NaN maps to 0, so an overflowed intermediate still lands on the right edge.
 */
function clampUnit(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

/** `v / divisor` into [0, 1]; a zero or non-finite divisor gives 0 (as `divideScale`). */
function divideUnit(v: number, divisor: number): number {
  if (!isFiniteNumber(divisor) || divisor === 0) return 0;
  return clampUnit(v / divisor);
}

/**
 * Min-max into [0, 1], overflow-safe. Identical to `minMax` for ordinary
 * inputs; when `max - min` or `v - min` overflows to ±Infinity (a book or value
 * near ±Number.MAX_VALUE) both are computed on halves, which cannot overflow,
 * so the ratio is never Infinity/Infinity = NaN.
 */
function minMaxUnit(v: number, min: number, max: number): number {
  if (!isFiniteNumber(v) || !isFiniteNumber(min) || !isFiniteNumber(max)) return 0;
  let span = max - min;
  let offset = v - min;
  if (!Number.isFinite(span) || !Number.isFinite(offset)) {
    span = max / 2 - min / 2;
    offset = v / 2 - min / 2;
    if (span <= RATIO_TOLERANCE / 2) return 0;
  } else if (span <= RATIO_TOLERANCE) {
    return 0;
  }
  return clampUnit(offset / span);
}

/** Each component of `x` mapped into 0..1 scaling space per its spec rule. */
export function scaleVector(
  x: readonly (number | null)[],
  spec: VectorSpec,
  stats: BookStats | null,
): (number | null)[] {
  const byIndex = statsByIndex(stats);
  const out: (number | null)[] = new Array<number | null>(spec.components.length).fill(null);

  for (const component of spec.components) {
    const value = x[component.index] ?? null;
    if (value === null || !isFiniteNumber(value)) {
      out[component.index] = null;
      continue;
    }
    const rule = component.scaling.rule;
    // PRD 12: every scaled component is clamped into [0, 1]. A finite but
    // absurd raw value (±Number.MAX_VALUE, a negative share) is KNOWN and clamps.
    if (rule === 'none') {
      out[component.index] = clampUnit(value);
      continue;
    }
    if (rule === 'divide') {
      out[component.index] = divideUnit(value, component.scaling.divisor ?? 1);
      continue;
    }
    const componentStats = byIndex.get(component.index);
    if (componentStats === undefined) {
      // No book to scale against: the component contributes nothing to a
      // distance, exactly as a degenerate min-max range does (§6 minMax).
      out[component.index] = 0;
      continue;
    }
    out[component.index] = minMaxUnit(
      transform(value, component),
      componentStats.min,
      componentStats.max,
    );
  }

  return out;
}

/** Min/max/mean/median per component, computed over the whole book. */
export function computeBookStats(
  vectors: readonly FeatureVector[],
  spec: VectorSpec,
): BookStats {
  const components: ComponentStats[] = [];

  for (const component of spec.components) {
    const raw = rawColumn(vectors, component.index);
    const scaled = raw.map((value) => transform(value, component));
    const min = scaled.length === 0 ? 0 : Math.min(...scaled);
    const max = scaled.length === 0 ? 0 : Math.max(...scaled);
    components[component.index] = {
      index: component.index,
      key: component.key,
      // Min/max are stored AFTER the log transform, i.e. in scaling space, so a
      // second implementation must not log them again (INTERPRETATIONS §6).
      min,
      max,
      // Mean and median stay in raw space: only min/max are documented as
      // post-transform on `ComponentStats`. See `docs/decisions/E05.md`.
      mean: mean(raw) ?? 0,
      median: median(raw) ?? 0,
      count: raw.length,
    };
  }

  const byKey = indexByKey(spec);
  const tivIndex = byKey.get('totalTiv');
  const premiumIndex = byKey.get('quotedPremium');
  const lossIndex = byKey.get('fiveYearLoss');

  const rates: number[] = [];
  if (tivIndex !== undefined && premiumIndex !== undefined) {
    for (const vector of vectors) {
      if (vector.m[tivIndex] !== 1 || vector.m[premiumIndex] !== 1) continue;
      const tiv = vector.x[tivIndex];
      const premium = vector.x[premiumIndex];
      if (!isFiniteNumber(tiv) || !isFiniteNumber(premium)) continue;
      const rate = safeDiv(premium, tiv / 100);
      if (rate !== null) rates.push(rate);
    }
  }

  const annualLosses: number[] =
    lossIndex === undefined
      ? []
      : rawColumn(vectors, lossIndex).map((loss) => loss / LOSS_WINDOW_YEARS);

  return {
    lineOfBusiness: spec.lineOfBusiness,
    specVersion: spec.version,
    n: vectors.length,
    components,
    medianRatePer100: median(rates),
    meanAnnualLoss: mean(annualLosses),
    // Claim counts and severities are not carried on the feature vector, so
    // they cannot be derived here. See `docs/decisions/E05.md`.
    meanClaimFrequency: null,
    meanClaimSeverity: null,
  };
}
