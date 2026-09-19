/**
 * Step 5 of PRD §7.5: adapt. Zero results -> retry with `$elemMatch` in place
 * of a dot-path, or drop the narrowest filter, and record that it did.
 * Body owned by Run 1 unit F10. Decisions: docs/decisions/F10.md.
 *
 * Both adaptations are measured behaviour of the live handler, not guesses
 * (LIVE_DATA_FACTS.md): a dot-path through an array silently matches nothing
 * (`exposure_units.location.state: CA` -> 0 rows, the `$elemMatch` form -> 47),
 * and `over` silently fails to group, so server-side aggregation is declined.
 */
import type { AdaptationKind, QueryClause, QueryPayload } from '../types';

export interface Adaptation {
  readonly kind: AdaptationKind;
  readonly payload: QueryPayload;
  readonly why: string;
}

/**
 * The trace note written whenever the planner declines Federato's `over`
 * (server-side GROUP BY). Written for an underwriter, not an engineer.
 */
export const OVER_DECLINED_NOTE =
  "Server-side aggregation declined. Federato's query language documents `over` as a " +
  'GROUP BY, but the live handler does not actually group: it returns one row per record, ' +
  '`$count` comes back as 1 on every row, and `$sum` returns the same constant (11,063,900) ' +
  'that matches neither a line subtotal nor the book total (128,011,000). So the agent fetched ' +
  'the individual records and Retrofit adds them up itself — every total on this page can be ' +
  'traced back to the rows it came from.';

/**
 * Removes `over` from a payload before it is sent and returns the trace note
 * explaining why. `note` is null when the payload had no `over`.
 */
export function declineServerAggregation(payload: QueryPayload): {
  readonly payload: QueryPayload;
  readonly note: string | null;
} {
  if (payload.over === undefined) return { payload, note: null };
  const { over: _over, ...rest } = payload;
  return { payload: rest, note: OVER_DECLINED_NOTE };
}

/* -------------------------------------------------------------------------- */
/* private helpers                                                            */
/* -------------------------------------------------------------------------- */

const COMBINATORS = new Set(['$and', '$or', '$not']);

const OPERATOR_KEYS = new Set([
  '$eq',
  '$ne',
  '$exists',
  '$gt',
  '$gte',
  '$lt',
  '$lte',
  '$in',
  '$nin',
  '$contains',
  '$elemMatch',
]);

type Node = QueryClause[string];
type MutableClause = Record<string, unknown>;

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOperatorBag(value: unknown): value is Readonly<Record<string, unknown>> {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((k) => OPERATOR_KEYS.has(k));
}

function isEmptyClause(clause: QueryClause | undefined): boolean {
  return clause === undefined || Object.keys(clause).every((k) => clause[k] === undefined);
}

/** The shortest entry of `arrayPaths` that `path` passes *through* (not ends at). */
function arrayBoundary(path: string, arrayPaths: readonly string[]): string | null {
  let best: string | null = null;
  for (const p of arrayPaths) {
    if (p === '' || !path.startsWith(`${p}.`)) continue;
    if (best === null || p.length < best.length) best = p;
  }
  return best;
}

/** Array paths below `boundary`, re-rooted relative to it. */
function relativeArrayPaths(boundary: string, arrayPaths: readonly string[]): string[] {
  const prefix = `${boundary}.`;
  return arrayPaths.filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length));
}

/**
 * Builds the nested clause for a path *inside* an `$elemMatch`: plain nested
 * objects for record segments (the verified live form, `{location: {state}}`),
 * and another `$elemMatch` at every further array boundary.
 */
function nestInside(path: string, value: Node, arrayPaths: readonly string[]): QueryClause {
  const boundary = arrayBoundary(path, arrayPaths);
  if (boundary === null) {
    const segments = path.split('.');
    let node: unknown = value;
    for (let i = segments.length - 1; i >= 0; i -= 1) {
      node = { [segments[i] as string]: node };
    }
    return node as QueryClause;
  }
  const rest = path.slice(boundary.length + 1);
  const inner = nestInside(rest, value, relativeArrayPaths(boundary, arrayPaths));
  const head: Node = { $elemMatch: inner };
  return nestInside(boundary, head, []);
}

/** Adds `key: node` to `out`; a colliding key goes into `$and` so no condition is lost. */
function addCondition(out: MutableClause, key: string, node: unknown): void {
  if (!(key in out)) {
    out[key] = node;
    return;
  }
  const and = Array.isArray(out.$and) ? [...(out.$and as QueryClause[])] : [];
  and.push({ [key]: node } as QueryClause);
  out.$and = and;
}

