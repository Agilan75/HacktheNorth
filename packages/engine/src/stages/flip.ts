/** Stage 10 — flip. Body owned by Run 1 unit E08. */
import type {
  BookStats,
  CanonicalSubmission,
  Condition,
  FeatureVector,
  Flip,
  FlipMove,
  FlipResult,
  RatingTable,
  Rule,
  Rulebook,
  VectorComponentSpec,
  VectorSpec,
} from '../types.js';
import { evaluateCondition, vectorResolver } from '../util/conditions.js';
import { isFiniteNumber } from '../util/math.js';
import { scaleVector, tiersFor } from './vectorize.js';
import { evaluate } from './evaluate.js';
import { verdict } from './verdict.js';
import { price } from './price.js';

/** The acceptable interval for one component, in raw (x) units. */
export interface FlipBound {
  readonly componentIndex: number;
  readonly componentKey: string;
  readonly min: number | null;
  readonly max: number | null;
  readonly satisfied: boolean;
  readonly immovable: boolean;
}

/* -------------------------------------------------------------------------- */
/* Private helpers (HELPERS.md: private to this file, never exported)          */
/* -------------------------------------------------------------------------- */

/**
 * `vectors/commercial.json` carries `factor`, `appetiteFactor` and `immovable`
 * on every component. `VectorComponentSpec` names `immovable`, so only the
 * defensive read below is needed; the widening mirrors the one E06 uses.
 */
type ComponentSpec = VectorComponentSpec & { readonly factor?: string };

/** F-5: the smallest representable step past an exclusive boundary. */
const STEP_BUFFER = new DataView(new ArrayBuffer(8));

function bitsOf(v: number): bigint {
  STEP_BUFFER.setFloat64(0, v);
  return STEP_BUFFER.getBigUint64(0);
}

function floatOf(bits: bigint): number {
  STEP_BUFFER.setBigUint64(0, bits);
  return STEP_BUFFER.getFloat64(0);
}

function nextUp(v: number): number {
  if (!isFiniteNumber(v)) return v;
  if (v === 0) return Number.MIN_VALUE;
  const bits = bitsOf(v);
  return floatOf(v > 0 ? bits + 1n : bits - 1n);
}

function nextDown(v: number): number {
  if (!isFiniteNumber(v)) return v;
  if (v === 0) return -Number.MIN_VALUE;
  const bits = bitsOf(v);
  return floatOf(v > 0 ? bits - 1n : bits + 1n);
}

/** One acceptable interval on one component, in raw units. */
interface Interval {
  readonly lo: number | null;
  readonly loInclusive: boolean;
  readonly hi: number | null;
  readonly hiInclusive: boolean;
  readonly ruleId: string;
  readonly fixHint: string | undefined;
  readonly preferred: boolean;
}

function contains(interval: Interval, v: number): boolean {
  if (interval.lo !== null) {
    if (interval.loInclusive ? v < interval.lo : v <= interval.lo) return false;
  }
  if (interval.hi !== null) {
    if (interval.hiInclusive ? v > interval.hi : v >= interval.hi) return false;
  }
  return true;
}

/** F-5: land at the boundary when inclusive, one representable step past it when not. */
function landingFor(interval: Interval, from: number | null): number | null {
  if (from !== null && contains(interval, from)) return from;

  const lowSide =
    from === null
      ? interval.lo !== null
      : interval.lo !== null && (interval.loInclusive ? from < interval.lo : from <= interval.lo);

  if (lowSide && interval.lo !== null) {
    return interval.loInclusive ? interval.lo : nextUp(interval.lo);
  }
  if (interval.hi !== null) {
    return interval.hiInclusive ? interval.hi : nextDown(interval.hi);
  }
  return interval.lo;
}

