import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';

import { formatMoney, formatPercent, formatTiv, titleCase } from '@retrofit/contracts';

import { useApi } from '../api/useApi.js';
import { Defs, Figures, Group, Panel, useReveal } from './tour-dossier.js';

/**
 * The rulebook section of `/tour`, read live from `GET /rules`.
 *
 * It is drawn as the guideline table it came from — one row per factor, one
 * column per tier, the criterion in the cell, the interpretation in the red
 * margin — rather than as a stack of collapsible factor panels. A reader should
 * be able to compare Target against Not acceptable across a row without opening
 * anything.
 *
 * The API client types `rulebooks` as `unknown[]` and drops the top-level
 * `weights` record, so this file narrows the shape itself and derives each
 * factor's weight from its own rules when the record carries none. Every number
 * shown here is the deployed rulebook's; none of it is typed into this page.
 *
 * It does not import from `RulesPage`: the console's rules page owns that code
 * and exports none of it. The phrasing helpers below are deliberately private
 * to this file.
 */

/* -------------------------------------------------------------------------- */
/* Narrowing                                                                  */
/* -------------------------------------------------------------------------- */

const TIER_ORDER = ['target', 'acceptable', 'refer', 'not_acceptable'] as const;
type TierKey = (typeof TIER_ORDER)[number];

const TIER_LABEL: Readonly<Record<TierKey, string>> = {
  target: 'Target',
  acceptable: 'Acceptable',
  refer: 'Refer',
  not_acceptable: 'Not acceptable',
};

/** What each column means for an account, in the guidelines' own three-point scale. */
const TIER_GLOSS: Readonly<Record<TierKey, string>> = {
  target: 'Scores 1',
  acceptable: 'Scores 0.6',
  refer: 'Needs an underwriter',
  not_acceptable: 'Knocks the account out',
};

/** The rule that runs under the column head. */
const TIER_EDGE: Readonly<Record<TierKey, string>> = {
  target: 'var(--rf-green)',
  acceptable: 'var(--rf-muted)',
  refer: 'var(--rf-blue)',
  not_acceptable: 'var(--rf-red)',
};

/** Display order for Federato's eight weighted factors; anything else sorts after. */
const FACTOR_ORDER: readonly string[] = [
  'submission_type',
  'line_of_business',
  'primary_risk_state',
  'tiv',
  'total_premium',
  'building_age',
  'construction_type',
  'loss_value',
];

const FACTOR_LABEL: Readonly<Record<string, string>> = {
  line_of_business: 'Line of business',
  primary_risk_state: 'Primary risk state',
  tiv: 'Total insured value',
  total_premium: 'Total premium',
  submission_type: 'Submission type',
  building_age: 'Building age',
  construction_type: 'Construction class',
  loss_value: 'Loss history',
  sprinkler_protection: 'Sprinkler protection',
  protection_class: 'Protection class',
  smoke_detection: 'Smoke detection',
  contents_limit: 'Contents limit',
};

/** `hazard_heater_near_combustible` reads better as `Heater Near Combustible (hazard)`. */
function factorLabel(factor: string): string {
  const known = FACTOR_LABEL[factor];
  if (known !== undefined) return known;
  const bare = factor.startsWith('hazard_') ? factor.slice('hazard_'.length) : factor;
  const words = titleCase(bare.replace(/_/g, ' '));
  return factor.startsWith('hazard_') ? `${words} (hazard)` : words;
}

interface TourCondition {
  readonly field: string;
  readonly op: string;
  readonly value: unknown;
}

interface TourRule {
  readonly id: string;
  readonly factor: string;
  readonly tier: TierKey;
  readonly weight: number | null;
  readonly doc: string;
  readonly section: string;
  readonly quote: string;
  readonly when: readonly TourCondition[];
  readonly extension: boolean;
  readonly fixHint: string | null;
  readonly interpretation: string | null;
}

interface TourRulebook {
  readonly id: string;
  readonly label: string;
  readonly version: string;
  readonly isExtension: boolean;
  readonly rules: readonly TourRule[];
}

