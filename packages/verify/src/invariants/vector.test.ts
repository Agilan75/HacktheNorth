import { describe, expect, it } from 'vitest';

import {
  REFERENCE_INPUTS,
  enginePeerDistance,
  engineScaleVector,
  engineVectorForInput,
} from '../compare.js';
import type { GeneratedCase, NaiveInput } from '../types.js';
import {
  checkPeerPair,
  peerDistanceIsSymmetric,
  scaledComponentsInUnitRange,
  vectorSuite,
  vectorizeIsPure,
} from './vector.js';

const B1 = REFERENCE_INPUTS[0] as NaiveInput;
const B9 = REFERENCE_INPUTS[8] as NaiveInput;
const B10 = REFERENCE_INPUTS[9] as NaiveInput;

function caseOf(input: NaiveInput, index = 0): GeneratedCase {
  return { caseId: `vec-${index}`, seed: 5, index, input, boundaries: {}, fromSubmission: false };
}

const VIEW = {
  appetiteScore: 0,
  completeness: 0,
  verdict: 'FIT' as const,
  knockoutFactorIds: [],
  decidingFactorId: null,
  tierValuesByFactor: {},
};

const HOSTILE: NaiveInput[] = [
  { ...B1, totalTiv: null, quotedPremium: null, fiveYearLoss: null },
  { ...B1, primaryState: null, pctTivPre1990: null, pctTivPost2010: null },
  { ...B1, totalTiv: 0, quotedPremium: 0, fiveYearLoss: 0 },
  { ...B1, totalTiv: 1e300, quotedPremium: 1e300, fiveYearLoss: 1e300 },
  { ...B1, totalTiv: -1e9, fiveYearLoss: -50 },
  { ...B1, pctTivPre1990: 1.5, pctTivAcceptableConstruction: -0.2 },
  { ...B1, primaryState: 'zz', submissionType: 'something', lineOfBusiness: 'auto' },
  { ...B1, lineOfBusiness: null, submissionType: null },
];

describe('vector invariants', () => {
  it('B1 vector: T-SPAN writes the building_age tier into components 5 and 6', () => {
    const v = engineVectorForInput(B1);
    // The three trailing nulls are the extension-only components: sprinklers,
    // protection class and the flood zone. The generator sets none of them, so
    // the extension rules never fire in the differential and the naive twin
    // needs no flood logic to mirror.
    expect(v.x).toEqual([1, 1, 2, 150_000_000, 175_000, 0, 0, 0.5, 100_000, null, null, null]);
    expect(v.t.slice(0, 9)).toEqual([1, 1, 1, 0.6, 0.6, 0.6, 0.6, 1, 1]);
    expect(v.m).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0]);
  });

  it('scaling: stateTier divides by 2, missing stays null, log components clamp into [0, 1]', () => {
    const scaled = engineScaleVector(engineVectorForInput(B10).x);
    expect(scaled[2]).toBe(0.5);
    expect(scaled[9]).toBeNull();
    const huge = engineScaleVector(engineVectorForInput({ ...B1, totalTiv: 1e300 }).x);
    expect(huge[3]).toBe(1);
    const tiny = engineScaleVector(engineVectorForInput({ ...B1, totalTiv: 1 }).x);
    expect(tiny[3]).toBe(0);
  });

  it('peer distance B9↔B10 is sqrt(0.25 / 7): only stateTier differs, 7 components compared', () => {
    const a = engineVectorForInput(B9);
    const b = engineVectorForInput(B10);
    const ab = enginePeerDistance(a, b);
    const ba = enginePeerDistance(b, a);
    expect(ab?.distance).toBeCloseTo(Math.sqrt(0.25 / 7), 12);
    expect(ba?.distance).toBe(ab?.distance);
    expect(enginePeerDistance(a, a)?.distance).toBe(0);
  });

  it('every invariant holds on the worked cases and hostile inputs', () => {
    [...REFERENCE_INPUTS, ...HOSTILE].forEach((input, i) => {
      const testCase = caseOf(input, i);
      expect(vectorizeIsPure(testCase, VIEW)).toEqual([]);
      expect(scaledComponentsInUnitRange(testCase, VIEW)).toEqual([]);
      expect(peerDistanceIsSymmetric(testCase, VIEW)).toEqual([]);
    });
  });

  it('suite names its three invariants', () => {
    expect(vectorSuite().name).toBe('vector');
    expect(vectorSuite().invariants.map((i) => i.name)).toEqual([
      'vectorizeIsPure',
      'scaledComponentsInUnitRange',
      'peerDistanceIsSymmetric',
    ]);
  });
});

