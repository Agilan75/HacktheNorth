import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FlipResult } from '@retrofit/engine';
import { REFERENCE_INPUTS, engineFlipForCase } from '../compare.js';
import type { GeneratedCase, NaiveInput } from '../types.js';
import {
  appliedFlipYieldsFit,
  flipMovesAtMostTwoComponents,
  flipNeverTouchesImmovable,
  flipSuite,
} from './flip.js';

// A switchable override so the invariants can be shown to catch a bad flip.
const forced = vi.hoisted(() => ({ result: null as unknown }));
vi.mock('../compare.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../compare.js')>();
  return {
    ...real,
    engineFlipForCase: (testCase: GeneratedCase) =>
      forced.result === null ? real.engineFlipForCase(testCase) : (forced.result as FlipResult),
  };
});

afterEach(() => {
  forced.result = null;
});

const B1 = REFERENCE_INPUTS[0] as NaiveInput;

function caseOf(input: NaiveInput, index = 0): GeneratedCase {
  return { caseId: `flip-${index}`, seed: 11, index, input, boundaries: {}, fromSubmission: false };
}

const VIEW = {
  appetiteScore: 0,
  completeness: 0,
  verdict: 'FIT' as const,
  knockoutFactorIds: [],
  decidingFactorId: null,
  tierValuesByFactor: {},
};

function allViolations(testCase: GeneratedCase) {
  return flipSuite().invariants.flatMap((inv) => inv.check(testCase, VIEW));
}

describe('flip invariants on the engine (F-1..F-6)', () => {
  it('B2 (TIV 150000000.01) flips with one move to exactly 150000000 (F-5 inclusive)', () => {
    const testCase = caseOf(REFERENCE_INPUTS[1] as NaiveInput, 2);
    const result = engineFlipForCase(testCase);
    expect(result.flip).not.toBeNull();
    expect(result.flip?.moves).toHaveLength(1);
    expect(result.flip?.moves[0]?.componentKey).toBe('totalTiv');
    expect(result.flip?.moves[0]?.to).toBe(150_000_000);
    expect(result.flip?.verdictAfter).toBe('FIT');
    expect(result.flip?.scoreAfter).toBeCloseTo(84, 6);
    expect(allViolations(testCase)).toEqual([]);
  });

  it('B3 (premium 49999.99) lands on exactly 50000', () => {
    const testCase = caseOf(REFERENCE_INPUTS[2] as NaiveInput, 3);
    const move = engineFlipForCase(testCase).flip?.moves[0];
    expect(move?.componentKey).toBe('quotedPremium');
    expect(move?.to).toBe(50_000);
    expect(allViolations(testCase)).toEqual([]);
  });

  it('two knocked-out movable components flip together (F-1: exactly two moves)', () => {
    const testCase = caseOf({ ...B1, totalTiv: 200_000_000, quotedPremium: 40_000 }, 20);
    const result = engineFlipForCase(testCase);
    expect(result.flip?.moves.map((m) => m.componentKey).sort()).toEqual(['quotedPremium', 'totalTiv']);
    expect(allViolations(testCase)).toEqual([]);
  });

  it('three failing movable components cannot be fixed in two moves', () => {
    const testCase = caseOf(
      { ...B1, totalTiv: 200_000_000, quotedPremium: 40_000, pctTivAcceptableConstruction: 0.1 },
      21,
    );
    const result = engineFlipForCase(testCase);
    expect(result.flip).toBeNull();
    expect(result.reason).not.toBeNull();
    expect(allViolations(testCase)).toEqual([]);
  });

  it('B12 (renewal) is blocked by an immovable component (F-3)', () => {
    const testCase = caseOf(REFERENCE_INPUTS[11] as NaiveInput, 12);
    const result = engineFlipForCase(testCase);
    expect(result.flip).toBeNull();
    expect(result.blockedByImmovable).toContain('isNewBusiness');
    expect(allViolations(testCase)).toEqual([]);
  });

  it('B7 (pre-1990 share over 50%) never moves building age (F-2)', () => {
    const testCase = caseOf(REFERENCE_INPUTS[6] as NaiveInput, 7);
    const result = engineFlipForCase(testCase);
    expect(result.flip).toBeNull();
    expect(result.blockedByImmovable).toContain('pctTivPre1990');
    expect(flipNeverTouchesImmovable(testCase, VIEW)).toEqual([]);
  });

  it('a FIT account (B1) is zero moves from appetite (V-9)', () => {
    const testCase = caseOf(B1, 1);
    const result = engineFlipForCase(testCase);
    expect(result.flip?.moves).toEqual([]);
    expect(appliedFlipYieldsFit(testCase, VIEW)).toEqual([]);
    expect(flipMovesAtMostTwoComponents(testCase, VIEW)).toEqual([]);
  });

  it('holds on every worked case and on hostile inputs', () => {
    const hostile: NaiveInput[] = [
      { ...B1, totalTiv: null, quotedPremium: null },
      { ...B1, totalTiv: -5, quotedPremium: 0 },
      { ...B1, totalTiv: 1e300, fiveYearLoss: 1e12 },
      { ...B1, primaryState: 'TX', totalTiv: 1e9 },
      { ...B1, hasOpenHighContradiction: true, quotedPremium: 10 },
      { ...B1, pctTivPre1990: 0.2, anyBuildingPre1990: true, quotedPremium: 10 },
    ];
    [...REFERENCE_INPUTS, ...hostile].forEach((input, i) => {
      expect(allViolations(caseOf(input, 100 + i))).toEqual([]);
    });
  });

  it('suite names its three invariants', () => {
    expect(flipSuite().name).toBe('flip');
    expect(flipSuite().invariants.map((i) => i.name)).toEqual([
      'appliedFlipYieldsFit',
      'flipMovesAtMostTwoComponents',
      'flipNeverTouchesImmovable',
    ]);
  });
});

