/**
 * Golden test over the real Federato snapshot (unit E17).
 *
 * - `realCases()` yields exactly the 27 hydrated property policies and the 11
 *   property submissions with no policy (LIVE_DATA_FACTS, PRD 6.5).
 * - The frozen `rating/commercial.json` is reproducible byte-for-byte by
 *   `rating:fit` from the same snapshot, obeys the priors' monotonic order, and
 *   carries its own policy-level error (PRD 6.7).
 * - Every real case runs end-to-end through `runEngine`, and the verdict +
 *   deciding rule per account is pinned. A change here is a behaviour change on
 *   real data and must be looked at, not re-pinned blindly.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { realCases } from './real.js';
import { runEngine } from '../runEngine.js';
import { main as fitMain } from '../scripts/fit.js';
import { commercialPriors } from '../fit/priors.js';
import {
  commercialRatingTableSchema,
  rulebookSchema,
  vectorSpecSchema,
} from '../schemas.js';
import { bestValue } from '../util/fields.js';
import { isMonotonic, median } from '../util/math.js';
import type {
  CommercialRatingTable,
  EngineConfig,
  RatingBand,
  Rulebook,
  VectorSpec,
} from '../types.js';

const FITTED_AT = '2026-09-19T14:05:01.294Z';

function text(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), 'utf8');
}

const TABLE_TEXT = text('../../rating/commercial.json');
const TABLE = commercialRatingTableSchema.parse(JSON.parse(TABLE_TEXT)) as unknown as CommercialRatingTable;
const SPEC = vectorSpecSchema.parse(JSON.parse(text('../../vectors/commercial.json'))) as unknown as VectorSpec;
const RULEBOOK = rulebookSchema.parse(JSON.parse(text('../../rules/commercial.json'))) as unknown as Rulebook;
const EXTENSIONS = rulebookSchema.parse(JSON.parse(text('../../rules/extensions.json'))) as unknown as Rulebook;
const CONFIG: EngineConfig = {
  spec: SPEC,
  rulebook: RULEBOOK,
  extensions: EXTENSIONS,
  ratingTable: TABLE,
  bookStats: null,
};

const cases = realCases();
const policies = cases.filter((c) => c.hasPolicy);
const noPolicy = cases.filter((c) => !c.hasPolicy);

function value<T>(field: Parameters<typeof bestValue<T>>[0]): T | null {
  const best = bestValue(field);
  return best === null ? null : best.value;
}

function asOf(c: (typeof cases)[number]): string {
  const d = value(c.submission.receivedDate) ?? value(c.submission.effectiveDate);
  if (d === null) throw new Error(`${c.externalId}: no date`);
  return d;
}

const results = new Map(
  cases.map((c) => [c.externalId, runEngine({ submission: c.submission, asOf: asOf(c) }, CONFIG)]),
);

afterEach(() => {
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */

describe('realCases — the committed snapshot, normalized', () => {
  it('yields 27 policies and 11 no-policy submissions, all commercial property', () => {
    expect(cases).toHaveLength(38);
    expect(policies).toHaveLength(27);
    expect(noPolicy).toHaveLength(11);
    expect(new Set(cases.map((c) => c.externalId)).size).toBe(38);
    for (const c of cases) {
      expect(c.submission.lineOfBusiness).toBe('commercial_property');
      expect(c.submission.externalId).toBe(c.externalId);
    }
  });

  it('is memoized (same array on every call)', () => {
    expect(realCases()).toBe(cases);
  });

  it('every policy carries buildings, a premium and a technical premium; 117 buildings in all', () => {
    let buildings = 0;
    for (const c of policies) {
      expect(c.submission.buildings.length).toBeGreaterThan(0);
      expect(value(c.submission.pricing.quotedPremium)).toBeGreaterThan(0);
      expect(value(c.submission.pricing.technicalPremium)).toBeGreaterThan(0);
      buildings += c.submission.buildings.length;
    }
    expect(buildings).toBe(117);
  });

  it('the no-policy set is 4 lost, 3 cleared, 3 quoted, 1 declined, with no buildings', () => {
    const statuses: Record<string, number> = {};
    for (const c of noPolicy) {
      const s = value(c.submission.status) ?? 'none';
      statuses[s] = (statuses[s] ?? 0) + 1;
      expect(c.submission.buildings).toHaveLength(0);
      expect(value(c.submission.insured.headquartersState)).toMatch(/^[A-Z]{2}$/);
    }
    expect(statuses).toEqual({ lost: 4, cleared: 3, quoted: 3, declined: 1 });
  });

  it('premium ÷ technical premium runs 0.93–1.21, median 1.05 (LIVE_DATA_FACTS)', () => {
    const ratios = policies.map(
      (c) =>
        (value(c.submission.pricing.quotedPremium) as number) /
        (value(c.submission.pricing.technicalPremium) as number),
    );
    expect(Math.min(...ratios)).toBeCloseTo(0.93, 2);
    expect(Math.max(...ratios)).toBeCloseTo(1.21, 2);
    expect(median(ratios)).toBeCloseTo(1.05, 2);
  });

  it('SUB-2025-00001 normalizes to the hydrated policy values', () => {
    const c = policies.find((x) => x.externalId === 'SUB-2025-00001');
    expect(c).toBeDefined();
    const s = c!.submission;
    expect(value(s.pricing.quotedPremium)).toBe(619_900);
    expect(value(s.pricing.technicalPremium)).toBe(628_900);
    expect(s.buildings).toHaveLength(9);
    expect(s.history).toHaveLength(2);
    expect(results.get('SUB-2025-00001')!.rollup.totalTiv).toBe(112_568_000);
  });
});