function swapClause(clause: QueryClause, arrayPaths: readonly string[]): QueryClause | null {
  let changed = false;
  const out: MutableClause = {};
  const extraAnd: QueryClause[] = [];
  for (const key of Object.keys(clause)) {
    const node = clause[key];
    if (node === undefined) continue;
    if (key === '$and' || key === '$or') {
      const list = (node as readonly QueryClause[]).map((c) => {
        const swapped = swapClause(c, arrayPaths);
        if (swapped !== null) changed = true;
        return swapped ?? c;
      });
      if (key === '$and') extraAnd.push(...list);
      else out.$or = list;
      continue;
    }
    if (key === '$not') {
      const swapped = swapClause(node as QueryClause, arrayPaths);
      if (swapped !== null) changed = true;
      out.$not = swapped ?? node;
      continue;
    }
    const boundary = arrayBoundary(key, arrayPaths);
    if (boundary === null) {
      addCondition(out, key, node);
      continue;
    }
    changed = true;
    const rest = key.slice(boundary.length + 1);
    const inner = nestInside(rest, node, relativeArrayPaths(boundary, arrayPaths));
    addCondition(out, boundary, { $elemMatch: inner });
  }
  if (!changed) return null;
  if (extraAnd.length > 0) {
    const existing = Array.isArray(out.$and) ? (out.$and as QueryClause[]) : [];
    out.$and = [...extraAnd, ...existing];
  }
  return out as QueryClause;
}

/* -------------------------------------------------------------------------- */
/* selectivity                                                                */
/* -------------------------------------------------------------------------- */

/**
 * How narrow one condition is; higher = narrower. A fixed ordinal ladder, not
 * a statistic: the planner has no row counts at adapt time, only the payload.
 */
function operatorScore(ops: Readonly<Record<string, unknown>>): number {
  let best = 0;
  let range = 0;
  for (const [op, v] of Object.entries(ops)) {
    let s = 0;
    switch (op) {
      case '$eq':
        s = v === null ? 60 : 100;
        break;
      case '$in':
        s = Array.isArray(v) ? Math.max(55, 95 - v.length) : 90;
        break;
      case '$contains':
        s = 80;
        break;
      case '$gt':
      case '$gte':
      case '$lt':
      case '$lte':
        range += 1;
        s = 50;
        break;
      case '$elemMatch':
        s = clauseScore(v as QueryClause) + 1;
        break;
      case '$exists':
        s = v === false ? 30 : 20;
        break;
      case '$ne':
      case '$nin':
        s = 10;
        break;
      default:
        s = 0;
    }
    if (s > best) best = s;
  }
  if (range >= 2 && best < 70) best = 70;
  return best;
}

function nodeScore(node: unknown): number {
  if (node === null) return 60;
  if (Array.isArray(node)) return 100;
  if (!isPlainObject(node)) return 100;
  if (isOperatorBag(node)) return operatorScore(node);
  return clauseScore(node as QueryClause);
}

/** A clause is as narrow as its narrowest condition (conditions are ANDed). */
function clauseScore(clause: QueryClause): number {
  let best = 0;
  for (const key of Object.keys(clause)) {
    const node = clause[key];
    if (node === undefined) continue;
    let s: number;
    if (key === '$and') s = Math.max(0, ...(node as readonly QueryClause[]).map(clauseScore));
    else if (key === '$or') {
      const list = node as readonly QueryClause[];
      s = list.length === 0 ? 0 : Math.min(...list.map(clauseScore));
    } else if (key === '$not') s = 10;
    else s = nodeScore(node);
    if (s > best) best = s;
  }
  return best;
}

interface Candidate {
  readonly score: number;
  /** Tie-break: deeper paths are narrower. */
  readonly depth: number;
  readonly label: string;
  readonly remove: () => QueryClause;
}

function candidatesOf(clause: QueryClause): Candidate[] {
  const out: Candidate[] = [];
  for (const key of Object.keys(clause)) {
    const node = clause[key];
    if (node === undefined) continue;
    if (key === '$and') {
      const list = node as readonly QueryClause[];
      list.forEach((item, i) => {
        out.push({
          score: clauseScore(item),
          depth: Math.max(0, ...Object.keys(item).map((k) => k.split('.').length)),
          label: describeCondition(item),
          remove: () => {
            const next: MutableClause = { ...clause };
            const rest = list.filter((_, j) => j !== i);
            if (rest.length === 0) delete next.$and;
            else next.$and = rest;
            return next as QueryClause;
          },
        });
      });
      continue;
    }
    out.push({
      score: COMBINATORS.has(key) ? clauseScore({ [key]: node } as QueryClause) : nodeScore(node),
      depth: key.split('.').length,
      label: describeCondition({ [key]: node } as QueryClause),
      remove: () => {
        const next: MutableClause = { ...clause };
        delete next[key];
        return next as QueryClause;
      },
    });
  }
  return out;
}

function pickNarrowest(candidates: readonly Candidate[]): Candidate | null {
  let best: Candidate | null = null;
  for (const c of candidates) {
    if (
      best === null ||
      c.score > best.score ||
      (c.score === best.score && c.depth > best.depth)
    ) {
      best = c;
    }
  }
  return best;
}