describe('peerDistanceIsSymmetric — CP1 FX2 (G-11, PRD 12)', () => {
  const BIG = Number.MAX_VALUE;

  it('±Number.MAX_VALUE inputs: distance is finite, non-negative and symmetric against every reference', () => {
    const input: NaiveInput = { ...B1, pctTivPre1990: BIG, pctTivPost2010: -BIG, pctTivAcceptableConstruction: BIG };
    const a = engineVectorForInput(input);
    REFERENCE_INPUTS.forEach((ref) => {
      const b = engineVectorForInput(ref);
      const ab = enginePeerDistance(a, b);
      const ba = enginePeerDistance(b, a);
      expect(ab).not.toBeNull();
      expect(Number.isFinite(ab!.distance)).toBe(true);
      expect(ab!.distance).toBeGreaterThanOrEqual(0);
      expect(ba!.distance).toBe(ab!.distance);
    });
    expect(peerDistanceIsSymmetric(caseOf(input, 900), VIEW)).toEqual([]);
  });

  it('no comparable component: null in both directions, and the invariant does not flag it', () => {
    const input: NaiveInput = {
      ...B1,
      primaryState: null,
      totalTiv: null,
      quotedPremium: null,
      pctTivPre1990: null,
      pctTivPost2010: null,
      pctTivAcceptableConstruction: null,
      fiveYearLoss: null,
    };
    const a = engineVectorForInput(input);
    REFERENCE_INPUTS.forEach((ref) => {
      const b = engineVectorForInput(ref);
      expect(enginePeerDistance(a, b)).toBeNull();
      expect(enginePeerDistance(b, a)).toBeNull();
    });
    expect(peerDistanceIsSymmetric(caseOf(input, 901), VIEW)).toEqual([]);
  });

  it('pair check: two nulls (bare or as a null distance) are symmetric; null against a number is not', () => {
    expect(checkPeerPair(null, null, 'B1')).toEqual([]);
    expect(checkPeerPair({ distance: null, componentsUsed: [2, 3] }, { distance: null, componentsUsed: [2, 3] }, 'B1')).toEqual([]);
    expect(checkPeerPair({ distance: null, componentsUsed: [2] }, null, 'B1')).toEqual([]);
    expect(checkPeerPair(null, { distance: 0.1, componentsUsed: [2] }, 'B1').length).toBe(1);
    expect(checkPeerPair({ distance: null, componentsUsed: [2] }, { distance: 0.1, componentsUsed: [2] }, 'B1').length).toBe(1);
  });

  it('pair check: non-finite or negative distances and differing componentsUsed are flagged', () => {
    const ok = { distance: 0.2, componentsUsed: [2, 3] };
    expect(checkPeerPair(ok, ok, 'B1')).toEqual([]);
    expect(checkPeerPair({ distance: Number.NaN, componentsUsed: [2] }, { distance: Number.NaN, componentsUsed: [2] }, 'B1').length).toBeGreaterThan(0);
    expect(checkPeerPair({ distance: Infinity, componentsUsed: [2] }, { distance: Infinity, componentsUsed: [2] }, 'B1').length).toBeGreaterThan(0);
    expect(checkPeerPair({ distance: -0.1, componentsUsed: [2] }, { distance: -0.1, componentsUsed: [2] }, 'B1').length).toBeGreaterThan(0);
    expect(checkPeerPair(ok, { distance: 0.3, componentsUsed: [2, 3] }, 'B1').length).toBe(1);
    expect(checkPeerPair(ok, { distance: 0.2, componentsUsed: [2, 3, 4] }, 'B1').length).toBe(1);
  });

  it('identical vectors give 0', () => {
    REFERENCE_INPUTS.forEach((ref) => {
      const a = engineVectorForInput(ref);
      expect(enginePeerDistance(a, engineVectorForInput(ref))?.distance).toBe(0);
    });
  });
});
