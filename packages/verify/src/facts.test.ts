import { describe, expect, it } from 'vitest';
import type { GeneratedCase, NaiveInput } from './types.js';
import { factsForCase, guidelineBrief } from './facts.js';

/** INTERPRETATIONS §8 base case B1. */
const B1: NaiveInput = {
  submissionType: 'new_business',
  lineOfBusiness: 'commercial_property',
  primaryState: 'OH',
  totalTiv: 150000000,
  quotedPremium: 175000,
  pctTivPre1990: 0,
  pctTivPost2010: 0,
  pctTivAcceptableConstruction: 0.5,
  fiveYearLoss: 100000,
  anyBuildingPre1990: false,
  hasOpenHighContradiction: false,
};

function makeCase(patch: Partial<NaiveInput> = {}): GeneratedCase {
  return {
    caseId: 'case-7-42',
    seed: 7,
    index: 42,
    input: { ...B1, ...patch },
    boundaries: { tiv: 'at', total_premium: 'at' },
    fromSubmission: false,
  };
}

describe('factsForCase', () => {
  it('states every B1 fact exactly', () => {
    const f = factsForCase(makeCase());
    expect(f.caseId).toBe('case-7-42');
    expect(f.text).toContain('Submission type: New business');
    expect(f.text).toContain('Line of business: Property (commercial property)');
    expect(f.text).toContain('largest share of TIV): OH');
    expect(f.text).toContain('TIV (total insured value): $150,000,000');
    expect(f.text).toContain('Total premium (quoted): $175,000');
    expect(f.text).toContain('built before 1990: 0%');
    expect(f.text).toContain('built in 2010 or later: 0%');
    expect(f.text).toContain('modified fire resistive construction: 50%');
    expect(f.text).toContain('open reserves): $100,000');
    expect(f.text).toContain('At least one building was built before 1990: no');
    expect(f.text).toContain('contradiction is open on the file: no');
  });

  it('never rounds a just-over value onto its threshold (B2, B3, B4, B7)', () => {
    expect(factsForCase(makeCase({ totalTiv: 150000000.01 })).text).toContain('$150,000,000.01');
    expect(factsForCase(makeCase({ quotedPremium: 49999.99 })).text).toContain('$49,999.99');
    expect(factsForCase(makeCase({ fiveYearLoss: 100000.01 })).text).toContain('$100,000.01');
    expect(factsForCase(makeCase({ pctTivPre1990: 0.500001 })).text).toContain(
      'built before 1990: 50.0001%',
    );
    expect(factsForCase(makeCase({ pctTivAcceptableConstruction: 0.4999 })).text).toContain(
      'construction: 49.99%',
    );
  });

  it('marks missing facts as unknown, never zero', () => {
    const text = factsForCase(
      makeCase({ quotedPremium: null, primaryState: null, anyBuildingPre1990: null }),
    ).text;
    expect(text).toContain('Total premium (quoted): unknown');
    expect(text).toContain('largest share of TIV): unknown');
    expect(text).toContain('built before 1990: unknown');
    expect(text).not.toContain('Total premium (quoted): $0');
    expect(factsForCase(makeCase({ totalTiv: Number.NaN })).text).toContain(
      'TIV (total insured value): unknown',
    );
  });

  it('keeps a zero loss as a known $0', () => {
    expect(factsForCase(makeCase({ fiveYearLoss: 0 })).text).toContain('open reserves): $0');
  });

  it('renders renewals and unrecognised values as given', () => {
    const text = factsForCase(
      makeCase({ submissionType: 'renewal', lineOfBusiness: 'general_liability', primaryState: ' oh' }),
    ).text;
    expect(text).toContain('Submission type: Renewal business');
    expect(text).toContain('Line of business: "general_liability"');
    expect(text).toContain('largest share of TIV): " oh"');
  });

  it('carries no engine output, no boundary labels and no case metadata', () => {
    const text = factsForCase(makeCase({ anyBuildingPre1990: true, pctTivPre1990: 0.5 })).text;
    for (const banned of [
      'FIT',
      'REFER',
      'DOES_NOT_FIT',
      'score',
      'Score',
      'tier',
      'Tier',
      'knockout',
      'Target',
      'Not Acceptable',
      'weight',
      'completeness',
      'case-7-42',
      'boundar',
    ]) {
      expect(text, banned).not.toContain(banned);
    }
    expect(text).not.toMatch(/\b(at|under|over)\b threshold/);
  });

  it('is deterministic', () => {
    expect(factsForCase(makeCase()).text).toBe(factsForCase(makeCase()).text);
  });
});

describe('guidelineBrief', () => {
  const brief = guidelineBrief();

  it('carries the AG p2 table rows verbatim', () => {
    expect(brief).toContain('TIV (Total Insured Value) | Up to $150M | $50M-$100M | Over $150M');
    expect(brief).toContain('Total premium | $50K-$175K | $75K-$100K | Under $50K or over $175K');
    expect(brief).toContain('Loss value | Under $100,000 | (blank) | Over $100,000');
    expect(brief).toContain(
      'Primary risk state | OH, PA, MD, CO, CA, FL, NC, SC, GA, VA, UT | OH, PA, MD, CO, CA, FL',
    );
  });

  it('names every factor id the second-opinion call accepts', () => {
    for (const id of [
      'submission_type',
      'line_of_business',
      'primary_risk_state',
      'tiv',
      'total_premium',
      'building_age',
      'construction_type',
      'loss_value',
      'none',
    ]) {
      expect(brief).toContain(id);
    }
  });

  it('gives no weights or scoring formula', () => {
    expect(brief).not.toMatch(/0\.15|0\.10|0\.6\b|appetite score|weight/i);
  });
});
