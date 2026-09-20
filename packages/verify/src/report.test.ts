import { describe, expect, it } from 'vitest';
import type { EngineResultView, LayerCSummary, NaiveInput, RunSummary } from './types.js';
import { renderReport, renderSummaryJson } from './report.js';
import { wilsonInterval } from './wilson.js';

const INPUT: NaiveInput = {
  submissionType: 'new_business',
  lineOfBusiness: 'commercial_property',
  primaryState: 'OH',
  totalTiv: 150000000,
  quotedPremium: 175000,
  pctTivPre1990: 0.5,
  pctTivPost2010: 0,
  pctTivAcceptableConstruction: 0.5,
  fiveYearLoss: 100000,
  anyBuildingPre1990: true,
  hasOpenHighContradiction: false,
};

const RUN: RunSummary = {
  startedAt: '2026-09-19T10:00:00.000Z',
  finishedAt: '2026-09-19T10:20:00.000Z',
  config: {
    total: 10_000_000,
    seed: 20250917,
    workers: 4,
    chunkSize: 50_000,
    maxDisagreements: 100,
    outDir: 'out',
  },
  completed: 9_950_000,
  invariantViolations: 0,
  disagreements: 1,
  errors: 0,
  casesPerSecond: 8291.6,
  firstViolations: [],
  firstDisagreements: [
    {
      caseId: 'case-20250917-17',
      seed: 20250917,
      input: INPUT,
      fields: [{ field: 'appetiteScore', engine: 84, naive: 83.4, tolerance: 1e-6 }],
    },
  ],
};

const ENGINE_REFER: EngineResultView = {
  appetiteScore: 84,
  completeness: 100,
  verdict: 'REFER',
  knockoutFactorIds: [],
  decidingFactorId: 'tiv',
  tierValuesByFactor: { tiv: 0.6, building_age: 0.6 },
};

const LAYER_C: LayerCSummary = {
  total: 2038,
  agreed: 1900,
  agreement: wilsonInterval(1900, 2038),
  byStratum: [
    { stratum: 'building_age_pre1990_at_50', total: 200, agreed: 150 },
    { stratum: 'real_property', total: 38, agreed: 38 },
  ],
  disagreements: [
    {
      caseId: 'case-20250917-99',
      stratum: 'building_age_pre1990_at_50',
      engine: ENGINE_REFER,
      model: {
        verdict: 'DOES_NOT_FIT',
        decidingFactor: 'building_age',
        reasoning: 'Half the TIV is | pre-1990.\nThe guideline says older than 1990 is Not Acceptable.',
      },
      agreed: false,
      cached: true,
    },
  ],
};

describe('renderReport', () => {
  const md = renderReport(RUN, LAYER_C);

  it('reports the completed count, never the requested one, and says the gap', () => {
    expect(md).toContain('| A. Property tests | 9,950,000 | 0 invariant violations |');
    expect(md).toContain('| B. Differential (naive second implementation) | 9,950,000 | 1 disagreement |');
    expect(md).toContain('Completed: 9,950,000 cases (50,000 short of the 10,000,000 requested).');
    expect(md).not.toContain('| 10,000,000 |');
  });

  it('gives the agreement rate with its 95% Wilson interval', () => {
    // 1900/2038 = 93.2%, Wilson 95% [92.1%, 94.2%].
    expect(md).toContain('93.2% (95% Wilson interval 92.1% – 94.2%, n = 2,038)');
    expect(md).toContain('| C. LLM second opinion | 2,038 | 1,900 agreed,');
  });

  it('lists every layer-C disagreement with both sides', () => {
    expect(md).toContain('#### case-20250917-99 (stratum `building_age_pre1990_at_50`) — cached');
    expect(md).toContain('**Engine:** REFER, deciding factor `tiv`. Appetite score 84.0, completeness 100.0%, knockouts: none.');
    expect(md).toContain('Tier values: tiv 0.6, building_age 0.6.');
    expect(md).toContain('**Model:** DOES_NOT_FIT, deciding factor `building_age`.');
    expect(md).toContain('> Half the TIV is | pre-1990.\n> The guideline says older than 1990 is Not Acceptable.');
  });

  it('breaks agreement down by stratum', () => {
    expect(md).toContain('| building_age_pre1990_at_50 | 200 | 150 | 75.0% |');
    expect(md).toContain('| real_property | 38 | 38 | 100.0% |');
  });

  it('lists differential disagreements with both numbers', () => {
    expect(md).toContain('| appetiteScore | 84 | 83.4 | 0.000001 |');
  });

  it('states the layer-C caveats', () => {
    expect(md).toContain('A layer-C disagreement is a lead, not proof the engine is wrong.');
    expect(md).toContain('Layer B is the real correctness check.');
  });

  it('says plainly when layer C has not run', () => {
    const noC = renderReport(RUN, null);
    expect(noC).toContain('| C. LLM second opinion | 0 | not run |');
    expect(noC).toContain('Layer C has not been run.');
  });

  it('is deterministic', () => {
    expect(renderReport(RUN, LAYER_C)).toBe(md);
  });
});

describe('renderSummaryJson', () => {
  it('fills the AggregateDto.verification fields', () => {
    const j = renderSummaryJson(RUN, LAYER_C);
    expect(j.propertyCasesRun).toBe(9_950_000);
    expect(j.differentialCasesRun).toBe(9_950_000);
    expect(j.disagreements).toBe(1);
    expect(j.llmCasesRun).toBe(2038);
    expect(j.llmAgreementRate).toBeCloseTo(1900 / 2038, 12);
    const ci = j.llmAgreementCi95 as [number, number];
    expect(ci[0]).toBeCloseTo(0.9205448986502247, 7);
    expect(ci[1]).toBeCloseTo(0.9424016305174601, 7);
    expect(j.extractionFieldAccuracy).toBeNull();
    expect(j.generatedAt).toBe('2026-09-19T10:20:00.000Z');
    expect(JSON.parse(JSON.stringify(j))).toEqual(j);
  });

  it('reports nulls, not zeros, before layer C runs', () => {
    const j = renderSummaryJson(RUN, null);
    expect(j.llmCasesRun).toBe(0);
    expect(j.llmAgreementRate).toBeNull();
    expect(j.llmAgreementCi95).toBeNull();
    expect(j.layerC).toBeNull();
  });
});
