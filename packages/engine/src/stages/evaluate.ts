/** Stage 7 — evaluate. Body owned by Run 1 unit E06. */
import type {
  AppetiteFactorId,
  AppliedInterpretation,
  CanonicalSubmission,
  EvaluateResult,
  FactorOutcome,
  FeatureVector,
  Field,
  FiredRule,
  MissingField,
  Provenance,
  Rule,
  Rulebook,
  Sourced,
  Tier,
  VectorComponentSpec,
  VectorSpec,
} from '../types.js';
import {
  APPETITE_FACTORS,
  BLANK_TARGET_FACTORS,
  FACTOR_WEIGHTS,
  TIER_ACCEPTABLE,
  TIER_NOT_ACCEPTABLE,
  TIER_TARGET,
  TIER_VALUE,
} from '../constants.js';
import { evaluateConditions, vectorResolver } from '../util/conditions.js';
import type { ConditionResolver } from '../util/conditions.js';
import { bestValue, combinedConfidence, readPath } from '../util/fields.js';
import { isFiniteNumber } from '../util/math.js';

/* -------------------------------------------------------------------------- */
/* Private helpers (HELPERS.md: private to this file, never exported)          */
/* -------------------------------------------------------------------------- */

/**
 * `vectors/commercial.json` carries `factor`, `appetiteFactor` and `immovable`
 * on every component; the frozen `VectorComponentSpec` type does not name them.
 * E06 reads them through this widening rather than editing a frozen type
 * (see docs/contracts/requests/E06.md).
 */
interface ComponentExtras {
  readonly factor?: string;
  readonly appetiteFactor?: boolean;
}

type ComponentSpec = VectorComponentSpec & ComponentExtras;

/** Fallback component-key → appetite factor map, used only when the spec omits `factor`. */
const DEFAULT_FACTOR_BY_KEY: Readonly<Record<string, AppetiteFactorId>> = {
  isNewBusiness: 'submission_type',
  submissionType: 'submission_type',
  isPropertyLine: 'line_of_business',
  lineOfBusiness: 'line_of_business',
  stateTier: 'primary_risk_state',
  totalTiv: 'tiv',
  quotedPremium: 'total_premium',
  pctTivPre1990: 'building_age',
  pctTivPost2010: 'building_age',
  pctTivAcceptableConstruction: 'construction_type',
  fiveYearLoss: 'loss_value',
};

/** INTERPRETATIONS 3.4: Not Acceptable is checked first, then Target, then Acceptable. */
const TIER_PRECEDENCE: Readonly<Record<Tier, number>> = {
  not_acceptable: 0,
  target: 1,
  acceptable: 2,
  refer: 3,
};

/**
 * Which canonical slots a `rollup.*` path was computed from. Used only by the
 * V-7 confidence product, never by scoring.
 */
const ROLLUP_CONTRIBUTORS: Readonly<
  Record<string, readonly { readonly collection: 'buildings' | 'locations' | 'history'; readonly field: string }[]>
> = {
  totalTiv: [{ collection: 'buildings', field: 'tiv' }],
  pctTivPre1990: [
    { collection: 'buildings', field: 'yearBuilt' },
    { collection: 'buildings', field: 'tiv' },
  ],
  pctTivPost2010: [
    { collection: 'buildings', field: 'yearBuilt' },
    { collection: 'buildings', field: 'tiv' },
  ],
  pctTivAcceptableConstruction: [
    { collection: 'buildings', field: 'constructionType' },
    { collection: 'buildings', field: 'tiv' },
  ],
  pctTivSprinklered: [
    { collection: 'buildings', field: 'sprinklered' },
    { collection: 'buildings', field: 'tiv' },
  ],
  tivWeightedProtectionClass: [
    { collection: 'buildings', field: 'protectionClass' },
    { collection: 'buildings', field: 'tiv' },
  ],
  // Fed by the OpenFEMA hazard layer, not by the broker: nothing to ask for.
  worstFloodZoneTier: [{ collection: 'locations', field: 'floodZone' }],
  primaryState: [
    { collection: 'locations', field: 'state' },
    { collection: 'buildings', field: 'tiv' },
  ],
  stateShares: [{ collection: 'locations', field: 'state' }],
  fiveYearLoss: [
    { collection: 'history', field: 'paidIndemnity' },
    { collection: 'history', field: 'paidExpense' },
    { collection: 'history', field: 'reserves' },
  ],
  claimCount: [{ collection: 'history', field: 'paidIndemnity' }],
};

