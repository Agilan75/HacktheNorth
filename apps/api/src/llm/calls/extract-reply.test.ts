/**
 * A06 offline tests for `extract-reply`: typed parsing (G-4/G-5/G-6), the quote
 * check, the PDF cap and the contradiction cap, driven by the fake provider. No
 * network. Moved verbatim out of `extract-reply.live.test.ts` at CP1
 * (docs/contracts/requests/A06.md) so they run in the default suite.
 */
import { describe, expect, it } from 'vitest';
import type { ExtractReplyFieldSpec, ExtractReplyInput } from '@retrofit/contracts';
import { createFakeLlm } from '../fake-provider';
import type { AnyGenerateJsonRequest, LlmPdfPart } from '../types';
import {
  CONFLICT_CONFIDENCE_CAP,
  UNVERIFIED_QUOTE_CONFIDENCE_CAP,
  coerceValue,
  extractReplyCall,
  quoteInSource,
} from './extract-reply';
/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */
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

const fakeWith = (answer: unknown) => createFakeLlm({ overrides: { 'extract-reply': answer } });

const PDF: LlmPdfPart = { kind: 'pdf', mimeType: 'application/pdf', dataBase64: 'JVBERi0xLjQK', filename: 'loss-runs.pdf' };
/* -------------------------------------------------------------------------- */
/* Offline — extract-reply: typed parsing                                     */
/* -------------------------------------------------------------------------- */

describe('offline: extract-reply value checks', () => {
  it('money is plain USD (G-4)', () => {
    expect(coerceValue('$150M', TIV)).toBe(150_000_000);
    expect(coerceValue('$50K', TIV)).toBe(50_000);
    expect(coerceValue('$1,250,000', TIV)).toBe(1_250_000);
    expect(coerceValue('2.5 million', TIV)).toBe(2_500_000);
    expect(coerceValue('-5000', TIV)).toBeUndefined(); // below min 0
    expect(coerceValue('about a lot', TIV)).toBeUndefined();
  });

  it('years are integers, floored, and range-checked (G-5)', () => {
    expect(coerceValue('1978', YEAR)).toBe(1978);
    expect(coerceValue(1978.6, YEAR)).toBe(1978);
    expect(coerceValue('1790', YEAR)).toBeUndefined();
    expect(coerceValue('2031', YEAR)).toBeUndefined();
    expect(coerceValue('the seventies', YEAR)).toBeUndefined();
  });

  it('percents are shares in [0, 1] (G-6)', () => {
    expect(coerceValue('50%', PCT)).toBe(0.5);
    expect(coerceValue('40', PCT)).toBe(0.4);
    expect(coerceValue(0.25, PCT)).toBe(0.25);
    expect(coerceValue('150%', PCT)).toBeUndefined();
  });

  it('booleans, options and nulls', () => {
    expect(coerceValue('yes', SPRINK)).toBe(true);
    expect(coerceValue('No', SPRINK)).toBe(false);
    expect(coerceValue('partially', SPRINK)).toBeUndefined();
    expect(coerceValue('joisted masonry', CONSTR)).toBe('Joisted Masonry');
    expect(coerceValue('steel', CONSTR)).toBeUndefined();
    expect(coerceValue(null, YEAR)).toBeNull();
    expect(coerceValue('N/A', YEAR)).toBeNull();
  });

  it('quotes must appear in the source, modulo whitespace, case and typographic marks', () => {
    const source = 'We’re at  1978 — per the deed.';
    expect(quoteInSource("we're at 1978 - per the deed", source)).toBe(true);
    expect(quoteInSource('"We’re at 1978"', source)).toBe(true);
    expect(quoteInSource('built in 1979', source)).toBe(false);
    expect(quoteInSource('at', source)).toBe(false); // too short to mean anything
  });
});

/* -------------------------------------------------------------------------- */
/* Offline — extract-reply: the call                                          */
/* -------------------------------------------------------------------------- */

