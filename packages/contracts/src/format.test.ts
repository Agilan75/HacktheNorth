/** Tests for the shared formatters. Owned by W0-3; they are implemented now. */
import { describe, expect, it } from 'vitest';
import {
  EM_DASH,
  formatDate,
  formatDistance,
  formatMoney,
  formatPercent,
  formatScore,
  formatTiv,
  formatVerdict,
  pluralize,
  titleCase,
  truncateQuote,
} from './format';

describe('formatMoney', () => {
  it('groups and prefixes', () => {
    expect(formatMoney(88000)).toBe('$88,000');
    expect(formatMoney(703500)).toBe('$703,500');
    expect(formatMoney(0)).toBe('$0');
  });

  it('honours decimals, symbol and accounting style', () => {
    expect(formatMoney(1234.567, { decimals: 2 })).toBe('$1,234.57');
    expect(formatMoney(1200, { symbol: false })).toBe('1,200');
    expect(formatMoney(-1200)).toBe('-$1,200');
    expect(formatMoney(-1200, { accounting: true })).toBe('($1,200)');
  });

  it('falls back on every non-finite input', () => {
    expect(formatMoney(null)).toBe(EM_DASH);
    expect(formatMoney(undefined)).toBe(EM_DASH);
    expect(formatMoney(Number.NaN)).toBe(EM_DASH);
    expect(formatMoney(Number.POSITIVE_INFINITY)).toBe(EM_DASH);
    expect(formatMoney(null, { fallback: 'n/a' })).toBe('n/a');
  });
});

describe('formatTiv', () => {
  it('picks a unit by magnitude', () => {
    expect(formatTiv(65_000_000)).toBe('$65.0M');
    expect(formatTiv(703_500)).toBe('$703.5K');
    expect(formatTiv(1_250_000_000)).toBe('$1.25B');
    expect(formatTiv(950)).toBe('$950');
  });

  it('can be forced to a unit', () => {
    expect(formatTiv(65_000_000, { unit: 'K' })).toBe('$65,000.0K');
    expect(formatTiv(null)).toBe(EM_DASH);
  });
});

describe('formatPercent', () => {
  it('reads ratios by default and percents on request', () => {
    expect(formatPercent(0.4)).toBe('40%');
    expect(formatPercent(0.555, { decimals: 1 })).toBe('55.5%');
    expect(formatPercent(88.888, { from: 'percent', decimals: 1 })).toBe('88.9%');
    expect(formatPercent(0.02, { signed: true, decimals: 0 })).toBe('+2%');
    expect(formatPercent(null)).toBe(EM_DASH);
  });
});

describe('formatScore', () => {
  it('rounds for display only', () => {
    expect(formatScore(84)).toBe('84');
    expect(formatScore(83.996, { decimals: 1 })).toBe('84.0');
    expect(formatScore(96, { outOf: true })).toBe('96/100');
    expect(formatScore(undefined)).toBe(EM_DASH);
  });
});

describe('formatVerdict', () => {
  it('always gives text, because colour never carries meaning alone', () => {
    expect(formatVerdict('FIT')).toBe('Fit');
    expect(formatVerdict('REFER')).toBe('Refer');
    expect(formatVerdict('DOES_NOT_FIT')).toBe('Does not fit');
    expect(formatVerdict(null)).toBe(EM_DASH);
  });
});

describe('formatDate', () => {
  it('never shifts the day across a timezone', () => {
    expect(formatDate('2026-01-01')).toBe('Jan 1, 2026');
    expect(formatDate('2026-01-01T23:59:59.000Z')).toBe('Jan 1, 2026');
    expect(formatDate('2026-12-31', { style: 'long' })).toBe('December 31, 2026');
    expect(formatDate('2026-01-01', { style: 'iso' })).toBe('2026-01-01');
  });

  it('falls back on anything that is not a calendar date', () => {
    expect(formatDate(null)).toBe(EM_DASH);
    expect(formatDate('not a date')).toBe(EM_DASH);
    expect(formatDate('2026-13-01')).toBe(EM_DASH);
  });
});

describe('formatDistance', () => {
  it('formats and converts', () => {
    expect(formatDistance(2.4)).toBe('2.4 km');
    expect(formatDistance(3.2, { to: 'mi' })).toBe('2.0 mi');
    expect(formatDistance(1500, { from: 'm' })).toBe('1.5 km');
    expect(formatDistance(1.5, { to: 'm' })).toBe('1,500 m');
    expect(formatDistance(null)).toBe(EM_DASH);
  });
});

describe('titleCase', () => {
  it('handles snake, kebab and camel', () => {
    expect(titleCase('masonry_non_combustible')).toBe('Masonry Non Combustible');
    expect(titleCase('new business')).toBe('New Business');
    expect(titleCase('lineOfBusiness')).toBe('Line of Business');
    expect(titleCase('')).toBe('');
  });
});

describe('pluralize', () => {
  it('agrees with the count', () => {
    expect(pluralize(1, 'building')).toBe('1 building');
    expect(pluralize(3, 'building')).toBe('3 buildings');
    expect(pluralize(0, 'claim')).toBe('0 claims');
    expect(pluralize(2, 'policy', 'policies')).toBe('2 policies');
    expect(pluralize(5, 'building', undefined, { includeCount: false })).toBe('buildings');
  });
});

describe('truncateQuote', () => {
  it('leaves a short quote exactly as it was', () => {
    expect(truncateQuote('Building C was built in 1978.')).toBe(
      'Building C was built in 1978.',
    );
  });

  it('cuts on a word boundary and marks the cut', () => {
    const long = 'word '.repeat(60).trim();
    const out = truncateQuote(long, 40);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(41);
    expect(long.startsWith(out.slice(0, -1))).toBe(true);
  });

  it('collapses whitespace and survives nulls', () => {
    expect(truncateQuote('  a   b  ')).toBe('a b');
    expect(truncateQuote(null)).toBe('');
  });
});
