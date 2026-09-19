import { describe, expect, it } from 'vitest';
import type { VectorComponentSpec, VectorSpec } from '@retrofit/engine';
import type { ExtractedFieldValue, RequestSelection, RequestedField } from '../types';
import { validateDraft, validateExtraction } from './validate';

function comp(index: number, key: string, source: string, type: VectorComponentSpec['type'], min?: number, max?: number): VectorComponentSpec {
  return {
    index,
    key,
    label: key,
    source,
    type,
    scaling: { rule: 'none' },
    direction: 'neutral',
    appetiteFactor: true,
    factor: null,
    extensionOnly: false,
    immovable: false,
    required: true,
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
  };
}

/** The commercial spec's components that carry a type and range (vectors/commercial.json). */
const SPEC: VectorSpec = {
  lineOfBusiness: 'commercial_property',
  version: 'test',
  components: [
    comp(0, 'isNewBusiness', 'submissionType', 'binary', 0, 1),
    comp(2, 'stateTier', 'rollup.primaryState', 'tier', 0, 2),
    comp(3, 'totalTiv', 'rollup.totalTiv', 'currency', 0),
    comp(4, 'quotedPremium', 'pricing.quotedPremium', 'currency', 0),
    comp(7, 'pctTivAcceptableConstruction', 'rollup.pctTivAcceptableConstruction', 'ratio', 0, 1),
    comp(8, 'fiveYearLoss', 'rollup.fiveYearLoss', 'currency', 0),
  ],
};

function field(canonicalPath: string, label: string, componentKey: string | null = null): RequestedField {
  return { canonicalPath, componentKey, label, why: 'it decides the building-age factor', factor: null, ruleId: null, currentValue: null, severity: 'HIGH' };
}

function selection(fields: RequestedField[]): RequestSelection {
  return {
    submissionId: 'SUB-1',
    triggers: ['missing_data'],
    fields,
    insuredName: 'Harbor Point Retail LLC',
    broker: null,
    contact: null,
    rationale: '',
    qualifies: fields.length > 0,
  };
}

const SEL = selection([
  field('buildings.B3.yearBuilt', 'year built for Building C', 'pctTivPre1990'),
  field('pricing.quotedPremium', 'quoted premium', 'quotedPremium'),
  field('buildings.B1.sprinklered', 'sprinklered for Building A', 'pctTivSprinklered'),
  field('submissionType', 'submission type (new business or renewal)', 'isNewBusiness'),
  field('pricing.quotedPremium.bogus', 'nothing'),
  field('rollup.pctTivAcceptableConstruction', 'share of TIV in acceptable construction', 'pctTivAcceptableConstruction'),
  field('locations.L1.state', 'state for location L1', 'stateTier'),
]);

const SOURCE = `Hi team — Building C was built in 1978, and the quoted premium is $162.5K.
Building A is fully sprinklered. This is new business.
About 60% of TIV is masonry non-combustible. The property is in ca.`;

function ex(canonicalPath: string, value: unknown, quote: string, confidence = 0.95): ExtractedFieldValue {
  return { canonicalPath, value, quote, confidence };
}

function run(extracted: ExtractedFieldValue[], sel: RequestSelection = SEL) {
  return validateExtraction({ extracted, requested: sel, spec: SPEC, sourceText: SOURCE });
}

