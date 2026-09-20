/**
 * Wire DTOs — the exact JSON every route in PRD §8 accepts and returns.
 * FROZEN after Run 0 (W0-3).
 *
 * `packages/contracts` depends only on `@retrofit/engine` and `zod`, because
 * `packages/federato` depends on *it*. So the federato-shaped objects (query
 * trace, explanation, routing) are declared here at the wire boundary, with
 * unions loosened where a stricter domain union lives in `@retrofit/federato`.
 * The domain types there are structurally assignable to these.
 *
 * Every response either has the shape named below or is an `ErrorDto`.
 */

import type {
  AppliedInterpretation,
  Citation,
  Contradiction,
  CoverageResult,
  EngineResult,
  FeatureVector,
  FieldMap,
  FlipResult,
  LineOfBusiness,
  Observation,
  PeerMatch,
  PeerResult,
  PriceBreakdown,
  Question,
  QualityComponents,
  Rollup,
  Rule,
  Severity,
  Verdict,
  VectorSpec,
  VoiResult,
} from '@retrofit/engine';

/* -------------------------------------------------------------------------- */
/* Envelope                                                                   */
/* -------------------------------------------------------------------------- */

export interface ErrorDto {
  readonly error: {
    readonly code: string;
    readonly message: string;
    /** Present on a 422: the zod issues, flattened to path + message. */
    readonly issues?: readonly { readonly path: string; readonly message: string }[];
  };
}

