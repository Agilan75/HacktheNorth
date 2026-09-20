/**
 * V06 — the 30 written broker replies of PRD §12 "Extraction check".
 *
 * Six of each style: clean, partial, vague, self-contradicting, loss-run.
 * Every key of `expected` is a requested field (its canonical path); the value
 * is the answer a careful underwriter would write down from the reply alone.
 *
 * `expected: null` means "this reply does not give a value the system may
 * accept": the field is unanswered, only approximated, or contradicted inside
 * the reply. The extractor is right on such a field when nothing clears the
 * 0.8 gate for it (docs/decisions/V06.md).
 *
 * Values follow INTERPRETATIONS G-4 (money is plain USD), G-5 (integer years),
 * G-6 (shares in [0, 1]) and G-8 (construction in lower snake_case).
 *
 * Imports nothing from `@retrofit/engine` (see ../types.ts).
 */
import type { ExtractReplyFieldSpec } from '@retrofit/contracts';
import type { BrokerReplyFixture } from '../types.js';

/** Construction classes offered to the extractor, normalized per G-8. */
export const REPLY_CONSTRUCTION_OPTIONS = [
  'frame',
  'joisted_masonry',
  'non_combustible',
  'steel',
  'masonry_non_combustible',
  'modified_fire_resistive',
  'fire_resistive',
] as const;

export const REPLY_SUBMISSION_TYPE_OPTIONS = ['new_business', 'renewal'] as const;

/**
 * The field spec for one canonical path used by the fixtures. Building paths
 * are `buildings.<id>.<field>`, location paths `locations.<id>.<field>`.
 * Throws on a path no fixture uses, so a typo fails the test, not the report.
 */
export function replyFieldSpec(canonicalPath: string): ExtractReplyFieldSpec {
  switch (canonicalPath) {
    case 'submissionType':
      return { canonicalPath, label: 'Submission type', type: 'string', options: REPLY_SUBMISSION_TYPE_OPTIONS };
    case 'pricing.quotedPremium':
      return { canonicalPath, label: 'Quoted premium', type: 'money', min: 0, unit: 'USD' };
    case 'history.fiveYearLoss':
      return { canonicalPath, label: 'Five-year incurred losses', type: 'money', min: 0, unit: 'USD' };
  }
  const building = /^buildings\.([A-Za-z0-9-]+)\.(yearBuilt|tiv|constructionType|sprinklered|protectionClass)$/.exec(
    canonicalPath,
  );
  if (building) {
    const id = building[1] as string;
    switch (building[2]) {
      case 'yearBuilt':
        return { canonicalPath, label: `Building ${id} year built`, type: 'year', min: 1700, max: 2100 };
      case 'tiv':
        return { canonicalPath, label: `Building ${id} total insured value`, type: 'money', min: 0, unit: 'USD' };
      case 'constructionType':
        return { canonicalPath, label: `Building ${id} construction type`, type: 'string', options: REPLY_CONSTRUCTION_OPTIONS };
      case 'sprinklered':
        return { canonicalPath, label: `Building ${id} sprinklered`, type: 'boolean' };
      case 'protectionClass':
        return { canonicalPath, label: `Building ${id} protection class`, type: 'number', min: 1, max: 10 };
    }
  }
  const location = /^locations\.([A-Za-z0-9-]+)\.state$/.exec(canonicalPath);
  if (location) {
    return { canonicalPath, label: `Location ${location[1] as string} state`, type: 'string', unit: 'two-letter US state code' };
  }
  throw new Error(`V06: no field spec for canonical path "${canonicalPath}"`);
}

/** The requested fields for one fixture: exactly the keys of `expected`, in order. */
export function requestedFieldsFor(fixture: BrokerReplyFixture): ExtractReplyFieldSpec[] {
  return Object.keys(fixture.expected).map(replyFieldSpec);
}

