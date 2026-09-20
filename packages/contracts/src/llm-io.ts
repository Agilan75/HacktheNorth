/**
 * The input and output types for the permitted Gemini calls (PRD §9.2): the
 * eight of Run 0, plus `identify`, the live sweep's per-frame item listing,
 * added when the pricing path moved off the Anthropic SDK. There is no agent
 * loop.
 *
 * The rule these types exist to enforce: **no LLM decides a verdict, a score or
 * a dollar amount.** Gemini turns prose into typed values and typed values into
 * prose; `packages/engine` does the arithmetic. `second-opinion` is the one call
 * that returns a verdict, and it is used by `packages/verify` only — never by a
 * request path.
 */

import type {
  DistanceBand,
  ObjectCategory,
  ObjectLabel,
  Verdict,
} from '@retrofit/engine';

export const LLM_CALLS = [
  'observe',
  'relate',
  'verify-fix',
  'narrate',
  'schema-assist',
  'draft-request',
  'extract-reply',
  'second-opinion',
  'identify',
] as const;

export type LlmCallName = (typeof LLM_CALLS)[number];

/** `second-opinion` runs only inside `packages/verify` (PRD §12 layer C). */
export const VERIFICATION_ONLY_CALLS: readonly LlmCallName[] = ['second-opinion'];

/** Calls that send image parts. Everything else is text-only. */
export const VISION_CALLS: readonly LlmCallName[] = ['observe', 'verify-fix', 'identify'];

/* -------------------------------------------------------------------------- */
/* identify — one live sweep frame, the belongings in it                      */
/* -------------------------------------------------------------------------- */

export interface IdentifyInput {
  /** One downscaled JPEG frame from the sweep. */
  readonly imageBase64: string;
}

export interface IdentifyItem {
  /** A key of the API's price table, never free text. Code drops anything else. */
  readonly label: string;
  /** Short plain description, e.g. "grey three-seat fabric sofa". */
  readonly name: string;
  readonly brand: string | null;
  readonly model: string | null;
  readonly confidence: number;
}

export interface IdentifyOutput {
  readonly items: readonly IdentifyItem[];
}

/* -------------------------------------------------------------------------- */
/* observe — up to 15 quality-passed frames with bearings, ONE request        */
/* -------------------------------------------------------------------------- */

export interface ObserveFrameInput {
  readonly index: number;
  readonly bearingDeg: number;
  /** 0..1 from the code-side quality gate; passed so the model sees it. */
  readonly quality: number;
}

export interface ObserveInput {
  readonly roomLabel: string;
  readonly frames: readonly ObserveFrameInput[];
  /** The fixed vocabulary. Nothing outside it may be returned. */
  readonly vocabulary: readonly ObjectLabel[];
  /**
   * Shuffle seed for the self-consistency pass (PRD §9.3 step 4): the same
   * frames are sent twice in different orders, and the two runs are compared.
   */
  readonly runIndex: 0 | 1;
}

export interface ObserveObject {
  readonly label: ObjectLabel;
  readonly category: ObjectCategory;
  /** Gemini `box_2d` as [y0, x0, y1, x1] in 0..1000. Used by code for crops. */
  readonly box_2d: readonly [number, number, number, number];
  readonly distanceBand: DistanceBand;
  /** 0..1 as stated by the model, before the §9.3 adjustments. */
  readonly confidence: number;
  readonly notes: string;
}

export interface ObserveFrameOutput {
  readonly index: number;
  /** The model gate: false catches photos of screens and obstructed lenses. */
  readonly usable: boolean;
  readonly reason: string;
  /** Gates the "no smoke detector" negative evidence (PRD §9.3 step 5). */
  readonly ceilingVisible: boolean;
  readonly objects: readonly ObserveObject[];
}

export interface ObserveOutput {
  readonly frames: readonly ObserveFrameOutput[];
}

/* -------------------------------------------------------------------------- */
/* relate — merged observation list, NO images                                */
/* -------------------------------------------------------------------------- */

export interface RelateObservationInput {
  readonly id: string;
  readonly label: ObjectLabel;
  readonly bearingDeg: number;
  readonly distanceBand: DistanceBand;
  readonly confidence: number;
}

export interface RelateInput {
  readonly roomLabel: string;
  readonly observations: readonly RelateObservationInput[];
  /** What the engine's pair rules already found. This call only adds or adjusts. */
  readonly engineHazards: readonly { readonly hazardKey: string; readonly confidence: number }[];
  /** The only keys that may be returned. */
  readonly allowedHazardKeys: readonly string[];
}

export interface RelateHazard {
  /** Must be one of `allowedHazardKeys`; anything else is dropped by code. */
  readonly hazardKey: string;
  readonly present: boolean;
  readonly confidence: number;
  readonly reason: string;
  readonly observationIds: readonly string[];
}

export interface RelateOutput {
  readonly hazards: readonly RelateHazard[];
}

/* -------------------------------------------------------------------------- */
/* verify-fix — ONE new photo plus the hazard being checked                   */
/* -------------------------------------------------------------------------- */

export interface VerifyFixInput {
  readonly hazardKey: string;
  readonly hazardLabel: string;
  readonly whatWasSeen: string;
  readonly roomLabel: string;
}