interface TourInterpretation {
  readonly id: string;
  readonly title: string;
  readonly decision: string;
  readonly affects: readonly string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isTier = (v: unknown): v is TierKey =>
  typeof v === 'string' && (TIER_ORDER as readonly string[]).includes(v);

function toCondition(raw: unknown): TourCondition | null {
  if (!isRecord(raw)) return null;
  const field = typeof raw['field'] === 'string' ? raw['field'] : null;
  const op = typeof raw['op'] === 'string' ? raw['op'] : null;
  if (field === null || op === null) return null;
  return { field, op, value: raw['value'] };
}

function toRule(raw: unknown): TourRule | null {
  if (!isRecord(raw)) return null;
  const { id, factor, tier, citation, when, weight, extension, fixHint, interpretation } = raw;
  if (typeof id !== 'string' || typeof factor !== 'string' || !isTier(tier)) return null;
  if (!isRecord(citation)) return null;
  const { doc, section, quote } = citation;
  if (typeof doc !== 'string' || typeof section !== 'string' || typeof quote !== 'string') {
    return null;
  }
  return {
    id,
    factor,
    tier,
    weight: typeof weight === 'number' ? weight : null,
    doc,
    section,
    quote,
    when: Array.isArray(when)
      ? when.map(toCondition).filter((c): c is TourCondition => c !== null)
      : [],
    extension: extension === true,
    fixHint: typeof fixHint === 'string' ? fixHint : null,
    interpretation: typeof interpretation === 'string' ? interpretation : null,
  };
}

function toRulebooks(raw: readonly unknown[]): readonly TourRulebook[] {
  const books: TourRulebook[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const id = entry['id'];
    const rules = entry['rules'];
    if (typeof id !== 'string' || !Array.isArray(rules)) continue;
    books.push({
      id,
      label: typeof entry['label'] === 'string' ? entry['label'] : titleCase(id),
      version: typeof entry['version'] === 'string' ? entry['version'] : '',
      isExtension: entry['isExtension'] === true || id === 'extensions',
      rules: rules.map(toRule).filter((r): r is TourRule => r !== null),
    });
  }
  return books;
}

function toInterpretations(raw: unknown): readonly TourInterpretation[] {
  if (!Array.isArray(raw)) return [];
  const out: TourInterpretation[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const { id, title, decision, affects } = entry;
    if (typeof id !== 'string' || typeof title !== 'string' || typeof decision !== 'string') {
      continue;
    }
    out.push({
      id,
      title,
      decision,
      affects: Array.isArray(affects) ? affects.filter((a): a is string => typeof a === 'string') : [],
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Conditions → the criterion a reader can scan across a row                  */
/* -------------------------------------------------------------------------- */

type Kind = 'money' | 'tiv' | 'ratio' | 'year' | 'count' | 'plain';

const FIELDS: Readonly<Record<string, { readonly label: string; readonly kind: Kind }>> = {
  totalTiv: { label: 'Total insured value', kind: 'tiv' },
  quotedPremium: { label: 'Quoted premium', kind: 'money' },
  fiveYearLoss: { label: 'Losses over 5 years', kind: 'money' },
  contentsLimit: { label: 'Contents limit', kind: 'money' },
  pctTivPre1990: { label: 'of TIV built before 1990', kind: 'ratio' },
  pctTivPost2010: { label: 'of TIV built after 2010', kind: 'ratio' },
  pctTivAcceptableConstruction: { label: 'of TIV in an accepted class', kind: 'ratio' },
  pctTivSprinklered: { label: 'of TIV sprinklered', kind: 'ratio' },
  tivWeightedProtectionClass: { label: 'TIV-weighted', kind: 'count' },
  buildingYearBuilt: { label: 'Year built', kind: 'year' },
  'rollup.oldestYearBuilt': { label: 'oldest building', kind: 'year' },
  smokeDetectorCount: { label: 'seen in the room', kind: 'count' },
};

/** Fields the engine tests as 0/1. The phrase carries the whole meaning. */
const BOOLS: Readonly<Record<string, readonly [string, string]>> = {
  isNewBusiness: ['New business', 'Renewal business'],
  isPropertyLine: ['Property', 'Any other line'],
  hazardPortableHeater: ['Portable heater in the room', 'No portable heater'],
  hazardHeaterNearCombustible: ['Heater within 20° of fabric', 'Heater clear of fabric'],
  hazardExtensionCord: ['Extension cord in use', 'No extension cord'],
  hazardPowerBarOverload: ['Power bar overloaded', 'Power bar not overloaded'],
  hazardCandle: ['Open-flame candle', 'No candle'],
  hazardStove: ['Cooking appliance in the room', 'No cooking appliance'],
  hazardBlockedExit: ['Exit blocked', 'Exit clear'],
  hazardWindowAcUnit: ['Window air-conditioning unit', 'No window unit'],
  hazardWaterHeater: ['Water heater inside the unit', 'No water heater'],
  hazardHighValueContents: ['High-value contents on show', 'No high-value contents'],
};

function fieldSpec(field: string): { readonly label: string; readonly kind: Kind } {
  return FIELDS[field] ?? { label: titleCase(field), kind: 'plain' };
}

function formatValue(kind: Kind, value: unknown): string {
  if (typeof value !== 'number') return String(value ?? '');
  if (kind === 'money') return formatMoney(value);
  if (kind === 'tiv') return formatTiv(value);
  if (kind === 'ratio') return formatPercent(value);
  return String(value);
}

const LOWER_OPS = new Set(['gt', 'gte']);
const UPPER_OPS = new Set(['lt', 'lte']);

/** One condition on its own, as a phrase that reads under the factor name. */
function singlePhrase(kind: Kind, condition: TourCondition): string {
  const v = formatValue(kind, condition.value);
  const n = typeof condition.value === 'number' ? condition.value : null;
  const whole = kind === 'year' || kind === 'count';
  switch (condition.op) {
    case 'lt':
      if (kind === 'year') return `before ${v}`;
      return whole && n !== null ? `${n - 1} or less` : `under ${v}`;
    case 'lte':
      return kind === 'year' ? `${v} or earlier` : `${v} or less`;
    case 'gt':
      if (kind === 'year') return `after ${v}`;
      return whole && n !== null ? `${n + 1} or more` : `over ${v}`;
    case 'gte':
      return kind === 'year' ? `${v} or later` : `${v} or more`;
    case 'eq':
      return kind === 'count' && n === 0 ? 'None' : v;
    case 'neq':
      return `not ${v}`;
    case 'in':
      return Array.isArray(condition.value) ? condition.value.map(String).join(', ') : v;
    case 'notin':
      return `not ${Array.isArray(condition.value) ? condition.value.map(String).join(', ') : v}`;
    case 'exists':
      return 'Present';
    case 'missing':
      return 'Missing';
    default:
      return `${condition.op} ${v}`;
  }
}

/** Two bounds on one field, collapsed into a range. */
function rangePhrase(kind: Kind, lower: TourCondition, upper: TourCondition): string {
  const whole = kind === 'year' || kind === 'count';
  const lo = typeof lower.value === 'number' ? lower.value : null;
  const hi = typeof upper.value === 'number' ? upper.value : null;
  if (whole && lo !== null && hi !== null) {
    const from = lower.op === 'gt' ? lo + 1 : lo;
    const to = upper.op === 'lt' ? hi - 1 : hi;
    return `${from}–${to}`;
  }
  const a = formatValue(kind, lower.value);
  const b = formatValue(kind, upper.value);
  if (lower.op === 'gte' && upper.op === 'lte') return `${a}–${b}`;
  if (lower.op === 'gt' && upper.op === 'lte') return `over ${a}, up to ${b}`;
  if (lower.op === 'gte' && upper.op === 'lt') return `${a} to under ${b}`;
  return `over ${a}, under ${b}`;
}

interface Clause {
  /** The threshold itself — the thing the eye scans across the row. */
  readonly text: string;
  /** What the threshold is measured on. Empty when the phrase says it already. */
  readonly label: string;
}

/**
 * Turn a rule's `when` list into the criteria a reader can compare across a
 * row. Conditions on one field collapse into a single clause, and a range
 * becomes one phrase rather than two inequalities.
 */
function describe(rule: TourRule): readonly Clause[] {
  const byField = new Map<string, TourCondition[]>();
  for (const condition of rule.when) {
    const list = byField.get(condition.field);
    if (list) list.push(condition);
    else byField.set(condition.field, [condition]);
  }
  if (byField.size === 0) return [{ text: 'Always', label: '' }];

  const single = byField.size === 1;
  const clauses: Clause[] = [];
  for (const [field, conditions] of byField) {
    // The guideline lists the states themselves; the vector tests a tier
    // number, so the citation's own wording is the readable criterion.
    if (field === 'stateTier') {
      clauses.push({ text: rule.quote, label: '' });
      continue;
    }
    const bool = BOOLS[field];
    const first = conditions[0];
    if (bool && conditions.length === 1 && first && first.op === 'eq') {
      const truthy = first.value === 1 || first.value === true || first.value === '1';
      clauses.push({ text: truthy ? bool[0] : bool[1], label: '' });
      continue;
    }
    const spec = fieldSpec(field);
    const lower = conditions.find((c) => LOWER_OPS.has(c.op));
    const upper = conditions.find((c) => UPPER_OPS.has(c.op));
    const text =
      lower && upper && conditions.length === 2
        ? rangePhrase(spec.kind, lower, upper)
        : conditions.map((c) => singlePhrase(spec.kind, c)).join(' and ');
    // A percentage is meaningless without its denominator, so a ratio always
    // names it. A sum of money or a year reads fine under the factor heading.
    const needsLabel = spec.kind === 'ratio' || spec.kind === 'plain' || !single;
    clauses.push({ text, label: needsLabel ? spec.label : '' });
  }
  return clauses;
}

const OP_TEXT: Readonly<Record<string, string>> = {
  lt: '<',
  lte: '≤',
  gt: '>',
  gte: '≥',
  eq: '=',
  neq: '≠',
  in: 'in',
  notin: 'not in',
  exists: 'is present',
  missing: 'is missing',
};

/** The machine truth, kept verbatim under the plain-English phrase. */
function rawCondition(condition: TourCondition): string {
  const op = OP_TEXT[condition.op] ?? condition.op;
  if (condition.op === 'exists' || condition.op === 'missing') return `${condition.field} ${op}`;
  const value = Array.isArray(condition.value)
    ? condition.value.map(String).join(', ')
    : String(condition.value ?? '');
  return `${condition.field} ${op} ${value}`;
}

/* -------------------------------------------------------------------------- */
/* The matrix                                                                 */
/* -------------------------------------------------------------------------- */

interface FactorRow {
  readonly factor: string;
  readonly label: string;
  /** The declared weight, or the one this factor's rules agree on; else null. */
  readonly weight: number | null;
  readonly cells: Readonly<Record<TierKey, readonly TourRule[]>>;
  readonly count: number;
}

interface Matrix {
  readonly rows: readonly FactorRow[];
  /** Only the tier columns this rulebook actually uses. */
  readonly tiers: readonly TierKey[];
  readonly maxWeight: number;
  readonly totalWeight: number;
  readonly weighted: boolean;
}

function buildMatrix(
  rules: readonly TourRule[],
  weights: Readonly<Record<string, number>>,
): Matrix {
  const byFactor = new Map<string, TourRule[]>();
  for (const rule of rules) {
    const list = byFactor.get(rule.factor);
    if (list) list.push(rule);
    else byFactor.set(rule.factor, [rule]);
  }

  const rank = (factor: string): number => {
    const i = FACTOR_ORDER.indexOf(factor);
    return i === -1 ? FACTOR_ORDER.length : i;
  };
  const factors = [...byFactor.keys()];
  const firstSeen = new Map(factors.map((f, i) => [f, i] as const));
  factors.sort((a, b) => rank(a) - rank(b) || (firstSeen.get(a) ?? 0) - (firstSeen.get(b) ?? 0));

  const used = new Set<TierKey>();
  let maxWeight = 0;
  let totalWeight = 0;

  const rows = factors.map((factor): FactorRow => {
    const list = byFactor.get(factor) ?? [];
    const cells: Record<TierKey, TourRule[]> = {
      target: [],
      acceptable: [],
      refer: [],
      not_acceptable: [],
    };
    for (const rule of list) {
      cells[rule.tier].push(rule);
      used.add(rule.tier);
    }
    for (const tier of TIER_ORDER) cells[tier].sort((a, b) => a.id.localeCompare(b.id));

    // The response's own weights record wins; otherwise the weight is the one
    // this factor's rules agree on, and nothing when they do not.
    const distinct = new Set(
      list.map((r) => r.weight).filter((w): w is number => typeof w === 'number'),
    );
    const declared = weights[factor];
    const weight =
      typeof declared === 'number' ? declared : distinct.size === 1 ? [...distinct][0]! : null;
    if (weight !== null) {
      if (weight > maxWeight) maxWeight = weight;
      totalWeight += weight;
    }
    return { factor, label: factorLabel(factor), weight, cells, count: list.length };
  });

  return {
    rows,
    tiers: TIER_ORDER.filter((t) => used.has(t)),
    maxWeight,
    totalWeight,
    weighted: maxWeight > 0,
  };
}

/**
 * The interpretations that bear on one factor row: an interpretation names the
 * vector fields it `affects`, and a rule names the fields it tests.
 */
function notesFor(
  row: FactorRow,
  interpretations: readonly TourInterpretation[],
): readonly TourInterpretation[] {
  const fields = new Set<string>();
  for (const tier of TIER_ORDER) {
    for (const rule of row.cells[tier]) {
      for (const condition of rule.when) fields.add(condition.field);
    }
  }
  return interpretations.filter((item) => item.affects.some((field) => fields.has(field)));
}

/* -------------------------------------------------------------------------- */
/* Reveal                                                                     */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Pieces                                                                     */
/* -------------------------------------------------------------------------- */

/** The weight, and a rule under it sized by share of the heaviest factor. */
function WeightBar(props: { readonly weight: number; readonly max: number }): ReactElement {
  const share = props.max > 0 ? Math.max(0.08, props.weight / props.max) : 0;
  return (
    <span className="rf-tour__weight">
      <span className="rf-tour__weight-value">{formatPercent(props.weight)}</span>
      <span className="rf-tour__weight-track" aria-hidden="true">
        <span className="rf-tour__weight-fill" style={{ '--rf-share': share } as CSSProperties} />
      </span>
    </span>
  );
}

/** One criterion in a cell: the threshold, what it measures, and its rule id. */
function Criterion(props: {
  readonly rule: TourRule;
  readonly open: boolean;
  readonly onToggle: (id: string) => void;
}): ReactElement {
  const { rule, open, onToggle } = props;
  const clauses = describe(rule);
  return (
    <button
      type="button"
      className="rf-tour__crit"
      aria-expanded={open}
      aria-controls={`tour-rule-${rule.id}`}
      data-open={open ? 'true' : undefined}
      data-rule-id={rule.id}
      onClick={() => onToggle(rule.id)}
    >
      {clauses.map((clause, i) => (
        <span key={`${clause.text}-${i}`} className="rf-tour__crit-line">
          <span className="rf-tour__crit-text">{clause.text}</span>
          {clause.label ? <span className="rf-tour__crit-label">{clause.label}</span> : null}
        </span>
      ))}
      <span className="rf-tour__crit-tab">
        <span className="rf-rule-tab">{rule.id}</span>
      </span>
    </button>
  );
}

/** The whole rule, unfolded under the row it sits in. */
function RuleDetail(props: { readonly rule: TourRule }): ReactElement {
  const { rule } = props;
  return (
    <div
      id={`tour-rule-${rule.id}`}
      role="group"
      aria-label={`Rule ${rule.id}`}
      className="rf-tour__detail"
    >
      <p className="rf-tour__detail-head">
        <span className="rf-rule-tab">{rule.id}</span>
        <span className="rf-tour__detail-tier">
          {TIER_LABEL[rule.tier]} · {TIER_GLOSS[rule.tier]}
        </span>
        {rule.extension ? (
          <span className="rf-tour__detail-flag">Ours, not Federato’s</span>
        ) : null}
      </p>
      <p className="rf-tour__quote">
        “{rule.quote}”
        <br />
        <span className="rf-tour__mono">
          {rule.doc} · {rule.section}
        </span>
      </p>
      <dl className="rf-tour__detail-meta">
        <div>
          <dt>Tests</dt>
          <dd>
            <span className="rf-tour__mono">
              {rule.when.length === 0 ? 'Always' : rule.when.map(rawCondition).join(' AND ')}
            </span>
          </dd>
        </div>
        {rule.weight !== null ? (
          <div>
            <dt>Weight</dt>
            <dd>{formatPercent(rule.weight)}</dd>
          </div>
        ) : null}
        {rule.interpretation !== null ? (
          <div>
            <dt>Interpretation</dt>
            <dd>{rule.interpretation}</dd>
          </div>
        ) : null}
        {rule.fixHint !== null ? (
          <div>
            <dt>Fix</dt>
            <dd>{rule.fixHint}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

/** Red-pen notes beside the row an interpretation changes. */
function MarginNotes(props: { readonly notes: readonly TourInterpretation[] }): ReactElement | null {
  if (props.notes.length === 0) return null;
  return (
    <>
      {props.notes.map((note) => (
        <a
          key={note.id}
          className="rf-margin-note"
          href="#rules-interpretations"
          title={note.decision}
          data-interpretation-id={note.id}
        >
          {note.title}
        </a>
      ))}
    </>
  );
}

function CellRules(props: {
  readonly rules: readonly TourRule[];
  readonly openId: string | null;
  readonly onToggle: (id: string) => void;
}): ReactElement {
  if (props.rules.length === 0) {
    return (
      <span className="rf-tour__cell-empty" aria-label="No rule">
        —
      </span>
    );
  }
  return (
    <>
      {props.rules.map((rule) => (
        <Criterion
          key={rule.id}
          rule={rule}
          open={props.openId === rule.id}
          onToggle={props.onToggle}
        />
      ))}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* One rulebook, as a ruled sheet                                             */
/* -------------------------------------------------------------------------- */

/** A heading id a table can point at: `federato-appetite-guidelines`. */
function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function Sheet(props: {
  readonly matrix: Matrix;
  readonly title: string;
  readonly aside: string;
  readonly note?: ReactNode;
  readonly interpretations: readonly TourInterpretation[];
  readonly openId: string | null;
  readonly onToggle: (id: string) => void;
}): ReactElement {
  const { matrix, title, aside, note, interpretations, openId, onToggle } = props;
  const reveal = useReveal<HTMLElement>();
  const headingId = `sheet-${slug(title)}`;
  const notes = matrix.rows.map((row) => notesFor(row, interpretations));
  const hasMargin = notes.some((list) => list.length > 0);
  const columns = 1 + (matrix.weighted ? 1 : 0) + matrix.tiers.length + (hasMargin ? 1 : 0);

  return (
    <section className="rf-tour__sheet" ref={reveal} aria-labelledby={headingId}>
      <header className="rf-tour__sheet-head">
        <h3 id={headingId}>{title}</h3>
        <span className="rf-tour__sheet-aside">{aside}</span>
      </header>
      {note ? <p className="rf-tour__sheet-note">{note}</p> : null}
      {matrix.rows.length === 0 ? (
        <p className="rf-tour__sheet-note">No rules in this rulebook.</p>
      ) : (
        <div className="rf-scroll-x">
          <table className="rf-tour__matrix">
            <caption className="rf-sr-only">
              {title}: every factor, with the criterion that puts an account in each tier.
            </caption>
            <colgroup>
              <col className="rf-tour__col-factor" />
              {matrix.weighted ? <col className="rf-tour__col-weight" /> : null}
              {matrix.tiers.map((tier) => (
                <col key={tier} />
              ))}
              {hasMargin ? <col className="rf-tour__col-margin" /> : null}
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Factor</th>
                {matrix.weighted ? <th scope="col">Weight</th> : null}
                {matrix.tiers.map((tier) => (
                  <th
                    key={tier}
                    scope="col"
                    className="rf-tour__tier-head"
                    style={{ '--rf-tier-edge': TIER_EDGE[tier] } as CSSProperties}
                  >
                    <span className="rf-tour__tier-name">{TIER_LABEL[tier]}</span>
                    <span className="rf-tour__tier-gloss">{TIER_GLOSS[tier]}</span>
                  </th>
                ))}
                {hasMargin ? (
                  <th scope="col" className="rf-tour__margin-cell">
                    Margin
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((row, i) => {
                const open = matrix.tiers
                  .flatMap((tier) => row.cells[tier])
                  .find((rule) => rule.id === openId);
                return (
                  <Fragment key={row.factor}>
                    <tr style={{ '--rf-row': i } as CSSProperties}>
                      <th scope="row" className="rf-tour__row-head">
                        {row.label}
                      </th>
                      {matrix.weighted ? (
                        <td className="rf-tour__cell-weight">
                          {row.weight === null ? (
                            <span className="rf-tour__cell-empty">—</span>
                          ) : (
                            <WeightBar weight={row.weight} max={matrix.maxWeight} />
                          )}
                        </td>
                      ) : null}
                      {matrix.tiers.map((tier) => (
                        <td key={tier} className="rf-tour__cell">
                          <CellRules rules={row.cells[tier]} openId={openId} onToggle={onToggle} />
                        </td>
                      ))}
                      {hasMargin ? (
                        <td className="rf-tour__margin-cell">
                          <MarginNotes notes={notes[i] ?? []} />
                        </td>
                      ) : null}
                    </tr>
                    {open ? (
                      <tr className="rf-tour__detail-row">
                        <td colSpan={hasMargin ? columns - 1 : columns}>
                          <RuleDetail rule={open} />
                        </td>
                        {/* The red margin rule runs unbroken past an open rule. */}
                        {hasMargin ? <td className="rf-tour__margin-cell" /> : null}
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** `4 rules`, `1 rule`. */
const ruleCount = (n: number): string => `${n} ${n === 1 ? 'rule' : 'rules'}`;

/** `v1.0.0 · 24 rules`, uppercased by the sheet's own type. */
function sheetAside(book: TourRulebook | undefined): string {
  if (book === undefined) return '';
  return [book.version ? `v${book.version}` : null, ruleCount(book.rules.length)]
    .filter((part): part is string => part !== null)
    .join(' · ');
}

/**
 * The top-level `weights` record, when the response carries one. The API client
 * types it away, so it is narrowed back off the raw object; a factor's weight
 * falls back to the one its own rules agree on.
 */
function toWeights(raw: unknown): Readonly<Record<string, number>> {
  if (!isRecord(raw) || !isRecord(raw['weights'])) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw['weights'])) {
    if (typeof value === 'number') out[key] = value;
  }
  return out;
}

/**
 * The whole rulebook, drawn as the guideline table it came from and read live
 * so it cannot drift from the engine that scores the book. The three rulebooks
 * are kept apart on purpose: only the commercial one scores a Federato account.
 */
export function RulesGroup(): ReactElement {
  const state = useApi((client) => client.getRules(), []);
  const [openId, setOpenId] = useState<string | null>(null);

  const onToggle = useCallback((id: string): void => {
    setOpenId((current) => (current === id ? null : id));
  }, []);

  const books = useMemo(
    () => (state.data === null ? [] : toRulebooks(state.data.rulebooks)),
    [state.data],
  );
  const weights = useMemo(() => toWeights(state.data), [state.data]);
  const interpretations = useMemo(
    () => (state.data === null ? [] : toInterpretations(state.data.interpretations)),
    [state.data],
  );

  const commercial = books.find((b) => b.id === 'commercial') ?? books.find((b) => !b.isExtension);
  const tenant = books.find((b) => b.id === 'tenant');
  const extensions = books.find((b) => b.isExtension);

  const matrix = useMemo(() => buildMatrix(commercial?.rules ?? [], weights), [commercial, weights]);
  const tenantMatrix = useMemo(() => buildMatrix(tenant?.rules ?? [], {}), [tenant]);
  const extensionMatrix = useMemo(() => buildMatrix(extensions?.rules ?? [], {}), [extensions]);

  return (
    <Group
      id="rules"
      title="The rulebook, with its weights"
      lede="Read live from GET /rules on every load, the same endpoint the console's rules page and the 3D appetite terrain use. Nothing here can disagree with the engine."
    >
      {state.error !== null ? (
        <p className="rf-tour__state">
          The rulebook could not be loaded ({state.error.message}).{' '}
          <button type="button" className="rf-tour__chip" onClick={state.reload}>
            Try again
          </button>
        </p>
      ) : state.data === null ? (
        <p className="rf-tour__state">Loading the rulebook from the API…</p>
      ) : (
        <>
          <Figures
            items={[
              { value: String(matrix.rows.length), label: 'weighted factors' },
              { value: String(commercial?.rules.length ?? 0), label: 'appetite rules' },
              {
                value: formatPercent(matrix.totalWeight, { from: 'ratio' }),
                label: 'of the score accounted for',
              },
              { value: String(tenant?.rules.length ?? 0), label: 'tenant rules' },
              { value: String(extensions?.rules.length ?? 0), label: 'Retrofit extensions' },
            ]}
          />

          <Panel title="How a submission becomes a score" note="11 components, 8 factors" open>
            <p>
              Each submission becomes an 11-component feature vector. The appetite score is{' '}
              <span className="rf-tour__mono">100 × (w · t)</span> over Federato’s eight factors,
              with tiers 1.0 / 0.6 / 0. Any not-acceptable tier is a knockout regardless of the
              score. <strong>Missing data is never imputed</strong> — it forces REFER rather than
              guessing a tier.
            </p>
            <p>
              The table below is the guideline table itself: a row per factor, a column per tier,
              and the criterion that lands an account in it. Open any criterion for the rule id, the
              raw condition the engine tests, and the quoted line it came from.
            </p>
          </Panel>

          {/* The two rulebooks read as a pair: the same factors, one scored and
              one not. Side by side on a wide screen, stacked below 88rem. */}
          <div className="rf-tour__pair rf-tour__wide">
            <Sheet
              matrix={matrix}
              title={commercial?.label ?? 'Federato appetite guidelines'}
              aside={sheetAside(commercial)}
              interpretations={interpretations}
              openId={openId}
              onToggle={onToggle}
            />

            {tenant !== undefined && tenant.rules.length > 0 ? (
              <Sheet
                matrix={tenantMatrix}
                title={tenant.label}
                aside={`${sheetAside(tenant)} · prices a room, never an account`}
                note="The rules the phone app runs. These are Retrofit’s, not Federato’s: they turn what the camera saw into a tenant verdict and an estimate, and they never touch a commercial appetite score. Tenant rates are invented and labelled “estimate”."
                interpretations={interpretations}
                openId={openId}
                onToggle={onToggle}
              />
            ) : null}
          </div>

          {/* The third page of the same rulebook: it takes the pair's width so
              all three sheets stack on one set of edges. */}
          {extensions !== undefined && extensions.rules.length > 0 ? (
            <div className="rf-tour__wide">
              <Sheet
                matrix={extensionMatrix}
                title={extensions.label}
                aside={`${sheetAside(extensions)} · never scores an account`}
                note="Ours, not Federato’s. They are labelled as extensions wherever they appear, and they feed the rating table rather than the appetite score."
                interpretations={interpretations}
                openId={openId}
                onToggle={onToggle}
              />
            </div>
          ) : null}

          {interpretations.length > 0 ? (
            <div id="rules-interpretations">
              <Panel
                title="Where the guidelines are ambiguous"
                note={`${interpretations.length} interpretations`}
              >
                <p>
                  The PDF leaves real gaps. Each one was resolved once, in a written contract, and
                  the reading is shown in the margin of every row it decides.
                </p>
                <Defs rows={interpretations.map((i) => ({ term: i.title, value: i.decision }))} />
              </Panel>
            </div>
          ) : null}
        </>
      )}
    </Group>
  );
}