/**
 * T-BLANK. For the four factors whose Target column is blank, meeting the
 * Acceptable condition scores 1, not 0.6. `vectorize` already applies this, so
 * the adjustment here is idempotent and exists so a hand-built vector cannot
 * silently score 0.6 on `construction_type` or `loss_value`.
 */
function applyBlankTarget(factor: string, value: number): number {
  if (!(BLANK_TARGET_FACTORS as readonly string[]).includes(factor)) return value;
  return value === TIER_ACCEPTABLE ? TIER_TARGET : value;
}

function tierValueOf(rule: Rule): number {
  const raw = TIER_VALUE[rule.tier];
  const base = isFiniteNumber(raw) ? raw : TIER_NOT_ACCEPTABLE;
  if (rule.tier === 'refer') return base;
  return applyBlankTarget(rule.factor, base);
}

/** The tier label implied by a tier value when no rule fired to supply one. */
function derivedTier(factor: string, value: number): Tier {
  if (value === TIER_NOT_ACCEPTABLE) return 'not_acceptable';
  if (value === TIER_ACCEPTABLE) return 'acceptable';
  return (BLANK_TARGET_FACTORS as readonly string[]).includes(factor) ? 'acceptable' : 'target';
}

/** A resolver over the vector first, then the canonical submission (and its rollup). */
function makeResolver(
  vector: FeatureVector,
  spec: VectorSpec,
  submission: CanonicalSubmission,
): ConditionResolver {
  const fromVector = vectorResolver(vector, spec);
  const keyBySource = new Map<string, string>();
  for (const component of spec.components) {
    if (component !== undefined) keyBySource.set(component.source, component.key);
  }

  return (field: string): unknown => {
    const direct = fromVector(field);
    if (direct !== undefined) return direct;

    const aliased = keyBySource.get(field);
    if (aliased !== undefined) {
      const viaAlias = fromVector(aliased);
      if (viaAlias !== undefined) return viaAlias;
    }

    return readPath(submission, field);
  };
}

/** The canonical path a condition field points at: a component's `source`, or the field itself. */
function canonicalPathFor(field: string, spec: VectorSpec): string {
  for (const component of spec.components) {
    if (component !== undefined && component.key === field) return component.source;
  }
  return field;
}

function isFieldLike(value: unknown): value is Field<unknown> {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (!('value' in record) || !('provenance' in record)) return false;
  const provenance = record['provenance'];
  return (
    provenance !== null &&
    typeof provenance === 'object' &&
    typeof (provenance as Provenance).source === 'string'
  );
}

function isSourcedLike(value: unknown): value is Sourced<unknown> {
  return Array.isArray(value) && value.length > 0 && value.every(isFieldLike);
}

/** Walk a dotted path WITHOUT unwrapping the slot, so the provenance survives. */
function readSlot(root: unknown, path: string): Sourced<unknown> | null {
  const segments = path.split('.').filter((s) => s !== '');
  let current: unknown = root;
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') return null;
    const record = current as Record<string, unknown>;
    if (segment in record) {
      current = record[segment];
      continue;
    }
    const present = record['present'];
    if (present !== null && typeof present === 'object' && segment in (present as object)) {
      current = (present as Record<string, unknown>)[segment];
      continue;
    }
    return null;
  }
  return isSourcedLike(current) ? current : null;
}

/**
 * V-7 confidence inputs for one deciding rule.
 *
 * A `rollup.*` path has no provenance of its own, so the slots it was computed
 * from stand in for it, collapsed to **one representative field per distinct
 * source kind** — otherwise a 129-building account would multiply 0.7 by itself
 * 129 times and report a confidence of zero (docs/decisions/E06.md, D-3).
 */