/** Numeric conditions on one component, folded into one interval. */
function intervalFromRule(rule: Rule, key: string): Interval | null {
  let lo: number | null = null;
  let loInclusive = true;
  let hi: number | null = null;
  let hiInclusive = true;
  let touched = false;

  const raise = (v: number, inclusive: boolean): void => {
    if (lo === null || v > lo || (v === lo && !inclusive)) {
      lo = v;
      loInclusive = inclusive;
    }
  };
  const lower = (v: number, inclusive: boolean): void => {
    if (hi === null || v < hi || (v === hi && !inclusive)) {
      hi = v;
      hiInclusive = inclusive;
    }
  };

  for (const condition of rule.when) {
    if (condition.field !== key) continue;
    const value = condition.value;
    switch (condition.op) {
      case 'gte':
        if (!isFiniteNumber(value)) return null;
        raise(value, true);
        touched = true;
        break;
      case 'gt':
        if (!isFiniteNumber(value)) return null;
        raise(value, false);
        touched = true;
        break;
      case 'lte':
        if (!isFiniteNumber(value)) return null;
        lower(value, true);
        touched = true;
        break;
      case 'lt':
        if (!isFiniteNumber(value)) return null;
        lower(value, false);
        touched = true;
        break;
      case 'eq':
        if (!isFiniteNumber(value)) return null;
        raise(value, true);
        lower(value, true);
        touched = true;
        break;
      case 'in': {
        if (!Array.isArray(value)) return null;
        const numbers = value.filter(isFiniteNumber);
        if (numbers.length === 0 || numbers.length !== value.length) return null;
        raise(Math.min(...numbers), true);
        lower(Math.max(...numbers), true);
        touched = true;
        break;
      }
      case 'exists':
        touched = true;
        break;
      default:
        // `neq`, `notin`, `missing` do not describe an interval.
        return null;
    }
  }

  if (!touched) return null;
  if (lo !== null && hi !== null && (lo as number) > (hi as number)) return null;

  return {
    lo,
    loInclusive,
    hi,
    hiInclusive,
    ruleId: rule.id,
    fixHint: rule.fixHint,
    preferred: rule.tier === 'target',
  };
}

/**
 * True when every condition of the rule that does NOT address `key` and DOES
 * address a component the vector carries already holds. A condition naming a
 * canonical path the vector cannot resolve is ignored: flip has no submission
 * context at bound time and never blocks on what it cannot judge.
 */
function otherConditionsHold(
  rule: Rule,
  key: string,
  keys: ReadonlySet<string>,
  resolve: (field: string) => unknown,
): boolean {
  for (const condition of rule.when) {
    if (condition.field === key) continue;
    const bare = condition.field.replace(/\.(t|m)$/, '');
    if (!keys.has(bare)) continue;
    if (!evaluateCondition(condition, resolve)) return false;
  }
  return true;
}

function isRefusingTier(rule: Rule): boolean {
  return rule.tier === 'not_acceptable' || rule.tier === 'refer';
}

/** A plain, locale-free number rendering for move labels. */
function show(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return String(Math.round(v * 1e6) / 1e6);
}

function moveLabel(component: ComponentSpec, from: number | null, to: number): string {
  if (from === null) return `Supply ${component.label}: ${show(to)}`;
  const verb = to > from ? 'Raise' : 'Lower';
  return `${verb} ${component.label} from ${show(from)} to ${show(to)}`;
}

/* -------------------------------------------------------------------------- */
/* flipBounds                                                                 */
/* -------------------------------------------------------------------------- */

/** Turn the rulebook's thresholds into per-component acceptable intervals. */
export function flipBounds(
  vector: FeatureVector,
  spec: VectorSpec,
  rulebook: Rulebook,
): FlipBound[] {
  const components = spec.components as readonly ComponentSpec[];
  const keys = new Set(components.map((component) => component.key));
  const resolve = vectorResolver(vector, spec);
  const scaled = scaleVector(vector.x, spec, null);

  return components.map((component) => {
    const from = vector.m[component.index] === 1 ? (vector.x[component.index] ?? null) : null;

    const intervals: Interval[] = [];
    for (const rule of rulebook.rules) {
      if (isRefusingTier(rule)) continue;
      if (!rule.when.some((condition: Condition) => condition.field === component.key)) continue;
      if (!otherConditionsHold(rule, component.key, keys, resolve)) continue;
      const interval = intervalFromRule(rule, component.key);
      if (interval !== null) intervals.push(interval);
    }

    if (intervals.length === 0) {
      return {
        componentIndex: component.index,
        componentKey: component.key,
        min: null,
        max: null,
        satisfied: true,
        immovable: component.immovable === true,
      };
    }

    const holding = from === null ? null : (intervals.find((i) => contains(i, from)) ?? null);
    let chosen: Interval;
    if (holding !== null) {
      chosen = holding;
    } else {
      // Nearest boundary wins; a Target interval breaks an exact tie.
      let best = intervals[0] as Interval;
      let bestCost = Number.POSITIVE_INFINITY;
      for (const interval of intervals) {
        const landing = landingFor(interval, from);
        if (landing === null) continue;
        const cost =
          from === null
            ? 1
            : Math.abs(scaledValueAt(landing, component, spec, null) - (scaled[component.index] ?? 0));
        if (cost < bestCost || (cost === bestCost && interval.preferred && !best.preferred)) {
          best = interval;
          bestCost = cost;
        }
      }
      chosen = best;
    }

    return {
      componentIndex: component.index,
      componentKey: component.key,
      min: chosen.lo,
      max: chosen.hi,
      satisfied: from !== null && contains(chosen, from),
      immovable: component.immovable === true,
    };
  });
}

