/**
 * Request: code picks the fields (Gemini only drafts the wording).
 * Triggers are REFER for missing data, an open HIGH contradiction, or an
 * account one flip from FIT. Body owned by Run 1 unit F13.
 */
import type {
  BuildingFacts,
  CanonicalSubmission,
  Contradiction,
  EngineResult,
  FactorId,
  Field,
  FlipMove,
  LocationFacts,
  Severity,
  Sourced,
} from '@retrofit/engine';
import { math } from '@retrofit/engine';
import { formatMoney, formatPercent } from '@retrofit/contracts';
import type {
  BrokerRecord,
  ContactRecord,
  RequestSelection,
  RequestTrigger,
  RequestedField,
} from '../types';

export interface RequestSelectionInput {
  readonly submissionId: string;
  readonly result: EngineResult;
  readonly insuredName?: string | null;
  readonly broker?: BrokerRecord | null;
  readonly contact?: ContactRecord | null;
}

/* -------------------------------------------------------------------------- */
/* Private tables                                                             */
/* -------------------------------------------------------------------------- */

/** How a factor is named in a "why" sentence. */
const FACTOR_PHRASE: Readonly<Record<string, string>> = {
  submission_type: 'the submission-type factor',
  line_of_business: 'the line-of-business factor',
  primary_risk_state: 'the primary-risk-state factor',
  tiv: 'the TIV factor',
  total_premium: 'the total-premium factor',
  building_age: 'the building-age factor',
  construction_type: 'the construction factor',
  loss_value: 'the loss-value factor',
  sprinkler_protection: "Retrofit's sprinkler rule and the premium estimate",
  protection_class: "Retrofit's protection-class rule and the premium estimate",
};

/** The eight appetite factors; anything else is one of Retrofit's own rules. */
const APPETITE = new Set([
  'submission_type',
  'line_of_business',
  'primary_risk_state',
  'tiv',
  'total_premium',
  'building_age',
  'construction_type',
  'loss_value',
]);

interface LeafInfo {
  /** Plain label, e.g. "year built". */
  readonly label: string;
  /** Vector component the leaf feeds. */
  readonly componentKey: string;
  readonly factor: FactorId;
}

/** Entity-level leaves (`buildings.<id>.<leaf>`, `locations.<id>.<leaf>`) that feed a factor. */
const BUILDING_LEAVES: Readonly<Record<string, LeafInfo>> = {
  tiv: { label: 'TIV', componentKey: 'totalTiv', factor: 'tiv' },
  yearBuilt: { label: 'year built', componentKey: 'pctTivPre1990', factor: 'building_age' },
  constructionType: {
    label: 'construction type',
    componentKey: 'pctTivAcceptableConstruction',
    factor: 'construction_type',
  },
};

const LOCATION_LEAVES: Readonly<Record<string, LeafInfo>> = {
  state: { label: 'state', componentKey: 'stateTier', factor: 'primary_risk_state' },
};

/** Other leaves a contradiction can land on. */
const OTHER_LEAVES: Readonly<Record<string, LeafInfo>> = {
  sprinklered: { label: 'sprinklered', componentKey: 'pctTivSprinklered', factor: 'sprinkler_protection' },
  protectionClass: {
    label: 'protection class',
    componentKey: 'tivWeightedProtectionClass',
    factor: 'protection_class',
  },
  quotedPremium: { label: 'quoted premium', componentKey: 'quotedPremium', factor: 'total_premium' },
  submissionType: {
    label: 'submission type (new business or renewal)',
    componentKey: 'isNewBusiness',
    factor: 'submission_type',
  },
  dateOfLoss: { label: 'date of loss', componentKey: 'fiveYearLoss', factor: 'loss_value' },
  paidIndemnity: { label: 'paid indemnity', componentKey: 'fiveYearLoss', factor: 'loss_value' },
  paidExpense: { label: 'paid expense', componentKey: 'fiveYearLoss', factor: 'loss_value' },
  reserves: { label: 'open reserves', componentKey: 'fiveYearLoss', factor: 'loss_value' },
  receivedDate: { label: 'received date', componentKey: 'fiveYearLoss', factor: 'loss_value' },
};