function decidingFields(
  rule: Rule,
  spec: VectorSpec,
  submission: CanonicalSubmission,
): readonly Field<unknown>[] {
  const out: Field<unknown>[] = [];
  const seen = new Set<string>();

  const push = (key: string, field: Field<unknown> | null): void => {
    if (field === null || seen.has(key)) return;
    seen.add(key);
    out.push(field);
  };

  for (const condition of rule.when) {
    const path = canonicalPathFor(condition.field, spec);

    if (path.startsWith('rollup.')) {
      const leaf = path.slice('rollup.'.length);
      const contributors = ROLLUP_CONTRIBUTORS[leaf] ?? [];
      for (const contributor of contributors) {
        const records = submission[contributor.collection];
        if (!Array.isArray(records)) continue;
        for (const record of records) {
          const slot = readSlot(record, contributor.field);
          const best = bestValue(slot ?? undefined);
          if (best === null) continue;
          // One field per source kind: the product is over kinds, not records.
          push(`rollup:${best.provenance.source}`, best);
        }
      }
      continue;
    }

    push(path, bestValue(readSlot(submission, path) ?? undefined));
  }

  return out;
}

interface RuleHit {
  readonly rule: Rule;
  readonly order: number;
  readonly extension: boolean;
}

function fireRules(
  rules: readonly Rule[],
  vector: FeatureVector,
  resolve: ConditionResolver,
  extension: boolean,
  offset: number,
): RuleHit[] {
  const hits: RuleHit[] = [];
  for (let i = 0; i < rules.length; i += 1) {
    const rule = rules[i];
    if (rule === undefined) continue;
    if (rule.lineOfBusiness !== vector.lineOfBusiness) continue;
    if (!evaluateConditions(rule.when, resolve)) continue;
    hits.push({ rule, order: offset + i, extension: extension || rule.extension === true });
  }
  return hits;
}

/* -------------------------------------------------------------------------- */
/* Stage                                                                      */
/* -------------------------------------------------------------------------- */

