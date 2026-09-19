import type { CSSProperties, ReactElement } from 'react';

import type { RulesResponseDto } from '@retrofit/contracts';
import { formatPercent, pluralize, titleCase } from '@retrofit/contracts';
import { cssVar, RADIUS, SPACE, TIER_LABELS } from '@retrofit/design';

import { useApi } from '../api/useApi.js';
import { Badge } from '../components/atoms/Badge.js';
import { Card } from '../components/atoms/Card.js';
import { CitationQuote } from '../components/atoms/CitationQuote.js';
import { Skeleton } from '../components/atoms/Skeleton.js';
import { Tooltip } from '../components/Tooltip.js';

type RulebookDto = RulesResponseDto['rulebooks'][number];
type RuleDto = RulebookDto['rules'][number];
type ConditionDto = RuleDto['when'][number];

/** PRD 6.6 appetite table order; any other factor follows in rulebook order. */
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

const OP_TEXT: Readonly<Record<string, string>> = {
  lt: '<',
  lte: '≤',
  gt: '>',
  gte: '≥',
  eq: '=',
  neq: '≠',
  in: 'is one of',
  notin: 'is not one of',
  exists: 'is present',
  missing: 'is missing',
};

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
      label: typeof item.label === 'string' && item.label.length > 0 ? item.label : titleCase(item.id),
      version: typeof item.version === 'string' ? item.version : '',
      isExtension: item.isExtension === true || item.id === 'extensions',
      rules: (item.rules as readonly unknown[]).filter(isRule),
    });
  }
  return books;
}

function formatConditionValue(value: ConditionDto['value']): string {
  if (value === undefined) return '';
  if (Array.isArray(value)) return value.map((v) => String(v)).join(', ');
  return String(value);
}

function formatCondition(condition: ConditionDto): string {
  const op = OP_TEXT[condition.op] ?? condition.op;
  if (condition.op === 'exists' || condition.op === 'missing') return `${condition.field} ${op}`;
  return `${condition.field} ${op} ${formatConditionValue(condition.value)}`;
}

function tierLabel(tier: string): string {
  return (TIER_LABELS as Readonly<Record<string, string>>)[tier] ?? titleCase(tier);
}

interface FactorGroup {
  readonly factor: string;
  readonly rules: readonly RuleDto[];
  /** The factor's weight when every weighted rule agrees on one; else null. */
  readonly weight: number | null;
}

function groupByFactor(rules: readonly RuleDto[]): readonly FactorGroup[] {
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
  return factors.map((factor) => {
    const list = byFactor.get(factor) ?? [];
    const weights = new Set(list.map((r) => r.weight).filter((w): w is number => typeof w === 'number'));
    return { factor, rules: list, weight: weights.size === 1 ? [...weights][0]! : null };
  });
}

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

const factorStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: SPACE.md,
  marginTop: SPACE.lg,
};

const factorHeadingStyle: CSSProperties = {
  margin: 0,
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  gap: SPACE.sm,
  fontSize: cssVar('size-body'),
  lineHeight: cssVar('leading-body'),
  fontWeight: 600,
};

const ruleListStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
  gap: SPACE.md,
};

const ruleStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: SPACE.sm,
  padding: SPACE.lg,
  border: `${cssVar('border-width')} solid ${cssVar('border-color')}`,
  borderRadius: RADIUS.card,
};

const metaStyle: CSSProperties = {
  margin: 0,
  display: 'grid',
  gridTemplateColumns: 'max-content 1fr',
  columnGap: SPACE.md,
  rowGap: SPACE.xs,
  fontSize: cssVar('size-small'),
  lineHeight: cssVar('leading-small'),
};

const dtStyle: CSSProperties = { color: cssVar('muted-deep') };
const ddStyle: CSSProperties = { margin: 0 };
const codeStyle: CSSProperties = { fontSize: cssVar('size-small') };

function RuleCard(props: { readonly rule: RuleDto; readonly showWeight: boolean }): ReactElement {
  const { rule, showWeight } = props;
  const citation = rule.citation;
  return (
    <li style={ruleStyle} aria-label={`Rule ${rule.id}`} data-rule-id={rule.id}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.sm, alignItems: 'baseline' }}>
        <code style={{ ...codeStyle, fontWeight: 600 }}>{rule.id}</code>
        <Badge label={tierLabel(rule.tier)} tone={rule.tier === 'not_acceptable' ? 'attention' : 'neutral'} />
        {rule.extension === true ? <Badge label="Retrofit extension" tone="quiet" /> : null}
      </div>
      <dl style={metaStyle}>
        <dt style={dtStyle}>When</dt>
        <dd style={ddStyle}>
          {rule.when.length === 0 ? (
            'Always'
          ) : (
            <code style={codeStyle}>{rule.when.map(formatCondition).join(' AND ')}</code>
          )}
        </dd>
        {showWeight ? (
          <>
            <dt style={dtStyle}>Weight</dt>
            <dd style={ddStyle}>
              {typeof rule.weight === 'number' ? formatPercent(rule.weight) : 'Not weighted'}
            </dd>
          </>
        ) : null}
        {rule.ratingFactor ? (
          <>
            <dt style={dtStyle}>Rating factor</dt>
            <dd style={ddStyle}>
              <code style={codeStyle}>{rule.ratingFactor}</code>
            </dd>
          </>
        ) : null}
      </dl>
      <CitationQuote citation={{ document: `${citation.doc} · ${citation.section}`, quote: citation.quote }} />
      {rule.interpretation ? (
        <p style={{ margin: 0, fontSize: cssVar('size-small'), lineHeight: cssVar('leading-small') }}>
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
    </li>
  );
}