export const BROKER_REPLIES: readonly BrokerReplyFixture[] = [
  /* ------------------------------------------------------------------ clean */
  {
    id: 'clean-01',
    style: 'clean',
    text:
      'Hi Dana,\n\nBuilding B2 was built in 1978. The total insured value for B2 is $4,250,000.\n\n' +
      'Thanks,\nMark Okafor\nHarbourline Brokerage',
    expected: { 'buildings.B2.yearBuilt': 1978, 'buildings.B2.tiv': 4250000 },
  },
  {
    id: 'clean-02',
    style: 'clean',
    text:
      'Good morning,\n\nConfirming this is a renewal of the expiring policy with you. ' +
      'Our quoted premium is $182,500 for the 12-month term.\n\nBest,\nPriya',
    expected: { submissionType: 'renewal', 'pricing.quotedPremium': 182500 },
  },
  {
    id: 'clean-03',
    style: 'clean',
    text:
      'Answers to your questions on Building B1: it is masonry non-combustible construction, ' +
      'and it is fully sprinklered (wet system, 100% coverage).',
    expected: { 'buildings.B1.constructionType': 'masonry_non_combustible', 'buildings.B1.sprinklered': true },
  },
  {
    id: 'clean-04',
    style: 'clean',
    text:
      'The primary location is 400 Front St, Columbus, OH 43215. ' +
      'The responding fire department grades Building B1 at Protection Class 4.',
    expected: { 'locations.L1.state': 'OH', 'buildings.B1.protectionClass': 4 },
  },
  {
    id: 'clean-05',
    style: 'clean',
    text:
      'Year built per the updated SOV:\n' +
      '- B1: 1995\n' +
      '- B2: 2012\n' +
      '- B3: 1987\n' +
      'Let me know if you need anything else.',
    expected: { 'buildings.B1.yearBuilt': 1995, 'buildings.B2.yearBuilt': 2012, 'buildings.B3.yearBuilt': 1987 },
  },
  {
    id: 'clean-06',
    style: 'clean',
    text:
      'For Building B1: total insured value is $12.5M, construction is joisted masonry, ' +
      'and it was built in 2004. It is not sprinklered.',
    expected: {
      'buildings.B1.tiv': 12500000,
      'buildings.B1.constructionType': 'joisted_masonry',
      'buildings.B1.yearBuilt': 2004,
      'buildings.B1.sprinklered': false,
    },
  },

  /* ---------------------------------------------------------------- partial */
  {
    id: 'partial-01',
    style: 'partial',
    text:
      'Quick one for now: B3 went up in 1964. I am still waiting on the updated SOV from the insured ' +
      'for the building values and will send those over next week.',
    expected: { 'buildings.B3.yearBuilt': 1964, 'buildings.B3.tiv': null },
  },
  {
    id: 'partial-02',
    style: 'partial',
    text:
      'This is new business for us; the account is moving over from another carrier. ' +
      'Loss runs will follow once the insured signs the release, and I will confirm pricing after that.',
    expected: { submissionType: 'new_business', 'pricing.quotedPremium': null, 'history.fiveYearLoss': null },
  },
  {
    id: 'partial-03',
    style: 'partial',
    text:
      'Building B1 is fire resistive: poured concrete frame and floors. ' +
      'Not sure about sprinklers, I will ask the property manager. No word yet on the protection class.',
    expected: {
      'buildings.B1.constructionType': 'fire_resistive',
      'buildings.B1.sprinklered': null,
      'buildings.B1.protectionClass': null,
    },
  },
  {
    id: 'partial-04',
    style: 'partial',
    text:
      'Building B1 was built in 2011 and Building B3 in 1999. ' +
      'B2 is the one the insured is still digging for; the original permits are in storage.',
    expected: { 'buildings.B1.yearBuilt': 2011, 'buildings.B2.yearBuilt': null, 'buildings.B3.yearBuilt': 1999 },
  },
  {
    id: 'partial-05',
    style: 'partial',
    text: 'Values: B2 is insured for $3.1 million. I will get construction details from the engineer.',
    expected: { 'buildings.B2.tiv': 3100000, 'buildings.B2.constructionType': null },
  },
  {
    id: 'partial-06',
    style: 'partial',
    text:
      'The insured is headquartered in Austin and the largest location is in Texas as well (state: TX). ' +
      'Pricing we can talk through on our call Thursday.',
    expected: { 'locations.L1.state': 'TX', 'pricing.quotedPremium': null },
  },

  /* ------------------------------------------------------------------ vague */
  {
    id: 'vague-01',
    style: 'vague',
    text: 'B2 is one of the older buildings on the campus; I believe it dates to sometime in the 70s or 80s.',
    expected: { 'buildings.B2.yearBuilt': null },
  },
  {
    id: 'vague-02',
    style: 'vague',
    text: 'Premium should land somewhere in the low six figures depending on the terms you come back with.',
    expected: { 'pricing.quotedPremium': null },
  },
  {
    id: 'vague-03',
    style: 'vague',
    text: 'There is some sprinkler coverage in B1, I think mainly on the warehouse side.',
    expected: { 'buildings.B1.sprinklered': null },
  },
  {
    id: 'vague-04',
    style: 'vague',
    text: 'B1 is a pretty solid building. Mostly block I think, with a couple of newer additions out back.',
    expected: { 'buildings.B1.constructionType': null },
  },
  {
    id: 'vague-05',
    style: 'vague',
    text: 'Losses have been light. Nothing major that I am aware of in the last few years.',
    expected: { 'history.fiveYearLoss': null },
  },
  {
    id: 'vague-06',
    style: 'vague',
    text: 'B1 is worth roughly $8M, give or take, and it was fully renovated in 2015.',
    expected: { 'buildings.B1.tiv': null, 'buildings.B1.yearBuilt': null },
  },

  /* ----------------------------------------------------- self-contradicting */
  {
    id: 'contradict-01',
    style: 'self_contradicting',
    text:
      'Building B2 was built in 1978 per the SOV. That said, the appraisal we have on file says ' +
      'B2 was constructed in 1985. Hope that helps.',
    expected: { 'buildings.B2.yearBuilt': null },
  },
  {
    id: 'contradict-02',
    style: 'self_contradicting',
    text:
      'This is a renewal. Just to be clear on history, we have never placed this account with your ' +
      'company before, so it would be new business on your side.',
    expected: { submissionType: null },
  },
  {
    id: 'contradict-03',
    style: 'self_contradicting',
    text:
      'B1 is fully sprinklered. I have attached the inspection report, which notes no sprinkler system in B1.',
    expected: { 'buildings.B1.sprinklered': null },
  },
  {
    id: 'contradict-04',
    style: 'self_contradicting',
    text:
      'Quoted premium is $210,000. As a reminder, the premium we quoted of $185,000 already includes terrorism.',
    expected: { 'pricing.quotedPremium': null },
  },
  {
    id: 'contradict-05',
    style: 'self_contradicting',
    text:
      'TIV for B1 is $6,000,000 and it is steel frame construction. ' +
      'Updated schedule attached: total values across both buildings are $6M, with B1 at $4.5M.',
    expected: { 'buildings.B1.tiv': null, 'buildings.B1.constructionType': 'steel' },
  },
  {
    id: 'contradict-06',
    style: 'self_contradicting',
    text:
      'B2 was built in 1978. Correction to my line above: I had the wrong building. ' +
      'B2 was built in 1992, not 1978.',
    expected: { 'buildings.B2.yearBuilt': 1992 },
  },

  /* --------------------------------------------------------------- loss run */
  {
    id: 'lossrun-01',
    style: 'loss_run',
    text:
      'LOSS RUN, valued as of 06/30/2026\n' +
      'Date of Loss | Cause       | Paid      | Reserve  | Incurred\n' +
      '03/14/2022   | Water       | $41,000   | $0       | $41,000\n' +
      '11/02/2023   | Wind/Hail   | $57,000   | $12,300  | $69,300\n' +
      '07/19/2025   | Fire        | $0        | $32,000  | $32,000\n' +
      'Totals       |             | $98,000   | $44,300  | $142,300\n' +
      'Five-year total incurred: $142,300',
    expected: { 'history.fiveYearLoss': 142300 },
  },
  {
    id: 'lossrun-02',
    style: 'loss_run',
    text:
      'Carrier loss history for policy terms 07/01/2021 to 07/01/2026: No losses reported. ' +
      'Five-year total incurred: $0.',
    expected: { 'history.fiveYearLoss': 0 },
  },
  {
    id: 'lossrun-03',
    style: 'loss_run',
    text:
      'Summary of prior-carrier loss runs:\n' +
      '5-year total incurred (2021-2026): $1.2M\n' +
      '10-year total incurred (2016-2026): $1.85M\n' +
      'Largest single loss: $640,000 (2018, fire).',
    expected: { 'history.fiveYearLoss': 1200000 },
  },
  {
    id: 'lossrun-04',
    style: 'loss_run',
    text:
      'Loss summary, last five policy years\n' +
      'Total paid: $60,000\n' +
      'Total outstanding reserve: $25,000\n' +
      'Total incurred (paid + reserve): $85,000\n' +
      'Claim count: 4',
    expected: { 'history.fiveYearLoss': 85000 },
  },
  {
    id: 'lossrun-05',
    style: 'loss_run',
    text:
      'Attached is the current carrier loss run covering 2023-2026 only (3 years). Incurred for that ' +
      'period is $27,500. Prior carrier runs for 2021-2022 are still pending.',
    expected: { 'history.fiveYearLoss': null },
  },
  {
    id: 'lossrun-06',
    style: 'loss_run',
    text:
      'Expiring premium was $140,000; our renewal quoted premium is $152,000.\n' +
      'Loss run (five years, valued 05/31/2026): 6 claims, total incurred $310,500.',
    expected: { 'pricing.quotedPremium': 152000, 'history.fiveYearLoss': 310500 },
  },
];
