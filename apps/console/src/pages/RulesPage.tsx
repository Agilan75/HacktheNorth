import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { useSearchParams } from 'react-router';

import type { RulesResponseDto } from '@retrofit/contracts';
import { formatMoney, formatPercent, formatTiv, pluralize, titleCase } from '@retrofit/contracts';
import { cssVar, MIN_TOUCH_TARGET, RADIUS, SPACE, TIER_LABELS } from '@retrofit/design';

import { useApi } from '../api/useApi.js';
import { Badge } from '../components/atoms/Badge.js';
import { Card } from '../components/atoms/Card.js';
import { CitationQuote } from '../components/atoms/CitationQuote.js';
import { Skeleton } from '../components/atoms/Skeleton.js';

type RulebookDto = RulesResponseDto['rulebooks'][number];
type RuleDto = RulebookDto['rules'][number];
type ConditionDto = RuleDto['when'][number];
type InterpretationDto = RulesResponseDto['interpretations'][number];

/* -------------------------------------------------------------------------- */
/* Tiers — the matrix columns                                                 */
/* -------------------------------------------------------------------------- */

const TIER_ORDER = ['target', 'acceptable', 'refer', 'not_acceptable'] as const;
type TierKey = (typeof TIER_ORDER)[number];

/** The one gloss the page needs: what each column means for an account. */
const TIER_GLOSS: Readonly<Record<TierKey, string>> = {
  target: 'Scores 1',
  acceptable: 'Scores 0.6',
  refer: 'Needs an underwriter',
  not_acceptable: 'Knocks the account out',
};

const TIER_EDGE: Readonly<Record<TierKey, string>> = {
  target: cssVar('green'),
  acceptable: cssVar('muted'),
  refer: cssVar('blue'),
  not_acceptable: cssVar('red'),
};

const TIER_TONE: Readonly<Record<TierKey, 'positive' | 'neutral' | 'info' | 'attention'>> = {
  target: 'positive',
  acceptable: 'neutral',
  refer: 'info',
  not_acceptable: 'attention',
};

function isTier(value: string): value is TierKey {
  return (TIER_ORDER as readonly string[]).includes(value);
}

/* -------------------------------------------------------------------------- */
/* Factors — the matrix rows                                                  */
/* -------------------------------------------------------------------------- */

/** PRD §6.6 appetite table order; any other factor follows in rulebook order. */
const APPETITE_FACTOR_ORDER: readonly string[] = [
  'submission_type',
  'line_of_business',
  'primary_risk_state',
  'tiv',
  'total_premium',
  'building_age',
  'construction_type',
  'loss_value',
];

const FACTOR_LABELS: Readonly<Record<string, string>> = {
  tiv: 'TIV',
  line_of_business: 'Line of business',
  primary_risk_state: 'Primary risk state',
  submission_type: 'Submission type',
  total_premium: 'Total premium',
  building_age: 'Building age',
  construction_type: 'Construction type',
  loss_value: 'Loss value',
  sprinkler_protection: 'Sprinkler protection',
  protection_class: 'Public protection class',
  smoke_detection: 'Smoke detection',
  contents_limit: 'Contents limit',
  term: 'Policy term',
  hazard_portable_heater: 'Portable heater',
  hazard_heater_near_combustible: 'Heater near soft furnishings',
  hazard_extension_cord: 'Extension cord',
  hazard_power_bar_overload: 'Power bar',
  hazard_candle: 'Open flame',
  hazard_stove: 'Cooking appliance',
  hazard_blocked_exit: 'Exit',
  hazard_window_ac_unit: 'Window air conditioning',
  hazard_water_heater: 'Water heater',
  hazard_high_value_contents: 'High-value contents',
};

/** Sentence case, not Title Case: these sit beside `Building age`. */
function factorLabel(factor: string): string {
  const known = FACTOR_LABELS[factor];
  if (known) return known;
  const words = factor.replace(/^hazard_/, '').split('_');
  const [first = '', ...rest] = words;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ');
}

/* -------------------------------------------------------------------------- */
/* Conditions → plain English                                                 */
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

function formatValue(kind: Kind, value: ConditionDto['value']): string {
  if (typeof value !== 'number') return String(value ?? '');
  if (kind === 'money') return formatMoney(value);
  if (kind === 'tiv') return formatTiv(value);
  if (kind === 'ratio') return formatPercent(value);
  return String(value);
}

