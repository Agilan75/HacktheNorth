import { describe, expect, it } from 'vitest';
import { GLOSSARY_DOC, glossaryEntries, lookupTerm, readGlossary } from './glossary';

describe('GLOSSARY.pdf transcription', () => {
  it('has all fifteen terms, in PDF order, on page 1', () => {
    const entries = glossaryEntries();
    expect(entries.map((e) => e.term)).toEqual([
      'Insurance',
      'Underwriting',
      'Carrier',
      'Policy',
      'Premium',
      'Submission',
      'RiskOps',
      'Appetite',
      'In-Appetite',
      'Out-of-Appetite',
      'Dashboard',
      'API',
      'SQL',
      'JSON',
      'Filtering',
    ]);
    for (const e of entries) {
      expect(e.page).toBe(1);
      expect(e.definition.length).toBeGreaterThan(20);
    }
  });

  it('transcribes definitions verbatim', () => {
    expect(lookupTerm('Carrier')?.definition).toBe('Another name for an insurance company (e.g. Allstate, AIG).');
    expect(lookupTerm('In-Appetite')?.definition).toBe(
      'A submission that matches what the insurer is looking for. High-priority for underwriters.',
    );
    expect(lookupTerm('SQL')?.definition).toContain('premium > $100,000');
  });

  it('looks up case-insensitively over terms and aliases', () => {
    expect(lookupTerm('carrier')?.term).toBe('Carrier');
    expect(lookupTerm('  INSURER ')?.term).toBe('Carrier');
    expect(lookupTerm('in appetite')?.term).toBe('In-Appetite');
    expect(lookupTerm('out-of-appetite')?.term).toBe('Out-of-Appetite');
    expect(lookupTerm('Application Programming Interface')?.term).toBe('API');
    expect(lookupTerm('risk operations')?.term).toBe('RiskOps');
    expect(lookupTerm('submissions')?.term).toBe('Submission');
    expect(lookupTerm('policies')?.term).toBe('Policy');
  });

  it('returns null for unknown or empty terms', () => {
    expect(lookupTerm('')).toBeNull();
    expect(lookupTerm('   ')).toBeNull();
    expect(lookupTerm('deductible')).toBeNull();
    expect(lookupTerm('bus')).toBeNull();
  });

  it('keeps no alias pointing at two entries', () => {
    const seen = new Map<string, string>();
    for (const e of glossaryEntries()) {
      for (const k of [e.term, ...e.aliases]) {
        const key = k.toLowerCase().replace(/-/g, ' ');
        expect(seen.get(key) ?? e.term).toBe(e.term);
        seen.set(key, e.term);
      }
    }
  });

  it('wraps the entries as a document', () => {
    const doc = readGlossary();
    expect(doc.doc).toBe(GLOSSARY_DOC);
    expect(doc.entries).toBe(glossaryEntries());
  });
});
