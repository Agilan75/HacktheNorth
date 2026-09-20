/**
 * Retrofit engine — frozen constants.
 *
 * Every number here is pinned in `docs/contracts/INTERPRETATIONS.md` with its
 * source row. Changing one of these changes the differential test oracle, so
 * they are frozen after Run 0.
 */

import type {
  AppetiteFactorId,
  DistanceBand,
  HazardKey,
  ObjectCategory,
  ObjectLabel,
  QualityWeights,
  SourceKind,
  Tier,
} from './types.js';

/* -------------------------------------------------------------------------- */
/* Tiers (PRD 6.4, 6.5)                                                       */
/* -------------------------------------------------------------------------- */

export const TIER_NOT_ACCEPTABLE = 0;
export const TIER_ACCEPTABLE = 0.6;
export const TIER_TARGET = 1;

/**
 * `refer` is a flag, not a score: a refer rule leaves the factor at its
 * Acceptable tier value and raises REFER at stage 9.
 * See INTERPRETATIONS.md R-AGE-REFER.
 */
export const TIER_VALUE: Readonly<Record<Tier, number>> = {
  not_acceptable: TIER_NOT_ACCEPTABLE,
  acceptable: TIER_ACCEPTABLE,
  target: TIER_TARGET,
  refer: TIER_ACCEPTABLE,
};

/**
 * The four factors whose Target column is blank in APPETITE_GUIDELINES.pdf.
 * For these, meeting the Acceptable condition scores TIER_TARGET (1), because
 * Acceptable is the best achievable outcome. INTERPRETATIONS.md T-BLANK.
 */
export const BLANK_TARGET_FACTORS: readonly AppetiteFactorId[] = [
  'submission_type',
  'line_of_business',
  'construction_type',
  'loss_value',
];

/* -------------------------------------------------------------------------- */
/* Appetite factor weights (INTERPRETATIONS.md W-1). Sum is exactly 1.         */
/* -------------------------------------------------------------------------- */

export const FACTOR_WEIGHTS: Readonly<Record<AppetiteFactorId, number>> = {
  submission_type: 0.1,
  line_of_business: 0.15,
  primary_risk_state: 0.15,
  tiv: 0.15,
  total_premium: 0.15,
  building_age: 0.1,
  construction_type: 0.1,
  loss_value: 0.1,
};

export const APPETITE_FACTORS: readonly AppetiteFactorId[] = [
  'submission_type',
  'line_of_business',
  'primary_risk_state',
  'tiv',
  'total_premium',
  'building_age',
  'construction_type',
  'loss_value',
];

/* -------------------------------------------------------------------------- */
/* Appetite thresholds (APPETITE_GUIDELINES.pdf, 2025 sample table)           */
/* -------------------------------------------------------------------------- */

export const TIV_TARGET_MIN = 50_000_000;
export const TIV_TARGET_MAX = 100_000_000;
export const TIV_ACCEPTABLE_MAX = 150_000_000;

export const PREMIUM_ACCEPTABLE_MIN = 50_000;
export const PREMIUM_TARGET_MIN = 75_000;
export const PREMIUM_TARGET_MAX = 100_000;
export const PREMIUM_ACCEPTABLE_MAX = 175_000;

export const LOSS_ACCEPTABLE_MAX = 100_000;

/** A building is "pre-1990" iff yearBuilt < 1990. */
export const YEAR_PRE_CUTOFF = 1990;
/** A building is "post-2010" iff yearBuilt >= 2010. */
export const YEAR_POST_CUTOFF = 2010;

/** Share thresholds are strict: "more than 50%" means > 0.5. */
export const MAJORITY_SHARE = 0.5;

export const LOSS_WINDOW_YEARS = 5;

export const TARGET_STATES: readonly string[] = ['OH', 'PA', 'MD', 'CO', 'CA', 'FL'];

export const ACCEPTABLE_STATES: readonly string[] = [
  'OH',
  'PA',
  'MD',
  'CO',
  'CA',
  'FL',
  'NC',
  'SC',
  'GA',
  'VA',
  'UT',
];

/** Construction classes the PDF names as acceptable, normalized to snake_case. */
export const ACCEPTABLE_CONSTRUCTION: readonly string[] = [
  'joisted_masonry',
  'non_combustible',
  'steel',
  'masonry_non_combustible',
];

/**
 * Better than the listed classes but not listed. Treated as acceptable and
 * flagged (PRD 6.6 interpretation 3 / INTERPRETATIONS.md I-3).
 */
export const ASSUMED_ACCEPTABLE_CONSTRUCTION: readonly string[] = [
  'fire_resistive',
  'modified_fire_resistive',
];

/* -------------------------------------------------------------------------- */
/* Source confidence (PRD 6.5)                                                */
/* -------------------------------------------------------------------------- */

/**
 * `sweep` is null: the camera carries the model's own stated confidence after
 * the PRD 9.3 adjustments, and it is always present on the provenance.
 */
export const SOURCE_CONFIDENCE: Readonly<Record<SourceKind, number | null>> = {
  self_reported: 0.7,
  enrichment: 0.9,
  answer: 0.8,
  sweep: null,
};

/** Used when a sweep provenance somehow arrives without a confidence. */
export const SWEEP_FALLBACK_CONFIDENCE = 0.5;

/** Observations below this go back to the user to confirm (PRD 9.3 step 7). */
export const MIN_OBSERVATION_CONFIDENCE = 0.6;

