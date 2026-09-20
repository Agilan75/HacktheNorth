/**
 * GLOSSARY.pdf transcription. Body owned by Run 1 unit F06.
 *
 * Transcribed from `docs/federato/GLOSSARY.pdf` (1 page, three headings: Core
 * Insurance Concepts, RiskOps / Federato Context, Data and Tech Terms).
 * Definitions are quote-exact, in the PDF's order. Aliases are Retrofit's: the
 * expansions the PDF gives in parentheses, plus the spellings the console and
 * explanations actually use (`in appetite`, `insurer`), so tooltips resolve.
 */
import type { GlossaryDocument, GlossaryEntry } from '../types';

export const GLOSSARY_DOC = 'GLOSSARY.pdf';

const GLOSSARY_VERSION = 'Hack the North 2026 student package';

const ENTRIES: readonly GlossaryEntry[] = Object.freeze(
  [
    // Core Insurance Concepts
    {
      term: 'Insurance',
      definition:
        'A financial product that provides protection against specific risks (accidents, illness, property ' +
        'damage). Customers pay a premium, and the insurer promises to cover certain losses.',
      aliases: [],
    },
    {
      term: 'Underwriting',
      definition:
        'The process insurers use to evaluate the risk of insuring someone or something. Underwriters decide ' +
        'whether to accept or reject applications and how much to charge.',
      aliases: ['Underwriter', 'Underwrite'],
    },
    {
      term: 'Carrier',
      definition: 'Another name for an insurance company (e.g. Allstate, AIG).',
      aliases: ['Insurer', 'Insurance company'],
    },
    {
      term: 'Policy',
      definition:
        'The formal agreement (contract) between the insured (customer) and the insurance company. Outlines ' +
        'what’s covered, how much coverage is provided, and under what conditions.',
      aliases: ['Policies'],
    },
    {
      term: 'Premium',
      definition: 'The amount a customer pays (monthly, quarterly, annually) for insurance coverage.',
      aliases: ['Total premium'],
    },
    {
      term: 'Submission',
      definition:
        'A request for insurance sent by a broker or agent to an insurer, including details about what’s ' +
        'being insured (a building, vehicle, or person).',
      aliases: [],
    },
    // RiskOps / Federato Context
    {
      term: 'RiskOps',
      definition:
        'Short for “Risk Operations.” At Federato, this refers to the tools and workflows that help ' +
        'underwriters make smarter, faster decisions using data and AI.',
      aliases: ['Risk Operations'],
    },
    {
      term: 'Appetite',
      definition:
        'What kinds of risks an insurer wants to take on. For example, a carrier might have appetite for ' +
        'commercial auto insurance in Texas, but not for homes in wildfire-prone areas.',
      aliases: ['Appetite guidelines'],
    },
    {
      term: 'In-Appetite',
      definition: 'A submission that matches what the insurer is looking for. High-priority for underwriters.',
      aliases: ['In appetite'],
    },
    {
      term: 'Out-of-Appetite',
      definition: 'A submission that doesn’t align with the insurer’s current interests or guidelines.',
      aliases: ['Out of appetite'],
    },
    // Data and Tech Terms
    {
      term: 'Dashboard',
      definition:
        'A web interface that shows key information at a glance, like a list of top submissions for the ' +
        'day, charts of premium amounts, or risk scores.',
      aliases: [],
    },
    {
      term: 'API',
      definition:
        'A way for software systems to talk to each other. This project uses an API to get submission data.',
      aliases: ['Application Programming Interface'],
    },
    {
      term: 'SQL',
      definition:
        'A programming language used to access and manipulate databases, e.g. to filter submissions with ' +
        'premium > $100,000.',
      aliases: ['Structured Query Language'],
    },
    {
      term: 'JSON',
      definition:
        'A lightweight format used to exchange data between systems. Data retrieved from the API will come ' +
        'as JSON.',
      aliases: ['JavaScript Object Notation'],
    },
    {
      term: 'Filtering',
      definition:
        'Selecting only the data you want from a larger dataset, e.g. only submissions from California.',
      aliases: ['Filter'],
    },
  ].map(
    (e): GlossaryEntry =>
      Object.freeze({ ...e, page: 1, aliases: Object.freeze([...e.aliases]) }),
  ),
);

const DOCUMENT: GlossaryDocument = Object.freeze({
  doc: GLOSSARY_DOC,
  version: GLOSSARY_VERSION,
  entries: ENTRIES,
});

/** Lower-case, hyphens/underscores as spaces, curly quotes dropped, whitespace collapsed. */
function normalize(term: string): string {
  return term
    .toLowerCase()
    .replace(/[“”"‘’']/g, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const INDEX: ReadonlyMap<string, GlossaryEntry> = (() => {
  const map = new Map<string, GlossaryEntry>();
  for (const entry of ENTRIES) {
    for (const key of [entry.term, ...entry.aliases]) {
      const k = normalize(key);
      if (!map.has(k)) map.set(k, entry);
    }
  }
  return map;
})();

export function glossaryEntries(): readonly GlossaryEntry[] {
  return ENTRIES;
}

export function readGlossary(): GlossaryDocument {
  return DOCUMENT;
}

/** Case-insensitive lookup over terms and aliases; powers the console tooltips. */
export function lookupTerm(term: string): GlossaryEntry | null {
  const key = normalize(term);
  if (key === '') return null;
  const exact = INDEX.get(key);
  if (exact) return exact;
  // Simple plural: "submissions" -> "submission", "premiums" -> "premium".
  if (key.length > 3 && key.endsWith('s')) return INDEX.get(key.slice(0, -1)) ?? null;
  return null;
}
