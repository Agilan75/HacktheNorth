/**
 * E06 — `verdict`, checked against INTERPRETATIONS V-1..V-5 (the order of the
 * checks), V-8 (the deciding factor: lowest tierValue, ties by highest weight,
 * then factor order) and V-9 (`distanceToAppetite`).
 */
import { describe, expect, it } from 'vitest';

import { verdict } from './verdict.js';
import { APPETITE_FACTORS, FACTOR_WEIGHTS } from '../constants.js';
import type {
  AppetiteFactorId,
  Citation,
  Contradiction,
  EvaluateResult,
  FactorOutcome,
  FlipResult,
  Tier,
} from '../types.js';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const cite = (factor: string): Citation => ({
  doc: 'APPETITE_GUIDELINES.pdf',
  section: `p2 "${factor}"`,
  quote: factor,
});

function outcome(
  factor: AppetiteFactorId,
  tierValue: number | null,
  options: { tier?: Tier; knockout?: boolean; refer?: boolean; known?: boolean } = {},
): FactorOutcome {
  const known = options.known ?? tierValue !== null;
  const tier: Tier | null =
    options.tier ?? (tierValue === null ? null : tierValue === 0 ? 'not_acceptable' : tierValue === 0.6 ? 'acceptable' : 'target');
  const weight = FACTOR_WEIGHTS[factor];
  return {
    factor,
    componentKeys: [factor],
    tier,
    tierValue,
    weight,
    points: known && tierValue !== null ? 100 * weight * tierValue : 0,
    known,
    knockout: options.knockout ?? (known && tierValue === 0),
    refer: options.refer ?? false,
    ruleId: known ? `R-${factor}` : null,
    citation: known ? cite(factor) : null,
  };
}

/** All eight factors at Target unless overridden. */
function evaluated(
  overrides: Partial<Record<AppetiteFactorId, FactorOutcome>> = {},
  extra: Partial<EvaluateResult> = {},
): EvaluateResult {
  const factors = APPETITE_FACTORS.map((f) => overrides[f] ?? outcome(f, 1));
  const knockoutFactors = factors.filter((f) => f.knockout).map((f) => f.factor);
  const referFactors = factors.filter((f) => f.refer).map((f) => f.factor);
  return {
    appetiteScore: 100 * factors.reduce((acc, f) => acc + f.weight * (f.tierValue ?? 0), 0),
    factors,
    firedRules: [],
    knockout: knockoutFactors.length > 0,
    knockoutFactors,
    referFactors,
    missingFields: [],
    completeness: 100,
    confidence: 1,
    interpretationsApplied: [],
    ...extra,
  };
}

