/** Stage 12 — peers. Body owned by Run 1 unit E10. */
import type {
  BookStats,
  CanonicalSubmission,
  FeatureVector,
  PeerMatch,
  PeerResult,
  PeerVectorEntry,
  VectorSpec,
} from '../types.js';
import { ACCEPTABLE_STATES, K_PEERS, PEER_COMPONENT_MIN_INDEX, TARGET_STATES } from '../constants.js';
import { isFiniteNumber, logScale, mean, median, minMax } from '../util/math.js';
import { canonicalStateCode } from './normalize.js';
import { scaleVector } from './vectorize.js';

/* -------------------------------------------------------------------------- */
/* Private helpers (HELPERS.md: private to this file, never exported)          */
/* -------------------------------------------------------------------------- */

/**
 * The component keys that survive the reduction to a coarse match: the
 * requested limit (carried by `totalTiv`) and the headquarters state (carried
 * by `stateTier`). PRD 6.5 also names insured revenue, which the commercial
 * vector spec does not carry as a component, so it cannot take part in the
 * distance. See `docs/decisions/E10.md`.
 */
const COARSE_KEYS: readonly string[] = ['totalTiv', 'stateTier'];

/** Indices the peer distance may ever use: components 2..n (P-1). */
function peerIndices(spec: VectorSpec): number[] {
  return spec.components
    .map((component) => component.index)
    .filter((index) => index >= PEER_COMPONENT_MIN_INDEX)
    .sort((a, b) => a - b);
}

function coarseIndices(spec: VectorSpec): number[] {
  return spec.components
    .filter(
      (component) =>
        component.index >= PEER_COMPONENT_MIN_INDEX && COARSE_KEYS.includes(component.key),
    )
    .map((component) => component.index)
    .sort((a, b) => a - b);
}

/**
 * True when the account carries nothing beyond the reduced set: every peer
 * component outside `coarse` is missing. That is exactly the shape of the 11
 * property accounts with no policy (PRD 6.5, LIVE_DATA_FACTS): no premium, no
 * buildings, so no full vector.
 */
function isReduced(vector: FeatureVector, full: readonly number[], coarse: readonly number[]): boolean {
  const coarseSet = new Set(coarse);
  for (const index of full) {
    if (coarseSet.has(index)) continue;
    if (vector.m[index] === 1) return false;
  }
  return true;
}


/** Outcome of one pair distance: a finite, non-negative number, or why there is none. */
type PairDistance =
  | { readonly ok: true; readonly distance: number; readonly comparedComponents: number }
  | { readonly ok: false; readonly reason: string };

/**
 * Scaled Euclidean distance over the known components in `include` (PRD 6.4):
 *
 *   d = sqrt( sum_i (a_i - b_i)^2 / nCompared )
 *
 * Robust on its own, whatever scaling hands it (CP1 FX2):
 * - a component is compared only when both masks say known AND both scaled
 *   values are finite; anything else is skipped and not counted;
 * - the sum is taken over values pre-divided by the largest magnitude compared,
 *   so ±Number.MAX_VALUE cannot overflow to Infinity or NaN; the result is
 *   capped at Number.MAX_VALUE, so it is always finite and >= 0;
 * - symmetric: every step is the same IEEE operation in either order
 *   ((a/s - b/s)^2 === (b/s - a/s)^2, summed in index order);
 * - zero only when every compared pair is identical: a non-zero difference that
 *   underflows in the pre-division is floored at Number.MIN_VALUE.
 * No component comparable is the one case with no distance.
 */
