/**
 * The TIV and premium appetite bands, read out of `GET /rules` rather than
 * hard-coded: the `AG-TIV-*` and `AG-PREM-*` rules carry their own edges, so
 * the terrain's cliffs sit exactly where the rulebook puts them and each one
 * can name the rule that made it.
 *
 * Nothing here scores anything. It turns a set of AND-ed numeric conditions
 * into the intervals they cut the axis into, with the tier and rule id of the
 * rule that owns each interval. `FALLBACK_BANDS` covers an API that predates
 * the rules route; it repeats the numbers in `packages/engine/src/constants.ts`
 * and is reported so the page can say the edges are built in.
 */

/** Tier value as the engine scores it (constants.ts TIER_VALUE). `refer` never reaches these two factors. */
export const TIER_VALUE: Readonly<Record<string, number>> = {
  not_acceptable: 0,
  acceptable: 0.6,
  refer: 0.6,
  target: 1,
};

export type BandTier = 'target' | 'acceptable' | 'not_acceptable';

export interface Band {
  /** Inclusive lower edge; `-Infinity` for the open end. */
  readonly from: number;
  /** Exclusive upper edge; `Infinity` for the open end. */
  readonly to: number;
  readonly tier: BandTier;
  readonly tierValue: number;
  /** The rule that puts this interval in that tier, e.g. `AG-TIV-NA`. */
  readonly ruleId: string;
}

export interface AppetiteBands {
  readonly tiv: readonly Band[];
  readonly premium: readonly Band[];
  /** True when the rules route could not be read and the built-in numbers are in use. */
  readonly fallback: boolean;
}

/* -------------------------------------------------------------------------- */
/* Narrowing the untyped rules payload                                        */
/* -------------------------------------------------------------------------- */

interface RuleLike {
  readonly id: string;
  readonly factor: string;
  readonly tier: string;
  readonly when: readonly { readonly field: string; readonly op: string; readonly value?: unknown }[];
}

const NUMERIC_OPS = new Set(['lt', 'lte', 'gt', 'gte']);

function isRuleLike(value: unknown): value is RuleLike {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Partial<RuleLike>;
  return (
    typeof r.id === 'string' &&
    typeof r.factor === 'string' &&
    typeof r.tier === 'string' &&
    Array.isArray(r.when) &&
    r.when.every((c) => typeof c === 'object' && c !== null && typeof (c as { field?: unknown }).field === 'string')
  );
}

