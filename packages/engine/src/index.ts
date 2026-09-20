/**
 * `@retrofit/engine` — public barrel. FROZEN after Run 0.
 *
 * The engine is pure and deterministic: no I/O (except the `read*` loaders in
 * `data.ts`, which no stage calls), no `Date.now`, no `Math.random`, no LLM SDK,
 * and no import from `apps/*`.
 */

export * from './types.js';
export * from './constants.js';
export * from './schemas.js';

export * as math from './util/math.js';
export {
  sourceConfidence,
  tableConfidence,
  bestValue,
  hasCompetingValues,
  addValue,
  combinedConfidence,
  readPath,
} from './util/fields.js';
export {
  evaluateCondition,
  evaluateConditions,
  isUndetermined,
  vectorResolver,
} from './util/conditions.js';
export type { ConditionResolver } from './util/conditions.js';

export { discover } from './stages/discover.js';
export type { SchemaAssist } from './stages/discover.js';
export { normalize } from './stages/normalize.js';
export { rollup } from './stages/rollup.js';
export { merge } from './stages/merge.js';
export { contradict } from './stages/contradict.js';
export {
  vectorize,
  tiersFor,
  scaleVector,
  computeBookStats,
} from './stages/vectorize.js';
export { evaluate } from './stages/evaluate.js';
export { price, priceCommercial, priceTenant, expectedAnnualLoss } from './stages/price.js';
export { verdict } from './stages/verdict.js';
export { flip, flipBounds } from './stages/flip.js';
export type { FlipBound } from './stages/flip.js';
export { voi } from './stages/voi.js';
export { peers, reduceForCoarseMatch } from './stages/peers.js';
export { rank, qualityIndex } from './stages/rank.js';

export { runEngine } from './runEngine.js';

export {
  panelForBearing,
  panelsForFrame,
  coverageArcs,
  largestUncoveredGap,
  coverage,
  placeObject,
  placeObjects,
} from './sweep/geometry.js';
export {
  dedupeObservations,
  applySelfConsistency,
  negativeEvidence,
  pairRules,
  toHazardValues,
  unknownHazards,
} from './sweep/observations.js';

export {
  parseRulebook,
  parseVectorSpec,
  parseRatingTable,
  parseQuestions,
  dataFilePath,
  readVectorSpec,
  readRulebook,
  readRatingTable,
  readQuestions,
} from './data.js';
