import { describe, expect, it } from 'vitest';
import type { Explanation } from '../types';
import { extractNumbers, narrateGuard } from './narrate-guard';

describe('extractNumbers', () => {
  it('normalizes abbreviations, grouping and currency', () => {
    expect(extractNumbers('$1.2M')).toEqual([1_200_000]);
    expect(extractNumbers('1200000')).toEqual([1_200_000]);
    expect(extractNumbers('$1,200,000')).toEqual([1_200_000]);
    expect(extractNumbers('$65.0M and $703.5K and $1.25B')).toEqual([65_000_000, 703_500, 1_250_000_000]);
    expect(extractNumbers('1.2 million dollars, 88 thousand')).toEqual([1_200_000, 88_000]);
    expect(extractNumbers('$88k')).toEqual([88_000]);
  });
  it('reads scores, percents, ranks and years', () => {
    expect(extractNumbers('score of 84/100, ranked #3, 40% of TIV pre-1990')).toEqual([84, 100, 3, 40, 1990]);
  });
  it('does not treat hyphens inside words as signs, but keeps real negatives', () => {
    expect(extractNumbers('SUB-1001, 5-year losses')).toEqual([1001, 5]);
    expect(extractNumbers('a recovery of -$1,200')).toEqual([-1200]);
  });
  it('does not read a following word as a K/M/B suffix', () => {
    expect(extractNumbers('3 buildings, 2 Months')).toEqual([3, 2]);
    expect(extractNumbers('')).toEqual([]);
  });
});

const template =
  'Harbor Foods does not fit appetite with an appetite score of 85/100: TIV $65.0M, quoted premium $240,000. ' +
  'In appetite on state and TIV, out on premium. ' +
  'Recommendation: review, because one change reaches appetite: premium to $175,000.';

const explanation: Explanation = {
  submissionId: 'SUB-1001',
  text: template,
  sentences: [],
  recommendation: 'review',
  mixed: true,
  inAppetite: [],
  outOfAppetite: [],
  numbers: {
    appetiteScore: 85,
    n0: 100,
    totalTiv: 65_000_000,
    quotedPremium: 240_000,
    'flip.quotedPremium': 175_000,
  },
  citations: [],
  template,
  narrated: false,
};

describe('narrateGuard', () => {
  it('accepts a rewording that keeps every number, even re-abbreviated', () => {
    const polished =
      'Harbor Foods scores 85 out of 100 but falls outside appetite. With $65,000,000 in TIV and a $240K quote, ' +
      'it is in appetite on state and TIV but out on premium. We recommend a review: cutting the premium to $175K reaches appetite.';
    const g = narrateGuard(explanation, polished);
    expect(g.problems).toEqual([]);
    expect(g.ok).toBe(true);
    expect(g.text).toBe(polished);
    expect(g.changedNumbers).toEqual([]);
    expect(g.recommendationChanged).toBe(false);
  });

  it('rejects a changed number and keeps the template', () => {
    const polished = template.replace('$240,000', '$250,000');
    const g = narrateGuard(explanation, polished);
    expect(g.ok).toBe(false);
    expect(g.text).toBe(template);
    expect(g.changedNumbers).toContain('quotedPremium');
    expect(g.changedNumbers).toContain('unexpected:250000');
  });

  it('rejects a dropped number', () => {
    const polished = template.replace(' TIV $65.0M,', '');
    const g = narrateGuard(explanation, polished);
    expect(g.ok).toBe(false);
    expect(g.changedNumbers).toEqual(['totalTiv']);
  });

  it('rejects a changed recommendation', () => {
    const polished = template.replace('Recommendation: review', 'We decline');
    const g = narrateGuard(explanation, polished);
    expect(g.ok).toBe(false);
    expect(g.recommendationChanged).toBe(true);
    expect(g.text).toBe(template);
    expect(g.problems).toEqual([
      'recommendation "review" is no longer stated',
      'narration introduces recommendation "decline"',
    ]);
  });

  it('rejects an added recommendation even when the original survives', () => {
    const g = narrateGuard(explanation, `${template} Otherwise decline.`);
    expect(g.ok).toBe(false);
    expect(g.recommendationChanged).toBe(true);
  });

  it('R4-8: rejects a swap of two numbers even though the set is unchanged', () => {
    const t =
      'Coastal Freight is referred with an appetite score of 88/100: TIV $18.5M, quoted premium $63,835 against a predicted $58,800. ' +
      'Recommendation: investigate.';
    const e: Explanation = {
      ...explanation,
      text: t,
      template: t,
      recommendation: 'investigate',
      numbers: {
        appetiteScore: 88,
        n0: 100,
        totalTiv: 18_500_000,
        quotedPremium: 63_835,
        predictedPremium: 58_800,
      },
    };
    const swapped = t.replace('$63,835 against a predicted $58,800', '$58,800 against a predicted $63,835');
    const g = narrateGuard(e, swapped);
    expect(g.ok).toBe(false);
    expect(g.text).toBe(t);
    expect(g.changedNumbers).toEqual(['quotedPremium', 'predictedPremium']);
    expect(g.problems.some((p) => p.includes('order'))).toBe(true);
    // The unswapped template still passes.
    expect(narrateGuard(e, t).ok).toBe(true);
  });

  it('R4-8: rejects a dropped repeat of a number the template states twice', () => {
    const t = 'Premium $175,000 is at the ceiling; move premium to $175,000. Recommendation: review.';
    const e: Explanation = { ...explanation, text: t, template: t, numbers: { quotedPremium: 175_000 } };
    const g = narrateGuard(e, 'Premium $175,000 is at the ceiling. Recommendation: review.');
    expect(g.ok).toBe(false);
  });

  it('rejects empty narration', () => {
    const g = narrateGuard(explanation, '   ');
    expect(g.ok).toBe(false);
    expect(g.text).toBe(template);
  });
});
