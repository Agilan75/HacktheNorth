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
  EngineConfig,
  EngineInput,
  EngineResult,
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
  const peerResult: PeerResult | null =
    peerVectors.length === 0 ? null : peers(vector, spec, peerVectors, bookStats);

  // Stage 8 — price.
  const priced = price(vector, spec, ratingTable, canonical, bookStats, peerResult);

  // Stage 10 before 9: the verdict reports the flip's size (V-9).
  const flipped = flip(vector, spec, rulebook, ratingTable, canonical, bookStats);

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
