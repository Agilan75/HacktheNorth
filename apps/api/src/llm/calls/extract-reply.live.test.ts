/**
 * A06 live smoke for `draft-request` and `extract-reply`: one tiny Gemini call
 * per owned call, only with RUN_LIVE=1 and a key. The offline suites live in
 * `draft-request.test.ts` and `extract-reply.test.ts` (moved at CP1,
 * docs/contracts/requests/A06.md).
 */
import { describe, expect, it } from 'vitest';
import type {
  DraftRequestInput,
  ExtractReplyFieldSpec,
  ExtractReplyInput,
} from '@retrofit/contracts';
import { loadEnv } from '../../env';
import { createGeminiProvider } from '../gemini';
import { draftProblems, draftRequestCall, templateDraft } from './draft-request';
import { extractReplyCall, quoteInSource } from './extract-reply';
/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */
const draftInput = (over: Partial<DraftRequestInput> = {}): DraftRequestInput => ({
  insuredName: 'Harbor Freight Storage LLC',
  brokerName: 'Keystone Brokerage',
  contactName: 'Dana Ruiz',
  fields: [
    { canonicalPath: 'buildings.yearBuilt', label: 'year built', why: 'it decides the building-age factor' },
  ],
  tone: 'short_and_specific',
  ...over,
});
const YEAR: ExtractReplyFieldSpec = {
  canonicalPath: 'buildings.yearBuilt',
  label: 'Year built',
  type: 'year',
  min: 1800,
  max: 2026,
};
const TIV: ExtractReplyFieldSpec = { canonicalPath: 'buildings.tiv', label: 'TIV', type: 'money', min: 0 };
const SPRINK: ExtractReplyFieldSpec = { canonicalPath: 'buildings.sprinklered', label: 'Sprinklered', type: 'boolean' };
const PCT: ExtractReplyFieldSpec = { canonicalPath: 'pctTivPre1990', label: 'Share pre-1990', type: 'percent' };
const CONSTR: ExtractReplyFieldSpec = {
  canonicalPath: 'buildings.construction',
  label: 'Construction',
  type: 'string',
  options: ['Frame', 'Joisted Masonry', 'Fire Resistive'],
};

const REPLY =
  'Hi Sam,\n\nBuilding C was built in 1978. Total insured value is $2.5M across the site.\n' +
  'The building is fully sprinklered. Roughly 40% of the TIV is in the older building.\n' +
  'Construction is joisted masonry.\n\nThanks, Dana';

const extractInput = (over: Partial<ExtractReplyInput> = {}): ExtractReplyInput => ({
  sourceText: REPLY,
  requestedFields: [YEAR, TIV, SPRINK, PCT, CONSTR],
  insuredName: 'Harbor Freight Storage LLC',
  ...over,
});
/* -------------------------------------------------------------------------- */
/* Live — one tiny call each, RUN_LIVE=1 only                                 */
/* -------------------------------------------------------------------------- */

const env = loadEnv();
const LIVE = env.RUN_LIVE === '1' && env.GEMINI_API_KEY !== undefined;

describe.skipIf(!LIVE)('live: A06 Gemini smoke', () => {
  it(
    'draft-request names the one requested field',
    async () => {
      const provider = createGeminiProvider({ apiKey: env.GEMINI_API_KEY });
      const input = draftInput({ contactName: null, brokerName: null, insuredName: null });
      const out = await draftRequestCall(provider, input);
      expect(draftProblems(out, input.fields)).toBeNull();
      console.info(`[A06 live draft-request] template=${out.body === templateDraft(input).body}`);
    },
    60_000,
  );

  it(
    'extract-reply reads one year with a verbatim quote',
    async () => {
      const provider = createGeminiProvider({ apiKey: env.GEMINI_API_KEY });
      const out = await extractReplyCall(
        provider,
        extractInput({ sourceText: 'It was built in 1978.', requestedFields: [YEAR] }),
      );
      expect(out.values).toHaveLength(1);
      expect(out.values[0]?.value).toBe(1978);
      expect(quoteInSource(out.values[0]!.quote, 'It was built in 1978.')).toBe(true);
    },
    60_000,
  );
});