describe('offline: extract-reply', () => {
  it('parses, range-checks and keeps verified values; every field lands in values or notFound', async () => {
    const fake = fakeWith({
      values: [
        { canonicalPath: 'buildings.yearBuilt', value: '1978', confidence: 0.95, quote: 'Building C was built in 1978.' },
        { canonicalPath: 'buildings.tiv', value: '$2.5M', confidence: 0.9, quote: 'Total insured value is $2.5M across the site.' },
        { canonicalPath: 'buildings.sprinklered', value: 'yes', confidence: 1.4, quote: 'The building is fully sprinklered.' },
        { canonicalPath: 'pctTivPre1990', value: '40%', confidence: 0.6, quote: 'Roughly 40% of the TIV is in the older building.' },
        { canonicalPath: 'buildings.construction', value: 'joisted masonry', confidence: 0.88, quote: 'Construction is joisted masonry.' },
      ],
      notFound: [],
    });
    const out = await extractReplyCall(fake, extractInput());
    expect(out.notFound).toEqual([]);
    expect(out.values).toEqual([
      { canonicalPath: 'buildings.yearBuilt', value: 1978, confidence: 0.95, quote: 'Building C was built in 1978.' },
      { canonicalPath: 'buildings.tiv', value: 2_500_000, confidence: 0.9, quote: 'Total insured value is $2.5M across the site.' },
      { canonicalPath: 'buildings.sprinklered', value: true, confidence: 1, quote: 'The building is fully sprinklered.' },
      { canonicalPath: 'pctTivPre1990', value: 0.4, confidence: 0.6, quote: 'Roughly 40% of the TIV is in the older building.' },
      { canonicalPath: 'buildings.construction', value: 'Joisted Masonry', confidence: 0.88, quote: 'Construction is joisted masonry.' },
    ]);
    const [call] = fake.callsFor('extract-reply');
    expect(call?.prompt).toContain('Building C was built in 1978.');
    expect(call?.prompt).toContain('- buildings.yearBuilt — Year built (year, min 1800, max 2026)');
  });

  it('rejects a fabricated quote, an out-of-range value, an unrequested field, and a year not in its quote', async () => {
    const fake = fakeWith({
      values: [
        { canonicalPath: 'buildings.yearBuilt', value: '1979', confidence: 0.99, quote: 'Building C was built in 1978.' },
        { canonicalPath: 'buildings.tiv', value: '$2.5M', confidence: 0.9, quote: 'TIV is two and a half million.' },
        { canonicalPath: 'pctTivPre1990', value: '140%', confidence: 0.9, quote: 'Roughly 40% of the TIV is in the older building.' },
        { canonicalPath: 'buildings.roofAge', value: '12', confidence: 0.9, quote: 'Building C was built in 1978.' },
        { canonicalPath: 'buildings.sprinklered', value: null, confidence: 0.2, quote: '' },
      ],
      notFound: ['buildings.construction', 'not.requested'],
    });
    const out = await extractReplyCall(fake, extractInput());
    expect(out.values).toEqual([]);
    expect(out.notFound).toEqual([
      'buildings.yearBuilt',
      'buildings.tiv',
      'buildings.sprinklered',
      'pctTivPre1990',
      'buildings.construction',
    ]);
  });

  it('a self-contradicting reply keeps the later statement, capped below the gate', async () => {
    const sourceText = 'Built in 1985 per the appraisal. Correction: the deed says it was built in 1978.';
    const fake = fakeWith({
      values: [
        { canonicalPath: 'buildings.yearBuilt', value: '1985', confidence: 0.9, quote: 'Built in 1985 per the appraisal.' },
        { canonicalPath: 'buildings.yearBuilt', value: '1978', confidence: 0.85, quote: 'the deed says it was built in 1978.' },
      ],
      notFound: [],
    });
    const out = await extractReplyCall(fake, extractInput({ sourceText, requestedFields: [YEAR] }));
    expect(out.values).toEqual([
      { canonicalPath: 'buildings.yearBuilt', value: 1978, confidence: CONFLICT_CONFIDENCE_CAP, quote: 'the deed says it was built in 1978.' },
    ]);
  });

  it('agreeing duplicates merge at the weaker confidence', async () => {
    const sourceText = 'Built in 1978. Yes, 1978 is right.';
    const fake = fakeWith({
      values: [
        { canonicalPath: 'buildings.yearBuilt', value: '1978', confidence: 0.9, quote: 'Built in 1978.' },
        { canonicalPath: 'buildings.yearBuilt', value: 1978, confidence: 0.7, quote: 'Yes, 1978 is right.' },
      ],
      notFound: [],
    });
    const out = await extractReplyCall(fake, extractInput({ sourceText, requestedFields: [YEAR] }));
    expect(out.values).toEqual([
      { canonicalPath: 'buildings.yearBuilt', value: 1978, confidence: 0.7, quote: 'Built in 1978.' },
    ]);
  });

  it('a PDF-only value cannot be quote-checked, so it is capped at 0.79', async () => {
    const fake = fakeWith({
      values: [{ canonicalPath: 'buildings.tiv', value: '$50K', confidence: 0.97, quote: 'Total TIV: $50K' }],
      notFound: ['buildings.yearBuilt'],
    });
    const out = await extractReplyCall(fake, extractInput({ sourceText: null, requestedFields: [YEAR, TIV] }), PDF);
    expect(out.values).toEqual([
      { canonicalPath: 'buildings.tiv', value: 50_000, confidence: UNVERIFIED_QUOTE_CONFIDENCE_CAP, quote: 'Total TIV: $50K' },
    ]);
    expect(out.notFound).toEqual(['buildings.yearBuilt']);
    expect(fake.callsFor('extract-reply')[0]?.partKinds).toEqual(['pdf']);
  });

  it('text + PDF: a quote in the text keeps its confidence, one only in the PDF is capped', async () => {
    const fake = fakeWith({
      values: [
        { canonicalPath: 'buildings.yearBuilt', value: '1978', confidence: 0.95, quote: 'Building C was built in 1978.' },
        { canonicalPath: 'buildings.tiv', value: '$3M', confidence: 0.95, quote: 'Schedule total $3M' },
      ],
      notFound: [],
    });
    const out = await extractReplyCall(fake, extractInput({ requestedFields: [YEAR, TIV] }), PDF);
    expect(out.values.map((v) => [v.canonicalPath, v.value, v.confidence])).toEqual([
      ['buildings.yearBuilt', 1978, 0.95],
      ['buildings.tiv', 3_000_000, UNVERIFIED_QUOTE_CONFIDENCE_CAP],
    ]);
  });

  it('degrades to everything notFound; no source or no fields skips the call', async () => {
    const failing = createFakeLlm({ failFor: ['extract-reply'] });
    const out = await extractReplyCall(failing, extractInput({ requestedFields: [YEAR, TIV] }));
    expect(out).toEqual({ values: [], notFound: ['buildings.yearBuilt', 'buildings.tiv'] });
    expect(failing.callsFor('extract-reply')).toHaveLength(2);

    const fake = createFakeLlm();
    expect(await extractReplyCall(fake, extractInput({ sourceText: '   ', requestedFields: [YEAR] }))).toEqual({
      values: [],
      notFound: ['buildings.yearBuilt'],
    });
    expect(await extractReplyCall(fake, extractInput({ requestedFields: [] }))).toEqual({ values: [], notFound: [] });
    expect(fake.calls()).toHaveLength(0);
  });

  it('sends the requested paths as the enforced enum', async () => {
    let seen: AnyGenerateJsonRequest | undefined;
    const fake = createFakeLlm({
      handler: (request) => {
        seen = request;
        return { values: [], notFound: [] };
      },
    });
    await extractReplyCall(fake, extractInput({ requestedFields: [YEAR, TIV] }));
    const items = seen?.schema.response.properties?.values?.items;
    expect(items?.properties?.canonicalPath?.enum).toEqual(['buildings.yearBuilt', 'buildings.tiv']);
    expect(seen?.temperature).toBe(0);
  });

  it('the canned fake answer passes end to end', async () => {
    const out = await extractReplyCall(createFakeLlm(), extractInput({ requestedFields: [YEAR] }));
    expect(out).toEqual({
      values: [{ canonicalPath: 'buildings.yearBuilt', value: 1978, confidence: 0.92, quote: 'Building C was built in 1978.' }],
      notFound: [],
    });
  });
});
