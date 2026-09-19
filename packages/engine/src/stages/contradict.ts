/** Stage 5 — contradict. Body owned by Run 1 unit E04. */
import { MONEY_TOLERANCE } from '../constants.js';
import type {
  CanonicalSubmission,
  Contradiction,
  Field,
  Rule,
  Rulebook,
  Severity,
} from '../types.js';
import { approxEqual } from '../util/math.js';

/* -------------------------------------------------------------------------- */
/* Private types                                                              */
/* -------------------------------------------------------------------------- */

type Bag = Record<string, unknown>;

interface Slot {
  readonly path: string;
  readonly values: readonly Field<unknown>[];
}

/* -------------------------------------------------------------------------- */
/* Slot enumeration — mirrors the path grammar merge writes                   */
/* -------------------------------------------------------------------------- */

const TOP_LEVEL_KEYS: readonly string[] = [
  'submissionType',
  'receivedDate',
  'effectiveDate',
  'expirationDate',
  'status',
];

const GROUPS: readonly string[] = ['insured', 'exposure', 'pricing'];
const LISTS: readonly string[] = ['locations', 'buildings', 'history'];
const HAZARD_DIRECT_KEYS: readonly string[] = [
  'smokeDetectorCount',
  'sprinklerHeadCount',
  'ceilingObserved',
];

function isBag(v: unknown): v is Bag {
  return typeof v === 'object' && v !== null;
}

/** A `Sourced<T>` is an array of `{ value, provenance }`. */
function asSourced(v: unknown): readonly Field<unknown>[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  for (const entry of v) {
    if (!isBag(entry) || !('value' in entry) || !('provenance' in entry)) return null;
  }
  return v as readonly Field<unknown>[];
}

function collect(out: Slot[], path: string, v: unknown): void {
  const sourced = asSourced(v);
  if (sourced !== null) out.push({ path, values: sourced });
}

function collectBag(out: Slot[], prefix: string, bag: unknown): void {
  if (!isBag(bag)) return;
  for (const key of Object.keys(bag).sort()) {
    collect(out, `${prefix}.${key}`, bag[key]);
  }
}

/** Every `Sourced` slot in the submission, addressed exactly as merge writes it. */
function slotsOf(submission: CanonicalSubmission): Slot[] {
  const src = submission as unknown as Bag;
  const out: Slot[] = [];

  for (const key of TOP_LEVEL_KEYS) collect(out, key, src[key]);
  for (const group of GROUPS) collectBag(out, group, src[group]);

  const hazards = src.hazards;
  if (isBag(hazards)) {
    for (const key of HAZARD_DIRECT_KEYS) collect(out, `hazards.${key}`, hazards[key]);
    collectBag(out, 'hazards.present', hazards.present);
  }

  for (const list of LISTS) {
    const entries = src[list];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!isBag(entry)) continue;
      collectBag(out, `${list}.${String(entry.externalId)}`, entry);
    }
  }

  const coverage = src.coverage;
  if (isBag(coverage) && Array.isArray(coverage.lines)) {
    for (const line of coverage.lines) {
      if (!isBag(line)) continue;
      for (const key of ['limit', 'deductible']) {
        collect(out, `coverage.lines.${String(line.code)}.${key}`, line[key]);
      }
    }
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Materially different values                                                */
/* -------------------------------------------------------------------------- */

/** `null`, `undefined` and `NaN` are missing (INTERPRETATIONS G-1), never a value. */
function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'number') return Number.isFinite(value);
  return true;
}

function canonicalString(v: unknown): string {
  if (typeof v === 'string') return v.trim().toLowerCase();
  if (Array.isArray(v)) return `[${v.map((e) => canonicalString(e)).join('|')}]`;
  if (isBag(v)) {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${k}=${canonicalString((v as Bag)[k])}`)
      .join('|')}}`;
  }
  return String(v);
}

/**
 * Two values conflict when they are materially different. Numbers compare
 * within MONEY_TOLERANCE (1e-6), so float noise is never a contradiction;
 * strings compare trimmed and case-folded, so `"oh"` and `"OH"` agree.
 */
function materiallyDifferent(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    return !approxEqual(a, b, MONEY_TOLERANCE);
  }
  if (typeof a !== typeof b) return true;
  return canonicalString(a) !== canonicalString(b);
}