const LOWER_OPS = new Set(['gt', 'gte']);
const UPPER_OPS = new Set(['lt', 'lte']);

/** One condition on its own, as a phrase that reads under the factor name. */
function singlePhrase(kind: Kind, condition: ConditionDto): string {
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
function rangePhrase(kind: Kind, lower: ConditionDto, upper: ConditionDto): string {
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
 * row. Conditions on one field collapse into a single clause; a range becomes
 * one phrase rather than two inequalities.
 */
function describe(rule: RuleDto): readonly Clause[] {
  const byField = new Map<string, ConditionDto[]>();
  for (const condition of rule.when) {
    const list = byField.get(condition.field);
    if (list) list.push(condition);
    else byField.set(condition.field, [condition]);
  }
  if (byField.size === 0) return [{ text: 'Always', label: '' }];

  const single = byField.size === 1;
  const clauses: Clause[] = [];
  for (const [field, conditions] of byField) {
    // The guideline lists the states themselves; the vector tests a tier number,
    // so the citation's own wording is the readable criterion.
    if (field === 'stateTier') {
      clauses.push({ text: rule.citation.quote, label: '' });
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
function rawCondition(condition: ConditionDto): string {
  const op = OP_TEXT[condition.op] ?? condition.op;
  if (condition.op === 'exists' || condition.op === 'missing') return `${condition.field} ${op}`;
  const value = Array.isArray(condition.value)
    ? condition.value.map(String).join(', ')
    : String(condition.value ?? '');
  return `${condition.field} ${op} ${value}`;
}

/* -------------------------------------------------------------------------- */
/* Narrowing the untyped response                                             */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRule(value: unknown): value is RuleDto {
  if (!isRecord(value)) return false;
  const c = value.citation;
  return (
    typeof value.id === 'string' &&
    typeof value.factor === 'string' &&
    typeof value.tier === 'string' &&
    Array.isArray(value.when) &&
    isRecord(c) &&
    typeof c.doc === 'string' &&
    typeof c.section === 'string' &&
    typeof c.quote === 'string'
  );
}

/**
 * `getRules()` types rulebooks as `unknown[]`; narrow each one to the frozen
 * RulesResponseDto shape and drop malformed rules rather than crash the page.
 */
function toRulebooks(raw: readonly unknown[]): readonly RulebookDto[] {
  const books: RulebookDto[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== 'string' || !Array.isArray(item.rules)) continue;
    books.push({
      id: item.id,
      label:
        typeof item.label === 'string' && item.label.length > 0 ? item.label : titleCase(item.id),
      version: typeof item.version === 'string' ? item.version : '',
      isExtension: item.isExtension === true || item.id === 'extensions',
      rules: (item.rules as readonly unknown[]).filter(isRule),
    });
  }
  return books;
}

function isInterpretation(value: unknown): value is InterpretationDto {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.decision === 'string'
  );
}

/* -------------------------------------------------------------------------- */
/* Matrix model                                                               */
/* -------------------------------------------------------------------------- */

interface FactorRow {
  readonly factor: string;
  /** The factor's weight when every weighted rule agrees on one; else null. */
  readonly weight: number | null;
  readonly cells: Readonly<Record<TierKey, readonly RuleDto[]>>;
  readonly count: number;
}

interface Matrix {
  readonly rows: readonly FactorRow[];
  /** Only the tier columns this rulebook actually uses. */
  readonly tiers: readonly TierKey[];
  readonly maxWeight: number;
  readonly weighted: boolean;
}

function buildMatrix(rules: readonly RuleDto[]): Matrix {
  const byFactor = new Map<string, RuleDto[]>();
  for (const rule of rules) {
    const list = byFactor.get(rule.factor);
    if (list) list.push(rule);
    else byFactor.set(rule.factor, [rule]);
  }
  const rank = (factor: string): number => {
    const i = APPETITE_FACTOR_ORDER.indexOf(factor);
    return i === -1 ? APPETITE_FACTOR_ORDER.length : i;
  };
  const factors = [...byFactor.keys()];
  const firstSeen = new Map(factors.map((f, i) => [f, i] as const));
  factors.sort((a, b) => rank(a) - rank(b) || (firstSeen.get(a) ?? 0) - (firstSeen.get(b) ?? 0));

  const used = new Set<TierKey>();
  let maxWeight = 0;
  const rows = factors.map((factor) => {
    const list = byFactor.get(factor) ?? [];
    const cells: Record<TierKey, RuleDto[]> = {
      target: [],
      acceptable: [],
      refer: [],
      not_acceptable: [],
    };
    for (const rule of list) {
      if (!isTier(rule.tier)) continue;
      cells[rule.tier].push(rule);
      used.add(rule.tier);
    }
    const weights = new Set(
      list.map((r) => r.weight).filter((w): w is number => typeof w === 'number'),
    );
    const weight = weights.size === 1 ? [...weights][0]! : null;
    if (weight !== null && weight > maxWeight) maxWeight = weight;
    return { factor, weight, cells, count: list.length };
  });

  return {
    rows,
    tiers: TIER_ORDER.filter((t) => used.has(t)),
    maxWeight,
    weighted: maxWeight > 0,
  };
}

/**
 * The interpretations that bear on one factor row: an interpretation names the
 * vector fields it `affects`, a rule names the fields it tests.
 */
function notesFor(
  row: FactorRow,
  interpretations: readonly InterpretationDto[],
): readonly InterpretationDto[] {
  const fields = new Set<string>();
  for (const tier of TIER_ORDER) {
    for (const rule of row.cells[tier]) {
      for (const condition of rule.when) fields.add(condition.field);
    }
  }
  return interpretations.filter((item) => (item.affects ?? []).some((field) => fields.has(field)));
}

/* -------------------------------------------------------------------------- */
/* Narrow-viewport switch                                                     */
/* -------------------------------------------------------------------------- */

const STACK_BELOW = 900;

/** True on a viewport too narrow for a four-column matrix. Wide in jsdom. */
function useStacked(): boolean {
  const [stacked, setStacked] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(`(max-width: ${STACK_BELOW - 1}px)`);
    const apply = (): void => setStacked(query.matches);
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);
  return stacked;
}

/* -------------------------------------------------------------------------- */
/* Styles                                                                     */
/* -------------------------------------------------------------------------- */

const pageStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: SPACE.xl,
  fontFamily: cssVar('font-body'),
  color: cssVar('ink'),
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontFamily: cssVar('font-display'),
  fontSize: cssVar('size-title'),
  lineHeight: cssVar('leading-title'),
};

const mutedStyle: CSSProperties = {
  margin: 0,
  color: cssVar('muted-deep'),
  fontSize: cssVar('size-small'),
  lineHeight: cssVar('leading-small'),
};

const microStyle: CSSProperties = {
  color: cssVar('muted-deep'),
  fontSize: cssVar('size-micro'),
  lineHeight: cssVar('leading-micro'),
};

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: cssVar('size-small'),
  lineHeight: cssVar('leading-small'),
  tableLayout: 'fixed',
};

