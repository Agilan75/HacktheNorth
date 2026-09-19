import type { GeneratedCase, Invariant, InvariantSuite, InvariantViolation } from '../types.js';
import {
  engineApplyMoves,
  engineEvaluateVector,
  engineFlipForCase,
  engineVectorForInput,
  verifyEngineConfig,
} from '../compare.js';

/**
 * Flip invariants (V05): applying the returned flip always yields FIT, a flip
 * never moves more than two components, and it never touches an immovable one
 * (INTERPRETATIONS F-1..F-6).
 *
 * The flip is recomputed from the case's rolled-up facts through the engine
 * adapter in `../compare.ts` (the only V05 file that imports the engine), and
 * memoised per case so the three checks share one stage-10 run.
 */

/** INTERPRETATIONS F-1. */
const MAX_MOVES = 2;

/**
 * INTERPRETATIONS F-2, stated independently of the spec so that a spec whose
 * `immovable` flags drift is caught too: components 0, 1, 2, 5, 6, 8, 10.
 */
const F2_IMMOVABLE_KEYS: readonly string[] = [
  'isNewBusiness',
  'isPropertyLine',
  'stateTier',
  'pctTivPre1990',
  'pctTivPost2010',
  'fiveYearLoss',
  'tivWeightedProtectionClass',
];

function violation(
  invariant: string,
  testCase: GeneratedCase,
  message: string,
  observed: unknown,
  expected: unknown,
): InvariantViolation {
  return { invariant, caseId: testCase.caseId, seed: testCase.seed, message, observed, expected };
}

export const appliedFlipYieldsFit: Invariant = (testCase) => {
  const name = 'appliedFlipYieldsFit';
  const result = engineFlipForCase(testCase);
  const out: InvariantViolation[] = [];

  if (result.flip === null) {
    if (result.reason === null || result.reason === '') {
      out.push(violation(name, testCase, 'flip is null but no reason is given', result.reason, 'a reason'));
    }
    return out;
  }

  const found = result.flip;
  if (result.reason !== null) {
    out.push(violation(name, testCase, 'flip returned together with a reason', result.reason, null));
  }
  if (found.verdictAfter !== 'FIT') {
    out.push(violation(name, testCase, 'flip reports verdictAfter other than FIT (F-6)', found.verdictAfter, 'FIT'));
  }

  // Re-apply the moves independently and re-run stages 7 and 9. Flip is a
  // vector-space stage: it cannot resolve a contradiction, so the re-run is in
  // the same no-contradiction context the flip was searched in.
  const before = engineVectorForInput(testCase.input);
  const after = engineApplyMoves(before, found.moves);
  const rerun = engineEvaluateVector(after, testCase.input, false);
  if (rerun.verdict.verdict !== 'FIT') {
    out.push(
      violation(
        name,
        testCase,
        'applying the returned flip does not yield FIT (F-6)',
        { verdict: rerun.verdict.verdict, moves: found.moves.map((m) => ({ key: m.componentKey, to: m.to })) },
        'FIT',
      ),
    );
  }
  if (Math.abs(rerun.evaluated.appetiteScore - found.scoreAfter) > 1e-6) {
    out.push(
      violation(name, testCase, 'flip scoreAfter differs from the re-evaluated score', found.scoreAfter, rerun.evaluated.appetiteScore),
    );
  }
  return out;
};

export const flipMovesAtMostTwoComponents: Invariant = (testCase) => {
  const name = 'flipMovesAtMostTwoComponents';
  const result = engineFlipForCase(testCase);
  if (result.flip === null) return [];
  const moves = result.flip.moves;
  const out: InvariantViolation[] = [];

  if (moves.length > MAX_MOVES) {
    out.push(violation(name, testCase, 'flip moves more than two components (F-1)', moves.length, `<= ${MAX_MOVES}`));
  }
  const indices = moves.map((m) => m.componentIndex);
  if (new Set(indices).size !== indices.length) {
    out.push(violation(name, testCase, 'flip moves one component twice', indices, 'distinct components'));
  }
  // The moves are the whole diff: nothing outside them may change.
  const before = engineVectorForInput(testCase.input);
  const after = engineApplyMoves(before, moves);
  const changed: number[] = [];
  for (let i = 0; i < before.x.length; i += 1) {
    if (!Object.is(before.x[i], after.x[i])) changed.push(i);
  }
  if (changed.length > MAX_MOVES) {
    out.push(violation(name, testCase, 'applying the flip changes more than two components', changed, `<= ${MAX_MOVES}`));
  }
  return out;
};

export const flipNeverTouchesImmovable: Invariant = (testCase) => {
  const name = 'flipNeverTouchesImmovable';
  const result = engineFlipForCase(testCase);
  const { spec } = verifyEngineConfig();
  const out: InvariantViolation[] = [];

  // F-3: a component reported as blocking must really be immovable.
  for (const key of result.blockedByImmovable) {
    const component = spec.components.find((c) => c.key === key);
    if (component === undefined || component.immovable !== true) {
      out.push(violation(name, testCase, 'blockedByImmovable names a movable component (F-3)', key, 'an immovable component'));
    }
  }

  if (result.flip === null) return out;
  for (const move of result.flip.moves) {
    const component = spec.components[move.componentIndex];
    if (component === undefined || component.key !== move.componentKey) {
      out.push(
        violation(name, testCase, 'move index and key disagree with the spec', { index: move.componentIndex, key: move.componentKey }, component?.key ?? null),
      );
    }
    const specImmovable = component?.immovable === true;
    if (specImmovable || F2_IMMOVABLE_KEYS.includes(move.componentKey)) {
      out.push(violation(name, testCase, 'flip proposes an immovable component (F-2)', move.componentKey, 'a movable component'));
    }
  }
  return out;
};

export function flipSuite(): InvariantSuite {
  return {
    name: 'flip',
    invariants: [
      { name: 'appliedFlipYieldsFit', check: appliedFlipYieldsFit },
      { name: 'flipMovesAtMostTwoComponents', check: flipMovesAtMostTwoComponents },
      { name: 'flipNeverTouchesImmovable', check: flipNeverTouchesImmovable },
    ],
  };
}