/** One component's value in scaled (0..1) space, holding the others irrelevant. */
function scaledValueAt(
  value: number,
  component: ComponentSpec,
  spec: VectorSpec,
  bookStats: BookStats | null,
): number {
  const probe: (number | null)[] = new Array<number | null>(spec.components.length).fill(null);
  probe[component.index] = value;
  return scaleVector(probe, spec, bookStats)[component.index] ?? 0;
}

/* -------------------------------------------------------------------------- */
/* flip                                                                       */
/* -------------------------------------------------------------------------- */

interface Candidate {
  readonly component: ComponentSpec;
  readonly from: number | null;
  readonly to: number;
  readonly deltaScaled: number;
  readonly fixHint: string | undefined;
}

/** The shortest scaled move over at most 2 movable components that reaches FIT. */
export function flip(
  vector: FeatureVector,
  spec: VectorSpec,
  rulebook: Rulebook,
  table: RatingTable,
  submission: CanonicalSubmission,
  bookStats: BookStats | null,
): FlipResult {
  const components = spec.components as readonly ComponentSpec[];

  const evaluatedBefore = evaluate(vector, spec, rulebook, submission);
  const verdictBefore = verdict(evaluatedBefore, []);
  const scoreBefore = evaluatedBefore.appetiteScore;
  const premiumBefore = predictedPremium(vector, spec, table, submission, bookStats);

  // V-9: a FIT account is zero moves from appetite, not "no flip".
  if (verdictBefore.verdict === 'FIT') {
    return {
      flip: {
        moves: [],
        scoreBefore,
        scoreAfter: scoreBefore,
        premiumBefore,
        premiumAfter: premiumBefore,
        verdictAfter: 'FIT',
        distanceScaled: 0,
      },
      reason: null,
      blockedByImmovable: [],
    };
  }

  const bounds = flipBounds(vector, spec, rulebook);
  const failing = bounds.filter((bound) => !bound.satisfied);
  const blockedByImmovable = failing.filter((b) => b.immovable).map((b) => b.componentKey);

  // F-3: nothing that fails can be moved.
  if (failing.length > 0 && blockedByImmovable.length === failing.length) {
    return {
      flip: null,
      reason: `Every failing component is immovable: ${blockedByImmovable.join(', ')}.`,
      blockedByImmovable,
    };
  }

  const scaledBefore = scaleVector(vector.x, spec, bookStats);
  const candidates: Candidate[] = [];
  for (const bound of failing) {
    if (bound.immovable) continue;
    const component = components[bound.componentIndex];
    if (component === undefined) continue;
    const from = vector.m[component.index] === 1 ? (vector.x[component.index] ?? null) : null;
    const to = landingFor(
      {
        lo: bound.min,
        loInclusive: true,
        hi: bound.max,
        hiInclusive: true,
        ruleId: '',
        fixHint: undefined,
        preferred: false,
      },
      from,
    );
    if (to === null || !isFiniteNumber(to)) continue;
    const deltaScaled =
      from === null
        ? 1
        : Math.abs(
            scaledValueAt(to, component, spec, bookStats) - (scaledBefore[component.index] ?? 0),
          );
    candidates.push({ component, from, to, deltaScaled, fixHint: fixHintFor(rulebook, component.key) });
  }

  if (candidates.length === 0) {
    return {
      flip: null,
      reason:
        blockedByImmovable.length > 0
          ? `No movable component can reach appetite; ${blockedByImmovable.join(', ')} cannot be changed.`
          : 'No component in the rulebook describes a move that reaches appetite.',
      blockedByImmovable,
    };
  }

  // F-1: singles first, then pairs. Nothing wider is ever considered.
  const sets: Candidate[][] = candidates.map((c) => [c]);
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      sets.push([candidates[i] as Candidate, candidates[j] as Candidate]);
    }
  }

  let bestMoves: Candidate[] | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestVector: FeatureVector | null = null;
  let bestScore = scoreBefore;

  for (const set of sets) {
    const moved = applyMoves(vector, spec, rulebook, set);
    const evaluatedAfter = evaluate(moved, spec, rulebook, submission);
    if (verdict(evaluatedAfter, []).verdict !== 'FIT') continue; // F-6

    const distance = Math.hypot(...set.map((c) => c.deltaScaled));
    if (better(distance, set, bestDistance, bestMoves)) {
      bestMoves = set;
      bestDistance = distance;
      bestVector = moved;
      bestScore = evaluatedAfter.appetiteScore;
    }
  }

  if (bestMoves === null || bestVector === null) {
    return {
      flip: null,
      reason:
        blockedByImmovable.length > 0
          ? `No move over at most two movable components reaches FIT; ${blockedByImmovable.join(', ')} cannot be changed.`
          : 'No move over at most two components reaches FIT.',
      blockedByImmovable,
    };
  }

  const moves: FlipMove[] = bestMoves
    .slice()
    .sort((a, b) => a.component.index - b.component.index)
    .map((c) => {
      const move: FlipMove = {
        componentIndex: c.component.index,
        componentKey: c.component.key,
        from: c.from,
        to: c.to,
        deltaScaled: c.deltaScaled,
        label: moveLabel(c.component, c.from, c.to),
        ...(c.fixHint === undefined ? {} : { fixHint: c.fixHint }),
      };
      return move;
    });

  const result: Flip = {
    moves,
    scoreBefore,
    scoreAfter: bestScore,
    premiumBefore,
    premiumAfter: predictedPremium(bestVector, spec, table, submission, bookStats),
    verdictAfter: 'FIT',
    distanceScaled: bestDistance,
  };

  return { flip: result, reason: null, blockedByImmovable };
}

