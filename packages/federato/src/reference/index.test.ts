import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { guidelineRows } from './guidelines';
import { referenceDocuments, resolveCitation } from './index';

interface RuleJson {
  readonly citation: { readonly doc: string; readonly section: string; readonly quote: string };
}

const commercial = JSON.parse(
  readFileSync(new URL('../../../engine/rules/commercial.json', import.meta.url), 'utf8'),
) as { readonly rules: readonly RuleJson[] };

describe('referenceDocuments', () => {
  it('indexes the six Federato PDFs with measured page counts', () => {
    const docs = referenceDocuments();
    expect(docs).toHaveLength(6);
    const pages = Object.fromEntries(docs.map((d) => [d.file, d.pages]));
    expect(pages).toEqual({
      'STUDENT_PROJECT_GUIDELINES.pdf': 8,
      'API_DOCUMENTATION.pdf': 3,
      'QUERY_REQUEST_BODY.pdf': 7,
      'GLOSSARY.pdf': 1,
      'APPETITE_GUIDELINES.pdf': 2,
      'DATA_SCHEMA.pdf': 1,
    });
    for (const d of docs) expect(d.summary.length).toBeGreaterThan(20);
  });
});

describe('resolveCitation', () => {
  it('resolves every guideline row citation to text containing its quote', () => {
    for (const row of guidelineRows()) {
      const text = resolveCitation(row.citation);
      expect(text).not.toBeNull();
      expect(text).toContain(row.acceptable);
      expect(text).toContain(row.notAcceptable);
    }
  });

  it('resolves every APPETITE_GUIDELINES citation in rules/commercial.json', () => {
    const cited = commercial.rules.map((r) => r.citation).filter((c) => c.doc === 'APPETITE_GUIDELINES.pdf');
    expect(cited.length).toBeGreaterThanOrEqual(8);
    for (const c of cited) {
      const text = resolveCitation(c);
      expect(text, `${c.section} ${c.quote}`).not.toBeNull();
      expect(text).toContain(c.quote);
    }
  });

  it('accepts section spellings with and without the page prefix', () => {
    const quote = '$75K-$100K';
    const forms = ['p2 "Total premium"', 'page 2 Total premium', '"Total premium"', 'total premium'];
    for (const section of forms) {
      expect(resolveCitation({ doc: 'APPETITE_GUIDELINES.pdf', section, quote })).toContain(quote);
    }
  });

  it('rejects a wrong page, an unknown section and an untranscribed document', () => {
    const quote = 'x';
    expect(resolveCitation({ doc: 'APPETITE_GUIDELINES.pdf', section: 'p1 "Total premium"', quote })).toBeNull();
    expect(resolveCitation({ doc: 'APPETITE_GUIDELINES.pdf', section: 'p2 "Deductible"', quote })).toBeNull();
    expect(resolveCitation({ doc: 'DATA_SCHEMA.pdf', section: 'References', quote })).toBeNull();
    expect(resolveCitation({ doc: 'PRD.md', section: '6.6 Interpretations', quote })).toBeNull();
    expect(resolveCitation({ doc: 'APPETITE_GUIDELINES.pdf', section: 'p2', quote })).toBeNull();
  });

  it('resolves glossary terms and query-language notes', () => {
    expect(resolveCitation({ doc: 'GLOSSARY.pdf', section: 'p1 "Carrier"', quote: '' })).toBe(
      'Another name for an insurance company (e.g. Allstate, AIG).',
    );
    expect(resolveCitation({ doc: 'GLOSSARY.pdf', section: 'insurer', quote: '' })).toContain('insurance company');
    expect(resolveCitation({ doc: 'QUERY_REQUEST_BODY.pdf', section: 'p5 "Grouping"', quote: '' })).toContain(
      'over partitions rows',
    );
    expect(resolveCitation({ doc: 'QUERY_REQUEST_BODY.pdf', section: 'combinators', quote: '' })).toContain(
      'implicitly form $and',
    );
  });
});