/** Extraction and schema-assist acceptance gate (PRD 7.5, 7.6). */
export const MIN_MAP_CONFIDENCE = 0.8;
export const MIN_EXTRACTION_CONFIDENCE = 0.8;

/* -------------------------------------------------------------------------- */
/* Peers, pricing, quality                                                    */
/* -------------------------------------------------------------------------- */

export const K_PEERS = 5;

/** Peer distance runs over components 2..10 of the commercial vector. */
export const PEER_COMPONENT_MIN_INDEX = 2;

/** Credibility blend weight n / (n + k) for expected loss. */
export const CREDIBILITY_K = 5;

/** Price adequacy under this is "underpriced for the risk". */
export const ADEQUACY_UNDERPRICED = 0.9;

export const QUALITY_WEIGHTS: QualityWeights = {
  appetite: 0.5,
  adequacy: 0.2,
  lossRatio: 0.15,
  completeness: 0.1,
  confidence: 0.05,
};

/* -------------------------------------------------------------------------- */
/* Tolerances                                                                 */
/* -------------------------------------------------------------------------- */

/** Score, premium and tier comparisons in the differential test. */
export const SCORE_TOLERANCE = 1e-6;
/** Ratios and shares (completeness, TIV shares, confidence). */
export const RATIO_TOLERANCE = 1e-9;
/** Appetite factor weights must sum to 1 within this. */
export const WEIGHT_SUM_TOLERANCE = 1e-9;
/** Money comparisons, in dollars. */
export const MONEY_TOLERANCE = 1e-6;
/** Degrees. */
export const ANGLE_TOLERANCE = 1e-9;

/* -------------------------------------------------------------------------- */
/* Sweep geometry (PRD 9.3, 11)                                               */
/* -------------------------------------------------------------------------- */

export const PANEL_COUNT = 36;
export const PANEL_WIDTH_DEG = 10;
/** Finish is offered at or above this coverage. */
export const MIN_COVERAGE_PCT = 75;
/** Same label within this many degrees merges, keeping max confidence. */
export const DEDUPE_ANGLE_DEG = 15;
/** Pair rules fire within this separation. */
export const PAIR_ANGLE_DEG = 20;
/** Confidence halving for objects seen in only one of the two shuffled runs. */
export const SINGLE_RUN_CONFIDENCE_FACTOR = 0.5;
/** "No smoke detector" counts only with ceiling visible over this share. */
export const CEILING_COVERAGE_REQUIRED = 0.5;
export const MAX_FRAMES = 15;
export const MIN_HEADING_ADVANCE_DEG = 10;

export const DISTANCE_BAND_RADIUS: Readonly<Record<DistanceBand, number>> = {
  near: 0.35,
  mid: 0.65,
  far: 0.95,
};

export const DISTANCE_BAND_ORDER: readonly DistanceBand[] = ['near', 'mid', 'far'];

/* -------------------------------------------------------------------------- */
/* Object vocabulary (PRD 9.2) — exactly 21 labels, order is the prompt order  */
/* -------------------------------------------------------------------------- */

export const OBJECT_VOCAB: readonly ObjectLabel[] = [
  'portable_heater',
  'extension_cord',
  'power_bar',
  'outlet',
  'curtain',
  'fabric',
  'bedding',
  'smoke_detector',
  'sprinkler_head',
  'window_ac_unit',
  'stove',
  'candle',
  'bike',
  'jewelry',
  'camera',
  'laptop',
  'tv',
  'instrument',
  'blocked_exit',
  'water_heater',
  'unknown',
];

export const OBJECT_CATEGORY: Readonly<Record<ObjectLabel, ObjectCategory>> = {
  portable_heater: 'heat_source',
  extension_cord: 'electrical',
  power_bar: 'electrical',
  outlet: 'electrical',
  curtain: 'combustible',
  fabric: 'combustible',
  bedding: 'combustible',
  smoke_detector: 'protection',
  sprinkler_head: 'protection',
  window_ac_unit: 'appliance',
  stove: 'heat_source',
  candle: 'heat_source',
  bike: 'other',
  jewelry: 'valuables',
  camera: 'valuables',
  laptop: 'valuables',
  tv: 'valuables',
  instrument: 'valuables',
  blocked_exit: 'egress',
  water_heater: 'appliance',
  unknown: 'other',
};

/** Labels that count as combustible for the heater pair rule (PRD 6.3). */
export const COMBUSTIBLE_LABELS: readonly ObjectLabel[] = ['curtain', 'fabric', 'bedding'];

/** Labels summed into `hazards.highValueContents`. */
export const HIGH_VALUE_LABELS: readonly ObjectLabel[] = [
  'jewelry',
  'camera',
  'laptop',
  'tv',
  'instrument',
];

/** Engine pair rules, evaluated before the `relate` call (PRD 6.3, 9.2). */
export const PAIR_RULES: readonly {
  readonly hazardKey: HazardKey;
  readonly a: ObjectLabel;
  readonly b: readonly ObjectLabel[];
  readonly maxSeparationDeg: number;
  readonly sameOrAdjacentBand: boolean;
  readonly reason: string;
}[] = [
  {
    hazardKey: 'heaterNearCombustible',
    a: 'portable_heater',
    b: COMBUSTIBLE_LABELS,
    maxSeparationDeg: PAIR_ANGLE_DEG,
    sameOrAdjacentBand: true,
    reason: 'A portable heater sits within 20 degrees of soft furnishings at a similar distance.',
  },
];

export const TENANT_TERMS_MONTHS: readonly number[] = [4, 8, 12];