/**
 * A missing vector component -> what to ask for. Components computed from
 * buildings are asked per building; when the account has no buildings at all,
 * the request names every building with the `*` wildcard.
 */
type ComponentAsk =
  | { readonly kind: 'buildings'; readonly leaves: readonly string[] }
  | { readonly kind: 'locations'; readonly leaves: readonly string[] }
  | { readonly kind: 'path'; readonly path: string; readonly label: string };

const COMPONENT_ASK: Readonly<Record<string, ComponentAsk>> = {
  isNewBusiness: { kind: 'path', path: 'submissionType', label: 'submission type (new business or renewal)' },
  isPropertyLine: { kind: 'path', path: 'lineOfBusiness', label: 'line of business' },
  stateTier: { kind: 'locations', leaves: ['state'] },
  totalTiv: { kind: 'buildings', leaves: ['tiv'] },
  quotedPremium: { kind: 'path', path: 'pricing.quotedPremium', label: 'quoted premium' },
  pctTivPre1990: { kind: 'buildings', leaves: ['yearBuilt'] },
  pctTivPost2010: { kind: 'buildings', leaves: ['yearBuilt'] },
  pctTivAcceptableConstruction: { kind: 'buildings', leaves: ['constructionType'] },
  fiveYearLoss: { kind: 'path', path: 'rollup.fiveYearLoss', label: 'five-year loss runs' },
  pctTivSprinklered: { kind: 'buildings', leaves: ['sprinklered'] },
  tivWeightedProtectionClass: { kind: 'locations', leaves: ['protectionClass'] },
};

/** Flip components -> the canonical path the broker would change. */
const FLIP_PATH: Readonly<Record<string, { readonly path: string; readonly label: string }>> = {
  totalTiv: { path: 'rollup.totalTiv', label: 'total insured value (TIV)' },
  quotedPremium: { path: 'pricing.quotedPremium', label: 'quoted premium' },
  pctTivAcceptableConstruction: {
    path: 'rollup.pctTivAcceptableConstruction',
    label: 'share of TIV in acceptable construction',
  },
  pctTivSprinklered: { path: 'rollup.pctTivSprinklered', label: 'share of TIV sprinklered' },
};

const MONEY_KEYS = new Set(['totalTiv', 'quotedPremium', 'fiveYearLoss', 'contentsLimit']);
const SHARE_KEYS = new Set([
  'pctTivPre1990',
  'pctTivPost2010',
  'pctTivAcceptableConstruction',
  'pctTivSprinklered',
]);

/* -------------------------------------------------------------------------- */
/* Private helpers                                                            */
/* -------------------------------------------------------------------------- */

function isPresent(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') return v.trim().length > 0;
  return true;
}

function hasValue(slot: Sourced<unknown> | undefined): boolean {
  return Array.isArray(slot) && slot.some((f: Field<unknown>) => isPresent(f?.value));
}

function buildingName(b: BuildingFacts): string {
  const label = typeof b.label === 'string' && b.label.trim().length > 0 ? b.label.trim() : null;
  if (label === null) return `building ${b.externalId}`;
  return /^building\b/i.test(label) ? label : `Building ${label}`;
}

function locationName(l: LocationFacts): string {
  const city = l.city?.find((f) => isPresent(f.value))?.value;
  return typeof city === 'string' ? `the ${city} location (${l.externalId})` : `location ${l.externalId}`;
}

function whyFor(factor: FactorId | null): string {
  if (factor === null) return 'it is required to complete the submission';
  const phrase = FACTOR_PHRASE[factor] ?? `the ${String(factor).replace(/_/g, ' ')} rule`;
  return `it decides ${phrase}`;
}

function severityFor(factor: FactorId | null): Severity {
  return factor !== null && APPETITE.has(factor) ? 'HIGH' : 'MEDIUM';
}

