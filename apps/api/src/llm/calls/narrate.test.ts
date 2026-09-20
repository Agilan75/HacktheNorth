/**
 * A04 offline tests for `narrate` and `verify-fix`, against `createFakeLlm`:
 * the number/recommendation survival rules and the conservative verify-fix
 * degrade. No network. Moved verbatim out of `narrate.live.test.ts` at CP1
 * (docs/contracts/requests/A04.md). The `vi.mock('../generate-json')` shim is
 * dropped: A02's `generateJson` is implemented, so the shim was a pass-through.
 */
import { describe, expect, it } from 'vitest';
import type { NarrateInput, VerifyFixInput } from '@retrofit/contracts';
import { createFakeLlm } from '../fake-provider';
import { LlmUnavailableError } from '../types';
import type { LlmImagePart, LlmProvider } from '../types';
import { narrateCall } from './narrate';
import { verifyFixCall } from './verify-fix';
/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const TEMPLATE =
  'In appetite on TIV and state, out on premium. Appetite score 84 with a predicted ' +
  'premium of $88,000. Recommendation: review.';

const NARRATE_INPUT: NarrateInput = {
  template: TEMPLATE,
  verdict: 'REFER',
  recommendation: 'review',
  numbers: { appetiteScore: 84, predictedPremium: 88000 },
  firedRules: [
    {
      ruleId: 'premium.range',
      factor: 'premium',
      tier: 'Unacceptable',
      quote: 'Premium outside the target range.',
    },
  ],
  flipSummary: null,
  insuredName: 'Northwind Storage LLC',
};

const VERIFY_INPUT: VerifyFixInput = {
  hazardKey: 'heaterNearCombustible',
  hazardLabel: 'Space heater next to a curtain',
  whatWasSeen: 'a portable heater within 30 cm of a floor-length curtain',
  roomLabel: 'Bedroom',
};

/** A 1x1 white PNG: the smallest valid image the live smoke test can send. */
const TINY_PNG: LlmImagePart = {
  kind: 'image',
  mimeType: 'image/png',
  dataBase64:
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
  label: 'after-fix photo, bearing 120°',
};

const polished = (text: string) => createFakeLlm({ overrides: { narrate: { text } } });

/* -------------------------------------------------------------------------- */
/* narrate — offline                                                          */
/* -------------------------------------------------------------------------- */

