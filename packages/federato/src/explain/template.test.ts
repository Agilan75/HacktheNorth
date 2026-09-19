import { describe, expect, it } from 'vitest';
import type {
  AppetiteFactorId,
  EngineResult,
  FactorOutcome,
  Flip,
  Tier,
} from '@retrofit/engine';
import { explain, mixedCaseSentence, recommendationFor } from './template';
import { extractNumbers, narrateGuard } from './narrate-guard';

/* Weights and tier values from INTERPRETATIONS.md §1–2. */
const WEIGHTS: Record<AppetiteFactorId, number> = {
  submission_type: 0.1,
  line_of_business: 0.15,
  primary_risk_state: 0.15,
  tiv: 0.15,
  total_premium: 0.15,
  building_age: 0.1,
  construction_type: 0.1,
  loss_value: 0.1,
};
const TIER_VALUE: Record<Tier, number> = { target: 1, acceptable: 0.6, not_acceptable: 0, refer: 0.6 };
const ORDER = Object.keys(WEIGHTS) as AppetiteFactorId[];

type TierMap = Partial<Record<AppetiteFactorId, Tier | null>>;

function factors(tiers: TierMap): FactorOutcome[] {
  return ORDER.map((factor) => {
    const tier = tiers[factor] === undefined ? 'target' : tiers[factor];
    const known = tier !== null;
    const tierValue = tier === null ? null : TIER_VALUE[tier];
    return {
      factor,
      componentKeys: [factor],
      tier,
      tierValue,
      weight: WEIGHTS[factor],
      points: tierValue === null ? 0 : 100 * WEIGHTS[factor] * tierValue,
      known,
      knockout: tierValue === 0,
      refer: tier === 'refer',
      ruleId: known ? `R-${factor}` : null,
      citation: known
        ? { doc: 'APPETITE_GUIDELINES.pdf', section: `p2 ${factor}`, quote: `quote ${factor}` }
        : null,
    };
  });
}

function score(fs: readonly FactorOutcome[]): number {
  return fs.reduce((s, f) => s + f.points, 0);
}

interface Opts {
  tiers?: TierMap;
  verdict?: 'FIT' | 'REFER' | 'DOES_NOT_FIT';
  flip?: Flip | null;
  blockedByImmovable?: string[];
  missing?: string[];
  openHigh?: boolean;
  quotedPremium?: number | null;
  predictedPremium?: number | null;
  totalTiv?: number | null;
  fiveYearLoss?: number | null;
  stateShares?: { state: string; tiv: number; share: number }[];
  primaryState?: string | null;
  referFactors?: AppetiteFactorId[];
  pre1990BuildingIds?: string[];
  interpretations?: string[];
}

function makeResult(o: Opts = {}): EngineResult {
  const fs = factors(o.tiers ?? {});
  const verdict = o.verdict ?? 'FIT';
  const stateShares = o.stateShares ?? [{ state: 'CA', tiv: 65_000_000, share: 1 }];
  const result = {
    id: 'SUB-1001',
    lineOfBusiness: 'commercial_property',
    asOf: '2026-09-19',
    canonical: { id: 'SUB-1001', lineOfBusiness: 'commercial_property', insured: {}, submissionType: [
      { value: 'new_business', provenance: { source: 'self_reported' } },
    ] },
    rollup: {
      totalTiv: o.totalTiv === undefined ? 65_000_000 : o.totalTiv,
      primaryState: o.primaryState === undefined ? 'CA' : o.primaryState,
      stateShares,
      fiveYearLoss: o.fiveYearLoss === undefined ? 32_000 : o.fiveYearLoss,
      pctTivPre1990: 0,
      pctTivAcceptableConstruction: 1,
      pre1990BuildingIds: o.pre1990BuildingIds ?? [],
    },
    contradictions: o.openHigh
      ? [{ id: 'C1', canonicalPath: 'buildings.yearBuilt', values: [], severity: 'HIGH', affectedRules: [], status: 'open' }]
      : [],
    evaluate: {
      appetiteScore: score(fs),
      factors: fs,
      firedRules: [],
      knockout: fs.some((f) => f.knockout),
      knockoutFactors: fs.filter((f) => f.knockout).map((f) => f.factor),
      referFactors: o.referFactors ?? [],
      missingFields: (o.missing ?? []).map((k) => ({
        componentKey: k,
        canonicalPath: k,
        factor: null,
        required: true,
        reason: 'missing',
      })),
      completeness: 100,
      confidence: 0.7,
      interpretationsApplied: [],
    },
    price: {
      lineOfBusiness: 'commercial_property',
      currency: 'USD',
      predictedPremium: o.predictedPremium === undefined ? 84_120 : o.predictedPremium,
      predictedMonthlyPremium: null,
      quotedPremium: o.quotedPremium === undefined ? 88_000 : o.quotedPremium,
    },
    verdict: {
      verdict,
      decidingRule: null,
      reasons: [],
      distanceToAppetite: verdict === 'FIT' ? 0 : o.flip ? o.flip.moves.length : null,
      openHighContradictionIds: o.openHigh ? ['C1'] : [],
      missingComponentKeys: o.missing ?? [],
    },
    flip: {
      flip: o.flip ?? null,
      reason: o.flip ? null : 'no flip',
      blockedByImmovable: o.blockedByImmovable ?? [],
    },
    interpretations: (o.interpretations ?? []).map((id) => ({
      id,
      title: id,
      decision: id,
      citation: { doc: 'INTERPRETATIONS.md', section: id, quote: `decision ${id}` },
      affects: [],
    })),
    explanation: null,
  };
  return result as unknown as EngineResult;
}

