/**
 * V01 — the naive second implementation of the appetite table.
 *
 * Written in isolation from `docs/federato/APPETITE_GUIDELINES.pdf` page 2,
 * `docs/contracts/INTERPRETATIONS.md` and `packages/verify/spec/NAIVE_SPEC.md`.
 * Nothing here is imported from, or informed by, the engine implementation.
 * Deliberately flat and repetitive: it must fail differently from the engine.
 *
 * Only `../types.js` (itself engine-free) is imported, and only for types.
 */
import type {
  NaiveEvaluate,
  NaiveFactorId,
  NaiveFactorOutcome,
  NaiveInput,
  NaiveResult,
  NaiveTierLabel,
  NaiveVerdict,
} from '../types.js';

/* ------------------------------------------------------ private utilities */

/** INTERPRETATIONS G-1: null / undefined / NaN / ±Infinity are all missing. */
function known(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** G-7 / G-8: compare codes and enums after trimming and case folding. */
function code(s: string | null | undefined): string | null {
  if (typeof s !== 'string') return null;
  return s.trim();
}

function tierLabel(value: number): NaiveTierLabel {
  if (value === 1) return 'target';
  if (value === 0.6) return 'acceptable';
  return 'not_acceptable';
}

function outcome(
  factorId: NaiveFactorId,
  weight: number,
  tierValue: number | null,
): NaiveFactorOutcome {
  if (tierValue === null) {
    return { factorId, tier: null, tierValue: null, weight, points: 0, knockout: false };
  }
  return {
    factorId,
    tier: tierLabel(tierValue),
    tierValue,
    weight,
    points: weight * tierValue * 100,
    knockout: tierValue === 0,
  };
}

/* --------------------------------------------------------- the evaluation */

export const naiveEvaluate: NaiveEvaluate = (input: NaiveInput): NaiveResult => {
  /* ---- 1. submission type — AG p2 "Submission type", T-BLANK, §3.7 ---- */
  let tSubmissionType: number | null;
  const submissionType = code(input.submissionType);
  if (submissionType === null) {
    tSubmissionType = null;
  } else if (submissionType.toLowerCase() === 'new_business') {
    tSubmissionType = 1; // Acceptable → T-BLANK
  } else {
    tSubmissionType = 0; // renewal, and every other value
  }

  /* ---- 2. line of business — AG p2 "Line of business", §3.8 ---- */
  let tLineOfBusiness: number | null;
  const lineOfBusiness = code(input.lineOfBusiness);
  if (lineOfBusiness === null) {
    tLineOfBusiness = null;
  } else if (lineOfBusiness.toLowerCase() === 'commercial_property') {
    tLineOfBusiness = 1; // Acceptable → T-BLANK
  } else {
    tLineOfBusiness = 0;
  }

  /* ---- 3. primary risk state — AG p2 "Primary risk state", §3.6 ---- */
  let tPrimaryRiskState: number | null;
  const state = code(input.primaryState);
  if (state === null) {
    tPrimaryRiskState = null;
  } else {
    const st = state.toUpperCase();
    if (
      st === 'OH' ||
      st === 'PA' ||
      st === 'MD' ||
      st === 'CO' ||
      st === 'CA' ||
      st === 'FL'
    ) {
      tPrimaryRiskState = 1; // Target list, checked first
    } else if (st === 'NC' || st === 'SC' || st === 'GA' || st === 'VA' || st === 'UT') {
      tPrimaryRiskState = 0.6; // Acceptable-only remainder
    } else {
      tPrimaryRiskState = 0; // all other states, including ''
    }
  }

  /* ---- 4. TIV — AG p2 "TIV (Total Insured Value)", §3.1 ---- */
  let tTiv: number | null;
  const tiv = input.totalTiv;
  if (!known(tiv)) {
    tTiv = null;
  } else if (tiv > 150000000) {
    tTiv = 0; // "Over $150M" is strict
  } else if (tiv >= 50000000 && tiv <= 100000000) {
    tTiv = 1; // both target-band ends inclusive
  } else {
    tTiv = 0.6; // under $50M, or $100M..$150M inclusive
  }

  /* ---- 5. total premium — AG p2 "Total premium", §3.2 ---- */
  let tTotalPremium: number | null;
  const premium = input.quotedPremium;
  if (!known(premium)) {
    tTotalPremium = null;
  } else if (premium < 50000) {
    tTotalPremium = 0; // "Under $50K" is strict
  } else if (premium > 175000) {
    tTotalPremium = 0; // "over $175K" is strict
  } else if (premium >= 75000 && premium <= 100000) {
    tTotalPremium = 1;
  } else {
    tTotalPremium = 0.6;
  }

  /* ---- 6. building age — AG p2 "Building age" + PRD 6.6, §3.4 ---- */
  // Components 5 and 6 are jointly known or jointly missing (V-6).
  let tBuildingAge: number | null;
  const pre1990 = input.pctTivPre1990;
  const post2010 = input.pctTivPost2010;
  const ageKnown = known(pre1990) && known(post2010);
  if (!ageKnown) {
    tBuildingAge = null;
  } else if ((pre1990 as number) > 0.5) {
    tBuildingAge = 0; // strict: >50% of TIV pre-1990 is Not Acceptable
  } else if ((post2010 as number) > 0.5) {
    tBuildingAge = 1; // strict: >50% of TIV post-2010 is Target
  } else {
    tBuildingAge = 0.6; // both shares at or below 50%
  }

  /* ---- 7. construction type — AG p2 "Construction type", §3.5 ---- */
  let tConstructionType: number | null;
  const pctAcceptable = input.pctTivAcceptableConstruction;
  if (!known(pctAcceptable)) {
    tConstructionType = null;
  } else if (pctAcceptable >= 0.5) {
    tConstructionType = 1; // Acceptable → T-BLANK; exactly 50% is Acceptable
  } else {
    tConstructionType = 0;
  }

  /* ---- 8. loss value — AG p2 "Loss value", §3.3 ---- */
  let tLossValue: number | null;
  const loss = input.fiveYearLoss;
  if (!known(loss)) {
    tLossValue = null;
  } else if (loss > 100000) {
    tLossValue = 0; // "Over $100,000" is strict
  } else {
    tLossValue = 1; // Acceptable → T-BLANK; exactly $100,000 is Acceptable
  }

  /* ---- factors, in INTERPRETATIONS §2 weight-table order ---- */
  const factors: NaiveFactorOutcome[] = [
    outcome('submission_type', 0.1, tSubmissionType),
    outcome('line_of_business', 0.15, tLineOfBusiness),
    outcome('primary_risk_state', 0.15, tPrimaryRiskState),
    outcome('tiv', 0.15, tTiv),
    outcome('total_premium', 0.15, tTotalPremium),
    outcome('building_age', 0.1, tBuildingAge),
    outcome('construction_type', 0.1, tConstructionType),
    outcome('loss_value', 0.1, tLossValue),
  ];

  /* ---- appetite score (NAIVE_SPEC 5.2), summed in table order ---- */
  let weighted = 0;
  for (const f of factors) {
    if (f.tierValue !== null) weighted += f.weight * f.tierValue;
  }
  const appetiteScore = 100 * weighted;

  /* ---- completeness (NAIVE_SPEC 5.3, V-6): nine components ---- */
  let knownComponents = 0;
  if (tSubmissionType !== null) knownComponents += 1;
  if (tLineOfBusiness !== null) knownComponents += 1;
  if (tPrimaryRiskState !== null) knownComponents += 1;
  if (tTiv !== null) knownComponents += 1;
  if (tTotalPremium !== null) knownComponents += 1;
  if (tBuildingAge !== null) knownComponents += 2; // components 5 and 6
  if (tConstructionType !== null) knownComponents += 1;
  if (tLossValue !== null) knownComponents += 1;
  const completeness = 100 * (knownComponents / 9);

  /* ---- knockouts (NAIVE_SPEC 5.4, G-3) ---- */
  const knockoutFactorIds: NaiveFactorId[] = [];
  for (const f of factors) {
    if (f.knockout) knockoutFactorIds.push(f.factorId);
  }

  /* ---- verdict (V-1..V-5) ---- */
  const referReasons: string[] = [];
  let verdict: NaiveVerdict;
  if (knockoutFactorIds.length > 0) {
    verdict = 'DOES_NOT_FIT';
  } else if (completeness < 100) {
    referReasons.push('missing_data');
    verdict = 'REFER';
  } else if (input.hasOpenHighContradiction === true) {
    referReasons.push('open_high_contradiction');
    verdict = 'REFER';
  } else if (
    input.anyBuildingPre1990 === true &&
    known(pre1990) &&
    (pre1990 as number) <= 0.5
  ) {
    referReasons.push('pre_1990_building');
    verdict = 'REFER';
  } else {
    verdict = 'FIT';
  }

  /* ---- deciding factor (V-8) ---- */
  let decidingFactorId: NaiveFactorId | null = null;
  if (knockoutFactorIds.length > 0) {
    decidingFactorId = knockoutFactorIds[0] ?? null; // lowest index in table order
  } else {
    let best: NaiveFactorOutcome | null = null;
    for (const f of factors) {
      if (f.tierValue === null) continue;
      if (best === null) {
        best = f;
        continue;
      }
      const bestTier = best.tierValue as number;
      if (f.tierValue < bestTier) {
        best = f;
      } else if (f.tierValue === bestTier && f.weight > best.weight) {
        best = f;
      }
      // equal tier value and equal weight: the earlier factor wins (table order)
    }
    decidingFactorId = best === null ? null : best.factorId;
  }

  return {
    appetiteScore,
    completeness,
    verdict,
    knockoutFactorIds,
    referReasons,
    decidingFactorId,
    factors,
  };
};
