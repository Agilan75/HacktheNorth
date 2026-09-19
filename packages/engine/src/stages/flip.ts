/** Stage 10 — flip. Body owned by Run 1 unit E08. */
import type {
  BookStats,
  BuildingFacts,
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
import { bestValue } from '../util/fields.js';
import { ACCEPTABLE_CONSTRUCTION, ASSUMED_ACCEPTABLE_CONSTRUCTION } from '../constants.js';
import { canonicalConstructionType } from './normalize.js';
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

/** A bound together with the exact interval (inclusivity kept) it was read from. */
interface ResolvedBound {
  readonly bound: FlipBound;
  readonly interval: Interval | null;
}

/**
 * The shared body of `flipBounds` and `flip`. `flip` needs the chosen
 * interval's inclusivity for F-5, which `FlipBound` (frozen) does not carry.
 *
 * The nearest interval is measured in RAW units: `flipBounds` has no
 * `BookStats`, and without them every `log_minmax` component scales to 0, which
 * would make every candidate interval tie. Within one component any monotone
 * scaling orders same-side landings identically, so raw distance is the honest
 * choice here; F-4's scaled length is applied later, across components, in `flip`.
 */
function resolveBounds(
  vector: FeatureVector,
  spec: VectorSpec,
  rulebook: Rulebook,
): ResolvedBound[] {
  const components = spec.components as readonly ComponentSpec[];
  const keys = new Set(components.map((component) => component.key));
  const resolve = vectorResolver(vector, spec);

  return components.map((component) => {
    const from = vector.m[component.index] === 1 ? (vector.x[component.index] ?? null) : null;
    const immovable = component.immovable === true;
    // A component can sit outside every interval that names it and still pass:
    // `pctTivPost2010` appears only in AG-AGE-T, yet building_age is Acceptable
    // through AG-AGE-A at post2010 = 0. Its factor's tier (T-SPAN: shared by
    // every component of the factor) is the judge; only tier 0 is failing.
    const tier = vector.t[component.index];
    const factorPasses = component.factor !== null && isFiniteNumber(tier) && tier > 0;

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
        bound: {
          componentIndex: component.index,
          componentKey: component.key,
          min: null,
          max: null,
          satisfied: true,
          immovable,
        },
        interval: null,
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
        const cost = from === null ? 0 : Math.abs(landing - from);
        if (cost < bestCost || (cost === bestCost && interval.preferred && !best.preferred)) {
          best = interval;
          bestCost = cost;
        }
      }
      chosen = best;
    }

    return {
      bound: {
        componentIndex: component.index,
        componentKey: component.key,
        min: chosen.lo,
        max: chosen.hi,
        satisfied: from !== null && (contains(chosen, from) || factorPasses),
        immovable,
      },
      interval: chosen,
    };
  });
}