const premiumFlip: Flip = {
  moves: [
    {
      componentIndex: 4,
      componentKey: 'quotedPremium',
      from: 240_000,
      to: 175_000,
      deltaScaled: 0.1,
      label: 'premium',
    },
  ],
  scoreBefore: 85,
  scoreAfter: 94,
  premiumBefore: 240_000,
  premiumAfter: 175_000,
  verdictAfter: 'FIT',
  distanceScaled: 0.1,
};

describe('recommendationFor', () => {
  it('FIT -> accept', () => {
    expect(recommendationFor(makeResult())).toBe('accept');
  });
  it('DOES_NOT_FIT with a flip to FIT -> review', () => {
    const r = makeResult({ verdict: 'DOES_NOT_FIT', tiers: { total_premium: 'not_acceptable' }, flip: premiumFlip });
    expect(recommendationFor(r)).toBe('review');
  });
  it('DOES_NOT_FIT with no flip -> decline', () => {
    const r = makeResult({
      verdict: 'DOES_NOT_FIT',
      tiers: { submission_type: 'not_acceptable' },
      blockedByImmovable: ['isNewBusiness'],
    });
    expect(recommendationFor(r)).toBe('decline');
  });
  it('REFER on missing data -> investigate', () => {
    const r = makeResult({ verdict: 'REFER', tiers: { total_premium: null }, missing: ['quotedPremium'] });
    expect(recommendationFor(r)).toBe('investigate');
  });
  it('REFER on an open HIGH contradiction -> investigate', () => {
    expect(recommendationFor(makeResult({ verdict: 'REFER', openHigh: true }))).toBe('investigate');
  });
  it('REFER on R-AGE-REFER alone -> review', () => {
    const r = makeResult({
      verdict: 'REFER',
      tiers: { building_age: 'refer' },
      referFactors: ['building_age'],
      pre1990BuildingIds: ['B-2'],
    });
    expect(recommendationFor(r)).toBe('review');
  });
});

describe('mixedCaseSentence', () => {
  it('names in and out factors in factor order, PRD 7.7 wording', () => {
    const r = makeResult({
      verdict: 'DOES_NOT_FIT',
      tiers: {
        submission_type: null,
        line_of_business: null,
        building_age: null,
        construction_type: null,
        loss_value: null,
        total_premium: 'not_acceptable',
      },
    });
    expect(mixedCaseSentence(r)).toBe('In appetite on state and TIV, out on premium.');
  });
  it('is null when every known factor is in appetite', () => {
    expect(mixedCaseSentence(makeResult())).toBeNull();
  });
  it('is null when nothing is in appetite', () => {
    const all: TierMap = {};
    for (const f of ORDER) all[f] = 'not_acceptable';
    expect(mixedCaseSentence(makeResult({ verdict: 'DOES_NOT_FIT', tiers: all }))).toBeNull();
  });
  it('treats a refer flag (tier 0.6) as in appetite', () => {
    const r = makeResult({
      verdict: 'DOES_NOT_FIT',
      tiers: { building_age: 'refer', loss_value: 'not_acceptable' },
    });
    expect(mixedCaseSentence(r)).toBe(
      'In appetite on submission type, line of business, state, TIV, premium, building age and construction, out on loss history.',
    );
  });
});

