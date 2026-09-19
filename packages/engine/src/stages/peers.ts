/** Stage 12 — peers. Body owned by Run 1 unit E10. */
import type {
  BookStats,
  FeatureVector,
  PeerMatch,
  PeerResult,
  PeerVectorEntry,
  VectorSpec,
} from '../types.js';
import { K_PEERS, PEER_COMPONENT_MIN_INDEX } from '../constants.js';
import { isFiniteNumber, mean, median, scaledEuclidean } from '../util/math.js';
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

/* -------------------------------------------------------------------------- */
/* Stage                                                                       */
/* -------------------------------------------------------------------------- */

export function peers(
  vector: FeatureVector,
  spec: VectorSpec,
  candidates: readonly PeerVectorEntry[],
  bookStats: BookStats | null,
  k: number = K_PEERS,
): PeerResult {
  const full = peerIndices(spec);
  const coarse = coarseIndices(spec);
  const selfCoarse = isReduced(vector, full, coarse);
  const componentsUsed = selfCoarse ? coarse : full;

  const effectiveK = isFiniteNumber(k) ? Math.max(0, Math.trunc(k)) : K_PEERS;
  const selfScaled = scaleVector(vector.x, spec, bookStats);

  const scored: PeerMatch[] = [];
  for (const candidate of candidates) {
    const candidateScaled = scaleVector(candidate.vector.x, spec, bookStats);
    const d = scaledEuclidean(
      selfScaled,
      candidateScaled,
      vector.m,
      candidate.vector.m,
      componentsUsed,
    );
    // P-1: nothing compared means the pair is not a peer at all.
    if (d === null) continue;
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
  }

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