function ruleIdFor(result: EngineResult, factor: FactorId | null): string | null {
  if (factor === null) return null;
  const outcome = result.evaluate.factors.find((f) => f.factor === factor);
  if (outcome?.ruleId != null) return outcome.ruleId;
  const fired = result.evaluate.firedRules.find((r) => r.factor === factor);
  return fired?.ruleId ?? null;
}

function showValue(key: string, v: number | null): string | null {
  if (v === null || !math.isFiniteNumber(v)) return null;
  if (MONEY_KEYS.has(key)) return formatMoney(v);
  if (SHARE_KEYS.has(key)) return formatPercent(v, { decimals: 1 });
  return String(v);
}

function showAny(v: unknown): string {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(math.roundTo(v, 4));
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return JSON.stringify(v) ?? String(v);
}

function segmentsOf(path: string): string[] {
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((s) => s.length > 0);
}

/** Label, component and factor for any canonical path a contradiction can hold. */
function describePath(
  canonical: CanonicalSubmission,
  path: string,
): { readonly label: string; readonly componentKey: string | null; readonly factor: FactorId | null } {
  const seg = segmentsOf(path);
  const head = seg[0] ?? '';
  const leaf = seg[seg.length - 1] ?? path;

  if (seg.length === 3 && head === 'buildings') {
    const b = canonical.buildings.find((x) => x.externalId === seg[1]);
    const name = b !== undefined ? buildingName(b) : `building ${seg[1] ?? ''}`;
    const info = BUILDING_LEAVES[leaf] ?? OTHER_LEAVES[leaf];
    return {
      label: `${info?.label ?? leaf} for ${name}`,
      componentKey: info?.componentKey ?? null,
      factor: info?.factor ?? null,
    };
  }
  if (seg.length === 3 && head === 'locations') {
    const l = canonical.locations.find((x) => x.externalId === seg[1]);
    const name = l !== undefined ? locationName(l) : `location ${seg[1] ?? ''}`;
    const info = LOCATION_LEAVES[leaf] ?? OTHER_LEAVES[leaf];
    return {
      label: `${info?.label ?? leaf} for ${name}`,
      componentKey: info?.componentKey ?? null,
      factor: info?.factor ?? null,
    };
  }
  if (seg.length === 3 && head === 'history') {
    const info = OTHER_LEAVES[leaf];
    return {
      label: `${info?.label ?? leaf} for claim ${seg[1] ?? ''}`,
      componentKey: info?.componentKey ?? null,
      factor: info?.factor ?? null,
    };
  }
  const info = OTHER_LEAVES[leaf];
  if (info !== undefined) return { label: info.label, componentKey: info.componentKey, factor: info.factor };
  const plain = leaf.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return { label: plain, componentKey: null, factor: null };
}

/* -------------------------------------------------------------------------- */
/* Field pickers, one per trigger                                             */
/* -------------------------------------------------------------------------- */

/** Building- and location-level values that are missing and feed an appetite factor. */
function entityGaps(result: EngineResult, leavesWanted: ReadonlySet<string> | null): RequestedField[] {
  const out: RequestedField[] = [];
  const canonical = result.canonical;
  for (const b of canonical.buildings) {
    for (const [leaf, info] of Object.entries(BUILDING_LEAVES)) {
      if (leavesWanted !== null && !leavesWanted.has(leaf)) continue;
      const slot = (b as unknown as Record<string, Sourced<unknown> | undefined>)[leaf];
      if (hasValue(slot)) continue;
      out.push({
        canonicalPath: `buildings.${b.externalId}.${leaf}`,
        componentKey: info.componentKey,
        label: `${info.label} for ${buildingName(b)}`,
        why: whyFor(info.factor),
        factor: info.factor,
        ruleId: ruleIdFor(result, info.factor),
        currentValue: null,
        severity: severityFor(info.factor),
      });
    }
  }
  for (const l of canonical.locations) {
    for (const [leaf, info] of Object.entries(LOCATION_LEAVES)) {
      if (leavesWanted !== null && !leavesWanted.has(leaf)) continue;
      const slot = (l as unknown as Record<string, Sourced<unknown> | undefined>)[leaf];
      if (hasValue(slot)) continue;
      out.push({
        canonicalPath: `locations.${l.externalId}.${leaf}`,
        componentKey: info.componentKey,
        label: `${info.label} for ${locationName(l)}`,
        why: whyFor(info.factor),
        factor: info.factor,
        ruleId: ruleIdFor(result, info.factor),
        currentValue: null,
        severity: severityFor(info.factor),
      });
    }
  }
  return out;
}