/* -------------------------------------------------------------------------- */

describe('rating/commercial.json — frozen fit', () => {
  it('parses, is fitted on the 27 policies, and reports its error', () => {
    expect(TABLE.lineOfBusiness).toBe('commercial_property');
    expect(TABLE.fittedAt).toBe(FITTED_AT);
    expect(TABLE.fitError?.n).toBe(27);
    // PRD 6.7: premium tracks TIV with R² = 0.72; the fit must be at least that good.
    expect(TABLE.fitError!.r2).toBeGreaterThanOrEqual(0.72);
    expect(TABLE.fitError!.mape).toBeGreaterThan(0);
    expect(TABLE.fitError!.mape).toBeLessThan(0.3);
    // PRD 6.7: real rate runs $0.23–$0.66 per $100 TIV.
    expect(TABLE.baseRate).toBeGreaterThanOrEqual(0.23);
    expect(TABLE.baseRate).toBeLessThanOrEqual(0.66);
  });

  it('is monotonic: a worse class is never cheaper', () => {
    const priors = commercialPriors();
    const keys = (family: string): readonly string[] => {
      const k = priors[family];
      if (k === undefined) throw new Error(`no prior order for ${family}`);
      return k;
    };
    const order = {
      construction: keys('construction'),
      age: keys('age'),
      protectionClass: keys('protectionClass'),
      lossHistory: keys('lossHistory'),
    };
    const construction = order.construction.map((k) => TABLE.construction[k] as number);
    expect(construction.every((f) => Number.isFinite(f))).toBe(true);
    expect(isMonotonic(construction, 'non_increasing')).toBe(true);
    const fam = (bands: readonly RatingBand[], keys: readonly string[]): number[] =>
      keys.map((k) => {
        const b = bands.find((x) => x.key === k);
        if (b === undefined) throw new Error(`missing band ${k}`);
        return b.factor;
      });
    expect(isMonotonic(fam(TABLE.age, order.age), 'non_increasing')).toBe(true);
    expect(isMonotonic(fam(TABLE.protectionClass, order.protectionClass), 'non_increasing')).toBe(true);
    expect(isMonotonic(fam(TABLE.lossHistory, order.lossHistory), 'non_increasing')).toBe(true);
    expect(TABLE.sprinkler.unsprinklered).toBeGreaterThanOrEqual(TABLE.sprinkler.sprinklered);
  });

  it('is reproduced byte-for-byte by rating:fit from the snapshot', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(await fitMain(['--dry-run', '--fitted-at', FITTED_AT])).toBe(0);
    const printed = log.mock.calls.map((c) => String(c[0]));
    expect(printed[0]).toContain('27 policies, 117 buildings');
    expect(printed[1]).toBe(TABLE_TEXT);
  });

  it('prices SUB-2024-00076 exactly as the formula in PRD 6.7 does by hand', () => {
    // One building: TIV 10,628,000, built 2013, Joisted Masonry, unsprinklered,
    // protection class 1, no claims in the five-year window (known $0).
    const r = results.get('SUB-2024-00076')!;
    const band = (bands: readonly RatingBand[], key: string): number =>
      bands.find((b) => b.key === key)!.factor;
    const expected =
      (10_628_000 / 100) *
      TABLE.baseRate *
      (TABLE.construction['Joisted Masonry'] as number) *
      band(TABLE.age, 'built_2010_plus') *
      band(TABLE.protectionClass, 'pc_1_3') *
      TABLE.sprinkler.unsprinklered *
      band(TABLE.lossHistory, 'loss_none');
    expect(r.rollup.fiveYearLoss).toBe(0);
    expect(r.price.predictedPremium).toBeCloseTo(expected, 6);
    expect(r.price.quotedPremium).toBe(45_900);
    expect(r.price.fitError?.n).toBe(27);
  });
});

/* -------------------------------------------------------------------------- */

