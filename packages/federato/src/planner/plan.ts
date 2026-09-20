/**
 * Step 4 of PRD §7.5: the two-pass plan.
 *
 * TRIAGE  — one cheap `Submission` query selecting id, status and line of
 *           business, plus the display facts Federato already holds on every
 *           submission (insured, broker and underwriter names through `$expand`
 *           leaves, requested limit, dates, decline reason, competitor), so
 *           every account can say who and what it is -- including the 120
 *           knocked out here that no deep query ever reaches.
 * DEEP    — one `Policy` query (NOT a `Submission` query) that expands
 *           `submission`, `insured`, `claims` and
 *           `exposure_units.location.buildings`. `Submission` carries no
 *           premium, TIV, state, construction or building field and no reverse
 *           reference to `Policy`, so rooting the deep pass there returns
 *           nothing scoreable (LIVE_DATA_FACTS.md).
 * NO-POLICY — the 11 property submissions without a policy get their own
 *           `Submission -> insured -> hq` follow-up and resolve to REFER.
 *
 * No plan ever carries an `over` clause: the deployed handler does not
 * partition (LIVE_DATA_FACTS.md), so every rollup happens in engine stage 3.
 *
 * Body owned by Run 1 unit F09.
 */
import type { LineOfBusiness } from '@retrofit/engine';
import type {
  DeepPlan,
  FederatoResource,
  FollowUpPlan,
  LocateResult,
  NoPolicyPlan,
  QueryPlan,
  SelectObject,
  SubmissionFacts,
  TraceRuleNeed,
  TriageKnockout,
  TriagePlan,
  TriageSurvivor,
} from '../types';
import { externalIdOf } from './to-bundle';

export interface PlanInput {
  readonly locate: LocateResult;
  readonly lineOfBusiness: LineOfBusiness;
  readonly pageLimit?: number | undefined;
}

/* -------------------------------------------------------------------------- */
/* Private constants                                                          */
/* -------------------------------------------------------------------------- */

/** Default page size; LIVE_DATA_FACTS verified 200 returns all 27 property policies. */
const DEFAULT_PAGE_LIMIT = 200;

/**
 * Federato's `line_of_business` value for each Retrofit line. `tenant` has no
 * Federato counterpart: tenant accounts come from the phone sweep, never from
 * Federato, so every Federato submission is out of scope for it.
 */
const FEDERATO_LINE: Readonly<Record<LineOfBusiness, string | null>> = {
  commercial_property: 'property',
  tenant: null,
};

const LOB_KNOCKOUT_RULE = 'AG-LOB-NA';
const LOB_CITATION = 'APPETITE_GUIDELINES.pdf p2 "Line of business": Not Acceptable "All other lines"';

const need = (
  ruleId: string,
  factor: string | null,
  canonicalPath: string,
  why: string,
): TraceRuleNeed => ({ ruleId, factor, canonicalPath, why });

const LOB_NEED = need(
  LOB_KNOCKOUT_RULE,
  'line_of_business',
  'lineOfBusiness',
  'Every non-property line is Not Acceptable, so it is decided from line of business alone.',
);

/** Why the triage query also reads the display facts (FILL-backend D1). */
const FACTS_NEED = need(
  'PRD-10-ACCOUNT-FACTS',
  null,
  'submission.facts',
  'Who and what each submission is -- insured, broker and underwriter names, requested limit, received and target effective dates, status, decline reason, competitor -- so every account page can say so, including the submissions knocked out here that no deep query ever reaches. Routing (PRD 7.6) also reads the requested limit. Fetched in this same query: they sit on the Submission record already, so a second query would cost a round trip and learn nothing new.',
);

const TRIAGE_NEEDS: readonly TraceRuleNeed[] = [LOB_NEED, FACTS_NEED];

/** The four fields the line-of-business knockout needs, and nothing else. */
const TRIAGE_MINIMAL_SELECT: readonly string[] = ['id', 'submission_number', 'status', 'line_of_business'];

