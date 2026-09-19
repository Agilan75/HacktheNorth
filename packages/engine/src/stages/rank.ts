/** Stage 13 — rank, plus the quality index. Body owned by Run 1 unit E10. */
import type { EngineResult, QualityComponents, QualityWeights, RankedEntry } from '../types.js';
import { clamp, clamp01, isFiniteNumber, safeDiv } from '../util/math.js';

/* -------------------------------------------------------------------------- */
/* Private helpers                                                             */
/* -------------------------------------------------------------------------- */

type QualityKey = keyof QualityComponents;

const QUALITY_KEYS: readonly QualityKey[] = [
  'appetite',
  'adequacy',
  'lossRatio',
  'completeness',
  'confidence',
];

/** A weight that is not a finite non-negative number contributes nothing. */
function weightOf(weights: QualityWeights, key: QualityKey): number {
  const w = weights[key];
  return isFiniteNumber(w) && w > 0 ? w : 0;
}

/**
 * The five P-5 terms on 0..100, or `null` when the term's input is missing.
 * A null term is dropped from the index (P-5), never imputed.
 */
function terms(result: EngineResult): Record<QualityKey, number | null> {
  const quoted = result.price.quotedPremium;
  const predicted = result.price.predictedPremium;
  const expectedLoss = result.price.expectedAnnualLoss;

  // adequacy = quotedPremium / predictedPremium; adequacy' = clamp(adequacy, 0, 2) / 2 * 100
  const adequacy = safeDiv(quoted, predicted);
  const adequacyTerm = adequacy === null ? null : (clamp(adequacy, 0, 2) / 2) * 100;

  // lossRatio = expectedAnnualLoss / quotedPremium; (1 - lossRatio)' = clamp(1 - lossRatio, 0, 1) * 100
  const lossRatio = safeDiv(expectedLoss, quoted);
  const lossTerm = lossRatio === null ? null : clamp01(1 - lossRatio) * 100;

  const appetite = result.evaluate.appetiteScore;
  const completeness = result.evaluate.completeness;
  const confidence = result.evaluate.confidence;

  return {
    appetite: isFiniteNumber(appetite) ? clamp(appetite, 0, 100) : null,
    adequacy: adequacyTerm,
    lossRatio: lossTerm,
    completeness: isFiniteNumber(completeness) ? clamp(completeness, 0, 100) : null,
    confidence: isFiniteNumber(confidence) ? clamp01(confidence) * 100 : null,
  };
}

function compareId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/* -------------------------------------------------------------------------- */
/* Quality index (PRD 6.8, INTERPRETATIONS P-5)                                */
/* -------------------------------------------------------------------------- */

/**
 * `quality = Σ wᵢ·termᵢ / Σ wᵢ` over the terms whose input is present. With the
 * default weights (summing to 1) and every term present this is exactly the P-5
 * formula; a null term is dropped and the rest renormalized. A dropped term is
 * reported as `0` in `components` — the raw nullable inputs stay on the result
 * (`price.adequacy`, `price.quotedPremium`) for anyone who needs to tell them
 * apart. No term present at all gives an index of 0.
 */
export function qualityIndex(
  result: EngineResult,
  weights: QualityWeights,
): { index: number; components: QualityComponents } {
  const t = terms(result);
  let weighted = 0;
  let weightSum = 0;
  for (const key of QUALITY_KEYS) {
    const value = t[key];
    if (value === null) continue;
    const w = weightOf(weights, key);
    weighted += w * value;
    weightSum += w;
  }
  const index = weightSum > 0 ? clamp(weighted / weightSum, 0, 100) : 0;

  return {
    index,
    components: {
      appetite: t.appetite ?? 0,
      adequacy: t.adequacy ?? 0,
      lossRatio: t.lossRatio ?? 0,
      completeness: t.completeness ?? 0,
      confidence: t.confidence ?? 0,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Rank (PRD 6.8, INTERPRETATIONS P-6)                                         */
/* -------------------------------------------------------------------------- */

/**
 * Knockouts rank below every non-knockout regardless of index, ordered among
 * themselves by distance to appetite, then by index.
 *
 * Non-knockouts: quality index descending, then id ascending.
 * Knockouts: `distanceToAppetite` ascending (`null` last), then quality index
 * descending, then id ascending (P-6).
 *
 * When `weights` is given every index is recomputed with it; otherwise the
 * index already carried on each result is used as-is.
 */
export function rank(
  results: readonly EngineResult[],
  weights?: QualityWeights,
): RankedEntry[] {
  const rows = results.map((result) => {
    const scored =
      weights === undefined
        ? { index: result.qualityIndex, components: result.qualityComponents }
        : qualityIndex(result, weights);
    return {
      result,
      index: isFiniteNumber(scored.index) ? scored.index : 0,
      components: scored.components,
      knockout: result.evaluate.knockout,
      distance: result.verdict.distanceToAppetite,
    };
  });

  rows.sort((a, b) => {
    if (a.knockout !== b.knockout) return a.knockout ? 1 : -1;
    if (a.knockout) {
      if (a.distance !== b.distance) {
        if (a.distance === null) return 1;
        if (b.distance === null) return -1;
        return a.distance - b.distance;
      }
    }
    if (a.index !== b.index) return b.index - a.index;
    return compareId(a.result.id, b.result.id);
  });

  return rows.map((row, i) => ({
    id: row.result.id,
    rank: i + 1,
    qualityIndex: row.index,
    components: row.components,
    verdict: row.result.verdict.verdict,
    appetiteScore: row.result.evaluate.appetiteScore,
    knockout: row.knockout,
    distanceToAppetite: row.distance,
    completeness: row.result.evaluate.completeness,
    confidence: row.result.evaluate.confidence,
    adequacy: safeDiv(row.result.price.quotedPremium, row.result.price.predictedPremium),
  }));
}
