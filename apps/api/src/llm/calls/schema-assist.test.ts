/**
 * A05 offline tests for `schema-assist`, against the fake provider. No network.
 * Moved verbatim out of `second-opinion.live.test.ts` at CP1
 * (docs/contracts/requests/A05.md) so they run in the default suite.
 */
import { describe, expect, it } from 'vitest';
import type { SchemaAssistInput } from '@retrofit/contracts';
import { createFakeLlm } from '../fake-provider';
import type { LlmProvider } from '../types';
import { LlmUnavailableError } from '../types';
import {
  buildSchemaAssistPrompt,
  renderSample,
  schemaAssistCall,
  sanitizeMappings,
} from './schema-assist';
/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */
const ASSIST_INPUT: SchemaAssistInput = {
  unmappedKeys: [
    { rawPath: 'exposure_units.location.buildings.year_built', sampleValues: [1978, 2004, null] },
    { rawPath: 'exposure_units.location.buildings.cnstr_cd', sampleValues: ['FRAME', 'JM'] },
    { rawPath: 'misc.notes', sampleValues: [] },
  ],
  canonicalFields: [
    { canonicalPath: 'buildings.yearBuilt', description: 'Year the building was constructed' },
    { canonicalPath: 'buildings.constructionType', description: 'ISO construction class' },
  ],
};
const unavailableProvider: LlmProvider = {
  name: 'none',
  configured: false,
  generateJson: async () => {
    throw new LlmUnavailableError('schema-assist');
  },
};
/* -------------------------------------------------------------------------- */
/* schema-assist — offline                                                    */
/* -------------------------------------------------------------------------- */

describe('offline: schema-assist', () => {
  it('returns the canned mapping through the fake provider, in input key order', async () => {
    const llm = createFakeLlm();
    const out = await schemaAssistCall(llm, ASSIST_INPUT);
    expect(out.mappings).toEqual([
      {
        rawPath: 'exposure_units.location.buildings.year_built',
        canonicalPath: 'buildings.yearBuilt',
        confidence: 0.95,
        reason: 'exact semantic match on a building construction year',
      },
    ]);
    expect(llm.callsFor('schema-assist')).toHaveLength(1);
  });

  it('prompt names every key, every canonical field and at most 5 samples per key', () => {
    const prompt = buildSchemaAssistPrompt({
      ...ASSIST_INPUT,
      unmappedKeys: [{ rawPath: 'a.b', sampleValues: [1, 2, 3, 4, 5, 6, 7] }],
    });
    expect(prompt).toContain('- a.b: 1, 2, 3, 4, 5');
    expect(prompt).not.toContain('5, 6');
    expect(prompt).toContain('buildings.yearBuilt: Year the building was constructed');
    expect(prompt).toContain('buildings.constructionType');
    expect(buildSchemaAssistPrompt(ASSIST_INPUT)).toContain('misc.notes: (no samples)');
  });

  it('renders samples as short single-line JSON', () => {
    expect(renderSample('a\nb')).toBe('"a b"');
    expect(renderSample(null)).toBe('null');
    expect(renderSample({ x: 1 })).toBe('{"x":1}');
    expect(renderSample('x'.repeat(200)).length).toBeLessThanOrEqual(81);
  });

  it('enforces the offered canonical paths as a response-schema enum', async () => {
    const llm = createFakeLlm({
      handler: (req) => {
        const items = req.schema.response.properties?.mappings?.items;
        expect(items?.properties?.canonicalPath?.enum).toEqual([
          'buildings.yearBuilt',
          'buildings.constructionType',
        ]);
        return undefined;
      },
    });
    await schemaAssistCall(llm, ASSIST_INPUT);
    expect(llm.calls()[0]?.systemInstruction).toMatch(/never compute/);
  });

  it('drops unasked keys and unoffered canonical paths, clamps confidence, keeps the best per key', () => {
    const out = sanitizeMappings(ASSIST_INPUT, {
      mappings: [
        { rawPath: 'invented.key', canonicalPath: 'buildings.yearBuilt', confidence: 0.99, reason: 'x' },
        { rawPath: 'misc.notes', canonicalPath: 'premium.total', confidence: 0.9, reason: 'x' },
        { rawPath: 'exposure_units.location.buildings.cnstr_cd', canonicalPath: 'buildings.constructionType', confidence: 1.4, reason: '  code\nvalues ' },
        { rawPath: 'exposure_units.location.buildings.year_built', canonicalPath: 'buildings.constructionType', confidence: 0.3, reason: 'weak' },
        { rawPath: ' exposure_units.location.buildings.year_built ', canonicalPath: 'buildings.yearBuilt', confidence: 0.85, reason: '' },
      ],
    });
    expect(out).toEqual([
      { rawPath: 'exposure_units.location.buildings.year_built', canonicalPath: 'buildings.yearBuilt', confidence: 0.85, reason: 'No reason given.' },
      { rawPath: 'exposure_units.location.buildings.cnstr_cd', canonicalPath: 'buildings.constructionType', confidence: 1, reason: 'code values' },
    ]);
  });

  it('keeps sub-0.8 guesses (the 0.8 gate is the planner\'s) and does not filter them', async () => {
    const llm = createFakeLlm({
      overrides: {
        'schema-assist': {
          mappings: [
            { rawPath: 'misc.notes', canonicalPath: 'buildings.yearBuilt', confidence: 0.6, reason: 'maybe' },
          ],
        },
      },
    });
    const out = await schemaAssistCall(llm, ASSIST_INPUT);
    expect(out.mappings).toHaveLength(1);
    expect(out.mappings[0]?.confidence).toBe(0.6);
  });

  it('makes no call when there is nothing to map', async () => {
    const llm = createFakeLlm();
    expect(await schemaAssistCall(llm, { ...ASSIST_INPUT, unmappedKeys: [] })).toEqual({ mappings: [] });
    expect(await schemaAssistCall(llm, { ...ASSIST_INPUT, canonicalFields: [] })).toEqual({ mappings: [] });
    expect(llm.calls()).toHaveLength(0);
  });

  it('degrades to no mappings on repeated failure (2 attempts), never an invented map', async () => {
    const llm = createFakeLlm({ failFor: ['schema-assist'] });
    expect(await schemaAssistCall(llm, ASSIST_INPUT)).toEqual({ mappings: [] });
    expect(llm.callsFor('schema-assist')).toHaveLength(2);
  });

  it('degrades on a non-retryable bad answer too', async () => {
    const llm = createFakeLlm({ overrides: { 'schema-assist': { mappings: 'nope' } } });
    expect(await schemaAssistCall(llm, ASSIST_INPUT)).toEqual({ mappings: [] });
  });

  it('rethrows an unconfigured provider for the caller to report', async () => {
    await expect(schemaAssistCall(unavailableProvider, ASSIST_INPUT)).rejects.toBeInstanceOf(
      LlmUnavailableError,
    );
  });
});