const WILDCARD_LABEL: Readonly<Record<string, string>> = {
  tiv: 'TIV for each building',
  yearBuilt: 'year built for each building',
  constructionType: 'construction type for each building',
  sprinklered: 'sprinklered status for each building',
  state: 'state for each location',
  protectionClass: 'protection class for each location',
};

/** Missing required components, resolved to the most specific writable path. */
function missingDataFields(result: EngineResult): RequestedField[] {
  const out: RequestedField[] = [];
  const canonical = result.canonical;

  // Building/location values missing even where the component is known.
  if (result.lineOfBusiness === 'commercial_property') {
    out.push(...entityGaps(result, null));
  }

  for (const missing of result.evaluate.missingFields) {
    if (!missing.required) continue;
    const factor = missing.factor;
    const ask = COMPONENT_ASK[missing.componentKey];
    const base = {
      componentKey: missing.componentKey,
      why: whyFor(factor),
      factor,
      ruleId: ruleIdFor(result, factor),
      currentValue: null,
      severity: severityFor(factor),
    };

    if (ask === undefined) {
      // Tenant or unknown component: ask for its source path directly.
      out.push({ ...base, canonicalPath: tenantPath(canonical, missing.canonicalPath), label: labelFromKey(missing.componentKey) });
      continue;
    }
    if (ask.kind === 'path') {
      out.push({ ...base, canonicalPath: ask.path, label: ask.label });
      continue;
    }
    const entities = ask.kind === 'buildings' ? canonical.buildings : canonical.locations;
    if (entities.length === 0) {
      for (const leaf of ask.leaves) {
        out.push({
          ...base,
          canonicalPath: `${ask.kind}.*.${leaf}`,
          label: WILDCARD_LABEL[leaf] ?? `${leaf} for each of the ${ask.kind}`,
        });
      }
      continue;
    }
    // Entities exist: every gap was already collected by `entityGaps`, and a
    // component can be missing only because of those gaps (or unknown TIV,
    // which is itself a gap). Nothing further to add here.
  }
  return out;
}

/** `buildings[0].yearBuilt` -> `buildings.<first id>.yearBuilt`. */
function tenantPath(canonical: CanonicalSubmission, source: string): string {
  const m = /^buildings\[(\d+)\]\.(.+)$/.exec(source);
  if (m === null) return source;
  const b = canonical.buildings[Number(m[1])];
  return b === undefined ? `buildings.*.${m[2] ?? ''}` : `buildings.${b.externalId}.${m[2] ?? ''}`;
}