describe('flip invariants catch a bad flip', () => {
  const move = (componentIndex: number, componentKey: string, to: number) => ({
    componentIndex,
    componentKey,
    from: null,
    to,
    deltaScaled: 0,
    label: componentKey,
  });
  const bad = (moves: ReturnType<typeof move>[]): FlipResult => ({
    flip: {
      moves,
      scoreBefore: 75,
      scoreAfter: 84,
      premiumBefore: null,
      premiumAfter: null,
      verdictAfter: 'FIT',
      distanceScaled: 0,
    },
    reason: null,
    blockedByImmovable: [],
  });
  const b2 = caseOf(REFERENCE_INPUTS[1] as NaiveInput, 902);

  it('a move that leaves the account out of appetite is an F-6 violation', () => {
    forced.result = bad([move(3, 'totalTiv', 160_000_000)]);
    const found = appliedFlipYieldsFit(b2, VIEW);
    expect(found.map((v) => v.message)).toContain('applying the returned flip does not yield FIT (F-6)');
    expect(found[0]?.caseId).toBe('flip-902');
    expect(found[0]?.seed).toBe(11);
  });

  it('three moves is an F-1 violation', () => {
    forced.result = bad([move(3, 'totalTiv', 1e8), move(4, 'quotedPremium', 9e4), move(7, 'pctTivAcceptableConstruction', 1)]);
    const found = flipMovesAtMostTwoComponents(b2, VIEW);
    expect(found.map((v) => v.message)).toContain('flip moves more than two components (F-1)');
    expect(found.find((v) => v.message.includes('F-1'))?.observed).toBe(3);
  });

  it('moving stateTier or fiveYearLoss is an F-2 violation', () => {
    forced.result = bad([move(2, 'stateTier', 2), move(8, 'fiveYearLoss', 0)]);
    const found = flipNeverTouchesImmovable(b2, VIEW);
    expect(found.map((v) => v.observed)).toEqual(['stateTier', 'fiveYearLoss']);
  });

  it('a movable component reported as blocking is an F-3 violation', () => {
    forced.result = { flip: null, reason: 'blocked', blockedByImmovable: ['totalTiv'] };
    expect(flipNeverTouchesImmovable(b2, VIEW)[0]?.message).toBe(
      'blockedByImmovable names a movable component (F-3)',
    );
  });
});
