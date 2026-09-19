import type { GeneratedCase, Invariant, InvariantSuite, InvariantViolation } from '../types.js';
import {
  REFERENCE_INPUTS,
  engineBookStats,
  enginePeerDistance,
  engineScaleVector,
  engineSubmissionForInput,
  engineVectorForInput,
  engineVectorize,
  verifyEngineConfig,
} from '../compare.js';

/**
 * Vector-design invariants (V05): vectorize is a pure function of the merged
 * submission, scaling keeps every distance component in 0-1, and peer distance
 * is symmetric and zero only for identical vectors.
 *
 * The engine is reached only through `../compare.ts` (the one V05 file that
 * imports `@retrofit/engine`).
 */

/** INTERPRETATIONS P-1: the peer distance runs over components 2–10. */
const FIRST_DISTANCE_COMPONENT = 2;
/** Symmetry is exact in IEEE arithmetic ((a-b)² = (b-a)²); allow round-off only. */
const SYMMETRY_TOLERANCE = 1e-12;

function violation(
  invariant: string,
  testCase: GeneratedCase,
  message: string,
  observed: unknown,
  expected: unknown,
): InvariantViolation {
  return { invariant, caseId: testCase.caseId, seed: testCase.seed, message, observed, expected };
}

/** JSON with sorted keys and non-finite numbers spelled out, so NaN ≠ null ≠ -0. */
function canonical(value: unknown): string {
  if (typeof value === 'number') {
    if (Object.is(value, -0)) return '"-0"';
    return Number.isFinite(value) ? String(value) : `"${String(value)}"`;
  }
  if (value === undefined) return '"undefined"';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(record[k])}`).join(',')}}`;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

export const vectorizeIsPure: Invariant = (testCase) => {
  const name = 'vectorizeIsPure';
  const out: InvariantViolation[] = [];
  const submission = engineSubmissionForInput(testCase.input, testCase.caseId);
  const before = canonical(submission);

  const first = engineVectorize(submission);
  const second = engineVectorize(submission);
  const fromClone = engineVectorize(structuredClone(submission));
  let fromFrozen: ReturnType<typeof engineVectorize> | null = null;
  try {
    fromFrozen = engineVectorize(deepFreeze(structuredClone(submission)));
  } catch (err) {
    out.push(
      violation(name, testCase, 'vectorize threw on a frozen submission (it mutates its input)', err instanceof Error ? err.message : String(err), 'no mutation'),
    );
  }

  if (canonical(submission) !== before) {
    out.push(violation(name, testCase, 'vectorize mutated the submission', canonical(submission), before));
  }
  const reference = canonical(first);
  for (const [label, other] of [
    ['second call', second],
    ['structural clone', fromClone],
    ['frozen clone', fromFrozen],
  ] as const) {
    if (other === null) continue;
    const got = canonical(other);
    if (got !== reference) {
      out.push(violation(name, testCase, `vectorize is not a pure function of the submission (${label})`, got, reference));
    }
  }

  // FeatureVector contract: x, t, m parallel, x/t null exactly where m = 0.
  const n = verifyEngineConfig().spec.components.length;
  if (first.x.length !== n || first.t.length !== n || first.m.length !== n) {
    out.push(violation(name, testCase, 'x/t/m length differs from the spec', [first.x.length, first.t.length, first.m.length], n));
    return out;
  }
  for (let i = 0; i < n; i += 1) {
    const known = first.m[i] === 1;
    const x = first.x[i];
    if (first.m[i] !== 0 && first.m[i] !== 1) {
      out.push(violation(name, testCase, `m[${i}] is not 0 or 1`, first.m[i], '0 | 1'));
    }
    if (known !== (typeof x === 'number' && Number.isFinite(x))) {
      out.push(violation(name, testCase, `m[${i}] disagrees with x[${i}] (G-1/G-2)`, { x, m: first.m[i] }, 'm = 1 iff x finite'));
    }
    if (!known && first.t[i] !== null) {
      out.push(violation(name, testCase, `t[${i}] is set on a missing component (G-2)`, first.t[i], null));
    }
  }
  return out;
};

