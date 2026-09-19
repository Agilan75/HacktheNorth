import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { commercialPriors, priorFactors } from './priors';
import { tenantRatingTableSchema } from '../schemas';
import { isMonotonic } from '../util/math';

const LIVE_CONSTRUCTION = [
  'Fire Resistive',
  'Frame',
  'Non-Combustible',
  'Masonry Non-Combustible',
  'Joisted Masonry',
  'Modified Fire Resistive',
  'Wood Frame',
  'Steel Frame',
];

describe('commercialPriors', () => {
  it('orders every live construction value, frame worst and fire resistive best', () => {
    const order = commercialPriors()['construction'] ?? [];
    expect([...order].sort()).toEqual([...LIVE_CONSTRUCTION].sort());
    expect(order[0]).toBe('Wood Frame');
    expect(order[order.length - 1]).toBe('Fire Resistive');
  });

  it('names exactly the five commercial factor families', () => {
    expect(Object.keys(commercialPriors()).sort()).toEqual(
      ['age', 'construction', 'lossHistory', 'protectionClass', 'sprinkler'],
    );
  });
});

describe('priorFactors', () => {
  it('has a prior for every ordered level, non-increasing worst-to-best', () => {
    const order = commercialPriors();
    const priors = priorFactors();
    for (const [family, levels] of Object.entries(order)) {
      const values = levels.map((k) => priors[family]?.[k]);
      expect(values.every((v) => typeof v === 'number' && v > 0)).toBe(true);
      expect(isMonotonic(values, 'non_increasing', 0)).toBe(true);
    }
    expect(priors['base']?.['baseRate']).toBe(0.4);
  });
});

describe('rating/tenant.json', () => {
  const raw: unknown = JSON.parse(
    readFileSync(new URL('../../rating/tenant.json', import.meta.url), 'utf8'),
  );
  const table = tenantRatingTableSchema.parse(raw);
  const spec = JSON.parse(
    readFileSync(new URL('../../vectors/tenant.json', import.meta.url), 'utf8'),
  ) as { components: { key: string }[] };

  it('parses against the tenant schema', () => {
    expect(table.lineOfBusiness).toBe('tenant');
    expect(table.baseMonthlyRate).toBe(14);
  });

  it('has a factor for every hazard component of the tenant vector, each a surcharge', () => {
    const hazardKeys = spec.components
      .map((c) => c.key)
      .filter((k) => k.startsWith('hazard'))
      .map((k) => k.charAt(6).toLowerCase() + k.slice(7));
    expect(Object.keys(table.hazards).sort()).toEqual([...hazardKeys].sort());
    for (const f of Object.values(table.hazards)) expect(f).toBeGreaterThan(1);
  });

  it('covers every term from 4 to 12 months, shorter never cheaper per month', () => {
    const terms = [4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => table.term[String(m)]);
    expect(terms.every((v) => typeof v === 'number')).toBe(true);
    expect(isMonotonic(terms, 'non_increasing', 0)).toBe(true);
    expect(table.term['12']).toBe(1);
  });

  it('is monotonic: older buildings and more contents cost more; detectors save', () => {
    expect(isMonotonic(table.buildingAge.map((b) => b.factor), 'non_increasing', 0)).toBe(true);
    expect(isMonotonic(table.contents.map((b) => b.factor), 'non_decreasing', 0)).toBe(true);
    expect(table.smokeDetector.present).toBeLessThan(table.smokeDetector.absent);
  });

  it('prices the worked example: 12 months, $15K contents, 1975, heater, detector', () => {
    // 14 x 1.00 contents x 1.10 age x 1.15 heater x 0.92 detector x 1.00 term
    const monthly = 14 * 1.0 * 1.1 * 1.15 * 0.92 * 1.0;
    const c = table.contents.find((b) => b.upTo !== null && 15_000 <= b.upTo)?.factor as number;
    const a = table.buildingAge.find((b) => b.upTo !== null && 1975 <= b.upTo)?.factor as number;
    const got = 14 * c * a * (table.hazards['portableHeater'] as number) * table.smokeDetector.present * (table.term['12'] as number);
    expect(got).toBeCloseTo(monthly, 10);
    expect(got).toBeCloseTo(16.2932, 4);
  });
});
