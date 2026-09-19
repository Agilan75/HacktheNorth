/**
 * A05 live smoke for `schema-assist` and `second-opinion`: ONE tiny Gemini call
 * each, RUN_LIVE=1 only. The offline suites live in `schema-assist.test.ts` and
 * `second-opinion.test.ts` (moved at CP1, docs/contracts/requests/A05.md).
 */
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../env';
import { createGeminiProvider, MODELS } from '../gemini';
import { schemaAssistCall } from './schema-assist';
import { secondOpinionCall } from './second-opinion';
/* -------------------------------------------------------------------------- */
/* Live — one tiny call per owned call, RUN_LIVE=1 only                       */
/* -------------------------------------------------------------------------- */

const env = loadEnv();
const LIVE = env.RUN_LIVE === '1' && env.GEMINI_API_KEY !== undefined;

describe.skipIf(!LIVE)('live: A05 Gemini smoke', () => {
  it(
    'schema-assist maps an obvious key',
    async () => {
      const provider = createGeminiProvider({ apiKey: env.GEMINI_API_KEY });
      const out = await schemaAssistCall(provider, {
        unmappedKeys: [{ rawPath: 'bldg.yr_built', sampleValues: [1978, 2004] }],
        canonicalFields: [{ canonicalPath: 'buildings.yearBuilt', description: 'Year built' }],
      });
      expect(out.mappings).toHaveLength(1);
      expect(out.mappings[0]?.canonicalPath).toBe('buildings.yearBuilt');
      expect(out.mappings[0]?.confidence).toBeGreaterThanOrEqual(0.8);
      console.info(`[A05 live] schema-assist models=${MODELS.join('>')} out=${JSON.stringify(out)}`);
    },
    60_000,
  );

  it(
    'second-opinion knocks out on a one-line rule',
    async () => {
      const provider = createGeminiProvider({ apiKey: env.GEMINI_API_KEY });
      const out = await secondOpinionCall(provider, {
        guidelineText: 'Primary risk state: FL is Not Acceptable (out of appetite).',
        facts: { primaryRiskState: 'FL' },
      });
      expect(out.verdict).toBe('DOES_NOT_FIT');
      expect(out.decidingFactor).toBe('primary_risk_state');
      console.info(`[A05 live] second-opinion out=${JSON.stringify(out)}`);
    },
    60_000,
  );
});