function rulesOf(rulebooks: readonly unknown[]): RuleLike[] {
  const out: RuleLike[] = [];
  for (const book of rulebooks) {
    if (typeof book !== 'object' || book === null) continue;
    // Extensions never move the appetite score, so they never shape the terrain.
    if ((book as { isExtension?: unknown }).isExtension === true) continue;
    const rules = (book as { rules?: unknown }).rules;
    if (!Array.isArray(rules)) continue;
    for (const rule of rules) if (isRuleLike(rule)) out.push(rule);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Conditions -> intervals                                                    */
/* -------------------------------------------------------------------------- */

function satisfies(rule: RuleLike, field: string, value: number): boolean {
  const conditions = rule.when.filter((c) => c.field === field && NUMERIC_OPS.has(c.op));
  if (conditions.length === 0) return false;
  return conditions.every((c) => {
    const edge = typeof c.value === 'number' ? c.value : Number.NaN;
    if (!Number.isFinite(edge)) return false;
    switch (c.op) {
      case 'lt':
        return value < edge;
      case 'lte':
        return value <= edge;
      case 'gt':
        return value > edge;
      default:
        return value >= edge;
    }
  });
}

function tierOf(tier: string): BandTier | null {
  return tier === 'target' || tier === 'acceptable' || tier === 'not_acceptable' ? tier : null;
}

/** A point inside `(from, to)` that no edge sits on, so the owning rule is unambiguous. */
function probe(from: number, to: number): number {
  if (Number.isFinite(from) && Number.isFinite(to)) return (from + to) / 2;
  if (Number.isFinite(to)) return to > 0 ? to / 2 : to - 1;
  if (Number.isFinite(from)) return from > 0 ? from * 1.5 : from + 1;
  return 0;
}

/**
 * Cut one axis at every edge its rules name, then ask each rule which interval
 * it owns. Adjacent intervals with the same rule are merged.
 */
export function bandsFor(rules: readonly RuleLike[], factor: string, field: string): Band[] {
  const own = rules.filter((r) => r.factor === factor && tierOf(r.tier) !== null);
  const edges = new Set<number>();
  for (const rule of own) {
    for (const c of rule.when) {
      if (c.field === field && NUMERIC_OPS.has(c.op) && typeof c.value === 'number' && Number.isFinite(c.value)) {
        edges.add(c.value);
      }
    }
  }
  const cuts = [...edges].sort((a, b) => a - b);
  if (cuts.length === 0) return [];

  const bounds = [Number.NEGATIVE_INFINITY, ...cuts, Number.POSITIVE_INFINITY];
  const bands: Band[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const from = bounds[i]!;
    const to = bounds[i + 1]!;
    const at = probe(from, to);
    const rule = own.find((r) => satisfies(r, field, at));
    if (rule === undefined) continue;
    const tier = tierOf(rule.tier)!;
    const previous = bands[bands.length - 1];
    if (previous !== undefined && previous.ruleId === rule.id && previous.to === from) {
      bands[bands.length - 1] = { ...previous, to };
      continue;
    }
    bands.push({ from, to, tier, tierValue: TIER_VALUE[tier] ?? 0, ruleId: rule.id });
  }
  return bands;
}

/** The engine's own numbers (constants.ts), used only when `/rules` cannot be read. */
export const FALLBACK_BANDS: AppetiteBands = {
  tiv: [
    { from: Number.NEGATIVE_INFINITY, to: 50_000_000, tier: 'acceptable', tierValue: 0.6, ruleId: 'AG-TIV-A-LOW' },
    { from: 50_000_000, to: 100_000_000, tier: 'target', tierValue: 1, ruleId: 'AG-TIV-T' },
    { from: 100_000_000, to: 150_000_000, tier: 'acceptable', tierValue: 0.6, ruleId: 'AG-TIV-A-HIGH' },
    { from: 150_000_000, to: Number.POSITIVE_INFINITY, tier: 'not_acceptable', tierValue: 0, ruleId: 'AG-TIV-NA' },
  ],
  premium: [
    { from: Number.NEGATIVE_INFINITY, to: 50_000, tier: 'not_acceptable', tierValue: 0, ruleId: 'AG-PREM-NA-LOW' },
    { from: 50_000, to: 75_000, tier: 'acceptable', tierValue: 0.6, ruleId: 'AG-PREM-A-LOW' },
    { from: 75_000, to: 100_000, tier: 'target', tierValue: 1, ruleId: 'AG-PREM-T' },
    { from: 100_000, to: 175_000, tier: 'acceptable', tierValue: 0.6, ruleId: 'AG-PREM-A-HIGH' },
    { from: 175_000, to: Number.POSITIVE_INFINITY, tier: 'not_acceptable', tierValue: 0, ruleId: 'AG-PREM-NA-HIGH' },
  ],
  fallback: true,
};

/** Bands from the `/rules` payload, or the built-in ones when it yields too few to draw. */
export function appetiteBands(rulebooks: readonly unknown[] | null | undefined): AppetiteBands {
  const rules = rulesOf(rulebooks ?? []);
  const tiv = bandsFor(rules, 'tiv', 'totalTiv');
  const premium = bandsFor(rules, 'total_premium', 'quotedPremium');
  if (tiv.length < 2 || premium.length < 2) return FALLBACK_BANDS;
  return { tiv, premium, fallback: false };
}

/** The band a value falls in, or null when it is unknown. */
export function bandAt(bands: readonly Band[], value: number | null): Band | null {
  if (value === null || !Number.isFinite(value)) return null;
  return bands.find((b) => value >= b.from && value < b.to) ?? null;
}
