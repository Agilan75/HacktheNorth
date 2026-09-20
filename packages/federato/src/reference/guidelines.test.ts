import { describe, expect, it } from 'vitest';
import { GUIDELINES_DOC, guidelineRows, readGuidelines } from './guidelines';

describe('APPETITE_GUIDELINES.pdf transcription', () => {
  const rows = guidelineRows();

  it('has the eight factors in INTERPRETATIONS.md §2 order', () => {
    expect(rows.map((r) => r.factor)).toEqual([
      'submission_type',
      'line_of_business',
      'primary_risk_state',
      'tiv',
      'total_premium',
      'building_age',
      'construction_type',
      'loss_value',
    ]);
  });

  it('transcribes every cell quote-exact', () => {
    const byFactor = Object.fromEntries(rows.map((r) => [r.factor, r]));
    expect(byFactor.submission_type).toMatchObject({
      label: 'Submission type',
      acceptable: 'New business',
      target: '',
      notAcceptable: 'Renewal business',
    });
    expect(byFactor.line_of_business).toMatchObject({
      acceptable: 'Property',
      target: '',
      notAcceptable: 'All other lines',
    });
    expect(byFactor.primary_risk_state).toMatchObject({
      acceptable: 'OH, PA, MD, CO, CA, FL, NC, SC, GA, VA, UT',
      target: 'OH, PA, MD, CO, CA, FL',
      notAcceptable: 'All other states',
    });
    expect(byFactor.tiv).toMatchObject({
      label: 'TIV (Total Insured Value)',
      acceptable: 'Up to $150M',
      target: '$50M-$100M',
      notAcceptable: 'Over $150M',
    });
    expect(byFactor.total_premium).toMatchObject({
      acceptable: '$50K-$175K',
      target: '$75K-$100K',
      notAcceptable: 'Under $50K or over $175K',
    });
    expect(byFactor.building_age).toMatchObject({
      acceptable: 'Newer than 1990',
      target: 'Newer than 2010',
      notAcceptable: 'Older than 1990',
    });
    expect(byFactor.construction_type).toMatchObject({
      acceptable: '>50% JM, non-combustible/steel, or masonry non-combustible',
      target: '',
      notAcceptable: '>50% other types',
    });
    expect(byFactor.loss_value).toMatchObject({
      acceptable: 'Under $100,000',
      target: '',
      notAcceptable: 'Over $100,000',
    });
  });

  it('leaves Target blank for exactly the four T-BLANK factors', () => {
    expect(rows.filter((r) => r.target === '').map((r) => r.factor)).toEqual([
      'submission_type',
      'line_of_business',
      'construction_type',
      'loss_value',
    ]);
  });

  it('keeps the Target state list a subset of the Acceptable list (6 of 11)', () => {
    const row = rows.find((r) => r.factor === 'primary_risk_state')!;
    const acceptable = row.acceptable.split(', ');
    const target = row.target.split(', ');
    expect(acceptable).toHaveLength(11);
    expect(target).toHaveLength(6);
    for (const s of target) expect(acceptable).toContain(s);
  });

  it('cites every row as p2 "<Factor>" with a verbatim quote', () => {
    for (const r of rows) {
      expect(r.citation.doc).toBe(GUIDELINES_DOC);
      expect(r.citation.section).toBe(`p2 "${r.label}"`);
      expect(r.citation.quote).toBe(r.acceptable);
    }
  });

  it('carries the prose sections and the required data points', () => {
    const doc = readGuidelines();
    expect(doc.doc).toBe('APPETITE_GUIDELINES.pdf');
    expect(doc.rows).toBe(rows);
    expect(doc.version).toContain('2025 Sample');
    const titles = doc.sections.map((s) => s.title);
    expect(titles).toContain('What Are Appetite Guidelines?');
    expect(titles).toContain('How to Use the Guidelines, Step by Step');
    const required = doc.sections.find((s) => s.id === 'required-data-points')!;
    expect(required.page).toBe(2);
    expect(required.text).toContain('five-year loss history');
    expect(new Set(doc.sections.map((s) => s.id)).size).toBe(doc.sections.length);
  });

  it('is frozen, so no consumer can mutate the transcription', () => {
    expect(Object.isFrozen(rows)).toBe(true);
    expect(Object.isFrozen(rows[0])).toBe(true);
  });
});