/** Pinned from the first full real run (see docs/decisions/E17.md D-4). */
const GOLDEN: Readonly<Record<string, readonly [string, string | null]>> = {
  'SUB-2024-00065': ['DOES_NOT_FIT', 'AG-STATE-NA'], // R2-3: primary state is TX ($29.5M of $41.7M)
  'SUB-2024-00076': ['DOES_NOT_FIT', 'AG-STATE-NA'],
  'SUB-2024-00090': ['DOES_NOT_FIT', 'AG-PREM-NA-HIGH'], // R2-3: primary state is FL (target), not a knockout
  'SUB-2025-00001': ['DOES_NOT_FIT', 'AG-PREM-NA-HIGH'],
  'SUB-2025-00004': ['DOES_NOT_FIT', 'AG-STATE-NA'], // R2-3: primary state is MA ($51.8M of $104.1M)
  'SUB-2025-00033': ['DOES_NOT_FIT', 'AG-STATE-NA'],
  'SUB-2025-00042': ['DOES_NOT_FIT', 'AG-AGE-NA'],
  'SUB-2025-00052': ['DOES_NOT_FIT', 'AG-PREM-NA-HIGH'],
  'SUB-2025-00054': ['DOES_NOT_FIT', 'AG-STATE-NA'],
  'SUB-2025-00061': ['DOES_NOT_FIT', 'AG-PREM-NA-HIGH'], // R2-3: primary state is CA (target), not a knockout
  'SUB-2025-00066': ['DOES_NOT_FIT', 'AG-ST-NA'],
  'SUB-2025-00070': ['DOES_NOT_FIT', 'AG-PREM-NA-HIGH'],
  'SUB-2025-00074': ['DOES_NOT_FIT', 'AG-STATE-NA'],
  'SUB-2025-00077': ['DOES_NOT_FIT', 'AG-ST-NA'],
  'SUB-2025-00083': ['DOES_NOT_FIT', 'AG-PREM-NA-HIGH'],
  'SUB-2025-00091': ['DOES_NOT_FIT', 'AG-ST-NA'],
  'SUB-2025-00092': ['DOES_NOT_FIT', 'AG-STATE-NA'], // R2-3: primary state is NJ ($36.2M of $67.3M)
  'SUB-2026-00007': ['DOES_NOT_FIT', 'AG-ST-NA'],
  'SUB-2026-00014': ['DOES_NOT_FIT', 'AG-PREM-NA-HIGH'],
  'SUB-2026-00025': ['DOES_NOT_FIT', 'AG-STATE-NA'],
  'SUB-2026-00028': ['DOES_NOT_FIT', 'AG-PREM-NA-HIGH'],
  'SUB-2026-00031': ['DOES_NOT_FIT', 'AG-ST-NA'],
  'SUB-2026-00038': ['DOES_NOT_FIT', 'AG-ST-NA'],
  'SUB-2026-00043': ['DOES_NOT_FIT', 'AG-ST-NA'],
  'SUB-2026-00047': ['DOES_NOT_FIT', 'AG-STATE-NA'],
  'SUB-2026-00081': ['FIT', 'AG-TIV-A-LOW'], // R2-4: its receivedDate conflict is immaterial ($0 loss under both dates)
  'SUB-2026-00098': ['DOES_NOT_FIT', 'AG-STATE-NA'],
  'SUB-2025-00115': ['REFER', 'AG-LOB-A'],
  'SUB-2025-00126': ['REFER', 'AG-LOB-A'],
  'SUB-2025-00132': ['REFER', 'AG-LOB-A'],
  'SUB-2025-00134': ['REFER', 'AG-LOB-A'],
  'SUB-2025-00138': ['REFER', 'AG-LOB-A'],
  'SUB-2025-00143': ['REFER', 'AG-LOB-A'],
  'SUB-2026-00118': ['REFER', 'AG-LOB-A'],
  'SUB-2026-00131': ['REFER', 'AG-LOB-A'],
  'SUB-2026-00133': ['REFER', 'AG-LOB-A'],
  'SUB-2026-00141': ['REFER', 'AG-LOB-A'],
  'SUB-2026-00147': ['REFER', 'AG-LOB-A'],
};

describe('runEngine over every real case — golden verdicts', () => {
  it('pins verdict and deciding rule for all 38 accounts', () => {
    const actual: Record<string, readonly [string, string | null]> = {};
    for (const [id, r] of results) actual[id] = [r.verdict.verdict, r.verdict.decidingRule?.ruleId ?? null];
    expect(actual).toEqual(GOLDEN);
  });

  it('every policy gets a fitted predicted premium; no-policy accounts get none', () => {
    for (const c of policies) {
      const r = results.get(c.externalId)!;
      expect(r.price.basis).toBe('fitted');
      expect(r.price.predictedPremium).toBeGreaterThan(0);
      expect(r.ratingVersion).toBe(TABLE.version);
    }
    for (const c of noPolicy) {
      const r = results.get(c.externalId)!;
      expect(r.price.predictedPremium).toBeNull();
      expect(r.verdict.missingComponentKeys).toContain('totalTiv');
    }
  });

  it('every verdict on real data names its deciding rule', () => {
    for (const r of results.values()) {
      expect(r.verdict.decidingRule).not.toBeNull();
    }
  });
});
