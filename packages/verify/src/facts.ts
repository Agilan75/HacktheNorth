import { formatMoney, formatPercent } from '@retrofit/contracts';
import type { GeneratedCase, LayerCFacts, NaiveInput } from './types.js';

/**
 * Layer-C facts text (V07). The model is given the guideline text and the
 * rolled-up facts and nothing else: this function must never include a
 * verdict, a score, a tier, a rule id or any other engine output, or layer C
 * stops being an independent opinion.
 *
 * It also never includes the generator's boundary labels (`under`/`at`/`over`)
 * or the case's stratum: those say where a value sits relative to a threshold,
 * which is the judgement the model is being asked to make.
 */
export function factsForCase(testCase: GeneratedCase): LayerCFacts {
  return { caseId: testCase.caseId, text: renderFacts(testCase.input) };
}

const UNKNOWN = 'unknown (not provided)';

function renderFacts(input: NaiveInput): string {
  const lines = [
    'Submission facts, rolled up across every building on the policy:',
    `- Submission type: ${submissionType(input.submissionType)}`,
    `- Line of business: ${lineOfBusiness(input.lineOfBusiness)}`,
    `- Primary risk state (the state carrying the largest share of TIV): ${quoted(input.primaryState)}`,
    `- TIV (total insured value): ${money(input.totalTiv)}`,
    `- Total premium (quoted): ${money(input.quotedPremium)}`,
    `- Share of TIV in buildings built before 1990: ${share(input.pctTivPre1990)}`,
    `- Share of TIV in buildings built in 2010 or later: ${share(input.pctTivPost2010)}`,
    `- At least one building was built before 1990: ${yesNo(input.anyBuildingPre1990)}`,
    '- Share of TIV in joisted masonry, non-combustible, steel, masonry non-combustible, ' +
      `fire resistive or modified fire resistive construction: ${share(input.pctTivAcceptableConstruction)}`,
    `- Loss value, last five years (paid indemnity + paid expense + open reserves): ${money(input.fiveYearLoss)}`,
    `- An unresolved high-severity contradiction is open on the file: ${yesNo(input.hasOpenHighContradiction)}`,
  ];
  return lines.join('\n');
}

function isKnownNumber(v: number | null): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function submissionType(v: string | null): string {
  if (v === null) return UNKNOWN;
  if (v === 'new_business') return 'New business';
  if (v === 'renewal') return 'Renewal business';
  return `${JSON.stringify(v)} (recorded as given)`;
}

function lineOfBusiness(v: string | null): string {
  if (v === null) return UNKNOWN;
  if (v === 'commercial_property') return 'Property (commercial property)';
  return `${JSON.stringify(v)} (recorded as given)`;
}

function quoted(v: string | null): string {
  if (v === null) return UNKNOWN;
  return /^[A-Z]{2}$/.test(v) ? v : `${JSON.stringify(v)} (recorded as given)`;
}

function yesNo(v: boolean | null): string {
  if (v === null) return UNKNOWN;
  return v ? 'yes' : 'no';
}

/**
 * Money shown exactly: whole dollars grouped, and just enough decimals to show
 * a value like `$150,000,000.01` without rounding it onto the threshold.
 */
function money(v: number | null): string {
  if (!isKnownNumber(v)) return UNKNOWN;
  return formatMoney(v, { decimals: exactDecimals(v, 6) });
}

/** A share in [0, 1] as a percentage, never rounded onto a 50% boundary. */
function share(v: number | null): string {
  if (!isKnownNumber(v)) return UNKNOWN;
  return formatPercent(v, { from: 'ratio', decimals: exactDecimals(v * 100, 6) });
}

/** The fewest decimals (≤ max) that print `x` without visibly moving it. */
function exactDecimals(x: number, max: number): number {
  for (let d = 0; d < max; d += 1) {
    const f = 10 ** d;
    if (Math.abs(Math.round(x * f) / f - x) <= Math.abs(x) * 1e-12) return d;
  }
  return max;
}

/**
 * The guideline text handed to the model alongside the facts: the carrier's
 * appetite table (`APPETITE_GUIDELINES.pdf` p2), the four published
 * interpretations of its ambiguous rows (PRD 6.6), and how the three verdicts
 * and the deciding factor are named. No weights, no scoring formula, and none
 * of the exact-boundary decisions in INTERPRETATIONS.md: reading "Up to $150M"
 * or ">50%" at the boundary is precisely what layer C checks.
 */
export function guidelineBrief(): string {
  return GUIDELINE_BRIEF;
}

const GUIDELINE_BRIEF = [
  '2025 Sample: Commercial Property Underwriting Guidelines',
  '',
  'Factor | Acceptable | Target | Not Acceptable',
  'Submission type | New business | (blank) | Renewal business',
  'Line of business | Property | (blank) | All other lines',
  'Primary risk state | OH, PA, MD, CO, CA, FL, NC, SC, GA, VA, UT | OH, PA, MD, CO, CA, FL | All other states',
  'TIV (Total Insured Value) | Up to $150M | $50M-$100M | Over $150M',
  'Total premium | $50K-$175K | $75K-$100K | Under $50K or over $175K',
  'Building age | Newer than 1990 | Newer than 2010 | Older than 1990',
  'Construction type | >50% JM, non-combustible/steel, or masonry non-combustible | (blank) | >50% other types',
  'Loss value | Under $100,000 | (blank) | Over $100,000',
  '',
  'Published interpretations of the ambiguous rows:',
  '- Primary risk state: a policy can span several states; the primary risk state is the state carrying the largest share of TIV.',
  '- Building age across many buildings: mirror the construction wording. Not Acceptable when more than 50% of TIV is in buildings built before 1990. When any building was built before 1990 but the factor is not Not Acceptable, the submission is referred (REFER).',
  '- Fire Resistive and Modified Fire Resistive construction are not listed but are better classes than those listed; treat them as acceptable construction.',
  '- Loss value is paid indemnity + paid expense + open reserves on claims dated within five years of the submission date.',
  '- For Submission type, Line of business, Construction type and Loss value the Target column is blank, so meeting Acceptable is the best result those factors can have.',
  '',
  'How to decide:',
  '1. If any factor is Not Acceptable, the verdict is DOES_NOT_FIT. The deciding factor is the first Not Acceptable factor in table order (top to bottom).',
  '2. Otherwise, if the fact for any factor is unknown, the verdict is REFER (missing information). An unknown fact is missing, never zero, and a missing fact can never make a factor Not Acceptable.',
  '3. Otherwise, if an unresolved high-severity contradiction is open on the file, the verdict is REFER.',
  '4. Otherwise, if any building was built before 1990, the verdict is REFER.',
  '5. Otherwise the verdict is FIT.',
  'When the verdict is not DOES_NOT_FIT, the deciding factor is the weakest factor whose fact is known: a factor that is only Acceptable where a Target exists is weaker than one at Target (or at Acceptable with a blank Target). Break ties by taking the earliest in this order: line_of_business, primary_risk_state, tiv, total_premium, submission_type, building_age, construction_type, loss_value. If no factor has a known fact, the deciding factor is none.',
  '',
  'Factor ids to use for the deciding factor: submission_type, line_of_business, primary_risk_state, tiv, total_premium, building_age, construction_type, loss_value, none.',
].join('\n');