export function evaluate(
  vector: FeatureVector,
  spec: VectorSpec,
  rulebook: Rulebook,
  submission: CanonicalSubmission,
  extensions?: Rulebook,
): EvaluateResult {
  const components = spec.components as readonly ComponentSpec[];
  const resolve = makeResolver(vector, spec, submission);

  const factorOfComponent = (component: ComponentSpec): string | null => {
    if (typeof component.factor === 'string' && component.factor !== '') return component.factor;
    return DEFAULT_FACTOR_BY_KEY[component.key] ?? null;
  };

  /* ---- rules ------------------------------------------------------------ */

  const hits = [
    ...fireRules(rulebook.rules, vector, resolve, false, 0),
    ...fireRules(extensions?.rules ?? [], vector, resolve, true, rulebook.rules.length),
  ];

  /* ---- factor outcomes -------------------------------------------------- */

  const factors: FactorOutcome[] = [];
  const knockoutFactors: AppetiteFactorId[] = [];
  const referFactors: AppetiteFactorId[] = [];
  const decidingRuleByFactor = new Map<AppetiteFactorId, Rule>();
  let weightedTierSum = 0;

  for (const factorId of APPETITE_FACTORS) {
    const owned = components.filter((component) => factorOfComponent(component) === factorId);
    const componentKeys = owned.map((component) => component.key);

    // T-SPAN: a factor's components are jointly known or jointly missing, and
    // every one of them carries the same tier value.
    const known = owned.length > 0 && owned.every((component) => vector.m[component.index] === 1);

    let tierValue: number | null = null;
    if (known) {
      for (const component of owned) {
        const raw = vector.t[component.index];
        if (isFiniteNumber(raw)) {
          tierValue = applyBlankTarget(factorId, raw);
          break;
        }
      }
    }

    const rawWeight = rulebook.weights[factorId];
    const weight = isFiniteNumber(rawWeight) ? rawWeight : (FACTOR_WEIGHTS[factorId] ?? 0);

    const factorHits = hits.filter((hit) => !hit.extension && hit.rule.factor === factorId);
    const scoringHits = factorHits.filter((hit) => hit.rule.tier !== 'refer');
    const referFired = factorHits.some((hit) => hit.rule.tier === 'refer');

    // Prefer the fired rule whose tier value matches the vector's tier; then
    // Not Acceptable before Target before Acceptable; then rulebook order.
    const ranked = [...scoringHits].sort((a, b) => {
      const aMatch = tierValue !== null && tierValueOf(a.rule) === tierValue ? 0 : 1;
      const bMatch = tierValue !== null && tierValueOf(b.rule) === tierValue ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
      const aTier = TIER_PRECEDENCE[a.rule.tier] ?? 9;
      const bTier = TIER_PRECEDENCE[b.rule.tier] ?? 9;
      if (aTier !== bTier) return aTier - bTier;
      return a.order - b.order;
    });
    const deciding = ranked[0]?.rule ?? null;

    // A rule only decides when the component it reads is known (G-2/G-3).
    const decidingRule = known ? deciding : null;
    if (decidingRule !== null) decidingRuleByFactor.set(factorId, decidingRule);

    const tier: Tier | null =
      tierValue === null ? null : (decidingRule?.tier ?? derivedTier(factorId, tierValue));

    const knockout = known && tierValue === TIER_NOT_ACCEPTABLE;
    const refer = referFired && known && !knockout;
    const points = known && tierValue !== null ? 100 * weight * tierValue : 0;

    if (known && tierValue !== null) weightedTierSum += weight * tierValue;
    if (knockout) knockoutFactors.push(factorId);
    if (refer) referFactors.push(factorId);

    factors.push({
      factor: factorId,
      componentKeys,
      tier: tier === 'refer' ? 'acceptable' : tier,
      tierValue,
      weight,
      points,
      known,
      knockout,
      refer,
      ruleId: decidingRule?.id ?? null,
      citation: decidingRule?.citation ?? null,
    });
  }

  const appetiteScore = 100 * weightedTierSum;

  /* ---- fired rules ------------------------------------------------------ */

  const firedRules: FiredRule[] = hits.map((hit) => {
    const rule = hit.rule;
    const value = tierValueOf(rule);
    const rawWeight = isFiniteNumber(rule.weight)
      ? rule.weight
      : (rulebook.weights[rule.factor] ?? FACTOR_WEIGHTS[rule.factor as AppetiteFactorId] ?? 0);
    const weight = hit.extension ? 0 : rawWeight;
    const fired: FiredRule = {
      ruleId: rule.id,
      factor: rule.factor,
      tier: rule.tier,
      tierValue: value,
      weight,
      // An extension rule never touches the appetite score (PRD 6.6).
      points: hit.extension ? 0 : 100 * weight * value,
      citation: rule.citation,
      conditions: rule.when,
      extension: hit.extension,
      ...(rule.interpretation === undefined ? {} : { interpretation: rule.interpretation }),
    };
    return fired;
  });

  /* ---- missing fields and completeness (V-6) ---------------------------- */

  const missingFields: MissingField[] = [];
  let requiredCount = 0;
  let requiredKnown = 0;

  for (const component of components) {
    const present = vector.m[component.index] === 1;
    if (component.required) {
      requiredCount += 1;
      if (present) requiredKnown += 1;
    }
    if (present) continue;
    const factorId = factorOfComponent(component);
    missingFields.push({
      componentKey: component.key,
      canonicalPath: component.source,
      factor: factorId,
      required: component.required === true,
      reason: `${component.label} is not present on the submission.`,
    });
  }

  const completeness = requiredCount === 0 ? 100 : (100 * requiredKnown) / requiredCount;

  /* ---- confidence (V-7) ------------------------------------------------- */

  const decidingFactor = decidingFactorId(factors);
  const decider = decidingFactor === null ? null : (decidingRuleByFactor.get(decidingFactor) ?? null);
  const confidence =
    decider === null ? 1 : combinedConfidence(decidingFields(decider, spec, submission));

  /* ---- interpretations -------------------------------------------------- */

  const touched = new Set<string>();
  for (const hit of hits) {
    for (const condition of hit.rule.when) {
      touched.add(condition.field);
      touched.add(canonicalPathFor(condition.field, spec));
    }
  }

  /**
   * INTERPRETATIONS I-3: surfaced only when removing the Fire Resistive /
   * Modified Fire Resistive TIV from the numerator would change the 3.5
   * outcome. Re-fires the rules that read the construction share against the
   * share without the assumed classes and compares which of them fire.
   */
  const constructionTierDependsOnAssumed = (): boolean => {
    const byClass = submission.rollup?.pctTivByConstruction ?? [];
    const knownTiv = byClass.reduce((s, c) => s + c.tiv, 0);
    const assumedTiv = byClass.filter((c) => c.assumedAcceptable).reduce((s, c) => s + c.tiv, 0);
    if (!(knownTiv > 0) || !(assumedTiv > 0)) return false;

    const FIELD = 'pctTivAcceptableConstruction';
    const PATH = `rollup.${FIELD}`;
    const readsShare = (rule: Rule): boolean =>
      rule.when.some((c) => c.field === FIELD || c.field === PATH || canonicalPathFor(c.field, spec) === PATH);
    const actual = resolve(FIELD) ?? resolve(PATH);
    if (!isFiniteNumber(actual)) return false;
    const without = Math.max(0, actual - assumedTiv / knownTiv);
    const counterfactual: ConditionResolver = (field) =>
      field === FIELD || field === PATH || canonicalPathFor(field, spec) === PATH ? without : resolve(field);

    const allRules = [...rulebook.rules, ...(extensions?.rules ?? [])].filter(readsShare);
    const firedNow = new Set(hits.filter((h) => readsShare(h.rule)).map((h) => h.rule.id));
    const firedWithout = new Set(
      fireRules(allRules, vector, counterfactual, false, 0).map((h) => h.rule.id),
    );
    if (firedNow.size !== firedWithout.size) return true;
    for (const id of firedNow) if (!firedWithout.has(id)) return true;
    return false;
  };

  const interpretationsApplied: AppliedInterpretation[] = [];
  const seenInterpretations = new Set<string>();
  for (const source of [rulebook.interpretations ?? [], extensions?.interpretations ?? []]) {
    for (const interpretation of source) {
      if (seenInterpretations.has(interpretation.id)) continue;
      const relevant =
        interpretation.affects.length === 0 ||
        interpretation.affects.some((path) => touched.has(path));
      if (!relevant) continue;
      if (interpretation.id === 'I-3' && !constructionTierDependsOnAssumed()) continue;
      seenInterpretations.add(interpretation.id);
      interpretationsApplied.push(interpretation);
    }
  }

  return {
    appetiteScore,
    factors,
    firedRules,
    knockout: knockoutFactors.length > 0,
    knockoutFactors,
    referFactors,
    missingFields,
    completeness,
    confidence,
    interpretationsApplied,
  };
}