let referenceVectors: ReturnType<typeof engineVectorForInput>[] | null = null;

function referenceBook(): ReturnType<typeof engineVectorForInput>[] {
  if (referenceVectors === null) referenceVectors = REFERENCE_INPUTS.map((input) => engineVectorForInput(input));
  return referenceVectors;
}

/** The case's vector and the books to scale it against. */
function booksFor(testCase: GeneratedCase) {
  const vector = engineVectorForInput(testCase.input);
  const reference = referenceBook();
  return {
    vector,
    books: [
      { label: 'reference book', stats: verifyEngineConfig().bookStats },
      { label: 'book including this case', stats: engineBookStats([...reference, vector]) },
      { label: 'no book', stats: null },
    ] as const,
  };
}

export const scaledComponentsInUnitRange: Invariant = (testCase) => {
  const name = 'scaledComponentsInUnitRange';
  const out: InvariantViolation[] = [];
  const { spec } = verifyEngineConfig();
  const { vector, books } = booksFor(testCase);

  for (const book of books) {
    const scaled = engineScaleVector(vector.x, book.stats);
    for (const component of spec.components) {
      const i = component.index;
      if (i < FIRST_DISTANCE_COMPONENT) continue;
      const raw = vector.x[i] ?? null;
      const s = scaled[i] ?? null;
      if (vector.m[i] !== 1 || raw === null) {
        if (s !== null) {
          out.push(violation(name, testCase, `${component.key}: missing component scaled to a number (${book.label})`, s, null));
        }
        continue;
      }
      // A raw value outside the spec's declared domain is a malformed input,
      // not a scaling defect; see docs/decisions/V05.md.
      if (component.min !== undefined && raw < component.min) continue;
      if (component.max !== undefined && raw > component.max) continue;
      if (typeof s !== 'number' || !Number.isFinite(s) || s < 0 || s > 1) {
        out.push(violation(name, testCase, `${component.key}: scaled value outside [0, 1] (${book.label})`, { raw, scaled: s }, '[0, 1]'));
      }
    }
  }
  return out;
};

/** One direction of a peer distance as the invariant sees it. */
export interface PeerPairSide {
  readonly distance: number | null;
  readonly componentsUsed: readonly number[];
}

/** A pair-check failure, before it is tied to a case. */
export interface PeerPairProblem {
  readonly message: string;
  readonly observed: unknown;
  readonly expected: unknown;
}

/**
 * "No distance" in either spelling: the engine's bare `null` (nothing
 * comparable, P-1) or a side whose distance is `null` (how a non-finite number
 * reads back after a JSON round trip).
 */
function isNullSide(side: PeerPairSide | null): boolean {
  return side === null || side.distance === null;
}

