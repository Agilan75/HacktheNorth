import { describe, expect, it } from 'vitest';
import type {
  BuildingFacts,
  CanonicalSubmission,
  Contradiction,
  EngineResult,
  FactorOutcome,
  Flip,
  MissingField,
  Verdict,
} from '@retrofit/engine';
import { selectRequest } from './request';

const SR = { source: 'self_reported' } as const;

function building(id: string, label: string, facts: Partial<Record<'tiv' | 'yearBuilt' | 'constructionType', unknown>>): BuildingFacts {
  const out: Record<string, unknown> = { externalId: id, label, locationExternalId: 'L1' };
  for (const [k, v] of Object.entries(facts)) out[k] = [{ value: v, provenance: SR }];
  return out as unknown as BuildingFacts;
}

function canonical(buildings: BuildingFacts[], withLocation = true): CanonicalSubmission {
  return {
    id: 'SUB-1',
    lineOfBusiness: 'commercial_property',
    insured: { name: [{ value: 'Harbor Point Retail LLC', provenance: SR }] },
    locations: withLocation
      ? [{ externalId: 'L1', state: [{ value: 'CA', provenance: SR }], city: [{ value: 'Fresno', provenance: SR }] }]
      : [],
    buildings,
    hazards: { present: {} },
    exposure: {},
    coverage: { lines: [] },
    history: [],
    pricing: {},
  };
}

function factor(f: FactorOutcome['factor'], keys: string[], ruleId: string | null): FactorOutcome {
  return {
    factor: f,
    componentKeys: keys,
    tier: 'acceptable',
    tierValue: 0.6,
    weight: 0.1,
    points: 6,
    known: ruleId !== null,
    knockout: false,
    refer: false,
    ruleId,
    citation: null,
  };
}

interface ResultOpts {
  verdict: Verdict;
  canonical: CanonicalSubmission;
  missing?: MissingField[];
  contradictions?: Contradiction[];
  flip?: Flip | null;
}

function result(o: ResultOpts): EngineResult {
  const r = {
    id: 'SUB-1',
    lineOfBusiness: 'commercial_property',
    canonical: o.canonical,
    contradictions: o.contradictions ?? [],
    evaluate: {
      factors: [
        factor('building_age', ['pctTivPre1990', 'pctTivPost2010'], 'CP-AGE-ACC'),
        factor('total_premium', ['quotedPremium'], 'CP-PREM-NA'),
        factor('tiv', ['totalTiv'], 'CP-TIV-TGT'),
        factor('construction_type', ['pctTivAcceptableConstruction'], 'CP-CONS-ACC'),
        factor('primary_risk_state', ['stateTier'], 'CP-STATE-TGT'),
      ],
      firedRules: [],
      missingFields: o.missing ?? [],
    },
    verdict: { verdict: o.verdict },
    flip: { flip: o.flip ?? null, reason: o.flip ? null : 'no flip', blockedByImmovable: [] },
  };
  return r as unknown as EngineResult;
}

describe('selectRequest — missing data', () => {
  it('asks for the one building-level value that is missing, with the PRD wording', () => {
    const c = canonical([
      building('B1', 'A', { tiv: 20_000_000, yearBuilt: 2012, constructionType: 'Steel Frame' }),
      building('B3', 'C', { tiv: 30_000_000, constructionType: 'Frame' }),
    ]);
    const sel = selectRequest({ submissionId: 'SUB-1', result: result({ verdict: 'REFER', canonical: c }) });
    expect(sel.qualifies).toBe(true);
    expect(sel.triggers).toEqual(['missing_data']);
    expect(sel.fields).toHaveLength(1);
    const f = sel.fields[0];
    expect(f?.canonicalPath).toBe('buildings.B3.yearBuilt');
    expect(f?.label).toBe('year built for Building C');
    expect(f?.why).toBe('it decides the building-age factor');
    expect(f?.factor).toBe('building_age');
    expect(f?.componentKey).toBe('pctTivPre1990');
    expect(f?.ruleId).toBe('CP-AGE-ACC');
    expect(f?.severity).toBe('HIGH');
    expect(f?.currentValue).toBeNull();
    expect(sel.insuredName).toBe('Harbor Point Retail LLC');
  });

  it('asks a no-policy account for premium and every building-derived value, once each', () => {
    const c = canonical([], false);
    const missing: MissingField[] = [
      { componentKey: 'stateTier', canonicalPath: 'rollup.primaryState', factor: 'primary_risk_state', required: true, reason: '' },
      { componentKey: 'totalTiv', canonicalPath: 'rollup.totalTiv', factor: 'tiv', required: true, reason: '' },
      { componentKey: 'quotedPremium', canonicalPath: 'pricing.quotedPremium', factor: 'total_premium', required: true, reason: '' },
      { componentKey: 'pctTivPre1990', canonicalPath: 'rollup.pctTivPre1990', factor: 'building_age', required: true, reason: '' },
      { componentKey: 'pctTivPost2010', canonicalPath: 'rollup.pctTivPost2010', factor: 'building_age', required: true, reason: '' },
      { componentKey: 'pctTivSprinklered', canonicalPath: 'rollup.pctTivSprinklered', factor: 'sprinkler_protection', required: false, reason: '' },
    ];
    const sel = selectRequest({ submissionId: 'SUB-1', result: result({ verdict: 'REFER', canonical: c, missing }) });
    expect(sel.fields.map((f) => f.canonicalPath)).toEqual([
      'locations.*.state',
      'buildings.*.tiv',
      'pricing.quotedPremium',
      'buildings.*.yearBuilt',
    ]);
    // Non-required components (sprinklers) are never asked for.
    expect(sel.fields.some((f) => f.canonicalPath.includes('sprinklered'))).toBe(false);
  });

  it('does not ask for missing data on a DOES_NOT_FIT account', () => {
    const c = canonical([building('B3', 'C', { tiv: 1 })]);
    const sel = selectRequest({ submissionId: 'SUB-1', result: result({ verdict: 'DOES_NOT_FIT', canonical: c }) });
    expect(sel.qualifies).toBe(false);
    expect(sel.fields).toHaveLength(0);
    expect(sel.triggers).toEqual([]);
    expect(sel.rationale).toMatch(/^No request/);
  });
});