function describeCondition(clause: QueryClause): string {
  const text = JSON.stringify(clause);
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

/* -------------------------------------------------------------------------- */
/* public API                                                                 */
/* -------------------------------------------------------------------------- */

/** `{'a.b.c': v}` -> `{a: {$elemMatch: {b: {c: v}}}}` at the array boundary. */
export function swapToElemMatch(
  clause: QueryClause,
  arrayPaths: readonly string[],
): QueryClause | null {
  if (arrayPaths.length === 0) return null;
  return swapClause(clause, arrayPaths);
}

/**
 * Removes the single most selective condition, so the query widens by one step.
 * Returns null when there is at most one condition: widening past that would
 * be an unfiltered query that no longer answers the goal it was planned for.
 */
export function dropNarrowestFilter(clause: QueryClause): QueryClause | null {
  const candidates = candidatesOf(clause);
  if (candidates.length <= 1) return null;
  const pick = pickNarrowest(candidates);
  return pick === null ? null : pick.remove();
}

/**
 * Returns the next thing to try, or null when nothing is left to adapt.
 * Order: the `$elemMatch` swap (no loss of meaning) first, then one drop of
 * the narrowest condition (loses meaning, so it is tried once and last).
 */
export function nextAdaptation(
  payload: QueryPayload,
  attempted: readonly AdaptationKind[],
  arrayPaths: readonly string[],
): Adaptation | null {
  const declined = declineServerAggregation(payload);
  const base = declined.payload;
  const overSuffix = declined.note === null ? '' : ` ${declined.note}`;

  if (!attempted.includes('elem_match_swap')) {
    const where = base.where === undefined ? null : swapToElemMatch(base.where, arrayPaths);
    const filter = base.filter === undefined ? null : swapToElemMatch(base.filter, arrayPaths);
    if (where !== null || filter !== null) {
      const crossed = [
        ...crossedPaths(base.where, arrayPaths),
        ...crossedPaths(base.filter, arrayPaths),
      ];
      const next: QueryPayload = {
        ...base,
        ...(where !== null ? { where } : {}),
        ...(filter !== null ? { filter } : {}),
      };
      return {
        kind: 'elem_match_swap',
        payload: next,
        why:
          `The query came back empty. ${formatList(crossed)} ${crossed.length === 1 ? 'reaches' : 'reach'} ` +
          "through a list, and Federato's handler silently matches nothing when a dotted path " +
          'crosses a list (measured on the live data: `exposure_units.location.state = CA` finds 0 ' +
          'policies; the same condition written with `$elemMatch` finds 47). Retried the identical ' +
          'condition with `$elemMatch`, which checks each item in the list — nothing was loosened.' +
          overSuffix,
      };
    }
  }

  if (!attempted.includes('drop_narrowest_filter')) {
    const pool: { stage: 'where' | 'filter'; candidate: Candidate }[] = [];
    // Never drop the only condition left in the whole payload.
    const whereCands = base.where === undefined ? [] : candidatesOf(base.where);
    const filterCands = base.filter === undefined ? [] : candidatesOf(base.filter);
    if (whereCands.length + filterCands.length > 1) {
      for (const c of filterCands) pool.push({ stage: 'filter', candidate: c });
      for (const c of whereCands) pool.push({ stage: 'where', candidate: c });
      let best: (typeof pool)[number] | null = null;
      for (const entry of pool) {
        const c = entry.candidate;
        if (
          best === null ||
          c.score > best.candidate.score ||
          (c.score === best.candidate.score && c.depth > best.candidate.depth)
        ) {
          best = entry;
        }
      }
      if (best !== null) {
        const widened = best.candidate.remove();
        const { [best.stage]: _dropped, ...rest } = base;
        const next: QueryPayload = isEmptyClause(widened)
          ? rest
          : { ...rest, [best.stage]: widened };
        return {
          kind: 'drop_narrowest_filter',
          payload: next,
          why:
            'The query still came back empty. Removed its narrowest condition, ' +
            `${best.candidate.label} (from \`${best.stage}\`), and kept every other one, so the ` +
            'search widens by exactly one step. Rows returned by this retry were not checked ' +
            'against that condition; the rules that depend on it evaluate it themselves.' +
            overSuffix,
        };
      }
    }
  }

  return null;
}

function crossedPaths(clause: QueryClause | undefined, arrayPaths: readonly string[]): string[] {
  if (clause === undefined) return [];
  const out: string[] = [];
  for (const key of Object.keys(clause)) {
    const node = clause[key];
    if (node === undefined) continue;
    if (key === '$and' || key === '$or') {
      for (const c of node as readonly QueryClause[]) out.push(...crossedPaths(c, arrayPaths));
    } else if (key === '$not') {
      out.push(...crossedPaths(node as QueryClause, arrayPaths));
    } else if (arrayBoundary(key, arrayPaths) !== null) {
      out.push(key);
    }
  }
  return out;
}

function formatList(paths: readonly string[]): string {
  const quoted = paths.map((p) => `\`${p}\``);
  if (quoted.length === 0) return 'A filter';
  if (quoted.length === 1) return `The filter on ${quoted[0]}`;
  return `The filters on ${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
}