describe('validateExtraction', () => {
  it('accepts clean values at or above 0.8 and coerces them to typed values', () => {
    const out = run([
      ex('buildings.B3.yearBuilt', '1978', 'Building C was built in 1978', 0.8),
      ex('pricing.quotedPremium', '$162.5K', 'the quoted premium is $162.5K'),
      ex('buildings.B1.sprinklered', 'yes', 'Building A is fully sprinklered.'),
      ex('submissionType', 'New business', 'This is new business.'),
      ex('rollup.pctTivAcceptableConstruction', '60%', 'About 60% of TIV is masonry non-combustible.'),
      ex('locations.L1.state', 'ca', 'The property is in ca.'),
    ]);
    expect(out.map((v) => v.accepted)).toEqual([true, true, true, true, true, true]);
    expect(out.map((v) => v.value)).toEqual([1978, 162_500, true, 'new_business', 0.6, 'CA']);
    expect(out.every((v) => v.rejection === null && v.quoteFound && v.typeOk && v.rangeOk)).toBe(true);
    expect(out.every((v) => !v.needsConfirmation)).toBe(true);
  });

  it('sends a clean value just under 0.8 to the underwriter, not the engine', () => {
    const [v] = run([ex('buildings.B3.yearBuilt', 1978, 'built in 1978', 0.79)]);
    expect(v?.accepted).toBe(false);
    expect(v?.rejection).toBe('low_confidence');
    expect(v?.needsConfirmation).toBe(true);
  });

  it('rejects a quote that is not in the source text', () => {
    const [v] = run([ex('buildings.B3.yearBuilt', 1978, 'Building C dates from 1978', 0.99)]);
    expect(v?.quoteFound).toBe(false);
    expect(v?.rejection).toBe('quote_not_found');
    expect(v?.needsConfirmation).toBe(false);
  });

  it('matches quotes across typographic quotes, case and whitespace', () => {
    const [v] = run([ex('buildings.B3.yearBuilt', 1978, 'hi team - building c   was built in 1978', 0.9)]);
    expect(v?.quoteFound).toBe(true);
    expect(v?.accepted).toBe(true);
  });

  it('rejects a field that was never requested', () => {
    const [v] = run([ex('buildings.B9.tiv', 5_000_000, 'Building C was built in 1978')]);
    expect(v?.rejection).toBe('not_requested');
    expect(v?.accepted).toBe(false);
  });

  it('rejects wrong types and unparseable text', () => {
    const out = run([
      ex('buildings.B3.yearBuilt', true, 'built in 1978'),
      ex('pricing.quotedPremium', 'about a hundred grand', 'the quoted premium is $162.5K'),
      ex('buildings.B1.sprinklered', 'partially', 'Building A is fully sprinklered.'),
      ex('submissionType', 'rewrite', 'This is new business.'),
      ex('locations.L1.state', 'California', 'The property is in ca.'),
    ]);
    expect(out.map((v) => v.rejection)).toEqual(['wrong_type', 'unparseable', 'unparseable', 'unparseable', 'unparseable']);
    expect(out.every((v) => !v.typeOk && !v.accepted)).toBe(true);
  });

  it('range-checks against the spec and the leaf bounds, flooring years (G-5)', () => {
    const out = run([
      ex('buildings.B3.yearBuilt', 1978.9, 'built in 1978'),
      ex('buildings.B3.yearBuilt', 1492, 'built in 1978'),
      ex('pricing.quotedPremium', -5, 'the quoted premium is $162.5K'),
      ex('rollup.pctTivAcceptableConstruction', 60, 'About 60% of TIV'),
    ]);
    expect(out[0]?.value).toBe(1978);
    expect(out[0]?.accepted).toBe(true);
    expect(out.slice(1).map((v) => v.rejection)).toEqual(['out_of_range', 'out_of_range', 'out_of_range']);
    expect(out.slice(1).every((v) => v.typeOk && !v.rangeOk)).toBe(true);
  });

  it('withholds two clean values for one path that disagree', () => {
    const out = run([
      ex('buildings.B3.yearBuilt', 1978, 'built in 1978'),
      ex('buildings.B3.yearBuilt', 1990, 'Building C was built'),
    ]);
    expect(out.map((v) => v.accepted)).toEqual([false, false]);
    expect(out.every((v) => v.needsConfirmation)).toBe(true);
  });

  it('clamps a stated confidence into [0, 1]', () => {
    const out = run([
      ex('buildings.B3.yearBuilt', 1978, 'built in 1978', 7),
      ex('pricing.quotedPremium', 162_500, 'the quoted premium is $162.5K', Number.NaN),
    ]);
    expect(out[0]?.confidence).toBe(1);
    expect(out[0]?.accepted).toBe(true);
    expect(out[1]?.confidence).toBe(0);
    expect(out[1]?.rejection).toBe('low_confidence');
  });
});

describe('validateDraft', () => {
  const sel = selection([
    field('buildings.B3.yearBuilt', 'year built for Building C', 'pctTivPre1990'),
    field('pricing.quotedPremium', 'quoted premium', 'quotedPremium'),
  ]);

  it('passes a draft that asks for exactly the selected fields', () => {
    const draft = `Hi Kevin,

For Harbor Point Retail, could you send the year built for Building C? It decides the building-age factor.
Please also confirm the quoted premium, which decides the total-premium factor.

Thanks.`;
    const v = validateDraft(sel, draft);
    expect(v).toEqual({ ok: true, missingFields: [], extraneousFields: [], problems: [] });
  });

  it('names a selected field the draft forgot', () => {
    const v = validateDraft(sel, 'Could you send the year built for Building C? Thanks.');
    expect(v.ok).toBe(false);
    expect(v.missingFields).toEqual(['pricing.quotedPremium']);
  });

  it('requires the building to be named, not just the field', () => {
    const v = validateDraft(sel, 'Could you send the year built for each building, and the quoted premium?');
    expect(v.missingFields).toEqual(['buildings.B3.yearBuilt']);
  });

  it('flags a request for a field that was never selected', () => {
    const draft = 'Could you send the year built for Building C and the quoted premium? Please also send five years of loss runs.';
    const v = validateDraft(sel, draft);
    expect(v.ok).toBe(false);
    expect(v.missingFields).toEqual([]);
    expect(v.extraneousFields).toContain('fiveYearLoss');
  });

  it('does not treat context in a non-request sentence as extraneous', () => {
    const draft = 'Your loss history looks clean. Could you send the year built for Building C and the quoted premium?';
    expect(validateDraft(sel, draft).ok).toBe(true);
  });

  it('rejects an empty draft and a draft for a selection that does not qualify', () => {
    expect(validateDraft(sel, '   ').ok).toBe(false);
    const none = validateDraft(selection([]), 'Hello.');
    expect(none.ok).toBe(false);
    expect(none.problems[0]).toContain('does not qualify');
  });
});