const cellBase: CSSProperties = {
  borderTop: `${cssVar('border-width')} solid ${cssVar('border-color')}`,
  padding: SPACE.sm,
  verticalAlign: 'top',
  textAlign: 'left',
  minWidth: 0,
};

/** Ruled columns, as on a printed table; the tier is named in the head, not painted down the page. */
const columnRule: CSSProperties = {
  borderLeft: '1px solid var(--rf-rule-faint)',
};

/** The ledger's double red rule, separating the printed table from the margin. */
const marginRule: CSSProperties = {
  borderLeft: `1px solid ${cssVar('red')}`,
  boxShadow: `inset 3px 0 0 var(--rf-sheet), inset 4px 0 0 ${cssVar('red')}`,
  paddingLeft: SPACE.lg,
};

const rowHeadStyle: CSSProperties = {
  ...cellBase,
  fontFamily: cssVar('font-display'),
  color: cssVar('ink'),
  fontWeight: 600,
  fontSize: cssVar('size-body'),
  lineHeight: cssVar('leading-body'),
  paddingLeft: 0,
  overflowWrap: 'anywhere',
};

const codeStyle: CSSProperties = {
  fontSize: cssVar('size-micro'),
  overflowWrap: 'anywhere',
};

const ruleButtonStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  minHeight: MIN_TOUCH_TARGET,
  textAlign: 'left',
  background: 'transparent',
  border: `${cssVar('border-width')} solid transparent`,
  borderRadius: RADIUS.card,
  padding: `${SPACE.sm}px ${SPACE.sm}px`,
  font: 'inherit',
  color: 'inherit',
  cursor: 'pointer',
};

const detailStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: SPACE.sm,
  padding: `${SPACE.md}px ${SPACE.lg}px ${SPACE.lg}px`,
  maxWidth: 860,
  boxSizing: 'border-box',
  background: cssVar('paper'),
  border: '1px solid var(--rf-rule)',
  borderTop: `2px solid ${cssVar('ink')}`,
};

const metaStyle: CSSProperties = {
  margin: 0,
  display: 'grid',
  gridTemplateColumns: 'max-content minmax(0, 1fr)',
  columnGap: SPACE.md,
  rowGap: SPACE.xs,
  fontSize: cssVar('size-small'),
  lineHeight: cssVar('leading-small'),
};

/* -------------------------------------------------------------------------- */
/* Pieces                                                                     */
/* -------------------------------------------------------------------------- */

function WeightBar(props: { readonly weight: number; readonly max: number }): ReactElement {
  const share = props.max > 0 ? Math.max(0.08, props.weight / props.max) : 0;
  return (
    <span style={{ display: 'block' }}>
      <span style={{ display: 'block', fontVariantNumeric: 'tabular-nums' }}>
        {formatPercent(props.weight)}
      </span>
      <span
        aria-hidden="true"
        style={{
          display: 'block',
          height: 3,
          marginTop: 2,
          background: 'var(--rf-rule-faint)',
        }}
      >
        <span
          style={{
            display: 'block',
            height: 3,
            width: `${share * 100}%`,
            background: cssVar('ink'),
          }}
        />
      </span>
    </span>
  );
}

/** One criterion in a cell: the threshold, what it measures, and its rule id. */
function Criterion(props: {
  readonly rule: RuleDto;
  readonly open: boolean;
  readonly onToggle: (id: string) => void;
}): ReactElement {
  const { rule, open, onToggle } = props;
  const clauses = describe(rule);
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={`rule-${rule.id}`}
      onClick={() => onToggle(rule.id)}
      data-rule-id={rule.id}
      style={{
        ...ruleButtonStyle,
        borderColor: 'transparent',
        background: open ? cssVar('paper') : 'transparent',
        boxShadow: open ? `inset 3px 0 0 ${cssVar('ink')}` : 'none',
      }}
    >
      {clauses.map((clause, i) => (
        <span key={`${clause.text}-${i}`} style={{ display: 'block' }}>
          <span style={{ fontWeight: 600 }}>{clause.text}</span>
          {clause.label ? <span style={{ ...microStyle, display: 'block' }}>{clause.label}</span> : null}
        </span>
      ))}
      <span style={{ display: 'block', marginTop: SPACE.xs }}>
        <span className="rf-rule-tab">{rule.id}</span>
      </span>
    </button>
  );
}

function RuleDetail(props: { readonly rule: RuleDto }): ReactElement {
  const { rule } = props;
  const citation = rule.citation;
  const tier = isTier(rule.tier) ? rule.tier : null;
  return (
    <div id={`rule-${rule.id}`} role="group" style={detailStyle} aria-label={`Rule ${rule.id}`}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.sm, alignItems: 'baseline' }}>
        <span className="rf-rule-tab">{rule.id}</span>
        <Badge
          label={tier ? TIER_LABELS[tier] : titleCase(rule.tier)}
          tone={tier ? TIER_TONE[tier] : 'neutral'}
        />
        {rule.extension === true ? <Badge label="Ours, not Federato’s" tone="quiet" /> : null}
      </div>
      <dl style={metaStyle}>
        <dt style={{ color: cssVar('muted-deep') }}>Tests</dt>
        <dd style={{ margin: 0, minWidth: 0 }}>
          {rule.when.length === 0 ? (
            'Always'
          ) : (
            <code style={codeStyle}>{rule.when.map(rawCondition).join(' AND ')}</code>
          )}
        </dd>
        {typeof rule.weight === 'number' ? (
          <>
            <dt style={{ color: cssVar('muted-deep') }}>Weight</dt>
            <dd style={{ margin: 0 }}>{formatPercent(rule.weight)}</dd>
          </>
        ) : null}
        {rule.ratingFactor ? (
          <>
            <dt style={{ color: cssVar('muted-deep') }}>Rating factor</dt>
            <dd style={{ margin: 0, minWidth: 0 }}>
              <code style={codeStyle}>{rule.ratingFactor}</code>
            </dd>
          </>
        ) : null}
      </dl>
      <CitationQuote
        citation={{ document: `${citation.doc} · ${citation.section}`, quote: citation.quote }}
      />
      {rule.interpretation ? (
        <p style={mutedStyle}>
          <strong>Interpretation: </strong>
          {rule.interpretation}
        </p>
      ) : null}
      {rule.fixHint ? (
        <p style={mutedStyle}>
          <strong>Fix: </strong>
          {rule.fixHint}
        </p>
      ) : null}
    </div>
  );
}