/* -------------------------------------------------------------------------- */
/* V-8 — the deciding factor                                                  */
/* -------------------------------------------------------------------------- */

/**
 * INTERPRETATIONS V-8, stated literally:
 * (a) any knockout → the knockout factor earliest in the §2 factor order;
 * (b) otherwise, among KNOWN factors, the lowest `tierValue`, ties by highest
 *     weight, further ties by the §2 factor order;
 * (c) `null` when every appetite factor is missing.
 *
 * Refer flags never change it. Kept private to this module and re-derived in
 * `verdict.ts`, because HELPERS.md forbids a new shared helper.
 */
function decidingFactorId(factors: readonly FactorOutcome[]): AppetiteFactorId | null {
  const order = (id: AppetiteFactorId): number => {
    const i = APPETITE_FACTORS.indexOf(id);
    return i < 0 ? APPETITE_FACTORS.length : i;
  };

  const knockouts = factors.filter((f) => f.knockout);
  if (knockouts.length > 0) {
    let best = knockouts[0] as FactorOutcome;
    for (const candidate of knockouts) {
      if (order(candidate.factor) < order(best.factor)) best = candidate;
    }
    return best.factor;
  }

  const known = factors.filter((f) => f.known && f.tierValue !== null);
  if (known.length === 0) return null;

  let best = known[0] as FactorOutcome;
  for (const candidate of known.slice(1)) {
    const a = candidate.tierValue as number;
    const b = best.tierValue as number;
    if (a < b) {
      best = candidate;
      continue;
    }
    if (a > b) continue;
    if (candidate.weight > best.weight) {
      best = candidate;
      continue;
    }
    if (candidate.weight < best.weight) continue;
    if (order(candidate.factor) < order(best.factor)) best = candidate;
  }
  return best.factor;
}