export interface VerifyFixOutput {
  readonly stillPresent: boolean;
  readonly confidence: number;
  readonly reason: string;
}

/* -------------------------------------------------------------------------- */
/* narrate — polished wording ONLY                                            */
/* -------------------------------------------------------------------------- */

export interface NarrateInput {
  /** The deterministic template text. The model rewrites this and nothing else. */
  readonly template: string;
  readonly verdict: Verdict;
  readonly recommendation: string;
  /** Every number that must survive verbatim; `narrate-guard` checks them. */
  readonly numbers: Readonly<Record<string, number>>;
  readonly firedRules: readonly {
    readonly ruleId: string;
    readonly factor: string;
    readonly tier: string;
    readonly quote: string;
  }[];
  readonly flipSummary: string | null;
  readonly insuredName: string | null;
}

export interface NarrateOutput {
  /** 2–3 sentences. Same numbers, same recommendation, better prose. */
  readonly text: string;
}

/* -------------------------------------------------------------------------- */
/* schema-assist — unmapped keys, sample values, canonical field list         */
/* -------------------------------------------------------------------------- */

export interface SchemaAssistInput {
  readonly unmappedKeys: readonly {
    readonly rawPath: string;
    readonly sampleValues: readonly unknown[];
  }[];
  readonly canonicalFields: readonly {
    readonly canonicalPath: string;
    readonly description: string;
  }[];
}

export interface SchemaAssistMappingOut {
  readonly rawPath: string;
  readonly canonicalPath: string;
  /** Accepted at >= 0.8; below that the key stays visibly unmapped. */
  readonly confidence: number;
  readonly reason: string;
}

export interface SchemaAssistOutput {
  readonly mappings: readonly SchemaAssistMappingOut[];
}

/* -------------------------------------------------------------------------- */
/* draft-request — the fields needed, why each matters, the names             */
/* -------------------------------------------------------------------------- */

export interface DraftRequestInput {
  readonly insuredName: string | null;
  readonly brokerName: string | null;
  readonly contactName: string | null;
  readonly fields: readonly {
    readonly canonicalPath: string;
    readonly label: string;
    /** "it decides the building-age factor" */
    readonly why: string;
  }[];
  readonly tone: 'short_and_specific';
}

export interface DraftRequestOutput {
  readonly subject: string;
  readonly body: string;
}

/* -------------------------------------------------------------------------- */
/* extract-reply — free text or PDF + requested fields + the vector spec      */
/* -------------------------------------------------------------------------- */

export interface ExtractReplyFieldSpec {
  readonly canonicalPath: string;
  readonly label: string;
  readonly type: 'number' | 'string' | 'boolean' | 'year' | 'money' | 'percent';
  readonly min?: number;
  readonly max?: number;
  readonly options?: readonly string[];
  readonly unit?: string;
}

export interface ExtractReplyInput {
  /** Present for a pasted reply. A PDF arrives as a part instead. */
  readonly sourceText: string | null;
  readonly requestedFields: readonly ExtractReplyFieldSpec[];
  readonly insuredName: string | null;
}

export interface ExtractReplyValue {
  readonly canonicalPath: string;
  /** Code type- and range-checks this; the model never writes it anywhere. */
  readonly value: string | number | boolean | null;
  readonly confidence: number;
  /** Must appear verbatim in the source, or code rejects the value. */
  readonly quote: string;
}

export interface ExtractReplyOutput {
  readonly values: readonly ExtractReplyValue[];
  /** Fields the reply plainly did not answer. */
  readonly notFound: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* second-opinion — VERIFICATION ONLY (PRD §12 layer C)                       */
/* -------------------------------------------------------------------------- */

export interface SecondOpinionInput {
  /** The guideline text alone. The model never sees any engine output. */
  readonly guidelineText: string;
  readonly facts: Readonly<Record<string, string | number | boolean | null>>;
}

export interface SecondOpinionOutput {
  readonly verdict: Verdict;
  readonly decidingFactor: string;
  readonly reasoning: string;
}

/* -------------------------------------------------------------------------- */
/* The call map                                                               */
/* -------------------------------------------------------------------------- */

/** Input and output type for each call, keyed by `callName`. */
export interface LlmCallIo {
  observe: { input: ObserveInput; output: ObserveOutput };
  relate: { input: RelateInput; output: RelateOutput };
  'verify-fix': { input: VerifyFixInput; output: VerifyFixOutput };
  narrate: { input: NarrateInput; output: NarrateOutput };
  'schema-assist': { input: SchemaAssistInput; output: SchemaAssistOutput };
  'draft-request': { input: DraftRequestInput; output: DraftRequestOutput };
  'extract-reply': { input: ExtractReplyInput; output: ExtractReplyOutput };
  'second-opinion': { input: SecondOpinionInput; output: SecondOpinionOutput };
  identify: { input: IdentifyInput; output: IdentifyOutput };
}

export type LlmCallInput<N extends LlmCallName> = LlmCallIo[N]['input'];
export type LlmCallOutput<N extends LlmCallName> = LlmCallIo[N]['output'];