/**
 * The triage projection. Object form with `$expand` leaves, exactly as
 * QUERY_REQUEST_BODY.pdf documents it (`"broker": { "$expand": { "select":
 * ["name"] } }`): a reference wanted only in the reply is resolved in `select`,
 * not hydrated by an `expand` stage (PRD 7.3).
 */
const TRIAGE_SELECT: SelectObject = {
  id: true,
  submission_number: true,
  status: true,
  line_of_business: true,
  requested_limit: true,
  received_date: true,
  target_effective_date: true,
  decline_reason: true,
  competitor: true,
  insured: { $expand: { select: ['name'] } },
  broker: { $expand: { select: ['name'] } },
  underwriter: { $expand: { select: ['name'] } },
};

/** The appetite factors the deep pass hydrates, each tied to the rule that reads it. */
const DEEP_NEEDS: readonly TraceRuleNeed[] = [
  need('AG-ST-NA', 'submission_type', 'submissionType', 'Renewal business is Not Acceptable; read from Policy.business_type.'),
  need('AG-STATE-T', 'primary_risk_state', 'rollup.primaryState', 'Primary state is the largest TIV share across location states (I-1).'),
  need('AG-TIV-NA', 'tiv', 'rollup.totalTiv', 'Total TIV is the sum of building TIV under the exposure units.'),
  need('AG-PREM-NA-HIGH', 'total_premium', 'pricing.quotedPremium', 'Premium lives on Policy, not Submission.'),
  need('AG-AGE-NA', 'building_age', 'rollup.pctTivPre1990', 'Share of TIV built before 1990 needs every building year and TIV.'),
  need('AG-AGE-REFER', 'building_age', 'rollup.pctTivPre1990', 'Any pre-1990 building raises the refer path.'),
  need('AG-CON-NA', 'construction_type', 'rollup.pctTivAcceptableConstruction', 'Construction class share needs every building construction type and TIV.'),
  need('AG-LOSS-NA', 'loss_value', 'rollup.fiveYearLoss', 'Five-year loss total needs every claim on the policy.'),
  need('X-SPRINKLER-MAJORITY', 'sprinkler_protection', 'rollup.pctTivSprinklered', 'Retrofit extension: sprinklered share of TIV reads Building.sprinklered.'),
  need('X-PPC-GOOD', 'protection_class', 'rollup.tivWeightedProtectionClass', 'Retrofit extension: TIV-weighted protection class reads Location.protection_class.'),
];

const NO_POLICY_NEEDS: readonly TraceRuleNeed[] = [
  need('AG-STATE-T', 'primary_risk_state', 'insured.hq.state', 'With no policy there are no exposure units; HQ is the only location left.'),
  need('AG-ST-NA', 'submission_type', 'submissionType', 'No policy means no business_type: recorded as missing, which forces REFER.'),
];

const FOLLOW_UP_NEEDS: readonly TraceRuleNeed[] = [
  need('PRD-7.5-STEP5', null, 'coverage.lines[]', 'Coverage detail for an account that already scored well.'),
  need('PRD-7.5-STEP5', null, 'broker', 'Broker and contact detail so the underwriter can act on the account.'),
];

/* -------------------------------------------------------------------------- */
/* Private helpers                                                            */
/* -------------------------------------------------------------------------- */

function pageLimitOf(input: PlanInput): number {
  const n = input.pageLimit;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : DEFAULT_PAGE_LIMIT;
}

function federatoLineOf(input: PlanInput): string | null {
  return FEDERATO_LINE[input.lineOfBusiness];
}

