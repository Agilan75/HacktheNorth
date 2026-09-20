/** Reference index over the six Federato PDFs. Body owned by Run 1 unit F06. */
import type { Citation } from '@retrofit/engine';
import { GLOSSARY_DOC, glossaryEntries } from './glossary';
import { GUIDELINES_DOC, readGuidelines } from './guidelines';
import { queryLanguageNotes } from './query-language';

export interface ReferenceDocument {
  readonly file: string;
  readonly title: string;
  readonly pages: number;
  readonly summary: string;
}

const QUERY_DOC = 'QUERY_REQUEST_BODY.pdf';

/** The six PDFs in `docs/federato/`, in README.txt order. Page counts measured with pdfinfo. */
const DOCUMENTS: readonly ReferenceDocument[] = Object.freeze(
  [
    {
      file: 'STUDENT_PROJECT_GUIDELINES.pdf',
      title: 'Hack the North 2026: Build an AI Underwriting Agent',
      pages: 8,
      summary:
        'The challenge brief: score submissions against appetite, reason about which data to request, rank, and explain every decision; milestones, pitfalls and FAQ.',
    },
    {
      file: 'API_DOCUMENTATION.pdf',
      title: 'API Documentation',
      pages: 3,
      summary:
        'Auth0 client-credentials token from auth.product.federato.ai (valid 4 hours) and the two handler actions, schema and query.',
    },
    {
      file: QUERY_DOC,
      title: 'Query Request Body',
      pages: 7,
      summary:
        'The Mongo-flavoured query language: the where → expand → unwind → filter → over → select → sort → pagination pipeline, operators, combinators, references, aggregations and worked examples.',
    },
    {
      file: GLOSSARY_DOC,
      title: 'Glossary',
      pages: 1,
      summary: 'Insurance, RiskOps / Federato and data/tech terms, from carrier and premium to in-appetite and JSON.',
    },
    {
      file: GUIDELINES_DOC,
      title: 'Appetite Guidelines Reference',
      pages: 2,
      summary:
        'What appetite guidelines are and how to apply them, plus the 2025 sample Commercial Property table: eight factors with Acceptable, Target and Not Acceptable columns.',
    },
    {
      file: 'DATA_SCHEMA.pdf',
      title: 'Data Schema',
      pages: 1,
      summary:
        'Why the schema is discovered at runtime, and how to read it: object, array and reference fields, with reference cardinality one or many.',
    },
  ].map((d) => Object.freeze(d)),
);

export function referenceDocuments(): readonly ReferenceDocument[] {
  return DOCUMENTS;
}

/** A citable span of one transcribed document. */
interface Resolvable {
  readonly keys: readonly string[];
  readonly page: number;
  readonly text: string;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[“”"‘’']/g, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const RESOLVABLE: ReadonlyMap<string, readonly Resolvable[]> = new Map<string, readonly Resolvable[]>([
  [
    normalize(GUIDELINES_DOC),
    readGuidelines().sections.map((s) => ({ keys: [s.id, s.title], page: s.page, text: s.text })),
  ],
  [
    normalize(GLOSSARY_DOC),
    glossaryEntries().map((e) => ({ keys: [e.term, ...e.aliases], page: e.page, text: e.definition })),
  ],
  [
    normalize(QUERY_DOC),
    queryLanguageNotes().map((n) => ({ keys: [n.id, n.title], page: n.page, text: n.quote })),
  ],
]);

/**
 * Splits `p2 "Total premium"`, `page 2 Total premium`, `"Total premium"` or
 * `Total premium` into an optional page and a section name.
 */
function parseSection(section: string): { readonly page: number | null; readonly name: string } {
  const m = /^\s*(?:p|page)\s*(\d+)\b[\s,:.-]*(.*)$/i.exec(section);
  if (m) return { page: Number(m[1]), name: normalize(m[2] ?? '') };
  return { page: null, name: normalize(section) };
}

/**
 * Resolves `{ doc, section }` to the transcribed quote, for citation checks.
 *
 * Returns the transcribed text of the named section — a guidelines row or
 * paragraph, a glossary definition, or a query-language note's quote — so a
 * checker can confirm `citation.quote` occurs in it. `null` when the document
 * is not one of the three transcribed PDFs (the other three are indexed but not
 * transcribed, and PRD.md is not a Federato document), when the section is
 * unknown, or when a stated page disagrees with the transcription.
 */
export function resolveCitation(citation: Citation): string | null {
  const spans = RESOLVABLE.get(normalize(citation.doc));
  if (!spans) return null;
  const { page, name } = parseSection(citation.section);
  if (name === '') return null;
  for (const span of spans) {
    if (page !== null && span.page !== page) continue;
    if (span.keys.some((k) => normalize(k) === name)) return span.text;
  }
  return null;
}