/** Turn the rulebook's thresholds into per-component acceptable intervals. */
export function flipBounds(
  vector: FeatureVector,
  spec: VectorSpec,
  rulebook: Rulebook,
): FlipBound[] {
  return resolveBounds(vector, spec, rulebook).map((resolved) => resolved.bound);
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

/**
 * The shortest scaled move over at most 2 movable components that reaches FIT.
 *
 * `extensions` are the same extension rules stage 7 evaluates with; the FIT test
 * before and after every candidate move includes them, so an extension refer is
 * never reported as FIT (F-6, R2-fixer-6 R1-2). Open contradictions stay out of
 * the search (V05 decision 6).
 */
export function flip(
  vector: FeatureVector,
  spec: VectorSpec,
  rulebook: Rulebook,
  table: RatingTable,
  submission: CanonicalSubmission,
  bookStats: BookStats | null,
  extensions?: Rulebook,
): FlipResult {
  const components = spec.components as readonly ComponentSpec[];

  const evaluatedBefore = evaluate(vector, spec, rulebook, submission, extensions);
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

  // An extension refer on an immovable component can never be cleared by a move.
  const extensionBlocked = [
    ...new Set(
      evaluatedBefore.firedRules
        .filter((r) => r.extension && r.tier === 'refer')
        .flatMap((r) => r.conditions.map((c) => c.field))
        .filter((field) => components.some((c) => c.key === field && c.immovable === true)),
    ),
  ];
  if (extensionBlocked.length > 0) {
    return {
      flip: null,
      reason: `An extension rule refers the account on an immovable component: ${extensionBlocked.join(', ')}.`,
      blockedByImmovable: extensionBlocked,
    };
  }

  // Extension rules are candidates too: a REFER raised only by a MOVABLE
  // extension rule (e.g. sprinklers) gets a real move, not a null. DECISIONS R2-6.
  const searchBook: Rulebook = extensions
    ? { ...rulebook, rules: [...rulebook.rules, ...extensions.rules] }
    : rulebook;
  const resolved = resolveBounds(vector, spec, searchBook).filter((r) => !r.bound.satisfied);
  const failing = resolved.map((r) => r.bound);
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
  for (const { bound, interval } of resolved) {
    if (bound.immovable || interval === null) continue; // F-2
    const component = components[bound.componentIndex];
    if (component === undefined) continue;
    const from = vector.m[component.index] === 1 ? (vector.x[component.index] ?? null) : null;
    const to = landingFor(interval, from); // F-5: inclusivity preserved
    if (to === null || !isFiniteNumber(to)) continue;
    const deltaScaled =
      from === null
        ? 1
        : Math.abs(
            scaledValueAt(to, component, spec, bookStats) - (scaledBefore[component.index] ?? 0),
          );
    candidates.push({
      component,
      from,
      to,
      deltaScaled,
      fixHint: interval.fixHint ?? fixHintFor(rulebook, component.key),
    });
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
    const evaluatedAfter = evaluate(moved, spec, rulebook, submission, extensions);
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
    premiumAfter: predictedPremium(
      bestVector,
      spec,
      table,
      movedSubmission(submission, bestMoves),
      bookStats,
    ),
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

/* -------------------------------------------------------------------------- */
/* The moved submission (R2-fixer-6, R1-3)                                    */
/* -------------------------------------------------------------------------- */

/**
 * Commercial pricing reads the buildings, not the vector, so the price after a
 * move needs the buildings the move describes. Mirrors rollup's class aliases
 * (private there, docs/decisions/E03.md).
 */
const CLASS_ALIASES: Readonly<Record<string, string>> = {
  steel_frame: 'steel',
  jm: 'joisted_masonry',
  noncombustible: 'non_combustible',
  masonry_noncombustible: 'masonry_non_combustible',
};

/** The class a construction move re-rates shifted TIV at, when no building has one. */
const DEFAULT_ACCEPTABLE_CLASS = 'Joisted Masonry';

function slotNumber(slot: BuildingFacts['tiv']): number | null {
  const best = bestValue(slot);
  return best !== null && isFiniteNumber(best.value) ? best.value : null;
}

function isAcceptableClass(building: BuildingFacts): boolean {
  const raw = bestValue(building.constructionType)?.value;
  const snake = canonicalConstructionType(raw);
  if (snake === null) return false;
  const key = CLASS_ALIASES[snake] ?? snake;
  return ACCEPTABLE_CONSTRUCTION.includes(key) || ASSUMED_ACCEPTABLE_CONSTRUCTION.includes(key);
}

function isSprinklered(building: BuildingFacts): boolean {
  return bestValue(building.sprinklered)?.value === true;
}

function withTiv(building: BuildingFacts, tiv: number): BuildingFacts {
  const slot = building.tiv ?? [];
  const provenance = bestValue(slot)?.provenance ?? { source: 'self_reported' as const };
  return { ...building, tiv: [{ value: tiv, provenance }] };
}

/**
 * Move `amount` of TIV from buildings outside a class into it, in building
 * order. A building moved in part is split: the rest keeps its facts, the moved
 * part becomes a sibling with the converted fact.
 */
function shiftTiv(
  buildings: readonly BuildingFacts[],
  inClass: (b: BuildingFacts) => boolean,
  convert: (b: BuildingFacts) => BuildingFacts,
  amount: number,
): BuildingFacts[] {
  let remaining = amount;
  const out: BuildingFacts[] = [];
  for (const building of buildings) {
    const tiv = slotNumber(building.tiv);
    if (remaining <= 0 || tiv === null || tiv <= 0 || inClass(building)) {
      out.push(building);
      continue;
    }
    const moved = Math.min(tiv, remaining);
    remaining -= moved;
    if (moved === tiv) {
      out.push(convert(building));
    } else {
      out.push(withTiv(building, tiv - moved));
      out.push(withTiv({ ...convert(building), externalId: `${building.externalId}~flip` }, moved));
    }
  }
  return out;
}

/** A copy of the submission with the flip's moves applied to the facts pricing reads. */
function movedSubmission(
  submission: CanonicalSubmission,
  moves: readonly Candidate[],
): CanonicalSubmission {
  let buildings: BuildingFacts[] = submission.buildings.slice();
  let pricing = submission.pricing;
  const ordered = moves.slice().sort((a, b) => a.component.index - b.component.index);

  for (const move of ordered) {
    const knownTiv = buildings.reduce((acc, b) => acc + Math.max(0, slotNumber(b.tiv) ?? 0), 0);
    switch (move.component.key) {
      case 'totalTiv': {
        if (move.from === null || move.from <= 0) break;
        const k = move.to / move.from;
        buildings = buildings.map((b) => {
          const tiv = slotNumber(b.tiv);
          return tiv === null ? b : withTiv(b, tiv * k);
        });
        break;
      }
      case 'pctTivAcceptableConstruction': {
        const from = move.from ?? 0;
        if (move.to <= from || knownTiv <= 0) break;
        const target =
          buildings
            .filter(isAcceptableClass)
            .sort((a, b) => (slotNumber(b.tiv) ?? 0) - (slotNumber(a.tiv) ?? 0))[0]
            ?.constructionType ?? [
            { value: DEFAULT_ACCEPTABLE_CLASS, provenance: { source: 'self_reported' as const } },
          ];
        buildings = shiftTiv(
          buildings,
          isAcceptableClass,
          (b) => ({ ...b, constructionType: target }),
          (move.to - from) * knownTiv,
        );
        break;
      }
      case 'pctTivSprinklered': {
        const from = move.from ?? 0;
        if (move.to <= from || knownTiv <= 0) break;
        buildings = shiftTiv(
          buildings,
          isSprinklered,
          (b) => ({
            ...b,
            sprinklered: [{ value: true, provenance: { source: 'self_reported' as const } }],
          }),
          (move.to - from) * knownTiv,
        );
        break;
      }
      case 'quotedPremium':
        pricing = {
          ...pricing,
          quotedPremium: [{ value: move.to, provenance: { source: 'self_reported' as const } }],
        };
        break;
      default:
        break;
    }
  }
  return { ...submission, buildings, pricing };
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