/** Red-pen notes beside the row an interpretation changes; each links to the full decision. */
function MarginNotes(props: { readonly notes: readonly InterpretationDto[] }): ReactElement | null {
  if (props.notes.length === 0) return null;
  return (
    <>
      {props.notes.map((note) => (
        <a
          key={note.id}
          className="rf-margin-note"
          href="#interpretations"
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
  readonly rules: readonly RuleDto[];
  readonly openId: string | null;
  readonly onToggle: (id: string) => void;
}): ReactElement {
  const { rules, openId, onToggle } = props;
  if (rules.length === 0) {
    return (
      <span style={microStyle} aria-label="No rule">
        —
      </span>
    );
  }
  return (
    <>
      {rules.map((rule) => (
        <Criterion key={rule.id} rule={rule} open={openId === rule.id} onToggle={onToggle} />
      ))}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* The matrix, wide and stacked                                               */
/* -------------------------------------------------------------------------- */

function WideMatrix(props: {
  readonly matrix: Matrix;
  readonly caption: string;
  readonly interpretations: readonly InterpretationDto[];
  readonly openId: string | null;
  readonly onToggle: (id: string) => void;
}): ReactElement {
  const { matrix, caption, interpretations, openId, onToggle } = props;
  const notes = matrix.rows.map((row) => notesFor(row, interpretations));
  const hasMargin = notes.some((list) => list.length > 0);
  const columns = 1 + (matrix.weighted ? 1 : 0) + matrix.tiers.length + (hasMargin ? 1 : 0);
  return (
    <table style={tableStyle}>
      <caption className="rf-sr-only">{caption}</caption>
      <colgroup>
        <col style={{ width: '18%' }} />
        {matrix.weighted ? <col style={{ width: '9%' }} /> : null}
        {matrix.tiers.map((tier) => (
          <col key={tier} />
        ))}
        {hasMargin ? <col style={{ width: '17%' }} /> : null}
      </colgroup>
      <thead>
        <tr>
          <th scope="col" style={{ ...cellBase, borderTop: 'none', paddingLeft: 0 }}>
            <span style={microStyle}>Factor</span>
          </th>
          {matrix.weighted ? (
            <th scope="col" style={{ ...cellBase, borderTop: 'none' }}>
              <span style={microStyle}>Weight</span>
            </th>
          ) : null}
          {matrix.tiers.map((tier) => (
            <th
              key={tier}
              scope="col"
              style={{
                ...cellBase,
                ...columnRule,
                borderTop: 'none',
                borderBottom: `3px solid ${TIER_EDGE[tier]}`,
              }}
            >
              <span style={{ display: 'block', fontWeight: 600 }}>{TIER_LABELS[tier]}</span>
              <span style={{ ...microStyle, display: 'block', textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
                {TIER_GLOSS[tier]}
              </span>
            </th>
          ))}
          {hasMargin ? (
            <th scope="col" style={{ ...cellBase, ...marginRule, borderTop: 'none' }}>
              <span style={microStyle}>Margin</span>
            </th>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {matrix.rows.map((row, rowIndex) => {
          const open = matrix.tiers
            .flatMap((tier) => row.cells[tier])
            .find((rule) => rule.id === openId);
          return (
            <Fragment key={row.factor}>
              <tr>
                <th scope="row" style={rowHeadStyle}>
                  {factorLabel(row.factor)}
                </th>
                {matrix.weighted ? (
                  <td style={{ ...cellBase, fontSize: cssVar('size-small') }}>
                    {row.weight === null ? (
                      <span style={microStyle}>—</span>
                    ) : (
                      <WeightBar weight={row.weight} max={matrix.maxWeight} />
                    )}
                  </td>
                ) : null}
                {matrix.tiers.map((tier) => (
                  <td
                    key={tier}
                    style={{ ...cellBase, ...columnRule, padding: SPACE.xs }}
                  >
                    <CellRules rules={row.cells[tier]} openId={openId} onToggle={onToggle} />
                  </td>
                ))}
                {hasMargin ? (
                  <td style={{ ...cellBase, ...marginRule, verticalAlign: 'middle' }}>
                    <MarginNotes notes={notes[rowIndex] ?? []} />
                  </td>
                ) : null}
              </tr>
              {open ? (
                <tr>
                  <td
                    colSpan={hasMargin ? columns - 1 : columns}
                    style={{ padding: `0 ${SPACE.lg}px ${SPACE.lg}px 0`, borderBottom: 'none' }}
                  >
                    <RuleDetail rule={open} />
                  </td>
                  {/* The margin rule runs unbroken past an open rule. */}
                  {hasMargin ? <td style={{ ...marginRule, borderBottom: 'none' }} /> : null}
                </tr>
              ) : null}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function StackedMatrix(props: {
  readonly matrix: Matrix;
  readonly interpretations: readonly InterpretationDto[];
  readonly openId: string | null;
  readonly onToggle: (id: string) => void;
}): ReactElement {
  const { matrix, interpretations, openId, onToggle } = props;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
      {matrix.rows.map((row) => {
        const open = matrix.tiers
          .flatMap((tier) => row.cells[tier])
          .find((rule) => rule.id === openId);
        return (
          <section key={row.factor} aria-label={factorLabel(row.factor)}>
            <h3
              style={{
                margin: 0,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: SPACE.sm,
                fontSize: cssVar('size-body'),
                lineHeight: cssVar('leading-body'),
              }}
            >
              <span>{factorLabel(row.factor)}</span>
              {matrix.weighted && row.weight !== null ? (
                <span style={microStyle}>{formatPercent(row.weight)}</span>
              ) : null}
            </h3>
            <MarginNotes notes={notesFor(row, interpretations)} />
            {matrix.tiers.map((tier) =>
              row.cells[tier].length === 0 ? null : (
                <div
                  key={tier}
                  style={{
                    marginTop: SPACE.sm,
                    padding: SPACE.sm,
                    borderLeft: `3px solid ${TIER_EDGE[tier]}`,
                  }}
                >
                  <span style={{ ...microStyle, display: 'block', fontWeight: 600 }}>
                    {TIER_LABELS[tier]}
                  </span>
                  <CellRules rules={row.cells[tier]} openId={openId} onToggle={onToggle} />
                </div>
              ),
            )}
            {open ? <div style={{ marginTop: SPACE.sm }}><RuleDetail rule={open} /></div> : null}
          </section>
        );
      })}
    </div>
  );
}

function RulebookCard(props: {
  readonly book: RulebookDto;
  readonly note?: ReactNode;
  readonly interpretations: readonly InterpretationDto[];
  readonly stacked: boolean;
  readonly openId: string | null;
  readonly onToggle: (id: string) => void;
}): ReactElement {
  const { book, note, interpretations, stacked, openId, onToggle } = props;
  const matrix = useMemo(() => buildMatrix(book.rules), [book.rules]);
  const aside = [book.version ? `v${book.version}` : null, pluralize(book.rules.length, 'rule')]
    .filter(Boolean)
    .join(' · ');
  return (
    <Card title={book.label} aside={aside} anchorId={`rulebook-${book.id}`}>
      {note ?? null}
      {matrix.rows.length === 0 ? (
        <p style={mutedStyle}>No rules in this rulebook.</p>
      ) : stacked ? (
        <StackedMatrix
          matrix={matrix}
          interpretations={interpretations}
          openId={openId}
          onToggle={onToggle}
        />
      ) : (
        <div className="rf-scroll-x">
          <WideMatrix
            matrix={matrix}
            caption={`${book.label}: every factor, with the criterion that puts an account in each tier.`}
            interpretations={interpretations}
            openId={openId}
            onToggle={onToggle}
          />
        </div>
      )}
    </Card>
  );
}

function Interpretations(props: {
  readonly items: readonly InterpretationDto[];
}): ReactElement | null {
  const { items } = props;
  if (items.length === 0) return null;
  return (
    <Card
      title="Where the guidelines were ambiguous"
      aside={pluralize(items.length, 'decision')}
      anchorId="interpretations"
    >
      <dl style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
        {items.map((item) => (
          <div key={item.id} style={{ display: 'flex', flexDirection: 'column', gap: SPACE.xs }}>
            <dt style={{ fontWeight: 600 }}>
              <code style={{ ...codeStyle, marginRight: SPACE.sm }}>{item.id}</code>
              {item.title}
            </dt>
            <dd style={{ margin: 0 }}>
              <p style={{ ...mutedStyle, color: cssVar('ink') }}>{item.decision}</p>
              {item.affects.length > 0 ? (
                <p style={{ ...microStyle, marginTop: SPACE.xs }}>
                  Affects <code style={codeStyle}>{item.affects.join(', ')}</code>
                </p>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * PRD §10 /rules — the appetite guidelines as the criteria table they are:
 * one row per factor, one column per tier, the threshold in each cell, and the
 * rule id, raw condition, citation and interpretation behind each one.
 *
 * The open rule lives in `?rule=`, so a verdict elsewhere in the console can
 * link straight at the criterion that decided it.
 */
export function RulesPage(): ReactElement {
  const state = useApi((client) => client.getRules(), []);
  const [params, setParams] = useSearchParams();
  const stacked = useStacked();
  const openId = params.get('rule');

  const onToggle = useCallback(
    (id: string) => {
      const next = new URLSearchParams(params);
      if (next.get('rule') === id) next.delete('rule');
      else next.set('rule', id);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  // A deep link from a verdict lands on the rule, not the top of the page.
  useEffect(() => {
    if (openId === null || typeof document === 'undefined') return;
    const el = document.getElementById(`rule-${openId}`);
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
  }, [openId]);

  const header = (
    <header>
      <h1 style={titleStyle}>Rules</h1>
      <p style={{ ...mutedStyle, marginTop: SPACE.xs }}>
        Every criterion the engine tests, in the shape of the guideline table it came from.
      </p>
    </header>
  );

  if (state.data === null && state.loading) {
    return (
      <div style={pageStyle}>
        {header}
        <Skeleton label="Loading the rulebooks" lines={8} />
      </div>
    );
  }
  if (state.data === null) {
    return (
      <div style={pageStyle}>
        {header}
        <div role="alert">
          <p style={{ margin: 0 }}>
            The rulebooks could not be loaded{state.error ? `: ${state.error.message}` : '.'}
          </p>
          <button
            type="button"
            onClick={state.reload}
            style={{ minHeight: MIN_TOUCH_TARGET, marginTop: SPACE.sm }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const books = toRulebooks(state.data.rulebooks);
  const interpretations = (state.data.interpretations ?? []).filter(isInterpretation);

  // A rule flagged `extension` inside another rulebook still belongs with
  // Retrofit's own rules, which never touch the appetite score.
  const strays: RuleDto[] = [];
  const shown: RulebookDto[] = [];
  for (const book of books) {
    if (book.isExtension) {
      shown.push(book);
      continue;
    }
    const own = book.rules.filter((r) => r.extension !== true);
    strays.push(...book.rules.filter((r) => r.extension === true));
    shown.push({ ...book, rules: own });
  }
  const ordered = shown.map((book) =>
    book.isExtension ? { ...book, rules: [...book.rules, ...strays] } : book,
  );

  return (
    <div style={pageStyle}>
      {header}
      {ordered.length === 0 ? <p>No rulebooks are active.</p> : null}
      {ordered.map((book) => (
        <RulebookCard
          key={book.id}
          book={book}
          interpretations={interpretations}
          stacked={stacked}
          openId={openId}
          onToggle={onToggle}
          note={
            book.isExtension ? (
              <p style={{ ...mutedStyle, marginBottom: SPACE.md }}>
                Retrofit’s own rules. They can raise REFER or a contradiction and feed the premium,
                and they never touch the appetite score.
              </p>
            ) : null
          }
        />
      ))}
      <Interpretations items={interpretations} />
    </div>
  );
}