function labelFromKey(key: string): string {
  return key
    .replace(/^hazard/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
}

function contradictionFields(result: EngineResult): RequestedField[] {
  const open: Contradiction[] = result.contradictions.filter(
    (c) => c.status === 'open' && c.severity === 'HIGH',
  );
  return open.map((c) => {
    const d = describePath(result.canonical, c.canonicalPath);
    const values = [...new Set(c.values.map((f) => `${showAny(f.value)} (${f.provenance.source})`))];
    const factor = d.factor;
    const decides = factor !== null ? `; ${whyFor(factor)}` : '';
    return {
      canonicalPath: c.canonicalPath,
      componentKey: d.componentKey,
      label: d.label,
      why: `the sources disagree (${values.join(' vs ')})${decides}`,
      factor,
      ruleId: c.affectedRules[0] ?? ruleIdFor(result, factor),
      currentValue: values.join(' vs '),
      severity: 'HIGH',
    };
  });
}

function flipFields(result: EngineResult): RequestedField[] {
  const flip = result.flip.flip;
  if (flip === null || flip.verdictAfter !== 'FIT') return [];
  return flip.moves.map((move: FlipMove) => {
    const target = FLIP_PATH[move.componentKey];
    const factorOutcome = result.evaluate.factors.find((f) => f.componentKeys.includes(move.componentKey));
    const factor: FactorId | null = factorOutcome?.factor ?? null;
    const to = showValue(move.componentKey, move.to) ?? String(move.to);
    const hint = typeof move.fixHint === 'string' && move.fixHint.length > 0 ? ` ${move.fixHint}` : '';
    return {
      canonicalPath: target?.path ?? move.componentKey,
      componentKey: move.componentKey,
      label: target?.label ?? move.label,
      why: `moving it to ${to} is the smallest change that makes the account FIT (score ${formatScoreLocal(flip.scoreBefore)} to ${formatScoreLocal(flip.scoreAfter)}).${hint}`,
      factor,
      ruleId: ruleIdFor(result, factor),
      currentValue: showValue(move.componentKey, move.from),
      severity: 'MEDIUM',
    };
  });
}

function formatScoreLocal(v: number): string {
  return String(math.roundTo(v, 1));
}

/* -------------------------------------------------------------------------- */
/* Public                                                                     */
/* -------------------------------------------------------------------------- */

export function selectRequest(input: RequestSelectionInput): RequestSelection {
  const { result } = input;
  const verdict = result.verdict.verdict;

  const triggers: RequestTrigger[] = [];
  const fields: RequestedField[] = [];
  const seen = new Set<string>();
  const add = (list: readonly RequestedField[]): number => {
    let added = 0;
    for (const f of list) {
      if (seen.has(f.canonicalPath)) continue;
      seen.add(f.canonicalPath);
      fields.push(f);
      added += 1;
    }
    return added;
  };

  // 1. REFER for missing data.
  if (verdict === 'REFER') {
    if (add(missingDataFields(result)) > 0) triggers.push('missing_data');
  }
  // 2. An open HIGH contradiction.
  if (add(contradictionFields(result)) > 0) triggers.push('high_contradiction');
  // 3. One flip from FIT.
  if (verdict !== 'FIT') {
    if (add(flipFields(result)) > 0) triggers.push('one_flip_from_fit');
  }

  const qualifies = fields.length > 0;
  const rationale = qualifies ? rationaleFor(triggers, fields) : noRequestReason(result);

  return {
    submissionId: input.submissionId,
    triggers,
    fields,
    insuredName: input.insuredName ?? firstString(result.canonical.insured.name) ?? null,
    broker: input.broker ?? null,
    contact: input.contact ?? null,
    rationale,
    qualifies,
  };
}

function firstString(slot: Sourced<string> | undefined): string | null {
  const f = slot?.find((x) => typeof x.value === 'string' && x.value.trim().length > 0);
  return f?.value ?? null;
}

const TRIGGER_TEXT: Readonly<Record<RequestTrigger, string>> = {
  missing_data: 'the account is REFER with missing data',
  high_contradiction: 'an open HIGH contradiction puts a rule at risk',
  one_flip_from_fit: 'the account is one flip from FIT',
};

function rationaleFor(triggers: readonly RequestTrigger[], fields: readonly RequestedField[]): string {
  const why = triggers.map((t) => TRIGGER_TEXT[t]).join('; ');
  const n = fields.length;
  return `Requesting ${n} field${n === 1 ? '' : 's'} because ${why}.`;
}

function noRequestReason(result: EngineResult): string {
  const v = result.verdict.verdict;
  if (v === 'FIT') return 'No request: the account is FIT and has no open HIGH contradiction.';
  if (v === 'DOES_NOT_FIT') {
    return `No request: the account does not fit, has no open HIGH contradiction, and no flip reaches FIT${
      result.flip.reason !== null ? ` (${result.flip.reason})` : ''
    }.`;
  }
  return 'No request: the account is REFER but nothing the broker could supply is missing or disputed.';
}
