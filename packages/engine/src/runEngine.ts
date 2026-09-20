/**
 * Stage composer. Body owned by Run 1 unit E16.
 *
 * Runs stages 3-11 in order over one submission; `peers` (12) and `rank` (13)
 * run over the whole book afterwards. Pure: every clock value arrives on
 * `input.asOf`.
 */
import { QUALITY_WEIGHTS } from './constants.js';
import { contradict } from './stages/contradict.js';
import { evaluate } from './stages/evaluate.js';
import { flip } from './stages/flip.js';
import { merge } from './stages/merge.js';
import { peers } from './stages/peers.js';
import { price } from './stages/price.js';
import { qualityIndex } from './stages/rank.js';
import { rollup } from './stages/rollup.js';
import { vectorize } from './stages/vectorize.js';
import { verdict } from './stages/verdict.js';
import { voi } from './stages/voi.js';
import type {
  AppliedInterpretation,
  CanonicalSubmission,
  Contradiction,
  EngineConfig,
  EngineInput,
  EngineResult,
  FlipResult,
  PeerResult,
} from './types.js';

/** Interpretations applied by evaluate, de-duplicated by id in first-seen order. */
function uniqueInterpretations(
  list: readonly AppliedInterpretation[],
): AppliedInterpretation[] {
  const seen = new Set<string>();
  const out: AppliedInterpretation[] = [];
  for (const item of list) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

/**
 * R1-2: flip searches vector space and cannot resolve a contradiction (V05 #6),
 * so its search ignores them. A zero-move flip says "already FIT"; while an
 * open HIGH contradiction stands the engine's verdict is REFER, so that flip is
 * replaced by `null` with the contradictions as the reason. A flip WITH moves
 * is kept: those moves clear every appetite and extension rule, and resolving
 * the contradiction is a separate broker question (docs/decisions/R2b-G3.md).
 */
function withContradictions(
  flipped: FlipResult,
  contradictions: readonly Contradiction[],
): FlipResult {
  if (flipped.flip === null || flipped.flip.moves.length > 0) return flipped;
  const open = contradictions.filter((c) => c.status === 'open' && c.severity === 'HIGH');
  if (open.length === 0) return flipped;
  return {
    flip: null,
    reason: `No move reaches FIT while ${String(open.length)} open high-severity ${
      open.length === 1 ? 'contradiction stands' : 'contradictions stand'
    } (${open.map((c) => c.canonicalPath).join(', ')}); resolve ${open.length === 1 ? 'it' : 'them'} first.`,
    blockedByImmovable: flipped.blockedByImmovable,
  };
}

/**
 * Order (see docs/decisions/E16.md): merge runs BEFORE rollup, so the derived
 * numbers (TIV shares, primary state, five-year loss) reflect enrichment,
 * sweep and answer values, not only the broker's. Peers run inside the
 * composer when `peerVectors` is non-empty because `price` blends the peer
 * mean annual loss into expected loss; an empty list disables them.
 */
export function runEngine(input: EngineInput, config: EngineConfig): EngineResult {
  const { spec, rulebook, extensions, ratingTable, bookStats } = config;

  // Stage 4 — merge every external value into the canonical submission.
  const merged = merge(
    input.submission,
    input.enrichment ?? [],
    input.observations ?? [],
    input.answers ?? [],
  );

  // Stage 3 — rollup over the merged facts; the vector reads `rollup.*`.
  const rolled = rollup(merged, input.asOf);
  const canonical: CanonicalSubmission = { ...merged, rollup: rolled };

  // Stage 5 — contradictions.
  const contradictions = contradict(canonical, rulebook, extensions);

  // Stage 6 — vector.
  const vector = vectorize(canonical, spec, rulebook);

  // Stage 7 — evaluate.
  const evaluated = evaluate(vector, spec, rulebook, canonical, extensions);

  // Stage 12 (optional here) — peers feed the expected-loss complement.
  const peerVectors = input.peerVectors ?? [];
  // Pricing blends only exact-vector peers. The coarse match (PRD 6.4: requested
  // limit, insured revenue, HQ state for an account with no policy) places the
  // account among peers for the benchmark, but must never reach price(): a
  // requested limit is not a TIV. DECISIONS R2-9.
  const pricingPeers: PeerResult | null =
    peerVectors.length === 0 ? null : peers(vector, spec, peerVectors, bookStats);
  const peerResult: PeerResult | null =
    peerVectors.length === 0 ? null : peers(vector, spec, peerVectors, bookStats, undefined, canonical);

  // Stage 8 — price.
  const priced = price(vector, spec, ratingTable, canonical, bookStats, pricingPeers);

  // Stage 10 before 9: the verdict reports the flip's size (V-9). Flip runs
  // with the extension rulebook so its FIT is evaluated the way the verdict is.
  const flipped = withContradictions(
    flip(vector, spec, rulebook, ratingTable, canonical, bookStats, extensions),
    contradictions,
  );

  // Stage 9 — verdict.
  const decided = verdict(evaluated, contradictions, flipped);

  // Stage 11 — value of information.
  const information = voi(vector, spec, rulebook, evaluated, config.questions ?? []);

  const partial: EngineResult = {
    id: canonical.id,
    lineOfBusiness: canonical.lineOfBusiness,
    asOf: input.asOf,
    specVersion: spec.version,
    rulebookVersion: rulebook.version,
    ratingVersion: ratingTable.version,
    canonical,
    rollup: rolled,
    vector,
    contradictions,
    evaluate: evaluated,
    price: priced,
    verdict: decided,
    flip: flipped,
    voi: information,
    peers: peerResult,
    qualityIndex: 0,
    qualityComponents: {
      appetite: 0,
      adequacy: 0,
      lossRatio: 0,
      completeness: 0,
      confidence: 0,
    },
    interpretations: uniqueInterpretations(evaluated.interpretationsApplied),
    // The PRD 7.7 template lives in packages/federato (explain/template.ts),
    // which reads this whole result; the engine never writes prose.
    explanation: null,
  };

  const quality = qualityIndex(partial, config.qualityWeights ?? QUALITY_WEIGHTS);
  return { ...partial, qualityIndex: quality.index, qualityComponents: quality.components };
}
