import type {
  EngineResultView,
  GeneratedCase,
  Invariant,
  InvariantSuite,
  InvariantViolation,
  NaiveInput,
} from '../types.js';

/**
 * Core invariants (V04), PRD §12 layer A: determinism, knockout implies
 * DOES_NOT_FIT, completeness and confidence stay in range, no crash on nulls,
 * empty arrays or absurd values.
 *
 * The frozen `Invariant` signature hands a check exactly one case and one
 * result, and nothing in `packages/verify` outside the comparator and the
 * worker may import the engine. Invariants that need to re-run the engine
 * (determinism here, every monotonicity check in `monotonic.ts`) therefore use
 * an injected **probe**: the worker (V08), which already owns an engine
 * adapter, installs it once per thread with `setInvariantProbe`. Without a
 * probe those checks fall back to what one result alone can prove, and never
 * pretend to have re-run anything. See docs/decisions/V04.md.
 */

/* ------------------------------------------------------------ the probe */

/** An engine result, optionally carrying the fields the view leaves out. */
export interface ProbedResult extends EngineResultView {
  /** Predicted premium in dollars (PRD §6.7); `null`/absent when not priced. */
  readonly predictedPremium?: number | null;
  /** Confidence in [0, 1] (INTERPRETATIONS V-7); absent when not reported. */
  readonly confidence?: number | null;
}

/** Re-runs the engine on a (possibly perturbed) rolled-up input. */
export type InvariantProbe = (input: NaiveInput) => ProbedResult;

let installedProbe: InvariantProbe | null = null;

/** Installs (or, with `null`, removes) the probe for this thread. */
export function setInvariantProbe(probe: InvariantProbe | null): void {
  installedProbe = probe;
  determinismMemo.clear();
}

export function getInvariantProbe(): InvariantProbe | null {
  return installedProbe;
}

/* ------------------------------------------------------ private helpers */

/** INTERPRETATIONS §7. */
const SCORE_TOLERANCE = 1e-6;
const RATIO_TOLERANCE = 1e-9;
/** V-6: components 0–8 are required. */
const REQUIRED_COMPONENTS = 9;
const TIER_VALUES: readonly number[] = [0, 0.6, 1];
const VERDICTS: readonly string[] = ['FIT', 'REFER', 'DOES_NOT_FIT'];
const MEMO_LIMIT = 20000;