describe('explain', () => {
  it('FIT account: score 100, key numbers, accept, 3 sentences', () => {
    const e = explain({ result: makeResult(), insuredName: 'Harbor Foods', rank: 1 });
    expect(e.sentences).toHaveLength(3);
    expect(e.text).toBe(e.sentences.join(' '));
    expect(e.template).toBe(e.text);
    expect(e.narrated).toBe(false);
    expect(e.recommendation).toBe('accept');
    expect(e.mixed).toBe(false);
    expect(e.sentences[0]).toBe(
      'Harbor Foods fits appetite with an appetite score of 100/100, ranked #1 in the queue: ' +
        'TIV $65.0M, quoted premium $88,000 against a predicted $84,120, 5-year losses $32,000.',
    );
    expect(e.sentences[1]).toBe('In appetite on every factor.');
    expect(e.sentences[2]).toBe(
      'Recommendation: accept, because every appetite factor is met and nothing is missing.',
    );
    expect(e.numbers.appetiteScore).toBe(100);
    expect(e.numbers.totalTiv).toBe(65_000_000);
    expect(e.numbers.quotedPremium).toBe(88_000);
    expect(e.numbers.predictedPremium).toBe(84_120);
    expect(e.numbers.fiveYearLoss).toBe(32_000);
    expect(e.numbers.rank).toBe(1);
    expect(e.inAppetite).toHaveLength(8);
    expect(e.outOfAppetite).toHaveLength(0);
  });

  it('every number in the text is recorded in `numbers`', () => {
    const r = makeResult({
      verdict: 'DOES_NOT_FIT',
      tiers: { total_premium: 'not_acceptable' },
      quotedPremium: 240_000,
      flip: premiumFlip,
      stateShares: [
        { state: 'CA', tiv: 39_000_000, share: 0.6 },
        { state: 'NV', tiv: 26_000_000, share: 0.4 },
      ],
    });
    const e = explain({ result: r });
    const values = Object.values(e.numbers);
    for (const n of extractNumbers(e.text)) {
      expect(values.some((v) => Math.abs(v - n) < 1e-9)).toBe(true);
    }
  });

  it('knockout on premium with a flip: mixed wording, score 85, review with the move', () => {
    const r = makeResult({
      verdict: 'DOES_NOT_FIT',
      tiers: { total_premium: 'not_acceptable' },
      quotedPremium: 240_000,
      flip: premiumFlip,
    });
    const e = explain({ result: r, insuredName: 'Lakeside Storage' });
    // 100 − 15 (premium weight 0.15 × tier 1 lost) = 85.
    expect(e.numbers.appetiteScore).toBe(85);
    expect(e.mixed).toBe(true);
    expect(e.recommendation).toBe('review');
    expect(e.sentences[0]).toContain('does not fit appetite with an appetite score of 85/100');
    expect(e.sentences[1]).toBe(
      'In appetite on submission type, line of business, state, TIV, building age, construction and loss history, out on premium.',
    );
    expect(e.sentences[2]).toBe(
      'Recommendation: review, because one change reaches appetite: premium to $175,000, lifting the score to 94.',
    );
    expect(e.numbers['flip.quotedPremium']).toBe(175_000);
    expect(e.numbers.flipScoreAfter).toBe(94);
    expect(e.outOfAppetite.map((n) => n.factor)).toEqual(['total_premium']);
    expect(e.outOfAppetite[0]?.valueText).toBe('$240,000');
    expect(e.citations.map((c) => c.section)).toEqual(['p2 total_premium']);
  });

  it('renewal knockout with no flip: decline naming the immovable factor', () => {
    const r = makeResult({
      verdict: 'DOES_NOT_FIT',
      tiers: { submission_type: 'not_acceptable' },
      blockedByImmovable: ['isNewBusiness'],
    });
    const e = explain({ result: r });
    expect(e.sentences[0]?.startsWith('Submission SUB-1001 does not fit appetite with an appetite score of 90/100')).toBe(true);
    expect(e.sentences[2]).toBe(
      'Recommendation: decline, because it is knocked out on submission type, which the insured cannot change.',
    );
  });

  it('decline: calls only the immovable knockouts unchangeable (F-2)', () => {
    // SUB-2024-00076 shape: state (immovable) and premium (movable).
    const mixed = explain({
      result: makeResult({
        verdict: 'DOES_NOT_FIT',
        tiers: { primary_risk_state: 'not_acceptable', total_premium: 'not_acceptable' },
        blockedByImmovable: ['stateTier'],
      }),
    });
    expect(mixed.sentences[2]).toBe(
      'Recommendation: decline, because it is knocked out on state and premium; the insured cannot change state.',
    );

    // SUB-2026-00028 shape: premium and construction out, the blocked component is elsewhere.
    const none = explain({
      result: makeResult({
        verdict: 'DOES_NOT_FIT',
        tiers: { total_premium: 'not_acceptable', construction_type: 'not_acceptable' },
        blockedByImmovable: ['fiveYearLoss'],
      }),
    });
    expect(none.sentences[2]).toBe(
      'Recommendation: decline, because it is knocked out on premium and construction.',
    );

    const all = explain({
      result: makeResult({
        verdict: 'DOES_NOT_FIT',
        tiers: { submission_type: 'not_acceptable', primary_risk_state: 'not_acceptable' },
        blockedByImmovable: ['isNewBusiness', 'stateTier'],
      }),
    });
    expect(all.sentences[2]).toBe(
      'Recommendation: decline, because it is knocked out on submission type and state, which the insured cannot change.',
    );
  });

  it('REFER on missing premium: investigate and names what is missing', () => {
    const r = makeResult({
      verdict: 'REFER',
      tiers: { total_premium: null },
      missing: ['quotedPremium'],
      quotedPremium: null,
    });
    const e = explain({ result: r });
    // 100 − 15 (missing premium contributes 0, no renormalization — G-2).
    expect(e.numbers.appetiteScore).toBe(85);
    expect(e.sentences[1]).toBe('In appetite on every known factor; missing premium.');
    expect(e.sentences[2]).toBe(
      'Recommendation: investigate, because the broker must supply the missing premium.',
    );
    expect(e.text).not.toContain('quoted premium');
  });

  it('R-AGE-REFER names the pre-1990 buildings (score 96)', () => {
    const r = makeResult({
      verdict: 'REFER',
      tiers: { building_age: 'refer' },
      referFactors: ['building_age'],
      pre1990BuildingIds: ['B-2'],
    });
    const e = explain({ result: r });
    // building_age at 0.6: 100 − 0.10 × 0.4 × 100 = 96.
    expect(e.numbers.appetiteScore).toBe(96);
    expect(e.sentences[1]).toBe('In appetite on every factor; building B-2 predates 1990.');
    expect(e.recommendation).toBe('review');
    expect(e.sentences[2]).toBe('Recommendation: review, because a referral rule fired on building age.');
  });

  it('I-1: names every other state with its share; I-3 flagged when applied', () => {
    const r = makeResult({
      stateShares: [
        { state: 'CA', tiv: 39_000_000, share: 0.6 },
        { state: 'NV', tiv: 19_500_000, share: 0.3 },
        { state: 'OR', tiv: 6_500_000, share: 0.1 },
      ],
      interpretations: ['I-1', 'I-3'],
    });
    const e = explain({ result: r });
    expect(e.sentences[1]).toBe(
      'In appetite on every factor; primary state CA carries 60% of TIV, with NV 30% and OR 10%; ' +
        'fire-resistive construction is treated as acceptable, an assumption.',
    );
    expect(e.numbers['stateShare.CA']).toBe(60);
    expect(e.numbers['stateShare.OR']).toBe(10);
    expect(e.citations.map((c) => c.section)).toEqual(['I-1', 'I-3']);
  });

  it('its own template passes the narrate guard unchanged', () => {
    const r = makeResult({
      verdict: 'DOES_NOT_FIT',
      tiers: { total_premium: 'not_acceptable' },
      quotedPremium: 240_000,
      flip: premiumFlip,
      stateShares: [
        { state: 'CA', tiv: 39_000_000, share: 0.6 },
        { state: 'NV', tiv: 26_000_000, share: 0.4 },
      ],
    });
    const e = explain({ result: r, rank: 4 });
    const g = narrateGuard(e, e.text);
    expect(g.problems).toEqual([]);
    expect(g.ok).toBe(true);
    const bumped = narrateGuard(e, e.text.replace('85/100', '88/100'));
    expect(bumped.ok).toBe(false);
    expect(bumped.changedNumbers).toContain('appetiteScore');
  });

  it('is deterministic', () => {
    const r = makeResult({ verdict: 'DOES_NOT_FIT', tiers: { tiv: 'not_acceptable' } });
    expect(explain({ result: r })).toEqual(explain({ result: r }));
  });
});