function hasConflict(values: readonly Field<unknown>[]): boolean {
  const present = values.filter((f) => isPresent(f.value)).map((f) => f.value);
  for (let i = 1; i < present.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      if (materiallyDifferent(present[i], present[j])) return true;
    }
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* Which rules depend on a canonical path                                     */
/* -------------------------------------------------------------------------- */

/**
 * A rule addresses a vector component key or a rollup field, never the raw
 * building-level path a contradiction lives on. This table is the bridge: the
 * canonical leaf -> every rule field it feeds. A `rollup.` prefix on the rule's
 * field is stripped before the lookup.
 */
const LEAF_TO_RULE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  // Shares and totals are all TIV-weighted, so a disputed TIV moves every one.
  'buildings.tiv': [
    'totalTiv',
    'pctTivPre1990',
    'pctTivPost2010',
    'pctTivAcceptableConstruction',
    'pctTivSprinklered',
    'tivWeightedProtectionClass',
    'stateTier',
    'primaryState',
  ],
  'buildings.yearBuilt': ['pctTivPre1990', 'pctTivPost2010'],
  'buildings.constructionType': ['pctTivAcceptableConstruction'],
  'buildings.sprinklered': ['pctTivSprinklered'],
  'buildings.protectionClass': ['tivWeightedProtectionClass'],
  'locations.state': ['stateTier', 'primaryState'],
  'locations.protectionClass': ['tivWeightedProtectionClass'],
  'history.dateOfLoss': ['fiveYearLoss', 'fiveYearClaimCount'],
  'history.paidIndemnity': ['fiveYearLoss'],
  'history.paidExpense': ['fiveYearLoss'],
  'history.reserves': ['fiveYearLoss'],
  'pricing.quotedPremium': ['quotedPremium'],
  submissionType: ['isNewBusiness', 'submissionType'],
  // The loss window is measured back from the received date (I-4).
  receivedDate: ['fiveYearLoss', 'fiveYearClaimCount', 'receivedDate'],
};

/**
 * The rule fields a canonical path feeds, including the path itself and, for a
 * list entry, its `<list>.<leaf>` form.
 */
function ruleFieldsFor(path: string): Set<string> {
  const fields = new Set<string>([path]);
  const seg = path.split('.');
  const head = seg[0] ?? '';
  const middle = seg[1] ?? '';
  const leaf = seg[2] ?? '';

  let leafKey = path;
  if (seg.length === 3 && (head === 'buildings' || head === 'locations' || head === 'history')) {
    leafKey = `${head}.${leaf}`;
    fields.add(leafKey);
  }
  if (seg.length === 3 && head === 'hazards' && middle === 'present') {
    // Rules may address a hazard as `hazards.candle` or `hazards.present.candle`.
    fields.add(`hazards.${leaf}`);
  }

  for (const field of LEAF_TO_RULE_FIELDS[leafKey] ?? []) fields.add(field);
  return fields;
}

function ruleDependsOn(rule: Rule, fields: ReadonlySet<string>): boolean {
  for (const condition of rule.when) {
    const field = condition.field.startsWith('rollup.')
      ? condition.field.slice('rollup.'.length)
      : condition.field;
    if (fields.has(field) || fields.has(condition.field)) return true;
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* Stage 5                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Find every canonical slot holding two or more materially different values and
 * report it, with the rules it puts at risk.
 *
 * Severity is binary, per PRD 6.3: **HIGH** when at least one rule — Federato's
 * or one of Retrofit's extensions — reads a field the disputed path feeds,
 * because the contradiction can then change a verdict; **LOW** otherwise. An
 * open HIGH contradiction forces `REFER` at stage 9 (INTERPRETATIONS V-3), so a
 * LOW one must never be reported as HIGH.
 *
 * Every contradiction is returned `open`: stage 5 detects, it never resolves.
 * Output is sorted by canonical path, so the list is deterministic.
 */
export function contradict(
  submission: CanonicalSubmission,
  rulebook: Rulebook,
  extensions?: Rulebook,
): Contradiction[] {
  const rules: readonly Rule[] = [...rulebook.rules, ...(extensions?.rules ?? [])];

  const contradictions: Contradiction[] = [];
  for (const slot of slotsOf(submission)) {
    if (!hasConflict(slot.values)) continue;

    const fields = ruleFieldsFor(slot.path);
    const affectedRules = rules.filter((r) => ruleDependsOn(r, fields)).map((r) => r.id);
    const severity: Severity = affectedRules.length > 0 ? 'HIGH' : 'LOW';
    const sources = slot.values.map((f) => f.provenance.source).join(', ');

    contradictions.push({
      id: `contradiction:${slot.path}`,
      canonicalPath: slot.path,
      values: slot.values,
      severity,
      affectedRules,
      status: 'open',
      note: `${slot.values.length} competing values for ${slot.path} (${sources})`,
    });
  }

  contradictions.sort((a, b) => (a.canonicalPath < b.canonicalPath ? -1 : 1));
  return contradictions;
}