function text(value: unknown): string | null {
  if (typeof value === 'string') {
    const t = value.trim();
    return t === '' ? null : t;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** An expanded reference's `name`; a bare id or null (not resolved) is no name. */
function referenceName(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const name = (value as Readonly<Record<string, unknown>>)['name'];
  return typeof name === 'string' && name.trim() !== '' ? name.trim() : null;
}

function numericId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Schema paths the locate step resolved under `root`, for the trace's "why". */
function locatedUnder(input: PlanInput, root: FederatoResource): readonly string[] {
  const paths = new Set<string>();
  for (const f of input.locate.located) {
    if (f.rootResource === root && f.schemaPath !== null) paths.add(f.schemaPath);
  }
  return [...paths].sort((a, b) => a.localeCompare(b));
}

function locatedNote(input: PlanInput, root: FederatoResource): string {
  const paths = locatedUnder(input, root);
  if (paths.length === 0) return '';
  const shown = paths.slice(0, 8).join(', ');
  const more = paths.length > 8 ? ` and ${paths.length - 8} more` : '';
  return ` Located fields under ${root}: ${shown}${more}.`;
}

function uniqueSorted(ids: readonly string[]): readonly string[] {
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

/* -------------------------------------------------------------------------- */
/* Triage                                                                     */
/* -------------------------------------------------------------------------- */

export function planTriage(input: PlanInput): TriagePlan {
  const line = federatoLineOf(input);
  return {
    payload: {
      resource: 'Submission',
      select: TRIAGE_SELECT,
      sort: [{ field: 'id', direction: 'asc' }],
      pagination: { limit: Math.max(pageLimitOf(input), DEFAULT_PAGE_LIMIT) },
    },
    goal:
      (line === null
        ? `List every submission cheaply. ${input.lineOfBusiness} has no Federato line of business, so every row is knocked out on line of business.`
        : `List every submission cheaply (id, number, status, line of business) and knock out every line other than "${line}" before any deep query runs.`) +
      ' The same query reads the facts Federato already holds on each submission (insured, broker and underwriter names, requested limit, received and target effective dates, decline reason, competitor), so every account -- knocked out or not -- can say who and what it is.',
    requiredBy: TRIAGE_NEEDS,
    pathChosen: {
      rootResource: 'Submission',
      path: [],
      why: 'Submission is the unit of work and carries line_of_business directly, so one un-expanded query over it decides the line-of-business knockout for all 158 at once.',
      alternativesRejected: [
        {
          rootResource: 'Policy',
          path: [],
          why: 'Only 113 of 158 submissions have a policy; triaging on Policy would silently lose the submissions that never bound.',
        },
      ],
    },
  };
}

/**
 * The fallback triage query, used only when the handler rejects `planTriage`:
 * the four fields the line-of-business knockout needs. Knockouts still work;
 * the display facts come back as absent (FILL-backend D3).
 */
export function planTriageMinimal(input: PlanInput): TriagePlan {
  const plan = planTriage(input);
  return {
    ...plan,
    payload: { ...plan.payload, select: TRIAGE_MINIMAL_SELECT },
    goal: 'The full triage projection was rejected, so list every submission with only id, number, status and line of business: enough to decide the line-of-business knockout. The display facts stay absent.',
    requiredBy: [LOB_NEED],
  };
}

/**
 * The display facts one triage row carries. Every field is read as-is; a
 * reference that came back as a bare id (not expanded) yields no name, never
 * a guessed one.
 */
export function factsOf(row: Readonly<Record<string, unknown>>, externalId: string, submissionId: number): SubmissionFacts {
  return {
    submissionId,
    submissionNumber: text(row['submission_number']) ?? externalId,
    insuredName: referenceName(row['insured']),
    brokerName: referenceName(row['broker']),
    underwriterName: referenceName(row['underwriter']),
    lineOfBusiness: text(row['line_of_business']),
    status: text(row['status']),
    requestedLimit: finiteNumber(row['requested_limit']),
    receivedDate: text(row['received_date']),
    targetEffectiveDate: text(row['target_effective_date']),
    declineReason: text(row['decline_reason']),
    competitor: text(row['competitor']),
  };
}

/** Splits the triage rows into knockouts and survivors, recording the reason. */
export function triageRows(
  rows: readonly Readonly<Record<string, unknown>>[],
  input: PlanInput,
): {
  readonly knockedOut: readonly TriageKnockout[];
  readonly survivors: readonly TriageSurvivor[];
} {
  const wanted = federatoLineOf(input);
  const knockedOut: TriageKnockout[] = [];
  const survivors: TriageSurvivor[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const submissionId = numericId(row['id']);
    if (submissionId === null) continue;
    let externalId: string;
    try {
      externalId = externalIdOf(row);
    } catch {
      continue;
    }
    if (seen.has(externalId)) continue;
    seen.add(externalId);

    const rawLine = text(row['line_of_business']);
    const lineOfBusiness = rawLine ?? '';
    const status = text(row['status']) ?? '';
    const facts = factsOf(row, externalId, submissionId);

    // A missing line of business is missing data (G-2), never a knockout (G-3):
    // it survives and resolves through the deep or no-policy pass.
    const knocked =
      rawLine !== null && (wanted === null || rawLine.toLowerCase() !== wanted.toLowerCase());

    if (knocked) {
      knockedOut.push({
        externalId,
        submissionId,
        lineOfBusiness,
        status,
        reason:
          wanted === null
            ? `Line of business "${rawLine}" has no counterpart in ${input.lineOfBusiness}; knocked out at triage (${LOB_CITATION}).`
            : `Line of business "${rawLine}" is not "${wanted}"; knocked out at triage (${LOB_CITATION}).`,
        ruleId: LOB_KNOCKOUT_RULE,
        factor: 'line_of_business',
        facts,
      });
    } else {
      survivors.push({ externalId, submissionId, lineOfBusiness, status, facts });
    }
  }

  return { knockedOut, survivors };
}

/* -------------------------------------------------------------------------- */
/* Deep                                                                       */
/* -------------------------------------------------------------------------- */

function deepPlanFor(
  expectedExternalIds: readonly string[],
  line: string,
  input: PlanInput,
): DeepPlan {
  return {
    payload: {
      resource: 'Policy',
      where: { line_of_business: line },
      expand: {
        insured: true,
        submission: true,
        claims: true,
        exposure_units: { location: { buildings: true } },
      },
      sort: [{ field: 'id', direction: 'asc' }],
      pagination: { limit: pageLimitOf(input) },
    },
    goal: `Hydrate every "${line}" policy in one call: premium and business type from Policy, the submission number, the insured, every claim, and every building under exposure_units.location.buildings.`,
    requiredBy: DEEP_NEEDS,
    pathChosen: {
      rootResource: 'Policy',
      path: ['exposure_units', 'location', 'buildings'],
      why:
        'Policy owns premium and business_type and references submission, insured, claims and exposure_units, so one expanded Policy query reaches every scored field. Verified live: all 27 property policies hydrated in one 1.4 s call. Rollups (TIV, pre-1990 share, loss total) run in engine stage 3; no `over` clause is sent because the deployed handler does not partition.' +
        locatedNote(input, 'Policy'),
      alternativesRejected: [
        {
          rootResource: 'Submission',
          path: ['insured'],
          why: 'Submission has no premium, TIV, state, construction or building field and no reverse reference to Policy, so a Submission-rooted deep pass returns nothing scoreable.',
        },
        {
          rootResource: 'Building',
          path: [],
          why: 'Buildings carry no back-reference to their policy or submission; the account they belong to would be lost.',
        },
      ],
    },
    expectedExternalIds: uniqueSorted(expectedExternalIds),
  };
}

/** The verified one-call hydrated Policy query. Never rooted at `Submission`. */
export function planDeep(
  survivors: readonly TriageSurvivor[],
  input: PlanInput,
): DeepPlan | null {
  const line = federatoLineOf(input);
  if (line === null || survivors.length === 0) return null;
  return deepPlanFor(
    survivors.map((s) => s.externalId),
    line,
    input,
  );
}

/* -------------------------------------------------------------------------- */
/* No-policy follow-up                                                        */
/* -------------------------------------------------------------------------- */

/** Survivors with no policy row after the deep pass. */
export function planNoPolicy(
  survivors: readonly TriageSurvivor[],
  hydratedExternalIds: readonly string[],
  input: PlanInput,
): NoPolicyPlan | null {
  const hydrated = new Set(hydratedExternalIds);
  const missing = survivors.filter((s) => !hydrated.has(s.externalId));
  if (missing.length === 0) return null;
  const submissionIds = [...new Set(missing.map((s) => s.submissionId))].sort((a, b) => a - b);

  return {
    payload: {
      resource: 'Submission',
      where: { id: { $in: submissionIds } },
      expand: { insured: { hq: true }, broker: true },
      sort: [{ field: 'id', direction: 'asc' }],
      pagination: { limit: Math.max(pageLimitOf(input), submissionIds.length) },
    },
    goal: `Fetch the ${missing.length} surviving submission${missing.length === 1 ? '' : 's'} with no policy through Submission -> insured -> hq. They carry no premium, business type or buildings, so they resolve to REFER with missing data.`,
    requiredBy: NO_POLICY_NEEDS,
    pathChosen: {
      rootResource: 'Submission',
      path: ['insured', 'hq'],
      why:
        'With no policy there is no exposure unit and no building; the insured headquarters is the only location reachable from the submission.' +
        locatedNote(input, 'Submission'),
      alternativesRejected: [
        {
          rootResource: 'Policy',
          path: ['submission'],
          why: 'These submissions have no policy row, so a Policy-rooted query cannot reach them.',
        },
      ],
    },
    expectedExternalIds: uniqueSorted(missing.map((s) => s.externalId)),
  };
}

/* -------------------------------------------------------------------------- */
/* High-scorer follow-up                                                      */
/* -------------------------------------------------------------------------- */

/** Step 5's extra query for accounts that scored well. */
export function planFollowUps(
  highScorerExternalIds: readonly string[],
  input: PlanInput,
): readonly FollowUpPlan[] {
  const ids = uniqueSorted(highScorerExternalIds.filter((id) => id.trim() !== ''));
  const line = federatoLineOf(input);
  if (ids.length === 0 || line === null) return [];

  return [
    {
      payload: {
        resource: 'Policy',
        where: { line_of_business: line },
        expand: {
          submission: true,
          coverages: true,
          endorsements: true,
          producer: { broker: true, contact: true },
        },
        filter: { 'submission.submission_number': { $in: ids } },
        sort: [{ field: 'id', direction: 'asc' }],
        pagination: { limit: Math.max(pageLimitOf(input), ids.length) },
      },
      goal: `Pull coverage, endorsement and broker detail for the ${ids.length} account${ids.length === 1 ? '' : 's'} that scored well, so the underwriter can act on them.`,
      requiredBy: FOLLOW_UP_NEEDS,
      pathChosen: {
        rootResource: 'Policy',
        path: ['producer', 'broker'],
        why: 'Coverages, endorsements and the producing broker and contact all hang off Policy. The submission is expanded first so the filter can match on submission_number, a single reference that a dot-path may cross.',
        alternativesRejected: [
          {
            rootResource: 'Submission',
            path: ['broker'],
            why: 'Submission reaches the broker but not coverages or endorsements, which only Policy references.',
          },
        ],
      },
      forExternalIds: ids,
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* Whole plan                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The plan as it stands before any query has run: the triage query and the
 * deep query it will be followed by. Survivors, knockouts, the no-policy pass
 * and the follow-ups depend on results, so they are empty here; the runner
 * (F11) fills them with `triageRows`, `planDeep`, `planNoPolicy` and
 * `planFollowUps` as each pass returns.
 */
export function buildPlan(input: PlanInput): QueryPlan {
  const line = federatoLineOf(input);
  return {
    triage: planTriage(input),
    deep: line === null ? null : deepPlanFor([], line, input),
    noPolicy: null,
    followUps: [],
    knockedOut: [],
    survivors: [],
  };
}
