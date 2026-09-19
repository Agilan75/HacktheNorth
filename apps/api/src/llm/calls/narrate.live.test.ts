/**
 * A04 live smoke for `narrate` and `verify-fix`: exactly ONE tiny Gemini call
 * per owned call, skipped unless RUN_LIVE=1 and a key is configured. The
 * offline suites live in `narrate.test.ts` (moved at CP1, docs/contracts/requests/A04.md).
 *
 * Run: RUN_LIVE=1 VITEST_MAX_WORKERS=1 npx vitest run apps/api/src/llm/calls/narrate.live.test.ts --project api
 */
import { describe, expect, it } from 'vitest';
import type { NarrateInput, VerifyFixInput } from '@retrofit/contracts';
import type { LlmImagePart, LlmProvider } from '../types';
import { createGeminiProvider } from '../gemini';
import { getEnv } from '../../env';
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

/* -------------------------------------------------------------------------- */
/* Live smoke — one tiny call each                                            */
/* -------------------------------------------------------------------------- */

function liveProvider(): LlmProvider | null {
  const env = getEnv();
  if (env.RUN_LIVE !== '1' || env.GEMINI_API_KEY === undefined) return null;
  try {
    const provider = createGeminiProvider({ apiKey: env.GEMINI_API_KEY });
    return provider.configured ? provider : null;
  } catch {
    // A02's provider is still a NOT_IMPLEMENTED stub.
    return null;
  }
}

const live = liveProvider();

describe.skipIf(live === null)('live Gemini smoke (RUN_LIVE=1)', () => {
  it('narrate: polishes or falls back, and every template number survives', async () => {
    const out = await narrateCall(live as LlmProvider, NARRATE_INPUT);
    expect(out.text).toContain('84');
    expect(out.text).toContain('$88,000');
    expect(out.text.toLowerCase()).toContain('review');
  }, 60_000);

  it('verify-fix: a blank 1x1 photo cannot prove a fix', async () => {
    const out = await verifyFixCall(live as LlmProvider, VERIFY_INPUT, TINY_PNG);
    expect(out.stillPresent).toBe(true);
    expect(out.confidence).toBeGreaterThanOrEqual(0);
    expect(out.confidence).toBeLessThanOrEqual(1);
    expect(out.reason.length).toBeGreaterThan(0);
  }, 60_000);
});