/** F-4: smallest Euclidean length, then fewer moves, then lower component index. */
function better(
  distance: number,
  set: readonly Candidate[],
  bestDistance: number,
  best: readonly Candidate[] | null,
): boolean {
  if (best === null) return true;
  if (distance !== bestDistance) return distance < bestDistance;
  if (set.length !== best.length) return set.length < best.length;
  const a = set.map((c) => c.component.index).sort((x, y) => x - y);
  const b = best.map((c) => c.component.index).sort((x, y) => x - y);
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) return (a[i] as number) < (b[i] as number);
  }
  return false;
}

/** A copy of the vector with the moves applied, with `t` and `m` re-derived. */
function applyMoves(
  vector: FeatureVector,
  spec: VectorSpec,
  rulebook: Rulebook,
  moves: readonly Candidate[],
): FeatureVector {
  const x = vector.x.slice();
  for (const move of moves) x[move.component.index] = move.to;
  const t = tiersFor(x, spec, rulebook);
  const m = x.map((value) => (value === null ? 0 : 1)) as (0 | 1)[];
  return { lineOfBusiness: vector.lineOfBusiness, specVersion: vector.specVersion, x, t, m };
}

/** The first `fixHint` the rulebook offers for a component, if any. */
function fixHintFor(rulebook: Rulebook, key: string): string | undefined {
  for (const rule of rulebook.rules) {
    if (typeof rule.fixHint !== 'string') continue;
    if (rule.when.some((condition: Condition) => condition.field === key)) return rule.fixHint;
  }
  return undefined;
}

/**
 * Stage 8's predicted premium, or `null`. Flip is a vector-space stage and must
 * not fail when pricing cannot produce a number (no rating table, no book, or
 * `price` still a Run-1 stub): the Flip DTO already allows `null` there.
 */
function predictedPremium(
  vector: FeatureVector,
  spec: VectorSpec,
  table: RatingTable,
  submission: CanonicalSubmission,
  bookStats: BookStats | null,
): number | null {
  try {
    const breakdown = price(vector, spec, table, submission, bookStats, null);
    const value = breakdown.predictedPremium;
    return isFiniteNumber(value) ? value : null;
  } catch {
    return null;
  }
}