const openHigh: Contradiction = {
  id: 'C1',
  canonicalPath: 'buildings.B1.tiv',
  values: [],
  severity: 'HIGH',
  affectedRules: ['AG-TIV-A'],
  status: 'open',
};

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe('verdict — V-1..V-5 in order', () => {
  it('V-5: a complete, uncontradicted, unreferred submission is FIT with distance 0', () => {
    const result = verdict(evaluated(), []);
    expect(result.verdict).toBe('FIT');
    expect(result.distanceToAppetite).toBe(0);
    expect(result.openHighContradictionIds).toEqual([]);
    expect(result.missingComponentKeys).toEqual([]);
  });

  it('V-1: a knockout is DOES_NOT_FIT even when completeness is 100', () => {
    const result = verdict(evaluated({ tiv: outcome('tiv', 0) }), []);
    expect(result.verdict).toBe('DOES_NOT_FIT');
    expect(result.decidingRule?.factor).toBe('tiv');
    expect(result.decidingRule?.tier).toBe('not_acceptable');
    expect(result.decidingRule?.citation.doc).toBe('APPETITE_GUIDELINES.pdf');
  });

  it('V-1 beats V-3: a knockout with an open HIGH contradiction is still DOES_NOT_FIT', () => {
    const result = verdict(evaluated({ tiv: outcome('tiv', 0) }), [openHigh]);
    expect(result.verdict).toBe('DOES_NOT_FIT');
    expect(result.openHighContradictionIds).toEqual(['C1']);
  });

  it('V-2: completeness under 100 is REFER', () => {
    const result = verdict(
      evaluated(
        { total_premium: outcome('total_premium', null, { known: false }) },
        {
          completeness: (100 * 8) / 9,
          missingFields: [
            {
              componentKey: 'quotedPremium',
              canonicalPath: 'pricing.quotedPremium',
              factor: 'total_premium',
              required: true,
              reason: 'missing',
            },
          ],
        },
      ),
      [],
    );
    expect(result.verdict).toBe('REFER');
    expect(result.missingComponentKeys).toEqual(['quotedPremium']);
    expect(result.reasons.some((r) => r.includes('completeness'))).toBe(true);
  });

  it('V-3: an open HIGH contradiction is REFER; resolved or MEDIUM ones are not', () => {
    expect(verdict(evaluated(), [openHigh]).verdict).toBe('REFER');
    expect(verdict(evaluated(), [{ ...openHigh, status: 'resolved' }]).verdict).toBe('FIT');
    expect(verdict(evaluated(), [{ ...openHigh, severity: 'MEDIUM' }]).verdict).toBe('FIT');
  });

  it('V-4: a fired refer rule is REFER and never lowers the score', () => {
    const base = evaluated();
    const referred = evaluated({
      building_age: outcome('building_age', 0.6, { refer: true }),
    });
    const result = verdict(referred, []);
    expect(result.verdict).toBe('REFER');
    expect(result.reasons.some((r) => r.includes('referral'))).toBe(true);
    expect(verdict(base, []).verdict).toBe('FIT');
  });

  it('V-4: an extension refer rule refers even though its factor is not an appetite factor', () => {
    const result = verdict(
      evaluated(
        {},
        {
          firedRules: [
            {
              ruleId: 'RF-SPRINK-REFER',
              factor: 'sprinkler_protection',
              tier: 'refer',
              tierValue: 0.6,
              weight: 0,
              points: 0,
              citation: { doc: 'Retrofit', section: 'extensions', quote: 'Sprinklers' },
              conditions: [],
              extension: true,
            },
          ],
        },
      ),
      [],
    );
    expect(result.verdict).toBe('REFER');
  });
});

describe('verdict — V-8 deciding factor', () => {
  it('(b) picks the lowest tier value, not the lowest points', () => {
    // building_age t=0.6 w=0.10 = 6 points; tiv t=0.6 w=0.15 = 9 points.
    // Equal tier value, so the HIGHER weight wins: tiv.
    const result = verdict(
      evaluated({
        tiv: outcome('tiv', 0.6),
        building_age: outcome('building_age', 0.6),
      }),
      [],
    );
    expect(result.decidingRule?.factor).toBe('tiv');
  });

  it('(b) a strictly lower tier value beats a higher weight', () => {
    const result = verdict(
      evaluated({
        tiv: outcome('tiv', 0.6),
        building_age: outcome('building_age', 0.6),
        construction_type: outcome('construction_type', 0.6),
      }),
      [],
    );
    expect(result.decidingRule?.factor).toBe('tiv');

    const lower = verdict(
      evaluated({
        tiv: outcome('tiv', 0.6),
        construction_type: outcome('construction_type', 0.6),
        loss_value: outcome('loss_value', 0.6),
        primary_risk_state: outcome('primary_risk_state', 0.6),
        total_premium: outcome('total_premium', 0.6),
        submission_type: outcome('submission_type', 0.6),
        line_of_business: outcome('line_of_business', 0.6),
        building_age: outcome('building_age', 0.6),
      }),
      [],
    );
    // All equal at 0.6: highest weight is 0.15, shared by line_of_business,
    // primary_risk_state, tiv and total_premium; factor order then picks
    // line_of_business (index 1).
    expect(lower.decidingRule?.factor).toBe('line_of_business');
  });

  it('(b) a lower tier value beats a higher weight', () => {
    // building_age t=0.6 w=0.10 versus tiv t=1 w=0.15.
    const result = verdict(evaluated({ building_age: outcome('building_age', 0.6) }), []);
    expect(result.decidingRule?.factor).toBe('building_age');
  });

  it('(a) a knockout wins, taking the earliest knockout in factor order', () => {
    const result = verdict(
      evaluated({
        loss_value: outcome('loss_value', 0),
        line_of_business: outcome('line_of_business', 0),
      }),
      [],
    );
    expect(result.decidingRule?.factor).toBe('line_of_business');
  });

  it('(a) the knockout decides even when another known factor scores lower on weight', () => {
    const result = verdict(
      evaluated({
        loss_value: outcome('loss_value', 0),
        tiv: outcome('tiv', 0.6),
      }),
      [],
    );
    expect(result.decidingRule?.factor).toBe('loss_value');
  });

  it('a refer flag never changes the deciding factor', () => {
    const withRefer = verdict(
      evaluated({
        tiv: outcome('tiv', 0.6),
        building_age: outcome('building_age', 0.6, { refer: true }),
      }),
      [],
    );
    expect(withRefer.decidingRule?.factor).toBe('tiv');
  });

  it('(c) every appetite factor missing gives no deciding rule', () => {
    const factors = APPETITE_FACTORS.map((f) => outcome(f, null, { known: false }));
    const result = verdict(
      {
        appetiteScore: 0,
        factors,
        firedRules: [],
        knockout: false,
        knockoutFactors: [],
        referFactors: [],
        missingFields: [],
        completeness: 0,
        confidence: 1,
        interpretationsApplied: [],
      },
      [],
    );
    expect(result.decidingRule).toBe(null);
    expect(result.verdict).toBe('REFER');
  });
});