function pairDistance(
  a: readonly (number | null | undefined)[],
  b: readonly (number | null | undefined)[],
  maskA: readonly (0 | 1)[],
  maskB: readonly (0 | 1)[],
  include: readonly number[],
): PairDistance {
  const used: number[] = [];
  let scale = 0;
  let anyDifferent = false;
  for (const i of include) {
    if (maskA[i] !== 1 || maskB[i] !== 1) continue;
    const ai = a[i];
    const bi = b[i];
    if (!isFiniteNumber(ai) || !isFiniteNumber(bi)) continue;
    used.push(i);
    scale = Math.max(scale, Math.abs(ai), Math.abs(bi));
    if (ai !== bi) anyDifferent = true;
  }
  if (used.length === 0) {
    return {
      ok: false,
      reason: 'no comparable component: no index in componentsUsed is known with a finite scaled value on both sides',
    };
  }
  if (!anyDifferent) return { ok: true, distance: 0, comparedComponents: used.length };

  // Pre-divide only when a square could overflow; otherwise keep the plain formula.
  const s = scale > 1 ? scale : 1;
  let acc = 0;
  for (const i of used) {
    const d = (a[i] as number) / s - (b[i] as number) / s;
    acc += d * d;
  }
  let distance = s * Math.sqrt(acc / used.length);
  if (!Number.isFinite(distance)) distance = Number.MAX_VALUE;
  if (!(distance > 0)) distance = Number.MIN_VALUE;
  return { ok: true, distance, comparedComponents: used.length };
}

/* -------------------------------------------------------------------------- */
/* Coarse inputs (PRD 6.4: requested limit, insured revenue, HQ state)         */
/* -------------------------------------------------------------------------- */

/**
 * A candidate may carry the insured's annual revenue. It is not a vector
 * component, so it travels beside the entry (rescore sets it); an entry
 * without it is simply not compared on revenue.
 */
type CoarseCandidate = PeerVectorEntry & { readonly revenue?: number | null };

/** First finite number in a canonical slot, or null. */
function firstFinite(slot: readonly { readonly value: unknown }[] | undefined): number | null {
  if (slot === undefined) return null;
  for (const field of slot) if (isFiniteNumber(field.value)) return field.value;
  return null;
}

function firstString(slot: readonly { readonly value: unknown }[] | undefined): string | null {
  if (slot === undefined) return null;
  for (const field of slot) if (typeof field.value === 'string' && field.value.trim() !== '') return field.value;
  return null;
}

/** HQ state on the same 0/1/2 scale vectorize gives the primary risk state. */
function hqStateTier(submission: CanonicalSubmission): number | null {
  const code = canonicalStateCode(firstString(submission.insured.headquartersState));
  if (code === null) return null;
  if (TARGET_STATES.includes(code)) return 2;
  if (ACCEPTABLE_STATES.includes(code)) return 1;
  return 0;
}

/**
 * The comparison-only vector for a no-policy account: its own known coarse
 * components, with a missing `totalTiv` filled by the requested limit and a
 * missing `stateTier` by the HQ state tier. A fresh object: the account's own
 * FeatureVector (the one scoring reads) is never touched.
 */
function coarseComparisonVector(
  vector: FeatureVector,
  spec: VectorSpec,
  submission: CanonicalSubmission,
): FeatureVector {
  const x = [...vector.x];
  const m = [...vector.m];
  const fill = (key: string, value: number | null): void => {
    const index = spec.components.find((component) => component.key === key)?.index;
    if (index === undefined || m[index] === 1 || value === null) return;
    x[index] = value;
    m[index] = 1;
  };
  fill('totalTiv', firstFinite(submission.exposure.requestedLimit));
  fill('stateTier', hqStateTier(submission));
  return { ...vector, x, m };
}

/** log, then min-max over every revenue present in this comparison. */
function scaledRevenues(revenues: readonly (number | null)[]): (number | null)[] {
  const logs = revenues.map((r) => (r === null || !isFiniteNumber(r) || r <= 0 ? null : logScale(r)));
  const known = logs.filter((v): v is number => v !== null);
  if (known.length === 0) return logs;
  const lo = Math.min(...known);
  const hi = Math.max(...known);
  return logs.map((v) => (v === null ? null : minMax(v, lo, hi)));
}

/* -------------------------------------------------------------------------- */
/* Stage                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * `self` is optional. When it is given and this account has only the reduced
 * vector (no policy), the PRD 6.4 coarse inputs place it among the POLICY book:
 * requested limit against total TIV, HQ state tier against primary-state tier,
 * and insured revenue where both sides carry it. Every such match is coarse.
 * The coarse inputs feed this distance only; they never enter x/t/m.
 */
