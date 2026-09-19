/**
 * A05 offline tests for `second-opinion`, against the fake provider. No network.
 * Moved verbatim out of `second-opinion.live.test.ts` at CP1
 * (docs/contracts/requests/A05.md) so they run in the default suite.
 */
import { describe, expect, it } from 'vitest';
import type { SecondOpinionInput } from '@retrofit/contracts';
import { createFakeLlm } from '../fake-provider';
import { LlmError } from '../types';
import {
  NO_DECIDING_FACTOR,
  SECOND_OPINION_FACTORS,
  buildSecondOpinionPrompt,
  secondOpinionCall,
} from './second-opinion';
/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */
const OPINION_INPUT: SecondOpinionInput = {
  guidelineText:
    'Building age: if more than 50% of TIV is in buildings built before 1990, Not Acceptable. ' +
    'If some but at most 50% of TIV is pre-1990, refer to a senior underwriter.',
  facts: { pctTivPre1990: 0.3, primaryRiskState: 'OH', tiv: 12_000_000, lossValue: null },
};
/* -------------------------------------------------------------------------- */
/* second-opinion — offline                                                   */
/* -------------------------------------------------------------------------- */

describe('offline: second-opinion', () => {
  it('returns the canned verdict and deciding factor', async () => {
    const llm = createFakeLlm();
    const out = await secondOpinionCall(llm, OPINION_INPUT);
    expect(out).toEqual({
      verdict: 'REFER',
      decidingFactor: 'building_age',
      reasoning: 'At least one building predates 1990, which the guidelines flag for referral.',
    });
  });

  it('prompt carries the guideline and sorted facts, unknown for null, and no engine output', () => {
    const prompt = buildSecondOpinionPrompt(OPINION_INPUT);
    expect(prompt).toContain(OPINION_INPUT.guidelineText);
    const factLines = prompt.split('\n').filter((l) => /^- [a-zA-Z]/.test(l));
    expect(factLines).toEqual([
      '- lossValue: unknown',
      '- pctTivPre1990: 0.3',
      '- primaryRiskState: OH',
      '- tiv: 12000000',
    ]);
    expect(prompt).not.toMatch(/appetite score|engine|decidingFactorId/i);
  });

  it('same input, same prompt, regardless of fact key order', () => {
    const reordered: SecondOpinionInput = {
      guidelineText: OPINION_INPUT.guidelineText,
      facts: { tiv: 12_000_000, lossValue: null, primaryRiskState: 'OH', pctTivPre1990: 0.3 },
    };
    expect(buildSecondOpinionPrompt(reordered)).toBe(buildSecondOpinionPrompt(OPINION_INPUT));
  });

  it('restricts the deciding factor to the 8 appetite factors plus none', async () => {
    expect(SECOND_OPINION_FACTORS).toHaveLength(9);
    expect(SECOND_OPINION_FACTORS).toContain(NO_DECIDING_FACTOR);
    const llm = createFakeLlm({
      handler: (req) => {
        expect(req.schema.response.properties?.verdict?.enum).toEqual(['FIT', 'REFER', 'DOES_NOT_FIT']);
        expect(req.schema.response.properties?.decidingFactor?.enum).toEqual(SECOND_OPINION_FACTORS);
        expect(req.temperature).toBe(0);
        return undefined;
      },
    });
    await secondOpinionCall(llm, OPINION_INPUT);
  });

  it('normalizes loose tokens: "does not fit" / "Building Age"', async () => {
    const llm = createFakeLlm({
      overrides: {
        'second-opinion': { verdict: 'does not fit', decidingFactor: ' Building Age ', reasoning: 'a\n\nb' },
      },
    });
    expect(await secondOpinionCall(llm, OPINION_INPUT)).toEqual({
      verdict: 'DOES_NOT_FIT',
      decidingFactor: 'building_age',
      reasoning: 'a b',
    });
  });

  it('rejects a factor outside the vocabulary rather than passing it through', async () => {
    const llm = createFakeLlm({
      overrides: { 'second-opinion': { verdict: 'FIT', decidingFactor: 'vibes', reasoning: 'x' } },
    });
    await expect(secondOpinionCall(llm, OPINION_INPUT)).rejects.toBeInstanceOf(LlmError);
  });

  it('never invents a verdict: repeated failure throws after 2 attempts', async () => {
    const llm = createFakeLlm({ failFor: ['second-opinion'] });
    await expect(secondOpinionCall(llm, OPINION_INPUT)).rejects.toBeInstanceOf(LlmError);
    expect(llm.callsFor('second-opinion')).toHaveLength(2);
  });

  it('throws on a degraded result', async () => {
    const llm = createFakeLlm({ degraded: true });
    await expect(secondOpinionCall(llm, OPINION_INPUT)).rejects.toThrow(/no verdict is invented/);
  });
});