describe('selectRequest — contradictions and flips', () => {
  const complete = canonical([building('B1', 'A', { tiv: 20_000_000, yearBuilt: 2012, constructionType: 'Steel Frame' })]);

  it('asks about an open HIGH contradiction only', () => {
    const contradictions: Contradiction[] = [
      {
        id: 'contradiction:buildings.B1.yearBuilt',
        canonicalPath: 'buildings.B1.yearBuilt',
        values: [
          { value: 2012, provenance: SR },
          { value: 1978, provenance: { source: 'enrichment' } },
        ],
        severity: 'HIGH',
        affectedRules: ['CP-AGE-NA', 'CP-AGE-REFER'],
        status: 'open',
      },
      {
        id: 'contradiction:insured.industry',
        canonicalPath: 'insured.industry',
        values: [],
        severity: 'LOW',
        affectedRules: [],
        status: 'open',
      },
      {
        id: 'contradiction:pricing.quotedPremium',
        canonicalPath: 'pricing.quotedPremium',
        values: [],
        severity: 'HIGH',
        affectedRules: ['CP-PREM-NA'],
        status: 'resolved',
      },
    ];
    const sel = selectRequest({ submissionId: 'SUB-1', result: result({ verdict: 'REFER', canonical: complete, contradictions }) });
    expect(sel.triggers).toEqual(['high_contradiction']);
    expect(sel.fields).toHaveLength(1);
    const f = sel.fields[0];
    expect(f?.canonicalPath).toBe('buildings.B1.yearBuilt');
    expect(f?.label).toBe('year built for Building A');
    expect(f?.currentValue).toBe('2012 (self_reported) vs 1978 (enrichment)');
    expect(f?.ruleId).toBe('CP-AGE-NA');
    expect(f?.why).toContain('building-age factor');
    expect(f?.severity).toBe('HIGH');
  });

  it('asks for the flip component on an account one flip from FIT', () => {
    const flip: Flip = {
      moves: [
        {
          componentIndex: 4,
          componentKey: 'quotedPremium',
          from: 190_000,
          to: 175_000,
          deltaScaled: 0.05,
          label: 'Lower quoted premium from 190000 to 175000',
          fixHint: 'Bring the quoted premium into $50K to $175K; $75K to $100K is Target.',
        },
      ],
      scoreBefore: 75,
      scoreAfter: 84,
      premiumBefore: null,
      premiumAfter: null,
      verdictAfter: 'FIT',
      distanceScaled: 0.05,
    };
    const sel = selectRequest({ submissionId: 'SUB-1', result: result({ verdict: 'DOES_NOT_FIT', canonical: complete, flip }) });
    expect(sel.triggers).toEqual(['one_flip_from_fit']);
    expect(sel.fields).toHaveLength(1);
    const f = sel.fields[0];
    expect(f?.canonicalPath).toBe('pricing.quotedPremium');
    expect(f?.label).toBe('quoted premium');
    expect(f?.currentValue).toBe('$190,000');
    expect(f?.factor).toBe('total_premium');
    expect(f?.ruleId).toBe('CP-PREM-NA');
    expect(f?.why).toContain('$175,000');
    expect(f?.why).toContain('75 to 84');
    expect(f?.severity).toBe('MEDIUM');
  });

  it('does nothing for a clean FIT account', () => {
    const sel = selectRequest({ submissionId: 'SUB-1', result: result({ verdict: 'FIT', canonical: complete }) });
    expect(sel.qualifies).toBe(false);
    expect(sel.fields).toHaveLength(0);
  });

  it('dedupes a path that is both missing and disputed, and records every trigger that added a field', () => {
    const c = canonical([
      building('B1', 'A', { tiv: 20_000_000, yearBuilt: 2012, constructionType: 'Steel Frame' }),
      building('B2', 'B', { tiv: 5_000_000, yearBuilt: 1999 }),
    ]);
    const contradictions: Contradiction[] = [
      {
        id: 'contradiction:buildings.B1.tiv',
        canonicalPath: 'buildings.B1.tiv',
        values: [
          { value: 20_000_000, provenance: SR },
          { value: 26_000_000, provenance: { source: 'enrichment' } },
        ],
        severity: 'HIGH',
        affectedRules: ['CP-TIV-TGT'],
        status: 'open',
      },
    ];
    const sel = selectRequest({
      submissionId: 'SUB-1',
      result: result({ verdict: 'REFER', canonical: c, contradictions }),
      broker: { id: 5, name: 'Cardinal & Vale', tier: 'boutique', region: 'Midwest' },
      contact: { id: 12, name: 'Kevin Marchetti', email: 'k@x.example.com', phone: '555-0754', title: 'Producer' },
    });
    expect(sel.triggers).toEqual(['missing_data', 'high_contradiction']);
    expect(sel.fields.map((f) => f.canonicalPath)).toEqual(['buildings.B2.constructionType', 'buildings.B1.tiv']);
    expect(sel.broker?.name).toBe('Cardinal & Vale');
    expect(sel.contact?.name).toBe('Kevin Marchetti');
    expect(sel.rationale).toBe(
      'Requesting 2 fields because the account is REFER with missing data; an open HIGH contradiction puts a rule at risk.',
    );
  });
});