function violation(
  invariant: string,
  testCase: GeneratedCase,
  message: string,
  observed: unknown,
  expected: unknown,
): InvariantViolation {
  return { invariant, caseId: testCase.caseId, seed: testCase.seed, message, observed, expected };
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** JSON with sorted keys; non-finite numbers are spelled out so NaN ≠ null. */
function stableStringify(value: unknown): string {
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return '"NaN"';
    if (value === Infinity) return '"Infinity"';
    if (value === -Infinity) return '"-Infinity"';
    return Object.is(value, -0) ? '0' : String(value);
  }
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(',')}}`;
}

/** The parts of a result determinism compares: the view fields only. */
function viewKey(result: EngineResultView): string {
  return stableStringify({
    appetiteScore: result.appetiteScore,
    completeness: result.completeness,
    verdict: result.verdict,
    knockoutFactorIds: result.knockoutFactorIds,
    decidingFactorId: result.decidingFactorId,
    tierValuesByFactor: result.tierValuesByFactor,
  });
}

/** Bounded input → result memo, so a repeated input is checked even without a probe. */
const determinismMemo = new Map<string, string>();

function remember(inputKey: string, resultKey: string): void {
  if (determinismMemo.size >= MEMO_LIMIT) {
    const oldest = determinismMemo.keys().next();
    if (!oldest.done) determinismMemo.delete(oldest.value);
  }
  determinismMemo.set(inputKey, resultKey);
}

/* ----------------------------------------------------------- invariants */

/** Same input → same output (PRD §12 layer A). */
export const determinism: Invariant = (testCase, result) => {
  const name = 'determinism';
  const out: InvariantViolation[] = [];
  const inputKey = stableStringify(testCase.input);
  const resultKey = viewKey(result);

  const seen = determinismMemo.get(inputKey);
  if (seen !== undefined && seen !== resultKey) {
    out.push(
      violation(name, testCase, 'the same input was evaluated earlier with a different result', resultKey, seen),
    );
  } else if (seen === undefined) {
    remember(inputKey, resultKey);
  }

  const probe = installedProbe;
  if (probe) {
    for (let run = 0; run < 2; run += 1) {
      let againKey: string;
      try {
        againKey = viewKey(probe(testCase.input));
      } catch (error) {
        out.push(
          violation(name, testCase, `re-evaluating the same input threw: ${String(error)}`, 'throw', resultKey),
        );
        break;
      }
      if (againKey !== resultKey) {
        out.push(
          violation(name, testCase, `re-evaluation ${run + 1} of the same input differs`, againKey, resultKey),
        );
        break;
      }
    }
  }
  return out;
};

/**
 * A knockout always yields DOES_NOT_FIT (V-1), DOES_NOT_FIT only ever comes
 * from a knockout, and the knockout set is exactly the known factors whose
 * tier value is 0 (G-3).
 */
export const knockoutImpliesDoesNotFit: Invariant = (testCase, result) => {
  const name = 'knockoutImpliesDoesNotFit';
  const out: InvariantViolation[] = [];
  const knockouts = Array.isArray(result.knockoutFactorIds) ? result.knockoutFactorIds : [];

  if (!Array.isArray(result.knockoutFactorIds)) {
    out.push(violation(name, testCase, 'knockoutFactorIds is not an array', result.knockoutFactorIds, []));
  }
  if (knockouts.length > 0 && result.verdict !== 'DOES_NOT_FIT') {
    out.push(violation(name, testCase, 'a knockout fired but the verdict is not DOES_NOT_FIT', result.verdict, 'DOES_NOT_FIT'));
  }
  if (knockouts.length === 0 && result.verdict === 'DOES_NOT_FIT') {
    out.push(violation(name, testCase, 'DOES_NOT_FIT without any knockout', knockouts, 'at least one knockout'));
  }
  if (new Set(knockouts).size !== knockouts.length) {
    out.push(violation(name, testCase, 'knockoutFactorIds has duplicates', knockouts, 'distinct ids'));
  }

  const tiers = result.tierValuesByFactor ?? {};
  const zeroTier = Object.keys(tiers)
    .filter((id) => tiers[id] === 0)
    .sort();
  const reported = [...knockouts].sort();
  if (Object.keys(tiers).length > 0 && stableStringify(zeroTier) !== stableStringify(reported)) {
    out.push(
      violation(name, testCase, 'knockout set differs from the factors with tier value 0 (G-3)', reported, zeroTier),
    );
  }
  if (knockouts.length > 0 && result.decidingFactorId !== null && !knockouts.includes(result.decidingFactorId)) {
    out.push(
      violation(name, testCase, 'with a knockout the deciding factor must be a knockout factor (V-8a)', result.decidingFactorId, knockouts),
    );
  }
  return out;
};

/** The appetite score is finite and in [0, 100]; every tier value is 0, 0.6, 1 or null. */
export const scoreInRange: Invariant = (testCase, result) => {
  const name = 'scoreInRange';
  const out: InvariantViolation[] = [];
  const score = result.appetiteScore;
  if (!isFiniteNumber(score)) {
    out.push(violation(name, testCase, 'appetite score is not a finite number', score, '[0, 100]'));
  } else if (score < -SCORE_TOLERANCE || score > 100 + SCORE_TOLERANCE) {
    out.push(violation(name, testCase, 'appetite score out of [0, 100]', score, '[0, 100]'));
  }
  if (!VERDICTS.includes(result.verdict)) {
    out.push(violation(name, testCase, 'verdict is not FIT, REFER or DOES_NOT_FIT', result.verdict, VERDICTS));
  }
  const tiers = result.tierValuesByFactor ?? {};
  for (const id of Object.keys(tiers)) {
    const t = tiers[id];
    if (t === null || t === undefined) continue;
    if (!TIER_VALUES.some((v) => Math.abs(v - t) <= SCORE_TOLERANCE)) {
      out.push(violation(name, testCase, `tier value of ${id} is not 0, 0.6 or 1`, t, TIER_VALUES));
    }
  }
  return out;
};

/**
 * Completeness is finite, in [0, 100] and a whole number of the nine required
 * components (V-6); FIT needs 100% (V-2); a knockout-free incomplete result is
 * REFER; confidence, when reported, is in [0, 1] (V-7).
 */
export const completenessAndConfidenceInRange: Invariant = (testCase, result) => {
  const name = 'completenessAndConfidenceInRange';
  const out: InvariantViolation[] = [];
  const c = result.completeness;
  if (!isFiniteNumber(c)) {
    out.push(violation(name, testCase, 'completeness is not a finite number', c, '[0, 100]'));
  } else {
    if (c < -RATIO_TOLERANCE || c > 100 + RATIO_TOLERANCE) {
      out.push(violation(name, testCase, 'completeness out of [0, 100]', c, '[0, 100]'));
    }
    const components = (c / 100) * REQUIRED_COMPONENTS;
    if (Math.abs(components - Math.round(components)) > SCORE_TOLERANCE) {
      out.push(
        violation(name, testCase, 'completeness is not k/9 of the required components (V-6)', c, `100 × ${Math.round(components)}/9`),
      );
    }
    const knockouts = Array.isArray(result.knockoutFactorIds) ? result.knockoutFactorIds : [];
    const complete = c >= 100 - RATIO_TOLERANCE;
    if (result.verdict === 'FIT' && !complete) {
      out.push(violation(name, testCase, 'FIT with completeness below 100% (V-2)', c, 100));
    }
    if (!complete && knockouts.length === 0 && result.verdict !== 'REFER') {
      out.push(violation(name, testCase, 'incomplete and knockout-free must be REFER (V-2)', result.verdict, 'REFER'));
    }
  }

  const confidence = (result as ProbedResult).confidence;
  if (confidence !== undefined && confidence !== null) {
    if (!isFiniteNumber(confidence) || confidence < -RATIO_TOLERANCE || confidence > 1 + RATIO_TOLERANCE) {
      out.push(violation(name, testCase, 'confidence out of [0, 1] (V-7)', confidence, '[0, 1]'));
    }
  }
  return out;
};

export function coreSuite(): InvariantSuite {
  return {
    name: 'core',
    invariants: [
      { name: 'determinism', check: determinism },
      { name: 'knockoutImpliesDoesNotFit', check: knockoutImpliesDoesNotFit },
      { name: 'scoreInRange', check: scoreInRange },
      { name: 'completenessAndConfidenceInRange', check: completenessAndConfidenceInRange },
    ],
  };
}
