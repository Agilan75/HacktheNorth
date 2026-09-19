import { describe, expect, it } from 'vitest';
import type {
  CanonicalSubmission,
  Provenance,
  Rule,
  Rulebook,
  Sourced,
} from '../types.js';
import { contradict } from './contradict.js';

const broker: Provenance = { source: 'self_reported' };
const publicRecord: Provenance = { source: 'enrichment' };
const reply: Provenance = { source: 'answer' };

function one<T>(value: T, provenance: Provenance): Sourced<T> {
  return [{ value, provenance }];
}

function two<T>(a: T, b: T): Sourced<T> {
  return [
    { value: a, provenance: broker },
    { value: b, provenance: publicRecord },
  ];
}

function rule(id: string, field: string, over: Partial<Rule> = {}): Rule {
  return {
    id,
    lineOfBusiness: 'commercial_property',
    factor: 'tiv',
    tier: 'not_acceptable',
    when: [{ field, op: 'gt', value: 0 }],
    citation: { doc: 'APPETITE_GUIDELINES.pdf', section: 'p2', quote: 'Over $150M' },
    ...over,
  };
}

function book(rules: readonly Rule[]): Rulebook {
  return {
    id: 'commercial',
    lineOfBusiness: 'commercial_property',
    version: '1.0.0',
    source: 'APPETITE_GUIDELINES.pdf',
    weights: { tiv: 1 },
    rules,
  };
}

function base(over: Partial<CanonicalSubmission> = {}): CanonicalSubmission {
  return {
    id: 'SUB-1',
    lineOfBusiness: 'commercial_property',
    insured: {},
    locations: [{ externalId: 'L1', state: one('OH', broker) }],
    buildings: [{ externalId: 'B1', tiv: one(1_000_000, broker) }],
    hazards: { present: {} },
    exposure: {},
    coverage: { lines: [] },
    history: [],
    pricing: {},
    ...over,
  };
}

describe('contradict — detection', () => {
  it('reports a slot holding two materially different values', () => {
    const out = contradict(
      base({ buildings: [{ externalId: 'B1', tiv: two(1_000_000, 2_500_000) }] }),
      book([]),
    );

    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe('contradiction:buildings.B1.tiv');
    expect(out[0]!.canonicalPath).toBe('buildings.B1.tiv');
    expect(out[0]!.status).toBe('open');
    expect(out[0]!.values.map((f) => f.value)).toEqual([1_000_000, 2_500_000]);
    expect(out[0]!.note).toBe(
      '2 competing values for buildings.B1.tiv (self_reported, enrichment)',
    );
  });

  it('ignores float noise inside MONEY_TOLERANCE but not outside it', () => {
    const quiet = contradict(
      base({ pricing: { quotedPremium: two(50_000, 50_000.0000005) } }),
      book([]),
    );
    expect(quiet).toHaveLength(0);

    const loud = contradict(base({ pricing: { quotedPremium: two(50_000, 50_000.01) } }), book([]));
    expect(loud).toHaveLength(1);
  });

  it('folds case and whitespace on strings', () => {
    const out = contradict(base({ locations: [{ externalId: 'L1', state: two('OH', ' oh ') }] }), book([]));
    expect(out).toHaveLength(0);
  });

  it('treats null and NaN as missing, not as a competing value (G-1)', () => {
    const out = contradict(
      base({
        buildings: [
          {
            externalId: 'B1',
            tiv: [
              { value: 1_000_000, provenance: broker },
              { value: null as unknown as number, provenance: publicRecord },
              { value: NaN, provenance: reply },
            ],
          },
        ],
      }),
      book([]),
    );

    expect(out).toHaveLength(0);
  });

  it('reports agreeing values as no contradiction, however many sources', () => {
    const out = contradict(
      base({
        buildings: [
          {
            externalId: 'B1',
            tiv: [
              { value: 1_000_000, provenance: broker },
              { value: 1_000_000, provenance: publicRecord },
              { value: 1_000_000, provenance: reply },
            ],
          },
        ],
      }),
      book([]),
    );

    expect(out).toHaveLength(0);
  });
});

describe('contradict — severity', () => {
  it('is HIGH when a rule reads a field the disputed path feeds', () => {
    const rules = [rule('R-TIV', 'totalTiv'), rule('R-AGE', 'pctTivPre1990')];
    const out = contradict(
      base({ buildings: [{ externalId: 'B1', tiv: two(1_000_000, 2_500_000) }] }),
      book(rules),
    );

    expect(out[0]!.severity).toBe('HIGH');
    // A disputed building TIV moves the total and every TIV-weighted share.
    expect(out[0]!.affectedRules).toEqual(['R-TIV', 'R-AGE']);
  });

  it('strips a `rollup.` prefix on the rule field', () => {
    const out = contradict(
      base({ buildings: [{ externalId: 'B1', yearBuilt: two(1988, 1995) }] }),
      book([rule('R-AGE', 'rollup.pctTivPre1990')]),
    );

    expect(out[0]!.severity).toBe('HIGH');
    expect(out[0]!.affectedRules).toEqual(['R-AGE']);
  });

  it('is LOW when no rule depends on the path', () => {
    const out = contradict(
      base({ insured: { contactEmail: two('a@example.com', 'b@example.com') } }),
      book([rule('R-TIV', 'totalTiv')]),
    );

    expect(out).toHaveLength(1);
    expect(out[0]!.severity).toBe('LOW');
    expect(out[0]!.affectedRules).toEqual([]);
  });

  it('counts an extension rule, and matches a hazard by either path form', () => {
    const extensions = book([
      rule('X-CANDLE', 'hazards.candle', { factor: 'hazards', extension: true }),
    ]);
    const out = contradict(
      base({
        hazards: { present: { candle: two<boolean | number>(true, false) } },
      }),
      book([]),
      extensions,
    );

    expect(out[0]!.canonicalPath).toBe('hazards.present.candle');
    expect(out[0]!.severity).toBe('HIGH');
    expect(out[0]!.affectedRules).toEqual(['X-CANDLE']);
  });

  it('marks a disputed received date HIGH, because it moves the loss window (I-4)', () => {
    const out = contradict(
      base({ receivedDate: two('2025-05-17', '2025-06-01') }),
      book([rule('R-LOSS', 'fiveYearLoss', { factor: 'loss_value' })]),
    );

    expect(out[0]!.severity).toBe('HIGH');
    expect(out[0]!.affectedRules).toEqual(['R-LOSS']);
  });
});

describe('contradict — determinism', () => {
  it('returns the contradictions sorted by canonical path', () => {
    const out = contradict(
      base({
        pricing: { quotedPremium: two(80_000, 95_000) },
        insured: { name: two('Acme', 'Acme Holdings LLC') },
        buildings: [{ externalId: 'B1', tiv: two(1_000_000, 2_500_000) }],
      }),
      book([]),
    );

    expect(out.map((c) => c.canonicalPath)).toEqual([
      'buildings.B1.tiv',
      'insured.name',
      'pricing.quotedPremium',
    ]);
  });

  it('never resolves anything: every contradiction comes back open', () => {
    const out = contradict(
      base({ pricing: { quotedPremium: two(80_000, 95_000) } }),
      book([rule('R-PREM', 'quotedPremium', { factor: 'total_premium' })]),
    );

    expect(out.every((c) => c.status === 'open')).toBe(true);
  });
});