describe('narrateCall (fake provider)', () => {
  it('keeps a rewrite that preserves every number and the recommendation', async () => {
    const llm = createFakeLlm();
    const out = await narrateCall(llm, NARRATE_INPUT);
    expect(out.text).toBe(
      'This account is in appetite on TIV and state but out on premium. ' +
        'The appetite score is 84 with a predicted premium of $88,000. ' +
        'Recommend review before quoting.',
    );
    const [call] = llm.callsFor('narrate');
    expect(llm.calls()).toHaveLength(1);
    expect(call?.partKinds).toEqual([]);
    expect(call?.prompt).toContain(TEMPLATE);
    expect(call?.prompt).toContain('Premium outside the target range.');
    expect(call?.prompt).toContain('Northwind Storage LLC');
    expect(call?.systemInstruction).toMatch(/never add, remove, round, reformat or recompute a number/);
  });

  it('falls back to the template when a number is reformatted ($88,000 -> $88K)', async () => {
    const out = await narrateCall(
      polished('In appetite on TIV and state, out on premium. Score 84, premium $88K. Recommend review.'),
      NARRATE_INPUT,
    );
    expect(out.text).toBe(TEMPLATE);
  });

  it('falls back to the template when a number is changed (84 -> 85)', async () => {
    const out = await narrateCall(
      polished('In appetite on TIV and state, out on premium. Score 85, premium $88,000. Recommend review.'),
      NARRATE_INPUT,
    );
    expect(out.text).toBe(TEMPLATE);
  });

  it('falls back to the template when a number is dropped', async () => {
    const out = await narrateCall(
      polished('In appetite on TIV and state, out on premium, at $88,000. Recommend review.'),
      NARRATE_INPUT,
    );
    expect(out.text).toBe(TEMPLATE);
  });

  it('falls back to the template when a number is invented', async () => {
    const out = await narrateCall(
      polished(
        'In appetite on TIV and state, out on premium. Score 84 of 100, premium $88,000. Recommend review.',
      ),
      NARRATE_INPUT,
    );
    expect(out.text).toBe(TEMPLATE);
  });

  it('falls back to the template when the recommendation changes', async () => {
    const out = await narrateCall(
      polished('In appetite on TIV and state, out on premium. Score 84, premium $88,000. Recommend we decline.'),
      NARRATE_INPUT,
    );
    expect(out.text).toBe(TEMPLATE);
  });

  it('does not accept the recommendation as a prefix of another word ("reviewed")', async () => {
    const out = await narrateCall(
      polished('In appetite on TIV and state, out on premium. Score 84, premium $88,000. It was reviewed.'),
      NARRATE_INPUT,
    );
    expect(out.text).toBe(TEMPLATE);
  });

  it('falls back to the template when the rewrite runs past four sentences', async () => {
    const out = await narrateCall(
      polished('Score 84. Premium $88,000. In appetite on TIV. In appetite on state. Out on premium. Recommend review.'),
      NARRATE_INPUT,
    );
    expect(out.text).toBe(TEMPLATE);
  });

  it('falls back to the template when two numbers swap places (R4-8)', async () => {
    const input: NarrateInput = {
      ...NARRATE_INPUT,
      template: 'Quoted premium $58,800 against a predicted $63,835. Recommendation: review.',
      numbers: { quotedPremium: 58_800, predictedPremium: 63_835 },
    };
    const out = await narrateCall(
      polished('The quoted premium of $63,835 sits against a predicted $58,800, so review.'),
      input,
    );
    expect(out.text).toBe(input.template);
  });

  it('falls back to the template when a repeated number is dropped once (R4-8)', async () => {
    const input: NarrateInput = {
      ...NARRATE_INPUT,
      template: 'Score 84 on TIV, 84 on state. Recommendation: review.',
      numbers: { appetiteScore: 84 },
    };
    const out = await narrateCall(polished('Score 84 on TIV and state, so review.'), input);
    expect(out.text).toBe(input.template);
  });

  it('tidies whitespace in an accepted rewrite and tolerates a decimal number', async () => {
    const input: NarrateInput = {
      ...NARRATE_INPUT,
      template: 'TIV of $65.0M is in appetite. Adequacy 0.92. Recommendation: accept.',
      recommendation: 'accept',
      numbers: { tiv: 65_000_000, adequacy: 0.92 },
    };
    const out = await narrateCall(
      polished('  The $65.0M TIV sits in appetite.\n\nAdequacy is 0.92, so we   accept.  '),
      input,
    );
    expect(out.text).toBe('The $65.0M TIV sits in appetite. Adequacy is 0.92, so we accept.');
  });

  it('returns the template when the provider fails', async () => {
    const out = await narrateCall(createFakeLlm({ failFor: ['narrate'] }), NARRATE_INPUT);
    expect(out.text).toBe(TEMPLATE);
  });

  it('returns the template when the result is degraded', async () => {
    const out = await narrateCall(createFakeLlm({ degraded: true }), NARRATE_INPUT);
    expect(out.text).toBe(TEMPLATE);
  });

  it('returns the template without calling an unconfigured provider', async () => {
    const llm = createFakeLlm();
    const unconfigured: LlmProvider = {
      name: 'fake',
      configured: false,
      generateJson: llm.generateJson,
    };
    const out = await narrateCall(unconfigured, NARRATE_INPUT);
    expect(out.text).toBe(TEMPLATE);
    expect(llm.calls()).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* verify-fix — offline                                                       */
/* -------------------------------------------------------------------------- */

describe('verifyFixCall (fake provider)', () => {
  it('returns the model answer and sends exactly one image', async () => {
    const llm = createFakeLlm();
    const out = await verifyFixCall(llm, VERIFY_INPUT, TINY_PNG);
    expect(out).toEqual({
      stillPresent: false,
      confidence: 0.88,
      reason: 'the heater is no longer within reach of the curtain',
    });
    const [call] = llm.callsFor('verify-fix');
    expect(call?.partKinds).toEqual(['image']);
    expect(call?.prompt).toContain('Space heater next to a curtain');
    expect(call?.prompt).toContain('a portable heater within 30 cm of a floor-length curtain');
    expect(call?.prompt).toContain('Bedroom');
    expect(call?.prompt).toContain('bearing 120°');
    expect(call?.systemInstruction).toMatch(/never estimate a price, a score or a verdict/);
  });

  it('clamps confidence into 0..1 and collapses whitespace in the reason', async () => {
    const high = await verifyFixCall(
      createFakeLlm({
        overrides: { 'verify-fix': { stillPresent: true, confidence: 1.7, reason: ' heater\n  still   there ' } },
      }),
      VERIFY_INPUT,
      TINY_PNG,
    );
    expect(high).toEqual({ stillPresent: true, confidence: 1, reason: 'heater still there' });

    const low = await verifyFixCall(
      createFakeLlm({
        overrides: { 'verify-fix': { stillPresent: false, confidence: -0.3, reason: 'gone' } },
      }),
      VERIFY_INPUT,
      TINY_PNG,
    );
    expect(low.confidence).toBe(0);
  });

  it('caps an overlong reason at 400 characters', async () => {
    const out = await verifyFixCall(
      createFakeLlm({
        overrides: { 'verify-fix': { stillPresent: true, confidence: 0.5, reason: 'word '.repeat(200) } },
      }),
      VERIFY_INPUT,
      TINY_PNG,
    );
    expect(out.reason.length).toBeLessThanOrEqual(401);
    expect(out.reason.endsWith('…')).toBe(true);
  });

  it('never credits a fix when the provider fails: still present at zero confidence', async () => {
    const out = await verifyFixCall(createFakeLlm({ failFor: ['verify-fix'] }), VERIFY_INPUT, TINY_PNG);
    expect(out.stillPresent).toBe(true);
    expect(out.confidence).toBe(0);
    expect(out.reason).toMatch(/could not be checked/);
  });

  it('never credits a fix when the result is degraded', async () => {
    const out = await verifyFixCall(createFakeLlm({ degraded: true }), VERIFY_INPUT, TINY_PNG);
    expect(out).toMatchObject({ stillPresent: true, confidence: 0 });
  });

  it('rethrows LlmUnavailableError so the route can report the missing key', async () => {
    const llm = createFakeLlm({
      handler: () => {
        throw new LlmUnavailableError('verify-fix');
      },
    });
    await expect(verifyFixCall(llm, VERIFY_INPUT, TINY_PNG)).rejects.toBeInstanceOf(LlmUnavailableError);
  });
});