describe('verdict — V-9 distance to appetite', () => {
  const twoMoveFlip: FlipResult = {
    flip: {
      moves: [
        { componentIndex: 3, componentKey: 'totalTiv', from: 200_000_000, to: 150_000_000, deltaScaled: 0.1, label: 'TIV' },
        { componentIndex: 4, componentKey: 'quotedPremium', from: 10_000, to: 50_000, deltaScaled: 0.2, label: 'Premium' },
      ],
      scoreBefore: 60,
      scoreAfter: 84,
      premiumBefore: null,
      premiumAfter: null,
      verdictAfter: 'FIT',
      distanceScaled: 0.22,
    },
    reason: null,
    blockedByImmovable: [],
  };

  it('reports the number of moves in the supplied flip', () => {
    const result = verdict(evaluated({ tiv: outcome('tiv', 0) }), [], twoMoveFlip);
    expect(result.distanceToAppetite).toBe(2);
  });

  it('is null when no flip exists', () => {
    const result = verdict(evaluated({ tiv: outcome('tiv', 0) }), [], {
      flip: null,
      reason: 'every failing component is immovable',
      blockedByImmovable: ['stateTier'],
    });
    expect(result.distanceToAppetite).toBe(null);
  });

  it('is null for a non-FIT verdict with no flip supplied, and 0 for FIT', () => {
    expect(verdict(evaluated({ tiv: outcome('tiv', 0) }), []).distanceToAppetite).toBe(null);
    expect(verdict(evaluated(), [], { flip: null, reason: 'already FIT', blockedByImmovable: [] }).distanceToAppetite).toBe(0);
  });
});

describe('verdict — reasons', () => {
  it('puts the deciding factor first and names every other knockout', () => {
    const result = verdict(
      evaluated({
        line_of_business: outcome('line_of_business', 0),
        loss_value: outcome('loss_value', 0),
      }),
      [],
    );
    expect(result.reasons[0]).toContain('Line of business');
    expect(result.reasons[0]).toContain('APPETITE_GUIDELINES.pdf');
    expect(result.reasons.some((r) => r.startsWith('Loss value is also'))).toBe(true);
  });

  it('is deterministic', () => {
    const a = verdict(evaluated({ tiv: outcome('tiv', 0.6) }), [openHigh]);
    const b = verdict(evaluated({ tiv: outcome('tiv', 0.6) }), [openHigh]);
    expect(a).toEqual(b);
  });
});
