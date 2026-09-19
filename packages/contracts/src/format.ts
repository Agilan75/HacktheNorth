/**
 * The ONE place presentation formatting lives (HELPERS.md). Implemented in
 * Run 0 and frozen: the API, the console and the phone app all import from
 * here, so a number is spelled the same way everywhere.
 *
 * Formatting only. Nothing here changes a number's value beyond the rounding
 * that display requires, and nothing here reads the clock, the locale or the
 * environment — every function is a pure function of its arguments.
 */

import type { Verdict } from '@retrofit/engine';

/** Everything is rendered US-English so output is identical on every machine. */
const LOCALE = 'en-US';

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** What every formatter prints for null, undefined, NaN or ±Infinity. */
export const EM_DASH = '—';

export interface MoneyOptions {
  /** Decimal places. Defaults to 0. */
  readonly decimals?: number;
  /** Prefix with `$`. Defaults to true. */
  readonly symbol?: boolean;
  /** Text for a missing value. Defaults to `EM_DASH`. */
  readonly fallback?: string;
  /** Render a negative as `($1,200)` instead of `-$1,200`. Defaults to false. */
  readonly accounting?: boolean;
}

/** `88000` -> `$88,000`. Plain USD, grouped, no abbreviation. */
export function formatMoney(value: number | null | undefined, options: MoneyOptions = {}): string {
  const { decimals = 0, symbol = true, fallback = EM_DASH, accounting = false } = options;
  if (!isFiniteNumber(value)) return fallback;
  const negative = value < 0;
  const body = Math.abs(value).toLocaleString(LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const withSymbol = symbol ? `$${body}` : body;
  if (!negative) return withSymbol;
  return accounting ? `(${withSymbol})` : `-${withSymbol}`;
}

export interface TivOptions {
  readonly fallback?: string;
  /** Force the unit instead of picking by magnitude. */
  readonly unit?: 'auto' | 'none' | 'K' | 'M' | 'B';
}

/**
 * Large money, abbreviated for tables: `65000000` -> `$65.0M`,
 * `703500` -> `$703.5K`, `1250000000` -> `$1.25B`. Exact below $1,000.
 */
export function formatTiv(value: number | null | undefined, options: TivOptions = {}): string {
  const { fallback = EM_DASH, unit = 'auto' } = options;
  if (!isFiniteNumber(value)) return fallback;
  const negative = value < 0;
  const abs = Math.abs(value);
  const chosen =
    unit !== 'auto'
      ? unit
      : abs >= 1_000_000_000
        ? 'B'
        : abs >= 1_000_000
          ? 'M'
          : abs >= 1_000
            ? 'K'
            : 'none';
  const divisor = chosen === 'B' ? 1e9 : chosen === 'M' ? 1e6 : chosen === 'K' ? 1e3 : 1;
  const decimals = chosen === 'none' ? 0 : chosen === 'B' ? 2 : 1;
  const scaled = abs / divisor;
  const body = scaled.toLocaleString(LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const suffix = chosen === 'none' ? '' : chosen;
  return `${negative ? '-' : ''}$${body}${suffix}`;
}

export interface PercentOptions {
  readonly decimals?: number;
  readonly fallback?: string;
  /**
   * How the input is expressed. `ratio` means 0..1 (the engine's `pctTiv*`
   * fields), `percent` means 0..100 (completeness, the appetite score).
   * Defaults to `ratio`.
   */
  readonly from?: 'ratio' | 'percent';
  /** Prefix a non-negative value with `+`. Defaults to false. */
  readonly signed?: boolean;
}

/** `0.4` -> `40%`. `formatPercent(88.9, { from: 'percent', decimals: 1 })` -> `88.9%`. */
export function formatPercent(
  value: number | null | undefined,
  options: PercentOptions = {},
): string {
  const { decimals = 0, fallback = EM_DASH, from = 'ratio', signed = false } = options;
  if (!isFiniteNumber(value)) return fallback;
  const pct = from === 'ratio' ? value * 100 : value;
  const body = pct.toLocaleString(LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const sign = signed && pct >= 0 ? '+' : '';
  return `${sign}${body}%`;
}

export interface ScoreOptions {
  readonly decimals?: number;
  readonly fallback?: string;
  /** Append `/100`. Defaults to false. */
  readonly outOf?: boolean;
}

/** `84` -> `84`. `83.996` -> `84.0` at one decimal. Never rounds to 100 from below. */
export function formatScore(value: number | null | undefined, options: ScoreOptions = {}): string {
  const { decimals = 0, fallback = EM_DASH, outOf = false } = options;
  if (!isFiniteNumber(value)) return fallback;
  const body = value.toLocaleString(LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return outOf ? `${body}/100` : body;
}

const VERDICT_LABEL: Readonly<Record<Verdict, string>> = {
  FIT: 'Fit',
  REFER: 'Refer',
  DOES_NOT_FIT: 'Does not fit',
};

/**
 * `DOES_NOT_FIT` -> `Does not fit`. Colour never carries meaning alone
 * (PRD §13), so every pill also prints this text.
 */
export function formatVerdict(verdict: Verdict | null | undefined): string {
  if (verdict === null || verdict === undefined) return EM_DASH;
  return VERDICT_LABEL[verdict] ?? String(verdict);
}

export type DateStyle = 'iso' | 'short' | 'long';

export interface DateOptions {
  readonly style?: DateStyle;
  readonly fallback?: string;
}

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/**
 * `2026-01-01` -> `Jan 1, 2026` (short) or `January 1, 2026` (long).
 * Parsed as a calendar date, never through `new Date`, so no timezone can
 * shift the day. Accepts a full ISO timestamp and uses its date part.
 */
export function formatDate(value: string | null | undefined, options: DateOptions = {}): string {
  const { style = 'short', fallback = EM_DASH } = options;
  if (typeof value !== 'string' || value.length < 10) return fallback;
  const datePart = value.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (match === null) return fallback;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return fallback;
  if (style === 'iso') return datePart;
  const names = style === 'long' ? MONTHS_LONG : MONTHS_SHORT;
  return `${names[month - 1]} ${day}, ${year}`;
}

export interface DistanceOptions {
  readonly decimals?: number;
  readonly fallback?: string;
  /** Unit of the input. Defaults to `km`. */
  readonly from?: 'km' | 'm' | 'mi';
  /** Unit to print. Defaults to `km`. */
  readonly to?: 'km' | 'm' | 'mi';
}

const KM_PER_MILE = 1.609344;

/** `2.4` -> `2.4 km`. Also converts: `formatDistance(3.2, { to: 'mi' })` -> `2.0 mi`. */
export function formatDistance(
  value: number | null | undefined,
  options: DistanceOptions = {},
): string {
  const { decimals = 1, fallback = EM_DASH, from = 'km', to = 'km' } = options;
  if (!isFiniteNumber(value)) return fallback;
  const km = from === 'km' ? value : from === 'm' ? value / 1000 : value * KM_PER_MILE;
  const out = to === 'km' ? km : to === 'm' ? km * 1000 : km / KM_PER_MILE;
  const places = to === 'm' ? 0 : decimals;
  const body = out.toLocaleString(LOCALE, {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
  return `${body} ${to}`;
}

const LOWERCASE_WORDS = new Set([
  'a',
  'an',
  'and',
  'at',
  'by',
  'for',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'vs',
]);

/**
 * `masonry_non_combustible` -> `Masonry Non Combustible`;
 * `new business` -> `New Business`. Small words stay lower case unless first.
 */
export function titleCase(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  const words = value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && LOWERCASE_WORDS.has(lower)) return lower;
      const first = lower.charAt(0).toUpperCase();
      return `${first}${lower.slice(1)}`;
    })
    .join(' ');
}

/**
 * `pluralize(1, 'building')` -> `1 building`; `pluralize(3, 'building')` ->
 * `3 buildings`. Pass `plural` for irregulars. `includeCount: false` returns
 * the word alone.
 */
export function pluralize(
  count: number | null | undefined,
  singular: string,
  plural?: string,
  options: { readonly includeCount?: boolean } = {},
): string {
  const { includeCount = true } = options;
  const n = isFiniteNumber(count) ? count : 0;
  const word = Math.abs(n) === 1 ? singular : (plural ?? `${singular}s`);
  return includeCount ? `${n.toLocaleString(LOCALE)} ${word}` : word;
}

/**
 * Shortens a broker quote for a card without ever changing its opening words.
 * Cuts on a word boundary when one is near the limit, and appends `…`.
 * A quote shorter than the limit comes back untouched, so the "the quote must
 * appear in the source" check still runs against the original.
 */
export function truncateQuote(
  value: string | null | undefined,
  maxChars = 160,
  ellipsis = '…',
): string {
  if (typeof value !== 'string') return '';
  const text = value.trim().replace(/\s+/g, ' ');
  if (maxChars <= 0) return '';
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(' ');
  const body = lastSpace > maxChars * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${body.trimEnd()}${ellipsis}`;
}