export interface PageDto {
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

/* -------------------------------------------------------------------------- */
/* Shared leaf shapes                                                         */
/* -------------------------------------------------------------------------- */

export type AdapterKindDto = 'live' | 'mock';
export type RecommendationDto = 'accept' | 'review' | 'decline' | 'investigate';
export type RequestTriggerDto = 'missing_data' | 'high_contradiction' | 'one_flip_from_fit';
export type ActionTypeDto = 'route' | 'request' | 'reply' | 'rescore' | 'log' | 'decision';

/**
 * What an underwriter did with the engine's verdict. Recorded **beside** the
 * verdict and never over it: the engine's answer, its deciding rule and its
 * score stay exactly as computed, and this says what a person decided to do
 * about them. A build whose audit trail could be edited by the person being
 * audited would not be worth auditing.
 */
export type DecisionDto = 'accept' | 'decline';
export type ActionStatusDto = 'draft' | 'approved' | 'sent' | 'replied' | 'applied' | 'failed';
export type SweepStageDto =
  | 'received'
  | 'quality_gate'
  | 'observing'
  | 'relating'
  | 'scoring'
  | 'questions'
  | 'done'
  | 'failed';

/** The query trace (PRD §7.5 step 6). `TPayload` is `QueryPayload` in the API. */
export interface QueryTraceEntryDto<TPayload = unknown> {
  readonly id: string;
  readonly seq: number;
  readonly pass: string;
  readonly goal: string;
  readonly requiredBy: readonly {
    readonly ruleId: string;
    readonly factor: string | null;
    readonly canonicalPath: string;
    readonly why: string;
  }[];
  readonly pathChosen: {
    readonly rootResource: string;
    readonly path: readonly string[];
    readonly why: string;
    readonly alternativesRejected: readonly {
      readonly rootResource: string;
      readonly path: readonly string[];
      readonly why: string;
    }[];
  };
  readonly payload: TPayload;
  readonly rowCount: number;
  readonly totalAvailable: number | null;
  readonly durationMs: number;
  readonly adapterKind: AdapterKindDto;
  readonly startedAt: string;
  readonly outcome: string;
  readonly error: {
    readonly code: string | null;
    readonly message: string;
    readonly httpStatus: number | null;
  } | null;
  readonly adaptedFrom: string | null;
  readonly adaptation: string;
  readonly notes: readonly string[];
}

/** The deterministic explanation (PRD §7.7). */
export interface ExplanationDto {
  readonly submissionId: string;
  readonly text: string;
  readonly sentences: readonly string[];
  readonly recommendation: RecommendationDto;
  readonly mixed: boolean;
  readonly inAppetite: readonly {
    readonly factor: string;
    readonly label: string;
    readonly inAppetite: boolean;
    readonly tier: string | null;
    readonly valueText: string;
  }[];
  readonly outOfAppetite: readonly {
    readonly factor: string;
    readonly label: string;
    readonly inAppetite: boolean;
    readonly tier: string | null;
    readonly valueText: string;
  }[];
  readonly numbers: Readonly<Record<string, number>>;
  readonly citations: readonly Citation[];
  readonly template: string;
  readonly narrated: boolean;
}

export interface UnderwriterDto {
  readonly id: number;
  readonly name: string;
  readonly email: string;
  readonly team: string;
  readonly region: string;
  readonly authorityLimit: number;
}

export interface RoutingDecisionDto {
  readonly submissionId: string;
  readonly primaryState: string | null;
  readonly requestedLimit: number | null;
  readonly assigned: UnderwriterDto | null;
  readonly needsSeniorReferral: boolean;
  readonly reason: string;
  readonly candidates: readonly {
    readonly underwriter: UnderwriterDto;
    readonly regionMatches: boolean;
    readonly authorityCovers: boolean;
    readonly reason: string;
  }[];
}

export interface RequestedFieldDto {
  readonly canonicalPath: string;
  readonly componentKey: string | null;
  readonly label: string;
  readonly why: string;
  readonly factor: string | null;
  readonly ruleId: string | null;
  readonly currentValue: string | null;
  readonly severity: Severity;
}

export interface ExtractedValueDto {
  readonly canonicalPath: string;
  readonly value: unknown;
  readonly confidence: number;
  readonly quote: string;
  readonly accepted: boolean;
  readonly quoteFound: boolean;
  readonly typeOk: boolean;
  readonly rangeOk: boolean;
  readonly rejection: string | null;
  readonly needsConfirmation: boolean;
}

/** The before/after pair every action log row carries. */
export interface ScoreSnapshotDto {
  readonly appetiteScore: number;
  readonly verdict: Verdict;
  readonly completeness: number;
  readonly confidence: number;
  readonly predictedPremium: number | null;
  readonly qualityIndex: number;
  readonly rank: number | null;
}

/** An enrichment plugin's card, including the "unavailable" case (PRD §8). */
export interface EnrichmentCardDto {
  readonly source: string;
  readonly title: string;
  readonly available: boolean;
  readonly unavailableReason: string | null;
  readonly fetchedAt: string | null;
  readonly fields: readonly {
    readonly canonicalPath: string;
    readonly label: string;
    readonly valueText: string;
    readonly value: unknown;
  }[];
  readonly attribution: string;
}

/* -------------------------------------------------------------------------- */
/* GET /health                                                                */
/* -------------------------------------------------------------------------- */

export interface HealthDto {
  readonly ok: true;
  readonly version: string;
  readonly adapter: AdapterKindDto;
  /** False when `ANTHROPIC_API_KEY` is unset: the API still starts (PRD §9.1). */
  readonly llmConfigured: boolean;
  readonly submissionCount: number;
  readonly startedAt: string;
}

/* -------------------------------------------------------------------------- */
/* GET /submissions — the ranked queue                                        */
/* -------------------------------------------------------------------------- */

export interface QueueRowDto {
  readonly id: string;
  readonly externalId: string;
  readonly rank: number;
  readonly qualityIndex: number;
  readonly qualityComponents: QualityComponents;
  readonly verdict: Verdict;
  readonly insuredName: string | null;
  readonly lineOfBusiness: string;
  /** True for the 120 rows collapsed under "Out of appetite: line of business". */
  readonly outOfAppetiteLine: boolean;
  readonly accountKind: AccountKindDto;
  /** True when some of the account's values were hand-authored (`synthetic:` provenance), not read from Federato. */
  readonly synthetic: boolean;
  readonly appetiteScore: number;
  readonly primaryState: string | null;
  readonly totalTiv: number | null;
  readonly quotedPremium: number | null;
  readonly predictedPremium: number | null;
  readonly adequacy: number | null;
  readonly completeness: number;
  readonly confidence: number;
  readonly contradictionCount: number;
  readonly openHighContradictionCount: number;
  readonly distanceToAppetite: 0 | 1 | 2 | null;
  /** The "1 flip from FIT" badge. */
  readonly oneFlipFromFit: boolean;
  readonly assignedUnderwriter: UnderwriterDto | null;
  /**
   * Federato's own `Submission.underwriter`, shown when Retrofit has not routed
   * the account (knocked out, or no state to route on). Display only.
   */
  readonly federatoUnderwriter: string | null;
  readonly pendingAction: {
    readonly id: string;
    readonly type: ActionTypeDto;
    readonly status: ActionStatusDto;
  } | null;
  readonly explanation: string | null;
  readonly updatedAt: string;
}

export interface QueueQueryDto {
  readonly line?: string;
  readonly verdict?: Verdict;
  readonly state?: string;
  readonly underwriterId?: number;
  readonly limit?: number;
  readonly offset?: number;
}

export interface QueueResponseDto {
  readonly rows: readonly QueueRowDto[];
  readonly page: PageDto;
  readonly adapter: AdapterKindDto;
  readonly filters: QueueQueryDto;
}

/* -------------------------------------------------------------------------- */
/* GET /submissions/:id                                                       */
/* -------------------------------------------------------------------------- */

export interface BuildingRowDto {
  readonly externalId: string;
  readonly name: string | null;
  readonly tiv: number | null;
  readonly yearBuilt: number | null;
  readonly constructionType: string | null;
  readonly sprinklered: boolean | null;
  readonly stories: number | null;
  readonly protectionClass: number | null;
  readonly state: string | null;
  readonly city: string | null;
  readonly pre1990: boolean;
  readonly post2010: boolean;
  readonly acceptableConstruction: boolean;
  readonly assumedAcceptableConstruction: boolean;
}

/**
 * Which view an account page needs (FILL-backend D4):
 * - `scored`: a property account with a policy, scored on every factor;
 * - `triage_knockout`: a non-property line (cyber, health, cgl, auto, excess,
 *   lpl), knocked out on line of business at triage and never queried in depth;
 * - `no_policy`: a property submission with no policy, so no premium, business
 *   type or buildings -- scored REFER on what is missing.
 * A tenant sweep account is `scored`.
 */
export type AccountKindDto = 'scored' | 'triage_knockout' | 'no_policy';

/**
 * What Federato's own `Submission` record says about the account, read by the
 * planner's triage query for every submission (all 158). Display facts only:
 * none of these is scored. A null is a fact Federato does not hold (or, with
 * `source: 'not_fetched'`, one never read) -- never a guessed value.
 */
export interface SubmissionFactsDto {
  /** `federato_triage`: read by the triage query `traceId`. `not_fetched`: this row was stored before facts were read; every value is null. */
  readonly source: 'federato_triage' | 'not_fetched';
  /** The trace entry of the query that read them, when there is one. */
  readonly traceId: string | null;
  readonly federatoId: number | null;
  readonly submissionNumber: string;
  readonly insuredName: string | null;
  readonly brokerName: string | null;
  readonly underwriterName: string | null;
  /** Federato's own line (`property`, `cyber`, `health`, ...). */
  readonly lineOfBusiness: string | null;
  readonly status: string | null;
  readonly requestedLimit: number | null;
  /** `YYYY-MM-DD`. */
  readonly receivedDate: string | null;
  readonly targetEffectiveDate: string | null;
  readonly declineReason: string | null;
  readonly competitor: string | null;
}

/** One peer, with its verdict from the book's stored results (null when that account has none). */
export type PeerMatchDto = PeerMatch & { readonly verdict: Verdict | null };

export type PeerResultDto = Omit<PeerResult, 'peers'> & { readonly peers: readonly PeerMatchDto[] };

/** The appetite outcome one implementation reached, as compared by verification. */
export interface VerifiedOutcomeDto {
  readonly verdict: Verdict;
  readonly appetiteScore: number;
  readonly knockoutFactorIds: readonly string[];
  readonly decidingFactorId: string | null;
}

/**
 * The verification record of one of the 38 real property accounts, from
 * `packages/verify/out/per-account.json` (written by
 * `packages/verify/src/scripts/per-account.ts`).
 */
export interface AccountVerificationDto {
  readonly caseId: string;
  readonly generatedAt: string;
  /** The engine's outcome on this account when the verification ran. */
  readonly engine: VerifiedOutcomeDto;
  /**
   * True when the stored result the page shows has the same verdict and score
   * as `engine`; false after anything re-scored the account differently (a
   * broker reply, a different as-of date).
   */
  readonly matchesCurrentResult: boolean;
  /** Layer B on the real account: the naive second implementation, given the same rolled-up facts. */
  readonly naive: VerifiedOutcomeDto & {
    readonly agrees: {
      readonly verdict: boolean;
      readonly appetiteScore: boolean;
      readonly knockouts: boolean;
      readonly decidingFactor: boolean;
      readonly all: boolean;
    };
  };
  /** Layer C: the second-opinion model, given only the guideline text and the facts. Null when it never answered. */
  readonly secondOpinion: {
    readonly verdict: Verdict;
    readonly decidingFactor: string;
    readonly reasoning: string;
    readonly agreed: boolean;
    readonly decidingFactorAgreed: boolean;
    /** The engine view layer C compared against. */
    readonly engine: VerifiedOutcomeDto;
  } | null;
}

export interface SubmissionDetailDto {
  readonly id: string;
  readonly externalId: string;
  readonly source: string;
  /** The line the account is SCORED on (the vector spec). See `displayLineOfBusiness` for what to show. */
  readonly lineOfBusiness: LineOfBusiness;
  /** The line to show: Federato's own line (`cyber`, ...) for a triage knockout, otherwise `lineOfBusiness`. */
  readonly displayLineOfBusiness: string;
  readonly accountKind: AccountKindDto;
  /** True when some of the account's values were hand-authored (`synthetic:` provenance), not read from Federato. */
  readonly synthetic: boolean;
  /** Present for every submission. */
  readonly facts: SubmissionFactsDto;
  /** Present for the 38 real property accounts the verification covered; null otherwise or when no verification file exists. */
  readonly verification: AccountVerificationDto | null;
  readonly insuredName: string | null;
  readonly rank: number | null;
  readonly result: EngineResult;
  readonly rollup: Rollup;
  readonly vector: FeatureVector;
  readonly price: PriceBreakdown;
  readonly flip: FlipResult;
  readonly voi: VoiResult;
  /** `result.peers`, each peer carrying its verdict. */
  readonly peers: PeerResultDto | null;
  readonly contradictions: readonly Contradiction[];
  readonly interpretations: readonly AppliedInterpretation[];
  readonly buildings: readonly BuildingRowDto[];
  readonly explanation: ExplanationDto | null;
  readonly queryTrace: readonly QueryTraceEntryDto[];
  readonly fieldMap: FieldMap | null;
  readonly enrichment: readonly EnrichmentCardDto[];
  readonly routing: RoutingDecisionDto | null;
  readonly actions: readonly ActionDto[];
  readonly attachedSweep: SweepDto | null;
  readonly shareSlug: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /**
   * The active vector spec for `lineOfBusiness` (key, label, immovable,
   * appetiteFactor, ... per component), so the console can label `vector`
   * without a private copy. Optional: added at CP1 (request C01); absent when
   * the spec could not be read.
   */
  readonly vectorSpec?: VectorSpec;
}

/* -------------------------------------------------------------------------- */
/* POST /ingest/federato · POST /submissions/:id/run · POST /enrich/:id       */
/* -------------------------------------------------------------------------- */

export interface IngestRequestDto {
  /** Absent means every line the planner supports. */
  readonly lineOfBusiness?: LineOfBusiness;
  /** Ingest only these external ids. Absent means the whole book. */
  readonly externalIds?: readonly string[];
  /** Re-run even when the external id is already stored. Idempotent otherwise. */
  readonly force?: boolean;
  /**
   * Answer with a `runId` at once (202) and keep working in the background,
   * so a caller can watch the planner through `GET /ingest/runs/:runId`
   * instead of holding a request open for the whole run.
   */
  readonly async?: boolean;
}

export interface IngestResponseDto {
  readonly adapter: AdapterKindDto;
  readonly ingested: number;
  readonly updated: number;
  readonly skipped: number;
  readonly knockedOutAtTriage: number;
  readonly noPolicy: number;
  readonly queryCount: number;
  readonly durationMs: number;
  readonly warnings: readonly string[];
  readonly externalIds: readonly string[];
}

/**
 * One planner query, reported the moment it finishes. Every number here is the
 * real one the trace recorded: nothing is estimated, and a step only appears
 * once its query has actually come back.
 */
export interface IngestRunStepDto {
  readonly id: string;
  readonly seq: number;
  /** `schema`, `triage`, `deep`, `no_policy`, `follow_up`, `adapt_retry`. */
  readonly pass: string;
  /** Why this query was run, in the planner's own words. */
  readonly goal: string;
  readonly rootResource: string;
  readonly rowCount: number;
  readonly totalAvailable: number | null;
  readonly durationMs: number;
  readonly outcome: string;
  readonly adaptation: string;
  /** The trace id this query replaced, when it is a retry. */
  readonly adaptedFrom: string | null;
  readonly error: string | null;
}

/** `GET /ingest/runs/:runId`. In-memory and process-local; see `ingest-progress.ts`. */
export interface IngestRunDto {
  readonly runId: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly done: boolean;
  /** Set when the run threw. `done` is true and `result` stays null. */
  readonly error: string | null;
  readonly steps: readonly IngestRunStepDto[];
  /** The usual ingest summary, once the run has finished. */
  readonly result: IngestResponseDto | null;
}

/** The 202 body of `POST /ingest/federato` with `{"async": true}`. */
export interface IngestStartedDto {
  readonly runId: string;
  readonly startedAt: string;
}

/** `POST /submissions/:id/decision`. */
export interface DecisionRequestDto {
  readonly decision: DecisionDto;
  /** The underwriter's own words. Optional, and stored verbatim. */
  readonly reason?: string;
}

export interface DecisionResponseDto {
  readonly id: string;
  readonly decision: DecisionDto;
  /** The engine's verdict at the moment the decision was taken, unchanged. */
  readonly engineVerdict: Verdict;
  readonly action: ActionDto;
}

export interface RunResponseDto {
  readonly id: string;
  readonly before: ScoreSnapshotDto | null;
  readonly after: ScoreSnapshotDto;
  readonly rankChanged: boolean;
  readonly result: EngineResult;
}

export interface EnrichResponseDto {
  readonly id: string;
  readonly cards: readonly EnrichmentCardDto[];
  readonly before: ScoreSnapshotDto | null;
  readonly after: ScoreSnapshotDto;
  readonly result: EngineResult;
}

/* -------------------------------------------------------------------------- */
/* Actions (PRD §7.6)                                                         */
/* -------------------------------------------------------------------------- */

export interface ActionDto {
  readonly id: string;
  readonly submissionId: string;
  readonly externalId: string | null;
  readonly insuredName: string | null;
  readonly type: ActionTypeDto;
  readonly status: ActionStatusDto;
  /** Who or what acted: `code`, `gemini:<call>` or `underwriter`. */
  readonly actor: string;
  readonly triggers: readonly RequestTriggerDto[];
  readonly fields: readonly RequestedFieldDto[];
  /** The drafted message. Nothing is ever really emailed (PRD §7.6). */
  readonly draft: string | null;
  readonly recipient: {
    readonly name: string | null;
    readonly email: string | null;
    readonly brokerName: string | null;
  } | null;
  readonly routing: RoutingDecisionDto | null;
  readonly sourceText: string | null;
  readonly extracted: readonly ExtractedValueDto[];
  readonly before: ScoreSnapshotDto | null;
  readonly after: ScoreSnapshotDto | null;
  readonly rankBefore: number | null;
  readonly rankAfter: number | null;
  readonly note: string | null;
  /** Set only on a `decision` action: what the underwriter chose. */
  readonly decision?: DecisionDto | null;
  readonly createdAt: string;
}

export interface ActionsPlanRequestDto {
  readonly externalIds?: readonly string[];
  /** Skip the Gemini draft and store the deterministic field list only. */
  readonly draftsOff?: boolean;
}

export interface ActionsPlanResponseDto {
  readonly routed: number;
  readonly needsSeniorReferral: number;
  readonly drafted: number;
  readonly skipped: number;
  readonly actions: readonly ActionDto[];
}

export interface ActionsQueryDto {
  readonly status?: ActionStatusDto;
  readonly type?: ActionTypeDto;
  readonly submissionId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ActionsResponseDto {
  readonly actions: readonly ActionDto[];
  readonly page: PageDto;
  /** Stated on screen: the dataset's contacts are synthetic (PRD §16). */
  readonly sendingIsSimulated: true;
}

export interface ApproveActionResponseDto {
  readonly action: ActionDto;
}

export interface ReplyRequestDto {
  /** Free text. Exactly one of `text` or `pdfBase64` is required. */
  readonly text?: string;
  /** A loss run or similar, base64-encoded. */
  readonly pdfBase64?: string;
  readonly filename?: string;
  /** The action this reply answers, when it answers one. */
  readonly actionId?: string;
}

export interface ReplyResponseDto {
  readonly id: string;
  readonly action: ActionDto;
  readonly extracted: readonly ExtractedValueDto[];
  readonly accepted: readonly ExtractedValueDto[];
  readonly rejected: readonly ExtractedValueDto[];
  readonly needsConfirmation: readonly ExtractedValueDto[];
  readonly newContradictions: readonly Contradiction[];
  readonly before: ScoreSnapshotDto;
  readonly after: ScoreSnapshotDto;
  readonly rankBefore: number | null;
  readonly rankAfter: number | null;
  readonly result: EngineResult;
}

/* -------------------------------------------------------------------------- */
/* Sweeps (PRD §8, §11)                                                       */
/* -------------------------------------------------------------------------- */

export interface SweepFrameDto {
  readonly index: number;
  /** Degrees clockwise, 0 = sweep start. */
  readonly bearingDeg: number;
  readonly pitchDeg: number | null;
  readonly capturedAt: string;
  /** 0..1 from the code-side quality gate. */
  readonly quality: number | null;
  readonly dropped: boolean;
  readonly dropReason: string | null;
  /** Server-side path or data URL for the crop view. Never a secret. */
  readonly imageRef: string | null;
}

export interface SweepCreateRequestDto {
  /** Defaults to `Room` server-side: the phone reaches the camera before it can ask for a name. */
  readonly roomLabel?: string;
  /** Defaults to 12 server-side (PRD §11 term; the phone no longer asks). */
  readonly termMonths?: 4 | 8 | 12;
  readonly submissionId?: string;
  /**
   * Replacement value of the contents the sweep priced, in whole USD. The
   * server rounds it into `exposure.contentsLimit`; the renter is never asked
   * to value their own belongings.
   */
  readonly contentsEstimateUsd?: number;
  readonly frames: readonly {
    readonly bearingDeg: number;
    readonly pitchDeg?: number;
    readonly capturedAt: string;
    /** base64 JPEG/PNG, one per captured frame, at most 15. */
    readonly imageBase64: string;
  }[];
}

/**
 * What one priced hazard adds to the monthly premium, at the price the engine
 * just returned. The engine composes a tenant premium as
 * `base x PI(factors)`, so removing one factor is a division, not an estimate.
 * Computed in the API beside the other numbers, never on a phone.
 */
export interface HazardCostDto {
  /** `portableHeater`, matching the `hazard.<key>` rating factor. */
  readonly hazardKey: string;
  /** The rating multiplier the engine applied. */
  readonly factor: number;
  /** Dollars per month this hazard adds. Null when there is no price. */
  readonly monthlyDelta: number | null;
}

export interface SweepDto {
  readonly id: string;
  readonly submissionId: string | null;
  readonly roomLabel: string;
  readonly termMonths: number;
  readonly stage: SweepStageDto;
  readonly frames: readonly SweepFrameDto[];
  readonly coverage: CoverageResult | null;
  readonly observations: readonly Observation[];
  /** Observations under 0.6. Reported, but they no longer hold the sweep open. */
  readonly needsConfirmation: readonly Observation[];
  readonly result: EngineResult | null;
  /** Priced hazards, dearest first. The verdict screen shows the top three. */
  readonly hazardCosts: readonly HazardCostDto[];
  /**
   * The one question still worth asking, or null. Never about anything a
   * camera sweep can answer, and never more than one per sweep.
   */
  readonly pendingQuestion: Question | null;
  readonly askedQuestionIds: readonly string[];
  readonly skippedCount: number;
  readonly error: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SweepAnswersRequestDto {
  readonly answers: readonly {
    readonly questionId: string;
    readonly field: string;
    readonly value: string | number | boolean | null;
    /** True when the user skipped rather than answered. */
    readonly skipped?: boolean;
  }[];
  /**
   * Corrections to a field the sweep derived or defaulted, made inline on the
   * verdict screen. An edit names the canonical field directly, because a
   * derived field has no question to answer. Latest edit per field wins, and an
   * edit outranks the sweep's own value exactly as an answer does.
   */
  readonly edits?: readonly {
    readonly field: string;
    readonly value: string | number | boolean | null;
  }[];
  /** Observations the user confirmed or dismissed. */
  readonly confirmations?: readonly {
    readonly observationId: string;
    readonly confirmed: boolean;
  }[];
}

export interface NextQuestionResponseDto {
  readonly question: Question | null;
  readonly askedCount: number;
  readonly skipped: readonly { readonly field: string; readonly reason: string }[];
  readonly done: boolean;
}

export interface VerifyFixRequestDto {
  readonly hazardKey: string;
  readonly imageBase64: string;
  readonly capturedAt: string;
}

export interface VerifyFixResponseDto {
  readonly sweepId: string;
  readonly hazardKey: string;
  readonly stillPresent: boolean;
  readonly confidence: number;
  readonly reason: string;
  readonly before: ScoreSnapshotDto;
  readonly after: ScoreSnapshotDto;
  readonly result: EngineResult;
}

/* -------------------------------------------------------------------------- */
/* GET /aggregate · GET /rules · GET /glossary · GET /s/:slug                 */
/* -------------------------------------------------------------------------- */

export interface AggregateDto {
  readonly counts: {
    readonly total: number;
    readonly byVerdict: Readonly<Record<Verdict, number>>;
    readonly byLine: Readonly<Record<string, number>>;
    readonly scored: number;
    readonly knockedOut: number;
  };
  /** Ten buckets of ten score points, `scoreHistogram[0]` = 0–9. */
  readonly scoreHistogram: readonly number[];
  readonly topKnockoutFactors: readonly {
    readonly factor: string;
    readonly label: string;
    readonly count: number;
  }[];
  readonly oneFlipAway: readonly {
    readonly id: string;
    readonly externalId: string;
    readonly insuredName: string | null;
    readonly appetiteScore: number;
    readonly moveLabel: string;
    readonly scoreAfter: number;
    readonly premiumAfter: number | null;
  }[];
  readonly bookAdequacy: {
    readonly median: number | null;
    readonly underpricedCount: number;
    readonly n: number;
  };
  /** Read from `packages/verify/out/summary.json`; null before a run exists. */
  readonly verification: {
    readonly propertyCasesRun: number;
    readonly differentialCasesRun: number;
    readonly disagreements: number;
    readonly llmCasesRun: number;
    readonly llmAgreementRate: number | null;
    readonly llmAgreementCi95: readonly [number, number] | null;
    readonly extractionFieldAccuracy: number | null;
    readonly generatedAt: string;
  } | null;
}

/* -------------------------------------------------------------------------- */
/* GET /verification                                                          */
/* -------------------------------------------------------------------------- */

export interface WilsonIntervalDto {
  readonly point: number;
  readonly low: number;
  readonly high: number;
  readonly n: number;
  readonly confidence: number;
}

/** The engine's side of a layer-C case. */
export interface LayerCEngineViewDto extends VerifiedOutcomeDto {
  readonly completeness: number;
  readonly tierValuesByFactor: Readonly<Record<string, number | null>>;
}

export interface LayerCDisagreementDto {
  readonly caseId: string;
  readonly stratum: string;
  readonly engine: LayerCEngineViewDto;
  readonly model: {
    readonly verdict: Verdict;
    readonly decidingFactor: string;
    readonly reasoning: string;
  };
}

/** A real defect the testing found, parsed from its row in DECISIONS.md. */
export interface VerificationDefectDto {
  /** The DECISIONS.md row id, e.g. `CP1-4`, `R2-3`. */
  readonly id: string;
  /** `CP1` (the 100K differential) or `Run 2` (the review over real data). */
  readonly phase: string;
  readonly title: string;
  readonly detail: string;
}

/**
 * Everything the console needs to show the testing (FILL-backend D7). Each
 * block is parsed from a committed file named in `sources`; a block whose
 * file is absent is null, never filled in.
 */
export interface VerificationDto {
  /** Layers A + B: `packages/verify/out/run.json`. */
  readonly layersAB: {
    readonly requested: number;
    readonly completed: number;
    readonly seed: number;
    readonly workers: number;
    readonly invariantViolations: number;
    readonly disagreements: number;
    readonly errors: number;
    readonly casesPerSecond: number;
    readonly startedAt: string;
    readonly finishedAt: string;
  } | null;
  /** Layer C: `packages/verify/out/layer-c.json`. */
  readonly layerC: {
    readonly judged: number;
    readonly agreed: number;
    /** Cases the model never answered; excluded from every count. */
    readonly unanswered: number;
    readonly agreement: WilsonIntervalDto;
    /** Of the agreeing cases, how many also named the same deciding factor. */
    readonly decidingFactorAgreed: number;
    readonly byStratum: readonly {
      readonly stratum: string;
      readonly total: number;
      readonly agreed: number;
      readonly rate: number | null;
    }[];
    readonly disagreements: readonly LayerCDisagreementDto[];
  } | null;
  /** The 38 real property accounts: `packages/verify/out/per-account.json`. */
  readonly realAccounts: {
    readonly total: number;
    readonly naiveAgreedAll: number;
    readonly secondOpinionAnswered: number;
    readonly secondOpinionAgreed: number;
    readonly generatedAt: string;
  } | null;
  /** The reply-extraction check. Never carries a number known to be invalid. */
  readonly extraction: {
    readonly status: 'measured' | 'not_measured';
    readonly fieldAccuracy: number | null;
    /** Why it is not measured, from VERIFICATION.md. */
    readonly reason: string | null;
  };
  /** What the testing found before these zeros, from VERIFICATION.md and DECISIONS.md. */
  readonly defectsFound: {
    readonly cp1InvariantViolations: number | null;
    readonly cp1Disagreements: number | null;
    readonly run2Confirmed: number | null;
    readonly run2Refuted: number | null;
    readonly defects: readonly VerificationDefectDto[];
  };
  /** Repo-relative paths of every file this was read from. */
  readonly sources: readonly string[];
}

export interface RulesResponseDto {
  readonly rulebooks: readonly {
    /** `commercial`, `extensions` or `tenant`. Extensions are labelled as ours. */
    readonly id: string;
    readonly label: string;
    readonly version: string;
    readonly isExtension: boolean;
    readonly rules: readonly Rule[];
  }[];
  readonly interpretations: readonly AppliedInterpretation[];
  readonly weights: Readonly<Record<string, number>>;
}

export interface GlossaryResponseDto {
  readonly entries: readonly {
    readonly term: string;
    readonly definition: string;
    readonly page: number;
    readonly aliases: readonly string[];
  }[];
  readonly doc: string;
}

/** The public share payload. Carries no broker contact and no secret. */
export interface ShareDto {
  readonly slug: string;
  readonly lineOfBusiness: LineOfBusiness;
  readonly verdict: Verdict;
  readonly appetiteScore: number;
  readonly explanation: string | null;
  readonly price: PriceBreakdown;
  readonly flip: FlipResult;
  readonly decidingRule: {
    readonly ruleId: string;
    readonly factor: string;
    readonly citation: Citation;
  } | null;
  readonly createdAt: string;
}