function FactorSection(props: {
  readonly group: FactorGroup;
  readonly bookId: string;
  readonly showWeight: boolean;
}): ReactElement {
  const { group, bookId, showWeight } = props;
  const headingId = `rf-rules-${bookId}-${group.factor}`.replace(/[^a-zA-Z0-9_-]+/g, '-');
  return (
    <section style={factorStyle} aria-labelledby={headingId}>
      <h3 id={headingId} style={factorHeadingStyle}>
        <span>{titleCase(group.factor)}</span>
        {showWeight && group.weight !== null ? (
          <span style={{ ...mutedStyle, fontWeight: 400 }}>Weight {formatPercent(group.weight)}</span>
        ) : null}
        <span style={{ ...mutedStyle, fontWeight: 400 }}>{pluralize(group.rules.length, 'rule')}</span>
      </h3>
      <ul style={ruleListStyle}>
        {group.rules.map((rule) => (
          <RuleCard key={rule.id} rule={rule} showWeight={showWeight} />
        ))}
      </ul>
    </section>
  );
}

function RulebookCard(props: {
  readonly id: string;
  readonly title: string;
  readonly version: string;
  readonly rules: readonly RuleDto[];
  readonly note?: ReactElement;
  readonly showWeight: boolean;
}): ReactElement {
  const { id, title, version, rules, note, showWeight } = props;
  const groups = groupByFactor(rules);
  const aside = [version ? `v${version}` : null, pluralize(rules.length, 'rule')].filter(Boolean).join(' · ');
  return (
    <Card title={title} aside={aside} anchorId={`rulebook-${id}`}>
      {note ?? null}
      {groups.length === 0 ? <p style={mutedStyle}>No rules in this rulebook.</p> : null}
      {groups.map((group) => (
        <FactorSection key={group.factor} group={group} bookId={id} showWeight={showWeight} />
      ))}
    </Card>
  );
}

/**
 * PRD 10 /rules - rule cards by factor with citation, quote, weight and interpretation; extension rules in a separate labelled group.
 *
 * Stub frozen by W0-4. Unit C13 replaces this body only.
 * Route registration lives in src/App.tsx and is frozen.
 */
export function RulesPage(): ReactElement {
  const state = useApi((client) => client.getRules(), []);

  const header = (
    <header>
      <h1 style={titleStyle}>Rules</h1>
      <p style={{ ...mutedStyle, marginTop: SPACE.xs }}>
        Every active rule, grouped by factor, with the document, section and exact quote it comes from. Weights apply
        to the <Tooltip term="Appetite">appetite</Tooltip> score; Retrofit’s own extension rules are listed separately
        and never change it.
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
          <button type="button" onClick={state.reload} style={{ minHeight: 44, marginTop: SPACE.sm }}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  const books = toRulebooks(state.data.rulebooks);
  const primary = books.filter((b) => !b.isExtension);
  const extensionRules: RuleDto[] = [];
  const extensionVersions: string[] = [];
  for (const book of books) {
    if (book.isExtension) {
      extensionRules.push(...book.rules);
      if (book.version) extensionVersions.push(book.version);
    } else {
      // A rule flagged `extension` inside another rulebook still belongs with Retrofit's own rules.
      extensionRules.push(...book.rules.filter((r) => r.extension === true));
    }
  }

  return (
    <div style={pageStyle}>
      {header}
      {books.length === 0 ? <p>No rulebooks are active.</p> : null}
      {primary.map((book) => (
        <RulebookCard
          key={book.id}
          id={book.id}
          title={book.label}
          version={book.version}
          rules={book.rules.filter((r) => r.extension !== true)}
          showWeight={book.rules.some((r) => typeof r.weight === 'number')}
        />
      ))}
      {extensionRules.length > 0 ? (
        <RulebookCard
          id="extensions"
          title="Retrofit extension rules (ours, not Federato’s)"
          version={extensionVersions.length === 1 ? extensionVersions[0]! : ''}
          rules={extensionRules}
          showWeight={false}
          note={
            <p style={mutedStyle}>
              These rules are Retrofit’s own, not from Federato’s appetite guidelines. They can raise REFER or a
              contradiction and feed the premium, and they never touch the appetite score.
            </p>
          }
        />
      ) : null}
    </div>
  );
}