export function peers(
  vector: FeatureVector,
  spec: VectorSpec,
  candidates: readonly PeerVectorEntry[],
  bookStats: BookStats | null,
  k: number = K_PEERS,
  self?: CanonicalSubmission,
): PeerResult {
  const full = peerIndices(spec);
  const coarse = coarseIndices(spec);
  const selfCoarse = isReduced(vector, full, coarse);
  const componentsUsed = selfCoarse ? coarse : full;
  const coarseInputs = selfCoarse && self !== undefined;

  const effectiveK = isFiniteNumber(k) ? Math.max(0, Math.trunc(k)) : K_PEERS;
  const compared = coarseInputs ? coarseComparisonVector(vector, spec, self) : vector;
  const selfScaled = scaleVector(compared.x, spec, bookStats);

  // A no-policy account is benchmarked against accounts with a policy only:
  // another no-policy account has no rate and no loss to offer.
  const pool: readonly CoarseCandidate[] = coarseInputs
    ? candidates.filter((candidate) => !candidate.coarse)
    : candidates;

  // Revenue rides one slot past the spec's last index, compared only on the coarse path.
  const revenueIndex = spec.components.length;
  const revenues = coarseInputs
    ? scaledRevenues([
        firstFinite(self.insured.revenue),
        ...pool.map((candidate) => (isFiniteNumber(candidate.revenue) ? candidate.revenue : null)),
      ])
    : [];
  const include = coarseInputs ? [...componentsUsed, revenueIndex] : componentsUsed;
  const withRevenue = (
    scaled: (number | null)[],
    mask: readonly (0 | 1)[],
    revenue: number | null | undefined,
  ): { scaled: (number | null)[]; mask: (0 | 1)[] } => {
    if (!coarseInputs) return { scaled, mask: [...mask] };
    const known = revenue !== null && revenue !== undefined;
    return { scaled: [...scaled, known ? revenue : null], mask: [...mask, known ? 1 : 0] };
  };
  const selfSide = withRevenue(selfScaled, compared.m, revenues[0]);

  const scored: PeerMatch[] = [];
  pool.forEach((candidate, j) => {
    const candidateSide = withRevenue(
      scaleVector(candidate.vector.x, spec, bookStats),
      candidate.vector.m,
      revenues[j + 1],
    );
    const d = pairDistance(selfSide.scaled, candidateSide.scaled, selfSide.mask, candidateSide.mask, include);
    // P-1: nothing compared (d.reason) means the pair is not a peer at all.
    if (!d.ok) return;
    scored.push({
      id: candidate.id,
      ...(candidate.label === undefined ? {} : { label: candidate.label }),
      distance: d.distance,
      comparedComponents: d.comparedComponents,
      ratePer100: candidate.ratePer100,
      annualLoss: candidate.annualLoss,
      totalTiv: candidate.totalTiv,
      quotedPremium: candidate.quotedPremium,
      coarse: candidate.coarse || selfCoarse,
    });
  });

  // P-4: ties in distance are broken by ascending id, so the set is stable.
  scored.sort((a, b) => (a.distance === b.distance ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.distance - b.distance));

  // P-2: fewer than k candidates returns what exists.
  const matched = scored.slice(0, effectiveK);

  return {
    k: effectiveK,
    peers: matched,
    // P-3: rate is the MEDIAN across the matched peers, loss is the MEAN.
    medianRatePer100: median(matched.map((p) => p.ratePer100)),
    meanAnnualLoss: mean(matched.map((p) => p.annualLoss)),
    coarse: selfCoarse,
    componentsUsed,
  };
}

/**
 * The reduced vector used for the 11 accounts with no policy: requested limit,
 * insured revenue and headquarters state only. Matches are labelled coarse.
 */
export function reduceForCoarseMatch(
  vector: FeatureVector,
  spec: VectorSpec,
): FeatureVector {
  const keep = new Set(coarseIndices(spec));
  const n = spec.components.length;
  const x: (number | null)[] = new Array<number | null>(n).fill(null);
  const t: (number | null)[] = new Array<number | null>(n).fill(null);
  const m: (0 | 1)[] = new Array<0 | 1>(n).fill(0);

  for (let i = 0; i < n; i += 1) {
    if (!keep.has(i)) continue;
    if (vector.m[i] !== 1) continue;
    x[i] = vector.x[i] ?? null;
    t[i] = vector.t[i] ?? null;
    m[i] = 1;
  }

  return {
    lineOfBusiness: vector.lineOfBusiness,
    specVersion: vector.specVersion,
    x,
    t,
    m,
  };
}
