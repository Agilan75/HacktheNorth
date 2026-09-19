/**
 * APPETITE_GUIDELINES.pdf transcription. Body owned by Run 1 unit F06.
 *
 * Transcribed from `docs/federato/APPETITE_GUIDELINES.pdf` (2 pages). Cell and
 * paragraph text is quote-exact: the PDF's ASCII hyphens (`$50M-$100M`), its
 * curly apostrophes and quotes, and its casing are kept. Line breaks inside a
 * table cell are joined with a single space. A blank Target cell is `''`
 * (INTERPRETATIONS.md T-BLANK decides what that means; this file only records it).
 */
import type { GuidelinesDocument, GuidelineRow, ReferenceSection } from '../types';

export const GUIDELINES_DOC = 'APPETITE_GUIDELINES.pdf';

const GUIDELINES_VERSION = '2025 Sample: Commercial Property Underwriting Guidelines';

/** Page of the factor table. INTERPRETATIONS.md cites every row as `AG p2 "<Factor>"`. */
const TABLE_PAGE = 2;

type RowSpec = Omit<GuidelineRow, 'citation'>;

/** The table, in the PDF's row order, which is also the INTERPRETATIONS.md §2 factor order. */
const ROW_SPECS: readonly RowSpec[] = [
  {
    factor: 'submission_type',
    label: 'Submission type',
    acceptable: 'New business',
    target: '',
    notAcceptable: 'Renewal business',
  },
  {
    factor: 'line_of_business',
    label: 'Line of business',
    acceptable: 'Property',
    target: '',
    notAcceptable: 'All other lines',
  },
  {
    factor: 'primary_risk_state',
    label: 'Primary risk state',
    acceptable: 'OH, PA, MD, CO, CA, FL, NC, SC, GA, VA, UT',
    target: 'OH, PA, MD, CO, CA, FL',
    notAcceptable: 'All other states',
  },
  {
    factor: 'tiv',
    label: 'TIV (Total Insured Value)',
    acceptable: 'Up to $150M',
    target: '$50M-$100M',
    notAcceptable: 'Over $150M',
  },
  {
    factor: 'total_premium',
    label: 'Total premium',
    acceptable: '$50K-$175K',
    target: '$75K-$100K',
    notAcceptable: 'Under $50K or over $175K',
  },
  {
    factor: 'building_age',
    label: 'Building age',
    acceptable: 'Newer than 1990',
    target: 'Newer than 2010',
    notAcceptable: 'Older than 1990',
  },
  {
    factor: 'construction_type',
    label: 'Construction type',
    acceptable: '>50% JM, non-combustible/steel, or masonry non-combustible',
    target: '',
    notAcceptable: '>50% other types',
  },
  {
    factor: 'loss_value',
    label: 'Loss value',
    acceptable: 'Under $100,000',
    target: '',
    notAcceptable: 'Over $100,000',
  },
];

/**
 * Section string for a table row, in the exact form `rules/commercial.json`
 * uses: `p2 "Total premium"`.
 */
function rowSection(label: string): string {
  return `p${TABLE_PAGE} "${label}"`;
}

const ROWS: readonly GuidelineRow[] = Object.freeze(
  ROW_SPECS.map(
    (spec): GuidelineRow =>
      Object.freeze({
        ...spec,
        citation: Object.freeze({
          doc: GUIDELINES_DOC,
          section: rowSection(spec.label),
          // The row's Acceptable cell: the one cell every row has, verbatim.
          quote: spec.acceptable,
        }),
      }),
  ),
);

/** Renders a table row as one line of prose, used as that row's section text. */
function rowText(row: RowSpec): string {
  const target = row.target === '' ? '(blank)' : row.target;
  return `${row.label}: Acceptable ${row.acceptable} | Target ${target} | Not Acceptable ${row.notAcceptable}`;
}

/** The prose sections, verbatim, plus one section per table row. */
const SECTIONS: readonly ReferenceSection[] = Object.freeze(
  [
    {
      id: 'what-are-appetite-guidelines',
      title: 'What Are Appetite Guidelines?',
      page: 1,
      text:
        'Appetite guidelines are a set of rules or criteria that describe the kinds of insurance ' +
        'submissions a carrier is interested in underwriting. ' +
        'Examples: - Only accept Commercial Auto policies in Texas - Target submissions with premium > ' +
        '$100,000 - Avoid policies from high-risk zip codes - Prefer new business over renewals',
    },
    {
      id: 'why-they-matter',
      title: 'Why They Matter for the Challenge',
      page: 1,
      text:
        'These guidelines represent how real-world underwriters make decisions every day. Your agent ' +
        'should: 1. Use these rules to qualify submissions 2. Explain to users (underwriters) why a ' +
        'submission is prioritized 3. Help underwriters take faster, more confident action ' +
        'Guidelines equal underwriting strategy. Your agent should make that strategy clear and actionable.',
    },
    {
      id: 'how-to-use',
      title: 'How to Use the Guidelines, Step by Step',
      page: 1,
      text:
        '1. Read the appetite document. It’s a simple set of rules, e.g. accept if product_type = ' +
        '"Commercial Property" and state = "NY" ; reject if premium < $50,000 ; prioritize if ' +
        'submission_date is within the last 7 days. ' +
        '2. Translate the rules into logic. If a submission matches a rule, mark it “in appetite.” If ' +
        'not, mark it “out of appetite” or lower priority. Simple conditional logic plus an LLM call for ' +
        'the explanation is enough; heavy ML is not required. ' +
        '3. Apply the logic to the sample data pulled from the API. ' +
        '4. Surface the results in your UI. Show which submissions are in appetite, a short explanation ' +
        'of why, and optionally a score or visual signal (color, icon, badge).',
    },
    {
      id: 'sample-table',
      title: GUIDELINES_VERSION,
      page: TABLE_PAGE,
      text: 'Factor | Acceptable | Target | Not Acceptable. ' + ROW_SPECS.map(rowText).join('. '),
    },
    ...ROW_SPECS.map(
      (row): ReferenceSection => ({
        id: `row-${row.factor}`,
        title: row.label,
        page: TABLE_PAGE,
        text: rowText(row),
      }),
    ),
    {
      id: 'required-data-points',
      title: 'Required data points',
      page: TABLE_PAGE,
      text:
        'Required data points behind these rules: account name, primary risk state, line of business, ' +
        'effective/expiration dates, TIV, construction type, building year, premium, and five-year loss history.',
    },
  ].map((s) => Object.freeze(s)),
);

const DOCUMENT: GuidelinesDocument = Object.freeze({
  doc: GUIDELINES_DOC,
  version: GUIDELINES_VERSION,
  rows: ROWS,
  sections: SECTIONS,
});

/** The eight appetite factors as the PDF states them, row by row, quote-exact. */
export function guidelineRows(): readonly GuidelineRow[] {
  return ROWS;
}

export function readGuidelines(): GuidelinesDocument {
  return DOCUMENT;
}
