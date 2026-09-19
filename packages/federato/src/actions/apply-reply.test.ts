import { describe, expect, it } from 'vitest';
import type { CanonicalSubmission } from '@retrofit/engine';
import type { ScoreSnapshot, ValidatedFieldValue } from '../types';
import { applyReply, conflictingPaths } from './apply-reply';

const SR = { source: 'self_reported' } as const;

const CANONICAL: CanonicalSubmission = {
  id: 'SUB-1',
  lineOfBusiness: 'commercial_property',
  submissionType: [{ value: 'new_business', provenance: SR }],
  insured: {},
  locations: [{ externalId: 'L1', state: [{ value: 'CA', provenance: SR }] }],
  buildings: [
    {
      externalId: 'B1',
      tiv: [{ value: 20_000_000, provenance: SR }],
      yearBuilt: [{ value: 2012, provenance: SR }],
      constructionType: [{ value: 'Masonry Non-Combustible', provenance: SR }],
    },
    { externalId: 'B3', tiv: [{ value: 30_000_000, provenance: SR }] },
  ],
  hazards: { present: {} },
  exposure: {},
  coverage: { lines: [] },
  history: [],
  pricing: { quotedPremium: [{ value: 190_000, provenance: SR }] },
};

function v(canonicalPath: string, value: unknown, extra: Partial<ValidatedFieldValue> = {}): ValidatedFieldValue {
  return {
    canonicalPath,
    value,
    confidence: 0.9,
    quote: `quote for ${canonicalPath}`,
    accepted: true,
    quoteFound: true,
    typeOk: true,
    rangeOk: true,
    rejection: null,
    needsConfirmation: false,
    ...extra,
  };
}

const BEFORE: ScoreSnapshot = {
  appetiteScore: 75,
  verdict: 'REFER',
  completeness: 88.88888888888889,
  confidence: 0.7,
  predictedPremium: 180_000,
  qualityIndex: 61.2,
  rank: 9,
};

describe('applyReply', () => {
  const validated = [
    v('buildings.B3.yearBuilt', 1978),
    v('pricing.quotedPremium', 175_000),
    v('buildings.B1.constructionType', 'masonry_non_combustible'),
    v('buildings.B1.tiv', 20_000_000.0000001),
    v('buildings.B1.yearBuilt', 1985, { accepted: false, rejection: 'low_confidence', needsConfirmation: true, confidence: 0.6 }),
    v('buildings.B1.sprinklered', 'maybe', { accepted: false, typeOk: false, rejection: 'unparseable' }),
    v('buildings.B3.yearBuilt', 1978),
  ];
  const app = applyReply({
    submissionId: 'SUB-1',
    sourceText: 'Building C was built in 1978.',
    validated,
    canonical: CANONICAL,
    before: BEFORE,
  });

  it('partitions the reply into accepted, needs-confirmation and rejected', () => {
    expect(app.extracted).toHaveLength(7);
    expect(app.accepted.map((x) => x.canonicalPath)).toEqual([
      'buildings.B3.yearBuilt',
      'pricing.quotedPremium',
      'buildings.B1.constructionType',
      'buildings.B1.tiv',
      'buildings.B3.yearBuilt',
    ]);
    expect(app.needsConfirmation.map((x) => x.canonicalPath)).toEqual(['buildings.B1.yearBuilt']);
    expect(app.rejected.map((x) => x.canonicalPath)).toEqual(['buildings.B1.sprinklered']);
  });

  it('writes one answer-provenance ExternalValue per accepted path, with no model confidence', () => {
    expect(app.externalValues.map((e) => [e.canonicalPath, e.value])).toEqual([
      ['buildings.B3.yearBuilt', 1978],
      ['pricing.quotedPremium', 175_000],
      ['buildings.B1.constructionType', 'masonry_non_combustible'],
      ['buildings.B1.tiv', 20_000_000.0000001],
    ]);
    for (const e of app.externalValues) {
      expect(e.provenance.source).toBe('answer');
      // Omitted -> the fixed table's 0.8 applies (V-7).
      expect(e.provenance.confidence).toBeUndefined();
      expect(e.provenance.sourceDetail).toContain('SUB-1');
    }
    expect(app.externalValues[0]?.provenance.sourceDetail).toContain('quote for buildings.B3.yearBuilt');
  });

  it('raises a contradiction only where the reply disagrees with the broker submission', () => {
    // Premium 175,000 vs submitted 190,000 disagrees. B3 had no year (a gap,
    // not a conflict). Construction and TIV are the same value (G-8, 1e-6).
    expect(app.newContradictionPaths).toEqual(['pricing.quotedPremium']);
  });

  it('carries the before snapshot and leaves after to the re-score', () => {
    expect(app.before).toEqual(BEFORE);
    expect(app.after).toBeNull();
    expect(app.sourceText).toBe('Building C was built in 1978.');
    expect(app.submissionId).toBe('SUB-1');
  });

  it('defaults before to null', () => {
    const a = applyReply({ submissionId: 'S', sourceText: '', validated: [], canonical: CANONICAL });
    expect(a.before).toBeNull();
    expect(a.externalValues).toEqual([]);
    expect(a.newContradictionPaths).toEqual([]);
  });
});

describe('conflictingPaths', () => {
  it('compares against self-reported values on top-level, group, list and location slots', () => {
    const out = conflictingPaths(
      [
        v('submissionType', 'renewal'),
        v('locations.L1.state', 'TX'),
        v('buildings.B1.yearBuilt', 2012),
        v('buildings.B9.yearBuilt', 1950),
        v('pricing.quotedPremium', 190_000),
        v('buildings.B1.tiv', 1, { accepted: false, rejection: 'quote_not_found' }),
      ],
      CANONICAL,
    );
    expect(out).toEqual(['submissionType', 'locations.L1.state']);
  });

  it('ignores slots that only hold non-broker values', () => {
    const c: CanonicalSubmission = {
      ...CANONICAL,
      buildings: [{ externalId: 'B1', yearBuilt: [{ value: 1970, provenance: { source: 'enrichment' } }] }],
    };
    expect(conflictingPaths([v('buildings.B1.yearBuilt', 1980)], c)).toEqual([]);
  });
});