function sameIndices(x: readonly number[], y: readonly number[]): boolean {
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/**
 * The symmetry contract for one pair (PRD 12, CP1 FX2):
 * - null both ways is SYMMETRIC — nothing comparable is a relation too; a null
 *   is a violation only when the other direction is a number;
 * - a number must be finite and >= 0, both ways;
 * - d(a,b) = d(b,a) within round-off;
 * - componentsUsed is the same set both ways.
 */
export function checkPeerPair(
  ab: PeerPairSide | null,
  ba: PeerPairSide | null,
  label: string,
): PeerPairProblem[] {
  const abNull = isNullSide(ab);
  const baNull = isNullSide(ba);
  if (abNull && baNull) return [];
  if (abNull !== baNull) {
    return [{ message: `peer relation not symmetric against ${label}`, observed: { ab, ba }, expected: 'both null or both numbers' }];
  }
  const dab = (ab as PeerPairSide).distance as number;
  const dba = (ba as PeerPairSide).distance as number;
  const out: PeerPairProblem[] = [];
  let finite = true;
  for (const [dir, d] of [['d(a,b)', dab], ['d(b,a)', dba]] as const) {
    if (typeof d !== 'number' || !Number.isFinite(d) || d < 0) {
      finite = false;
      out.push({ message: `distance is negative or non-finite against ${label} (${dir})`, observed: d, expected: '>= 0 and finite' });
    }
  }
  if (finite && !(Math.abs(dab - dba) <= SYMMETRY_TOLERANCE)) {
    out.push({ message: `d(a,b) != d(b,a) against ${label}`, observed: dab, expected: dba });
  }
  const usedAb = (ab as PeerPairSide).componentsUsed;
  const usedBa = (ba as PeerPairSide).componentsUsed;
  if (!sameIndices(usedAb, usedBa)) {
    out.push({ message: `componentsUsed differs by direction against ${label}`, observed: usedAb, expected: usedBa });
  }
  return out;
}

/**
 * The components a pair actually compares: `componentsUsed` narrowed to those
 * known with a finite scaled value on both sides. This is symmetric by
 * definition of the distance, so it is what the componentsUsed check compares
 * (the engine's query-level list legitimately differs when only one side is a
 * reduced, coarse-match vector; see docs/decisions/CP1-FX2.md).
 */
function comparedSet(
  used: readonly number[],
  a: { readonly m: readonly (0 | 1)[] },
  b: { readonly m: readonly (0 | 1)[] },
  scaledA: readonly (number | null)[],
  scaledB: readonly (number | null)[],
): number[] {
  return [...used]
    .filter((i) => {
      const x = scaledA[i];
      const y = scaledB[i];
      return a.m[i] === 1 && b.m[i] === 1 && typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y);
    })
    .sort((p, q) => p - q);
}

export const peerDistanceIsSymmetric: Invariant = (testCase) => {
  const name = 'peerDistanceIsSymmetric';
  const out: InvariantViolation[] = [];
  const a = engineVectorForInput(testCase.input);
  const scaledA = engineScaleVector(a.x);

  // Self-distance: zero whenever the account can be compared at all.
  const self = enginePeerDistance(a, a);
  if (self !== null && self.distance !== 0) {
    out.push(violation(name, testCase, 'distance from a vector to itself is not 0', self.distance, 0));
  }

  referenceBook().forEach((b, index) => {
    const label = `reference B${index + 1}`;
    const scaledB = engineScaleVector(b.x);
    const rawAb = enginePeerDistance(a, b);
    const rawBa = enginePeerDistance(b, a);
    const ab = rawAb === null ? null : { distance: rawAb.distance, componentsUsed: comparedSet(rawAb.componentsUsed, a, b, scaledA, scaledB) };
    const ba = rawBa === null ? null : { distance: rawBa.distance, componentsUsed: comparedSet(rawBa.componentsUsed, b, a, scaledB, scaledA) };
    const problems = checkPeerPair(ab, ba, label);
    for (const p of problems) out.push(violation(name, testCase, p.message, p.observed, p.expected));
    if (problems.length > 0 || rawAb === null) return;

    // Zero only for identical vectors, over the components actually compared.
    const differing: number[] = [];
    for (const i of rawAb.componentsUsed) {
      if (a.m[i] !== 1 || b.m[i] !== 1) continue;
      const x = scaledA[i];
      const y = scaledB[i];
      if (typeof x !== 'number' || typeof y !== 'number') continue;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x !== y) differing.push(i);
    }
    if (rawAb.distance === 0 && differing.length > 0) {
      out.push(violation(name, testCase, `distance is 0 against ${label} but compared components differ`, differing, []));
    }
    if (rawAb.distance !== 0 && differing.length === 0) {
      out.push(violation(name, testCase, `distance is non-zero against ${label} but every compared component is equal`, rawAb.distance, 0));
    }
  });
  return out;
};

export function vectorSuite(): InvariantSuite {
  return {
    name: 'vector',
    invariants: [
      { name: 'vectorizeIsPure', check: vectorizeIsPure },
      { name: 'scaledComponentsInUnitRange', check: scaledComponentsInUnitRange },
      { name: 'peerDistanceIsSymmetric', check: peerDistanceIsSymmetric },
    ],
  };
}
